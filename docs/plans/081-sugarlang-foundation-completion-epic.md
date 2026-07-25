# Plan 081 -- Sugarlang Foundation Completion (child epic A of Strategy 002)

Status: Draft (pending epic-review)
Owner: nikki + claude
Date: 2026-07-25

Related:
- Strategy 002 (docs/plans/strategy/002-sugarlang-adaptive-language-acquisition-strategy.md) -- this is child epic A; epics B-G build on the signal this epic restores
- Plan 071 (sugaragent foundation repair) -- the sibling epic this one mirrors; its mock-gateway house pattern and honest-logging conventions are reused here
- Sugarlang internal roadmap (packages/plugins/src/catalog/sugarlang/docs/plans/implementation/000-roadmap.md) -- this epic closes internal epics 13 (telemetry/logging) and 15 (E2E), and the calibration remnant of 9
- Ground truth: 2026-07-24 six-agent sweep + 2026-07-25 spot verification; every story cites the producing lines it targets (line numbers drift; grep the quoted identifiers)

---

## Why now

Strategy 002 builds five capability epics (functions, rendering ladder, voice, teacher outer loop, negotiation) on top of sugarlang v1. The audit found v1's teaching loop sound but its INSTRUMENTS missing or lying: the logger factory throws ("TODO: Epic 13", runtime/logger.ts:27), telemetry reaches a debug sink only (telemetry.ts:22's BigQuery TODO), the three E2E integration files are `.todo` stubs (verified 2026-07-25: 3 skipped / 3 todo), and the post-placement calibration window is cosmetic -- a predicate and a prompt hint with nothing that ever updates confidence or evidence weight, so the window can only close by turn count. Strategy 002's "How we know it is teaching" metrics are unmeasurable until this lands. Meanwhile the 071.5 bypass fix is merged but nothing makes that bug class structurally impossible -- middleware attachment is still implicit.

Verified already done (no story): the ENTITY_AFFECT vestige named in Strategy 002 epic A is ALREADY GONE -- zero hits for ENTITY_AFFECT / entity-affect / entityAffect across packages and apps (grep 2026-07-25); the directive cache's remaining invalidation reasons are max_turns_exceeded and quest_stage_change (directive-cache.ts:71,123). The 074-080 run deleted it. Nothing to do.

## Non-goals

No new teaching capabilities. Chunks, functions, negotiation moves, learner portraits, the rendering ladder, the teacher outer loop, review UI, pronunciation audio: epics B-G. No BigQuery/warehouse infrastructure (floor is structured logs; see 081.2). If a story here grows a feature, it has escaped.

## Design principles

- Floors before ceilings (Strategy 002 razor): every story ships the minimal version that makes the signal real.
- Sugarmagic orchestrates everything: telemetry rides the existing sugardeploy-generated gateway; no hand-provisioned infrastructure, no new vendor, no new API surface beyond one gateway route.
- One enforcer: the turn-path guard lives in ONE place (an exhaustive gate) backed by one integration test, not scattered defensive checks.
- No flakey tests: the E2E goldens are deterministic against the mock gateway (071.1 house pattern: vi.stubGlobal fetch, throw-on-unknown-URL) or they are not written.
- Bias toward deletion: the noop-logger fallback and the throwing stub both die; one logger, honestly gated.

## Stories (EXECUTION ORDER)

### 081.1 The logger becomes real

`createSugarlangLogger` throws "TODO: Epic 13" (runtime/logger.ts:27); every runtime site injects a SugarlangLoggerLike with a silent noop fallback, so sugarlang cannot say anything even when asked. Implement the factory: console-backed, level-aware, gated by the plugin's debugLogging config -- mirroring 071.8's honest-gating convention (no always-on logging, no config no-ops). Runtime-services constructs it once and injects it everywhere a LoggerLike is accepted today; the standalone noop fallback path is deleted (bias toward deletion -- the factory with debugLogging=false IS the quiet path).
- Exit: no throwing stub; with debugLogging on, middleware/teacher/classifier decisions are visible in the console; with it off, silence; grep-clean for the old noop constructor.

### 081.2 Telemetry gets a production path + rationale traces

Today telemetry emits to a debug sink only; the BigQuery TODO (telemetry.ts:22) has stood since April. Strategy 002's mechanical metrics (FSRS predicted-vs-observed recall, envelope hold rate, repair trend, posture graduations) need events that leave the browser.

