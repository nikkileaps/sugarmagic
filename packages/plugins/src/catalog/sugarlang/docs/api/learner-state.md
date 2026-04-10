# Learner State API

Status: Updated in Epic 7

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
- `ACTIVE_DIRECTIVE_FACT`
  Scope: `conversation`
  Lifetime: `session`
  Writer: `sugarlang.directive`
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

- `MemoryCardStore` for tests and non-persistent preview fallback
- `IndexedDBCardStore` for durable browser-backed storage

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
changed cards, writes the updated profile back through the blackboard owner id,
and emits telemetry audit events.

## Exported Constants

- `INITIAL_PRODUCTIVE_STRENGTH`
- `INITIAL_PROVISIONAL_EVIDENCE`
- `PROVISIONAL_EVIDENCE_MAX`
- `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`
