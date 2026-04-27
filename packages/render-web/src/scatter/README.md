# `render-web/src/scatter`

Shared scatter realization for web hosts.

This module owns the Three/WebGPU realization of surface scatter layers. It
does **not** decide authored meaning — `runtime-core` resolves a surface layer
into a `ResolvedScatterLayer`, and this module turns that already resolved
layer plus concrete sample points into rendered scatter instances.

Owns:

- procedural tuft / flower geometry for Stage 1 scatter
- per-sample mask gating for realized scatter instances
- deterministic instance transforms / jitters
- Story 36.16's GPU compute candidate build, culling, and indirect draw buffers
- Story 36.17's per-bin scatter LOD routing and distance-density thinning math
- CPU fallback realization when WebGPU compute is unavailable
- optional wind-deform application through the shared `ShaderRuntime`

Does **not** own:

- authored layer semantics (`@sugarmagic/domain`)
- layer resolution / validation (`@sugarmagic/runtime-core`)
- editor-only preview sampling logic

Landscape, asset-slot scatter, and the Surface Library preview all consume this
module so "what a scatter layer renders like" stays a single web-render
implementation.
