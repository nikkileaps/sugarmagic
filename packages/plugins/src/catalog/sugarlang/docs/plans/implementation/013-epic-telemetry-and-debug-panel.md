# Epic 13: Telemetry and Debug Panel

**Status:** Complete
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § v2 Training Path](../../proposals/001-adaptive-language-learning-architecture.md#v2-training-path), [§ Verification, Failure Modes, and Guardrails](../../proposals/001-adaptive-language-learning-architecture.md#verification-failure-modes-and-guardrails)
**Depends on:** Epic 10 (middlewares have the hooks to emit telemetry)
**Blocks:** Epic 14 (E2E tests assert on telemetry events)

## Context

Proposal 001's "v2 training path" claims that every (scene_context, prescription, directive, turn_outcome, learner_progression) tuple is logged like training data. This epic makes that true. It also wires up the rationale traces from the Budgeter, the verify verdicts from the Classifier, the Director's cited signals, and the observation events — all into a single telemetry sink with a standard schema.

The debug panel data source is a secondary consumer: given a conversation id and a turn id, it can reconstruct the full rationale trace ("why did sugarlang teach me *piacere* on turn 3") in ~30 seconds for a developer investigating player feedback.

Telemetry is strictly additive — existing epics emit events into the sink; this epic defines the sink, schema, and downstream readers. Without this epic, the other epics still work, but the data is transient. With this epic, every decision has an audit trail.

## Prerequisites

- Epic 10 (middlewares and the Director have already been wired to *call* telemetry sink methods; Epic 13 provides the implementations they call into)

## Success Criteria

- `TelemetrySink` interface is defined and injected into the middlewares, Director, Classifier, and reducer via dependency injection
- An in-memory sink for tests, an IndexedDB sink for local Studio/Preview runs, and a no-op sink for published builds
- Every middleware emits the proper event at the right lifecycle point
- `RationaleTraceBuilder` produces a complete trace per turn
- Debug panel data source can reconstruct a trace from telemetry
- API documentation covers the event schema and the v2 training data format
- The event schema is version-bumped so downstream consumers can detect schema changes

## Stories

### Story 13.1: Define the telemetry event schema and `TelemetrySink` interface

**Purpose:** Lock in the event types and the sink interface before anything else is implemented.

> **Extension point for Epic 14 (Lexical Chunk Awareness):** Epic 14 Story 14.6 adds five additional event kinds to this schema — `chunk.extraction-started`, `chunk.extraction-completed`, `chunk.extraction-failed`, `chunk.extraction-drift-detected`, `chunk.hit-during-classification`. Design the discriminated union in this story so new event kinds are additive and the exhaustiveness checks (`never` default branches) force downstream consumers to handle each new kind when Epic 14 lands.

**Tasks:**

1. In `runtime/telemetry/telemetry.ts`, define:
   - `TelemetryEvent` as a discriminated union over event kind
   - Event kinds:
     - `"budgeter.prescription-generated"` — carries `{ prescription, rationale, learnerSnapshot, sceneId, turnId, conversationId, timestamp }`
     - `"director.invocation-started"` — `{ directorContext, cacheHit, timestamp }`
     - `"director.invocation-completed"` — `{ directive, tokenCost, latencyMs, cacheHit, fallback, timestamp }`
     - `"classifier.verdict"` — `{ verdict, inputText, learnerSnapshot, prescription, timestamp }`
     - `"verify.repair-triggered"` — `{ originalText, violations, repairPrompt, timestamp }`
     - `"verify.auto-simplify-triggered"` — `{ originalText, substitutions, timestamp }`
     - `"observe.observations-applied"` — `{ observations, learnerDelta, timestamp }`
     - `"placement.completed"` — `{ finalBand, confidence, turnCount, timestamp }`
     - `"session.started" / "session.ended"` — `{ sessionId, ... }`
   - Each event includes common fields: `eventId`, `conversationId?`, `turnId?`, `sessionId?`, `timestamp`, `schemaVersion: 1`
2. Define `TelemetrySink` interface:
   - `emit(event: TelemetryEvent): void` — fire-and-forget, never throws, best-effort
   - `flush(): Promise<void>` — force-persist any buffered events
   - `query(filter: TelemetryQuery): Promise<TelemetryEvent[]>` — read back events for the debug panel (not all sinks need to implement this; the no-op sink throws `NotSupportedError`)

**Additional event kinds for Observer Latency Bias and comprehension checks** (per Proposal 001 § Observer Latency Bias and In-Character Comprehension Checks — visibility is a first-class requirement for this mechanism):

   - `"comprehension.probe-triggered"` — the Director middleware has decided (or been forced) to fire a probe this turn. Payload: `{ conversationId, turnId, sceneId, npcId, npcDisplayName, targetLemmas, probeStyle, triggerReason, characterVoiceReminder, currentPendingProvisionalCount, turnsSinceLastProbe, timestamp }`. This is the *decision* event — the probe has been scheduled but the NPC has not yet spoken.
   - `"comprehension.probe-fired"` — the Generator has produced the turn containing the probe question. Payload: `{ conversationId, turnId, targetLemmas, generatedText, probeQuestionExtract, timestamp }`. The `probeQuestionExtract` is a best-effort extraction of the actual question from the generated text (last sentence ending in `?`, for example) so debug reviewers can see what the NPC asked without reading the whole turn.
   - `"comprehension.probe-response-received"` — the player has responded to the probe. Payload: `{ conversationId, turnId, targetLemmas, playerResponseText, responseLatencyMs, responseInputKind, timestamp }`. Full player response captured for audit.
   - `"comprehension.probe-passed"` — the Observer middleware has determined the response demonstrates comprehension of ALL target lemmas. Payload: `{ conversationId, turnId, targetLemmas, playerResponseText, lemmasPassed, classifierReasoning, timestamp }`. The `classifierReasoning` is a short structured description of how the classifier decided (e.g., `"lemmatized response contained target lemma 'llave' in correct form"`) so debug reviewers can audit false positives.
   - `"comprehension.probe-failed"` — the Observer middleware has determined the response does NOT demonstrate comprehension of ANY target lemmas. Payload: `{ conversationId, turnId, targetLemmas, playerResponseText, lemmasFailed, classifierReasoning, timestamp }`. Same audit structure as passed.
   - `"comprehension.probe-mixed-result"` — the probe targeted multiple lemmas and the response passed some, failed others. Payload: `{ conversationId, turnId, targetLemmas, playerResponseText, lemmasPassed, lemmasFailed, classifierReasoning, timestamp }`.
   - `"comprehension.probe-language-fallback"` — the player responded to a target-language probe using only the support language (e.g., English reply to a Spanish probe). v1 treats this as a fail but logs it separately so we can measure how often it happens and decide in v1.1 whether to add a cheap Haiku judge. Payload: `{ conversationId, turnId, targetLemmas, playerResponseText, detectedLang, timestamp }`.
   - `"comprehension.director-hard-floor-violated"` — the schema-parser rejected a Director directive because the hard floor was reached but `comprehensionCheck.trigger === false`. The fallback policy kicked in. Payload: `{ conversationId, turnId, sceneId, directorModel, hardFloorReason, timestamp }`. This is critical for debugging — if we see this often, the Director's prompt is failing to enforce the hard-floor requirement.
   - `"fsrs.provisional-evidence-accumulated"` — a `rapid-advance` observation added to `provisionalEvidence`. Payload: `{ lemmaRef, previousEvidence, newEvidence, dwellMs, sessionTurn, timestamp }`.
   - `"fsrs.provisional-evidence-committed"` — a probe passed and provisional evidence became real FSRS stability. Payload: `{ lemmaRef, committedAmount, previousStability, newStability, probeId, timestamp }`. The `probeId` links this commit to the probe that caused it.
   - `"fsrs.provisional-evidence-discarded"` — a probe failed and provisional evidence was discarded. Payload: `{ lemmaRef, discardedAmount, probeId, timestamp }`.
   - `"fsrs.provisional-evidence-decayed"` — provisional evidence aged out past the decay threshold. Payload: `{ lemmaRef, decayedAmount, turnsPending, timestamp }`.

All comprehension-related events share a `probeId` field (generated when the probe is triggered) so the full lifecycle of a single probe can be reconstructed by filtering on that id: triggered → fired → response-received → passed/failed → commits/discards. This is the primary query the Comprehension Check Monitor uses (see Story 13.5b).

**Additional event kinds for Quest-Essential Lemma Exemption** (Proposal 001 § Quest-Essential Lemma Exemption — the Linguistic Deadlock fix):

   - `"quest-essential.classifier-exempted-lemma"` — the envelope classifier allowed a lemma through the exemption clause. Payload: `{ conversationId, turnId, sceneId, lemmaRef, cefrBand, learnerBand, sourceObjectiveNodeId, sourceObjectiveDisplayName, timestamp }`. This is the primary observability event for the deadlock fix — if it's not firing, either no quest-essential lemmas are being used, or something upstream failed to populate the exemption set.
   - `"quest-essential.director-forced-glossing"` — the schema-parser or `FallbackDirectorPolicy` forced `glossingStrategy` to `parenthetical`/`inline` because quest-essential lemmas were present and the Director had chosen a weaker strategy. Payload: `{ conversationId, turnId, originalGlossingStrategy, correctedGlossingStrategy, questEssentialLemmaCount, directorModel, timestamp }`. If this fires often, the Director's prompt is failing to make the requirement stick and prompt engineering is needed.
   - `"quest-essential.director-targetvocab-contamination"` — the Director included a quest-essential lemma in its `targetVocab` output, which violates the separate-channel discipline. The schema-parser stripped it. Payload: `{ conversationId, turnId, contaminatedLemmas, contaminationSite: "introduce" | "reinforce" | "avoid", timestamp }`. Rare but worth tracking as a Director-behavior signal.
   - `"quest-essential.generator-missed-gloss"` — the Generator used a quest-essential lemma but didn't include a parenthetical translation. Verify middleware triggered a repair. Payload: `{ conversationId, turnId, lemmaRef, expectedGloss, generatedText, timestamp }`. If this fires often, the Generator's prompt needs strengthening.
   - `"quest-essential.generator-missed-required"` — the Generator failed to use any quest-essential lemma when the active quest objective should have been referenced. Verify middleware triggered a stronger repair. Payload: `{ conversationId, turnId, expectedLemmas, generatedText, sourceObjectiveDisplayName, timestamp }`. Important for catching "the NPC is avoiding the quest topic" regressions.
   - `"quest-essential.compile-diagnostic-deadlock-prone"` — emitted at compile time (authoring-preview profile only) when a single objective contains 5+ lemmas above B2. Payload: `{ sceneId, sourceObjectiveNodeId, sourceObjectiveDisplayName, highBandLemmas, suggestion, timestamp }`. Surfaces in the Studio density histogram as a warning so authors can revise before hitting the deadlock.

All quest-essential events share a `sourceObjectiveNodeId` field so the full flow (compile-time diagnostic → runtime exemption → Director forced glossing → Generator gloss → Verify check) can be reconstructed for any given objective. The Comprehension Check Monitor's "per-lemma" drill-down is extended to also query by `sourceObjectiveNodeId` so developers can see "how did this specific objective behave under the deadlock-fix machinery" in one view.
3. Document the "never throws" contract: telemetry failures must not affect gameplay. If the sink errors, it logs and drops the event.

**Tests Required:**

- Type-level test: every event kind has the correct payload shape
- Exhaustiveness test: a switch over event kinds produces a `never` default

**API Documentation Update:**

- `docs/api/telemetry.md`: full event schema with example payloads for each kind

**Acceptance Criteria:**

- Schema is locked and exhaustive
- Interface is clean and version-tagged

### Story 13.2: Implement `MemoryTelemetrySink` and `IndexedDBTelemetrySink`

**Purpose:** Two sink implementations. The in-memory sink is for unit tests. The IndexedDB sink is for Studio/Preview sessions so events persist across reloads.

**Tasks:**

1. Implement `MemoryTelemetrySink implements TelemetrySink`:
   - Stores events in an in-memory ring buffer with configurable capacity (default 1000)
   - `query` returns filtered events
   - Used in tests; cleared between runs
2. Implement `IndexedDBTelemetrySink implements TelemetrySink`:
   - Writes events to an `IDBObjectStore` named `sugarlang-telemetry`
   - Batches writes (~100ms flush interval) to avoid IndexedDB write overhead per event
   - `query` supports filters on `conversationId`, `turnId`, `sessionId`, `eventKind`, `timeRange`
   - Capped at a configurable size (default 50,000 events); LRU-evicts oldest beyond the cap
3. Implement `NoOpTelemetrySink implements TelemetrySink`:
   - All methods are no-ops
   - Used in published builds where telemetry isn't needed (or where a remote sink would replace it)
4. Sink selection: based on `RuntimeBootModel.compileProfile` — `authoring-preview`/`runtime-preview` → IndexedDB, `published-target` → NoOp (for v1; a remote sink is a v2 feature)

**Tests Required:**

- Unit test per sink: emit → query returns the event
- Unit test: sink never throws on malformed events (best-effort)
- Integration test: IndexedDB sink persists across simulated reloads
- Integration test: ring buffer wraps correctly when capacity is exceeded

**API Documentation Update:**

- `docs/api/telemetry.md`: "Sink implementations" section

**Acceptance Criteria:**

- All three sinks work
- IndexedDB sink persists
- No-op sink is safe in production

### Story 13.3: Wire telemetry into middlewares, Director, Classifier, and reducer

**Purpose:** Every existing component built in earlier epics gains a dependency on `TelemetrySink` and emits its events at the right lifecycle point. This is "go back and wire telemetry" work.

**Tasks:**

1. `SugarLangContextMiddleware`: after budgeter.prescribe, emit `"budgeter.prescription-generated"`
2. `SugarLangDirectorMiddleware`: around director.invoke, emit `"director.invocation-started"` and `"director.invocation-completed"` (with cache hit, fallback flag, latency, tokens)
3. `SugarLangVerifyMiddleware`: after classifier.check, emit `"classifier.verdict"`; on repair trigger, emit `"verify.repair-triggered"`; on auto-simplify, emit `"verify.auto-simplify-triggered"`
4. `SugarLangObserveMiddleware`: after reducer.apply, emit `"observe.observations-applied"` with the learner state delta
5. `emitPlacementCompletion` (from Epic 11): emit `"placement.completed"`
6. `ClaudeDirectorPolicy`: internal telemetry for per-call tokens, latency, model id (part of `"director.invocation-completed"`)
7. Each component receives the telemetry sink via dependency injection, constructed in `index.ts` plugin registration (Epic 10 Story 10.6)

**Tests Required:**

- Integration test: a full conversation turn emits the expected sequence of events in order
- Integration test: telemetry failure (sink throws) does NOT break the turn (graceful degradation)

**API Documentation Update:**

- `docs/api/telemetry.md`: "Event timing and order" section diagramming which events fire when
- Update `docs/api/middlewares.md` to reference the telemetry hooks

**Acceptance Criteria:**

- Every component emits the right events
- Telemetry failures never crash gameplay
- The full per-turn event sequence is visible in tests

### Story 13.4: Implement `RationaleTraceBuilder`

**Purpose:** Given a `conversationId` and `turnId`, reconstruct the full rationale trace: budgeter inputs, scoring details, director rationale, classifier verdict, repair events, observations. This is the data source for the debug panel in Epic 12's compile status section (or a new dedicated debug section).

**Tasks:**

1. Implement `RationaleTraceBuilder` class with:
   - Constructor: `{ telemetrySink }`
   - `async buildTrace(conversationId: string, turnId: string): Promise<RationaleTrace>`
2. `RationaleTrace` shape:
   - `turnContext`: sceneId, NPC, learner snapshot, timestamp
   - `prescription`: the full `LexicalRationale` from the Budgeter
   - `directive`: the Director's output + cited signals + rationale + cache/fallback flag
   - `verdict`: the Classifier's verdict + coverage profile
   - `repair?`: if repair was triggered, the details
   - `observations`: list of observations from the Observe middleware
   - `learnerDelta`: how the learner state changed
   - **`comprehensionCheck?`**: if a probe was triggered or processed on this turn — the full probe lifecycle events (trigger, fire, response, outcome, FSRS deltas). Joins on `probeId` from the telemetry sink. Links directly to the Comprehension Check Monitor's detail view for that probe.
   - **`pendingProvisionalSnapshot`**: the `pendingProvisionalLemmas` array the Director saw when deciding, so reviewers can correlate "what was pending" with "why the Director did or didn't probe"
   - **`probeFloorState`**: the soft/hard floor state at the time of the Director call
   - **`questEssentialState`**: the active quest-essential lemma set at the time of this turn, plus any quest-essential exemption/gloss/repair events that fired (from the `quest-essential.*` telemetry namespace). Lets reviewers audit "was the deadlock fix active for this turn and did it behave correctly."
3. Query the telemetry sink for all events matching the `(conversationId, turnId)` key and assemble the trace

**Tests Required:**

- Unit test: a trace is correctly assembled from a fixture event sequence
- Unit test: missing events in the sequence produce a partial trace (graceful degradation)
- Integration test: a real turn's trace is queryable after the turn completes

**API Documentation Update:**

- `docs/api/telemetry.md`: "Rationale traces" section

**Acceptance Criteria:**

- Trace builder handles missing or partial event sequences
- Full trace is reconstructible for any logged turn

### Story 13.5: Debug panel data source + UI section

**Purpose:** A developer-facing UI section in the Studio that shows the rationale trace for any conversation turn. Critical for debugging "why did sugarlang teach me this?"

**Tasks:**

1. Implement `runtime/telemetry/debug-panel-data.ts` as a data aggregator:
   - `listRecentConversations(): Promise<ConversationSummary[]>`
   - `listTurnsInConversation(conversationId): Promise<TurnSummary[]>`
   - `getTurnRationale(conversationId, turnId): Promise<RationaleTrace>`
2. Add a `design.section` contribution in Studio (extending Epic 12's contributions) that renders a "Sugarlang Turn Inspector" panel:
   - Shows a list of recent conversations
   - Clicking a conversation shows its turns
   - Clicking a turn shows the full rationale trace in a structured view (collapsible sections for prescription, directive, verdict, repair, observations)
3. The panel reads from the `IndexedDBTelemetrySink` in Studio/Preview sessions

**Tests Required:**

- Unit test: each data-aggregator method returns expected results against a mock sink
- Integration test: a simulated conversation produces a queryable trace

**API Documentation Update:**

- `docs/api/telemetry.md`: "Debug panel" section with screenshots (when available)
- `docs/api/editor-contributions.md`: add "Turn Inspector" contribution reference

**Acceptance Criteria:**

- Panel renders
- Rationale trace is readable
- Works end-to-end against real telemetry

### Story 13.5b: Comprehension Check Monitor debug panel

**Purpose:** A dedicated Studio-side debug view for comprehension check activity. This is the **"lots of visibility"** requirement from Proposal 001 § Observer Latency Bias. Developers must be able to see, for every probe: why it fired, what the target was, what the player said, how the classifier decided, what FSRS state changed as a result, and how often probes are firing relative to normal turns.

**Tasks:**

1. Implement a data aggregator `runtime/telemetry/comprehension-monitor-data.ts` with:
   - `listRecentProbes(filter?: { sessionId?, conversationId?, npcId?, timeRange? }): Promise<ProbeSummary[]>` — returns the probe-lifecycle-joined view
   - `getProbeDetail(probeId: string): Promise<ProbeDetail>` — full payload of every lifecycle event for a single probe, in time order
   - `getSessionRollup(sessionId: string): Promise<SessionProbeRollup>` — per-session metrics: probe count, pass rate, fail rate, language-fallback rate, mixed rate, avg `turnsSinceLastProbe`, hard-floor-violation count, per-NPC breakdown
   - `getLemmaProbeHistory(lemmaRef: LemmaRef, learnerId: string): Promise<LemmaProbeHistory>` — every probe that has ever targeted this lemma for this learner, with outcomes
2. Define the shape of each view type with rich fields for debugging:
   ```ts
   interface ProbeSummary {
     probeId: string;
     sessionId: string;
     conversationId: string;
     turnId: string;
     npcId: string;
     npcDisplayName: string;
     triggerReason: ProbeTriggerReason;
     targetLemmas: LemmaRef[];
     probeStyle: string;
     probeQuestionExtract: string | null;    // what the NPC actually asked
     playerResponseText: string | null;       // what the player typed
     outcome: "pending" | "passed" | "failed" | "mixed" | "language-fallback";
     lemmasPassed: LemmaRef[];
     lemmasFailed: LemmaRef[];
     classifierReasoning: string;
     evidenceCommitted: number;                // total provisional units committed to FSRS
     evidenceDiscarded: number;                // total units discarded
     timestamp: number;
     latencyFromTriggerToResponseMs: number | null;
   }
   
   interface SessionProbeRollup {
     sessionId: string;
     totalTurns: number;
     totalProbes: number;
     probesRate: number;                       // probes / totalTurns
     passRate: number;                         // passed / (passed + failed + mixed)
     failRate: number;
     mixedRate: number;
     languageFallbackRate: number;
     hardFloorViolationCount: number;
     avgTurnsSinceLastProbe: number;
     perNpcBreakdown: Array<{ npcId, npcDisplayName, probeCount, passRate }>;
     totalProvisionalEvidenceAccumulated: number;
     totalProvisionalEvidenceCommitted: number;
     totalProvisionalEvidenceDiscarded: number;
     totalProvisionalEvidenceDecayed: number;
   }
   ```
3. Add a `design.section` contribution in Studio (extends Epic 12's contributions) that renders a **"Comprehension Check Monitor"** panel:
   - A live feed of probes firing during the current Preview session, newest first
   - Each row shows: trigger reason (with a color-coded pill for director-discretion vs soft-floor vs hard-floor), NPC name, target lemmas, a snippet of the probe question, a snippet of the player response, outcome badge (pass/fail/mixed/language-fallback), and a click-through to the full detail view
   - Expandable rows show the full ProbeDetail (all lifecycle events in time order, full player response, classifier reasoning, FSRS deltas applied)
   - Session rollup bar at the top of the panel: total probes this session, pass rate, probes-per-turn, any hard-floor-violation count (red alert if >0)
   - Filter controls: session, conversation, NPC, outcome, trigger reason, date range
   - Per-NPC drill-down: click an NPC name to see that NPC's probe history and pass rate specifically
   - Per-lemma drill-down: click a target lemma to see every probe that has ever targeted it
4. **Rate alert:** if the probe rate exceeds 20% of turns in a rolling 50-turn window, the panel shows a yellow warning banner ("Probe rate is high — learners may find this intrusive. Tune the Director prompt or adjust the floor thresholds."). If it exceeds 30%, the banner goes red.
5. **Silence alert:** if `turnsSinceLastProbe` exceeds 40 and there's pending provisional evidence, the panel shows a yellow warning ("No probes firing despite pending evidence. The Director may be ignoring the soft floor or the hard floor enforcement isn't working.").

**Tests Required:**

- Unit test per data-aggregator method: returns expected results against a mock sink populated with fixture probe events
- Unit test: probe lifecycle join — given a sequence of events with the same `probeId`, the aggregator assembles a complete `ProbeSummary`
- Unit test: session rollup computes rates correctly against a fixture session
- Integration test: simulated probe sequence produces a queryable rollup and the debug panel renders it correctly
- Visual test: the panel renders a fixture probe sequence in a predictable way (snapshot test or Storybook)
- Rate alert test: a simulated session with probe rate >30% triggers the red alert banner
- Silence alert test: a simulated session with pending provisional and no probes for 40+ turns triggers the yellow alert

**API Documentation Update:**

- `docs/api/telemetry.md`: new "Comprehension Check Monitor" section with screenshots (when available)
- `docs/api/editor-contributions.md`: add "Comprehension Check Monitor" to the list of Studio contributions
- Cross-reference Proposal 001 § Observer Latency Bias

**Acceptance Criteria:**

- Panel renders all probe lifecycle details
- Session rollup metrics are accurate
- Rate and silence alerts fire correctly
- A developer investigating "why did this lemma get committed" can reconstruct the full trace in <30 seconds using only the panel

### Story 13.6: v2 Training data export

**Purpose:** A way to export the telemetry data for offline analysis and eventual model training.

**Tasks:**

1. Implement `runtime/telemetry/training-data-export.ts`:
   - `exportTrainingTuples(filter?: { sessionRange? }): Promise<TrainingTuple[]>`
   - `TrainingTuple` = the (scene_context, prescription, directive, turn_outcome, learner_progression) shape from Proposal 001 v2 training path
2. The export queries the telemetry sink, joins events by `conversationId + turnId`, and outputs training-ready records
3. Output format: JSON Lines (`.jsonl`) suitable for streaming into training pipelines
4. A Studio button in the debug section triggers export to a downloaded file
5. For v1, this is a manual export only — no auto-upload, no aggregation. The file contains only data from the current user's sessions.

**Tests Required:**

- Unit test: a simulated session produces the expected training tuples
- Unit test: malformed event sequences are filtered out with a warning (don't corrupt training data)
- Integration test: exporting a real session produces valid `.jsonl` output

**API Documentation Update:**

- `docs/api/telemetry.md`: "Training data export" section with the tuple schema and format

**Acceptance Criteria:**

- Export works
- Schema matches Proposal 001's v2 training path spec
- File is valid `.jsonl`

## Risks and Open Questions

- **Telemetry sink performance.** IndexedDB writes can be slow if not batched. The 100ms batch flush should keep write amplification low. Verify with benchmarks.
- **PII and data privacy.** Telemetry includes player free-text input. For local Studio/Preview use, this is fine — it stays in the developer's own IndexedDB. For v2 when a remote sink might be added, PII handling becomes critical. Document this constraint explicitly.
- **Storage quota.** 50,000 events at ~2 KB per event is ~100 MB in IndexedDB. That's within typical quotas but substantial. Add monitoring so developers see when they're approaching the limit.
- **Schema evolution.** `schemaVersion: 1` gives us a version knob for later migrations. Document the bump procedure.
- **Debug panel is developer-only.** Make sure the contribution is gated to Studio mode only, not available in Published builds. Use the `compileProfile` check.

## Exit Criteria

Epic 13 is complete when:

1. All six stories are complete
2. All tests pass (unit + integration)
3. Every middleware and the director emit the expected events
4. The debug panel is functional in Studio
5. Training data export produces valid `.jsonl`
6. `docs/api/telemetry.md` is complete
7. `tsc --noEmit` passes
8. This file's `Status:` is updated to `Complete`
