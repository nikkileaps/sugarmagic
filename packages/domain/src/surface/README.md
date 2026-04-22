# Surface Domain

This module owns the canonical authored slot-content model for render-facing
traits in Sugarmagic.

- `Surfaceable` declares per-slot fragment surfaces.
- `Deformable` declares one whole-object vertex deformation slot.
- `Effectable` declares one whole-object fragment-effect slot.

`Surface` is the one domain shape that can fill a slot. runtime-core resolves
that authored surface into an effective shader binding; render-web realizes the
resolved binding into Three/WebGPU materials and nodes.

This keeps one source of truth for slot content and prevents assets,
landscapes, and future renderable definitions from each inventing their own
binding shape.
