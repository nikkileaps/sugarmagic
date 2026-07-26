# Plan 081 -- Sugarlang Foundation Completion (child epic A of Strategy 002)

Status: Locked (epic-review passed 2026-07-25, 2 rounds; 081.4 amended + re-gated 2026-07-25, 1 targeted round) -- stories execute as written in the stated EXECUTION ORDER; deviations need STOP + amendment + re-gate.
Owner: nikki + claude
Date: 2026-07-25

Related:
- Strategy 002 (docs/plans/strategy/002-sugarlang-adaptive-language-acquisition-strategy.md) -- this is child epic A; epics B-G build on the signal this epic restores
- Plan 071 (sugaragent foundation repair) -- the sibling epic this one mirrors; its mock-gateway house pattern and honest-logging conventions are reused here
- Sugarlang internal roadmap (packages/plugins/src/catalog/sugarlang/docs/plans/implementation/000-roadmap.md) -- this epic closes internal epics 13 (telemetry/logging) and 15 (E2E), and the calibration remnant of 9
- Ground truth: 2026-07-24 six-agent sweep + 2026-07-25 spot verification; every story cites the producing lines it targets (line numbers drift; grep the quoted identifiers)

---

## Why now

Strategy 002 builds five capability epics (functions, rendering ladder, voice, teacher outer loop, negotiation) on top of sugarlang v1. The audit found v1's teaching loop sound but its INSTRUMENTS missing or lying: the dead logger stub throws ("TODO: Epic 13", runtime/logger.ts:27) while a parallel inline logger lives in the manifest, telemetry reaches a local debug sink only (telemetry.ts:22's BigQuery TODO; published targets resolve to NoOpTelemetrySink at telemetry.ts:944-948), the three E2E integration files are `.todo` stubs (verified 2026-07-25: 3 skipped / 3 todo), and the post-placement calibration window is cosmetic -- confidence is frozen at the placement value forever (learner-state-reducer.ts:458 guards the recompute on `status !== "evaluated"`) while the band drifts unconditionally (:457), and the placement verdict is never seeded into the posterior at all (placement-completion, reducer:282-290, touches assessment only). Strategy 002's "How we know it is teaching" metrics are unmeasurable until this lands.

WORSE, and found by this epic's review round 1 (2026-07-25): the 071.5 authored-line bypass is NOT fixed -- it is a LIVE PRODUCT BUG. Commit 55e3e97 shipped only the prescription-less-constraint slice of that story; the RATIFIED fix (re-base the gate on conversationKind) never landed. `shouldRunSugarlangForExecution` still gates on interactionMode (middlewares/shared.ts:133-140), `DialogueManager.start()` builds selections with conversationKind "scripted-dialogue" and NO interactionMode (DialogueManager.ts:151-156), so all three entry sites (gameplay-session.ts:1747 scripted followup, :1781 quest-narrative, :2053 spell-cast dialogue) skip EVERY sugarlang middleware and play raw English today. Story 081.3 absorbs the real fix. Strategy 002's "Where we are" bullet claiming the fix was verified merged is corrected alongside this plan.

Verified already done (no story): the ENTITY_AFFECT vestige named in Strategy 002 epic A is ALREADY GONE -- zero hits for ENTITY_AFFECT / entity-affect / entityAffect across packages and apps (grep 2026-07-25); the directive cache's remaining invalidation reasons are max_turns_exceeded, quest_stage_change, and location_change (directive-cache.ts:71,123,127 -- the third fires on ENTITY_LOCATION_FACT changes and matters to 081.2's event taxonomy and 081.5's cache golden). The 074-080 run deleted ENTITY_AFFECT. Nothing to do there.

## Non-goals

No new teaching capabilities. Chunks, functions, negotiation moves, learner portraits, the rendering ladder, the teacher outer loop, review UI, pronunciation audio: epics B-G. No BigQuery/warehouse infrastructure (floor is structured logs; see 081.2). If a story here grows a feature, it has escaped.

## Design principles

