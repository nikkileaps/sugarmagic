# ADR 013: Surface as Layer Stack

## Status

Accepted (extended 2026-04-26 with Stages 2 + 3 outcomes; Story 36.18
displacement and Story 36.19 perf benchmarks deferred to a future epic).

## Date

2026-04-22 (Stage 1) — extended 2026-04-26 (Stages 2 + 3 retrospective)

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

## Stage 2 — Authoring Power (added 2026-04-26)

Stage 2 extended the layer-stack to author-driven content shapes, with no
change to Stage 1's domain model:

- **Asset-slot scatter realization** — the same `buildSurfaceScatterLayer`
  builder runs for both landscape slots and asset (mesh) surface slots; mesh
  triangle sampling replaces landscape grid sampling but the downstream pipeline
  is unchanged.
- **Painted mask textures** — masks become first-class `MaskTextureDefinition`
  resources owned by the project's content library, paintable from the
  workspace; layer mask references resolve to texture sample at evaluate time.
- **Per-slot LayerOverride** — referenced `SurfaceDefinition` instances can be
  partially overridden per slot via narrow override types (opacity, mask,
  parameter values); identity / kind / reference IDs are NOT overridable, so
  references can never be forked into divergent identities.
- **Rocks scatter variant** — `RockTypeDefinition` joins grass / flowers under
  the unified scatter realization; dispatch on `scatterContent.kind` keeps the
  outer pipeline single-path.
- **Procedural-noise masks** — Perlin / Voronoi / vertex-color masks evaluate
  deterministically per (seed, sample), making art decisions reproducible.

## Stage 3 — Scale + Reactivity (added 2026-04-26)

- **GPU compute scatter + indirect draw (36.16)** — Scatter candidate build,
  per-frame frustum + distance cull, and instance compaction all run on the
  GPU compute path; the CPU role is dispatching ~5 compute kernels per scatter
  layer per frame and the indirect-draw arg buffer drives the actual draw
  count. Per-layer cap of 65,536 candidates (single-level partials scan); above
  the cap, the existing CPU scatter path takes over with a console warning.
- **Compaction is deterministic (Option B)** — `markVisible` writes per-
  candidate flags into `frameActive[]`; a two-level prefix-sum scan
  (workgroup-shared inclusive scan + cross-workgroup partials scan) computes
  per-thread output indices; `scatterCompact` writes `visibleMatrices/Colors/
  Origins[workgroupOffsets[wgid] + localOffsets[tid]]`. Output order is in
  candidate-sampleIndex order — stable across frames. This is load-bearing
  for BLEND-mode foliage (e.g. Grass Surface 6); see Retrospective below.
- **Scatter LOD (36.17)** — three per-bin InstancedMeshes per scatter layer
  (`near`, `far`, `billboard`), each with its own `frameActive` flag array,
  scan/compact path, and indirect draw. The shared compute pipeline's
  `markVisible` per bin assigns each candidate to one bin based on distance.
  `LodMeshSpec` is a discriminated union: `procedural-default` |
  `procedural-reduced` (a fundamentally cheaper STAND-IN geometry — cross-quad
  for grass, single quad for flowers — NOT a "fewer blades" reduction) |
  `billboard` (camera-facing impostor) | `asset-reference`. Default keep
  ratios per bin are 1.0; the perf gain comes from geometric reduction at
  distance, not from dropping instances.
- **Story 36.18 (player/NPC displacement)** and **36.19 (perf benchmarks)
  are deferred** to a future epic. Current scenes render at 60 FPS without
  either; revisit when (a) gameplay actually moves entities through grass,
  or (b) station-scale scenes show measurable perf drops.

## Retrospective — what we learned (2026-04-26)

These are non-obvious lessons from Stage 3 implementation that future work
on the same surface area should not have to re-derive:

1. **GPU stream compaction with `atomicAdd` is non-deterministic across
   frames.** First-cut 36.16 used `atomicAdd(visibleCount, 1)` to assign each
   visible candidate to an output slot — but the order parallel workgroups
   complete the atomic op is implementation-defined, so visible[k] mapped to
   a different candidate sampleIndex each frame. For BLEND-mode foliage (Grass
   Surface 6: `transparent=true`, `depthWrite=false`), alpha blending
   accumulates in instance order — non-deterministic order produced visible
   TV-static flicker. The fix is the deterministic prefix-sum compaction
   above. **Anyone touching the compaction pipeline must preserve
   sampleIndex ordering**, or this bug returns silently for transparent
   surfaces.

