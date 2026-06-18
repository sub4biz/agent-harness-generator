// SPDX-License-Identifier: MIT
//
// ADR-114 (review item C, zero-token version): does diversity-selection beat
// greedy on a TWO-SURFACE epistatic deception when scored by the REAL surface
// CODE (Tier-2 'agent' substrate, ADR-106) instead of the mock scorer (ADR-105)?
// The treasure task is solvable only if BOTH the contextBuilder window is wide
// enough (surface the buried buggy file) AND the retryPolicy budget is high
// enough (reach the required attempt) — so a single-surface improvement is
// neutral, and only combining them (crossover across diverse parents) crosses it.
// Uses the deterministic Tier-2 agent loop (no LLM) → zero tokens, reproducible.
//
// Run: node --experimental-strip-types --no-warnings bench/experiments/real-substrate-deception.mjs

import { evolve } from '../../dist/index.js';
import { extractSurfaceParams } from '../../dist/mock-sandbox.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Easy tasks any variant solves + a treasure needing BOTH wide window AND high retry.
function distract(n) { return Array.from({ length: n }, (_, i) => `src/f_${i}.ts`); }
const DECEPTIVE = [
  { id: 'easy-1', prompt: 'fix a', files: ['src/a.ts'], buggyFile: 'src/a.ts', classification: 'transient', failAttempts: 0, backoffMs: 10, difficulty: 1 },
  { id: 'easy-2', prompt: 'fix b', files: ['src/b.ts'], buggyFile: 'src/b.ts', classification: 'transient', failAttempts: 1, backoffMs: 10, difficulty: 1 },
  // treasure: REACHABLE-but-epistatic — buried at rank 38 (needs window>38) AND
  // failAttempts 3 (needs maxAttempts>3). Both reachable from baseline (window 30,
  // maxAttempts 3) but only by combining a context mutation AND a retry mutation.
  { id: 'treasure', prompt: 'fix treasure', files: [...distract(38), 'src/treasure.ts'], buggyFile: 'src/treasure.ts', classification: 'transient', failAttempts: 3, backoffMs: 20, difficulty: 5 },
];

function repo() {
  const r = mkdtempSync(join(tmpdir(), 'rsd-'));
  mkdirSync(join(r, 'src'), { recursive: true });
  writeFileSync(join(r, 'package.json'), '{"name":"x","version":"1.0.0","private":true,"scripts":{"test":"true"}}');
  writeFileSync(join(r, 'src', 'i.js'), 'export const x=1;\n');
  writeFileSync(join(r, 'README.md'), '#\n');
  return r;
}

async function crosses(selection, seed) {
  const wr = mkdtempSync(join(tmpdir(), 'rsd-wr-'));
  const res = await evolve({
    repoRoot: repo(), workRoot: wr,
    generations: 8, childrenPerGeneration: 6, concurrency: 6, seed,
    promotionDelta: 0.001, tasks: ['t'], sandboxMode: 'agent', agentTasks: DECEPTIVE,
    selection, crossover: true, epistasis: true,
  });
  // Treasure crossed iff some variant evolved BOTH window>50 AND maxAttempts>4.
  for (const r of res.records) {
    const p = await extractSurfaceParams(r.variant.dir);
    if (p.contextWindow > 38 && p.maxAttempts > 3) return true;
  }
  return false;
}

const SEEDS = [7, 11, 23];
const summary = {};
for (const sel of ['score', 'behavioral-diversity']) {
  let crossed = 0;
  for (const s of SEEDS) if (await crosses(sel, s)) crossed += 1;
  summary[sel] = `${crossed}/${SEEDS.length}`;
}
console.log(JSON.stringify({
  substrate: 'agent (real surface code, Tier-2)', landscape: 'two-surface epistatic (reachable): treasure needs window>38 AND maxAttempts>3',
  seeds: SEEDS, crossedTreasure: summary,
}, null, 2));
