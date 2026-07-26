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
(middlewares, Director, learner reducer, classifier, chunk compiler) emits
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

`TelemetryQuery` + `matchesTelemetryQuery` provide the read side used by the
Studio debug readers (`runtime/telemetry/debug-panel-data.ts`,
`comprehension-monitor-data.ts`): filter by `conversationId`, `turnId`,
`sessionId`, `eventKinds`, `probeId`, `lemmaId`, `npcId`, time range, limit.

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
| `director.pre-placement-bypass` | `runtime/middlewares/sugar-lang-teacher-middleware.ts` |
| `verify.pre-placement-bypass` | `runtime/middlewares/sugar-lang-verify-middleware.ts` |
| `observer.pre-placement-bypass` | `runtime/middlewares/sugar-lang-observe-middleware.ts` |
| `observer.placement-questionnaire-bypass` | `runtime/middlewares/sugar-lang-observe-middleware.ts` |
| `placement.completed` | `runtime/middlewares/sugar-lang-observe-middleware.ts` |

**Budgeter, classifier, verify**

| Kind | Producer |
|---|---|
| `budgeter.prescription-generated` | `sugar-lang-context-middleware.ts` |
| `classifier.verdict` | `sugar-lang-verify-middleware.ts` (every checked turn) |
| `quest-essential.classifier-exempted-lemma` | `sugar-lang-verify-middleware.ts` |
| `verify.repair-triggered` | `sugar-lang-verify-middleware.ts` (LLM repair accepted) |
| `verify.auto-simplify-triggered` | `sugar-lang-verify-middleware.ts` (deterministic fallback fired) |
| `observe.observations-applied` | `sugar-lang-observe-middleware.ts` |

**Comprehension probes**

| Kind | Producer |
|---|---|
| `comprehension.probe-triggered` | `sugar-lang-teacher-middleware.ts` |
| `comprehension.probe-fired` | `sugar-lang-observe-middleware.ts` |
| `comprehension.probe-response-received` | `sugar-lang-observe-middleware.ts` |
| `comprehension.probe-passed` / `-failed` / `-mixed-result` | `sugar-lang-observe-middleware.ts` |
| `comprehension.probe-language-fallback` | `sugar-lang-observe-middleware.ts` |
| `comprehension.director-hard-floor-violated` | `sugar-lang-teacher-middleware.ts` and `runtime/teacher/schema-parser.ts` |

**Director (teacher)**

| Kind | Producer |
|---|---|
| `director.invocation-started` / `-failed` | `runtime/teacher/policies/llm-teacher-policy.ts` |
| `director.invocation-completed` | `runtime/teacher/sugar-lang-teacher.ts` and `llm-teacher-policy.ts` |
| `director.cache-hit` / `director.invocation-resolved` | `runtime/teacher/sugar-lang-teacher.ts` |
| `directive-cache.invalidated` | `runtime/teacher/directive-cache.ts` |
| `quest-essential.director-forced-glossing` | `runtime/teacher/schema-parser.ts` |
| `quest-essential.director-targetvocab-contamination` | `runtime/teacher/schema-parser.ts` |

**Chunk extraction (scene lexicon tier 2)**

| Kind | Producer |
|---|---|
| `chunk.extraction-started` / `-completed` / `-failed` | `runtime/compile/extract-chunks.ts` |
| `chunk.extraction-drift-detected` | `runtime/compile/chunk-cache.ts` |
| `chunk.extraction-stale-discarded` | `runtime/compile/compile-scheduler.ts` |
| `chunk.hit-during-classification` | `runtime/classifier/envelope-classifier.ts` |

**Declared but not yet emitted.** Four kinds exist in the union with no
producing `createTelemetryEvent` call anywhere in the sugarlang tree:
`quest-essential.generator-missed-gloss`,
`quest-essential.generator-missed-required`,
`quest-essential.compile-diagnostic-deadlock-prone`, and
`fsrs.review-outcome`. Treat them as reserved schema, not live signals.

## Sinks and Resolution

`TelemetrySink` is the extension point: `emit` (required), `flush` and
`query` (optional). `QueryableTelemetrySink` requires both.

| Sink | Storage | Notes |
|---|---|---|
| `MemoryTelemetrySink` | in-memory ring | capacity 1000 (default), queryable; used in tests |
| `IndexedDBTelemetrySink` | IDB db `sugarlang-telemetry`, store `sugarlang-telemetry` | workspace `sugarlang-telemetry:studio`, capacity 50,000, batched flush every 100ms, queryable |
| `NoOpTelemetrySink` | none | `query()` throws `NotSupportedTelemetryQueryError` |
| `GatewaySugarlangTelemetrySink` | POST to gateway | batches up to 100 events, flush every 5s, drop-on-failure |

`resolveSugarlangTelemetrySink(boot, { proxyBaseUrl })` picks one, called once
per plugin instance in `manifest.ts`:

- `boot.compileProfile === "published-target"`: `GatewaySugarlangTelemetrySink`
  when a proxy base URL is configured, else `NoOpTelemetrySink` (events
  dropped).
- Otherwise (Studio / preview): `IndexedDBTelemetrySink` when `indexedDB`
  exists, else `NoOpTelemetrySink`.

So Studio sessions accumulate locally queryable events; published games ship
them to the gateway; a published game without a gateway drops everything.

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

The scrub is CLIENT-side, in `GatewaySugarlangTelemetrySink`. Before an event
leaves the browser, `stripPii` drops these top-level fields
(`SERVER_BOUND_PII_FIELDS`):

- `inputText` (classifier.verdict)
- `originalText`, `repairedText` (verify.repair-triggered / auto-simplify)
- `playerResponseText` (comprehension probe events)

The gateway logs whatever arrives; it does not re-scrub. The local
IndexedDB sink stores full events including these fields -- that is the
debugging point of the Studio sink.

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

Related but distinct: the manifest also declares
`gatewayRuntimeConfigKeys` mapping the `targetLanguage` config value to the
gateway env var `SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE` (non-secret, plumbed by
SugarDeploy at deploy time).
