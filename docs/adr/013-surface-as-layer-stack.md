# ADR 013: Surface as Layer Stack

## Status

Accepted

## Date

2026-04-22

## Context

Epic 034 correctly separated authored render behavior into three pipeline
traits:

- `Surfaceable`
- `Deformable`
- `Effectable`

That split answered "when does this run?" but it did not answer "what lives
inside one surface slot?" A flat surface union could only express one thing per
slot:

- one color
- one texture
- one material
- one shader

That model breaks down for the painterly environments Sugarmagic is targeting.
Authors need one slot to carry layered appearance and scatter:

- green ground + tall grass + flowers + warm light
- bark + moss tint
- future roof + moss / flowers / clover

Those are not separate pipeline stages. They are layered contents inside one
surface slot.

## Decision

Sugarmagic keeps Epic 034's trait split, but the authored contents of one
surface slot are now a layer stack:

- `Surface = { layers, context }`

The flat Epic 034 surface union becomes `AppearanceContent`, which is one
possible content source for an appearance layer.

### Canonical layer kinds

A `Surface` is an ordered stack of:

- `appearance`
- `scatter`
- `emission`

Rules:

- `layers[0]` must be an `appearance` layer with `blendMode: "base"`
- higher layers composite in authored order
- `context` is derived from the layers, not hand-authored independently
- a layer stack is still the content of one `Surfaceable` slot

### Ownership boundaries

- `@sugarmagic/domain`
  - layer-stack types, layer factories, content-library primitives
- `@sugarmagic/runtime-core`
  - semantic resolution from authored `SurfaceBinding` to resolved appearance /
    scatter / emission layers
- `@sugarmagic/render-web`
  - Three/WebGPU realization of the resolved layer stack, including blend math
    and Stage 1 scatter realization
- `apps/studio`
  - preview-only primitive sampling and editor viewport composition

This keeps authored meaning resolved once and realized once.

### Surface binding rule

Authored slots do not hold raw `Surface` anymore. They hold:

- `SurfaceBinding`

That binding is either:

- inline surface stack
- reference to `SurfaceDefinition`

This is the permanent authored boundary for:

- asset surface slots
- landscape surface slots

### Scatter rule

Scatter is not a parallel system. Stage 1 scatter is part of the layer stack:

- `grass`
- `flowers`

Landscape scatter and Surface Library preview scatter must consume the same
shared render-web scatter builder. Preview-specific geometry sampling is
editor-only, but the tuft / flower realization is shared.

## Consequences

Good:

- one slot can express painterly layered looks without custom shader graphs
- scatter has a canonical authored home instead of ad hoc side fields
- reusable `SurfaceDefinition`s can package the whole look, not just one
  material reference
- landscape and asset slots speak the same surface language

Tradeoffs:

- UI has to teach the difference between per-slot surface composition and
  whole-object deform/effect
- Stage 1 scatter is CPU-built and intentionally scoped to landscape + preview
  only

## Verification

- `Surface` remains a layer-stack interface with `layers` + `context`
- asset and landscape slot fields store `SurfaceBinding`, not raw `Surface`
- `tooling/check-surface-layerstack-boundary.mjs` fails CI if slot-shaped types
  drift back toward raw `Surface` ownership or if `Surface` loses its layer
  stack shape
