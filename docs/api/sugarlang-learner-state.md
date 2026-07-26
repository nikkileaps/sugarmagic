# API 012: Sugarlang Learner State

## Purpose

This document covers Sugarlang's learner model: the profile shape, where each
piece lives (and what survives a reload), the Bayesian CEFR posterior with the
post-placement calibration window, and the dev-only band override contract.

## Learner Profile Shape

**File:** `packages/plugins/src/catalog/sugarlang/runtime/contracts/learner-profile.ts`

```typescript
interface LearnerProfile {
  learnerId: LearnerId;             // "<playerEntityId>:<target>:<support>"
  targetLanguage: string;
  supportLanguage: string;
  assessment: LearnerAssessment;    // status: unassessed | estimated | evaluated
  estimatedCefrBand: CEFRBand;      // "A1".."C2"
  cefrPosterior: CefrPosterior;     // per-band { alpha, beta } Beta weights
  lemmaCards: Record<string, LemmaCard>;  // FSRS receptive + productive state
  currentSession: CurrentSessionSignals | null;
  sessionHistory: SessionRecord[];  // last 20
}
```

`LemmaCard` carries FSRS scheduling fields (`difficulty`, `stability`,
`retrievability`, `lastReviewedAt`, `reviewCount`, `lapseCount`), the CEFR
prior (`cefrPriorBand`, `priorWeight`), productive knowledge
(`productiveStrength`, `lastProducedAtMs`), and the probe pipeline's
provisional-evidence pair (`provisionalEvidence`, capped at 5, and
`provisionalEvidenceFirstSeenTurn`).

The `learnerId` is built in `runtime/runtime-services.ts` as
`${playerDefinition.definitionId}:${targetLanguage}:${supportLanguage}`, so
each language pair gets its own profile and card store.

## Where State Lives, and What Survives Reload

Two storage tiers, split in
`packages/plugins/src/catalog/sugarlang/runtime/learner/persistence.ts`:

