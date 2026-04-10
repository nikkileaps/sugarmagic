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