Floor (this story): one authenticated gateway route (`/api/sugarlang/telemetry`, same bearer/JWT gate as every other route), client-side batching (flush on interval + conversation dispose; drop-on-failure, never block a turn), gateway writes structured JSON events to stdout. On Cloud Run, stdout IS Cloud Logging -- zero new infrastructure; a BigQuery log-sink export is a config flip deferred to the watchlist. Local dev: debug sink unchanged; the docker-compose gateway prints events.

Instrument the rationale traces the tuning work needs (Strategy 002 "instrument the observation grade table"): budgeter prescription rationale (the scoring rationale already computed in prescribe()), teacher directive citedSignals, envelope verdicts + repair outcomes, and -- the calibration metric -- FSRS predicted retrievability at each review alongside the observed outcome. Events carry a schema version from day one.
- Decide-in-story: event taxonomy + sampling (rationale traces may be 100% while volume is small).
- Exit: play one conversation against the local gateway; structured events for prescription, directive, verdict, and at least one prediction/outcome pair appear in gateway output; turn latency unaffected with the gateway down (batching drops, nothing blocks); no PII beyond the userId/learnerId keys the save contract already carries.

### 081.3 Turn-path guard: make the 071.5 bug class structurally impossible

071.5 fixed the authored-line bypass by re-basing sugarlang's gate on conversationKind, with an integration test for the two paths that were broken. What is still missing is the STRUCTURAL guarantee Strategy 002 asks for: nothing forces a FUTURE conversation entry path or conversationKind through the sugarlang chain.

Two mechanisms, one enforcer:
1. `shouldRunSugarlangForExecution` (sugarlang shared.ts) switches EXHAUSTIVELY over conversationKind with a `never` check -- adding a new kind fails typecheck until someone decides how sugarlang treats it. No default case.
2. One host-level integration test enumerates every conversation entry path (interact-scripted, interact-agent, DialogueManager.start quest-narrative, post-agent scripted followup, spell-cast dialogue effect -- the 071.5 list) and asserts sugarlang saw the execution (constraint annotation present, observe middleware ran). The test data derives the path list from the same source the runtime uses where possible, so a new entry path shows up as an uncovered case.
- Exit: removing the sugarlang middleware contribution, adding a conversationKind, or adding an entry path each breaks build or test; no scattered defensive re-checks added anywhere else.

### 081.4 Post-placement calibration does something

Current state (calibration-mode.ts): `isInPostPlacementCalibration` = `cefrConfidence < 0.65 && turns < 10` (line 29), plus a static prompt hint consumed by the teacher prompt builder. Nothing updates cefrConfidence after placement and no evidence weighting changes during the window -- so the window closes only by turn count and a mis-placed learner stays mis-placed for exactly as long as they would without it.

Wire it honestly: during the calibration window, observations carry an elevated (bounded) weight into the CEFR posterior; cefrConfidence is recomputed from posterior mass after each update so the window closes on EVIDENCE, not just turns; the existing hint stays; a telemetry event (081.2) fires on window close carrying the band delta from the placement verdict -- the direct measure of how often the customs form mis-places players.
- Decide-in-story: the weight multiplier and its cap; whether turns<10 stays as a backstop ceiling (recommended: yes).
- Exit: unit test -- a learner placed A1 producing consistent B1-grade evidence converges to B1 within the window, and the window closes early on confidence; a correctly-placed learner's window closes without band movement.

### 081.5 E2E goldens (close internal epic 15)