1. **Profile core (everything except `lemmaCards`)** -- a blackboard fact,
   `sugarlang.learner-profile` (entity scope, defined in
   `runtime/learner/fact-definitions.ts`). The fact is declared with
   `lifecycle: { kind: "persistent" }`, but the blackboard `persistent` tag is
   inert -- it only survives session-clear, not a page reload (see the comment
   in `packages/runtime-core/src/state/blackboard.ts`: "The blackboard
   `persistent` lifecycle tag is inert (survives only session-clear)").
   Sugarlang has no `SaveParticipant`, and the cross-plugin `GameSave`
   contract explicitly excludes per-plugin learner state
   (`packages/runtime-core/src/save/index.ts` boundary note).

2. **Lemma cards** -- `IndexedDBCardStore`
   (`runtime/learner/card-store.ts`), IDB database
   `sugarlang-card-store:<learnerId>`, object store `lemma-cards` keyed by
   `lemmaId`, paged at 250 cards. Falls back to `MemoryCardStore` when
   `indexedDB` is unavailable.

Consequences on reload:

- **Survives:** every `LemmaCard` (FSRS history, productive strength,
  provisional evidence), plus the Studio telemetry archive
  (`sugarlang-telemetry` IDB).
- **Does not survive:** the CEFR posterior, `estimatedCefrBand`, the
  `assessment` record (placement result and confidence), session signals, and
  the placement-status fact (`sugarlang.placement-status`, also
  blackboard-only). A fresh session reseeds the profile core from
  `createEmptyLearnerProfile` + the prior provider, then merges the persisted
  cards back in via `loadLearnerProfile`.

**Single writer:** `LearnerStateReducer`
(`runtime/learner/learner-state-reducer.ts`) is the only supported mutation
path. It serializes events on an internal queue, loads the profile, applies
one `ReducerEvent` (`observation`, `placement-completion`, `session-start`,
`session-end`, `self-report`, `commit-/discard-/decay-provisional-evidence`),
persists changed cards + the fact, and emits `learner-profile.updated`.
The read side is `BlackboardLearnerStore`
(`runtime/providers/impls/blackboard-learner-store.ts`).

## CEFR Posterior

**File:** `packages/plugins/src/catalog/sugarlang/runtime/learner/cefr-posterior.ts`

Each band A1..C2 holds an independent Beta weight `{ alpha, beta }`:

- `createUniformCefrPosterior()` -- Beta(1,1) everywhere (unassessed prior).
- `seedCefrPosteriorFromSelfReport(band)` -- Beta(2,1) on the reported band.
- `seedCefrPosteriorFromPlacement(band, confidence)` -- concentration
  `c = clamp(round(confidence * 8), 1, 8)`, giving Beta(1+c, 1) on the placed
  band. The ceiling of 8 is deliberate: it keeps the seeded evidence share
  `(1+c)/(6+c)` below the 0.65 calibration close threshold, so the window
  cannot close on the first observation regardless of content.
- `updatePosterior(posterior, band, success, weight)` -- success adds `weight`
  to alpha, failure adds it to beta.
- `computePointEstimate` -- normalizes per-band means into masses and returns
  the argmax band + its mass as confidence.
- `computeEvidenceShare(posterior, band)` -- raw alpha share
  (`alpha_band / sum(alpha)`), prior and seed included. Used ONLY inside the
  calibration window: unlike the normalized-mean masses (which cap well below
  0.65 while any band is unobserved), this is a true 0..1 scale that can
  cross the close threshold under a realistic weighted stream. Failures
  increment beta only, so they never inflate a band's share.

On placement completion the reducer sets
`assessment = { status: "evaluated", evaluatedCefrBand, cefrConfidence,
evaluatedAtMs }`, re-seeds the posterior from the placement result (the
window starts from what placement concluded, not from any self-report seed),
writes the placement-status fact, and seeds cards for lemmas the player
produced in free text during placement (`fsrs.seeded-from-placement`).

## Post-Placement Calibration Window

**File:** `packages/plugins/src/catalog/sugarlang/runtime/learner/calibration-window.ts`
-- the single definition; `teacher/calibration-mode.ts` re-exports it for the
Director's hint surface. Do not duplicate the predicate.

```typescript
CALIBRATION_CONFIDENCE_CEILING = 0.65
CALIBRATION_TURN_BACKSTOP = 10
CALIBRATION_OBSERVATION_WEIGHT = 3

isInPostPlacementCalibration(learner) ==
  assessment.status === "evaluated" &&
  assessment.cefrConfidence < 0.65 &&
  (currentSession?.turns ?? 0) < 10
```

Reducer semantics while the window is open
(`learner-state-reducer.ts`, observation path):

- Graded observations (receptive grade Good/Easy = success, Again/Hard =
  failure; ungraded observations are skipped) update the posterior on the
  card's `cefrPriorBand` with weight **3** instead of 1. The weight applies
  only to the Bayesian posterior -- ts-fsrs card scheduling is untouched.
- `estimatedCefrBand` follows the point estimate each update.
- `assessment.cefrConfidence` is recomputed as the **evidence share** of the
  point-estimate band (not the normalized mass), so confidence climbs on
  consistent evidence.
- When the predicate flips closed after an update, the reducer emits
  `calibration.window-closed` with `closeReason` `"confidence"` (share
  reached 0.65) or `"turn-backstop"` (turn 10 hit first), plus
  `placementBand`, `settledBand`, `bandDelta`, `settledConfidence`,
  `sessionTurn`.

Outside the window with `status === "evaluated"`, the evaluated confidence is
frozen: observations still move the posterior and `estimatedCefrBand`, but
`assessment.cefrConfidence` is not rewritten.

## Debug Band Override (dev-only)

Two entry points, one mechanism: a synthetic `PlacementCompletionEvent`
through the normal reducer path, so the override exercises the same seeding
code as real placement. Both are gated on `import.meta.env.DEV` and are
absent from published builds.

### 1. Plugin config: `debugBandOverride`

- Declared in `pluginSettingsSchema` in
  `packages/plugins/src/catalog/sugarlang/manifest.ts` as a select
  ("Band Override (dev)"): `""` (off -- normal placement flow) or
  `A1`..`C2`. Normalized in `config.ts`
  (`normalizeDebugBandOverride`; invalid values collapse to `""`).
- Applied in `SugarlangRuntimeServices.resolveForExecution`
  (`runtime/runtime-services.ts`): on first service resolution per language
  pair, when `import.meta.env.DEV` and the override is set, it applies
  `{ type: "placement-completion", cefrBand: <override>, confidence: 1.0,
  lemmasSeededFromFreeText: [] }` and pins the band. A published build
  ignores a `debugBandOverride` left set in config (the DEV guard, not the
  config value, is the gate).

### 2. `window.__sugarlangDebug`

Installed in the plugin `init` hook (`manifest.ts`) under the same DEV guard
as `__sugarmagicDebug`:

```javascript
__sugarlangDebug.setBand("B1")       // synthetic placement completion at B1
__sugarlangDebug.setBand("B1", true) // same, plus pin
__sugarlangDebug.pin("B1")           // setBand with pin=true
__sugarlangDebug.reset()             // wipe learner state (see below)
__sugarlangDebug.getState()          // SugarlangDebugState snapshot
```

- `getState()` returns `{ estimatedCefrBand, assessmentStatus,
  cefrConfidence, placementStatus, inCalibration, pinned, pinnedBand }`.
- **Pinning:** the reducer takes a `debugPinnedBand` callback; while a band
  is pinned, observation-driven posterior and `estimatedCefrBand` updates are
  suppressed entirely (FSRS card scheduling and session accumulators still
  run). This keeps the band stable during automated verification sessions.
- `reset()` clears the `sugarlang.learner-profile` and
  `sugarlang.placement-status` blackboard facts and deletes every IDB
  database whose name starts with `sugarlang-card-store` or
  `sugarlang-telemetry` -- a full return to cold start.
