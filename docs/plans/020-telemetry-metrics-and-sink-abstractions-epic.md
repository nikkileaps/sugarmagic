# Plan 020: Telemetry Metrics and Sink Abstractions Epic

**Status:** Proposed  
**Date:** 2026-04-04

## Epic

### Title

Add shared telemetry and metrics infrastructure to Sugarmagic using collector and sink abstractions so runtime systems such as SugarAgent can emit structured measurements without coupling to any specific storage, logging, or observability backend.

### Goal

Deliver a first-class telemetry and metrics foundation for Sugarmagic that:

- gives runtime systems one shared way to emit metrics and telemetry
- keeps telemetry collection separate from telemetry delivery
- uses provider and adapter seams so outputs can be routed to different backends later
- supports counters, timings, gauges, and structured telemetry events
- works for both normal runtime systems and plugin-provided runtime behavior
- keeps `packages/runtime-core` and future plugins independent from any specific metrics vendor
- leaves room for later sinks such as:
  - database persistence
  - Grafana or OpenTelemetry pipelines
  - Google Cloud logging or metrics ingestion
  - console or local debug sinks
- is designed cleanly enough that the same architecture can later be carried back into Sugarengine
- adheres to the project principles:
  - one source of truth
  - single enforcer
  - one-way dependencies
  - one type per behavior
  - goals must be verifiable

## Scope

This epic includes:

- a shared telemetry event and metrics model
- a single `TelemetryCollector` interface for emitting metrics and structured telemetry events from runtime systems
- sink/adapter interfaces for delivering telemetry to concrete destinations
- support for common signal types:
  - counters
  - timers or durations
  - gauges
  - structured events
- runtime-core bootstrap seams for passing telemetry collectors into shared runtime systems
- plugin-friendly telemetry interfaces so plugin code can emit through the same shared surface
- debug/dev sinks for local development
- explicit telemetry support for lifecycle instrumentation such as:
  - plugin mount and dispose
  - conversation turn stage timing
  - fallback and degraded-path counting
  - retrieval or provider backend usage
- documentation of how this architecture should later be portable back into Sugarengine

## Out Of Scope

This epic does not include:

- choosing one permanent hosted observability vendor
- building dashboards
- building a production Grafana stack
- building a production GCP logging pipeline
- building a production database analytics schema
- replacing all debug logs with metrics
- implementing all SugarAgent metrics yet
- retrofitting all existing Sugarmagic systems in one pass
- automatic alerting or SLO infrastructure

This epic creates the foundation and first integration seams.

## Why this epic exists

Sugarmagic now has growing runtime complexity:

- plugin lifecycle
- conversation host composition
- quest runtime
- inventory/runtime interactions
- spell runtime
- future SugarAgent turn pipelines

We already know we want:

- structured debug logging
- clear degraded-path visibility
- backend-agnostic runtime services

But we do not yet have a real shared telemetry architecture.

Right now there is no actual collector or sink abstraction in Sugarmagic for metrics delivery. That means systems can log, but they do not yet have one clean, swappable path for emitting measurements to a backend.

This epic exists to fix that before SugarAgent and other advanced runtime systems accumulate ad hoc observability code.

## Recommendation

### Core recommendation

Sugarmagic should add telemetry as a shared runtime service with two distinct layers:

- `TelemetryCollector`
- `TelemetrySink` delivery adapters

Runtime systems should emit telemetry through the shared collector interface only.

Concrete backends should be implemented behind sink adapters.

### Separation recommendation

Sugarmagic should keep these concerns separate:

1. Debug logs
- human-readable or structured runtime investigation output

2. Telemetry events
- structured event records representing meaningful runtime occurrences

3. Metrics
- aggregated signals such as counts, durations, or gauges

These may share plumbing, but they should not be collapsed into one vague concept.

### Portability recommendation

The telemetry design should be intentionally portable back to Sugarengine.

That means:

- no Sugarmagic-only assumptions in the core telemetry model unless truly required
- clear runtime-facing interfaces
- sink abstractions that are not coupled to one host application

The goal is to avoid solving this only in Sugarmagic and then repeating the observability mess elsewhere.

## Proposed architecture

### 1. Telemetry collector interface

Shared runtime code should depend on one collector interface:

- `TelemetryCollector`

`TelemetryCollector` is the single runtime-facing emission surface. It handles both metric-style signals and structured telemetry events.

Responsibilities:

- increment counters
- record durations
- set gauges
- emit structured events

Important rule:

- runtime systems emit through this interface only
- runtime systems do not call concrete sinks directly

### 2. Sink adapter interface

Concrete delivery backends should implement one sink interface:

- `TelemetrySink`

Possible implementations later:

- `ConsoleTelemetrySink`
- `InMemoryTelemetrySink`
- `DatabaseTelemetrySink`
- `OpenTelemetrySink`
- `GoogleCloudTelemetrySink`

Important rule:

- sink implementations own backend-specific formatting and delivery
- backend-specific APIs must not leak into runtime systems

### 3. Optional aggregator or fan-out layer

Sugarmagic should allow one collector to fan out to multiple sinks.

Example:

- local console sink for dev visibility
- in-memory sink for tests
- production sink for hosted collection

This should happen behind the collector boundary, not inside individual runtime systems.

### 4. Context and dimensions model

