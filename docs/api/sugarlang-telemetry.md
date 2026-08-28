# API 011: Telemetry

## Purpose

This document covers the developer-facing surface of telemetry: the shared
collector every runtime system emits through, the event schema, the event
taxonomy actually emitted at runtime, the gateway ingestion route, and the
PII scrub.

## Overview

Delivery is shared and lives in core:

**File:** `packages/runtime-core/src/telemetry/index.ts`

It defines the producer-neutral envelope, the `TelemetryCollector` contract,
`GatewayTelemetryCollector` (batching and delivery), `BindableTelemetryCollector`
(what a plugin holds before the host hands one over), and the PII policy.
Telemetry belongs to no one plugin -- sugarlang records what it taught,
sugaragent records the turns it could not answer -- and a plugin cannot import
another plugin's catalog, so a collector owned by either could only ever serve
that one.

The host builds the collector and supplies it on `RuntimePluginContext`. A
plugin emits its own event kinds and knows nothing about batching, auth, or the
route. Emitting goes through `emitTelemetry`, which is fire-and-forget: a
failing collector logs a warning and drops the event, never blocking a turn.

Producers today:

| Producer | Events | Schema owned in |
|---|---|---|
| sugarlang | 54 kinds, teaching analytics | `catalog/sugarlang/runtime/telemetry/telemetry.ts` |
| sugaragent | `sugaragent.turn-degraded` | `catalog/sugaragent/runtime/telemetry.ts` |

## Event Schema and Versioning

Every event extends the shared `TelemetryEventBase`:

```typescript
interface TelemetryEventBase {
  eventId: string;          // "telemetry:<ms>:<counter>" unless supplied
  schemaVersion: 1;         // TELEMETRY_SCHEMA_VERSION
  timestamp: number;
  kind: string;
  conversationId?: string;  // join keys for cross-event analysis
  turnId?: string;
  sessionId?: string;
}
```

The shape is deliberately open: each producer declares its own `kind` values
and its own payload fields over that envelope, flattened onto it rather than
nested under a payload key. A closed union in core would mean one producer's
events could not typecheck against the shared collector.

`kind` is `family.kebab-case-event`. Cloud Logging queries key on it, so the
naming is load-bearing rather than cosmetic.

Sugarlang additionally keeps its own typed union and its own
`SUGARLANG_TELEMETRY_SCHEMA_VERSION` (also `1`) for its 54 kinds. That union is
the source of truth for what each sugarlang event carries; it rides on the
shared envelope for delivery.

`TelemetryEvent` is a discriminated union over `kind` with a typed payload per
event (the single source of truth for what each event carries).
`createTelemetryEvent(kind, payload)` stamps `eventId` and `schemaVersion`;
producers pass `timestamp` and the join keys explicitly.
`SUGARLANG_TELEMETRY_SCHEMA_VERSION` is `1`; the version rides on every event
and on every gateway batch, so a future payload change is a deliberate bump.

`TelemetryQuery` + `matchesTelemetryQuery` provide the read side used by
`MemoryTelemetrySink` in tests: filter by `conversationId`, `turnId`,
`sessionId`, `eventKinds`, `probeId`, `lemmaId`, `npcId`, time range, limit.
No shipped sink is queryable -- reading happens in the logs, not in-product.

## Event Taxonomy

Grouped by family, with the producing file (all paths relative to
`packages/plugins/src/catalog/sugarlang/`):

**Session and learner state** -- `runtime/learner/learner-state-reducer.ts`

| Kind | When |
|---|---|
| `session.started` / `session.ended` | Session lifecycle events reach the reducer |
| `learner-profile.updated` | After every reducer event (carries `eventType`) |
| `fsrs.seeded-from-placement` | Placement completion seeds a lemma card from free text |
| `fsrs.provisional-evidence-accumulated` | A `rapid-advance` observation bumps provisional evidence |
| `fsrs.provisional-evidence-committed` | Probe pass commits provisional evidence into stability |
| `fsrs.provisional-evidence-discarded` | Probe fail discards provisional evidence |
| `fsrs.provisional-evidence-decayed` | Stale provisional evidence decays by turn age |
| `calibration.window-closed` | Post-placement calibration window closes (`closeReason`: `"confidence"` or `"turn-backstop"`) |

