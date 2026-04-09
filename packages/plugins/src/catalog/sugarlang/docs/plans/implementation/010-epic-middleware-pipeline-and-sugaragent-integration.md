# Epic 10: Middleware Pipeline and SugarAgent Integration

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § End-to-End Turn Flow](../../proposals/001-adaptive-language-learning-architecture.md#end-to-end-turn-flow)
**Depends on:** Epic 2 (NPCDefinition.metadata), Epic 3, Epic 5, Epic 6, Epic 7, Epic 8, Epic 9
**Blocks:** Epic 11 (Placement), Epic 13 (Telemetry wiring), Epic 14 (E2E tests)

## Context

This epic wires every component built in earlier epics into the existing `ConversationMiddleware` pipeline and splices the single `execution.annotations["sugarlang.constraint"]` read into SugarAgent's `GenerateStage`. This is where sugarlang becomes a functional plugin that actually affects conversations.

> **Canonical annotation key list:** every `execution.annotations["sugarlang.*"]` key and every `session.state["sugarlang.*"]` key used by this epic is documented in Proposal 001 § Annotation Namespace Reference. That section is the single source of truth. This epic's stories describe WHERE the keys are written/read; the proposal describes WHAT the keys are. If a story in this epic mentions an annotation key that does not appear in the proposal's reference, the story is wrong and should be fixed (not the other way around). Epic 15 Story 15.11 enforces this via an architectural test that parses the proposal file at runtime.

Four middlewares are contributed by sugarlang, each with a single responsibility:

- **`SugarLangContextMiddleware`** — `prepare()`/context stage, priority 10 — reads learner state + scene lexicon, calls the Budgeter, writes `execution.annotations["sugarlang.prescription"]`
- **`SugarLangDirectorMiddleware`** — `prepare()`/policy stage, priority 30 — reads the prescription, calls the Director (cache-first), merges directive + prescription → final constraint, writes `execution.annotations["sugarlang.constraint"]`
- **`SugarLangVerifyMiddleware`** — `finalize()`/analysis stage, priority 20 — runs the Envelope Classifier, triggers repair if out-of-envelope, mutates the turn text if necessary
- **`SugarLangObserveMiddleware`** — `finalize()`/analysis stage, priority 90 — extracts observations, feeds them to `LearnerStateReducer`, emits telemetry

The single SugarAgent modification is a ~6-line splice in `GenerateStage.execute()` that reads the constraint annotation and injects target vocabulary instructions into the system prompt.

This epic is the riskiest in the roadmap. It's where the full pipeline comes together for the first time, and where the interaction between Budgeter, Director, Verifier, and Observer can surface bugs that weren't visible in isolation. Expect iteration.

## Prerequisites

- Epic 2 (`NPCDefinition.metadata` flows into `selection.metadata`)
- Epic 3 (types)
- Epic 5 (Classifier — needed by Verify middleware)
- Epic 6 (Scene lexicon store — needed by Context middleware)
- Epic 7 (Learner state reducer — needed by Observe middleware)
- Epic 8 (Budgeter — needed by Context middleware)
- Epic 9 (Director — needed by Director middleware)

## Success Criteria

- All four middlewares implemented and registered as `conversation.middleware` contributions
- SugarAgent `GenerateStage` reads the constraint annotation and splices it into the prompt
- End-to-end: a conversation with an agent-mode NPC runs the full sugarlang pipeline without errors
- Annotation namespace discipline (`sugarlang.*` reserved keys) enforced and documented
- Verification loop works: out-of-envelope turns trigger repair or auto-simplify
- Observation loop works: every turn updates learner state
- Integration tests cover the full pipeline with mocked Claude
- API documentation is complete

## Stories

### Story 10.1: Implement `SugarLangContextMiddleware`

**Purpose:** The prepare/context stage — loads everything sugarlang needs for the current turn and hands off to the Director middleware.

**Tasks:**

1. Implement `createSugarLangContextMiddleware(deps: SugarLangContextMiddlewareDeps): ConversationMiddleware` factory
2. `deps` includes: `budgeter`, `sceneLexiconStore`, `learnerStore`, `logger`
3. `prepare(execution)` flow:
   - Early-exit if `execution.selection.targetLanguage` is absent (no sugarlang work to do)
   - **Placement flow detection** (Proposal 001 § Cold Start Sequence): check `execution.selection.metadata?.sugarlangRole === "placement"` AND read `SUGARLANG_PLACEMENT_STATUS_FACT` from the blackboard.
     - If the tag is absent or the fact already says `"completed"`, skip the placement flow — treat as a normal conversation.
     - If the tag is present and the fact is NOT completed, compute the current placement phase: look at session state for `session.state["sugarlang.placementPhase"]`. If unset, this is the first turn with the placement NPC → phase is `"opening-dialog"`. If set to `"opening-dialog"` and the player has just tapped through 2 turns of dialog, advance to phase `"questionnaire"`. If set to `"questionnaire"` and the questionnaire has been submitted (checked via an annotation from the UI), advance to phase `"closing-dialog"`. If set to `"closing-dialog"` and 2 turns have passed, placement completes.
     - Write `execution.annotations["sugarlang.placementFlow"] = { phase, questionnaireVersion?, scoreResult? }`. The conversation host reads this annotation to decide whether to render the normal dialog UI or the questionnaire UI.
     - **If phase is `"questionnaire"`**, the rest of the `prepare()` flow is SHORT-CIRCUITED. Do not run the Budgeter, do not compute pending provisional, do not compute quest-essential, do not set up a normal constraint. The UI shows the form; there is no NPC turn being generated. Return an empty constraint with a `placementFlow` annotation.
     - **If phase is `"opening-dialog"`**, the rest of the `prepare()` flow is ALSO SHORT-CIRCUITED per the Pre-Placement Opening Dialog Policy (Proposal 001 § Pre-Placement Opening Dialog Policy — canonical). Specifically:
       - Do NOT call the Budgeter
       - Write a synthetic empty prescription to `execution.annotations["sugarlang.prescription"]`: `{ introduce: [], reinforce: [], avoid: [], budget: { newItemsAllowed: 0 }, rationale: { summary: "Pre-placement opening dialog — no prescription needed.", candidateSetSize: 0, envelopeSurvivors: 0 } }`
       - Read the NPC's authored opening lines from its bio/lore content data. For v1, pick the first line deterministically; v1.1 can randomize across visits.
       - Write the line into a staging annotation `execution.annotations["sugarlang.prePlacementOpeningLine"] = { text, lang: <supportLanguage>, lineId }` that the Director middleware will then propagate into the final constraint's `prePlacementOpeningLine` sub-field
       - Do NOT compute `pendingProvisionalLemmas`, `probeFloorState`, `activeQuestEssentialLemmas`, or any other Director-context field. The Director isn't going to run.
       - Emit a telemetry event `pre-placement.opening-dialog-turn` with the line id and the current placement phase
       - The rest of the middleware chain (Director middleware, Verify middleware, etc.) detects `constraint.prePlacementOpeningLine` and continues their own short-circuits
     - **If phase is `"closing-dialog"`**, continue normally through the rest of the `prepare()` flow — the NPC is speaking a personalized comment about the placement result, and the full pipeline runs with the now-known CEFR estimate. The Director makes real decisions here.
   - Look up the current scene id from `execution.runtimeContext` (which scene the player is in)
   - Load the compiled scene lexicon via `sceneLexiconStore.ensure(sceneId)` (may trigger lazy compile)
   - Read the current learner profile via `learnerStore.getCurrentProfile()`
   - **Run `DecayProvisionalEvidenceEvent`** through the reducer for the current session turn (Epic 7 Story 7.5) — zeros provisional evidence on any cards past the age threshold
   - **Compute `pendingProvisionalLemmas`** from the current learner profile — walk the profile's cards, collect those with `provisionalEvidence > 0`, sort by `provisionalEvidenceFirstSeenTurn` ascending (oldest first)
   - **Compute `probeFloorState`**:
     - `turnsSinceLastProbe` comes from a session-scoped counter (stored on the blackboard or in the learner profile's current session signals)
     - `totalPendingLemmas = pendingProvisionalLemmas.length`
     - `softFloorReached = turnsSinceLastProbe >= 15 AND totalPendingLemmas >= 5`
     - `hardFloorReached` — true if `turnsSinceLastProbe >= 25`, OR if any pending lemma has `turnsPending >= 25`; set `hardFloorReason` accordingly
   - Call `budgeter.prescribe({ scene, learner, conversation })` → `LexicalPrescription`
   - Write `execution.annotations["sugarlang.prescription"] = prescription`
   - Write `execution.annotations["sugarlang.learnerSnapshot"] = learnerSnapshotForPrompts` (a compact summary used by the Director prompt-builder)
   - **Write `execution.annotations["sugarlang.pendingProvisionalLemmas"] = pendingProvisionalLemmas`** and **`execution.annotations["sugarlang.probeFloorState"] = probeFloorState`** so the Director middleware can build the Director context with them
   - **If `hardFloorReached` is true**, also write `execution.annotations["sugarlang.forceComprehensionCheck"] = true` — this is the flag the Director middleware and schema-parser both honor
   - **Compute `activeQuestEssentialLemmas`** (Proposal 001 § Quest-Essential Lemma Exemption):
     - Read `runtimeContext.activeQuestObjectives` from the blackboard (the list of currently-active objective nodes)
     - Build a set of `sourceObjectiveNodeId` values from the active objectives
     - Walk `sceneLexicon.questEssentialLemmas` and filter to entries whose `sourceObjectiveNodeId` is in the active set
     - For each surviving entry, compute the `supportLanguageGloss` by querying the atlas (`atlas.getLemma(lemmaId, supportLanguage)`) — this is the translation that will appear in the Generator's parenthetical. If no gloss exists, fall back to the `sourceObjectiveDisplayName` extract or the bare English/support-language word from the objective text.
     - Write `execution.annotations["sugarlang.activeQuestEssentialLemmas"] = activeQuestEssentialLemmas`
     - Write `execution.annotations["sugarlang.questEssentialLemmaIds"] = new Set(lemmaIds)` as a fast-lookup set for downstream middlewares (the Verify middleware in Story 10.4 passes this to the classifier)
4. Stage: `"context"`, priority: `10` (runs before policy stage)
5. Handle errors: if scene lexicon compile fails, log and skip sugarlang for this turn (do NOT throw — conversation should continue even without sugarlang)

**Tests Required:**

- Unit test with mocks: middleware runs end-to-end and writes the expected annotations
- Unit test: missing targetLanguage early-exits without error
- Unit test: failed scene lexicon load logs and skips without throwing
- Integration test: runs against real Budgeter + fake scene lexicon + fake learner

**API Documentation Update:**

- `docs/api/middlewares.md`: full Context middleware reference, annotation keys written, execution contract

**Acceptance Criteria:**

- Middleware is correctly registered and fires at stage="context", priority=10
- Annotations flow to the Director middleware
- Failure modes are handled gracefully

### Story 10.2: Implement `SugarLangDirectorMiddleware`

**Purpose:** The prepare/policy stage — invokes the Director with the Context middleware's prescription, merges directive + prescription, writes the final constraint annotation.

**Tasks:**

1. Implement `createSugarLangDirectorMiddleware(deps: SugarLangDirectorMiddlewareDeps): ConversationMiddleware`
2. `deps` includes: `director`, `logger`, `telemetrySink`
3. `prepare(execution)` flow:
   - Read `execution.annotations["sugarlang.prescription"]`; if absent, early-exit (Context middleware didn't run, so sugarlang is disabled for this turn)
   - **Pre-placement opening dialog short-circuit** (Proposal 001 § Pre-Placement Opening Dialog Policy): if `execution.annotations["sugarlang.prePlacementOpeningLine"]` is set (written by the Context middleware in Story 10.1), the Director middleware SHORT-CIRCUITS. It does NOT call Claude. It does NOT call `ClaudeDirectorPolicy.invoke`. It writes a synthetic directive with the exact fields specified in Proposal 001 § Pre-Placement Opening Dialog Policy (targetVocab empty, targetLanguageRatio 0, glossingStrategy none, interactionStyle listening_first, sentenceComplexityCap single-clause, comprehensionCheck.trigger false, isFallbackDirective false, citedSignals `["pre-placement-opening-dialog"]`, rationale "Pre-placement opening dialog — pipeline bypassed."). It then builds the final `SugarlangConstraint` with the synthetic directive's fields AND propagates `prePlacementOpeningLine` from the Context middleware's annotation into `constraint.prePlacementOpeningLine`. Writes `execution.annotations["sugarlang.constraint"]` and `execution.annotations["sugarlang.directive"]` as usual. Emits telemetry `director.pre-placement-bypass` for audit. **No Claude call made.**
   - Otherwise (normal case): Build `DirectorContext` from execution + prescription + learner snapshot + scene context **+ `pendingProvisionalLemmas` and `probeFloorState` from Context middleware's annotations + `activeQuestEssentialLemmas` from Context middleware's annotations**
   - Call `director.invoke(directorContext)` → `PedagogicalDirective`
   - **If the directive has `comprehensionCheck.trigger === true`**, populate the `comprehensionCheckInFlight` sub-field on the final constraint (see below) with the target lemmas, probe style, character voice reminder (a short extract from the current NPC's bio), and trigger reason
   - **If the hard floor was reached and the Director's returned directive still has `trigger === false`** (i.e., the schema-parser caught this and fell back to `FallbackDirectorPolicy` inside `director.invoke`), the final directive already has `trigger === true` per the fallback logic — no additional handling needed here, but emit a `comprehension.director-hard-floor-violated` telemetry event for visibility
   - Merge directive + prescription into the final `SugarlangConstraint` (the constraint is what the Generator reads):
     ```
     {
       targetVocab: directive.targetVocab,
       supportPosture: directive.supportPosture,
       targetLanguageRatio: directive.targetLanguageRatio,
       interactionStyle: directive.interactionStyle,
       glossingStrategy: directive.glossingStrategy,
       sentenceComplexityCap: directive.sentenceComplexityCap,
       targetLanguage: selection.targetLanguage,
       learnerCefr: learnerSnapshot.cefrBand,
       comprehensionCheckInFlight: directive.comprehensionCheck.trigger
         ? {
             active: true,
             probeStyle: directive.comprehensionCheck.probeStyle,
             targetLemmas: directive.comprehensionCheck.targetLemmas,
             characterVoiceReminder: extractCharacterVoiceReminder(scene.npc),
             triggerReason: directive.comprehensionCheck.triggerReason
               ?? "director-discretion",
           }
         : undefined,
       rawPrescription: prescription,  // for telemetry, not used by Generator
     }
     ```
   - Write `execution.annotations["sugarlang.constraint"] = constraint`
   - Write `execution.annotations["sugarlang.directive"] = directive` (for observe middleware telemetry)
   - **If `comprehensionCheckInFlight` is set**, also set `execution.annotations["sugarlang.comprehensionCheckInFlight"] = true` as a simple boolean flag so the Observer middleware can detect probe-in-flight without having to dig through the full constraint object. Emit `comprehension.probe-triggered` telemetry with full payload (reason, target lemmas, NPC, character voice, scene).
   - **If `activeQuestEssentialLemmas` is non-empty**, populate `constraint.questEssentialLemmas` by mapping each `ActiveQuestEssentialLemma` to the constraint's simpler `{ lemmaRef, sourceObjectiveDisplayName, supportLanguageGloss }` shape. The Generator splice (Story 10.3) reads this to produce parenthetical translations.
   - Emit `quest-essential.director-forced-glossing` telemetry if the schema-parser enforcement kicked in (the Director had chosen a weaker glossing strategy and was corrected).
4. Stage: `"policy"`, priority: `30` (runs after all context middlewares, before SugarAgent provider)

**Tests Required:**

- Unit test: director returns a directive → constraint is correctly assembled
- Unit test: director invocation fails → fallback policy kicks in inside the director → still produces a valid constraint
- Unit test: missing prescription early-exits without error
- Integration test: full pipeline with mocked Claude for the director call

**API Documentation Update:**

- `docs/api/middlewares.md`: Director middleware reference with the constraint merge logic documented

**Acceptance Criteria:**

- Middleware runs at stage="policy", priority=30
- Constraint annotation is correctly assembled
- Failure is handled via the Director's own fallback

### Story 10.3: Splice `GenerateStage` to read the constraint annotation

**Purpose:** The single modification to SugarAgent. Add ~6 lines to `GenerateStage.execute()` that read `execution.annotations["sugarlang.constraint"]` and inject target vocabulary instructions into the existing system prompt.

**Tasks:**

1. Locate `packages/plugins/src/catalog/sugaragent/runtime/stages/GenerateStage.ts` (file path confirmed in Phase 1 exploration)
2. Before the system/user prompt builders run, read the sugarlang constraint:
   ```ts
   const constraint = execution.annotations["sugarlang.constraint"] as SugarlangConstraint | undefined;
   ```
2a. **Pre-placement opening dialog bypass** (Proposal 001 § Pre-Placement Opening Dialog Policy): if `constraint?.prePlacementOpeningLine` is set, the Generate stage SHORT-CIRCUITS. It does NOT assemble prompts, does NOT call the LLM, does NOT run the Audit or Repair stages. It constructs and returns a `ConversationTurnEnvelope` directly:
   ```ts
   if (constraint?.prePlacementOpeningLine) {
     return {
       turnId: generateTurnId(),
       providerId: "sugaragent",
       conversationKind: "free-form",
       speakerId: execution.selection.npcDefinitionId,
       speakerLabel: execution.selection.npcDisplayName,
       text: constraint.prePlacementOpeningLine.text,
       choices: [],
       inputMode: "advance",
       inputPlaceholder: undefined,
       proposedActions: [],
       metadata: {
         "sugarlang.prePlacementOpeningLine.lineId": constraint.prePlacementOpeningLine.lineId,
       },
       annotations: execution.annotations,
       diagnostics: { prePlacementBypass: true, llmCallsMade: 0 },
     };
   }
   ```
   This is the **zero-LLM-call path** for the opening dialog phase. The Verify middleware will also short-circuit when it sees the same `prePlacementOpeningLine` field, so no envelope check runs either. Emit telemetry `generator.pre-placement-bypass` for audit.
3. If present, append to the system prompt (immediately after the existing rules, before the dialogue context):
   ```
   Language constraint: Reply primarily in ${constraint.targetLanguage}.
   Must-use vocabulary (weave naturally into your reply): ${constraint.targetVocab.reinforce.join(", ")}.
   New vocabulary to introduce this turn (use each exactly once, clearly in context): ${constraint.targetVocab.introduce.join(", ")}.
   Forbidden vocabulary (use simpler synonyms): ${constraint.targetVocab.avoid.slice(0, 12).join(", ")}.
   CEFR envelope: learner is ${constraint.learnerCefr}; keep ≥95% of lemmas at or below ${constraint.learnerCefr}+1 band.
   Support posture: ${constraint.supportPosture}. Target-language ratio: ${constraint.targetLanguageRatio}. Sentence complexity: ${constraint.sentenceComplexityCap}.
   ```
3a. **When `constraint.comprehensionCheckInFlight` is present**, additionally append the probe instruction block (Proposal 001 § Observer Latency Bias):
   ```
   COMPREHENSION CHECK — THIS TURN MUST INCLUDE A PROBE:
   
   After speaking naturally in character, include a short in-character question that
   elicits a response demonstrating comprehension of one or more of these lemmas:
     ${constraint.comprehensionCheckInFlight.targetLemmas.map(l => l.lemmaId).join(", ")}
   
   Probe style: ${constraint.comprehensionCheckInFlight.probeStyle}
   Character voice reminder: ${constraint.comprehensionCheckInFlight.characterVoiceReminder}
   
   IMPORTANT:
   - Stay in character. The probe should feel like something this NPC would naturally say.
   - The probe does NOT need to be narratively tied to the rest of your reply.
     A non-sequitur is fine — e.g. a merchant musing about cheese can naturally ask
     "¿entiendes?" or "¿y a ti también te gusta?" without breaking character.
   - Good phrasings: "¿entiendes?", "¿qué piensas tú?", "y tú, ¿cómo lo ves?",
     "dime, ¿qué harías?"
   - Bad phrasings (do NOT use these): "What does this word mean?", "Can you use it in
     a sentence?", "Now tell me what I just said". These sound like a language class.
   - The probe should be the LAST thing in your reply so the player knows to respond to it.
   ```
3b. When the probe instruction block is present, also adjust the existing constraint: the NPC's reply should be slightly SHORTER than usual so the probe is not lost at the bottom of a wall of text. Add: `Reply length constraint: keep the reply to 2–3 sentences including the probe question.`

3c. **When `constraint.questEssentialLemmas` is non-empty** (Proposal 001 § Quest-Essential Lemma Exemption), additionally append the quest-essential instruction block:
   ```
   QUEST-ESSENTIAL VOCABULARY — MANDATORY PARENTHETICAL GLOSSING:
   
   The player's currently-active quest objective contains words that are above their
   normal CEFR level. They have been classifier-exempted, which means you may use them
   freely. However, the player cannot understand them natively, so you MUST provide an
   inline parenthetical translation immediately after the first use of each such word
   this turn.
   
   Quest-essential words for this turn:
   ${constraint.questEssentialLemmas.map(q => `- ${q.lemmaRef.lemmaId} → "(${q.supportLanguageGloss})"`).join("\n")}
   
   REQUIREMENTS:
   - If your reply needs to reference the current quest objective, you MUST use at least
     one of these words.
   - Every quest-essential word used MUST be immediately followed by a parenthetical
     with the support-language translation.
   - Example (Spanish → English support):
       "Ve al altar (the altar) que está detrás del templo."
   - Bad example (no parenthetical):
       "Ve al altar que está detrás del templo."  ← player doesn't know "altar"
   - Bad example (parenthetical in wrong position):
       "Ve al templo. El altar está detrás (the altar)."  ← gloss should be next to the word
   
   The parenthetical translation is the ONLY way the player will understand these words.
   Skipping it breaks the quest.
   ```
3d. When quest-essential lemmas are present, the Verify middleware (Story 10.4) will check that the generated text contains the expected parenthetical pattern for each quest-essential lemma used. If the Generator used a quest-essential lemma without a parenthetical, the Verify middleware triggers a repair with an even more explicit instruction.
4. When the constraint is absent, `GenerateStage` behaves exactly as it does today — no sugarlang code runs, no behavior change. Backwards compatible.
5. Import `SugarlangConstraint` type from the sugarlang package (this creates a one-way dependency from sugaragent to sugarlang types only, which is acceptable under AGENTS.md "one-way dependencies" discipline — justify in a comment)

**Tests Required:**

- Unit test: `GenerateStage.execute` with no sugarlang constraint produces the same prompt as today (regression)
- Unit test: `GenerateStage.execute` with a constraint produces a system prompt containing the constraint strings
- Snapshot test: a fixture scenario produces a stable, reviewable system prompt
- Integration test: SugarAgent end-to-end with a mocked LLM and a sugarlang constraint generates a turn using the expected vocabulary

**API Documentation Update:**

- `docs/api/middlewares.md`: "SugarAgent splice" section documenting the exact change to GenerateStage and the annotation contract
- `packages/plugins/src/catalog/sugaragent/docs/` (if exists) or a comment in `GenerateStage.ts` explaining the cross-plugin dependency

**Acceptance Criteria:**

- SugarAgent runs identically to today when sugarlang is disabled (no annotation)
- SugarAgent runs with sugarlang's constraint when the annotation is present
- Regression tests pass
- The import dependency is minimal and justified

### Story 10.4: Implement `SugarLangVerifyMiddleware`

**Purpose:** The finalize/analysis stage that runs the Envelope Classifier on the generated turn text and triggers repair or auto-simplify if out-of-envelope.

**Tasks:**

1. Implement `createSugarLangVerifyMiddleware(deps: SugarLangVerifyMiddlewareDeps): ConversationMiddleware`
2. `deps` includes: `classifier`, `llm` (for the repair call), `logger`, `telemetrySink`
3. `finalize(execution, turn)` flow:
   - Read the constraint from `execution.annotations["sugarlang.constraint"]`; early-exit if absent
   - **Pre-placement opening dialog bypass** (Proposal 001 § Pre-Placement Opening Dialog Policy): if `constraint.prePlacementOpeningLine` is set, the Verify middleware SHORT-CIRCUITS. The turn text is a support-language authored line with no target-language lemmas to validate. The envelope rule is trivially satisfied. Do NOT call the Classifier. Do NOT trigger repair. Do NOT run auto-simplify. Return the turn unchanged. Emit telemetry `verify.pre-placement-bypass`.
   - Extract known entities directly from `CompiledSceneLexicon.properNouns` by loading the current scene lexicon via the `SugarlangSceneLexiconStore` (Epic 6 Story 6.11). (Earlier drafts of this story incorrectly referenced `execution.annotations["sugarlang.sceneProperNouns"]` as if the Context middleware wrote it — it doesn't. The proper nouns live on the compiled scene lexicon; read them from there.)
   - **Build the `questEssentialLemmas` set** from `execution.annotations["sugarlang.questEssentialLemmaIds"]` (fast-lookup set written by the Context middleware in Story 10.1)
   - Call `classifier.check(turn.text, learnerSnapshot, { prescription: constraint.rawPrescription, knownEntities, questEssentialLemmas, lang: constraint.targetLanguage })` → verdict
   - **Quest-essential gloss verification:** if `constraint.questEssentialLemmas` is non-empty, for each quest-essential lemma used in the turn text, check that it is followed by a parenthetical in the support language (simple regex: `\b${lemma}\b\s*\([^)]*?${detectSupportLanguageContent}[^)]*?\)`). If a quest-essential lemma appears without a parenthetical, emit `quest-essential.generator-missed-gloss` telemetry and trigger a repair with an explicit instruction: "You used '${lemma}' without providing an inline parenthetical translation. Rewrite the turn, keeping the same meaning, and add `(${supportLanguageGloss})` immediately after '${lemma}'."
   - **Quest-essential usage requirement check:** if `constraint.questEssentialLemmas` is non-empty AND the active objective is clearly in focus (a heuristic — we check if the turn text references any quest-related concepts or if `runtimeContext.activeQuestObjectives` has a currently-focused objective) AND NONE of the quest-essential lemmas appear in the turn text, emit `quest-essential.generator-missed-required` telemetry and trigger a repair with a stronger instruction: "This reply does not mention the current quest objective '${objectiveDisplayName}'. Rewrite the turn to include at least one of the quest-essential words: ${lemmaList}."
   - If `verdict.withinEnvelope`, return the turn unchanged
   - Otherwise, attempt repair:
     - Build a repair prompt ("rewrite this keeping same meaning, remove these words: X, Y, use simpler synonyms from the learner's level")
     - Call the LLM (reuse the same Anthropic client as the Director or the SugarAgent Generator) for one retry
     - Re-run the classifier on the repaired text
     - If still out-of-envelope, run `autoSimplify(text, violations, learner, simplifications)` from Epic 5
   - Mutate `turn.text` to the (possibly repaired or auto-simplified) text
   - Emit a telemetry event per verification result (pass / repaired / auto-simplified)
4. Stage: `"analysis"`, priority: `20` (runs after the provider, before the observer)

**Tests Required:**

- Unit test: in-envelope turn passes through unchanged
- Unit test: out-of-envelope → repair succeeds → in-envelope
- Unit test: out-of-envelope → repair fails → auto-simplify → in-envelope
- Unit test: missing constraint early-exits without error
- Integration test: full pipeline with mocked LLM for the repair call, asserts the returned turn is always in-envelope

**API Documentation Update:**

- `docs/api/middlewares.md`: Verify middleware reference with the repair-and-fallback flow documented

**Acceptance Criteria:**

- Middleware always returns an in-envelope turn (or the original if no constraint is present)
- Repair retry budget is hard-capped at 1
- Auto-simplify is the deterministic last resort

### Story 10.5: Implement `SugarLangObserveMiddleware`

**Purpose:** The finalize/analysis stage that extracts implicit signals from the completed turn and the player input, builds `LemmaObservation` events, and routes them to `LearnerStateReducer`. Correctly discriminates production subkinds (`produced-typed`, `produced-chosen`, `produced-unprompted`, `produced-incorrect`) per Proposal 001 § Receptive vs. Productive Knowledge — the observer is the single place where raw input context gets classified into the correct observation kind.

**Tasks:**

1. Implement `createSugarLangObserveMiddleware(deps: SugarLangObserveMiddlewareDeps): ConversationMiddleware`
2. `deps` includes: `learnerStateReducer`, `telemetrySink`, `lemmatizer`, `morphologyValidator`, `logger`
3. `finalize(execution, turn)` flow:
   - Read the constraint and directive from `execution.annotations`
   - If absent, early-exit
   - **Pre-placement opening dialog short-circuit** (Proposal 001 § Pre-Placement Opening Dialog Policy): if `execution.annotations["sugarlang.placementFlow"]?.phase === "opening-dialog"`, the Observer middleware DOES NOT emit any `LemmaObservation` events, DOES NOT update FSRS state, DOES NOT update session signals (fatigue, hover rate, retry rate), and DOES NOT check for probe responses. The player is tapping through authored support-language dialog; there is nothing to observe. Emit telemetry `observer.pre-placement-bypass` and early-exit the rest of `finalize()`. 
   - **Check for placement questionnaire submission:** if `execution.annotations["sugarlang.placementFlow"]?.phase === "questionnaire"` AND the input carries a `placementQuestionnaireResponse` payload, route it to the placement scoring engine (Epic 11). Call `placementScoreEngine.score(questionnaire, response)` → `PlacementScoreResult`. Emit `PlacementCompletionEvent` through the reducer with the score result, target lemmas to seed, and any produced-typed observations from free-text fields. Write the placement fact, fire the quest event and flag. Set `session.state["sugarlang.placementPhase"] = "closing-dialog"` so the next turn transitions out. Early-exit the rest of `finalize` — there is no NPC turn to analyze, no probe to process, no observations beyond what the placement engine emitted.
   - **Check for comprehension-check-in-flight from the PREVIOUS turn:** read `session.state["sugarlang.lastTurnComprehensionCheck"]` (a small session-scoped piece of state the middleware persists between turns). If present, the player's current input is a probe response. Handle it:
     - Lemmatize `execution.input.text` (assuming free-text; handle other input kinds with the same classification rules as below)
     - For each `targetLemma` in the stored probe spec:
       - If the lemmatized response contains the target lemma in a valid form → the probe passes for that lemma
       - Otherwise → the probe fails for that lemma
     - If ALL target lemmas pass: emit `comprehension.probe-passed` telemetry; call `reducer.apply({ kind: "commit-provisional-evidence", targetLemmas: probeSpec.targetLemmas, probeTelemetry })`
     - If ALL target lemmas fail: emit `comprehension.probe-failed`; call `reducer.apply({ kind: "discard-provisional-evidence", targetLemmas: probeSpec.targetLemmas, probeTelemetry })`
     - If MIXED (some pass, some fail): partial-pass handling — commit the passed lemmas, discard the failed lemmas, emit `comprehension.probe-mixed-result` telemetry with both lists
     - If the response is in the support language only (e.g., a Spanish-learner replies in English): treat this as `comprehension.probe-language-fallback` — discard the evidence AND emit a telemetry event with the english-fallback flag. v1 does not attempt to semantically judge support-language responses; v1.1 may use a cheap Haiku call
     - Clear `session.state["sugarlang.lastTurnComprehensionCheck"]` so the probe is not re-processed
   - **If the CURRENT turn's constraint has `comprehensionCheckInFlight` set** (i.e., the NPC just asked a probe question this turn), store the probe spec in `session.state["sugarlang.lastTurnComprehensionCheck"]` so the next turn's observer handles the response
   - Reset `session.state["sugarlang.turnsSinceLastProbe"] = 0` when a probe is fired; increment by 1 on every other turn
   - **Extract player-input production signals from `execution.input`:**
     - If `execution.input.kind === "free_text"`:
       - Lemmatize the input text
       - For each lemma in the input:
         - Run the morphology validator to check if the surface form is a valid inflection of the lemma. If not → emit `{ kind: "produced-incorrect", attemptedForm, expectedForm }`
         - If it IS a valid form:
           - If the lemma is in `directive.targetVocab.reinforce` OR `directive.targetVocab.introduce` → emit `{ kind: "produced-typed", inputText: surfaceForm }` (the player typed a specifically-targeted word correctly)
           - If the lemma is NOT in any targetVocab list but IS a known lemma in the learner's card store → emit `{ kind: "produced-unprompted" }` (voluntary reach for a word the directive did not require)
           - If the lemma is unknown to the learner (no card yet) → emit `{ kind: "produced-unprompted" }` AND seed a fresh card via `learnerPriorProvider.getInitialLemmaCard` (the learner just introduced a new word to themselves — extraordinary evidence)
     - If `execution.input.kind === "choice"`:
       - Look up the chosen option from the conversation UI state; if the option's metadata identifies a specific target lemma, emit `{ kind: "produced-chosen", choiceSetId }` for that lemma
     - If the input metadata includes a `hover` event (a small input-shape extension): emit `{ kind: "hovered", dwellMs }` for the hovered lemma
     - Response latency is logged separately and raises `fatigueScore` via `session-signals.ts`; not a per-lemma observation
   - **Extract turn signals from `turn.text`:**
     - Lemmatize the turn text
     - For each introduce lemma actually present in the turn → emit `{ kind: "encountered" }` (passive exposure, no update on its own — the rule table gives it receptive grade `null`)
     - If the player subsequently advanced in <3 seconds without hovering (requires observing the next turn's timing), emit `{ kind: "rapid-advance", dwellMs }` for every in-envelope lemma in the turn. Note: this is a *deferred* emission that fires on the next turn's prepare stage, not this turn's finalize. Document the two-turn latency.
   - **Quest signals:** If a quest objective completed during this turn (check blackboard `TRACKED_QUEST_FACT` diff): emit `{ kind: "quest-success", objectiveNodeId }` for every lemma in the completed objective's text
   - Route every emitted observation through `learnerStateReducer.apply({ kind: "observation", observation })`. The reducer calls `observationToOutcome` from Epic 8 Story 8.2 to get the `(receptiveGrade, productiveStrengthDelta)` pair and applies it via `applyOutcome` from Epic 8 Story 8.1.
4. Stage: `"analysis"`, priority: `90` (runs after Verify and after any other analysis-stage middlewares)

**Tests Required:**

- Unit test: a turn with introduce lemmas → `encountered` observations flow to the reducer
- Unit test: player input containing a reinforce lemma typed correctly → `produced-typed` observation for that lemma
- Unit test: player input containing a lemma NOT in the directive but present in the learner's cards → `produced-unprompted` observation (voluntary use recognition)
- Unit test: player input with a known lemma typed in the WRONG inflected form → `produced-incorrect` observation with both `attemptedForm` and `expectedForm` populated
- Unit test: player selects a multiple-choice option carrying a target lemma → `produced-chosen` observation
- Unit test: player hovers a word → `hovered` observation for that lemma
- Unit test: quest completion during the turn → `quest-success` observations for the objective's lemmas
- Integration test: a full turn runs through all four middlewares; a production event propagates through the reducer → card store and the target lemma's `productiveStrength` increases by the expected delta
- Integration test: the Swain feedback loop end-to-end — a learner starts with high receptive + low productive on a lemma, the Budgeter scores it high due to productive gap, the Director picks `elicitation_mode`, the NPC prompts for production, the player types it, `produced-typed` fires, productive strength rises, next turn's prescription de-prioritizes it
- **Probe lifecycle test:** a turn with `constraint.comprehensionCheckInFlight` populated → `session.state["sugarlang.lastTurnComprehensionCheck"]` is set for the next turn
- **Probe response (pass) test:** previous turn fired a probe for `["llave", "carta"]`; player types "*Sí, una llave y una carta*" → observer detects probe-in-flight, lemmatizes response, both lemmas present → emits `comprehension.probe-passed`, calls reducer with `commit-provisional-evidence` for both lemmas
- **Probe response (fail) test:** previous turn fired a probe for `["plataforma"]`; player types "*no sé*" → observer detects probe-in-flight, lemmatizes, target absent → emits `comprehension.probe-failed`, calls reducer with `discard-provisional-evidence`
- **Probe response (mixed) test:** previous turn fired probe for `["llave", "carta", "maleta"]`; player types "*una llave*" → 1 pass, 2 fail → emits `comprehension.probe-mixed-result`, commits `["llave"]`, discards `["carta", "maleta"]`
- **Probe response (language-fallback) test:** previous turn fired a probe targeting Spanish lemmas; player replies in English "*yes I have them*" → observer emits `comprehension.probe-language-fallback`, discards the evidence (v1 behavior)
- **Probe state clearing test:** after handling a probe response, `session.state["sugarlang.lastTurnComprehensionCheck"]` is cleared so the probe doesn't re-process
- **Turn counter test:** `session.state["sugarlang.turnsSinceLastProbe"]` increments by 1 on normal turns and resets to 0 on probe-fired turns
- **Rapid-advance flow test:** a turn where the player advances in <3 seconds without hovering → `rapid-advance` observation fires → reducer's `applyOutcome` increases `provisionalEvidence` for in-envelope lemmas → FSRS `stability` is **unchanged** (critical assertion — this is the Observer Latency Bias fix)
- **Regression guard:** a deliberately crafted rapid-advance observation that tries to update FSRS stability fails a test assertion. The test reads the rule table and asserts that `observationToOutcome({ kind: "rapid-advance", dwellMs: 2000 }).receptiveGrade === null`.

**API Documentation Update:**

- `docs/api/middlewares.md`: "Observe middleware" section with the full signal-extraction algorithm, the production-subkind classification logic, and the Swain-feedback-loop integration test referenced
- `docs/api/placement-contract.md`: cross-reference — the placement scene's `produced-typed` observations flow through this middleware

**Acceptance Criteria:**

- Every turn produces the correct mix of observation kinds
- Production subkinds are correctly classified based on input context (free-text vs choice, prompted vs voluntary, correct form vs incorrect form)
- Observations route correctly to the reducer with correct `(receptiveGrade, productiveDelta)` pairs
- Quest-integration signals are captured
- The Swain feedback loop integration test passes end-to-end

### Story 10.6: Wire the four middlewares into the plugin registration

**Purpose:** Have `index.ts` return a plugin that contributes all four middlewares via `conversation.middleware` contributions.

**Tasks:**

1. Update `index.ts` to return a `RuntimePluginInstance` with:
   - `contributions: [contextMiddlewareContribution, directorMiddlewareContribution, verifyMiddlewareContribution, observeMiddlewareContribution]`
   - Each contribution is of kind `"conversation.middleware"` carrying the middleware factory function
2. Wire up `init(context)` to:
   - Load CEFRLex + morphology data via the providers
   - Instantiate the classifier, budgeter, director, learner state reducer
   - Construct each middleware with its dependencies
   - Register blackboard facts
3. Wire up `dispose()` to clean up any async resources

**Tests Required:**

- Integration test: plugin registration produces a runtime instance with four middlewares
- Integration test: plugin `init` succeeds with valid CEFRLex data and fails gracefully with missing data
- Smoke test: full conversation turn through the composed pipeline

**API Documentation Update:**

- `docs/api/middlewares.md`: "Plugin registration and middleware ordering" diagram
- `docs/api/README.md`: cross-reference the middleware contract

**Acceptance Criteria:**

- Plugin loads cleanly
- All four middlewares are registered
- End-to-end smoke test passes

## Risks and Open Questions

- **Annotation key collisions.** Four middlewares share the `execution.annotations` object. Namespace discipline (`sugarlang.*`) is convention-only today; no type system enforces it. A grep-based architectural test in Epic 14 catches accidental collisions.
- **Middleware ordering brittleness.** The priorities (10, 30, 20, 90) depend on other plugins' priorities. If another plugin contributes a middleware in the same stage, coexistence must be tested. Document the priority rationale so future maintainers understand.
- **Verify middleware cost.** The repair retry is a full LLM call on ~25% of turns. Verify in telemetry that this matches Proposal 001's cost model. If the real retry rate is much higher (e.g. 50%), the constraint merging or the Director output needs tuning.
- **Observe middleware performance.** Lemmatizing every turn text + every player input on the critical path adds a few milliseconds. Verify it stays under the conversation latency budget.
- **SugarAgent splice reviewability.** The one modification to SugarAgent is small but cross-plugin. Ensure the modification is clearly documented in both codebases and reviewed by a sugaragent maintainer.
- **The verify middleware and the scene's properNouns set.** The classifier needs the scene's proper nouns allowlist. The Context middleware should write `execution.annotations["sugarlang.sceneProperNouns"]` so the Verify middleware can read it without re-loading the scene lexicon. Document this annotation key.

## Exit Criteria

Epic 10 is complete when:

1. All six stories are complete
2. All middlewares are registered and fire at the correct stage/priority
3. SugarAgent splice is in place and backwards-compatible
4. End-to-end integration test passes: a conversation turn flows through Context → Director → Generator → Verify → Observe with all annotations correctly populated
5. `docs/api/middlewares.md` is complete
6. `tsc --noEmit` passes
7. This file's `Status:` is updated to `Complete`
