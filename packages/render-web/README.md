# `@sugarmagic/render-web`

Shared web-facing rendering infrastructure for Sugarmagic.

This package is the permanent home for the Three.js / WebGPU realization of
runtime-authored rendering behavior that must be shared by:

- Studio's authoring viewport
- published web/runtime hosts

It exists to prevent a split where editor rendering and published rendering
drift apart or where apps/targets start depending on each other directly for
runtime-visible behavior.

Owns:

- `ShaderRuntime` finalization and lifecycle
- object-tree shader application helpers
- authored environment realization (`EnvironmentSceneController`)
- authored post-process stack application
- shared runtime render-pipeline wrappers

Does **not** own:

- canonical authored truth (`@sugarmagic/domain`)
- environment resolution semantics (`@sugarmagic/runtime-core`)
- app/target shell concerns

If behavior must mean the same thing in Studio and in the published web target,
and it requires Three.js/WebGPU to realize, it belongs here.
