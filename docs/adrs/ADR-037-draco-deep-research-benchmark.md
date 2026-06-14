# ADR-037: DRACO — a Cross-Domain Benchmark for Deep Research with OpenRouter Fusion Models

**Status**: Proposed
**Date**: 2026-06-14
**Project**: `ruvnet/agent-harness-generator`
**Supersedes**: none
**Related**: ADR-009 (intelligence pipeline), `vertical:research` template (iter 69), ADR-004 (host integration)

---

## Context

The `vertical:research` template (iter 69) ships a six-agent dossier pod —
scout, web-searcher, source-grader, synthesizer, fact-checker, citer — but the
project has **no objective, reproducible measure of how good the research
harness actually is.** Every other capability has a gate (CodeQL for security,
`host-bench` for config-gen latency, `bench-baseline.mjs` for perf regression),
but "is the deep-research output any good?" is unmeasured. Claims of "the
ultimate research harness" are unfalsifiable without a benchmark.

**DRACO** (Cross-Domain Benchmark for Deep Research) is the gate we are
missing. The goal of this ADR is to define a benchmark that:

1. measures deep-research quality **across domains** (science, finance, law,
   current events, technical) rather than a single subject area,
2. is **reproducible** — same harness + same questions → comparable score, and
3. exploits **model fusion via OpenRouter** — the research harness routes each
   sub-task to the model best suited for it (a cheap model for query
   decomposition, a strong model for synthesis, a skeptical model for
   verification) and fuses their outputs, rather than running one model
   end-to-end.

The user's directive: *"benchmark our system; use DRACO; create the ultimate
research harness with proof."* The operative word is **proof** — a measured,
re-runnable number, not a narrative.

## Decision

Build **DRACO** as a first-class benchmark in `packages/bench/`, driven by an
OpenRouter-backed fusion research harness, gated in CI like every other metric.

### 1. The benchmark corpus

DRACO is a fixed, versioned set of **cross-domain research questions**, each
with a machine-checkable rubric. Stored at `packages/bench/draco/corpus.json`:

```jsonc
{
  "version": 1,
  "questions": [
    {
      "id": "sci-001",
      "domain": "science",
      "prompt": "What is the current scientific consensus on X, and what are the two strongest dissenting positions?",
      "rubric": {
        "must_cite": ["primary-source"],          // ≥1 primary source
        "must_contain": ["consensus", "dissent"],  // both sides present
        "must_not": ["fabricated-citation"],       // verified against fetch
        "grader": "llm-judge"                       // see §3
      }
    }
    // …≥50 questions, ≥5 per domain, 5+ domains
  ]
}
```

The corpus is **the artifact**: versioned, checksummed, never silently mutated.
A score is only comparable against the same corpus version.

### 2. The fusion harness (OpenRouter)

The research harness routes each pipeline stage to a different model via the
OpenRouter API, then fuses:

| Stage | Model class (OpenRouter) | Why |
|---|---|---|
| Decompose question → sub-queries | small/fast (e.g. Haiku-class) | cheap, structural |
| Web search + source collection | tool-use model | retrieval |
| Source grading | mid (Sonnet-class) | judgement, cheap-ish |
| Synthesis | strong (Opus-class / GPT-class) | the load-bearing step |
| Adversarial fact-check | DIFFERENT strong model | independent perspective — fusion's whole point |
| Citation normalisation | small/fast | mechanical |

**Fusion** = the fact-checker is a *different model family* than the
synthesizer, so a single model's blind spot cannot pass its own work. The
harness records which model handled each stage (provenance) in the trajectory.

OpenRouter is the routing layer: one API key, one base URL, model selection per
call. The key is read from **GCP Secret Manager** (`OPENROUTER_API_KEY`) via the
existing `validate-gcp-secrets.mjs` gate (ADR-018, extended in iter 145 to a
secret LIST — DRACO adds `OPENROUTER_API_KEY` to `REQUIRED_SECRETS`).

### 3. Scoring (machine-checkable + LLM-judge)

Each answer is scored on five dimensions, 0–1 each, mean = DRACO score:

1. **Grounding** — every load-bearing claim carries a citation that *resolves*
   (the citer's URLs are re-fetched; a 404 or content-mismatch is a fabricated
   citation → hard 0 on grounding).
2. **Coverage** — rubric `must_contain` terms / concepts present (regex +
   embedding-similarity, not exact match).
3. **Balance** — for questions demanding multiple positions, both present.
4. **Faithfulness** — an independent LLM-judge (a model NOT used in the harness)
   rates whether the synthesis is supported by the cited sources.
5. **Efficiency** — tokens + wall-clock + USD, normalised against a baseline
   (lower is better; reported, not part of the quality mean, but gated for
   regression separately).

The LLM-judge prompt + the judge model are pinned per corpus version for
reproducibility. A `--no-judge` mode runs only the deterministic checks (1–3,5)
for offline CI.

### 4. Proof artifact

A run produces `packages/bench/draco/runs/<iso>.json`:

```jsonc
{
  "corpusVersion": 1,
  "harness": { "fusionModels": { "synthesize": "…", "verify": "…" } },
  "score": 0.0,                 // mean of per-question quality means
  "perDomain": { "science": 0.0, "finance": 0.0, … },
  "perQuestion": [ { "id": "sci-001", "grounding": 0, "coverage": 0, … } ],
  "efficiency": { "tokens": 0, "usd": 0, "wallMs": 0 },
  "judge": { "model": "…", "version": 1 }
}
```

`bench-baseline.mjs` (iter 53) gains DRACO awareness: a run is compared against
the stored DRACO baseline; a quality regression > threshold fails CI. **This is
the proof** — a committed, re-runnable score with per-domain breakdown.

### 5. Surfaces

- `packages/bench/draco/` — corpus, runner, scorer, baseline.
- `npm run bench:draco` (+ `--no-judge`, `--domain=science`, `--n=10`).
- A new harness subcommand `harness draco` runs DRACO against a scaffolded
  research harness and emits the proof JSON (ADR-031 bundle shape).
- CI: a `draco` job (opt-in / scheduled, since it spends real OpenRouter
  tokens) that runs the deterministic subset on every push and the full
  judged run on a cadence, writing the baseline.
- Docs: README "Benchmarks" section gains a DRACO row with the current score.

## Consequences

**Positive**
- "Ultimate research harness" becomes a *number with a per-domain breakdown*,
  re-runnable by anyone — the proof the directive demands.
- Model fusion is measured, not asserted: we can show fusion (different
  verifier model) beats single-model end-to-end on the same corpus.
- Reuses every existing rail: GCP-secret gate, bench-baseline regression,
  ADR-031 bundle, trajectory provenance.

**Negative / risks**
- Real OpenRouter spend per judged run — mitigated by `--no-judge` deterministic
  CI on every push + full judged runs on a cadence only.
- LLM-judge variance — mitigated by pinning judge model + prompt per corpus
  version and reporting deterministic dimensions (grounding/coverage/balance)
  separately from the judged dimension.
- Corpus authorship is the hard part — a weak corpus makes a meaningless score.
  The corpus is versioned and reviewed; v1 ships small (≥50 Q) and grows.

## Implementation plan (horizon-tracked)

This is a multi-session objective owned by the `ruflo-goals:horizon-tracker`
agent (milestone checkpoints, drift detection, progress persistence):

- **M1** — corpus v1 (≥50 cross-domain Q + rubrics) + JSON schema + checksum test.
- **M2** — OpenRouter fusion client (model-per-stage routing, provenance) +
  `OPENROUTER_API_KEY` wired into the GCP-secret gate.
- **M3** — deterministic scorer (grounding via re-fetch, coverage, balance,
  efficiency) + `--no-judge` runner + first baseline.
- **M4** — LLM-judge dimension (pinned model/prompt) + full proof JSON.
- **M5** — `harness draco` subcommand + `bench-baseline` DRACO regression gate +
  CI job + README Benchmarks row with the measured score.
- **M6** — fusion-vs-single-model ablation: prove the different-verifier-model
  design beats single-model end-to-end on the same corpus. **This is the proof.**

Each milestone lands behind tests and a committed artifact, per the ADR-030
Discovery Loop — no milestone is "done" without a re-runnable number.