- Floors before ceilings (Strategy 002 razor): every story ships the minimal version that makes the signal real.
- Sugarmagic orchestrates everything: telemetry rides the existing sugardeploy-generated gateway; no hand-provisioned infrastructure, no new vendor, no new API surface beyond one gateway route.
- One enforcer: the turn-path guard lives in ONE place (an exhaustive gate) backed by one integration test, not scattered defensive checks.
- No flakey tests: the E2E goldens are deterministic against the mock gateway (071.1 house pattern: vi.stubGlobal fetch, throw-on-unknown-URL) or they are not written.
- Bias toward deletion: the noop-logger fallback and the throwing stub both die; one logger, honestly gated.

## Stories (EXECUTION ORDER)

### 081.1 Logger consolidation (smaller than first framed -- review round 1)

Honest premise: logging largely WORKS today. manifest.ts:76-91 already constructs an inline console-backed `[sugarlang]` logger gated by config.debugLogging (071.8 convention already followed) and injects it into runtime-services and every middleware factory; 23 call sites fire through it. What is wrong is duplication and dead code: `createSugarlangLogger` (logger.ts:26-27) throws "TODO: Epic 13" and has ZERO callers; `createNoOpSugarlangLogger` (middlewares/shared.ts:125) is the else-branch noop; `SugarlangLoggerLike` is declared twice (shared.ts and runtime-services.ts).

Consolidate: logger.ts's factory becomes the ONE real implementation (console-backed, level-aware -- the only genuinely new behavior -- still debugLogging-gated); the manifest's inline object and the noop factory are deleted (bias toward deletion: the factory with debugLogging=false IS the quiet path); the LoggerLike interface is declared once. No behavior change beyond levels.
- Exit: no throwing stub, no noop factory, one interface declaration; with debugLogging on, decisions visible; off, silence; grep-clean for createNoOpSugarlangLogger.

### 081.2 Telemetry gets a production path + rationale traces

Today telemetry emits to a debug sink only; the BigQuery TODO (telemetry.ts:22) has stood since April. Strategy 002's mechanical metrics (FSRS predicted-vs-observed recall, envelope hold rate, repair trend, posture graduations) need events that leave the browser.

Floor (this story): one authenticated gateway route (`/api/sugarlang/telemetry`), registered the house way -- a ProxyRouteRequirement on the sugarlang plugin definition (mold: sugaragent/index.ts:134-149; sugarlang currently declares ZERO deploymentRequirements), a routeId dispatch branch + handler in gateway core.ts (the `__GATEWAY_AUTH_GATE__` runs on every non-/health path, so bearer/supabase-jwt comes free -- core.ts:1883-1890), and a regenerated core.compiled.ts (the freshness test enforces this). Client-side batching (flush on interval + conversation dispose; drop-on-failure, never block a turn). The gateway writes each event as ONE single-line JSON object to stdout -- pure JSON lines, not the existing logInfo "message {json}" text format, so Cloud Logging parses them into jsonPayload. On Cloud Run stdout IS Cloud Logging (verified against GCP docs; the only other deploy shape is local docker compose, where stdout is the console) -- zero new infrastructure; BigQuery log-sink export is a config flip deferred to the watchlist.

Sink switch (the actual payoff, named): resolveSugarlangTelemetrySink (telemetry.ts:944-954) currently returns NoOpTelemetrySink for `compileProfile === "published-target"` -- production players emit NOTHING today. This story makes published-target resolve to the gateway sink (batched POST); Studio keeps IndexedDB locally AND gains the gateway sink when a proxy base URL is configured (decide-in-story: dual-emit vs gateway-only in Studio).

