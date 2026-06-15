// SPDX-License-Identifier: MIT
//
// DRACO Adaptive Cost-Optimal Routing (ADR-040) — Phase 2.
//
// Phase 1 (ADR-038): a harness cannot beat the model on quality. Phase 2: can a
// harness CHOOSE the right model? The objective shifts from `quality` to
// `quality / dollar`, subject to quality >= frontier_baseline − ε.
//
// Method: run vanilla on each model in the pool, once per question, to build a
// per-question × per-model SCORE+TOKEN matrix. Every routing policy — always_X,
// the oracle (post-hoc per-question best), the constrained oracle, and any real
// router — is then a PURE function over that single matrix: one live run, every
// policy evaluated offline for free. Dependency-injected → offline-testable.

import type { OpenRouterTransport } from './fusion.js';
import type { UrlChecker } from './scorer.js';
import { scoreAnswer } from './scorer.js';
import { judgeFaithfulness, DRACO_JUDGE } from './judge.js';
import { vanillaResearch } from './optimized.js';
import { costOf, BLENDED_USD_PER_MTOK } from './cost-efficiency.js';
import type { DracoCorpus } from './runner.js';

/** One (question, model) cell: the DRACO quality + tokens for that model's dossier. */
export interface RoutingCell {
  quality: number;
  tokens: number;
}

/** questionId -> model -> cell. The reusable artifact every policy reads. */
export interface RoutingMatrix {
  models: string[];
  questionIds: string[];
  cells: Record<string, Record<string, RoutingCell>>;
}

export interface PolicyResult {
  label: string;
  /** Per question, the model this policy picked. */
  picks: string[];
  quality: number; // mean DRACO quality of the picked dossiers
  costUSD: number; // total cost of the picked dossiers
  qualityPerUSD: number;
  /** Fraction of oracle quality-per-dollar (filled by analyse()). */
  pctOfOracle?: number;
  /** Fraction of oracle QUALITY — the constrained figure of merit (filled by analyse()). */
  pctOfOracleQuality?: number;
}

/**
 * Build the per-question × per-model matrix with one vanilla call per (q, model).
 * Bounded concurrency is the caller's responsibility (pass a pooled map if
 * desired); here questions run in order, models concurrently per question.
 */
export async function runRoutingMatrix(
  corpus: DracoCorpus,
  opts: {
    pool: string[];
    transport: OpenRouterTransport;
    checkUrl: UrlChecker;
    judgeTransport?: OpenRouterTransport;
    judgeModel?: string;
    limit?: number;
    concurrency?: number;
    onProgress?: (done: number, total: number, id: string) => void;
  },
): Promise<RoutingMatrix> {
  const judgeModel = opts.judgeModel ?? DRACO_JUDGE.model;
  let questions = corpus.questions;
  if (opts.limit != null) questions = questions.slice(0, opts.limit);
  const limit = Math.max(1, opts.concurrency ?? 4);

  const cells: Record<string, Record<string, RoutingCell>> = {};
  let done = 0;

  // Simple bounded pool over questions; models run concurrently within a question.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const qi = next++;
      if (qi >= questions.length) return;
      const q = questions[qi];
      const row: Record<string, RoutingCell> = {};
      await Promise.all(
        opts.pool.map(async (model) => {
          const r = await vanillaResearch({ id: q.id, prompt: q.prompt }, model, opts.transport);
          const dims = await scoreAnswer(r.answer, q.rubric, q.prompt, opts.checkUrl);
          let quality = dims.mean;
          if (opts.judgeTransport) {
            const j = await judgeFaithfulness(r.answer, opts.judgeTransport, judgeModel);
            // fold faithfulness into the composite the same way the ablations do
            quality = (dims.grounding + dims.coverage + dims.balance + dims.cleanliness + j.faithfulness) / 5;
          }
          row[model] = { quality, tokens: r.totalTokens };
        }),
      );
      cells[q.id] = row;
      opts.onProgress?.(++done, questions.length, q.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, questions.length) }, () => worker()));

  return { models: opts.pool, questionIds: questions.map((q) => q.id), cells };
}

