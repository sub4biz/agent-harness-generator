# ADR-098: Darwin Mode — external-benchmark targeting strategy (SWE-bench / robustness race)

**Status**: Proposed (FUTURE — deferred, not yet implemented)
**Date**: 2026-06-18
**Project**: `ruvnet/agent-harness-generator`
**Related**: ADR-076 (bench layer), ADR-090 (risk budget), ADR-094 (clade), ADR-096 (FDR), ADR-097 (curriculum)

> Captured at the user's request ("add adr and do later in the loops"). This is a **strategy/roadmap** ADR — a deferred plan, not a shipped capability. It records HOW Darwin Mode would target public agentic benchmarks so a later loop can execute it without re-deriving the approach. Nothing here is implemented yet; do not claim benchmark results until a real run exists.

## Context

Frontier models (Claude Fable 5, GPT-5.4-class) win static public benchmarks on scale + inference-time reasoning. Darwin Mode cannot out-scale them. Its differentiator is **robustness on out-of-distribution, long-horizon, multi-file work** and an **auditable, statistically-gated, recursive lineage** — a scientific product with provenance, not a black box.

## Decision (deferred plan)

When a future loop targets external benchmarks, do it in this order:

1. **Validation Harness first (de-risk before the real test).** Build a synthetic ~50-file repository stress-test that exercises context management and sustained architectural consistency over 50+ sequential steps — the regime where agents "lose the thread". Verify Darwin's loop holds state before exposing it to a real benchmark. *(Recommended starting point — cheaper and faster than the full set.)*
2. **`BenchmarkRunner` adapter.** Conform the harness to a standard runner contract (e.g. SWE-bench Verified task format: a repo + a failing test + the patch target) so results are apples-to-apples. Each task maps onto a `BenchmarkTask` (ADR-076) with real public/hidden/regression commands.
3. **Target SWE-bench Verified** as the primary "agentic-ness" benchmark (multi-file repo modification — where Poincaré steering + clade metaproductivity should shine). Use the curriculum (ADR-097) to ladder from single-file to multi-file tasks.
4. **Statistical provenance as the headline.** Log the bootstrap **p-value** (ADR-096) of every solve. The SOTA-beating signal is not a raw score but: "Darwin solved issue X with a statistically-real, FDR-controlled, reproducible lineage, and here is the audit trail" — robustness + provenance, not a leaderboard sprint.

## Honest constraints (why it is deferred)

- Requires real benchmark datasets + toolchains not present in the current environment, and substantial sandbox/runner work.
- Data-contamination claims about public sets must be verified, not asserted.
- No benchmark numbers may be reported until a real, reproducible run exists — the project's standing rule (no fabrication).

## Consequences

- A later loop can pick this up directly: build the validation harness → adapter → SWE-bench Verified subset → report with p-values.
- Until then, this ADR is a signpost only; the shipped system (ADR-070…097) stands on its own as an auditable evolutionary engine.

## Corpus-sourcing finding (2026-06-18, after ADR-120/121)

ADR-120/121 proved every *link* of the SWE loop on this package's real code (real contextBuilder selection of 21 real files → real LLM fix → real `vitest` oracle, $0.004). The natural next step was a cheap corpus of **genuinely-historical** bugs mined from this repo's own git history (find a commit that fixed a source bug + added a test that catches it, revert the source, run the loop). **That mining was attempted and does not work on this repo**, which sharpens the corpus requirement:

- The only fix-commits with associated tests are **behavioral or determinism-hardening**, not revertable unit bugs:
  - `67ee901` (FDR small-n guard, ADR-112) — a `suite.tasks.length >= 5` guard in `evolve.ts`; no unit test asserts the skipped-FDR path, so a revert trips nothing.
  - `9d4312b` (sibling-diversity nonce, ADR-104) — a mutation-direction fix in `mutator.ts`; caught by an *experiment* (ADR-103), not a unit assertion.
  - `be4364b` (`round6` score reproducibility) — kills sub-ε float noise/`-0`; but `scorer.test.ts`/`reproducibility.e2e.test.ts` assert clean canonical values (`toBe(1)`) and strip the volatile term, so reverting `round6` does **not** reliably fail them.
- **Conclusion:** a self-hosted historical corpus is not viable here — this package fixed bugs *behaviorally* (verified by ADRs/experiments) and shipped features with already-correct tests. The ADR-098 corpus **must come from external repos** whose fix-commits pair a source bug with a test that fails on revert (exactly the SWE-bench Verified shape in step 3). This is no longer a maybe: it is the confirmed reason the build needs an external dataset + budget, not just "bandwidth".

## Status note

Deferred by design. Revisit when the loop has bandwidth for benchmark integration and a target dataset is available. Start with step 1 (the synthetic 50-file validation harness). Per the 2026-06-18 finding above, the historical-corpus path requires **external** repos — do not attempt to mine this package's own history for revert-tasks.