**Placement flow**

| Kind | Producer |
|---|---|
| `pre-placement.opening-dialog-turn` | `runtime/middlewares/sugar-lang-context-middleware.ts` |
| `teacher.pre-placement-bypass` | `runtime/middlewares/sugar-lang-teacher-middleware.ts` |
| `verify.pre-placement-bypass` | `runtime/middlewares/sugar-lang-verify-middleware.ts` |
| `observer.pre-placement-bypass` | `runtime/middlewares/sugar-lang-observe-middleware.ts` |
| `observer.placement-questionnaire-bypass` | `runtime/middlewares/sugar-lang-observe-middleware.ts` |
| `placement.completed` | `runtime/middlewares/sugar-lang-observe-middleware.ts` |

**Classifier, verify**

The Budgeter is deleted (Epic 090). `budgeter.prescription-generated` no longer
exists; the Teacher decides from the situation and the learner directly, so
there is no prescription to emit.

| Kind | Producer |
|---|---|
| `classifier.verdict` | `sugar-lang-verify-middleware.ts` (every checked turn) |
| `verify.ratio-verdict` | `sugar-lang-verify-middleware.ts`. Carries `learnerCefr`, `directedRatio`, `measuredRatio`, `posture`, `denominator` -- the raw numbers, so any ratio threshold can be recomputed after the fact rather than depending on the categorical `conformance`. |
| `quest-essential.classifier-exempted-lemma` | `sugar-lang-verify-middleware.ts` |
| `verify.drift-sample` | `sugar-lang-verify-middleware.ts` (per-turn ratio/envelope/voice sample, recorded before anything else; `deterministic: true` marks canned/fallback turns so quality distributions can exclude them) |
| `observe.observations-applied` | `sugar-lang-observe-middleware.ts` |

**Comprehension probes**

| Kind | Producer |
|---|---|
| `comprehension.probe-triggered` | `sugar-lang-teacher-middleware.ts` |
| `comprehension.probe-fired` | `sugar-lang-observe-middleware.ts` |
| `comprehension.probe-response-received` | `sugar-lang-observe-middleware.ts` |
| `comprehension.probe-passed` / `-failed` / `-mixed-result` | `sugar-lang-observe-middleware.ts` |

The three probe-outcome events (`-passed` / `-failed` / `-mixed-result`) carry
an optional `predictedRetrievabilities?: Record<string, number>` map of
lemmaId to the FSRS-predicted retrievability at response time, for lemmas that
had a card with a numeric `retrievability`. Omitted when no target lemma had
one. This is the predicted-vs-observed calibration signal: join it against
`lemmasPassed` / `lemmasFailed` on the same event.
| `comprehension.probe-language-fallback` | `sugar-lang-observe-middleware.ts` |
| `comprehension.teacher-hard-floor-violated` | `sugar-lang-teacher-middleware.ts` and `runtime/teacher/schema-parser.ts` |

**Teacher (teacher)**

| Kind | Producer |
|---|---|
| `teacher.invocation-started` / `-failed` | `runtime/teacher/policies/llm-teacher-policy.ts` |
| `teacher.invocation-completed` | `runtime/teacher/sugar-lang-teacher.ts` and `llm-teacher-policy.ts` |
| `teacher.invocation-resolved` | `runtime/teacher/sugar-lang-teacher.ts` |
| `directive-cache.decision` | `runtime/teacher/sugar-lang-teacher.ts` |
| `quest-essential.teacher-forced-glossing` | `runtime/teacher/schema-parser.ts` |
| `quest-essential.teacher-targetvocab-contamination` | `runtime/teacher/schema-parser.ts` |

