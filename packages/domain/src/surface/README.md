# Surface Domain

This module owns the canonical authored render-slot model for Sugarmagic.

- `Surfaceable` declares per-slot `SurfaceBinding`s.
- `SurfaceBinding.inline` carries a `Surface`, which is now a layer stack.
- `SurfaceBinding.reference` points at a reusable `SurfaceDefinition`.
- `Deformable` and `Effectable` stay whole-mesh `ShaderOrMaterial` bindings.

Layer contents are split by concern:

- `AppearanceContent` for base visible material/color/texture/shader
- `ScatterContent` for grass / flowers
- `EmissionContent` for additive glow layers
- `Mask` and `BlendMode` for per-layer composition

runtime-core is the single semantic resolver for these authored shapes.
render-web is the single enforcer that realizes the resolved meaning into
Three/WebGPU nodes, materials, and scatter meshes.
