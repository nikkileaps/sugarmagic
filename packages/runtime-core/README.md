# `packages/runtime-core`

Shared runtime semantics for authoring preview, playtest, and published targets.

Owns:

- scene assembly
- runtime session behavior
- material semantics
- landscape runtime
- environment runtime
- VFX runtime
- the shared authored-content load path used by both Build preview and runtime preview

Does not own:

- shell UI
- canonical authored persistence

References:

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [API 002: `/packages/runtime-core` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

## Foliage Runtime Boundary

Runtime-core keeps foliage inside the same scene assembly path as every other
placed asset. The scene descriptor can distinguish `assetKind: "foliage"`, but
runtime optimization policy, shader behavior, and host-specific GLTF loading
still flow through one auditable runtime-visible path rather than a separate
editor-only foliage renderer.
