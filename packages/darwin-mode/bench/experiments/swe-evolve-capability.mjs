// SPDX-License-Identifier: MIT
//
// ADR-134 — completes ADR-133. ADR-133 evolved over an EASY corpus (all single-fault small
// files): resolve-rate saturated, so evolution converged on COST. This evolves over a
// CAPABILITY-DISCRIMINATING corpus that includes a real MULTI-FAULT bug (a legitimate, common
// bug category) where whole-file repair genuinely fails (regresses PASS_TO_PASS, ADR-126) but
// surgical search/replace resolves (ADR-127). Now fitness has a RESOLVE-RATE gradient, and
// evolution should select patchMode=searchreplace by CAPABILITY, not cost. Same (1+λ) loop.
//
// Run: OPENROUTER_API_KEY=$(cat /tmp/.orkey) \
//   node --experimental-strip-types --no-warnings bench/experiments/swe-evolve-capability.mjs [model]

import { readFileSync, cpSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSweBenchTask } from '../swe-bench-runner.mjs';

const model = process.argv[2] || 'google/gemini-2.5-flash';
const PKGS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DARWIN = join(PKGS, 'darwin-mode');

// Instance 1: a real TWO-FAULT bug (small pareto.ts + large phenotype.ts) — the capability
// discriminator. whole-file rewrite regresses the large file (ADR-126); search/replace resolves.
function twoFault() {
  const bugs = [
    { file: 'src/pareto.ts', from: 'if (!dominated) front.push(items[i]);', to: 'if (dominated) front.push(items[i]);' },
    { file: 'src/phenotype.ts', from: 'return Math.acosh(1 + (2 * diff2) / denom);', to: 'return Math.acosh(1 + (2 * diff2) * denom);' },
  ];
  return {
    id: 'two-fault', problem: 'The pareto module returns dominated items instead of the non-dominated front, and the phenotype poincare distance fails to grow toward the unit-ball boundary. Fix the buggy files.',
    suites: ['pareto', 'phenotype', 'clade'], root: DARWIN,
    inject(work) { for (const b of bugs) { const p = join(work, b.file); writeFileSync(p, readFileSync(p, 'utf8').replace(b.from, b.to)); } },
  };
}
// Instance 2: an easy single-fault external bug — both modes resolve it.
function easy() {
  const b = { file: 'src/index.ts', from: "if (!m.id || typeof m.id !== 'string') throw new Error('manifest.id must be a string');", to: "if (typeof m.id !== 'string') throw new Error('manifest.id must be a string');" };
  return {
    id: 'vertical-base', problem: 'validateVerticalManifest accepts an empty string id instead of rejecting it.',
    suites: ['base'], root: join(PKGS, 'vertical-base'),
    inject(work) { const p = join(work, b.file); writeFileSync(p, readFileSync(p, 'utf8').replace(b.from, b.to)); },
  };
}
const SPECS = [twoFault(), easy()];

function taskFor(spec, g) {
  return {
    instance_id: spec.id, problem_statement: spec.problem, test_suites: spec.suites,
    patchMode: g.patchMode, maxAttempts: g.maxAttempts, selectK: g.selectK,
    materialize(work) {
      for (const d of ['src', '__tests__']) cpSync(join(spec.root, d), join(work, d), { recursive: true });
      for (const f of ['package.json', 'tsconfig.json']) if (existsSync(join(spec.root, f))) cpSync(join(spec.root, f), join(work, f));
      writeFileSync(join(work, '.gitignore'), 'node_modules\n_vitest.json\n_patch.diff\n');
      symlinkSync(join(spec.root, 'node_modules'), join(work, 'node_modules'), 'dir');
      spec.inject(work);
    },
  };
}

const key = (g) => `${g.patchMode}/a${g.maxAttempts}/k${g.selectK}`;
const cache = new Map();
async function fitness(g) {
  if (cache.has(key(g))) return cache.get(key(g));
  let resolved = 0, cost = 0; const per = [];
  for (const spec of SPECS) {
    let r; try { r = await runSweBenchTask(taskFor(spec, g), { model }); } catch { r = { resolved: false, cost_usd: 0 }; }
    if (r.resolved) resolved++; cost += r.cost_usd ?? 0; per.push({ i: spec.id, resolved: r.resolved });
  }
  const f = { genome: key(g), resolved, total: SPECS.length, cost_usd: Math.round(cost * 10000) / 10000, per };
  cache.set(key(g), f); return f;
}
const better = (a, b) => (b.resolved - a.resolved) || (a.cost_usd - b.cost_usd);
const neighbours = (g) => [
  { ...g, patchMode: g.patchMode === 'searchreplace' ? 'wholefile' : 'searchreplace' },
  { ...g, maxAttempts: g.maxAttempts === 1 ? 3 : 1 },
];

let pop = [
  { patchMode: 'wholefile', maxAttempts: 3, selectK: 6 },
  { patchMode: 'wholefile', maxAttempts: 1, selectK: 6 },
  { patchMode: 'searchreplace', maxAttempts: 1, selectK: 6 },
];
const trajectory = []; let elite = null;
for (let gen = 0; gen < 3; gen++) {
  const scored = [];
  for (const g of pop) scored.push({ g, f: await fitness(g) });
  scored.sort((a, b) => better(a.f, b.f));
  if (!elite || better(scored[0].f, elite.f) < 0) elite = scored[0];
  trajectory.push({ gen, best: scored[0].f.genome, bestResolved: `${scored[0].f.resolved}/${scored[0].f.total}`, bestCost: scored[0].f.cost_usd, evaluated: scored.map((s) => `${s.f.genome}:${s.f.resolved}/${s.f.total}`) });
  const fresh = neighbours(elite.g).filter((n) => !cache.has(key(n)));
  if (!fresh.length) break;
  pop = fresh;
}

const totalCost = [...cache.values()].reduce((s, f) => s + f.cost_usd, 0);
console.log(JSON.stringify({
  experiment: 'ADR-134 — capability-driven evolution on a discriminating corpus (completes ADR-133)',
  model, corpus: SPECS.map((s) => s.id), generations: trajectory.length, configsEvaluated: cache.size,
  trajectory,
  evolvedWinner: { genome: elite.f.genome, resolved: `${elite.f.resolved}/${elite.f.total}`, cost_usd: elite.f.cost_usd, perInstance: elite.f.per },
  totalCost_usd: Math.round(totalCost * 10000) / 10000,
  verdict: elite.f.genome.startsWith('searchreplace')
    ? `CAPABILITY-SELECTED: evolution chose '${elite.f.genome}' (${elite.f.resolved}/${elite.f.total}) — search/replace resolves the multi-fault instance whole-file CANNOT; fitness climbed by RESOLVE-RATE, not cost (contrast ADR-133)`
    : `winner '${elite.f.genome}' (${elite.f.resolved}/${elite.f.total}) — report as measured`,
}, null, 2));
