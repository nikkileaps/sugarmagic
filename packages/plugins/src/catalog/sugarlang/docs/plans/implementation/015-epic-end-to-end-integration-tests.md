# Epic 15: End-to-end Integration Tests

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Verification and Acceptance](../../proposals/001-adaptive-language-learning-architecture.md#verification-and-acceptance)
**Depends on:** Epics 1–14
**Blocks:** — (this is the final epic)

## Context

Every earlier epic has its own unit and integration tests scoped to its component. This epic ties the whole stack together with **golden scenario tests**: full conversations from a fresh learner profile through to placement completion, through multi-turn teaching loops, across language switches, across cache cold and warm starts. These tests exercise the full pipeline and catch any integration bugs that the per-epic tests missed.

This epic also runs the **acceptance criteria from Proposal 001 § Verification and Acceptance** as live tests — things like "the cap is honored," "cache hit rate ≥95% in typical authoring sessions," "cost per turn stays within the budget." These are the bar the whole plugin clears to ship v1.

## Prerequisites

- Epics 1–13 all complete

## Success Criteria

- Every acceptance criterion from Proposal 001 § Verification and Acceptance has a corresponding automated test
- Golden scenario tests exist for the six core behavioral paths:
  1. Cold-start placement (questionnaire flow — Story 15.1)
  2. Mid-conversation teaching loop (steady state — Story 15.2)
  3. Swain feedback loop (receptive vs. productive — Story 15.3)
  4. Lexical chunk awareness (idiom feedback — Story 15.4)
  5. Speed-reader probe feedback loop (Observer Latency Bias — Story 15.5)
  6. Ethereal Altar linguistic deadlock (Quest-Essential Lemma Exemption — Story 15.6)

  Plus additional coverage tests for: multi-language session, published-build loading, Preview cache hit rate benchmark, cost and latency benchmark.
- Preview cache hit rate benchmark reliably produces ≥95%
- Cost per turn benchmark stays within $0.015 amortized
- Performance budgets (p50 ≤1.5s, p95 ≤2.6s) are verified in a benchmark
- All tests run in CI without requiring live Claude API (mocked or recorded)
- A separate optional test suite runs against live Claude and is gated behind an env flag
- Every sugarlang `docs/api/*.md` has a final pass for completeness

## Stories

### Story 15.1: Golden scenario — cold-start placement end-to-end (questionnaire flow)

**Purpose:** Reproduce the full cold-start flow from Proposal 001 § Cold Start Sequence and Plan 001 (Welcome to Wordlark Hollow) as an automated test. This scenario validates the questionnaire-based placement: dialog wrapper → form → scoring → dialog wrapper → completion. Per the rewrite documented in Epic 11, placement is no longer Director-driven; this test reflects the deterministic questionnaire design.

**Tasks:**

1. **Build a fixture project:**
   - A single region, scene, NPC (the placement NPC with `metadata.sugarlangRole = "placement"`)
   - A minimal "Welcome" quest with Stage 1 objective gated on `sugarlang.placement.completed`
   - A fixture `placement-questionnaire.json` shipped with the test plugin data (NOT a project-authored bank — this is plugin data). 10 questions spanning A1–B2 with a mix of multiple-choice, free-text, yes-no, and fill-in-blank kinds.
   - Authored dialog wrapper lines for the NPC: 2–3 opening lines and 2–3 closing lines

2. **Boot the runtime with a fresh learner profile:**
   - `estimatedCefrBand: "A1"`, `cefrConfidence: 0`, empty `lemmaCards`, `SUGARLANG_PLACEMENT_STATUS_FACT.status: "not-started"`

3. **Phase 1 — Opening dialog:**
   - Simulate the player opening a conversation with the placement NPC
   - **Assert**: `execution.annotations["sugarlang.placementFlow"]?.phase === "opening-dialog"`
   - Mock Claude returns a realistic opening directive; SugarAgent generates the NPC's first welcome line
   - **Assert**: the normal Budgeter → Director → Generator → Verify → Observe pipeline runs
   - Simulate a second player tap to advance through the opening dialog
   - **Assert**: after the second opening-dialog turn, the next phase transition moves to `"questionnaire"`

4. **Phase 2 — Questionnaire:**
   - **Assert**: `execution.annotations["sugarlang.placementFlow"]?.phase === "questionnaire"`
   - **Assert**: the Budgeter, Director, and normal Generator pipeline are NOT invoked this turn (short-circuit)
   - Simulate a fixture `PlacementQuestionnaireResponse` for an A2-level learner:
     - All A1 multiple-choice questions: correct
     - All A1 free-text questions: correct productions (e.g., "Mi chiamo Sam")
     - Most A2 questions: correct
     - B1 questions: partially correct
     - B2 questions: mostly skipped
   - Submit the response through the Observer middleware's questionnaire-submission handling path (Epic 10 Story 10.5)
   - **Assert**: `PlacementScoreEngine.score` is invoked with the fixture questionnaire and response
   - **Assert**: the returned `PlacementScoreResult` has `cefrBand: "A2"` and `confidence >= 0.65`
   - **Assert**: `lemmasSeededFromFreeText` contains the content lemmas the player typed (e.g., `chiamarsi`, `sam` → wait, `sam` is a proper noun; only `chiamarsi` counts)

5. **Phase 3 — Completion signal firing:**
   - **Assert**: `SUGARLANG_PLACEMENT_STATUS_FACT.status === "completed"` with the scoring result
   - **Assert**: `questManager.setFlag` was called with `("sugarlang.placement.status", "completed")`
   - **Assert**: `questManager.notifyEvent` was called with `"sugarlang.placement.completed"`
   - **Assert**: Stage 1 of the Welcome quest has closed (objective marked complete)
   - **Assert**: Stage 2 of the Welcome quest has activated
   - **Assert**: `LEARNER_PROFILE_FACT.assessment.evaluatedCefrBand === "A2"` and `cefrConfidence >= 0.65`
   - **Assert**: FSRS cards have been seeded for the lemmas in `lemmasSeededFromFreeText` — each card has elevated `stability` and `productiveStrength` above seed values
   - **Assert**: `placement.completed` telemetry event fired with the full score result
   - **Assert**: `fsrs.seeded-from-placement` telemetry fired once per seeded lemma

6. **Phase 4 — Closing dialog:**
   - **Assert**: `execution.annotations["sugarlang.placementFlow"]?.phase === "closing-dialog"`
   - **Assert**: the normal pipeline runs again, now with the known CEFR band (A2)
   - Mock Claude returns a realistic closing directive
   - **Assert**: the Director's context includes the now-known CEFR band, not the cold-start estimate
   - Simulate a second player tap to advance through the closing dialog
   - **Assert**: after the second closing-dialog turn, phase transitions to `"completed"`

7. **Phase 5 — Replay inertness:**
   - Player opens a fresh conversation with the same placement NPC
   - **Assert**: `execution.annotations["sugarlang.placementFlow"]` is `{ phase: "not-active" }` OR absent
   - **Assert**: the normal Budgeter → Director → Generator → Verify → Observe pipeline runs
   - **Assert**: no questionnaire UI is triggered
   - **Assert**: the NPC behaves as a normal agent NPC with his `metadata.sugarlangRole: "placement"` tag still attached but observed as inert

**Tests Required:**

- The scenario runs end-to-end in <5 seconds with mocked Claude returning fixture directives for the dialog wrapper phases only (no mocks needed during the questionnaire phase — it's deterministic)
- Every assertion passes
- **Repeat the scenario with deterministic fixture responses for A1, A2, B1, and B2 learners** — verify the scoring engine produces the expected CEFR band for each

**Regression guards:**

- Assertion that the Director is NOT called during the questionnaire phase (the mocked Claude client's call count should increase only during opening and closing dialog phases)
- Assertion that `PlacementScoreEngine.score` is called exactly once per scenario
- Assertion that seeded FSRS cards carry real productive evidence after placement (not zero)
- Assertion that replay does not re-invoke the scoring engine

**API Documentation Update:**

- `docs/api/placement-contract.md`: reference this golden scenario as the canonical behavior test for the questionnaire placement flow
- `docs/api/README.md`: point to this test as the canonical "how sugarlang actually runs end-to-end for placement" reference

**Acceptance Criteria:**

- Scenario passes for A1, A2, B1, B2 fixture learner profiles
- Every phase transition is verified
- Replay inertness is verified
- The scoring engine's determinism is verified (running the same fixture response twice produces byte-identical `PlacementScoreResult`)
- The test is fully deterministic and does not depend on LLM output for the questionnaire phase

### Story 15.2: Golden scenario — multi-turn teaching loop

**Purpose:** Verify that once placement is complete, the steady-state teaching loop keeps introducing new lemmas, reinforcing due ones, updating FSRS cards, and producing in-envelope turns.

**Tasks:**

1. Use the same fixture project, but start with an A2 learner already placed
2. Simulate a 30-turn free-form conversation with an agent NPC in a scene with ~200 lemmas
3. Assert over the full session:
   - Every turn is in-envelope (Classifier verdict is always `withinEnvelope: true`)
   - At least 5 unique lemmas marked "introduce" appear in the session
   - At least 15 unique lemmas marked "reinforce" appear
   - No "avoid" lemmas appear in any generated turn
   - FSRS cards for introduced lemmas exist in the card store
   - FSRS cards for reinforced lemmas have updated `reviewCount` and `stability`
   - Bayesian posterior may drift slightly based on performance
4. Use telemetry to verify event sequences and counts

**Tests Required:**

- The 30-turn scenario runs in <30 seconds with mocked Claude
- Every assertion passes
- Run with three different simulated-learner profiles to verify robustness

**API Documentation Update:**

- `docs/api/README.md`: reference this as the "steady-state" integration test

**Acceptance Criteria:**

- Every assertion passes across three learner profiles

### Story 15.3: Golden scenario — Swain feedback loop (receptive vs. productive)

**Purpose:** Prove the receptive/productive knowledge split from Proposal 001 § Receptive vs. Productive Knowledge actually drives behavior, not just type signatures. A player who recognizes a set of lemmas but cannot produce them should see those lemmas prioritized by the Budgeter, the Director should pick `elicitation_mode` in response, the NPC should invite production, and when the player succeeds, `productiveStrength` should climb and the gap should close. This test exercises the full Swain loop end-to-end.

The scenario matters because the split is the kind of thing that can regress silently — a refactor that accidentally conflates receptive and productive signals will pass every unit test if the unit tests only assert grade values, but it will break the pedagogy for every player. The golden scenario is the behavioral assertion that catches that class of regression.

**Tasks:**

1. **Fixture: a "recognition-heavy" learner.**
   - Create a `LearnerProfile` where five specific lemmas (e.g. `llave`, `carta`, `estación`, `plataforma`, `equipaje` in Spanish) have high receptive stability (FSRS `stability >= 0.8`, `retrievability >= 0.9`) and **`productiveStrength === 0`** — the classic "I can read it but can't say it" profile. Seed these cards with `lastReviewedAtMs` recent enough that they're not "due" by pure FSRS scoring.
   - Every other lemma on the card is fresh or irrelevant.
   - `estimatedCefrBand = "A2"`, `cefrConfidence = 0.75`.

2. **Fixture: a scene where those five lemmas are candidates.**
   - A minimal Spanish scene (a train station setting works — the lemmas above fit naturally) where the compiled scene lexicon includes all five gap lemmas plus ~20 other lemmas
   - One agent NPC in the scene, `interactionMode: "agent"`, normal (not placement) role

3. **Turn 1 — assert the Budgeter prioritizes gap lemmas:**
   - Run `SugarLangContextMiddleware` with the fixture learner and scene
   - Read the prescription from `execution.annotations["sugarlang.prescription"]`
   - Assert that at least 3 of the 5 gap lemmas appear in `prescription.reinforce`
   - Assert that their `LemmaScore.components.prodgap` values are all > 0 (the productive-gap term is actually firing)
   - Assert that `components.prodgap > components.due` for at least one of them (the gap is the dominant signal, not FSRS due-ness — which makes sense because the cards are not due)

4. **Turn 1 — assert the Director picks `elicitation_mode`:**
   - Run `SugarLangDirectorMiddleware` with mocked Claude returning a realistic directive
   - Configure the mock to inspect `context.prescription` — if multiple gap lemmas are present, return a directive with `interactionStyle: "elicitation_mode"` and `comprehensionCheck.trigger: true`
   - Assert the resulting constraint has `interactionStyle === "elicitation_mode"` and `comprehensionCheck.targetWords` includes at least one gap lemma
   - This validates the end-to-end flow: Budgeter detected the gap, Director responded appropriately, the constraint reflects it

5. **Turn 1 — simulate a production-eliciting NPC reply:**
   - Mock SugarAgent's Generate stage to produce a reply like "*¿Qué llevas en tu equipaje, viajero?*" which is a question that invites the player to say *llave* or *carta* in their response
   - Verifier passes the reply (it's in-envelope for A2)

6. **Turn 1 — simulate the player typing a correct production:**
   - Simulated player response: *"Una llave y una carta."* (correct A2 production of two gap lemmas)
   - `SugarLangObserveMiddleware.finalize()` runs
   - Lemmatize the input, classify as `produced-typed` for `llave` and `carta` (because they were in the directive's targetVocab)
   - Assert two `produced-typed` observations fire
   - Assert `productiveStrength` for `llave` rises from 0 to ~0.30 (the `PRODUCTIVE_DELTAS.producedTyped` delta)
   - Assert `productiveStrength` for `carta` also rises
   - Assert `lastProducedAtMs` is set to the current turn time for both

7. **Turn 2 — assert the gap has shrunk:**
   - Run `SugarLangContextMiddleware` again in the same scene
   - Read the new prescription
   - Assert `llave` and `carta` still appear in `reinforce` but their `components.prodgap` values are now **strictly lower** than they were in Turn 1 (gap = stability − productiveStrength is now stability − 0.30 instead of stability − 0)
   - Assert one of the *other* gap lemmas (e.g. `estación`) now has a higher total score than `llave` or `carta`, confirming the Budgeter re-ranked appropriately — the loop is self-correcting

8. **Turn 3 — simulate a production failure:**
   - The NPC prompts for production of `plataforma`: "*¿A qué [plataforma] vas?*"
   - Simulated player response contains a wrong-form attempt: *"Voy al plataformos"* (non-word, wrong inflection)
   - The observer's morphology validator detects the error, emits `produced-incorrect` with `attemptedForm: "plataformos"`, `expectedForm: "plataforma"`
   - Assert `productiveStrength` for `plataforma` **decreases** by 0.20 (clamped at 0)
   - Assert FSRS receptive state transitions to the `"Again"` grade (lapseCount incremented, stability reset)

9. **Turn 4 — assert the Budgeter responds to the production failure:**
   - Run prescription again
   - Assert `plataforma` either (a) drops out of the reinforce set because its FSRS stability is now low enough that it's not "recognized" anymore, or (b) moves to `introduce` semantically (the learner needs to re-establish recognition before production can be targeted again)
   - Assert the rationale trace records the `lapseCount` bump

10. **Assertion: productive knowledge persists across sessions:**
    - Serialize the learner profile at the end of Turn 3
    - Deserialize into a fresh runtime
    - Assert `productiveStrength` values are preserved (0.30 for `llave` and `carta`, 0 for `plataforma`)
    - Assert the Budgeter running on the deserialized profile produces the same prescription as Turn 4 (determinism across persistence)

**Tests Required:**

- The full scenario runs end-to-end in <8 seconds with mocked Claude
- Every numbered assertion passes
- The test is deterministic — running it twice produces identical outcomes
- Running with a different seed (different gap lemmas selected) still produces the correct qualitative behavior (the gap-driven ranking works for any choice of gap lemmas)

**Regression guards:**

- Assertion that `PRODUCTIVE_DELTAS.producedTyped > 0` (if someone accidentally zeros it out, this test catches it)
- Assertion that `SCORING_WEIGHTS.w_prodgap > 0` (if someone accidentally removes the productive gap from scoring, this catches it)
- Assertion that `elicitation_mode` is a valid `InteractionStyle` value (if someone removes it from the enum, this catches it)

**API Documentation Update:**

- `docs/api/budgeter.md`: reference this golden scenario as the "Swain feedback loop behavior test" — add a pointer in the scoring section
- `docs/api/learner-state.md`: reference this scenario as the "receptive/productive split behavior test"
- `docs/api/middlewares.md`: reference this scenario as the end-to-end test for Observer production subkind classification
- `docs/api/README.md`: add to the "canonical behavior tests" list alongside 15.1 (cold start) and 15.2 (steady state)

**Acceptance Criteria:**

- Every numbered assertion passes
- The scenario runs deterministically
- Regression guards for `PRODUCTIVE_DELTAS`, `SCORING_WEIGHTS.w_prodgap`, and `elicitation_mode` all fire if their upstream values change
- The test functions as the single canonical behavioral proof that the receptive/productive split from Proposal 001 § Receptive vs. Productive Knowledge is actually wired up and not just documented

### Story 15.4: Golden scenario — Lexical chunk awareness (idiom feedback loop)

**Purpose:** Prove the Epic 14 chunk awareness layer actually drives classifier behavior, not just type signatures. A scene containing the idiom "*de vez en cuando*" should be classified as in-envelope for an A2 learner after the tier-2 chunk extractor runs, where it would have been flagged as out-of-envelope under lemma-only classification (because *vez* is individually B2). This scenario covers the full pipeline: authoring edit → tier-1 compile → tier-2 extraction → chunk cache populated → classifier uses chunks on next turn → envelope passes where it would have been repaired.

The scenario matters because the whole value of Epic 14 is "the classifier stops stiffening on idioms." If that behavior regresses — because someone refactors the coverage pipeline, accidentally bypasses the chunk-scan pre-pass, or the tier-2 scheduler gets disconnected from the cache — this test catches it. Without this behavioral regression guard, the chunk feature could silently stop working and no unit test would notice.

**Tasks:**

1. **Fixture: a scene with a rich idiomatic sentence.**
   - Create a minimal Spanish scene with one agent NPC (`interactionMode: "agent"`, non-placement role) whose lore page and authored dialogue include the sentence: *"De vez en cuando, un viajero viene a esta estación con una historia que vale la pena escuchar."*
   - The scene also includes ~20 other sentences of A1/A2 dialogue so the chunk's contribution is measurable in context
   - The fixture learner is A2 with normal confidence (not cold-start)

2. **Phase 1 — classify without chunks (regression baseline):**
   - Boot the runtime with an empty chunk cache
   - Run the base scene lexicon compile (tier-1), which does NOT populate chunks
   - Classify the target sentence: "*De vez en cuando, un viajero viene a esta estación con una historia que vale la pena escuchar.*"
   - Assert: the verdict shows `vez` (or equivalent individually-high-band constituent) in `outOfEnvelopeLemmas`
   - Assert: either `withinEnvelope: false` OR the verdict barely passes via the ≤2 exemption clause with `vez` noted as out of envelope — both outcomes demonstrate the "without chunks" baseline
   - Record the baseline verdict for comparison in phase 2

3. **Phase 2 — run the tier-2 chunk extractor with mocked Claude:**
   - Configure the mocked Claude client to return a fixture extraction result containing at least the `LexicalChunk`:
     ```ts
     {
       chunkId: "chunk_de_vez_en_cuando_es",
       normalizedForm: "de_vez_en_cuando",
       surfaceForms: ["de vez en cuando", "De vez en cuando"],
       cefrBand: "A2",
       constituentLemmas: ["de", "vez", "en", "cuando"],
       extractedByModel: "mock-claude",
       extractedAtMs: <test_now>,
       extractorPromptVersion: "v1",
       source: "llm-extracted"
     }
     ```
   - Run the tier-2 authoring scheduler with the fixture scene
   - Assert: `extractChunks` was called once with the scene's text
   - Assert: the chunk cache now has an entry at `(contentHash, "es", "v1")` containing the fixture chunk
   - Assert: the scene lexicon cache entry has been updated with `chunks: [<the fixture chunk>]`
   - Assert: the `sugarlang.scene-chunks-updated` blackboard event fired
   - Assert: `chunk.extraction-started`, `chunk.extraction-completed` telemetry events were emitted with the expected payloads

4. **Phase 3 — classify with chunks (the feedback loop):**
   - Re-run the classifier on the same target sentence with the now-chunk-aware scene lexicon
   - Assert: the `CoverageProfile.matchedChunks` array contains the "de_vez_en_cuando" chunk
   - Assert: `vez` is NO LONGER in `outOfEnvelopeLemmas` (it was absorbed into the chunk match)
   - Assert: `withinEnvelope: true` with a cleanly clean verdict (not "barely passing via exemption")
   - Assert: the `chunk.hit-during-classification` telemetry event fired for this turn
   - **Compare against the phase-1 baseline**: the phase-3 verdict is strictly cleaner than phase-1 in at least one measurable way (either `withinEnvelope` flipped from false to true, OR `outOfEnvelopeLemmas.length` decreased, OR the exemption clause stopped being load-bearing)

5. **Phase 4 — graceful degradation:**
   - Wipe the chunk cache
   - Run the classifier again on the same sentence (chunk cache cold)
   - Assert: the verdict matches the phase-1 baseline exactly (byte-identical) — no chunks, lemma-only classification, same behavior as Epic 5 baseline

6. **Phase 5 — drift detection:**
   - After phase 4, mock the Claude client to return a *different* fixture chunk (e.g., the same chunk but tagged as `cefrBand: "B1"` instead of `"A2"`)
   - Re-run the tier-2 extractor
   - Assert: a `chunk.extraction-drift-detected` event was emitted with the previous and new chunk metadata
   - Assert: the cache now has the new chunk (overwriting the previous)

7. **Phase 6 — Director exemption interaction:**
   - Seed the Director to include the chunk's normalized form in `prescription.introduce` on the next turn
   - Construct a harder target sentence that has a *different* out-of-envelope word alongside "de vez en cuando"
   - Assert: the classifier's exemption clause ("all out-of-envelope lemmas ∈ `prescription.introduce`") works on both the chunk and the individual introduce lemma
   - This confirms that the existing Director exemption mechanism handles chunk introductions without needing a new "safe unit" annotation

**Tests Required:**

- The full scenario runs end-to-end in <10 seconds with mocked Claude
- Every phase's assertions pass
- The test is deterministic — running it twice produces identical outcomes
- Regression guards are emitted explicitly (see below)

**Regression guards:**

- Assertion that `Story 14.5`'s chunk-scan pre-pass is wired in — a presence-check on `CoverageProfile.matchedChunks` being non-null after a chunk-aware classification
- Assertion that the tier-2 scheduler actually writes chunks to the scene lexicon cache — a presence-check on `sceneLexicon.chunks.length > 0` after the extractor runs
- Assertion that `EXTRACTOR_PROMPT_VERSION` is exported and readable — if someone removes it without reindexing, this fires
- Assertion that the default classifier behavior is unchanged by the chunk-scan pass when chunks are absent — phase 4 is this guard in concrete form

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: reference this golden scenario as the "chunk feedback loop behavior test"
- `docs/api/classifier.md`: reference this golden scenario as the end-to-end test for the chunk-scan pre-pass
- `docs/api/telemetry.md`: reference this golden scenario as the canonical test of the chunk event lifecycle
- `docs/api/README.md`: add to the "canonical behavior tests" list alongside 15.1 (cold start), 15.2 (steady state), 15.3 (Swain)

**Acceptance Criteria:**

- Every phase's assertions pass
- The scenario runs deterministically
- Phase 1 vs phase 3 comparison proves the chunk layer changes classifier behavior in the expected direction
- Phase 4 proves graceful degradation (identical to Epic 5 baseline when chunks are absent)
- Phase 5 proves drift detection works
- Phase 6 proves the Director's existing exemption mechanism handles chunks without a new annotation kind
- The test functions as the single canonical behavioral proof that Epic 14 Lexical Chunk Awareness is wired up end-to-end

### Story 15.5: Golden scenario — Speed-reader probe feedback loop (Observer Latency Bias)

**Purpose:** Prove the Observer Latency Bias fix actually protects FSRS state from corrupted speed-read signals, AND prove the comprehension-check lifecycle works end-to-end: rapid-advance observations accumulate as provisional evidence, the Director or the hard floor triggers a probe, the player's response is classified, and provisional evidence is committed or discarded correctly.

This scenario is the behavioral regression guard for **Proposal 001 § Observer Latency Bias and In-Character Comprehension Checks**. Without this test, someone could silently revert `rapid-advance` back to a "Good" grade (it's happened before — the Swain retrofit did exactly that by mistake) and no unit test would catch it because the individual rule-table mappings would still type-check. This scenario asserts the *behavior* — skim-read signals do not touch FSRS until a probe confirms them.

**Tasks:**

1. **Fixture: a fresh learner and a scene with 10 target lemmas.**
   - `LearnerProfile` with `estimatedCefrBand: "A2"`, no production history, every lemma card at its seed values (no FSRS updates applied)
   - A scene containing 10 A2 lemmas in natural dialogue (use the Wordlark Hollow fixture or a small synthetic project)
   - Simulated player configured to skim every turn in <2 seconds without hovering (deliberate speed-reader profile)

2. **Phase 1 — skim accumulates provisional, FSRS untouched:**
   - Run 10 conversation turns. On each, the simulated player advances the turn after 1-2 seconds with no hover and no production.
   - The tier-1 observer records the player's advance as `rapid-advance` observations for all in-envelope lemmas in the turn.
   - Reducer applies the outcome: `provisionalEvidence` increases per lemma, `stability` / `retrievability` / `reviewCount` all untouched.
   - **Assert** after 10 turns:
     - At least 10 lemmas have `provisionalEvidence > 0`
     - EVERY one of those lemmas has `stability` EXACTLY equal to its initial seed value (zero drift)
     - EVERY one has `reviewCount === 0` (no FSRS grade was applied)
     - EVERY one has `provisionalEvidenceFirstSeenTurn` set to a session turn index
   - Also assert: `fsrs.provisional-evidence-accumulated` telemetry events fired once per (lemma, turn) pair

3. **Phase 2 — soft floor recommendation:**
   - After 15 turns without a probe, the Context middleware computes `softFloorReached: true` because turnsSinceLastProbe≥15 AND ≥5 lemmas have pending evidence
   - **Assert**: the Context middleware writes `execution.annotations["sugarlang.probeFloorState"]` with `softFloorReached: true`
   - **Assert**: the Director's prompt contains "SOFT FLOOR — probe recommended"
   - Mock Claude returns a directive that DECLINES the soft recommendation (sets `comprehensionCheck.trigger: false`) — the Director chose not to probe, which is legal under a soft floor
   - **Assert**: no probe fires this turn, no `comprehension.probe-triggered` event

4. **Phase 3 — hard floor enforcement:**
   - Continue running turns. After 25 turns without a probe, the hard floor triggers
   - **Assert**: the Context middleware writes `execution.annotations["sugarlang.forceComprehensionCheck"] = true`
   - Mock Claude this time returns a directive that ignores the hard-floor instruction (`comprehensionCheck.trigger: false`) to test the schema-parser's enforcement
   - **Assert**: the schema-parser rejects the directive and emits `comprehension.director-hard-floor-violated` telemetry
   - **Assert**: the `FallbackDirectorPolicy` kicks in, produces a directive with `comprehensionCheck.trigger: true`, `triggerReason: "director-deferred-override"`, and target lemmas populated from the top-3 oldest pending
   - **Assert**: `comprehension.probe-triggered` telemetry fires with `triggerReason: "director-deferred-override"`

5. **Phase 4 — Generator produces a probe-bearing turn:**
   - The SugarLangConstraint now has `comprehensionCheckInFlight` populated with the target lemmas
   - Mock SugarAgent's Generate stage receives the constraint and produces a turn ending with an in-character probe question, e.g. *"...en fin. Oye, dime — ¿qué es una llave?"* (the mock can be configured to produce a realistic probe turn for this assertion)
   - **Assert**: the turn text contains a question mark
   - **Assert**: the turn text contains at least one of the target lemmas in the probe question (the Generator wove it in)
   - **Assert**: `comprehension.probe-fired` telemetry fires with `probeQuestionExtract` populated

6. **Phase 5a — player passes the probe:**
   - Simulated player responds: *"una llave es... para abrir la puerta"* (correctly uses target lemma "llave")
   - Observer middleware detects `session.state["sugarlang.lastTurnComprehensionCheck"]` is set (from the previous turn's constraint)
   - Lemmatizes the response, finds target lemma "llave" in correct form
   - **Assert**: `comprehension.probe-response-received` telemetry fires
   - **Assert**: `comprehension.probe-passed` telemetry fires with `lemmasPassed: [llave]`
   - **Assert**: reducer is called with `commit-provisional-evidence` for the target lemmas
   - **Assert**: "llave" card's `stability` is now GREATER than its seed value (FSRS "Good" grade applied)
   - **Assert**: "llave" card's `provisionalEvidence === 0` and `provisionalEvidenceFirstSeenTurn === null`
   - **Assert**: `fsrs.provisional-evidence-committed` telemetry fires

7. **Phase 5b — player fails a different probe (separate sub-scenario):**
   - Reset the test with a fresh provisional-evidence accumulation
   - Fire another probe for a different lemma, e.g. "carta"
   - Simulated player responds in English: *"I don't know"*
   - **Assert**: `comprehension.probe-language-fallback` telemetry fires (player used support language)
   - **Assert**: reducer is called with `discard-provisional-evidence` for "carta"
   - **Assert**: "carta" card's `stability` is UNCHANGED from seed (no FSRS update)
   - **Assert**: "carta" card's `provisionalEvidence === 0` (discarded)
   - **Assert**: `fsrs.provisional-evidence-discarded` telemetry fires

8. **Phase 6 — decay for abandoned provisional evidence:**
   - Run a third sub-scenario: accumulate provisional evidence on 3 lemmas, then run 35 turns without any probe (simulated by mocking Claude to return non-probe directives and disabling the hard floor temporarily via config override for this test phase)
   - **Assert**: after 30+ turns, the Context middleware's `DecayProvisionalEvidenceEvent` fires
   - **Assert**: the 3 lemmas' `provisionalEvidence` is back to 0
   - **Assert**: `fsrs.provisional-evidence-decayed` telemetry fires for each
   - **Assert**: FSRS `stability` is still UNCHANGED from seed (decay is not a negative update)

9. **Phase 7 — session rollup accuracy:**
   - Query the `ComprehensionMonitorData.getSessionRollup(sessionId)` after all phases
   - **Assert**: the rollup shows the expected counts: probes triggered (at least 2 — the hard-floor probe and the language-fallback probe), pass rate, fail rate, language-fallback rate, hard-floor-violation count ≥ 1
   - **Assert**: the per-NPC breakdown shows which NPC fired the probes
   - **Assert**: total provisional-evidence accumulated, committed, discarded, and decayed all sum correctly against the phase-by-phase assertions

**Tests Required:**

- The full scenario runs end-to-end in <15 seconds with mocked Claude
- Every phase's assertions pass
- The test is deterministic — running it twice produces identical outcomes
- Telemetry events are all queryable via the mock sink

**Regression guards:**

- Assertion that `observationToOutcome({ kind: "rapid-advance", dwellMs: 2000 }).receptiveGrade === null` — if someone "fixes" it back to "Good", this fires immediately
- Assertion that `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD === 30` and `PROVISIONAL_EVIDENCE_MAX === 5` — constants are where we expect them
- Assertion that the hard-floor enforcement in the schema-parser exists and rejects non-compliant directives
- Assertion that `FallbackDirectorPolicy` honors the hard-floor flag
- Assertion that a card's FSRS `stability` is exactly its seed value after ONLY rapid-advance observations (no probe) — this is the "speed-reader cannot corrupt FSRS" invariant in concrete form

**API Documentation Update:**

- `docs/api/learner-state.md`: reference this golden scenario as the canonical behavior test for provisional evidence
- `docs/api/director.md`: reference this golden scenario as the end-to-end test for soft-floor/hard-floor enforcement
- `docs/api/telemetry.md`: reference this golden scenario as the canonical test of the comprehension-check event lifecycle
- `docs/api/README.md`: add to the "canonical behavior tests" list alongside 15.1–15.4

**Acceptance Criteria:**

- Every phase's assertions pass
- The scenario runs deterministically
- Phase 1 proves the core Observer Latency Bias invariant: skim-read signals never touch FSRS directly
- Phase 3 proves the hard floor enforces itself even when the Director LLM ignores the instruction
- Phases 5a and 5b prove the commit/discard paths both work correctly
- Phase 6 proves decay works
- Phase 7 proves the visibility/rollup surface is accurate
- The test functions as the single canonical behavioral proof that the Observer Latency Bias fix from Proposal 001 is wired up across Epics 3, 7, 8, 9, 10, and 13

### Story 15.6: Golden scenario — Ethereal Altar linguistic deadlock

**Purpose:** Prove the Quest-Essential Lemma Exemption from Proposal 001 § Quest-Essential Lemma Exemption actually prevents the Linguistic Deadlock in practice. An A1 learner with an active quest whose objective contains high-band words (`ethereal`, `altar`, `investigate`) should see those words in the NPC's reply, with immediate parenthetical translations in the support language, and the classifier should NOT flag them as out-of-envelope. This scenario is the behavioral regression guard for the Linguistic Deadlock fix — without it, a refactor could silently strip the quest-essential exemption clause from the envelope rule and no unit test would notice until a playtester hit the deadlock in production.

**Tasks:**

1. **Fixture: an A1 learner and a scene with a hard quest.**
   - `LearnerProfile` with `estimatedCefrBand: "A1"`, `cefrConfidence: 0.75`, no production history
   - A scene containing one agent NPC (non-placement role) whose active quest has this objective:
     - Quest: "The Ethereal Altar"
     - Objective display name: "Investigate the Ethereal Altar"
     - Objective description: "Speak with the keeper and find the ethereal altar behind the temple."
   - Active objective node id referenced in the runtime context's `activeQuestObjectives`
   - `ethereal`, `altar`, `investigate`, `keeper`, `temple` are all B2 or C1 in the atlas (above A1's envelope by multiple bands)

2. **Phase 1 — compile-time quest-essential tagging:**
   - Run `compileSugarlangScene` on the fixture scene
   - **Assert**: the compiled lexicon's `questEssentialLemmas` contains entries for `investigate`, `ethereal`, `altar`, `keeper`, `temple` — each with the correct `sourceObjectiveNodeId` and `sourceObjectiveDisplayName: "Investigate the Ethereal Altar"`
   - **Assert**: stopwords like `the`, `and`, `behind` are NOT in the quest-essential list (only content lemmas)
   - **Assert under `authoring-preview` profile**: a `quest-essential.compile-diagnostic-deadlock-prone` telemetry event was emitted (5+ lemmas above B2 in a single objective triggers the warning)

3. **Phase 2 — runtime filtering to active:**
   - Run `SugarLangContextMiddleware.prepare()` with the fixture learner and scene
   - The `activeQuestObjectives` from the runtime context contains the objective node id
   - **Assert**: `execution.annotations["sugarlang.activeQuestEssentialLemmas"]` contains the expected 5 lemmas (or whatever subset is currently active)
   - **Assert**: `execution.annotations["sugarlang.questEssentialLemmaIds"]` is a Set with the expected ids
   - **Assert**: each entry has a populated `supportLanguageGloss` field (from the atlas lookup)

4. **Phase 3 — Budgeter excludes quest-essential from its normal output:**
   - Inside the same turn, after Context middleware runs
   - **Assert**: the prescription from `budgeter.prescribe()` does NOT contain `ethereal`, `altar`, `investigate`, `keeper`, `temple` in any of `introduce`, `reinforce`, or `avoid`
   - **Assert**: the `LexicalRationale.questEssentialExclusions` field lists them as excluded from normal partitioning
   - **Assert**: the rest of the prescription (for other lemmas) is unaffected

5. **Phase 4 — Director sees quest-essential context and sets heavy glossing:**
   - Mock Claude receives a context containing the `activeQuestEssentialLemmas` section
   - **Assert**: the mocked prompt contains the "QUEST-ESSENTIAL LEMMAS" section with all 5 lemmas and their glosses
   - Mock Claude returns a directive with `glossingStrategy: "parenthetical"` (the correct response)
   - **Assert**: the resulting `SugarlangConstraint.questEssentialLemmas` is populated with the 5 lemmas and their glosses

6. **Phase 5 — schema-parser rejects weak glossing when quest-essential is present:**
   - Reset and configure Mock Claude to return a directive with `glossingStrategy: "hover-only"` (the wrong response — forbidden when quest-essential is present)
   - **Assert**: the schema-parser rejects this directive, emits `quest-essential.director-forced-glossing` telemetry
   - **Assert**: `FallbackDirectorPolicy` kicks in and produces a directive with `glossingStrategy: "parenthetical"`

7. **Phase 6 — Generator produces a turn with quest-essential lemmas and parenthetical glosses:**
   - Mock SugarAgent's Generate stage receives the constraint with `questEssentialLemmas` populated
   - Mock the Generate stage to produce a turn like: *"Ve al altar (the altar) detrás del templo (the temple). Tienes que investigar (to investigate) el altar etéreo (the ethereal altar) y hablar con el guardián (the keeper)."*
   - **Assert**: the generated turn contains at least one quest-essential lemma
   - **Assert**: each quest-essential lemma that appears is followed by a parenthetical in the support language
   - **Assert**: `comprehension` / `chunk` / `normal` telemetry events are NOT mis-attributed — the quest-essential lemmas flow through their own event namespace

8. **Phase 7 — Classifier exempts quest-essential lemmas from envelope rule:**
   - Run the Envelope Classifier on the generated turn text with the fixture A1 learner
   - **Assert**: `EnvelopeVerdict.withinEnvelope === true` (despite the presence of `altar`, `etéreo`, `templo`, `investigar`, `guardián` which are all above A1 + 1)
   - **Assert**: `EnvelopeVerdict.exemptionsApplied` contains "quest-essential" (and possibly also "prescription-introduce" or "named-entity" for other exemptions)
   - **Assert**: `quest-essential.classifier-exempted-lemma` telemetry fires once per exempted lemma

9. **Phase 8 — Verify middleware confirms glosses and passes the turn:**
   - Run the Verify middleware on the generated turn
   - **Assert**: each quest-essential lemma used in the turn has a matching parenthetical translation
   - **Assert**: no repair is triggered (the Generator produced correct glosses)
   - **Assert**: the turn is passed to the player unchanged

10. **Phase 9 — missing-gloss repair loop:**
    - Reset and have the Mock Generate stage produce a turn like *"Ve al altar detrás del templo."* (uses quest-essential lemmas but NO parentheticals)
    - Verify middleware detects missing glosses
    - **Assert**: `quest-essential.generator-missed-gloss` telemetry fires with the specific lemmas that lacked glosses
    - **Assert**: a repair is triggered with an explicit gloss instruction
    - Mock the retry to produce a gloss-correct turn
    - **Assert**: the final turn shown to the player has parentheticals

11. **Phase 10 — missing-required-lemma repair:**
    - Reset and have the Mock Generate stage produce a turn that is about something unrelated entirely, ignoring the quest objective: *"Hoy hace buen tiempo."*
    - Verify middleware detects that the active quest objective was in focus but no quest-essential lemmas appeared
    - **Assert**: `quest-essential.generator-missed-required` telemetry fires
    - **Assert**: a repair is triggered with a stronger instruction demanding the quest topic be addressed
    - Mock the retry to produce a quest-referencing turn with correct glosses
    - **Assert**: the final turn now references the quest objective

12. **Phase 11 — graceful degradation (no active quest):**
    - Reset with the same scene but NO active quest objective (all objectives are completed)
    - **Assert**: `execution.annotations["sugarlang.activeQuestEssentialLemmas"]` is empty
    - **Assert**: the Director's prompt does NOT contain the quest-essential section
    - **Assert**: the classifier's behavior on a turn containing `altar` reverts to its non-exempt default — the lemma IS out-of-envelope for an A1 learner
    - This proves the quest-essential exemption is scoped exactly to active objectives, not a permanent allowlist

**Tests Required:**

- The full scenario runs end-to-end in <12 seconds with mocked Claude
- Every phase's assertions pass
- The test is deterministic — running it twice produces identical outcomes
- Telemetry events are all queryable via the mock sink

**Regression guards:**

- Assertion that the envelope rule file (`envelope-rule.ts`) contains the string `"quest-essential"` in its exemption clause implementation — if someone "cleans up" and removes the clause, this fires
- Assertion that `QuestEssentialLemma` type exists in `contracts/scene-lexicon.ts` with all required fields
- Assertion that `CompiledSceneLexicon.questEssentialLemmas` is always present (never undefined) on a compiled scene
- Assertion that the Generator splice prompt contains "QUEST-ESSENTIAL VOCABULARY — MANDATORY PARENTHETICAL GLOSSING" when the constraint carries quest-essential lemmas
- Assertion that `FallbackDirectorPolicy` returns `glossingStrategy: "parenthetical"` when `activeQuestEssentialLemmas.length > 0`
- Phase 11's graceful degradation is the strongest regression guard: it proves the exemption is scoped and doesn't leak into a permanent allowlist

**API Documentation Update:**

- `docs/api/classifier.md`: reference this golden scenario as the canonical behavior test for the quest-essential exemption
- `docs/api/scene-lexicon-compilation.md`: reference this scenario as the end-to-end test for quest-essential compile-time tagging
- `docs/api/director.md`: reference this scenario as the test for glossing strategy enforcement
- `docs/api/middlewares.md`: reference this scenario as the test for Verify middleware's gloss pattern check and missing-required-lemma repair
- `docs/api/telemetry.md`: reference this scenario as the canonical test of the `quest-essential.*` event lifecycle
- `docs/api/README.md`: add to the "canonical behavior tests" list alongside 15.1–15.5

**Acceptance Criteria:**

- Every phase's assertions pass
- The scenario runs deterministically
- Phase 7 is the load-bearing assertion: an A1 learner's turn containing 5 high-band quest-essential lemmas classifies as `withinEnvelope: true` — this is the whole point of the Linguistic Deadlock fix
- Phase 11 proves the exemption is scoped to active objectives, not permanent
- The test functions as the single canonical behavioral proof that the Quest-Essential Lemma Exemption from Proposal 001 is wired up across Epics 3, 5, 6, 8, 9, 10, and 13

### Story 15.7: Preview cache hit rate benchmark

**Purpose:** Verify that in a realistic simulated Studio session, the scene lexicon compile cache achieves ≥95% hit rate when Preview starts.

**Tasks:**

1. Simulate a Studio session:
   - Load a fixture project with 20 scenes
   - Emit 50 authoring commands over ~5 simulated seconds (dialogue edits, NPC renames, quest text tweaks) spread across 8 scenes
   - Wait for the authoring scheduler to debounce and compile
2. Trigger a Preview start:
   - Measure how many of the 20 scenes have cached lexicons in the `PREVIEW_BOOT` payload
   - Assert ≥19 out of 20 scenes are cached (95%)
3. Launch the Preview runtime and simulate entering each scene
   - Assert no scene recompile is triggered during Preview boot for the 19 cached scenes
   - Assert the 1 stale scene compiles lazily on scene-enter

**Tests Required:**

- Cache hit rate benchmark passes
- Lazy compile on the stale scene completes in <50ms

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: reference this benchmark as the SLA enforcement

**Acceptance Criteria:**

- 95% hit rate reliably achieved
- Lazy compile fallback works

### Story 15.8: Multi-language session test

**Purpose:** Verify that switching target language mid-session (e.g. the player changes from Spanish to Italian) works correctly — the learner profile is per-language, the atlas switches, the Budgeter re-prescribes, nothing leaks across languages.

**Tasks:**

1. Start a session with `targetLanguage: "es"`, run 10 turns
2. Switch to `targetLanguage: "it"`, run 10 more turns
3. Assert:
   - Two separate learner profiles exist (one per language)
   - FSRS cards from Spanish do not contaminate Italian state
   - Classifier switches morphology index and CEFRLex correctly
   - Budgeter prescriptions use Italian lemmas after the switch
4. Switch back to Spanish, assert the Spanish profile resumes from where it left off

**Tests Required:**

- Language switching works end-to-end
- No cross-language state leakage
- Profile-per-language isolation is verified

**API Documentation Update:**

- `docs/api/learner-state.md`: document the profile-per-language rule verified here

**Acceptance Criteria:**

- All assertions pass

### Story 15.9: Published-build loading test

**Purpose:** Verify that the published profile loads bundled compiled scene lexicons directly without recompilation and runs a conversation correctly.

**Tasks:**

1. Build a fixture project
2. Run the publish pipeline → generates `compiled/sugarlang/scenes/*.lexicon.json.gz` in the publish bundle
3. Boot a runtime with `compileProfile: "published-target"` pointing at the published bundle
4. Run a conversation turn
5. Assert:
   - No compilation was triggered (check via telemetry for the absence of compile events)
   - Lexicons were loaded from the bundle
   - The turn completes successfully with the same Budgeter output as in Preview mode
6. Corrupt one bundled lexicon (intentionally) and assert the runtime fails fast with a clear error

**Tests Required:**

- Published-build conversation runs without recompilation
- Fast-fail on missing/corrupt lexicons

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: verify the "published runtime loads without compiling" guarantee

**Acceptance Criteria:**

- Published build loads correctly
- Error paths fail fast

### Story 15.10: Cost and latency benchmark

**Purpose:** Verify that amortized per-turn cost and latency stay within the Proposal 001 budgets.

**Tasks:**

1. Run a 100-turn simulated conversation with mocked Claude returning realistic fixture directives and generated text
2. Instrument every LLM call to count input/output tokens
3. Compute:
   - Per-turn amortized cost (target: ≤$0.015/turn blended; short-convo: ≤$0.012)
   - p50 end-to-end latency (target: ≤1.5s)
   - p95 end-to-end latency (target: ≤2.6s)
   - Director cache hit rate (target: ≥70%)
   - Classifier retry rate (target: ≤30%)
4. The mock Claude simulates realistic latency (e.g., 800ms for Generate, 700ms for Director) so the p50/p95 measurements are meaningful

**Tests Required:**

- All five metrics are within their Proposal 001 targets
- The benchmark is deterministic (same seed → same result)
- Fail the test if any metric exceeds its budget

**API Documentation Update:**

- `docs/api/README.md`: reference this benchmark as the "cost and latency gate"

**Acceptance Criteria:**

- All metrics pass
- Benchmark is deterministic

### Story 15.11: Annotation namespace architectural test

**Purpose:** Enforce that the actual implementation matches the canonical annotation namespace reference in Proposal 001 § Annotation Namespace Reference. The reference is the single source of truth; this test catches drift in both directions — code that uses keys not in the reference, and reference keys that no code actually uses.

**Tasks:**

1. Write `tests/architecture/annotation-namespaces.test.ts` that:
   - **Parses the canonical list** from Proposal 001 § Annotation Namespace Reference (at build time — the test reads the proposal file and extracts the key names from the tables). This makes the proposal the source of truth rather than embedding the list in the test source code.
   - **Greps the entire `packages/plugins/src/` tree** for `execution.annotations[` and `context.annotations[` literal accesses, extracts every string literal key used
   - **Greps for `session.state[` accesses too**, extracts every string literal key used
   - **Asserts every `sugarlang.*` key in code is in the canonical list.** Any key in code that isn't in the list fails the test (prevents undocumented keys)
   - **Asserts every key in the canonical list is referenced from code at least once.** Any key in the list that no code uses fails the test (prevents dead documentation)
   - **Asserts every `sugarlang.*` key is referenced only from files under `packages/plugins/src/catalog/sugarlang/`** OR from the single known splice site `packages/plugins/src/catalog/sugaragent/runtime/stages/GenerateStage.ts`. This catches cross-plugin boundary violations.
   - **Asserts no file under `packages/plugins/src/catalog/sugarlang/` references keys outside the `sugarlang.*` namespace** (sugarlang doesn't read other plugins' annotations)
   - **Asserts writer uniqueness**: for each `sugarlang.*` key, there is exactly ONE story in the plan that lists it as the "Writer" in the canonical table. The test cannot directly verify writer uniqueness from code alone, but it can verify that the parsed canonical list itself has exactly one writer per key.
   - **Asserts that deprecated keys do not appear in code**: any key listed under "Deprecated and forbidden keys" in the canonical reference must NOT be referenced anywhere in the sugarlang source tree. If found, the test fails with a clear pointer at the offending file and a recommendation to refactor.
2. This is a lint-style test that runs in CI and fails on namespace collisions, undocumented keys, or code using forbidden keys
3. The test MUST NOT hardcode the annotation list — it MUST parse the proposal. This ensures the proposal stays the single source of truth and forces anyone adding a new key to update the proposal first.

**Tests Required:**

- The test itself passes against the current codebase (which has no real code yet, so it passes trivially at skeleton time; it becomes meaningful once Epic 10's middleware stories are implemented)
- A deliberate namespace violation introduced into a fixture file causes the test to fail
- A deliberate use of a key listed under "Deprecated and forbidden keys" causes the test to fail with a specific message
- A deliberately-added undocumented key causes the test to fail with a message pointing to Proposal 001 § Annotation Namespace Reference

**API Documentation Update:**

- `docs/api/middlewares.md`: reference the architectural test as the enforcement mechanism for the namespace convention AND point at Proposal 001 § Annotation Namespace Reference as the single source of truth. Do NOT duplicate the annotation list in the API doc — that would create a second source of truth and guarantee drift. The API doc instead says "see Proposal 001 § Annotation Namespace Reference for the canonical list" and the link is the ONLY place the reader needs to look.

**Acceptance Criteria:**

- Test is in place and enforces the convention
- The test parses the proposal file at runtime rather than hardcoding the list
- A developer who adds a new annotation key is forced to update the proposal first, otherwise the test fails
- A developer who removes a key from the proposal without removing it from code gets a clear failure pointing at the offending file

### Story 15.12: ADR 010 provider boundary architectural test

**Purpose:** Enforce the ADR 010 one-way dependency rule: `LexicalAtlasProvider` never imports from `LearnerPriorProvider` or `DirectorPolicy` implementations, and so on.

**Tasks:**

1. Write `tests/architecture/provider-boundaries.test.ts` that:
   - Scans import statements in `runtime/providers/impls/*`
   - Asserts the one-way dependency rules from ADR 010 and Epic 3 Story 3.7
   - Fails if any impl crosses a boundary

**Tests Required:**

- The test passes against the current codebase
- Deliberate boundary violations in a fixture fail the test

**API Documentation Update:**

- `docs/api/providers.md`: cross-reference this test as the enforcement

**Acceptance Criteria:**

- Test is in place

### Story 15.13: Live Claude integration test suite (optional, gated)

**Purpose:** A separate test suite that runs against the real Claude API for end-to-end validation. Gated behind an environment flag so CI doesn't incur API costs.

**Tasks:**

1. Write `tests/integration/live-claude.test.ts` (skipped unless `RUN_LIVE_CLAUDE_TESTS=1` is set):
   - Same golden scenarios as Stories 15.1 and 15.2 but calling real Claude
   - Assertions are relaxed slightly — directive fields are validated for schema compliance, not exact content (because LLM output varies)
2. Document how to run the live suite manually: `RUN_LIVE_CLAUDE_TESTS=1 pnpm test --filter sugarlang`
3. The live suite also captures a realistic per-turn cost measurement — log it for comparison against the Story 15.10 mocked benchmark

**Tests Required:**

- Live tests pass when run manually against real Claude
- Tests are skipped in CI

**API Documentation Update:**

- `docs/api/README.md`: "Running live Claude integration tests" section

**Acceptance Criteria:**

- Live suite is testable and gated

### Story 15.14: Final pass on all `docs/api/*.md` files

**Purpose:** Review every API documentation file for completeness, accuracy, and cross-referencing. This is the last chance to catch stale or incomplete docs before v1 ships.

**Tasks:**

1. Walk every file under `docs/api/`:
   - `README.md` (index)
   - `budgeter.md`
   - `classifier.md`
   - `director.md`
   - `learner-state.md`
   - `scene-lexicon-compilation.md`
   - `middlewares.md`
   - `placement-contract.md`
   - `editor-contributions.md`
   - `telemetry.md`
   - `providers.md`
2. For each: verify that every public type, function, and contract from the corresponding runtime code is documented with purpose, usage example, and cross-references
3. Add a "Last updated" date and a "See also" section linking to related docs
4. Run a markdown link checker across the whole `docs/` directory to catch broken links

**Tests Required:**

- Link checker passes
- A manual review checklist is completed

**API Documentation Update:**

- All API doc files finalized

**Acceptance Criteria:**

- Every doc is complete
- No broken links
- Index is accurate

## Risks and Open Questions

- **Mocked Claude realism.** The mocked Claude client needs to return outputs that match what real Claude would produce, or the golden tests become fiction. Base the mock on captured real outputs from the live integration runs (Story 15.13) and update when the model version changes.
- **Test runtime budget.** 15.1 (5s) + 15.2 (30s) + 15.3 (~5s) + 15.4 (~10s) + 15.5 (~15s) + 15.6 (~12s) + 15.7 (cache benchmark) + 15.10 (100-turn benchmark) + others total ~3–4 minutes of test time. That's acceptable for CI. If it grows, consider splitting into a fast-path and slow-path suite.
- **Published-build test environment.** The publish path writes to the file system. The test needs a temp directory or an in-memory filesystem to simulate publish without polluting the workspace. Use a library like `memfs` or `tmp`.
- **Determinism of multi-run benchmarks.** Latency benchmarks can flake in shared CI environments. Use percentile measurements (p50, p95) and a wider tolerance (e.g. p50 ≤ 2.0s instead of 1.5s) for CI-gated assertions; a tighter local-only benchmark is fine too.

## Exit Criteria — v1 Release Gate

Epic 14 is complete, and sugarlang v1 is ready to ship, when:

1. All fourteen stories are complete
2. Every test passes, including the benchmarks
3. The mocked Claude test suite runs in CI under the time budget
4. The live Claude suite passes when run manually
5. All `docs/api/*.md` files are final
6. A release checklist has been walked through covering:
   - Every acceptance criterion from Proposal 001 § Verification and Acceptance
   - Every API doc updated
   - All three compile profiles exercised
   - Cold start, steady state, published builds verified
   - Cost and latency budgets met
7. This file's `Status:` is updated to `Complete`
8. The sugarlang plugin is ready for a v1 tag and release
