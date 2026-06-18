// SPDX-License-Identifier: MIT
//
// ADR-135 — the SWE-FIX model frontier. The runner (123-134) has only used gemini-2.5-flash.
// "Optimize" → which model maximizes RESOLVE-RATE per dollar on the SWE-fix task? This is the
// ADR-085 / DRACO "cheap beats frontier" question applied to runSweBenchTask: run the SAME
// corpus + harness config across several OpenRouter models and report resolve-rate + cost,
// surfacing models that can't follow the search/replace protocol (a real reliability finding).
//
// Run: OPENROUTER_API_KEY=$(cat /tmp/.orkey) \
//   node --experimental-strip-types --no-warnings bench/experiments/swe-model-frontier.mjs

import { readFileSync, cpSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSweBenchTask } from '../swe-bench-runner.mjs';

const PKGS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// 3 external single-fault packages (cheap, both-mode-resolvable) — fixed harness config so the
// only varying axis is the MODEL.
const SPECS = [
  { id: 'kernel-js', pkg: 'kernel-js', suites: ['trajectory'],
    problem: 'The trajectory store rotateIfLarger rotates a small file and skips rotation when over the size limit — the size threshold is inverted.',
    bug: { file: 'src/trajectory.ts', from: 'if (s.size <= maxBytes) return false;', to: 'if (s.size > maxBytes) return false;' } },
  { id: 'create-agent-harness', pkg: 'create-agent-harness', suites: ['constraints'],
    problem: 'The constraints summarise function reports allHardPass true even when a hard constraint fails.',
    bug: { file: 'src/constraints.ts', from: 'allHardPass: hard.every((r) => r.passed),', to: 'allHardPass: hard.some((r) => r.passed),' } },
  { id: 'vertical-base', pkg: 'vertical-base', suites: ['base'],
    problem: 'validateVerticalManifest accepts an empty string id instead of rejecting it.',
    bug: { file: 'src/index.ts', from: "if (!m.id || typeof m.id !== 'string') throw new Error('manifest.id must be a string');", to: "if (typeof m.id !== 'string') throw new Error('manifest.id must be a string');" } },
];

const MODELS = [
  'google/gemini-2.5-flash',
  'deepseek/deepseek-chat',
  'openai/gpt-5-mini',
  'anthropic/claude-haiku-4.5',
];

function taskFor(spec) {
  const root = join(PKGS, spec.pkg);
  return {
    instance_id: spec.id, problem_statement: spec.problem, test_suites: spec.suites,
    patchMode: 'searchreplace', maxAttempts: 2, selectK: 6,
    materialize(work) {
      for (const d of ['src', '__tests__']) cpSync(join(root, d), join(work, d), { recursive: true });
      for (const f of ['package.json', 'tsconfig.json']) if (existsSync(join(root, f))) cpSync(join(root, f), join(work, f));
      writeFileSync(join(work, '.gitignore'), 'node_modules\n_vitest.json\n_patch.diff\n');
      symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'dir');
      const p = join(work, spec.bug.file); writeFileSync(p, readFileSync(p, 'utf8').replace(spec.bug.from, spec.bug.to));
    },
  };
}

const rows = [];
for (const model of MODELS) {
  let resolved = 0, cost = 0; const per = [];
  for (const spec of SPECS) {
    let r; try { r = await runSweBenchTask(taskFor(spec), { model }); } catch (e) { r = { resolved: false, cost_usd: 0, error: String(e).slice(0, 80) }; }
    if (r.resolved) resolved++; cost += r.cost_usd ?? 0;
    per.push({ i: spec.id, resolved: r.resolved, att: r.attemptsUsed });
  }
  const c = Math.round(cost * 10000) / 10000;
  rows.push({ model, resolveRate: `${resolved}/${SPECS.length}`, resolved, cost_usd: c, resolvePerDollar: c > 0 ? Math.round(resolved / c) : null, per });
}
// Frontier: maximize resolved, then minimize cost.
rows.sort((a, b) => (b.resolved - a.resolved) || (a.cost_usd - b.cost_usd));

console.log(JSON.stringify({
  experiment: 'ADR-135 — SWE-fix model frontier (resolve-rate per dollar)',
  corpus: SPECS.map((s) => s.id), config: 'searchreplace / maxAttempts=2 / k=6', modelsTested: MODELS.length,
  frontier: rows,
  best: rows[0]?.model,
  verdict: `best resolve-rate: ${rows[0]?.model} (${rows[0]?.resolveRate}, $${rows[0]?.cost_usd}); cheapest full-resolve: ${(rows.filter((r) => r.resolved === SPECS.length).sort((a, b) => a.cost_usd - b.cost_usd)[0] || {}).model ?? 'none'} — the SWE-fix task's cheap-beats-frontier check`,
}, null, 2));
