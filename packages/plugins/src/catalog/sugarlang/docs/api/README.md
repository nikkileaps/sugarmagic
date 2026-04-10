# Sugarlang API Docs

This index tracks the API documents that later epics fill in as sugarlang moves
from skeleton to implementation.

| File                           | Scope                                                                                   | Populated By            | Status            |
| ------------------------------ | --------------------------------------------------------------------------------------- | ----------------------- | ----------------- |
| `budgeter.md`                  | Public Budgeter inputs, outputs, scoring hooks, and rationale surfaces.                 | Epic 3, Epic 8          | Updated in Epic 3 |
| `classifier.md`                | Public Envelope Classifier interfaces, deterministic pipeline, and repair entry points. | Epic 3, Epic 5          | Updated in Epic 3 |
| `director.md`                  | Director output contract, prompt boundary, schema parsing, and fallback policy seams.   | Epic 3, Epic 9          | Updated in Epic 3 |
| `learner-state.md`             | Learner profile, reducer-owned state, persistence, and session signal surfaces.         | Epic 3, Epic 7          | Updated in Epic 3 |
| `scene-lexicon-compilation.md` | Scene compiler, content hashing, cache ownership, and compile-profile contract.         | Epic 3, Epic 6          | Updated in Epic 3 |
| `middlewares.md`               | Middleware ordering, annotation contracts, and SugarAgent integration seam.             | Epic 2, Epic 10         | Updated in Epic 2 |
| `placement-contract.md`        | Placement capability boundary, questionnaire ownership, and quest signaling contract.   | Epic 2, Epic 3, Epic 11 | Updated in Epic 3 |
| `editor-contributions.md`      | Studio-facing shell contribution surfaces and editor-only plugin UI.                    | Epic 1, Epic 12         | Stub              |
| `telemetry.md`                 | Telemetry sink contract, rationale traces, and debug-panel-facing data surfaces.        | Epic 1, Epic 13         | Stub              |
| `providers.md`                 | ADR 010 provider interfaces and implementation ownership boundaries.                    | Epic 3                  | Updated in Epic 3 |

## Import Surface

Consumers should prefer importing public runtime contracts from
`packages/plugins/src/catalog/sugarlang/runtime/types.ts` rather than reaching
into individual `runtime/contracts/*` files.

## Language Data Files

Epic 4 makes the plugin-shipped language assets part of the public architecture.
The canonical schemas live under:

- `packages/plugins/src/catalog/sugarlang/data/schemas/`

The end-to-end walkthrough for adding another language lives at:

- `packages/plugins/src/catalog/sugarlang/data/languages/README.md`

## Registration Smoke Test

The canonical "plugin is importable and can be instantiated" check for Epic 1 is [tests/plugin-registration.test.ts](../../tests/plugin-registration.test.ts).