2. **Three.js `pass(scene, camera)` inherits MSAA from `renderer.samples`,
   which `WebGPURenderer({ antialias: true })` defaults to 4.** The 36.16b
   foliage shimmer story originally prescribed "enable MSAA + alphaToCoverage
   to fix grass tip flicker." Implementing it changed nothing — because MSAA
   was already on, hidden by Three's default-inheritance chain. The
   actually-load-bearing fix is `pass(scene, options.camera, { samples: 0 })`
   — **explicitly disable** MSAA on the scene pass. With MSAA on, partially
   covered grass blade pixels averaged samples-on-blade with samples-on-
   background-through-inter-blade-gaps; wind motion shifted blades sub-pixel
   each frame, the proportion of "blade vs gap" samples changed per frame,
   bloom amplified the brightness variation into camera-flash halos. Trade-
   off: scene edges are technically aliased without MSAA; in the current
   stylized look they read acceptably. Upgrade paths if aliasing becomes
   visible: FXAA/SMAA post-process AA, TAA with custom per-vertex velocity
   pass (Three.js's TRAANode + VelocityNode does NOT capture wind-driven
   vertex motion → would ghost), or render foliage to a buffer that bypasses
   bloom. **Meta-lesson: trace library defaults from source, never assume
   "we didn't pass X so X is off."**

3. **Scatter LOD's perf lever is geometric reduction, not instance
   reduction.** First-cut 36.17 implemented `procedural-reduced` as "halve
   the blade count per tuft" (vertexBudget × authoredBladesPerTuft), which
   produces ~2× per-instance triangle reduction at most while halving
   visible coverage — the wrong trade. Defaults were then walked back (lod1
   pushed out, keep ratios bumped to 0.9/0.75) to compensate for visual
   sparsity, which gave back the perf win. The correct semantic is:
   `procedural-reduced` produces a fundamentally cheaper SHAPE (cross-quad
   for grass, single quad for flowers) at coverage parity — order-of-
   magnitude per-instance triangle reduction with no instance count change.
   **Reducing instance count without changing per-instance geometry trades
   visible coverage for negligible perf.**

4. **`RenderView.setCamera` must guard on identity, not call-count.** Runtime
   hosts call `renderView.setCamera(camera)` every frame because the camera's
   transform updates per frame — but the camera object reference is the same.
   The original implementation unconditionally bumped `appliedEnvironmentVersion`
   on every call, forcing `applyPostProcessStack` + `markSceneMaterialsDirty` to
   re-run every frame: ~19ms CPU per frame even on an empty scene, capping FPS
   at ~51. The fix is a one-line identity guard (skip the version bump when
   `camera === activeCamera`). **General principle: any "did this thing
   change?" check on a frequently-called setter should test identity, not call
   frequency.**

5. **`workgroupArray` + `workgroupBarrier` are first-class TSL primitives in
   v0.183.2.** Before committing to the prefix-sum compaction work, a spike
   validated that `workgroupArray("uint", 256).element(lid).assign(value)` and
   `workgroupBarrier()` work correctly under real WebGPU semantics, including
   the read-then-barrier-then-write pattern needed for Hillis-Steele inclusive
   scan. They do, with no version upgrade needed. Subgroup ops (`subgroupExclusiveAdd`)
   are also exported but require Chrome 134+ — fine as a future optimization,
   not relied on as a primary path.

## Status of remaining work

- **Story 36.18 (player/NPC displacement)** — deferred. Architecture is
  spec'd in `docs/plans/036-surface-as-layer-stack-epic.md`; implementation
  pending real gameplay need.
- **Story 36.19 (perf validation + benchmark suite)** — deferred. Current
  scenes hit 60fps; benchmark infrastructure deferred until station-scale
  scenes exist that need measurable perf budgeting.
- **Per-layer compaction cap (65,536 candidates)** — documented limit;
  CPU fallback handles oversize layers. Lift requires recursive partials
  scan or subgroup-native implementation.
