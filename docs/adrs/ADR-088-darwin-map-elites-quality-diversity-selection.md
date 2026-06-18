# ADR-088: Darwin Mode — MAP-Elites quality-diversity selection

**Status**: Accepted (implemented)
**Date**: 2026-06-18
**Project**: `ruvnet/agent-harness-generator`
**Related**: ADR-073 (archive + score-based selection), ADR-072 (scorer ceiling), ADR-077 (DGM open-endedness), ADR-086 (efficiency tie-break), ADR-087 (graded promotion)

> ADR-073 selects stalled-generation parents by top `finalScore`. Because the ADR-072 scorer ceilings at 0.985, "top finalScore" is a flat tie broken by insertion order — so the two parents are routinely the *same* mutation surface, and the search collapses onto one niche. This ADR adds opt-in MAP-Elites selection: keep the elite per behaviour niche so exploration stays diverse.

## Context

DGM's open-endedness (ADR-077) comes from keeping an **archive of diverse** agents and seeding from varied stepping stones, not from hill-climbing a single best. ADR-073 retains the whole tree (good) but its `selectParents` ranks purely by `finalScore`. At the 0.985 ceiling every safe variant ties, so `selectParents(2)` returns the two earliest-inserted scored variants — frequently both mutating the same surface. The result: generations drift toward whichever surface happened to be explored first, and the other six surfaces starve. Quality without diversity.

## Decision

Add `Archive.selectElites(limit, descriptorOf?)` — a pure MAP-Elites elite map:

- Bin scored records by a **behaviour descriptor** (default: `variant.mutationSurface`, the natural 7-way niche axis).
- Keep the **best** record per bin (highest `finalScore`; ties by earliest insertion — deterministic).
- Return up to `limit` bin-champions ordered by score.

Wire it into `evolve()` behind `EvolutionConfig.selection?: 'score' | 'quality-diversity'` (default **`'score'`** — ADR-073 behaviour, all tests unchanged). When `'quality-diversity'`, the stalled-generation fallback uses `selectElites(2)` so the two parents come from **distinct niches**, keeping surface exploration broad. CLI: `evolve --selection quality-diversity`.

The change is deterministic (no wall-clock), so even the opt-in path is reproducible — unlike the `'faster'` tie-break (ADR-086), this one is safe to combine with reproducibility guarantees.

## Consequences

- Opt-in runs explore all seven surfaces instead of collapsing onto the first-explored one — the diversity half of quality-diversity, which is what makes archive-based evolution find non-obvious harness improvements (DGM, ADR-077).
- `descriptorOf` is injectable, so richer niches (surface × cost-tier × generation band) are a one-line change later without touching the archive's core.
- Promotion (ADR-087), efficiency tie-break (ADR-086), and niche diversity (this) are now three orthogonal, independently-toggled selection refinements over the same retained archive.

## Validation

`packages/darwin-mode` — 299 tests (was 295; +4): `selectElites` returns distinct-niche champions, keeps the highest scorer within a niche (ties → insertion), the explicit contrast that `selectParents(2)` returns same-surface duplicates where `selectElites(2)` spans two niches, and `limit <= 0 ⇒ []`. Default-path suites unchanged and green.
