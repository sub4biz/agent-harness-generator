// SPDX-License-Identifier: MIT
//
// FDR calibration check (ADR-112, addresses the review's point A2). ADR-096
// validated the BH algorithm on IDEALISED Uniform(0,1) nulls. The harder, real
// question: are the BOOTSTRAP p-values from `bootstrapDelta` well-calibrated at
// the SMALL sample sizes `evolve` actually uses (a handful of task-scores per
// variant), and does generation-wide BH then keep the empirical false-discovery
// rate ≤ q on those real, coarse p-values?
//
// Method (deterministic, zero LLM): simulate many "generations" under the global
// null — parent and child task-scores drawn from the SAME distribution (no real
// effect) at sample size n. Compute each child's bootstrap p-value, run BH(q)
// across the generation, and measure the empirical FDR. All null ⇒ every
// rejection is false ⇒ FDR = P(any rejection).
//
// Run: node bench/experiments/fdr-calibration.mjs

import { bootstrapDelta, benjaminiHochberg } from '../../dist/bench/stats.js';
import { mulberry32 } from '../../dist/clade.js';

const rng = mulberry32(20260618);
// Realistic score draw: clustered near the gate ceiling with modest spread.
function score() { return Math.max(0, Math.min(1, 0.8 + (rng() - 0.5) * 0.3)); }
function sample(n) { return Array.from({ length: n }, score); }

function run(n, childrenPerGen, q, generations) {
  let pUnderHalf = 0, total = 0; // p-value calibration: P(p ≤ 0.5) should ≈ 0.5
  let genWithFalseDiscovery = 0;
  let lower95Promotions = 0; // how often the raw lower95>0 gate fires under null
  for (let g = 0; g < generations; g++) {
    const pvals = [];
    for (let c = 0; c < childrenPerGen; c++) {
      const parent = sample(n), child = sample(n); // SAME distribution → true null
      const b = bootstrapDelta(parent, child, { seed: (g * 131 + c * 17) >>> 0, samples: 2000, minDelta: 0.05 });
      pvals.push(b.pValue);
      total += 1; if (b.pValue <= 0.5) pUnderHalf += 1;
      if (b.lower95 > 0) lower95Promotions += 1;
    }
    if (benjaminiHochberg(pvals, q).some(Boolean)) genWithFalseDiscovery += 1;
  }
  return {
    n, childrenPerGen, q, generations,
    pCalibration_PleHalf: +(pUnderHalf / total).toFixed(3), // want ≈ 0.5
    rawLower95FalsePositiveRate: +(lower95Promotions / total).toFixed(4), // per-comparison gate under null
    bhEmpiricalFDR: +(genWithFalseDiscovery / generations).toFixed(4), // want ≤ q
    bhControlled: genWithFalseDiscovery / generations <= q + 3 * Math.sqrt((q * (1 - q)) / generations),
  };
}

const out = [];
for (const n of [3, 5, 10]) out.push(run(n, 8, 0.05, 20000));
console.log(JSON.stringify({
  question: 'Are bootstrap p-values calibrated at small n, and does BH control FDR on them?',
  results: out,
}, null, 2));