// ── Pure policy evaluators over the matrix (offline, no API) ──────────────────

function evalPicks(m: RoutingMatrix, label: string, pick: (q: string) => string, prices = BLENDED_USD_PER_MTOK): PolicyResult {
  const picks = m.questionIds.map(pick);
  let qSum = 0;
  let cost = 0;
  m.questionIds.forEach((q, i) => {
    const cell = m.cells[q][picks[i]];
    qSum += cell.quality;
    cost += costOf(picks[i], cell.tokens, prices);
  });
  const quality = qSum / m.questionIds.length;
  return { label, picks, quality, costUSD: cost, qualityPerUSD: cost > 0 ? quality / cost : Infinity };
}

/** Always use `model`. */
export function alwaysPolicy(m: RoutingMatrix, model: string, prices = BLENDED_USD_PER_MTOK): PolicyResult {
  return evalPicks(m, `always_${model}`, () => model, prices);
}

/** Oracle: per question pick the highest-QUALITY model (post-hoc upper bound on quality). */
export function oracleQuality(m: RoutingMatrix, prices = BLENDED_USD_PER_MTOK): PolicyResult {
  return evalPicks(m, 'oracle_quality', (q) => bestBy(m, q, (c) => c.quality), prices);
}

/**
 * Cost-optimal oracle: per question pick the CHEAPEST model whose quality is
 * within ε of that question's best — the operational target (least money for
 * frontier-ε quality). This is the quality/dollar upper bound under the ADR-040
 * constraint.
 */
export function oracleCostOptimal(m: RoutingMatrix, epsilon: number, prices = BLENDED_USD_PER_MTOK): PolicyResult {
  return evalPicks(m, `oracle_cost_optimal(eps=${epsilon})`, (q) => {
    const best = m.cells[q][bestBy(m, q, (c) => c.quality)].quality;
    // among models within ε of the per-question best, take the cheapest.
    let pick = '';
    let pickCost = Infinity;
    for (const model of m.models) {
      const cell = m.cells[q][model];
      if (cell.quality >= best - epsilon) {
        const c = costOf(model, cell.tokens, prices);
        if (c < pickCost) { pickCost = c; pick = model; }
      }
    }
    return pick;
  }, prices);
}

/** A real router: a selection function seeing only the matrix's structure (caller supplies the policy). */
export function routerPolicy(m: RoutingMatrix, label: string, pick: (q: string, m: RoutingMatrix) => string, prices = BLENDED_USD_PER_MTOK): PolicyResult {
  return evalPicks(m, label, (q) => pick(q, m), prices);
}

function bestBy(m: RoutingMatrix, q: string, key: (c: RoutingCell) => number): string {
  let best = m.models[0];
  for (const model of m.models) if (key(m.cells[q][model]) > key(m.cells[q][best])) best = model;
  return best;
}

/**
 * Attach two figures of merit to every policy, measured against the oracle:
 *  - pctOfOracleQuality — quality / oracle.quality. The constrained objective:
 *    how close to perfect per-question routing on QUALITY. (Always-cheapest
 *    scores low here — it's cheap but low-quality.)
 *  - pctOfOracle — quality-per-dollar / oracle.qualityPerUSD. The raw q/$ ratio;
 *    a cheap policy can exceed 100% here while badly missing quality, which is
 *    exactly why quality% is reported alongside it.
 */
export function analyse(policies: PolicyResult[], oracle: PolicyResult): PolicyResult[] {
  return policies.map((p) => ({
    ...p,
    pctOfOracle: oracle.qualityPerUSD > 0 ? p.qualityPerUSD / oracle.qualityPerUSD : 0,
    pctOfOracleQuality: oracle.quality > 0 ? p.quality / oracle.quality : 0,
  }));
}