Telemetry records should support structured dimensions or tags such as:

- `system`
- `pluginId`
- `providerId`
- `npcId`
- `conversationSessionId`
- `turnId`
- `stage`
- `backend`
- `fallbackPath`
- `result`

Important rule:

- tags must be standardized enough to query meaningfully later
- but not so free-form that the system becomes impossible to reason about

## Keep, Modify, Discard

### Keep

1. Structured diagnostics thinking
- the SugarAgent epic already pushes toward structured diagnostics; that direction is correct.

2. Backend abstraction discipline
- the same pattern we are using for LLM, embeddings, and vector stores should also apply to telemetry.

3. Runtime-core ownership of shared runtime service seams
- telemetry belongs alongside other shared runtime services, not hidden in a target.

### Modify

1. Move from logging-only thinking to metrics + telemetry + logs
- logs alone are not enough.

2. Make telemetry explicit before systems sprawl
- add the seam before every subsystem invents its own event format.

3. Keep the shape portable to Sugarengine
- do not let this become deeply host-specific if we know we want to carry it back.

### Discard

1. Ad hoc direct backend writes from runtime code
- runtime-core and plugins should not directly post to vendor backends.

2. One-off metrics plumbing inside each subsystem
- that would violate the single-enforcer goal.

3. Treating console logging as the complete observability strategy
- useful for debugging, insufficient as the architecture.

## Recommended package and dependency shape

A clean first shape would be:

- shared telemetry types and interfaces in a dedicated package or shared runtime module
- runtime-core depends on the interface only
- targets or host apps compose concrete sinks
- plugins can emit through the same interface without learning backend details

Possible package directions:

- `packages/telemetry`
- or a focused `runtime-core` telemetry module if we want to start smaller

My recommendation is:

- start with a dedicated shared package if the team agrees telemetry will matter broadly across runtime and plugins
- otherwise start as a focused `runtime-core` module with a clear extraction path

## Suggested runtime API shape

Conceptual examples on `TelemetryCollector`:

- `incrementCounter(name, value, tags)`
- `recordDuration(name, durationMs, tags)`
- `setGauge(name, value, tags)`
- `emitEvent(name, payload, tags)`

This is intentionally one interface so runtime code has one emission surface for both numeric metrics and structured telemetry events.

Important rule:

- the public API should be small and stable
- event and metric naming should be normalized centrally

## Suggested first integrations

This epic should not try to wire everything.

The best first integrations are the places where we already know observability matters:

1. Plugin lifecycle
- plugin discovered
- plugin enabled
- plugin instance created
- plugin initialized
- plugin disposed

2. Conversation lifecycle
- provider selected
- turn started
- turn completed
- stage durations for:
  - interpret
  - retrieve
  - plan
  - generate
  - audit
  - repair

3. Fallback and degradation paths
- no-embeddings mode entered
- lexical-only retrieval used
- provider unavailable
- scripted handoff chosen
- abstention emitted

4. Backend usage
- generation backend selected
- embeddings backend selected
- vector-store backend selected

These integrations line up directly with the SugarAgent work already being planned.

## Testing recommendation

Telemetry infrastructure should be testable without a real backend.

Required test seam:

- `InMemoryTelemetrySink` or equivalent capture adapter for tests

That should let tests assert things like:

- a counter was incremented
- a duration was recorded
- a fallback event was emitted
- plugin initialization produced the expected event

## Sugarengine portability note

This epic is being written in Sugarmagic, but one of its purposes is to define an observability architecture we can later carry back into Sugarengine.

That means the final design should be easy to translate into Sugarengine for:

- plugin lifecycle instrumentation
- SugarAgent turn lifecycle instrumentation
- retrieval and generation backend instrumentation
- degraded-path metrics and events

We should treat that as an explicit design constraint, not as an afterthought.

## Stories

1. Define shared telemetry and metrics interfaces and event model
2. Add collector and sink abstractions with support for counters, durations, gauges, and structured events
3. Add development and test sinks such as console and in-memory collectors
4. Thread telemetry collectors through shared runtime bootstrap and runtime-core service composition
5. Add first lifecycle instrumentation for plugin mount, dispose, and runtime provider selection
6. Add first turn-stage instrumentation seams for conversation pipelines and degraded-path counting
7. Document naming conventions, tag conventions, and portability expectations for later Sugarengine adoption

## Verification

This epic is complete when all of the following are true:

1. shared runtime systems can emit metrics and structured telemetry events through `TelemetryCollector` without knowing the concrete backend
2. concrete `TelemetrySink` implementations can be swapped without changing runtime-core emission code
3. test code can capture emitted telemetry through an in-memory sink
4. plugin lifecycle events can be emitted through the shared telemetry seam
5. turn-stage timing and fallback counts can be emitted through the shared telemetry seam
6. no runtime subsystem writes directly to a vendor-specific telemetry backend
7. the architecture is documented clearly enough to port back into Sugarengine later

## Non-goals for v1

To keep this achievable, this epic intentionally does not require:

- shipping a full hosted telemetry platform
- instrumenting every subsystem in the codebase immediately
- solving dashboarding, alerting, and retention policy in the same pass
- replacing the separate structured debug logging requirements already called for in Plan 019

The first win is a clean, swappable telemetry seam that future runtime systems can depend on without backend coupling.
