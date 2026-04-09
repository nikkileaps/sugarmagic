# Sugarlang API Docs

This index tracks the API documents that later epics will fill in as sugarlang moves from skeleton to implementation.

| File | Scope | Populated By | Status |
| --- | --- | --- | --- |
| `budgeter.md` | Public Budgeter inputs, outputs, scoring hooks, and rationale surfaces. | Epic 1, Epic 8 | Stub |
| `classifier.md` | Public Envelope Classifier interfaces, deterministic pipeline, and repair entry points. | Epic 1, Epic 5 | Stub |
| `director.md` | Director output contract, prompt boundary, schema parsing, and fallback policy seams. | Epic 1, Epic 9 | Stub |
| `learner-state.md` | Learner profile, reducer-owned state, persistence, and session signal surfaces. | Epic 1, Epic 7 | Stub |
| `scene-lexicon-compilation.md` | Scene compiler, content hashing, cache ownership, and compile-profile contract. | Epic 1, Epic 6 | Stub |
| `middlewares.md` | Middleware ordering, annotation contracts, and SugarAgent integration seam. | Epic 1, Epic 10 | Stub |
| `placement-contract.md` | Placement capability boundary, questionnaire ownership, and quest signaling contract. | Epic 1, Epic 11 | Stub |
| `editor-contributions.md` | Studio-facing shell contribution surfaces and editor-only plugin UI. | Epic 1, Epic 12 | Stub |
| `telemetry.md` | Telemetry sink contract, rationale traces, and debug-panel-facing data surfaces. | Epic 1, Epic 13 | Stub |
| `providers.md` | ADR 010 provider interfaces and implementation ownership boundaries. | Epic 1, Epic 3 | Stub |

## Registration Smoke Test

The canonical "plugin is importable and can be instantiated" check for Epic 1 is [tests/plugin-registration.test.ts](../../tests/plugin-registration.test.ts).