**Chunk extraction (scene lexicon tier 2)**

| Kind | Producer |
|---|---|
| `chunk.extraction-started` / `-completed` / `-failed` | `runtime/compile/extract-chunks.ts` |
| `chunk.extraction-drift-detected` | `runtime/compile/chunk-cache.ts` |
| `chunk.extraction-stale-discarded` | `runtime/compile/compile-scheduler.ts` |
| `chunk.hit-during-classification` | `runtime/classifier/envelope-classifier.ts` |

**Declared but not yet emitted.** Three kinds exist in the union with no
producing `createTelemetryEvent` call anywhere in the sugarlang tree:
`quest-essential.generator-missed-gloss`,
`quest-essential.generator-missed-required`, and
`quest-essential.compile-diagnostic-deadlock-prone`. Treat them as reserved
schema, not live signals.

## Sinks and Resolution

`TelemetrySink` is the extension point: `emit` (required), `flush`, `query`,
and `dispose` (optional). `QueryableTelemetrySink` requires `flush` and
`query`. `dispose` flushes buffered events and tears down timers/listeners;
the plugin's `dispose()` in `manifest.ts` calls `flushTelemetry` and then
`sink.dispose?.()` so the session tail is not lost on teardown.

| Collector | Storage | Notes |
|---|---|---|
| `GatewayTelemetryCollector` | POST to gateway | core; batches up to 100 events per request, flush every 5s, drop-on-failure |
| `BindableTelemetryCollector` | forwards | core; what a plugin holds until the host binds one |
| `NoOpTelemetryCollector` | none | core; no gateway configured |
| `MemoryTelemetrySink` | in-memory ring | sugarlang; capacity 1000, queryable, used in tests |

`GatewayTelemetryCollector` delivery guarantees:

- A flush drains at most 100 events; if more are pending it immediately
  reschedules itself, so a burst larger than the cap drains in successive
  batches instead of stranding the remainder.
- On `pagehide` and on `visibilitychange` to `hidden`, all pending batches
  are fired with `fetch(..., { keepalive: true })` so the last few seconds
  of a session survive tab close (keepalive shares a 64KB in-flight quota;
  overflow drops, matching the drop-on-failure posture).
- `dispose()` clears the flush timer, removes both listeners, and drains
  everything still pending.
- **A non-2xx response is reported.** The collector reads the status and warns
  the first time delivery breaks and the first time it recovers, staying quiet
  in between. Delivery is best-effort, but best-effort is not the same as
  silent: an earlier sink never read the status, so a route that answered 404
  for nine days looked exactly like one that was recording, and the metrics
  built on it held nothing.

The host builds the collector once per world spawn in
`targets/web/src/runtimeHost.ts` and passes it into the gameplay assembly,
which puts it on `RuntimePluginContext.telemetry`. A gateway URL means a
`GatewayTelemetryCollector`; no URL means no telemetry, which is the case in
Studio with nothing deployed.

A plugin builds a `BindableTelemetryCollector` per instance and binds it in
`init`. This exists because a plugin constructs its services before `init` runs,
so they need something real to hold. Per instance, not per module: teardown is
not awaited, so a shared one would be unbound by whichever instance is torn
down last, and an old session's dispose landing after a new one has bound would
silence telemetry for the rest of the page. `dispose()` on a bindable unbinds
only -- the host's collector outlives any one plugin and serves other producers.

Studio, Preview and the published game have the same destination, so a gateway
fault is visible while authoring instead of only in production, and a reading
taken in Preview is evidence about what the deployed game does.

## Reading Events

There is no in-product reader. The gateway writes each accepted event as one
JSON line to stdout, and the platform collects it:

- **Local:** `docker compose logs -f sugarmagic-gateway` from the project's
  `deployment/local/` directory.
- **Deployed:** Cloud Run collects stdout into Cloud Logging; read it in the
  Logs Explorer filtered to the gateway service.

