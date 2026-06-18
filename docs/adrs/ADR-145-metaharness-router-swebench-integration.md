# ADR-145: Integrate `@metaharness/router` into the SWE-bench solver + add `model` as an evolvable surface

**Status**: Proposed (roadmap — not yet implemented; deferred behind the ADR-144 full-300 baseline)
**Date**: 2026-06-18
**Project**: `ruvnet/agent-harness-generator`
**Related**: ADR-040 (DRACO routing → `@metaharness/router`), ADR-135 (SWE-fix model frontier), ADR-136/137 (model-as-gene, ad-hoc), ADR-143 (closed-loop repair), ADR-142/144 (SWE-bench Lite numbers)

> The user's observation: the metaharness already ships a learned cost-optimal **router** (`packages/router`, `@metaharness/router`), and the SWE-bench solver currently **fixes one model (`deepseek-chat`) for every instance**. Routing each instance to the *cheapest model good enough for it* — and making that routing policy an **evolvable surface** — is squarely the metaharness thesis and a measured Pareto lever. This ADR captures the integration so a later loop can execute it without re-deriving it. **Nothing here is implemented yet; no routed number is claimed until a real run exists (per ADR-098).**

## Context — what exists today

1. **`@metaharness/router`** (`packages/router`, productized from DRACO ADR-040): a dependency-free learned router. Given candidate models with a price and a few labelled examples (`query embedding → which candidate was good enough`), it routes each query to the cheapest sufficient model. DRACO showed it **beat the best fixed model** and the gap to the per-query oracle shrinks monotonically with training data.
2. **The SWE-bench solver** (`bench/swebench/solve.mjs`, `solve-repair.mjs`): contextBuilder + symbol-index selection + search/replace, with **`deepseek-chat` hard-wired for all 300 instances**. ADR-135 found deepseek is the best *fixed* choice, but per-instance the frontier differs (gpt-5-mini resolved instances deepseek missed, and vice-versa).
3. **Darwin's genome has 7 surfaces** (planner, contextBuilder, reviewer, retryPolicy, toolPolicy, memoryPolicy, scorePolicy) — **no model/router surface**. ADR-136/137 evolved `model` only as an *ad-hoc bench-experiment gene*, never as a first-class evolvable surface.

## Decision (deferred plan)

**Part A — per-instance routing in the solver (cheap, high-leverage).**
Replace the fixed `model: 'deepseek-chat'` with a `Router` call: embed the problem statement (+ repo + selected-file signals) → route to the cheapest candidate above a learned quality threshold. Candidates: `deepseek-chat` (floor, $0.4/Mtok), `gpt-5-mini`, a frontier model for the hardest. **The full-300 run (ADR-144) is the training set**: each instance already yields a label (`embedding → did model X resolve it`), so the router can be trained on real SWE-bench outcomes, not synthetic data. Expected win: same-or-higher resolve-rate at lower blended cost (route the easy 80% to deepseek, escalate only the hard tail).

**Part B — `model`/`router` as Darwin's 8th surface (the metaharness integration proper).**
Add a `modelPolicy` surface to the genome whose phenotype *is* a routing policy (candidate set + thresholds). Then `evolve()` optimizes the router **against the real SWE resolve-rate fitness** (ADR-130/143) — the router policy mutates, crossover recombines candidate sets, and MAP-Elites preserves per-model niches (exactly the machinery ADR-140/141 validated). This makes "which model, when" an evolved outcome, closing the loop between the router product and the evolutionary engine.

**Part C — wire the `metaharness_*` MCP tools** (`metaharness_genome`, `metaharness_score`, `metaharness_similarity`) as an optional scoring/feature backend, so the router's quality estimates and the genome's descriptors share one substrate.

## Honest constraints (why it is deferred, not done)

- **Needs the ADR-144 baseline + per-model labels first.** Routing is only meaningfully trainable once we have per-instance resolve outcomes for ≥2 models on the full 300. ADR-142/143 give 25; ADR-144 gives 300 for deepseek. A second model's full-300 pass (≈$3 + Docker) produces the contrastive labels the router needs.
- **Per-instance LLM cost variance** and the n-noise of ADR-138 apply: the router's measured lift must clear the same Wilson-CI bar, on a held-out split, before it is claimed.
- **No new benchmark number is claimed here.** This is a signpost; the shipped solver remains fixed-deepseek until a routed run beats it on a held-out set with a real CI.

## Consequences

- A later loop can execute: (1) get the ADR-144 deepseek baseline; (2) run a second model (e.g. gpt-5-mini) on the full 300 → contrastive labels; (3) train `@metaharness/router` on those labels; (4) evaluate the routed solver on a held-out split vs fixed-deepseek; (5) if it wins, promote routing to default and add `modelPolicy` as the 8th evolvable surface.
- This unifies three previously-separate threads: the **router product** (ADR-040), the **SWE-bench solver** (ADR-142+), and the **evolutionary engine** (ADR-130–141).

## Status note

Deferred by design. Revisit after ADR-144 (the full-300 baseline) lands, when the per-instance outcome labels exist to train the router. Start with Part A (solver-level routing on real labels) before Part B (the evolvable surface).
