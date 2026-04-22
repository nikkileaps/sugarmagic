# ADR 012: Surface / Deform / Effect Traits

## Status

Accepted

## Date

2026-04-22

## Context

Before Epic 034, authored render behavior was split across multiple overlapping
shapes:

- per-slot asset material bindings
- landscape channels
- whole-mesh shader fields
- ad hoc material references on specific definitions

That overlap made it hard to answer basic architectural questions:

- what is the canonical authored shape for "what fills this render slot"?
- where is target-kind compatibility enforced?
- how do future renderable definitions opt into the same model without
  inventing their own binding fields?

It also created pressure to model "layers" as an authored concept when the
runtime reality is simpler:

- one surface graph per slot
- optionally one whole-object deform graph
- optionally one whole-object effect graph

Sugarmagic needs one authored trait model that works for assets, landscapes,
and future renderable definitions without duplicating render semantics.

## Decision

Sugarmagic uses three authored render traits:

- `Surfaceable`
- `Deformable`
- `Effectable`

Those traits live in
[/Users/nikki/projects/sugarmagic/packages/domain/src/surface/index.ts](/Users/nikki/projects/sugarmagic/packages/domain/src/surface/index.ts)
and are the canonical domain source of truth for authored render slot content.

### Canonical authored slot shape

All authored slot content flows through one domain union:

- `Surface`

`Surface` is the only authored shape that can fill:

- a per-slot surface entry
- a whole-object deform slot
- a whole-object effect slot

Material references are therefore only legal as:

- `{ kind: "material", materialDefinitionId }`

inside the `Surface` union.

Asset and landscape slot records must not grow their own direct
`materialDefinitionId` field. That would recreate the pre-Epic-034 split where
some authored paths spoke `Surface` and others spoke a parallel
material-binding shape.

### Trait semantics

- `Surfaceable.surfaceSlots` expresses one surface per authored mesh/channel
  slot.
- `Deformable.deform` expresses one whole-object vertex deformation.
- `Effectable.effect` expresses one whole-object fragment effect that runs
  after the resolved surface output.

There is no authored "layers" concept in this model.

If users want "surface plus something on top", that is modeled as:

- one `surface`
- plus one `effect`

not as multiple stacked surface graphs for the same slot.

### Ownership boundaries

- `domain` owns the trait types and the `Surface` union.
- `runtime-core` owns semantic resolution from authored `Surface` to effective
  shader bindings, including target-kind compatibility.
- `render-web` owns TSL / Three / WebGPU realization of those already-resolved
  bindings.

`render-web` does not become a second semantic resolver for authored trait
meaning.

### Compatibility rule

Each slot accepts exactly one compatible graph family:

- surface slots accept `mesh-surface`
- deform slots accept `mesh-deform`
- effect slots accept `mesh-effect`

That compatibility is enforced by the single semantic resolver in
`runtime-core`, not by UI-only filtering and not by `render-web`.

## Consequences

Good:

- one source of truth for authored render slot content
- future renderable definitions can opt into any subset of the three traits
  without inventing new binding shapes
- assets and landscapes share the same authored surface language
- "surface + effect" composition is explicit without normalizing a layered
  surface stack concept

Tradeoffs:

- some legacy direct material-binding paths must be deleted rather than carried
  forward
- UI must present slot-type-specific pickers clearly so the single `Surface`
  union does not become conceptually muddy

## Verification

- authored asset/landscape slots store `Surface | null`, not raw
  `materialDefinitionId` fields
- `tooling/check-surface-trait-boundary.mjs` fails CI if slot-shaped authored
  objects or types bypass the `Surface` union by introducing a direct
  `materialDefinitionId`
- `runtime-core` remains the semantic resolver for authored trait content
- `render-web` consumes resolved bindings rather than inventing authored trait
  semantics locally
