# API 011: Sugarlang Telemetry

## Purpose

This document covers the developer-facing surface of Sugarlang's telemetry
system: the canonical event schema, the event taxonomy actually emitted at
runtime, sink resolution (local debug vs published production), the gateway
ingestion route, and the proxy base URL environment resolution.

## Overview

One file owns the whole contract:

**File:** `packages/plugins/src/catalog/sugarlang/runtime/telemetry/telemetry.ts`

It defines the typed event union, the `TelemetrySink` interface, all four sink
implementations, and `resolveSugarlangTelemetrySink`. Every producer
(middlewares, Teacher, learner reducer, classifier, chunk compiler) emits
through `emitTelemetry`, which is fire-and-forget: a failing sink logs a
warning and drops the event, never blocking a turn.

## Event Schema and Versioning

Every event extends `TelemetryEventBase`:

```typescript
interface TelemetryEventBase {
  eventId: string;          // "sugarlang-telemetry:<ms>:<counter>" unless supplied
  schemaVersion: 1;         // SUGARLANG_TELEMETRY_SCHEMA_VERSION
  timestamp: number;
  kind: string;
  conversationId?: string;  // join keys for cross-event analysis
  turnId?: string;
  sessionId?: string;
}
```

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

| Sink | Storage | Notes |
|---|---|---|
| `MemoryTelemetrySink` | in-memory ring | capacity 1000 (default), queryable; used in tests |
| `NoOpTelemetrySink` | none | `query()` throws `NotSupportedTelemetryQueryError` |
| `GatewaySugarlangTelemetrySink` | POST to gateway | batches up to 100 events per request, flush every 5s, drop-on-failure |

`GatewaySugarlangTelemetrySink` delivery guarantees:

- A flush drains at most 100 events; if more are pending it immediately
  reschedules itself, so a burst larger than the cap drains in successive
  batches instead of stranding the remainder.
- On `pagehide` and on `visibilitychange` to `hidden`, all pending batches
  are fired with `fetch(..., { keepalive: true })` so the last few seconds
  of a session survive tab close (keepalive shares a 64KB in-flight quota;
  overflow drops, matching the drop-on-failure posture).
- `dispose()` clears the flush timer, removes both listeners, and drains
  everything still pending.

`resolveSugarlangTelemetrySink({ proxyBaseUrl })` picks one, called once per
plugin instance in `manifest.ts`. There is no compile-profile branch:

- proxy base URL configured: `GatewaySugarlangTelemetrySink`.
- otherwise: `NoOpTelemetrySink` (events dropped).

Studio, Preview and the published game therefore have the same destination,
so a gateway fault is visible while authoring instead of only in production,
and a reading taken in Preview is evidence about what the deployed game does.

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
| `movedSegments` | segment NAMES of the situation key that moved — `["nodes"]`, `["quest","time"]`. Never values: every segment but `time` is a uuid or a hash, and values would give this one distinct value per player |
| `firstTurnOfConversation` | the only turn the caching work is about; later turns hit regardless |
| `teacherMs` | what the turn actually waited — ~0 when served, seconds when blocking |

One row per decision is deliberate. A rate needs its numerator and denominator
from the same event, which is why this replaced `teacher.cache-hit`: an event
that only fired on the good outcome could never show the fleet regressing.

Three questions it answers:

- **Working?** Share of rows with `firstTurnOfConversation = true` where
  `outcome = hit`.
- **Regressed?** Any sustained rate of `outcome = blocking-miss`. That is the
  case the caching work exists to remove, so a non-zero rate is the alarm — it
  catches warming having stopped, the stale-serve bound tripping because the
  gateway is failing, the boot warm not firing, and the cache not being written.
- **What invalidates these in the wild?** Group by `movedSegments`. `time`
  dominating would mean the clock band is finer than the directive's useful
  life; `hash` appearing means scenes are being rebuilt under live players.

## Gateway Ingestion Route

**Route:** `POST /api/sugarlang/telemetry`
**Handler:** `handleSugarlangTelemetry` in
`packages/plugins/src/deployment/gateway/core.ts`

The route is declared by the plugin manifest as a `proxy-route` deployment
requirement (`routeId: "sugarlang-telemetry"`, `required: false`) in
`packages/plugins/src/catalog/sugarlang/manifest.ts`; the gateway dispatcher
routes on that `routeId`.

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

Client batch shape (from `GatewaySugarlangTelemetrySink.flush`):

```json
{ "events": [ ... ], "schemaVersion": 1 }
```

## PII Scrub

The primary scrub is CLIENT-side, in `GatewaySugarlangTelemetrySink`. Before
an event leaves the browser, `stripPii` drops these top-level fields
(`SERVER_BOUND_PII_FIELDS`):

- `inputText` (classifier.verdict)
- `playerResponseText` (comprehension probe events)

plus one known nested path: `observe.observations-applied` nests player-typed
text at `observations[].observation.inputText` (`produced-typed`
observations, see `runtime/contracts/observation.ts`), which `stripPii`
removes while keeping the rest of the observation.

The gateway re-scrubs as defense in depth: `scrubSugarlangTelemetryEvent`
in `packages/plugins/src/deployment/gateway/core.ts` deletes the same
top-level fields and the nested `observation.inputText` from every event
before it is written to stdout. The field list is duplicated there
(`SUGARLANG_TELEMETRY_PII_FIELDS`) because the gateway compiles standalone;
keep it in sync with `SERVER_BOUND_PII_FIELDS` in `telemetry.ts`.

The local IndexedDB sink stores full events including these fields -- that is
the debugging point of the Studio sink.

## Proxy Base URL Resolution

**Env var:** `SUGARMAGIC_SUGARLANG_PROXY_BASE_URL`
(`SUGARLANG_PROXY_BASE_URL_ENV` in
`packages/plugins/src/catalog/sugarlang/config.ts`)

Resolution order, applied identically in `manifest.ts` (telemetry sink) and
`runtime/runtime-services.ts` (LLM gateway client):

1. `SUGARMAGIC_SUGARLANG_PROXY_BASE_URL` (trimmed)
2. `SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL` (trimmed) -- sugarlang shares the
   SugarAgent gateway; the `/api/sugaragent/generate` handler is a generic
   Claude proxy, not sugaragent-specific
3. empty string -> no gateway client (teacher runs fallback-only) and, on a
   published target, the NoOp telemetry sink

Related but distinct: the manifest declares `gatewayRuntimeConfigKeys` for the
values the gateway genuinely reads (models). `targetLanguage` was declared here
until 2026-07-29 and is not any more -- the gateway never read it, and target
language is a **player's** choice rather than a deploy value. It resolves
player selection -> project config, in `resolveSugarLangTargetLanguage` and
nowhere else.