The three integration files exist as `.todo` stubs (tests/integration/: cold-start-placement, end-to-end-conversation, preview-cache-hit-rate). Fill them against the mock gateway (071.1 house pattern), deterministic, no vendor URLs:
- Cold-start placement golden: opening dialog -> questionnaire submission -> scored profile with posterior + calibration window active (081.4's semantics pinned here).
- End-to-end conversation golden: one scripted line adapted under a constraint and one agent turn generated with the constraint present; envelope verify pass AND the repair path (mock a violating generation); observations land on cards; directive comes from cache on the second turn.
- Preview cache-hit-rate golden: N turns -> one teacher call; quest_stage_change invalidation forces exactly one re-plan.
- Exit: 3 files real and green in `pnpm test`; suite fails on any unmocked URL; zero flake over 20 local runs (no-flakey-tests rule).

### 081.6 Italian: finish or hide (DECISION story)

Ground truth: the it/ pack is structurally COMPLETE -- cefrlex.json, morphology.json, frequency.json, placement-questionnaire.json, simplifications.json all present, PLUS review-queue.yaml: frequency-derived CEFR assignments awaiting optional human review (entries carry reviewReason "kelly-band-missing"; bands were auto-assigned by frequency rank when the Kelly list had no verdict). "it" is already a legal SugarlangTargetLanguage config value.

The risk is band QUALITY, not missing data: auto-assigned bands skew the envelope and the budgeter. Story: stratified sample audit of review-queue.yaml assignments (batch model judge + spot parity against Spanish ELELex cousins), then decide:
(a) default path if the audit is sane -- Italian stays enabled, review-queue.yaml remains the standing artifact for incremental human review, telemetry (081.2) watches Italian envelope hold rate vs Spanish;
(b) if the audit finds material misbanding -- "it" is config-hidden until a correction pass lands.
- Exit: decision recorded here with the audit numbers; config state matches the decision; if enabled, a smoke run in Italian (placement + one conversation + hover glossing) passes.

### 081.7 Debug levers: set language + level manually (verification tooling; runs any time after 081.1)

Verifying any band-dependent behavior currently requires playing the full placement flow per run. Target language is already settable without ceremony (LanguageConfigSection contribution sets targetLanguage/supportLanguage); the missing lever is LEVEL.

Ship two surfaces over one mechanism, dev contexts only (Studio + preview; published runtime gets none of it):
- Mechanism: a debug override writes the learner profile directly -- estimatedCefrBand set, posterior concentrated on the chosen band, assessment status "evaluated" with confidence 1.0 (placement flow skipped, calibration window closed), placement status fact marked complete. Reset lever wipes profile + card store for a clean cold start. Decide-in-story: whether an override PINS the band for the session (no posterior drift while testing) -- recommended as an optional flag, default unpinned.
- Studio/preview panel: a small Learner Override section beside the existing SugarlangTurnInspector -- band picker, pin toggle, reset button, current-state readout.
- Dev-only window handle for automated verification (house pattern: __smperfRun): `window.__sugarlangDebug` with setBand/pin/reset/getState, so scripted QA can drive band changes without UI.
- Exit: from a fresh New Game, set B1 via the panel and talk to an NPC -- speech arrives at B1 with no placement flow; reset restores the customs-form path; grep/build proof that published runtime excludes the handle and panel.

## Verification recipe (nikki)

1. `pnpm test` -- green, including the three new goldens run twice back-to-back. `pnpm lint` -- clean.
2. Studio -> preview -> New Game with debugLogging ON: placement + one NPC conversation; console shows teacher/classifier/budgeter lines. Same run with debugLogging OFF: sugarlang is silent.
3. docker compose gateway up: play one conversation; gateway output shows structured telemetry JSON (prescription, directive, verdict, prediction/outcome).
4. Calibration probe: place yourself deliberately low (answer the customs form as a beginner), then chat at your real level for a few turns -- band moves within the session (visible in the turn inspector), and the close event appears in telemetry.
5. If 081.6 chose enable: switch targetLanguage to "it", run placement + one conversation, hover a gloss.
6. Debug levers: fresh New Game -> Learner Override panel -> set B1 -> talk to an NPC (no placement, B1 speech); reset -> customs form returns. Repeat a band via `window.__sugarlangDebug.setBand(...)` from the console.

## Epic wrap

docs/api touch per house norm: telemetry page (event taxonomy, schema version, gateway route), learner-state page (calibration window semantics + debug override contract), middlewares page (turn-path guard contract). Backlog sweep of any DEFERRED SEAM comments added here. Update Strategy 002's epic A entry to note the ENTITY_AFFECT item was verified pre-satisfied.

## Deferred (with revisit triggers)

- BigQuery export: a log-sink config flip on the Cloud Run project once event volume justifies queries; revisit when the first real tuning question needs SQL over months of events (code comment at the gateway telemetry route).
- Recalibration beyond the window: the teacher outer loop (epic E) reads the same posterior continuously; a separate late-recalibration mechanism is redundant once E lands (code comment at calibration-mode.ts).
- Italian human review of review-queue.yaml in full: incremental; the file is the queue, entries clear as reviewed. Revisit trigger: Italian envelope hold rate diverging from Spanish in telemetry.
