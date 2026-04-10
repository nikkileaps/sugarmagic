# Classifier API

Status: Updated in Epic 3; expanded further in Epic 5

This document records the public type surface owned by the deterministic
Envelope Classifier.

## Core Types

- `CoverageProfile`: per-turn coverage statistics including token counts, CEFR histogram, out-of-envelope lemmas, quest-essential matches, and coverage ratio.
- `EnvelopeViolation`: per-lemma violation detail with lemma ref, surface form, CEFR band, and reason.
- `EnvelopeRuleOptions`: rule inputs for prescription, named-entity allowlists, and quest-essential exemptions.
- `EnvelopeVerdict`: final classifier output with `withinEnvelope`, `profile`, `worstViolation`, rule label, full violations, and exemption attribution.
- `EnvelopeRule`: the deterministic rule function signature.

## Exemption Channels

Epic 3 locks in the three exemption kinds that later classifier work must preserve:

- `prescription-introduce`
- `named-entity`
- `quest-essential`

## Language Data Consumed

Epic 4 gives the classifier two plugin-owned data files per language:

- `data/languages/<lang>/morphology.json`
  - Loaded through `runtime/classifier/morphology-loader.ts`
  - Current checked-in snapshots expose 7,203 Spanish forms and 2,883 Italian forms
- `data/languages/<lang>/simplifications.json`
  - Loaded through `runtime/classifier/simplifications-loader.ts`
  - Supplies deterministic lower-band substitutions or gloss fallbacks

The loader discipline is fail-fast: missing or malformed data throws during load
instead of silently degrading to an empty lookup table.

## Coverage Notes

- Spanish currently ships a real ELELex-backed atlas, with explicit smoke coverage for `corriendo -> correr`.
- Italian ships a real Kelly-backed atlas with frequency-derived backfill for Kelly rows that lack CEFR points, with explicit smoke coverage for `correndo -> correre`.
