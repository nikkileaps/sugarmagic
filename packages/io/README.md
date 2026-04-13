# `packages/io`

Game-root, persistence, import, export, and publish boundaries.

Owns:

- game-root discovery
- canonical document load/save
- import boundaries
- compatibility export boundaries
- publish boundaries
- GLB contract validation at the import boundary

Does not own:

- domain meaning
- runtime semantics

References:

- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [API 002: `/packages/io` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

## Foliage Import Contract

IO recognizes foliage by inspecting the imported GLB itself.

- Blender exports one canonical authored GLB.
- No Blender-owned sidecar metadata is required or expected.
- Import may classify a GLB as `assetKind: "foliage"` when it carries the
  expected authored foliage markers and required GLB-safe payloads.
- Invalid foliage GLBs fail at import with actionable errors instead of quietly
  degrading into generic assets.

IO does not own runtime foliage policy. It only enforces that imported foliage
assets cross the boundary with a valid authored GLB handoff.