Aggregation (sessions per week, turns per session, probe pass rates) needs a
log sink into BigQuery. That is configuration on the Cloud Run project rather
than code here; every event already carries `sessionId`, `conversationId`,
`turnId` and a timestamp to join on.

### Is the directive cache working

`directive-cache.decision` fires once per turn wherever the Teacher is
consulted, and carries the whole decision on one row:

| Field | Meaning |
|---|---|
| `outcome` | `hit`, `stale-served`, or `blocking-miss` |
| `staleness` | which axis retired the entry; null on a hit |
| `movedSegments` | segment NAMES of the situation key that moved -- `["nodes"]`, `["quest","time"]`. Never values: every segment but `time` is a uuid or a hash, and values would give this one distinct value per player |
| `firstTurnOfConversation` | the turn the cache is measured on; later turns hit regardless |
| `teacherMs` | what the turn actually waited -- ~0 when served, seconds when blocking |

One row per decision is deliberate: a rate needs its numerator and its
denominator on the same event.

Three questions it answers:

- **Working?** Share of rows with `firstTurnOfConversation = true` where
  `outcome = hit`.
- **Regressed?** Any sustained rate of `outcome = blocking-miss`. That is the
  outcome the cache exists to prevent, so a non-zero rate is the alarm: it
  catches warming having stopped, the stale-serve bound tripping because the
  gateway is failing, the boot warm not firing, and the cache not being written.
- **What invalidates these in the wild?** Group by `movedSegments`. `time`
  dominating would mean the clock band is finer than the directive's useful
  life; `hash` appearing means scenes are being rebuilt under live players.

## Gateway Ingestion Route

**Route:** `POST /api/telemetry` (`TELEMETRY_INGEST_ROUTE_PATH`)
**Handler:** `handleTelemetryIngest` in
`packages/plugins/src/deployment/gateway/core.ts`

The route belongs to no plugin. `buildGatewayRoutesFile` in
`packages/plugins/src/deployment/index.ts` adds it to every generated gateway,
because the handler is compiled into all of them and any runtime system can
emit through the shared collector. Owning it there rather than in a plugin
manifest is what stops it from disappearing when whichever plugin happened to
declare it is disabled.

The path is spelled in the deployment planner and again as
`TELEMETRY_INGEST_ROUTE_PATH` in core, which is what the browser builds its URL
from; the planner cannot import values across the package alias. The
"serves the telemetry route from every gateway" case in
`packages/testing/src/plugin-infrastructure.test.ts` compares the two and fails
if they disagree. That matters: a route that does not match answers 404 while
every client believes it is recording.

Handler contract:

- `POST` only; other methods get 405.
- Body limit 200 KB; over-limit returns `413 { error: "RequestBodyTooLarge" }`.
- Invalid JSON returns `400 { error: "InvalidJson" }`.
- Accepts at most 100 events per batch (`Math.min(events.length, 100)`);
  extras are silently ignored.
- Each accepted event is written as one JSON line to stdout. On Cloud Run
  that lands in structured logs. There is no database write; BigQuery export
  is deferred (a log-sink config flip, per the comment above the handler).
- Responds `200 { ok: true, accepted }`.

Client batch shape (from `GatewayTelemetryCollector.flush`):

```json
{ "events": [ ... ], "schemaVersion": 1 }
```

## PII Scrub

The primary scrub is CLIENT-side, in `GatewayTelemetryCollector`. Before an
event leaves the browser, it drops the top-level fields named in
`PLAYER_TEXT_PII_POLICY` (`packages/runtime-core/src/telemetry/index.ts`):

- `inputText` (classifier.verdict)
- `originalText` / `repairedText`
- `playerResponseText` (comprehension probe events)

