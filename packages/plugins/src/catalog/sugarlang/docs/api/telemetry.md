# Telemetry API

Status: Updated in Epic 14

Sugarlang now logs typed telemetry events for the adaptive-learning runtime and
exposes two Studio-facing readers on top of the same event stream.

## Canonical Runtime Surface

Files:

- `packages/plugins/src/catalog/sugarlang/runtime/telemetry/telemetry.ts`

This module is the single source of truth for:

- the `TelemetryEvent` discriminated union
- `TelemetrySink`
- `MemoryTelemetrySink`
- `NoOpTelemetrySink`
- `GatewaySugarlangTelemetrySink`

## Event Families

Core turn events:

- `budgeter.prescription-generated`
- `teacher.invocation-started`
- `teacher.invocation-completed`
- `classifier.verdict`
- `chunk.extraction-started`
- `chunk.extraction-completed`
- `chunk.extraction-failed`
- `chunk.extraction-drift-detected`
- `chunk.hit-during-classification`
- `chunk.extraction-stale-discarded`
- `verify.repair-triggered`
- `observe.observations-applied`
- `placement.completed`
- `session.started`
- `session.ended`

Comprehension lifecycle:

- `comprehension.probe-triggered`
- `comprehension.probe-fired`
- `comprehension.probe-response-received`
- `comprehension.probe-passed`
- `comprehension.probe-failed`
- `comprehension.probe-mixed-result`
- `comprehension.probe-language-fallback`
- `comprehension.teacher-hard-floor-violated`

Quest-essential visibility:

- `quest-essential.classifier-exempted-lemma`
- `quest-essential.teacher-forced-glossing`
- `quest-essential.teacher-targetvocab-contamination`
- `quest-essential.generator-missed-gloss`
- `quest-essential.generator-missed-required`
- `quest-essential.compile-diagnostic-deadlock-prone`

Learner-state audit:

- `fsrs.seeded-from-placement`
- `fsrs.provisional-evidence-accumulated`
- `fsrs.provisional-evidence-committed`
- `fsrs.provisional-evidence-discarded`
- `fsrs.provisional-evidence-decayed`
- `learner-profile.updated`

Every event includes:

- `eventId`
- `kind`
- `schemaVersion`
- `timestamp`
- optional `conversationId`
- optional `turnId`
- optional `sessionId`

## Sink Selection

Sink selection does not depend on the compile profile. Studio, Preview and the
published game all send to the same place:

- a gateway proxy base URL is configured: `GatewaySugarlangTelemetrySink`
- otherwise: `NoOpTelemetrySink`

Events are read where the gateway writes them -- `docker compose logs` locally,
Cloud Logging in production. See `docs/api/sugarlang-telemetry.md`.

Telemetry is best-effort. Gameplay code emits through the safe helper and drops
events on sink failure rather than surfacing errors to the player.

## Debug Readers

`RationaleTraceBuilder` reconstructs one turn from the event stream. The Studio
turn inspector uses `DebugPanelDataSource`, which provides:

- `listRecentConversations()`
- `listTurnsInConversation(conversationId)`
- `getTurnRationale(conversationId, turnId)`

The comprehension monitor uses `ComprehensionMonitorDataSource`, which provides:

- `listRecentProbes()`
- `getProbeDetail(probeId)`
- `getSessionRollup(sessionId)`
- `getLemmaProbeHistory(lemmaRef, learnerId)`

## Chunk Event Notes

- `chunk.extraction-started`
  - emitted when the compile-time extractor begins work for one `sceneId + contentHash`
- `chunk.extraction-completed`
  - emitted when extraction succeeds, including `chunkCount`, `latencyMs`, and token-cost estimates
- `chunk.extraction-failed`
  - emitted on request or parse failure; Preview degrades gracefully to lemma-only mode
- `chunk.extraction-drift-detected`
  - emitted by the chunk cache when re-extraction changes chunk count or normalized-form membership
- `chunk.hit-during-classification`
  - emitted during classifier runs when the chunk pre-pass matches one or more lexical chunks in generated text
- `chunk.extraction-stale-discarded`
  - emitted when authoring-time extraction finishes against an old content hash and the write-back is intentionally dropped

`RationaleTraceBuilder` now includes `matchedChunks` per turn so the Studio turn inspector can show exactly which chunk spans affected the classifier verdict.
