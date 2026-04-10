# Budgeter API

Status: Updated in Epic 3; expanded further in Epic 8

This document records the public contract surface the Lexical Budgeter owns.

## Core Types

- `LemmaRef`: lightweight lemma handle shared across sugarlang systems.
- `LexicalBudget`: turn-level cap on new lexical material.
- `LexicalPriorityScore`: scored candidate lemma with attached reason strings.
- `LexicalRationale`: transparent debug/telemetry trace for why a prescription was chosen.
- `LexicalPrescription`: Budgeter output with `introduce`, `reinforce`, `avoid`, optional `anchor`, `budget`, and `rationale`.
- `LexicalPrescriptionInput`: input bundle of learner profile, compiled scene lexicon, and current conversation state.

## Observation -> Grade Mapping

Epic 3 also defines the observation-side types the Budgeter consumes later:

- `ObservationKind`: the eight implicit-signal kinds.
- `ProducedObservationKind`: helper narrowing to `produced-*` kinds.
- `LemmaObservation`: discriminated union over the eight observation shapes.
- `ObservationOutcome`: deterministic mapping output with:
  - `receptiveGrade`
  - `productiveStrengthDelta`
  - `provisionalEvidenceDelta`

This split is how sugarlang keeps receptive FSRS progress separate from productive strength and provisional skim-past evidence. See Proposal 001 § Receptive vs. Productive Knowledge and § Observer Latency Bias.

## Language Data Consumed

The Budgeter does not read morphology or placement banks directly. Its
language-data dependency is the lexical atlas:

- `data/languages/<lang>/cefrlex.json`

The atlas provides CEFR priors, frequency ranks, and glosses through
`CefrLexAtlasProvider`. Epic 4 also makes `atlasVersion` part of the data file so
compile/cache consumers can invalidate when the lexical foundation changes.
