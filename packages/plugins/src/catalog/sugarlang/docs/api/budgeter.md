# Budgeter API

Status: Updated in Epic 8

This document records the runtime surface the Lexical Budgeter owns.

## Core Types

- `LemmaRef`
- `LexicalBudget`
- `LexicalPriorityScore`
- `LexicalRationale`
- `LexicalPrescription`
- `LexicalPrescriptionInput`

`LexicalPrescriptionInput` now also accepts `activeQuestEssentialLemmas?: QuestEssentialLemma[]`
so the Budgeter can exclude quest-essential vocabulary from normal
introduce/reinforce/avoid slots.

## FSRS Adapter

`runtime/budgeter/fsrs-adapter.ts` is the only sugarlang module that imports
`ts-fsrs`.

It owns:

- `createFsrsEngine()`
- `lemmaCardToFsrsCard()` and `fsrsCardToLemmaCard()`
- `applyOutcome()`
- `decayProductiveStrength()`
- `seedCardFromAtlas()`
- `commitProvisionalEvidence()`
- `discardProvisionalEvidence()`
- `decayProvisionalEvidence()`

This keeps the external scheduler behind a sugarlang-owned card shape so the
rest of the plugin never depends on `ts-fsrs` directly.

Productive-strength decay is explicit and tunable through:

- `PRODUCTIVE_DECAY_HALF_LIFE_DAYS = 60`
- `PRODUCTIVE_DECAY_LOW_STRENGTH_MULTIPLIER = 2`

Re-exported provisional-evidence constants:

- `PROVISIONAL_EVIDENCE_MAX`
- `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`

## Observation -> Outcome Mapping

`runtime/budgeter/observations.ts` is the single observation interpretation
table. It exports:

- `PRODUCTIVE_DELTAS`
- `PROVISIONAL_DELTA_CAP`
- `computeProvisionalEvidenceDelta()`
- `observationToOutcome()`
- `observationToFsrsGrade()`

Canonical mapping:

- `encountered` -> `receptiveGrade: null`, `productiveStrengthDelta: 0`, `provisionalEvidenceDelta: 0`
- `rapid-advance` -> `receptiveGrade: null`, `productiveStrengthDelta: 0`, `provisionalEvidenceDelta: dwell-based`
- `hovered` -> `"Hard"`, `-0.05`, `0`
- `quest-success` -> `"Good"`, `0`, `0`
- `produced-chosen` -> `"Good"`, `+0.15`, `0`
- `produced-typed` -> `"Easy"`, `+0.30`, `0`
- `produced-unprompted` -> `"Easy"`, `+0.50`, `0`
- `produced-incorrect` -> `"Again"`, `-0.20`, `0`

The important regression guard is `rapid-advance`: it no longer advances FSRS
stability directly. It only accumulates provisional evidence.

## Scoring

`runtime/budgeter/scoring.ts` exports the named weights:

```ts
SCORING_WEIGHTS = {
  w_due: 1.0,
  w_new: 0.7,
  w_anchor: 0.5,
  w_prodgap: 0.6,
  w_lapse: 0.3,
}
```

Formula:

```txt
score =
  + w_due     * (1 - retrievability)
  + w_new     * priorWeight
  + w_anchor  * isSceneAnchor
  + w_prodgap * max(0, stability - productiveStrength)
  - w_lapse   * highLapsePenalty
```

`w_prodgap` is the explicit receptive-vs-productive bridge. A learner who
recognizes `llave` with `stability=0.85` but has `productiveStrength=0.0`
contributes `0.6 * 0.85 = 0.51` through the productive-gap term alone, making
that lemma a strong reinforce candidate.

## Prescribe Funnel

`LexicalBudgeter.prescribe(input)` is deterministic and read-only. It runs:

1. Quest-essential exclusion
2. Scene gate
3. Envelope gate
4. Priority scoring
5. Partition into `introduce` / `reinforce` / `avoid`
6. Optional anchor selection
7. Rationale assembly

Level caps:

- `A1 -> 1`
- `A2 -> 2`
- `B1 -> 3`
- `B2+ -> 4`

The Budgeter reads learner state but never writes it. All learner-state writes
remain in `LearnerStateReducer`.

## Rationale

Every prescription carries a `LexicalRationale` with:

- `candidateSetSize`
- `envelopeSurvivorCount`
- `priorityScores`
- `summary`
- `levelCap`
- `chosenIntroduce`
- `chosenReinforce`
- `droppedByEnvelope`
- `questEssentialExclusionLemmaIds`

The summary is deterministic template text, not an LLM output.

## Language Data Consumed

The Budgeter does not read morphology or placement banks directly. Its language
data dependency is the lexical atlas:

- `data/languages/<lang>/cefrlex.json`

The atlas provides CEFR priors, frequency ranks, and glosses through
`CefrLexAtlasProvider`.
