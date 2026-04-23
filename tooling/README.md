# `tooling`

Shared tooling configuration and supporting build/dev infrastructure for the repo.

This directory is for tooling support, not runtime or domain ownership.

Current checks include:

- `check-package-boundaries.mjs`: package-layer dependency boundaries
- `check-shell-tokens.mjs`: shell token and shared UI usage
- `check-filename-conventions.mjs`: filename convention enforcement for selected source areas
- `check-viewport-imperative.mjs`: prevents legacy viewport mutation methods from reappearing on the shared workspace viewport contract
- `check-render-engine-boundary.mjs`: enforces the shared `WebRenderEngine` / `RenderView` split and keeps `render-web` free of shell-store imports
- `check-surface-trait-boundary.mjs`: prevents authored asset/landscape slots from bypassing the canonical `Surface` union with direct `materialDefinitionId` fields
- `check-surface-layerstack-boundary.mjs`: prevents Epic 036's layer-stack `Surface` shape from drifting back to raw flat-slot ownership
