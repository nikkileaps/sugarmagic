# `render-web/src/scatter`

Shared scatter realization for web hosts.

This module owns the Three/WebGPU realization of Stage 1 surface scatter
layers. It does **not** decide authored meaning — `runtime-core` resolves a
surface layer into a `ResolvedScatterLayer`, and this module turns that already
resolved layer plus concrete sample points into instanced meshes.

Owns:

- procedural tuft / flower geometry for Stage 1 scatter
- per-sample mask gating for realized scatter instances
- deterministic instance transforms / jitters
- optional wind-deform application through the shared `ShaderRuntime`

Does **not** own:

- authored layer semantics (`@sugarmagic/domain`)
- layer resolution / validation (`@sugarmagic/runtime-core`)
- editor-only preview sampling logic

Landscape and the Surface Library preview both consume this module so "what a
grass scatter layer renders like" stays a single web-render implementation.
