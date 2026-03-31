# `packages/runtime-core`

Shared runtime semantics for authoring preview, playtest, and published targets.

Owns:

- scene assembly
- runtime session behavior
- material semantics
- landscape runtime
- environment runtime
- VFX runtime

Does not own:

- shell UI
- canonical authored persistence

References:

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [API 002: `/packages/runtime-core` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
