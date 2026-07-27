# Backlog: Sugarlang Spanish Morphology Coverage Gap

**Source:** Variant bake verification false-positive investigation (2026-07-27)  
**Affects:** Epic 083 ratio gate, Epic 087 directed live render gate (same code path)

## Problem

The Spanish morphology data (`data/languages/es/morphology.json`) only contains
infinitives, gerunds, and past participles for verbs, and masculine singular forms
for demonstratives. Conjugated finite forms are largely absent.

Examples of common forms that are MISSING:
- `creo`, `crees`, `cree`, `creemos`, `creen` (creer)
- `estoy`, `estas`, `esta`, `estamos`, `estan` (estar -- only infinitive present)
- `tengo`, `tiene`, `tienes` (tener)
- `quiero`, `quiere`, `puede`, `puedo`, `hago`, `hace`, `digo`, `dice`, etc.
- `esa`, `esas` (ese -- only masculine `ese` present)
- `señora` (only `señor` present)

## Impact

The ratio gate (`computeLanguageRatioVerdict`) counts a token as Spanish only if
`lemmatize()` resolves it. Missing morphology entries fall to `unknownTokens`,
reducing `resolvedTargetLanguageTokens / ratioCheckTokens`. A fully correct B1+
Spanish sentence like "Creo que esa señora esta bastante molesta." measures ~43%
when it is 100% Spanish, tripping the 48% fail floor for target-dominant posture.

This will false-flag a large fraction of good baked variants AND good directed live
renders (epic 087 runs the same gate). False positives erode author trust in the
bake pipeline.

## Action

**Plan an epic** to audit and expand Spanish (and Italian) morphology coverage.
Research options before writing the epic:
- Size the gap: what % of tokens in a representative B1 corpus are currently
  unresolvable?
- Evaluate data sources: Wiktionary dumps, Unimorph, SpaCy `es_core_news_sm`
  lemma tables, or a script that generates paradigm expansions from the existing
  infinitive entries.
- Decide whether to expand the static JSON, swap to a lightweight runtime
  lemmatizer, or combine both (static for known-high-frequency, fallback to
  runtime).
- Consider Italian in the same pass -- likely has the same structural gap.

**Do not write the epic until the research is done.**