plus one known nested path: `observe.observations-applied` nests player-typed
text at `observations[].observation.inputText` (`produced-typed` observations,
see sugarlang's `runtime/contracts/observation.ts`), which the policy removes
while keeping the rest of the observation.

Every producer's fields sit in that one list on purpose. A strip each producer
performed for itself would be enforced nowhere, and one producer forgetting is
a player's typing on the wire.

The gateway re-scrubs as defense in depth: `scrubTelemetryEvent` in
`packages/plugins/src/deployment/gateway/core.ts` deletes the same top-level
fields and the nested `observation.inputText` from every event before it is
written to stdout. The field list is duplicated there (`TELEMETRY_PII_FIELDS`)
because the gateway compiles standalone and cannot import from a plugin or core
package; keep it in sync with `PLAYER_TEXT_PII_POLICY`. An old client is still
a client.

**Sugaragent's degraded-turn event carries no text at all** -- not the player's
and not the NPC's. The NPC's line is deterministic from the trigger, so
shipping it would trade the diagnostic value against nothing.

## Sugaragent: the degraded turn

**Kind:** `sugaragent.turn-degraded`
**Built by:** `buildDegradedTurnEvent` in
`packages/plugins/src/catalog/sugaragent/runtime/telemetry.ts`

One event per turn where the NPC gave up and read a canned line instead of
answering. The decision is made in the browser and used to stay there, so in a
deployed game "why did the NPC give up?" was answered by reasoning about what
had not failed.

| Field | Meaning |
|---|---|
| `stageId` | the stage that produced the reply the player saw; null on a terminal close |
| `trigger` | the stage's own trigger, or `terminal-close` |
| `fallbackReason` | the stage's fallback reason |
| `degradedStages` | every degraded stage, so a turn that failed in more than one place is not reported as though only the last thing went wrong |
| `stalled` / `autoClosed` | the two verdicts the provider already derives |
| `terminalClose` | the three-strike close fired and the conversation was ended |
| `consecutiveFallbackTurns`, `turnCount`, `llmBackend` | turn context |

`conversationId` carries the NPC definition id. Sugarlang keys its events on
the same value under the same name, which is what lets one conversation be read
across both producers.

Two things worth knowing when querying it:

- **Degraded is `status`, not the presence of a `trigger`.** RegenerateStage
  stamps `judge-fail-regen` on a turn it repaired successfully -- status `ok`,
  real text, no fallback reason. Keying off the trigger would report a
  successful repair as the NPC giving up.
- **The terminal close is its own trigger.** It runs after every stage has
  finished, so on that turn the stages can all read `ok` while the player is
  shown the door. Filter `trigger = "terminal-close"` for conversations that
  ejected a player.

Not yet covered: a degraded turn on the pre-placement envelope-override path
returns before the event is built, so those are unreported.

## Proxy Base URL Resolution

**Env var:** `SUGARMAGIC_SUGARLANG_PROXY_BASE_URL`
(`SUGARLANG_PROXY_BASE_URL_ENV` in
`packages/plugins/src/catalog/sugarlang/config.ts`)

The host reads the same two names directly when it builds the telemetry
collector, since there is one gateway and one URL spelled two ways.

Resolution order, applied identically in `runtime/runtime-services.ts` (LLM
gateway client) and in the host's collector construction:

1. `SUGARMAGIC_SUGARLANG_PROXY_BASE_URL` (trimmed)
2. `SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL` (trimmed) -- sugarlang shares the
   SugarAgent gateway; the `/api/sugaragent/generate` handler is a generic
   Claude proxy, not sugaragent-specific
3. empty string -> no gateway client (teacher runs fallback-only) and no
   telemetry collector, so events go nowhere

Related but distinct: the manifest declares `gatewayRuntimeConfigKeys` for the
values the gateway genuinely reads (models). `targetLanguage` was declared here
until 2026-07-29 and is not any more -- the gateway never read it, and target
language is a **player's** choice rather than a deploy value. It resolves
player selection -> project config, in `resolveSugarLangTargetLanguage` and
nowhere else.
