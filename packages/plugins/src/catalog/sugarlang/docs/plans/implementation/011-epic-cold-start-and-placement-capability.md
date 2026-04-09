# Epic 11: Cold Start and Placement Capability

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Cold Start Sequence](../../proposals/001-adaptive-language-learning-architecture.md#cold-start-sequence), [§ Placement Interaction Contract](../../proposals/001-adaptive-language-learning-architecture.md#placement-interaction-contract)
**Depends on:** Epic 2 (NPCDefinition.metadata), Epic 3 Story 3.7b (PlacementQuestionnaire types), Epic 4 Story 4.2/4.3 (plugin-shipped questionnaire data), Epic 7 (learner state + reducer), Epic 10 Story 10.1 (Context middleware placement-phase detection), Epic 10 Story 10.5 (Observer middleware questionnaire-submission handling)
**Blocks:** Epic 15 (E2E test covers the placement flow)

## Context

This epic implements the **placement capability**: the plugin-owned questionnaire flow that estimates a new learner's CEFR level during their first visit to the placement NPC. Per Proposal 001 § Cold Start Sequence, placement is a **deterministic questionnaire wrapped in dialog** — NOT an LLM-driven calibration loop. The plugin ships the questionnaire UI primitive, the canonical question bank per language, and the scoring engine. The project provides the dialog wrapper (which NPC, what region, what transport metaphor, character voice).

**This epic was rewritten mid-plan** when the earlier Director-driven calibration design was replaced with the questionnaire design. Earlier drafts described stories for wiring placement into the Director's calibration-mode and computing CEFR via Bayesian sharpening turn-by-turn. Those stories are **obsolete** — the questionnaire is deterministic, runs outside the Director, and produces a result in a single scoring pass. This epic is smaller and simpler than what it replaced.

## Why This Epic Exists

Three things need to be true for placement to work:

1. The plugin has a **scoring engine** that turns a filled-in questionnaire into a CEFR estimate deterministically
2. The plugin has a **questionnaire UI primitive** that the conversation host can render when the placement flow is active
3. The plugin has a **flow orchestrator** — a small state machine that moves the player through `opening-dialog → questionnaire → closing-dialog → done` and emits completion signals at the right moment

Plus two supporting concerns:
- A **configuration surface** so authors can tune the placement confidence threshold or disable placement entirely
- **Replay inertness** so placement doesn't re-run on subsequent visits to the same NPC

This epic contains seven stories covering those concerns. Simulated-player test harness from the earlier draft is replaced with a much simpler deterministic test fixture because there's no LLM to simulate.

## Prerequisites

- **Epic 2** — `NPCDefinition.metadata` exists and propagates into `ConversationSelectionContext.metadata` so the placement flow can be triggered by the `sugarlangRole: "placement"` tag
- **Epic 3 Story 3.7b** — `PlacementQuestionnaire`, `PlacementQuestionnaireQuestion`, `PlacementQuestionnaireResponse`, `PlacementScoreResult`, `SugarlangPlacementFlowPhase` types are defined
- **Epic 4 Story 4.2 / 4.3** — plugin ships canonical `placement-questionnaire.json` for Spanish and Italian
- **Epic 4 Story 4.4** — runtime loader `placement-questionnaire-loader.ts` exposes `getQuestionnaire(lang): PlacementQuestionnaire`
- **Epic 7** — learner state reducer accepts `PlacementCompletionEvent` and updates `LEARNER_PROFILE_FACT.assessment` fields
- **Epic 10 Story 10.1** — Context middleware detects the placement tag and writes the `sugarlang.placementFlow` annotation
- **Epic 10 Story 10.5** — Observer middleware detects a questionnaire submission and routes it to this epic's scoring engine

## Success Criteria

- `PlacementScoreEngine` is a pure function that turns a `(questionnaire, response)` pair into a `PlacementScoreResult` deterministically
- The plugin provides a questionnaire UI primitive (Studio-side + runtime-side) that the conversation host can render when the placement phase is active
- The placement flow orchestrator correctly moves through `opening-dialog → questionnaire → closing-dialog → completed`
- On scoring, the reducer applies a `PlacementCompletionEvent` that updates learner state, writes the blackboard fact, fires the quest event, and seeds FSRS cards from free-text production
- Replay inertness works: re-entering a placement NPC after `SUGARLANG_PLACEMENT_STATUS_FACT.status === "completed"` treats the NPC as a normal conversational agent
- Configuration allows disabling placement entirely (the plugin falls back to CEFRLex priors alone)
- Unit tests cover the scoring engine comprehensively (it's deterministic, so tests are frozen-fixture easy)
- API documentation is complete

## Stories

### Story 11.1: Implement the `PlacementScoreEngine`

**Purpose:** The deterministic scoring function that turns a filled-in questionnaire into a CEFR estimate. This is the ML core of placement — not machine learning, but a rule-based scoring algorithm whose rules are all published and auditable. Because it's deterministic, it can be tested exhaustively with frozen fixtures.

**Tasks:**

1. Module location: `runtime/placement/placement-score-engine.ts`
2. Signature:
   ```ts
   function scorePlacement(
     questionnaire: PlacementQuestionnaire,
     response: PlacementQuestionnaireResponse,
     atlas: LexicalAtlasProvider,
     morphology: MorphologyLoader
   ): PlacementScoreResult;
   ```
3. Scoring algorithm (pure):
   - For each question in the questionnaire, look up the player's answer in `response.answers[questionId]`
   - If the answer is `"skipped"`, count it in `skippedCount` and move on
   - Otherwise, evaluate the answer against the question's expected-answer pattern:
     - `multiple-choice`: pass if `answer.optionId` matches the option tagged `isCorrect: true`
     - `yes-no`: pass if `answer.answer` equals `question.correctAnswer`
     - `fill-in-blank`: lemmatize `answer.text`, pass if the lemma is in `question.acceptableLemmas` OR the raw text is in `question.acceptableAnswers`
     - `free-text`: lemmatize `answer.text`, pass if any lemma in `question.expectedLemmas` is found in a correct inflection form. Also collect all lemmatized content lemmas for the `lemmasSeededFromFreeText` output.
   - Tally pass/fail per `targetBand`. The `perBandScores` field captures this.
4. Compute the final `cefrBand`:
   - Find the highest CEFR band where `correct / total >= 0.7` (the learner demonstrated at-least 70% competence at that band)
   - If A1 itself has `correct / total < 0.5`, the final band is A1 with low confidence — the learner is below the questionnaire's floor (an outcome the content is designed not to produce for most paying users, but handled gracefully)
5. Compute `confidence` as a simple function of `answeredCount / totalCount` — high confidence when the player answered most questions, low confidence when many were skipped. Clamp to [0.3, 0.95] so we never report 100% confidence on 10 questions.
6. Collect `lemmasSeededFromFreeText` from every lemma the player produced correctly in any `free-text` or `fill-in-blank` answer. These become `produced-typed` observations applied to the learner's FSRS cards in Story 11.4.
7. All questionnaire scoring is **pure**. No LLM calls. No blackboard reads. No side effects. Given the same inputs, the same output — this is critical for testability.

**Tests Required:**

- Fixture test: a fully-correct A1-level questionnaire scores to `cefrBand: "A1"` with high confidence
- Fixture test: a fully-correct mix across A1/A2/B1 scores to `cefrBand: "B1"`
- Fixture test: all skipped scores to `cefrBand: "A1"` with confidence ≤ 0.3 (the floor)
- Fixture test: answers with wrong-inflection in `fill-in-blank` are rejected unless in `acceptableLemmas` (morphology fallback works)
- Fixture test: a `free-text` answer with a valid lemma in an unexpected inflection (e.g., "viajé" when `expectedLemmas: ["viajar"]`) passes because the lemmatizer resolves it
- Determinism test: running the scorer twice with identical inputs yields byte-identical output
- `lemmasSeededFromFreeText` test: a `free-text` field containing "*yo viajo con mi familia*" produces seeded lemmas for `viajar`, `familia` (content lemmas only; stopwords like "yo" and "mi" are excluded)
- Exhaustiveness test: the scorer's switch over question kinds produces a `never` default

**API Documentation Update:**

- `docs/api/placement-contract.md`: "Placement Scoring" section with the full scoring algorithm, the CEFR band determination rule, and the confidence formula
- Cross-reference Proposal 001 § Cold Start Sequence

**Acceptance Criteria:**

- All fixture tests pass
- Scoring is byte-deterministic
- The algorithm is documented and auditable (every decision has a rule in the code and a citation in the docs)

### Story 11.2: Implement the questionnaire UI primitive

**Purpose:** The Studio-side and runtime-side UI component that renders a `PlacementQuestionnaire` and lets the player fill it out. This is a new plugin contribution — a specialized conversation-host UI mode that replaces the normal dialog panel when the placement flow is in its `questionnaire` phase.

**Tasks:**

1. Implement `ui/shell/PlacementQuestionnairePanel.tsx` as a React component:
   - Props: `{ questionnaire: PlacementQuestionnaire; onSubmit: (response: PlacementQuestionnaireResponse) => void; onSkip: (questionId: string) => void }`
   - Renders the `formTitle` and `formIntro` at the top
   - Renders every question in the questionnaire simultaneously (all-at-once form per the design decision in Proposal 001)
   - Each question kind has a specific renderer:
     - `multiple-choice`: radio button group with the option text in the target language
     - `free-text`: text input with a placeholder showing the support-language hint
     - `yes-no`: two big buttons with the yes/no labels in the target language
     - `fill-in-blank`: the sentence template with an inline text input for the blank
   - A "Skip this one" button next to each question
   - A "Submit form" button at the bottom, disabled until at least `questionnaire.minAnswersForValid` questions are answered
2. Styling: the form should feel diegetic — use a paper/parchment background or similar that visually distinguishes it from the normal dialog panel. The goal is "the NPC handed me a form" not "a pop-up quiz appeared"
3. The conversation host detects `execution.annotations["sugarlang.placementFlow"]?.phase === "questionnaire"` and switches from the normal dialog panel to this component. When the player submits, the host builds a `ConversationPlayerInput` that carries the `PlacementQuestionnaireResponse` in its payload and sends it through the normal turn-submission flow — the Observer middleware (Epic 10 Story 10.5) recognizes it and routes to the scoring engine.
4. Register the component via a new plugin contribution kind (or extend an existing one — `design.section` is probably sufficient, but flag during implementation if a dedicated "conversation.ui-primitive" contribution is warranted)

**Tests Required:**

- Unit test with a React testing library: the component renders a fixture questionnaire with all four question kinds and shows the expected fields
- Unit test: the "Submit" button is disabled until the minimum-answers threshold is met
- Unit test: selecting a multiple-choice answer updates the internal state
- Unit test: typing free-text updates the internal state
- Unit test: clicking "Skip this one" marks the question as skipped in the response
- Integration test: a full form-fill flow produces a valid `PlacementQuestionnaireResponse` that passes the scoring engine

**API Documentation Update:**

- `docs/api/editor-contributions.md`: new "Placement Questionnaire Panel" subsection
- `docs/api/placement-contract.md`: cross-reference the UI component as the runtime-side placement interface
- `docs/api/middlewares.md`: document the conversation-host's placement-phase UI switch

**Acceptance Criteria:**

- The component renders every question kind correctly
- Submission produces a valid `PlacementQuestionnaireResponse`
- The visual feel is diegetic (not a modal pop-up)
- Keyboard navigation works (tab through fields, enter to submit)

### Story 11.3: Implement the placement flow orchestrator

**Purpose:** The small state machine that moves the player through the three-phase placement flow and emits the completion signals. This logic is split between the Context middleware (phase detection) and the Observer middleware (scoring trigger), so this story is primarily about defining the state transitions and making sure the annotations are read and written consistently.

**Tasks:**

1. Define the state machine in `runtime/placement/placement-flow-orchestrator.ts`:
   ```
   States: not-active → opening-dialog → questionnaire → closing-dialog → completed
   Transitions:
     not-active: default; fires when SUGARLANG_PLACEMENT_STATUS_FACT.status === "completed" OR selection.metadata?.sugarlangRole !== "placement"
     → opening-dialog: fires on first player turn with a placement-tagged NPC when fact is not completed
     → questionnaire: fires after 2 turns of opening dialog
     → closing-dialog: fires after the questionnaire is submitted and scored
     → completed: fires after 2 turns of closing dialog
   ```
2. Implement `advancePlacementPhase(currentPhase, context): NextPhase` as a pure function. The Context middleware (Epic 10 Story 10.1) calls this to compute the next phase from the current one + session state.
3. Implement `onPlacementComplete(scoreResult, reducer, questManager, blackboard): Promise<void>`:
   - Applies `PlacementCompletionEvent` to the reducer (updates `LearnerProfile.assessment`, seeds FSRS cards from `lemmasSeededFromFreeText`, writes `SUGARLANG_PLACEMENT_STATUS_FACT`)
   - Calls `questManager.setFlag("sugarlang.placement.status", "completed")`
   - Calls `questManager.notifyEvent("sugarlang.placement.completed")`
   - Emits a `placement.completed` telemetry event with the full score result
4. Implement `buildPlacementCompletionEvent(scoreResult, learnerProfile): PlacementCompletionEvent` as a helper that constructs the reducer event payload — including the per-lemma observations to be applied (one `produced-typed` per lemma in `lemmasSeededFromFreeText`)

**Tests Required:**

- Unit test per phase transition: given the current state + context, the orchestrator returns the expected next state
- Unit test: `advancePlacementPhase` is pure (same inputs → same output)
- Integration test: `onPlacementComplete` applies the expected reducer event, writes the expected fact, and fires the expected quest signals
- Integration test: the full orchestrator-driven flow advances through all four phases correctly

**API Documentation Update:**

- `docs/api/placement-contract.md`: "Placement flow state machine" section with the phase diagram and transition rules

**Acceptance Criteria:**

- State machine logic is pure and unit-tested
- Completion emits all expected signals in order
- The phase progression matches Proposal 001 § Cold Start Sequence

### Story 11.4: FSRS seeding from placement free-text

**Purpose:** When the placement scoring engine extracts `lemmasSeededFromFreeText`, those lemmas should be seeded into the learner's FSRS cards as `produced-typed` observations. This gives the learner a small but real head-start on productive vocabulary — better than cold-start zero.

**Tasks:**

1. Inside the `PlacementCompletionEvent` handler in the reducer (Epic 7 Story 7.5), after writing the assessment fields, iterate `lemmasSeededFromFreeText`:
   - For each lemma, check if a `LemmaCard` exists; if not, seed one from CEFRLex priors (Epic 8 Story 8.1)
   - Apply a synthetic `produced-typed` observation via `applyOutcome` (Epic 8 Story 8.1) — this bumps both FSRS stability and productive strength
   - Log a `fsrs.seeded-from-placement` telemetry event per lemma
2. The reducer event handler is already implemented in Epic 7 Story 7.5 — this story only adds the seeding logic inside the existing `PlacementCompletionEvent` branch
3. Because the seeding is deterministic (given the same free-text answers, the same lemmas get the same delta), the resulting learner state is reproducible across runs

**Tests Required:**

- Unit test: applying a `PlacementCompletionEvent` with 3 lemmas in `lemmasSeededFromFreeText` results in 3 FSRS cards with elevated `stability` and `productiveStrength`
- Unit test: seeded lemmas that are unknown to the atlas fall back to generic seeds rather than failing
- Unit test: the `fsrs.seeded-from-placement` telemetry event is emitted once per seeded lemma
- Integration test: a complete placement scenario with a real free-text answer seeds the expected cards end-to-end

**API Documentation Update:**

- `docs/api/learner-state.md`: "Placement seeding" subsection documenting how the free-text answers flow into FSRS state
- `docs/api/telemetry.md`: add the `fsrs.seeded-from-placement` event kind

**Acceptance Criteria:**

- Cards are seeded correctly
- Telemetry fires per seeded lemma
- The learner arrives in normal gameplay with a small amount of real productive evidence, not zero

### Story 11.5: Replay inertness

**Purpose:** Ensure that talking to the placement NPC again after placement completes does NOT re-run the questionnaire. The NPC becomes a normal agent NPC.

**Tasks:**

1. In the Context middleware (Epic 10 Story 10.1), the placement-detection logic already short-circuits when `SUGARLANG_PLACEMENT_STATUS_FACT.status === "completed"` — verify that branch is implemented correctly
2. Add a dedicated regression test: boot a runtime where the placement fact is already `"completed"`, have the player open a conversation with an NPC tagged `sugarlangRole: "placement"`, and assert:
   - `execution.annotations["sugarlang.placementFlow"]` is NOT set (or is set to `{ phase: "not-active" }`)
   - The normal Budgeter → Director → Generator → Verify → Observe pipeline runs
   - The NPC responds as a normal agent NPC (no questionnaire UI, no opening/closing dialog wrapper phases)
3. Document the replay-inertness guarantee in the API reference

**Tests Required:**

- Unit test: `isInPlacementFlow(selection, placementStatusFact)` returns false when the fact is completed
- Integration test: a completed-state learner has a normal conversation with the placement NPC without triggering the questionnaire
- Integration test: the normal pipeline's full machinery (Budgeter, Director, etc.) runs for this conversation

**API Documentation Update:**

- `docs/api/placement-contract.md`: "Replay inertness" subsection

**Acceptance Criteria:**

- Replay does not re-run placement
- The NPC behaves as a normal agent after the initial placement
- Regression test passes

### Story 11.6: Placement configuration surface

**Purpose:** Make placement thresholds and feature flags configurable via the plugin config so game authors can tune the feel or disable placement entirely.

**Tasks:**

1. Extend `SugarLangPluginConfig` in `config.ts` to include:
   ```ts
   placement: {
     enabled: boolean;                            // default true; false skips placement entirely and defaults to CEFRLex priors
     minAnswersForValid: number | "use-bank-default";  // default "use-bank-default" (use the bank's built-in threshold)
     confidenceFloor: number;                     // default 0.3 (below this, log a warning but accept the result)
     openingDialogTurns: number;                  // default 2
     closingDialogTurns: number;                  // default 2
   }
   ```
2. Validate and normalize the config in `normalizeSugarLangPluginConfig`
3. Plumb the config into the Context middleware (Epic 10 Story 10.1) and the scoring engine (Story 11.1)
4. When `placement.enabled: false`, the plugin ignores the placement tag entirely and treats every NPC as a normal agent NPC from the start. The learner profile's initial CEFR posterior is set from the self-report (if provided) or defaults to A1. Document this in the API reference.

**Tests Required:**

- Unit test: custom `openingDialogTurns` is honored
- Unit test: custom `minAnswersForValid` overrides the bank's default
- Unit test: `enabled: false` disables placement activation entirely — the `sugarlangRole` tag is observed as inert
- Unit test: config normalization handles missing fields with sensible defaults

**API Documentation Update:**

- `docs/api/placement-contract.md`: "Configuration" section with each field documented
- `docs/api/README.md`: cross-reference the plugin config

**Acceptance Criteria:**

- Config plumbing is complete
- Disable flag works as expected
- Normalization handles partial configs

### Story 11.7: v1 scope boundaries documentation

**Purpose:** Explicitly document what the v1 placement capability does and does NOT support, so engineers don't accidentally implement v1.1 features and so content authors know what they can rely on.

**Tasks:**

1. Add a "v1 Scope Boundaries" section to `docs/api/placement-contract.md` explicitly listing:
   - **What v1 supports:**
     - One canonical plugin-shipped questionnaire per supported language
     - Any NPC can be tagged as the placement NPC via `metadata.sugarlangRole = "placement"`
     - Three-phase flow: opening-dialog → questionnaire → closing-dialog
     - Deterministic scoring with CEFR estimate + confidence
     - FSRS seeding from free-text answers
     - Replay inertness (one placement per learner per language)
     - Quest integration via `setFlag` + `notifyEvent`
     - Placement can be disabled entirely via plugin config
   - **What v1 does NOT support (deferred to v1.1 or later):**
     - Per-NPC custom questionnaires (`NPCDefinition.metadata.sugarlangPlacementQuestionnaireOverrideId` is reserved but ignored)
     - Per-project custom questionnaires (projects inherit the plugin's shipped bank)
     - Re-placement after the initial completion (players cannot currently re-evaluate themselves)
     - Adaptive question selection (the form is all-at-once, not branching)
     - Multi-session placement (placement must complete in a single session)
     - Audio or visual questions (text-only)
     - Per-learner question customization based on prior knowledge
     - Partial-credit scoring (each question is pass/fail at its band)
2. Add a short note in Epic 11's Exit Criteria pointing to this v1 scope document
3. Add the same boundary table to the Welcome to Wordlark Hollow content plan so authors reading that plan see the constraints in their context

**Tests Required:** none (documentation only)

**API Documentation Update:**

- `docs/api/placement-contract.md`: "v1 Scope Boundaries" section as described above
- Cross-reference from `000-roadmap.md` (optional) and Welcome to Wordlark Hollow plan (mandatory)

**Acceptance Criteria:**

- A developer reading the docs can answer "what's in v1?" without reading source code
- The scope boundaries are consistent between the API doc, Epic 11's context, and the Wordlark Hollow plan

## Risks and Open Questions

- **UI primitive plugin contribution shape**: does Studio support a "conversation-host UI override" contribution kind, or does the placement UI need to piggyback on the existing `design.section` mechanism? Flag during implementation — may require a small runtime-core extension
- **Questionnaire persistence on mid-form disconnect**: if the player closes the game mid-form, do we save the partial answers or discard them on next boot? v1 default: discard (the player restarts the form). v1.1 could persist
- **Native-speaker review requirement for the question banks**: the question text must be reviewed by someone who speaks the target language fluently. This is content work, not engineering. Flag in the prerequisites as a content-authoring dependency
- **Accessibility**: the form UI should support keyboard navigation and screen readers. Not a v1 blocker but worth flagging in Story 11.2's acceptance criteria
- **Time budget for placement**: target ≤5 minutes from arrival to placement completion. If the form takes longer, the player may feel the ramp-up is too long. Playtest to validate

## Exit Criteria

Epic 11 is complete when:

1. All seven stories are complete
2. All tests pass (unit tests for the scoring engine, integration tests for the flow orchestrator, UI component tests for the questionnaire panel)
3. Replay inertness is verified
4. Configuration surface works including the `enabled: false` kill switch
5. `docs/api/placement-contract.md` is complete with scoring algorithm, flow state machine, configuration, and v1 scope boundaries
6. `tsc --noEmit` passes
7. This file's `Status:` is updated to `Complete`
8. At this point, the plugin is **functionally complete for placement**, and content teams can begin authoring placement NPC cards and dialog wrappers per Plan 001 (Welcome to Wordlark Hollow)
