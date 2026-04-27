# `render-web/src/billboard`

Isolated billboard math for scatter LOD.

This module owns the cylindrical camera-facing transform used by Story 36.17's
billboard scatter bin. It exists so billboarding stays a single render-web
concern instead of leaking math into `ShaderRuntime`, `RenderView`, or the
compute pipeline.

Owns:

- pure JS billboard basis / position math for tests
- no runtime material mutation; scatter compute writes camera-facing billboard
  matrices directly into the billboard bin's visible instance buffer

Does **not** own:

- authored LOD meaning (`@sugarmagic/domain`)
- scatter bin selection / keep probability (`render-web/src/scatter/lod.ts`)
- general shader compilation (`ShaderRuntime`)
- per-frame billboard matrix upload (`render-web/src/scatter/compute-pipeline.ts`)