Instrument the rationale traces the tuning work needs (Strategy 002 "instrument the observation grade table"): budgeter prescription rationale (already computed in prescribe(), lexical-budgeter.ts:190-213), teacher directive citedSignals (pedagogy.ts:124), envelope verdicts + repair outcomes, cache invalidations (all three reasons incl. location_change), and -- the calibration metric -- FSRS predicted retrievability at each review (fsrs-adapter.ts get_retrievability) alongside the observed outcome. Events carry a schema version from day one.
- Decide-in-story: event taxonomy + sampling + a batch size cap (the gateway's readJsonBody, core.ts:282-295, streams bodies with no limit today); PII posture -- the existing schema carries player free text (classifier inputText telemetry.ts:210, repair originalText :287/:297, comprehension playerResponseText :401+), which today never leaves the browser; server-bound events must scrub, truncate, or hash player text (recommended: drop free text server-bound, keep lemma ids + verdicts), and the decision is documented in the API page.
- Exit: play one conversation against the local docker gateway; single-line JSON events for prescription, directive, verdict, and at least one prediction/outcome pair appear in gateway stdout; a published-target build resolves the gateway sink (unit test on resolveSugarlangTelemetrySink); turn latency unaffected with the gateway down (batching drops, nothing blocks); server-bound events contain no player free text per the PII decision.

### 081.3 Fix the live authored-line bypass + make the bug class structurally impossible (PRODUCT BUG; corrected premise, review round 1)

The 071.5 RATIFIED fix never shipped -- only the prescription-less-constraint slice did (commit 55e3e97 touched one middleware). Live today: `shouldRunSugarlangForExecution` gates on interactionMode (shared.ts:133-140); `DialogueManager.start()` selections carry conversationKind but NO interactionMode (DialogueManager.ts:151-156); therefore quest narratives, scripted followups, and spell-cast dialogues (gameplay-session.ts:1747/:1781/:2053) bypass all five middlewares and play raw English.

Execute the ratified 071.5 fix shape, THEN add the structural guard:
1. Re-base the gate on what the turn IS: `conversationKind === "scripted-dialogue"` takes the scripted path; `free-form` + npcDefinitionId takes the agent path; interactionMode stops being a gate anywhere. MANDATORY reader sweep in the same story (skipping it ships a worse bug -- post-re-basing, .start conversations would pass the outer gate and then take the AGENT branch): `isScriptedMode` (shared.ts:142-146, used by teacher/verify/observe/scripted middlewares) and sugaragent PlanStage's `interactionMode === "agent"` gate on start-scripted-followup (PlanStage.ts:55) both move to the conversationKind/npcDefinitionId basis. Decide-in-story (carried from 071.5): whether authored player-spoken lines are adapted or skipped -- the integration test pins it either way; and whether ConversationInteractionMode survives on the selection for authoring purposes (it just stops gating).
2. Structural guard: the re-based gate switches EXHAUSTIVELY over conversationKind with a `never` check, no default case (conversationKind is REQUIRED on ConversationSelectionContext -- conversation/index.ts:40 -- which is what makes this real enforcement, unlike optional interactionMode). One host-level integration test enumerates every entry path (interact-scripted, interact-agent, the three .start sites) and asserts sugarlang saw the execution (constraint annotation present, observe ran) and that adapted lines render for a mid-placement learner, including the authored-text fallback when the adaptation LLM call fails.
- Honest scope note: the guard covers host-mediated paths; a hypothetical future entry that bypasses DialogueManager/createConversationHost entirely is out of its reach.
- Exit: quest-narrative and scripted-followup lines render language-adapted (the 071.5 exit, finally); grep-clean -- no middleware or stage gates on selection.interactionMode; adding a conversationKind fails typecheck; removing the middleware contribution or an entry path breaks the test.

### 081.4 Post-placement calibration does something

Current state, precisely (corrected review round 1): `isInPostPlacementCalibration` = `cefrConfidence < 0.65 && turns < 10` (calibration-mode.ts:29) plus a static prompt hint. cefrConfidence is FROZEN at the placement value forever -- the recompute is guarded by `assessment.status !== "evaluated"` (learner-state-reducer.ts:458) -- so the window can only close by turn count. But the BAND is not stuck: reducer:457 updates estimatedCefrBand from the posterior unconditionally on every graded observation. And the deeper gap: placement-completion (reducer:282-290) writes assessment + band but NEVER seeds cefrPosterior -- the posterior entering the window is whatever self-report seeded (cefr-posterior.ts:65-74), unrelated to the placement verdict, so the first observations can yank the band straight off the customs-form result.

Wire it honestly, three parts:
1. SEED: placement-completion seeds cefrPosterior from the placement verdict (band + confidence -> concentration), so the window starts from what placement actually concluded.
2. WEIGHT: during the window, observations carry an elevated (bounded) weight into the posterior (updatePosterior is a fixed +1 today, cefr-posterior.ts:76-88; this touches ONLY the Bayesian posterior -- ts-fsrs card scheduling is untouched).
3. CLOSE ON EVIDENCE (AMENDED 2026-07-25, build-time defect found): in-window cefrConfidence is computed as EVIDENCE SHARE -- the CURRENT ESTIMATED band's alpha over the sum of all six bands' alphas (raw alpha, prior and seed included; see the pinned counting rule below) -- NOT the normalized-mean posterior mass of computePointEstimate. The mass scale cannot cross the 0.65 close threshold: each band's mean is bounded by 1 and normalized against the sum of all six means, any unobserved band contributes 0.5 forever (two such bands alone exceed the headroom the threshold allows the other five), and below-level bands only accumulate successes so their means rise, never fall. Under that scale the window could never close on evidence -- only the turn backstop would fire, which is the exact failure this story exists to fix. Evidence share is a true 0-1 scale commensurable with the placement-scoring confidence the 0.65 threshold was written against, and crosses it with a realistic handful of weighted in-window observations; failures increment beta only, so above-level failures do not inflate those bands' share. Scope: the evidence-share measure and the lifted :458 freeze apply during the window ONLY; outside it, band+confidence behavior at reducer:456-464 is untouched. turns<10 stays as the backstop ceiling; the hint stays; a telemetry event (081.2) fires on close carrying the band delta from the placement verdict -- the direct measure of customs-form mis-placement.
- PINNED (re-review 2026-07-25, 1 targeted round): evidence share counts RAW alpha, prior and seed included. The evidence-only variant (alpha minus the uniform prior) is degenerate: the seed makes the placed band's share 1.0 at window start, and placed-band FAILURES increment beta only (cefr-posterior.ts:84-85) so the share stays 1.0 -- the window would close instantly with full confidence even on failing evidence. Also pinned: the seeded share must start BELOW 0.65 (raw-alpha share at seed is (1+c)/(6+c), so concentration c stays under ~8.3), otherwise the window closes on the first observation regardless of content.
- Decide-in-story: weight multiplier + cap; seeding concentration (within the pinned c bound).
- Exit: unit tests pinned to what main CANNOT do (band drift alone already happens via reducer:457): a learner placed A1 producing consistent B1 evidence has the window CLOSE EARLY on confidence with band B1; a correctly-placed learner's window closes EARLY (before the turn backstop) without band movement; consistent FAILURES on the placed band do NOT close the window early (guards the degenerate counting rule); post-placement posterior reflects the verdict before any observation.

### 081.5 E2E goldens (close internal epic 15)

The three integration files exist as `.todo` stubs (tests/integration/: cold-start-placement, end-to-end-conversation, preview-cache-hit-rate). Fill them against the mock gateway (071.1 house pattern: vi.stubGlobal fetch, throw-on-unknown-URL -- packages/testing/src/sugaragent-runtime.test.ts:22-41), deterministic, no vendor URLs. Fixture cost acknowledged up front (review round 1): unlike sugaragent, sugarlang services need bindRuntime (blackboard + playerDefinition + region/scene + lexicon), so the goldens need a region fixture plus the existing seed paths (seedPreviewLexicons / seedSugarlangRuntimeCompileCache); MemoryCardStore and MemoryTelemetrySink keep it IndexedDB-free. The e2e and cache goldens drive selections through createConversationHost on the conversationKind basis -- they depend on 081.3 (ordering already accommodates this).
- Cold-start placement golden: opening dialog -> questionnaire submission -> scored profile with posterior + calibration window active (081.4's semantics pinned here).
- End-to-end conversation golden: one scripted line adapted under a constraint and one agent turn generated with the constraint present; envelope verify pass AND the repair path (mock a violating generation); observations land on cards; directive comes from cache on the second turn.
- Preview cache-hit-rate golden: N turns -> one teacher call; quest_stage_change invalidation forces exactly one re-plan (and the fixture holds ENTITY_LOCATION_FACT stable, or pins location_change explicitly -- it is a third live invalidator, directive-cache.ts:127).
- Exit: 3 files real and green in `pnpm test`; suite fails on any unmocked URL; zero flake over 20 local runs (no-flakey-tests rule).

### 081.6 Italian: finish or hide (DECISION story) -- COMPLETE, decision: ENABLED

Ground truth (corrected review round 1): the it/ pack is structurally COMPLETE -- cefrlex.json, morphology.json, frequency.json, kelly-subset.json, placement-questionnaire.json, simplifications.json all present and statically imported by the loaders; "it" is a legal SugarlangTargetLanguage (config.ts:39). The REAL audit population is in the atlas itself: 1397 of 6370 lemmas (22%) carried cefrPriorSource "frequency-derived" (1027 B2, 370 C1 -- the auto-assignment skewed uniformly HIGH). review-queue.yaml was a 50-entry slice of that population, read by NO code -- auditing it would have audited 3.6% of the problem.

Audit run 2026-07-25: 28-batch parallel model judge reclassified all 1,397 frequency-derived entries against pedagogical CEFR criteria (common concrete nouns -- zuppa/soup, burro/butter, banana, insetto/insect -- correctly placed at A1/A2 rather than B2/C1). cefrPriorSource updated to "claude-classified" on all 1,397. Zero frequency-derived entries remain.

Before: 0 A1 / 0 A2 / 0 B1 / 1027 B2 / 370 C1
After:  59 A1 / 390 A2 / 553 B1 / 350 B2 / 45 C1

Decision: PATH (a) -- Italian stays enabled. review-queue.yaml retired (full population classified). Telemetry (081.2) watches Italian envelope hold rate vs Spanish as the ongoing signal.
- Exit: decision recorded; config state matches (Italian enabled, legal target language); smoke run in Italian (placement + one conversation + hover glossing) passes.

### 081.7 Debug levers: set language + level manually (verification tooling; runs any time after 081.1)

Verifying any band-dependent behavior currently requires playing the full placement flow per run. Target language is already settable without ceremony (LanguageConfigSection sets target language + debugLogging; support language is hardcoded "en" -- config.ts:40 -- and stays out of scope). The missing lever is LEVEL.

Ship two surfaces over one mechanism, dev contexts only (Studio + preview; published runtime gets none of it):
- Mechanism: a debug override writes through the existing reducer/fact path -- estimatedCefrBand set, posterior concentrated on the chosen band, assessment status "evaluated" with confidence 1.0 (placement flow skipped, calibration window closed per calibration-mode.ts:29), placement status fact marked complete. The reset lever EXTENDS the existing resetSugarlangLearnerData (contributions.ts:36-56) -- which wipes card-store + telemetry IndexedDB but misses the learner-profile and placement-status blackboard facts -- rather than adding a second reset (one enforcer); while in there, fix its lying docstring (claims compile + chunk cache deletion the filter does not perform -- leaving content caches is correct, the comment is not). Scope note (review round 2): those blackboard facts are session-scoped -- there is no sugarlang SaveParticipant and no plugin-owned profile-core store (save/index.ts scopes per-plugin learner state out of GameSavePayload by design; only FSRS cards survive reload via the card store). The override and reset are therefore in-session levers, which is all verification needs; cross-session profile persistence is a Strategy 002 watchlist item, not this story. Decide-in-story: whether an override PINS the band for the session (no posterior drift while testing) -- recommended as an optional flag, default unpinned.
- Studio/preview panel: a small Learner Override section beside the existing SugarlangTurnInspector -- band picker, pin toggle, reset button, current-state readout.
- Dev-only window handle for automated verification: `window.__sugarlangDebug` with setBand/pin/reset/getState, gated behind `import.meta.env.DEV` following the `__sugarmagicDebug` precedent (targets/web runtimeHost.ts:2045-2060, never present in a published artifact) -- NOT the ungated `__smperfRun` pattern.
- Exit: from a fresh New Game, set B1 via the panel and talk to an NPC -- speech arrives at B1 with no placement flow; reset restores the customs-form path INCLUDING the blackboard facts; grep/build proof that published runtime excludes the handle and panel.

### 081.8 Quest Form Overlay (AMENDMENT added 2026-07-25)

The placement questionnaire currently renders inline inside the DOM dialogue panel, shoehorning a multi-question form into a narrow chat widget. This story lifts it to a full-screen React overlay and wires the general infrastructure any future quest-triggered form can reuse through the same channel.

Changes:
1. **Type promotion**: Promote `PlacementQuestionnaireView` from a private type in `DialoguePanel.ts` to an exported `QuestFormDefinition` in `runtime-core/conversation/index.ts`. Rename `ConversationPlayerInput` kind `"placement_questionnaire"` -> `"quest_form"` and `ConversationPlacementQuestionnaireResponse` -> `ConversationQuestFormResponse`. Add `formId?: string` to `QuestFormDefinition` so the overlay can set it in the response.
2. **UIStateStore bridge**: `RuntimeUIState` gains `questFormOpen: boolean` + `questFormDefinition: QuestFormDefinition | null`. `DialoguePanel` on `inputMode === "quest_form"` signals these (enriching the definition with the questionnaire version from the turn metadata) instead of rendering an inline form. Expose `submitQuestFormResponse(response)` and `cancelQuestForm()` on `RuntimeDialoguePanel`; forward both on `RuntimeGameplaySessionController`.
3. **React overlay**: `QuestFormOverlay` component in `targets/web/src/ui/` -- full-viewport document-style form renderer with per-question-type controls (multiple-choice, yes-no, free-text, fill-in-blank), submit-enabled-when-min-answered gate, and `onSubmit`/`onDismiss` callbacks. `GameUILayer` renders it when `state.questFormOpen`, above the dialogue panel (z-index already correct: GameUILayer lives at z-40, dialogue panel at z-20). `runtimeHost.ts` wires `onQuestFormSubmit` -> `gameplaySession.submitQuestFormResponse` and `onQuestFormDismiss` -> `gameplaySession.cancelQuestForm`.
4. **Plugin side**: `GenerateStage.ts` emits `inputMode: "quest_form"` (was `"placement_questionnaire"`). Observe and context middlewares check `input.kind === "quest_form"`. Tests updated throughout.
- Reuse contract: future quest forms emit `inputMode: "quest_form"` with a `QuestFormDefinition`-shaped object under any annotation key, and handle the `quest_form` ConversationPlayerInput kind in their own observe middleware. No new architecture required.
- Exit: placement questionnaire renders full-screen as a document-style form, not inside the dialogue panel; submit and dismiss both work; `pnpm test` green; type-checks clean.

## Verification recipe (nikki)

1. `pnpm test` -- green, including the three new goldens run twice back-to-back. `pnpm lint` -- clean.
2. Studio -> preview -> New Game with debugLogging ON: placement + one NPC conversation; console shows teacher/classifier/budgeter lines. Same run with debugLogging OFF: sugarlang is silent.
2b. Bypass fix probe (081.3): trigger a quest-narrative dialogue and a post-agent scripted followup mid-placement -- both arrive language-adapted, not raw English (this is the 071.5 recipe step that was never honestly passable; it is now).
3. docker compose gateway up: play one conversation; gateway output shows structured telemetry JSON (prescription, directive, verdict, prediction/outcome).
4. Calibration probe: place yourself deliberately low (answer the customs form as a beginner), then chat at your real level for a few turns -- band moves within the session (visible in the turn inspector), and the close event appears in telemetry.
5. If 081.6 chose enable: switch targetLanguage to "it", run placement + one conversation, hover a gloss.
6. Debug levers: fresh New Game -> Learner Override panel -> set B1 -> talk to an NPC (no placement, B1 speech); reset -> customs form returns. Repeat a band via `window.__sugarlangDebug.setBand(...)` from the console.

## Epic wrap

docs/api touch per house norm: telemetry page (event taxonomy, schema version, gateway route), learner-state page (calibration window semantics + debug override contract), middlewares page (turn-path guard contract). Backlog sweep of any DEFERRED SEAM comments added here. Update Strategy 002's epic A entry to note the ENTITY_AFFECT item was verified pre-satisfied.

## Deferred (with revisit triggers)

- BigQuery export: a log-sink config flip on the Cloud Run project once event volume justifies queries; revisit when the first real tuning question needs SQL over months of events (code comment at the gateway telemetry route).
- Recalibration beyond the window: the teacher outer loop (epic E) reads the same posterior continuously; a separate late-recalibration mechanism is redundant once E lands (code comment at calibration-mode.ts).
- Italian human spot-review: the full 1,397 entries are claude-classified; a human pass over the A1/A2 tier (59+390 entries) would catch systematic over-promotion. Revisit trigger: Italian envelope hold rate diverging from Spanish in telemetry (081.2 signal).
