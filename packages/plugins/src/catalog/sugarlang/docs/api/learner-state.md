# Learner State API

Status: Updated in Epic 11

This document records the runtime learner-state model owned by sugarlang.

## Core Types

- `CEFRBand`
- `LearnerId`
- `CefrPosteriorBandWeight`
- `CefrPosterior`
- `LemmaCard`
- `CurrentSessionSignals`
- `SessionRecord`
- `LearnerAssessment`
- `LearnerProfile`

## Blackboard Facts Owned by Sugarlang

- `LEARNER_PROFILE_FACT`
  Scope: `entity`
  Lifetime: `persistent`
  Writer: `sugarlang.learner-state`
- `SUGARLANG_PLACEMENT_STATUS_FACT`
  Scope: `global`
  Lifetime: `persistent`
  Writer: `sugarlang.placement`
- `LEMMA_OBSERVATION_FACT`
  Scope: `conversation`
  Lifetime: `frame`
  Writer: `sugarlang.observer`

Sugarlang registers those facts by exposing them through the plugin instance's
`blackboardFactDefinitions` surface. The runtime blackboard is constructed once
with the built-in facts plus plugin-owned facts, so there is no second runtime
registry to drift out of sync.

## Bayesian CEFR Estimation

`runtime/learner/cefr-posterior.ts` is the single implementation for CEFR
posterior math.

- `createUniformCefrPosterior()` seeds each band with `alpha=1, beta=1`
- `seedCefrPosteriorFromSelfReport(band)` gives the self-reported band one extra
  pseudo-observation with `alpha=2, beta=1`
- `updatePosterior(posterior, band, success)` immutably increments `alpha` on
  success or `beta` on failure
- `computePointEstimate(posterior)` returns the argmax band plus normalized
  confidence
- `computeExpectedBand(posterior)` returns the continuous expected band index
  where `A1=0 ... C2=5`

## Receptive vs. Productive

`LemmaCard` deliberately separates:

- `stability`: receptive FSRS-style memory strength
- `productiveStrength`: active production ability

It also carries provisional skim-past evidence:

- `provisionalEvidence`
- `provisionalEvidenceFirstSeenTurn`

Rapid-advance observations accumulate provisional evidence without changing
receptive stability. Only a later commit event converts that evidence into a
real FSRS-style review update.

## Session Signals

`runtime/learner/session-signals.ts` owns the transparent fatigue formula:

```txt
fatigue =
  clamp01(
    0.30 * (turns / 50) +
    0.25 * hoverRate +
    0.25 * retryRate +
    0.20 * (avgResponseLatencyMs / 30000)
  )
```

The weights are exported as named constants:

- `SESSION_FATIGUE_TURN_WEIGHT`
- `SESSION_FATIGUE_HOVER_WEIGHT`
- `SESSION_FATIGUE_RETRY_WEIGHT`
- `SESSION_FATIGUE_LATENCY_WEIGHT`

Budgeter-owned productive-strength decay constants live in
`runtime/learner/fsrs-adapter.ts` and are intentionally named exports:

- `PRODUCTIVE_DECAY_HALF_LIFE_DAYS`
- `PRODUCTIVE_DECAY_LOW_STRENGTH_MULTIPLIER`

## Persistence Layout

`runtime/learner/persistence.ts` splits persistence into two layers:

- learner-profile core JSON via `serializeLearnerProfile()` /
  `deserializeLearnerProfile()`
- lemma-card durability via `CardStore`

`CardStore` is the canonical card-store interface:

- `get(lemmaId)`
- `set(card)`
- `bulkGet(lemmaIds)`
- `bulkSet(cards)`
- `list()`
- `listPage(cursor, limit)`
- `count()`
- `clear()`

Implementations:

- `MemoryCardStore` for tests and for a browser with no storage at all
- the synced card store, which keeps a learner's words in per-player storage so
  they follow the player to another device. See
  [per-player data](/docs/api/per-player-data.md).
- `IndexedDBCardStore` -- direct browser storage, no longer the runtime path

Paging is explicit through `listPage()` and chunked `bulkSet()` writes so large
profiles do not require one monolithic persistence operation.

## Reducer Contract

`LearnerStateReducer` is the only supported writer of `LEARNER_PROFILE_FACT`.
Every mutation must flow through `apply(event)`.

Handled event kinds:

- `session-start`
- `session-end`
- `self-report`
- `placement-completion`
- `observation`
- `commit-provisional-evidence`
- `discard-provisional-evidence`
- `decay-provisional-evidence`

The reducer reads the latest profile, produces a new immutable state, persists
changed cards, and emits telemetry audit events.

The profile core is written to TWO places, and they are not the same kind of
thing. The blackboard copy is what the rest of a session reads, and it lasts as
long as the tab. The durable copy is a per-player record that outlives the tab
and follows the player to another device -- their level, how it was arrived at,
and the evidence behind it. Only the second one makes a returning player a
returning player; before it existed they were re-placed every session.

Cards are NOT copied into the core record: they are records of their own in the
same store, and duplicating them would double every write and give the two
copies a chance to disagree.

## Placement Seeding

On `placement-completion`, the reducer now does more than write the assessment:

- updates `assessment.status`, `assessment.evaluatedCefrBand`,
  `assessment.cefrConfidence`, and `assessment.evaluatedAtMs`
- updates `estimatedCefrBand`
- persists `SUGARLANG_PLACEMENT_STATUS_FACT`
- seeds any `lemmasSeededFromFreeText` into FSRS using a synthetic
  `produced-typed` outcome

That gives cold-start learners a small amount of real productive evidence before
normal gameplay begins.

## Exported Constants

- `INITIAL_PRODUCTIVE_STRENGTH`
- `INITIAL_PROVISIONAL_EVIDENCE`
- `PROVISIONAL_EVIDENCE_MAX`
- `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`
