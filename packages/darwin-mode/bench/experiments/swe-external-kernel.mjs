// SPDX-License-Identifier: MIT
//
// ADR-131 — does runSweBenchTask generalize to an EXTERNAL package (one it was not built
// around)? Runs the full SWE pipeline on `packages/kernel-js` (a different codebase: own
// conventions, own files, own vitest suite). A real bug is introduced into a temp COPY of
// kernel-js's `trajectory.ts` (rotate threshold `<=` → `>`); the runner auto-derives F2P/P2P
// from kernel-js's own tests, selects files, patches (search/replace), and scores the real
// resolved criterion. Committed kernel-js is never touched (temp copy). One instance, cheap.
//
// Run: OPENROUTER_API_KEY=$(cat /tmp/.orkey) \
//   node --experimental-strip-types --no-warnings bench/experiments/swe-external-kernel.mjs [model]

import { readFileSync, cpSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSweBenchTask } from '../swe-bench-runner.mjs';

const model = process.argv[2] || 'google/gemini-2.5-flash';
const KERNEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'kernel-js'); // packages/kernel-js
const BUG = { file: 'src/trajectory.ts', from: 'if (s.size <= maxBytes) return false;', to: 'if (s.size > maxBytes) return false;' };

const task = {
  instance_id: 'kernel-js__trajectory-rotate',
  problem_statement: 'The trajectory store rotateIfLarger rotates when the file is small and skips rotation when the file is over the size limit — the size threshold is inverted.',
  test_suites: ['trajectory'],
  patchMode: 'searchreplace',
  maxAttempts: 3,
  materialize(work) {
    for (const d of ['src', '__tests__']) cpSync(join(KERNEL, d), join(work, d), { recursive: true });
    for (const f of ['package.json', 'tsconfig.json']) if (existsSync(join(KERNEL, f))) cpSync(join(KERNEL, f), join(work, f));
    writeFileSync(join(work, '.gitignore'), 'node_modules\n_vitest.json\n_patch.diff\n');
    symlinkSync(join(KERNEL, 'node_modules'), join(work, 'node_modules'), 'dir');
    const p = join(work, BUG.file); const s = readFileSync(p, 'utf8');
    if (!s.includes(BUG.from)) throw new Error('bug pattern not found in kernel-js trajectory.ts');
    writeFileSync(p, s.replace(BUG.from, BUG.to));
  },
};

const r = await runSweBenchTask(task, { model });
console.log(JSON.stringify({
  experiment: 'ADR-131 — runSweBenchTask on an EXTERNAL package (kernel-js)',
  externalPackage: 'kernel-js', result: r,
  verdict: r.resolved
    ? `GENERALIZES: the SWE runner resolved a real bug in an external package (kernel-js/trajectory.ts) — ${r.f2p} F2P, ${r.p2p} P2P, ${r.attemptsUsed} attempt(s), $${Math.round((r.cost_usd ?? 0) * 10000) / 10000}`
    : `did not resolve (${r.f2p} F2P, ${r.p2p} P2P) — external-package generalization needs work`,
}, null, 2));
