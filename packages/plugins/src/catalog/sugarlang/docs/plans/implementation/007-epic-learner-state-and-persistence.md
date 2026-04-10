# Epic 7: Learner State and Persistence

**Status:** Complete
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Learner State Model](../../proposals/001-adaptive-language-learning-architecture.md#learner-state-model)
**Depends on:** Epic 1 (skeleton), Epic 3 (types), Epic 4 (loaders)
**Blocks:** Epic 8 (Budgeter reads learner state), Epic 9 (Director reads learner state), Epic 10 (middleware writes learner state), Epic 11 (Placement reads and writes learner state)

## Context

The learner state model is the **single source of truth** for what sugarlang knows about a player. It contains a Beta posterior over CEFR bands (the current ability estimate), FSRS cards per lemma (the memory model), session-derived signals (fatigue, hover rate, retry rate), and session history. It is written by exactly one reducer (`LearnerStateReducer`) in response to observation events, and read by every downstream component.

This epic is large because it touches storage, persistence, blackboard facts, and the probability math. It is also load-bearing: if the reducer is wrong, every learning signal is lost or miscounted, and the entire adaptive loop is broken.

The key discipline: **single writer**. Every change to `LEARNER_PROFILE_FACT` flows through the reducer. No other component writes directly. This mirrors the existing blackboard fact `assertWriteAllowed` discipline.

## Prerequisites

- Epic 1 (skeleton)
- Epic 3 (`LearnerProfile`, `LemmaCard`, `CefrPosterior`, `LemmaObservation` types)
- Epic 4 (atlas loaders — needed for initial card seeding from CEFRLex priors)

## Success Criteria

- `LearnerProfile` is defined, seeded, reduced, and persisted end-to-end
- Bayesian CEFR posterior updates correctly on every observation
- FSRS cards are created lazily (on first lemma encounter) and updated in response to observations
- Blackboard facts are defined and wired up
- Single-writer discipline is enforced by test
- IndexedDB card store handles paging for large learner profiles
- API documentation covers the full state model, reducer contract, and persistence layout

## Stories

### Story 7.1: Implement `fact-definitions.ts`

**Purpose:** Declare every sugarlang-owned blackboard fact with the correct scope and lifetime.

**Tasks:**

1. Define `LEARNER_PROFILE_FACT: BlackboardFactDefinition` — scope `"entity"` (keyed by player entity), lifetime `"persistent"`, payload type `LearnerProfile`
2. Define `SUGARLANG_PLACEMENT_STATUS_FACT: BlackboardFactDefinition` — scope `"global"`, lifetime `"persistent"`, payload `{ status: "not-started" | "in-progress" | "completed"; cefrBand?: CEFRBand; confidence?: number; completedAt?: number }`
3. Define `ACTIVE_DIRECTIVE_FACT: BlackboardFactDefinition` — scope `"conversation"`, lifetime `"session"`, payload `PedagogicalDirective` with expiration metadata
4. Define `LEMMA_OBSERVATION_FACT: BlackboardFactDefinition` — scope `"conversation"`, lifetime `"frame"`, payload `LemmaObservation[]` (transient per-frame buffer)
5. Set each fact's `writer` to a well-known writer id so the blackboard's single-writer check enforces it
6. Register all facts at plugin init time via the existing `registerBlackboardFact` API (find exact name during implementation)

**Tests Required:**

- Unit test: each fact definition type-checks against the `BlackboardFactDefinition` interface
- Integration test: writing `LEARNER_PROFILE_FACT` from the reducer's writer id succeeds
- Integration test: writing from any other writer id throws or is rejected
- Integration test: `SUGARLANG_PLACEMENT_STATUS_FACT` defaults to `"not-started"` when read before first write

**API Documentation Update:**

- `docs/api/learner-state.md`: "Blackboard facts owned by sugarlang" section with scope, lifetime, and writer for each fact
- `docs/api/placement-contract.md`: cross-reference the placement status fact schema

**Acceptance Criteria:**

- All facts declared and registered
- Single-writer enforcement works
- Tests pass

### Story 7.2: Implement `cefr-posterior.ts`

**Purpose:** Bayesian CEFR estimation — update the posterior in response to observations and derive the argmax point estimate.

**Tasks:**

1. Implement `createUniformCefrPosterior(): CefrPosterior` — returns `{ A1: {alpha:1, beta:1}, A2: ..., ... }`
2. Implement `seedCefrPosteriorFromSelfReport(band: CEFRBand): CefrPosterior` — returns a posterior with a single pseudo-observation on the self-reported band (alpha = 2, beta = 1 for that band, uniform for others)
3. Implement `updatePosterior(posterior: CefrPosterior, band: CEFRBand, success: boolean): CefrPosterior` — immutable update: `alpha[band] += 1` on success, `beta[band] += 1` on failure. Returns a new posterior object (no mutation).
4. Implement `computePointEstimate(posterior: CefrPosterior): { band: CEFRBand; confidence: number }` — returns the argmax band and the max posterior mass
5. Implement `computeExpectedBand(posterior: CefrPosterior): number` — returns the expected value as a numeric CEFR index (A1=0, A2=1, ..., C2=5) for continuous computations
6. All functions are pure — no state, no randomness

**Tests Required:**

- Unit test: uniform posterior has `confidence ≈ 1/6` (equal across 6 bands) and `expectedBand ≈ 2.5`
- Unit test: after 5 successes on A2, `argmax === "A2"` and `confidence` is meaningfully above 1/6
- Unit test: immutability — calling `updatePosterior(p, ...)` does not mutate `p`
- Property test: `confidence` is always in [1/6, 1]
- Property test: posterior is a valid probability distribution (alphas and betas are positive)

**API Documentation Update:**

- `docs/api/learner-state.md`: Bayesian CEFR section with the math and the point-estimate / expected-band API

**Acceptance Criteria:**

- All unit and property tests pass
- Pure functions, no hidden state

### Story 7.3: Implement `card-store.ts` and `persistence.ts`

**Purpose:** Lemma card storage with paging to avoid loading thousands of cards into a single blackboard fact.

**Tasks:**

1. Define `CardStore` interface:
   - `get(lemmaId: string): Promise<LemmaCard | undefined>`
   - `set(card: LemmaCard): Promise<void>`
   - `bulkGet(lemmaIds: string[]): Promise<Map<string, LemmaCard>>`
   - `bulkSet(cards: LemmaCard[]): Promise<void>`
   - `list(): Promise<LemmaCard[]>` — only used by the debug panel
   - `count(): Promise<number>`
   - `clear(): Promise<void>`
2. Implement `IndexedDBCardStore implements CardStore` — backed by an `IDBObjectStore` keyed by `lemmaId`, namespaced per learner profile id
3. Implement `MemoryCardStore implements CardStore` — `Map<string, LemmaCard>` for tests and for Preview mode without persistent storage
4. Implement `persistence.ts` with:
   - `serializeLearnerProfile(profile: LearnerProfile): string` — JSON serialization of the profile's *core* fields (CEFR posterior, session, etc.) but NOT the cards (cards live in the CardStore)
   - `deserializeLearnerProfile(json: string): LearnerProfile` — parse + validate
   - `loadLearnerProfile(profileId: string, cardStore: CardStore): Promise<LearnerProfile>` — reads core from blackboard, queries card store for cards lazily
   - `saveLearnerProfile(profile: LearnerProfile, cardStore: CardStore): Promise<void>` — writes core to blackboard, writes changed cards to store

**Tests Required:**

- Unit test: round-trip serialization preserves every field
- Integration test: `IndexedDBCardStore` survives simulated reloads (via `fake-indexeddb`)
- Integration test: paging — a profile with 5,000 cards saves and loads in chunks; memory never holds all cards at once during a normal operation like `getBudgeterCandidates`
- Performance test: loading a profile with 5,000 cards completes in < 200ms
- Namespace test: two profiles don't cross-contaminate card stores

**API Documentation Update:**

- `docs/api/learner-state.md`: persistence layer documentation, CardStore interface, paging strategy

**Acceptance Criteria:**

- Persistence round-trips correctly
- Paging keeps memory bounded
- All tests pass

### Story 7.4: Implement `session-signals.ts`

**Purpose:** Derived session signals (fatigue, hover rate, retry rate) — pure functions over recent session events.

**Tasks:**

1. Implement `computeHoverRate(sessionEvents: SessionEvent[]): number` — hovers / lemmas-seen over the current session
2. Implement `computeRetryRate(sessionEvents: SessionEvent[]): number` — verifier retries / turns
3. Implement `computeFatigueScore(session: CurrentSessionSignals): number` — transparent formula: `f(turns, hoverRate, retryRate, avgResponseLatencyMs)` producing a value in [0, 1]. The formula is published in the JSDoc and easy to reason about. For v1:
   ```
   fatigue =
     clamp01(
       0.30 * (turns / 50) +                    // long sessions fatigue
       0.25 * hoverRate +                       // frequent lookups fatigue
       0.25 * retryRate +                       // frequent retries fatigue
       0.20 * (avgResponseLatencyMs / 30000)    // slow responses fatigue
     )
   ```
   The weights are explicit and documented. They are not magic numbers — each is a simple rationale + citation in the JSDoc. The coefficients can be tuned later based on telemetry but are not tuned in v1.
4. All functions are pure

**Tests Required:**

- Unit test: a fresh session has `fatigue === 0`
- Unit test: a session with 50 turns, 50% hover, 50% retry, 30s latency has `fatigue ≈ 1.0`
- Unit test: edge cases (empty sessions, division by zero)
- Transparency test: the weights are exported as constants for audit (a test reads them and asserts they exist)

**API Documentation Update:**

- `docs/api/learner-state.md`: session signals section with the full formula, the weights, and the rationale for each weight

**Acceptance Criteria:**

- All tests pass
- Formula is documented in source and in API doc
- Weights are explicit, named constants

### Story 7.5: Implement `learner-state-reducer.ts`

**Purpose:** The single writer of `LEARNER_PROFILE_FACT`. Applies observations and signals to produce a new `LearnerProfile` state.

**Tasks:**

1. Implement `LearnerStateReducer` class with:
   - Constructor takes `{ profileId, blackboard, cardStore, atlas, learnerPriorProvider }`
   - `async apply(event: ReducerEvent): Promise<void>` — the sole mutation API; every observation/signal change routes through here
   - `ReducerEvent` is a discriminated union: `ObservationEvent | PlacementCompletionEvent | SessionStartEvent | SessionEndEvent | SelfReportEvent | CommitProvisionalEvidenceEvent | DiscardProvisionalEvidenceEvent | DecayProvisionalEvidenceEvent`
   - The three new provisional-evidence events are defined in Proposal 001 § Observer Latency Bias and handled by dedicated helpers (see tasks 8–10 below)
2. On `ObservationEvent`:
   - Map observation → FSRS grade using `observationToFsrsGrade` from Epic 8 (forward declaration; import when Epic 8 lands)
   - Update the lemma's FSRS card via `fsrs-adapter.ts` (Epic 8 scope)
   - Update the CEFR posterior: observe success/failure on the lemma's CEFR band per the rule in `cefr-posterior.ts`
   - Update session signals (turn counter, hover rate, etc.)
3. On `PlacementCompletionEvent`:
   - Write `SUGARLANG_PLACEMENT_STATUS_FACT = "completed"` with the final estimate and confidence
   - Snapshot the learner profile's `assessment` field (`evaluatedCefrBand`, `cefrConfidence`)
4. On `SessionStartEvent`:
   - Reset `currentSession` fields (sessionId, startedAt, counters to 0)
5. On `SessionEndEvent`:
   - Append the current session to `sessionHistory` (cap at 20 entries)
   - Compute and archive final session signals
6. On `SelfReportEvent`:
   - Seed the posterior with the self-reported band
7. Every `apply` call:
   - Reads the current profile from the blackboard
   - Produces a new profile immutably
   - Writes it back to the blackboard (single writer)
   - Writes any changed cards to the CardStore
   - Emits a telemetry event for audit (see Epic 13 for the telemetry sink — stub it for now)
8. On `ObservationEvent` where `obs.kind === "rapid-advance"`:
   - **Do NOT apply an FSRS grade.** The receptive grade from `observationToOutcome` is `null` for rapid-advance per the revised rule table in Epic 8 Story 8.2.
   - Compute `provisionalDelta = computeProvisionalEvidenceDelta(obs.dwellMs)` — a small amount scaled by dwell time (Epic 8 Story 8.2 exports this helper)
   - Call the card's `applyProvisionalEvidence(delta)` helper (Epic 8 Story 8.1) which updates `provisionalEvidence` and sets `provisionalEvidenceFirstSeenTurn` if this is the first provisional bump since the card was fresh
   - Write the updated card through the CardStore
   - Emit `"fsrs.provisional-evidence-accumulated"` telemetry event with the lemma, previous and new evidence, and dwell time (event kind defined in Epic 13 Story 13.1 per the Observer Latency Bias extension)
9. On `CommitProvisionalEvidenceEvent { targetLemmas, probeTelemetry }`:
   - For each lemma in `targetLemmas`:
     - Read the card's current `provisionalEvidence`
     - If > 0, apply an FSRS "Good" grade to `stability` / `retrievability` / `reviewCount` (committing the evidence)
     - Zero the `provisionalEvidence` and `provisionalEvidenceFirstSeenTurn` fields
   - Write each updated card through the CardStore
   - Emit `"fsrs.provisional-evidence-committed"` telemetry for each committed lemma, including the previous evidence amount and the resulting stability delta
10. On `DiscardProvisionalEvidenceEvent { targetLemmas, probeTelemetry }`:
    - For each lemma in `targetLemmas`:
      - Zero the `provisionalEvidence` and `provisionalEvidenceFirstSeenTurn` fields
      - **Do NOT apply any FSRS grade** — the probe failed, we have no positive evidence
    - Write each updated card through the CardStore
    - Emit `"fsrs.provisional-evidence-discarded"` telemetry for each discarded lemma, including the discarded evidence amount
11. On `DecayProvisionalEvidenceEvent { currentSessionTurn }`:
    - For each card in the learner's profile (page through the CardStore):
      - If `provisionalEvidenceFirstSeenTurn !== null` AND `(currentSessionTurn - provisionalEvidenceFirstSeenTurn) > PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`:
        - Zero the `provisionalEvidence` and `provisionalEvidenceFirstSeenTurn` fields
        - Emit `"fsrs.provisional-evidence-decayed"` telemetry for the lemma
    - This is called once per turn by the Context middleware (Epic 10) so decay is checked regularly without a background worker
12. The reducer is the ONLY path that mutates `provisionalEvidence` on a card. No other component writes to it. The single-writer discipline extends to the new field.

**Tests Required:**

- Unit test per event kind: applying the event produces the expected state transition (including the three new provisional-evidence events)
- Unit test: multiple applies in sequence produce expected accumulated state
- Unit test: single-writer enforcement — another writer attempting to update `LEARNER_PROFILE_FACT` fails
- Integration test: applying 100 mixed events then loading from persistence recovers identical state (including provisionalEvidence and provisionalEvidenceFirstSeenTurn)
- Concurrency test: two parallel `apply` calls serialize correctly (use a simple mutex or assume single-threaded execution is the contract)
- **Provisional evidence lifecycle test:** apply 5 `rapid-advance` observations for one lemma → assert `provisionalEvidence > 0` AND `stability` unchanged from seed
- **Commit test:** after the above, apply `CommitProvisionalEvidenceEvent` with that lemma → assert `provisionalEvidence === 0` AND `stability` has increased (FSRS Good grade applied)
- **Discard test:** instead of committing, apply `DiscardProvisionalEvidenceEvent` → assert `provisionalEvidence === 0` AND `stability` UNCHANGED from seed (no FSRS update)
- **Decay test:** apply provisional evidence, advance the session turn counter past `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`, apply `DecayProvisionalEvidenceEvent` → assert the lemma's provisional evidence is back to 0 AND no FSRS change
- **Persistence round-trip test:** save a profile with several cards carrying provisional evidence at different ages → load from fresh runtime → assert provisional evidence and first-seen-turn are preserved exactly

**API Documentation Update:**

- `docs/api/learner-state.md`: "Reducer" section with the event types and the contract ("only LearnerStateReducer writes LEARNER_PROFILE_FACT")

**Acceptance Criteria:**

- All tests pass
- Single-writer enforcement is tested
- Every event kind is handled

### Story 7.6: Wire up the `BlackboardLearnerStore` provider impl

**Purpose:** Implement the learner-state-reading side as an ADR 010 `LearnerPriorProvider` + a read-only view into the current profile.

**Tasks:**

1. Implement `runtime/providers/impls/blackboard-learner-store.ts` with:
   - `getCurrentProfile(): Promise<LearnerProfile>` — reads from the blackboard
   - `getInitialLemmaCard(lemmaId, lang, learnerBand): LemmaCard` — seeds a fresh card from CEFRLex priors (invokes `learnerPriorProvider`)
   - `getCefrInitialPosterior(selfReportedBand?): CefrPosterior` — delegates to `cefr-posterior.ts`
2. This class is the read side; the reducer is the write side. They must never share mutable state.

**Tests Required:**

- Unit test: reading a profile returns the latest written state
- Unit test: initial card seeding uses the atlas CEFR band
- Unit test: reads never mutate anything (assert by snapshot comparison)

**API Documentation Update:**

- `docs/api/providers.md`: `BlackboardLearnerStore` implementation reference

**Acceptance Criteria:**

- Read/write separation is clean
- All tests pass

## Risks and Open Questions

- **Blackboard fact scope for `LEARNER_PROFILE_FACT`.** Proposal 001 suggests entity-scoped (keyed by player entity). Confirm that the entity system has a persistent player entity during implementation; if not, use global scope and manage the profile id explicitly.
- **Card pagination granularity.** IndexedDB can handle thousands of independent key-value entries cheaply. But bulk operations (e.g. scene gate pulling ~300 lemmas for the Budgeter) need to be batched via `bulkGet`. Performance test catches this.
- **Single-writer enforcement at runtime.** Blackboard has `assertWriteAllowed` — verify the exact name during implementation and wire the reducer's writer id correctly. If the blackboard lacks the enforcement, the reducer-as-sole-writer is a code convention only. Document this.
- **Profile id scheme.** One profile per player? One per player per language? Per target-language, so a player learning both Spanish and Italian has two profiles. Flag as a v1 decision to lock in during this epic.

## Exit Criteria

Epic 7 is complete when:

1. All six stories are complete
2. All tests pass, including the single-writer enforcement test
3. IndexedDB persistence round-trips correctly
4. Performance budgets for card paging are met
5. `docs/api/learner-state.md` and `docs/api/providers.md` are complete
6. `tsc --noEmit` passes
7. This file's `Status:` is updated to `Complete`
