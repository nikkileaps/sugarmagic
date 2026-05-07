# Plan 045: VFX System Epic

**Status:** Proposed
**Date:** 2026-05-05

## Epic

### Title

A generic data-driven particle VFX system for Sugarmagic.
Project-defined `VFXDefinition`s authored as content-library
entries (parallel to `ShaderDefinition`), bound to items via
`presentation.vfxBindings` and placed in regions via
`region.vfx.spawns` (mirroring the existing `region.audio`
shape). Runtime renders all active emitters via a
single `THREE.InstancedMesh` per active VFX definition with a
TSL fragment material — one draw call per definition, scales
to thousands of particles per emitter without breaking a
sweat. Wordlarky's flame-on-resonance-points returns as the
first authored consumer; the engine ships generic infrastructure
plus a small built-in library (Default Flame, Default Sparkle).

### Goal

- **One new content-library kind** — `VFXDefinition` joins
  `ShaderDefinition`, `MaterialDefinition`, `TextureDefinition`,
  etc. on `ContentLibrarySnapshot.vfxDefinitions` (in
  `packages/domain/src/content-library/index.ts`). The library
  is the source of truth for content kinds; `GameProject`
  only holds `contentLibraryId` (a reference), not an
  embedded copy. Per the existing library-first-content-model
  pattern.
- **Sugarengine config parity** — every knob from
  `FlameEmitter` ports: emission rate, lifetime range, start
  / end color, start / end size, velocity / gravity, spread
  cone, blend mode (additive / normal), particle-shape
  selector (procedural circle / square), max particles,
  optional gravity vector. ~10 parameters, all on the
  authored `VFXDefinition`.
- **Built-in definitions ship in domain** —
  `createDefaultFlameVFX()` and `createDefaultSparkleVFX()`
  factories. Each produces a `VFXDefinition` with a
  `createUuid()`-generated `definitionId` (consistent with
  every other definition kind) PLUS a stable
  `metadata.builtInKey` (e.g. `"default-flame"`,
  `"default-sparkle"`) for lookup ergonomics. Bindings
  reference the UUID; tooling that needs to find "the
  built-in flame" looks it up by `metadata.builtInKey`.
  Mirrors how built-in shaders ship today, but with a cleaner
  identity model: UUIDs are opaque + portable, built-in
  status is metadata not identity. Project authors can
  duplicate-and-tweak any built-in to produce a new
  `VFXDefinition` (fresh UUID, no `builtInKey`).
- **Two binding modes for v1, both supported:**
  - **Per-item** via `ItemPresentationProfile.vfxBindings: VFXBinding[]`
    — emitter follows the placed item presence; positioned at
    item's transform with optional local offset.
  - **Per-region** via `RegionDocument.vfx?.spawns:
    VFXSpawn[]` (composed under `RegionVFXState`, mirroring
    the existing `region.audio` / `RegionAudioState` shape) —
    emitter at fixed world-space position, independent of any
    item (campfires, atmospheric torches, ambient effects).
- **Runtime renderer using `InstancedMesh` + TSL** — one
  `InstancedMesh` per active VFX definition. Per-particle
  data (position, age, velocity, color) lives in JS arrays;
  written into instance attributes each frame; TSL fragment
  shader reads age + color uniforms to produce the soft-circle
  gradient sugarengine had. One draw call per definition;
  realistic ceiling ~10,000 particles per scene before the JS
  update loop becomes a real frame-time concern.
- **Studio Library popover entry for VFX** — adds `"vfx"`
  to the `LibraryKind` union in `packages/shell/src/index.ts`
  and a `vfx` branch in `apps/studio/src/library/LibraryPopover.tsx`.
  Lists definitions; built-ins are read-only; project-
  authored have create / duplicate / delete affordances.
  Selecting a VFX opens an inline parameter-form editor for
  scalars / colors / vectors / blend mode. Live preview pane
  is **deferred to v2** — it doesn't fit the popover format
  cleanly, and shipping parameter editing first is enough to
  make the popover entry functional.
- **Studio Build > Layout integration** — when a placed item has
  `vfxBindings`, no extra placement work needed (the binding
  travels with the item). For region-level `vfx.spawns`, a new
  small section in the Layout inspector for adding / moving /
  removing region-scoped VFX spawn points (similar to the audio
  emitter placement pattern under Build > Audio).
- **Wordlarky integration** — bind the built-in flame
  definition (looked up by its `metadata.builtInKey =
  "default-flame"` and referenced by its UUID in the
  binding) to the existing Resonance Point item via
  `presentation.vfxBindings`. If the built-in's parameters
  don't match the desired sugarengine look, duplicate it in
  Studio to produce a new project-authored VFXDefinition
  (fresh UUID, no `builtInKey`) and bind that instead. Pure
  data add to `project.sgrmagic`; no JS code.

### Why this epic exists

Sugarmagic has no VFX system today (`runtime-core/src/vfx/index.ts`
is a 3-line stub interface). The flame visual on sugarengine's
resonance points is the immediate driver, but every game built
on Sugarmagic needs particles eventually — spell-cast feedback,
weather, ambient atmosphere, charm animations, environmental
effects. Building this once, generically, in the engine is the
right place to land that capability.

The architectural choice — `InstancedMesh` + TSL instead of
sugarengine's CPU `THREE.Sprite` pool or full GPU compute
particles — was made deliberately:
- CPU sprite pool is a 2010-era pattern; doesn't fit a 2026
  WebGPU / TSL engine. Would cap at ~500 particles total
  before becoming a constraint.
- GPU compute particles (sibling pipeline to scatter) scale
  to 100k+ but the bug surface is real (vendor-specific
  WebGPU bugs, hard-to-debug compute shaders, GPU lockup
  catastrophic failure mode). Overkill for the per-emitter
  particle counts realistic games actually use.
- `InstancedMesh` + TSL is the architecturally-consistent
  middle path: scales to thousands per emitter, one draw call,
  bug surface is JS-debuggable, integrates with the existing
  shader runtime.

The per-item AND per-region binding split mirrors how
sugarengine handled it (region-level VFX spawns for atmospheric
emitters) plus the nicer "drag an item, VFX comes with it"
authoring flow. Both have legitimate use cases; supporting
both in v1 is a one-time investment.

The Studio surface is the existing `LibraryPopover` with a new
`vfx` `LibraryKind`, mirroring exactly how shaders work today
— VFX definitions are project-scoped reusable assets with
built-in defaults and project-authored extensions, and the
popover is where every other library kind lives. The Audio
library pattern (separate kinds for clips vs. cues vs. emitter
placements) is more elaborate than VFX needs.

### Goal-line test

After this epic lands:

- Studio's `LibraryPopover` has a `vfx` mode (alongside
  `materials | textures | shaders | audio`); built-in flame
  and sparkle definitions appear there.
- A designer in Studio can duplicate the built-in flame, tweak
  color and emission rate via a parameter form, save, then bind
  the new definition to an item and see the change in Preview
  (live in-popover preview is deferred to v2; see Story 045.5).
- The wordlarky Resonance Point item has a `vfxBindings` entry
  pointing at a flame definition; authored entirely as data.
- In-game: the placed Resonance Point in the region has the
  flame visibly emitting from its position. Frame budget is
  comfortable (~0.5ms total for 200 particles on midrange
  hardware).
- A second hypothetical region defines a `vfx.spawns` entry at
  fixed coords pointing at the same flame definition (a
  standalone torch); flame appears in the world without any
  item placed.
- The engine has zero references to game-specific
  vocabulary ("wordlarky", "rackwick", "resonance",
  "resonance-point", etc.) outside of test fixtures and the
  wordlarky project file. Generic VFX-category names like
  "flame" and "sparkle" ARE allowed in the engine —
  they're built-in effect categories that any game might
  use, analogous to how built-in shaders are named
  "fog-tint", "bloom", "cloud-shadows".

## Scope

### In scope

**Owned by `packages/domain`:**

- Types: `VFXDefinition`, `VFXBinding` (per-item),
  `VFXSpawn`, `RegionVFXState` (composes spawns under
  `region.vfx`, mirroring `region.audio` /
  `RegionAudioState`)
  (per-region), `VFXBlendMode` (`"additive" | "normal"`),
  `VFXShape` (`"circle" | "square"`).
- `vfxDefinitions: VFXDefinition[]` field added to
  `ContentLibrarySnapshot` with normalizer integration.
- `vfxBindings: VFXBinding[]` field added to
  `ItemPresentationProfile` with normalizer (defaults `[]`).
- `vfx?: RegionVFXState` field added to `RegionDocument`
  with normalizer (defaults `{ spawns: [] }`), mirroring the
  existing `region.audio?: RegionAudioState`.
- `createDefaultFlameVFX(projectId)` and
  `createDefaultSparkleVFX(projectId)` factories shipping
  built-in definitions seeded on project init (mirrors how
  built-in shader factories work).
- JSON Schema artifact at
  `packages/domain/schemas/vfx-definition.schema.json` for
  external authoring tools / validators.

**Owned by `packages/runtime-core/src/vfx/`:** (replaces the
3-line stub)

- `VFXEmitter` — per-active-host particle pool with the
  sugarengine-parity simulation: emission rate, lifetime
  range, color/size interpolation over life, gravity, velocity
  + spread cone integration, max-particle cap.
- `VFXManager` — owns active emitters keyed by `(definitionId,
  hostId)`. Boots emitters when items / region-spawns become
  visible; tears them down when removed. Per-frame tick
  drives all active emitters.
- `VFXDispatcher` — wires the gameplay session: collects all
  bound items + region spawns at scene load and registers
  them with the manager. Hooks item-presence add / remove
  events to spin emitters up / down.

**Owned by `packages/render-web/src/vfx/`:**

- `InstancedParticleRenderer` — one `THREE.InstancedMesh`
  per active VFX definition. Allocates instance buffers
  sized to definition's `maxParticles`. Per-frame, reads the
  emitter's particle pool state and writes instance
  attributes (position, scale, color, opacity).
- TSL particle material — shipped per shape kind. Reads
  instance attributes, applies the procedural circular /
  square gradient with configured blend mode. Single material
  shared across all emitters of the same definition.
- Render-pipeline integration: particle meshes mount in the
  main scene as a sibling render group. Sort transparent
  back-to-front per the existing pipeline's transparent pass
  rules.

**Studio surface:**

- **Library popover extension** (existing
  `apps/studio/src/library/LibraryPopover.tsx` — NOT a new
  workspace):
  - Add `"vfx"` to the `LibraryKind` union in
    `packages/shell/src/index.ts:90` (currently
    `"materials" | "textures" | "shaders" | "audio"`).
  - Add a `vfx` branch to the `allItems` computation
    (around `LibraryPopover.tsx:128-142`) that surfaces
    VFXDefinitions from the content library snapshot.
  - Pass `vfxDefinitions` as a new prop on
    `LibraryPopoverProps`.
  - Built-in entries (those with `metadata.builtInKey`) are
    read-only; project-authored have create / duplicate /
    delete affordances using the existing popover patterns
    for materials and audio clips.
  - Selecting a VFX in the popover surfaces an inline
    parameter-form editor (scalar NumberInputs,
    ColorPickers for colors, Vector3Inputs for velocity /
    gravity, Selects for blendMode / shape). Form-based —
    not a graph editor; particles aren't graph-shaped.
  - **Live preview pane is deferred to v2.** Popover format
    doesn't accommodate a render surface cleanly. v1 ships
    parameter editing only; v2 adds either a popover-
    embedded canvas or a separate "open in editor" modal
    with the live emitter render.
  - **Preview render boundary (binding for v2).** When the
    preview lands, it MUST attach a `RenderView` to the same
    shared `WebRenderEngine` instance Studio already runs
    (`packages/render-web/src/view/RenderView.ts` +
    `engine/WebRenderEngine.ts`). Do NOT instantiate a
    second `WebRenderEngine`, do NOT create an editor-only
    fake renderer, and do NOT bypass the
    `check-render-engine-boundary.mjs` allowlist with a new
    construction site. Past viewport bugs trace back to
    parallel render hosts drifting out of sync; the single
    `WebRenderEngine` owner is non-negotiable. The preview
    is a new render *surface* (RenderView), not a new render
    *engine*.
- **Build > Layout** inspector extension: when a region is
  selected, an "Ambient VFX" section showing a sortable list
  of `region.vfx.spawns` (definition picker + position +
  remove button). Mirrors how `region.audio.emitters` are
  placed in the existing audio workspace, including reading
  the section as `region.vfx ?? createRegionVFXState()` to
  handle the optional field uniformly.
- **Item inspector extension** (Design > Items): a "VFX" panel
  showing the item's `vfxBindings` — definition picker
  (opens the LibraryPopover in vfx mode) + optional local
  offset + remove. Mirrors the existing pattern for binding
  shaders to assets.

**Wordlarky integration:**

- Flame VFX binding added to the Resonance Point item's
  `vfxBindings`, referencing the built-in flame's UUID
  (looked up via `metadata.builtInKey = "default-flame"`).
  If the built-in's defaults don't match the sugarengine
  look, duplicate it via Studio to produce a project-authored
  definition (fresh UUID, no `builtInKey`) and bind that
  instead.
- Pure data add to `project.sgrmagic`; no JS code.

**Tests:**
- Domain: round-trip + normalizer for VFXDefinition,
  VFXBinding, VFXSpawn, RegionVFXState (including the
  optional/absent `region.vfx` case normalizing to
  `{ spawns: [] }`).
- Runtime: emitter pool acquire/release without GC churn;
  emitter ticks produce expected particle counts per second;
  emitter shuts down cleanly when host removed.
- Render: InstancedMesh allocates instance buffers sized to
  maxParticles; per-frame attribute upload doesn't realloc.
- Studio: parameter form edits persist via the standard
  command pipeline and surface in Preview when the definition
  is bound to an item / region; deleting a bound definition
  flags the binding as broken (semantic validation, similar
  to the mechanics validator). (In-popover live preview is
  v2 — see Story 045.5.)

### Out of scope

- **Event-driven one-shot VFX** (spell-cast burst, item-pickup
  sparkle). v1 supports continuous emitters only — they spawn
  when the host (item presence or region spawn) is loaded and
  stop when removed. One-shot VFX triggered by mechanics emit
  events is an obvious follow-up; it'd reuse the
  `mechanics.emitHandler` plugin pattern from epic 044.
- **GPU-compute particle simulation.** Future option (Tier C
  from the design discussion); only worth doing if a use case
  needs >50k particles in a single effect. Defer.
- **Texture-mapped particles** (e.g., a real PNG sprite of a
  butterfly). v1 ships procedural circle and square shapes
  matching sugarengine's `getParticleShapeTexture()`. Adding a
  `textureAssetDefinitionId` field is an obvious follow-up
  field on `VFXDefinition` once the basic system works.
- **Mesh particles** (3D objects as particles instead of
  sprites). Niche, defer.
- **Particle-particle interaction** (collision, flocking,
  attractors). Niche, defer.
- **Animated parameter curves** (color over life as a multi-stop
  gradient instead of just start/end). Sugarengine had two
  stops; v1 matches that. Multi-stop gradients are a future
  ergonomic upgrade.
- **An interchange format with Unity / Unreal / Blender.**
  Verified there's no widely-adopted standard for real-time
  game VFX. Each engine rolls its own. Sugarmagic does the
  same. The TEXTURE part is already portable via the existing
  texture import; the BEHAVIOR part is engine-specific
  everywhere.
- **VFX as a target for `mechanics.emitHandler` plugins.**
  Could be added later — a generic "spawn one-shot VFX on
  this emit" plugin is plausible — but v1 sticks with
  continuous-emitter binding.

## Shape sketch

### Domain types

```ts
// packages/domain/src/content-library/vfx-definition.ts (new)

export type VFXBlendMode = "additive" | "normal";
export type VFXShape = "circle" | "square";

export interface VFXDefinition {
  definitionId: string;       // UUID via createUuid(); opaque + portable
  definitionKind: "vfx";
  displayName: string;
  description: string;
  metadata?: {
    // Stable lookup key for built-ins (e.g. "default-flame").
    // Absent on user-authored / duplicated definitions.
    builtInKey?: string;
  };
  // Emission
  emissionRatePerSecond: number;  // particles/sec while emitter active
  maxParticles: number;            // pool cap
  // Lifetime
  lifetimeMinSeconds: number;
  lifetimeMaxSeconds: number;
  // Color (interpolated linearly over particle life)
  colorStart: { r: number; g: number; b: number; a: number };
  colorEnd: { r: number; g: number; b: number; a: number };
  // Size (interpolated linearly over particle life)
  sizeStart: number;
  sizeEnd: number;
  // Motion
  initialVelocity: { x: number; y: number; z: number };
  velocityRandomness: number;      // 0..1, jitter applied per particle
  spreadConeDegrees: number;       // 0..360, how wide the cone spreads
  gravity: { x: number; y: number; z: number };
  // Visual
  blendMode: VFXBlendMode;
  shape: VFXShape;
}

// Per-item binding (item's presentation gains an array of these)
export interface VFXBinding {
  bindingId: string;
  vfxDefinitionId: string;
  localOffset: { x: number; y: number; z: number };  // relative to item transform
}

// Per-region spawn
export interface VFXSpawn {
  spawnId: string;
  vfxDefinitionId: string;
  position: { x: number; y: number; z: number };
}

// Region-scoped VFX state — mirrors RegionAudioState
// (region-authoring/index.ts:140) which composes its
// emitters / ambienceZones under `region.audio`. Composing
// VFX the same way keeps region authoring uniform across
// scene-aspect kinds and leaves room for future region-VFX
// state (zones, triggers) without further reshaping.
export interface RegionVFXState {
  spawns: VFXSpawn[];
}
```

### Wordlarky's flame binding (additive to existing data)

```json5
// In wordlarky's Resonance Point item definition:
{
  definitionId: "13949e06-3d66-4e9a-87a0-cae8b490ea92",
  displayName: "Resonance Point",
  presentation: {
    modelAssetDefinitionId: null,
    thumbnailAssetPath: null,
    vfxBindings: [
      {
        bindingId: "<uuid>",
        // UUID of the VFXDefinition in this project's library snapshot.
        // For the built-in flame, that's the UUID generated when
        // createDefaultFlameVFX() seeded the library at project init.
        // For a duplicate-and-tweaked custom flame, that's the UUID of
        // the user-authored definition.
        vfxDefinitionId: "<uuid>",
        localOffset: { x: 0, y: 0.2, z: 0 }   // slightly above origin
      }
    ]
  },
  interactionView: { /* unchanged */ }
}
```

### Runtime data flow

```
Project loads → VFX definitions registered with VFXManager
              → VFX bindings on items registered as pending hosts
              → VFX spawns on regions registered as pending hosts

Region activates → VFXManager spins up emitters for matching
                   bindings + spawns
                 → InstancedParticleRenderer allocates one
                   InstancedMesh per definition, sized to that
                   definition's maxParticles

Per-frame tick:
  VFXManager.update(deltaSeconds):
    for each active emitter:
      - spawn new particles at emissionRate
      - age existing particles
      - release expired particles back to pool
  InstancedParticleRenderer.sync():
    for each active emitter:
      - write particle positions / sizes / colors to instance buffers
      - mark instance attributes dirty

Item presence removed → VFXManager tears down emitter, releases
                        particles
Region deactivates → all region's emitters torn down
```

### Studio Library popover — VFX entry (v1)

The existing `LibraryPopover` (apps/studio/src/library/) gains
a `vfx` mode alongside the existing `materials | textures |
shaders | audio` modes. Same layout pattern as those existing
modes — list of items + selection-driven inline parameter
form. No three-pane workspace; no live preview in v1 (deferred
to v2 — popover format doesn't accommodate a render canvas
cleanly).

```
┌──────────────────────────────────────────┐
│ Library: VFX                       [×]   │
├──────────────────────────────────────────┤
│ ▸ Built-in (read-only)                   │
│   Default Flame                          │
│   Default Sparkle                        │
│                                          │
│ ▸ Project                                │
│   Custom Flame                           │
│                                          │
│ [+ New VFX]   [+ Duplicate selected]     │
├──────────────────────────────────────────┤
│ Editing: Custom Flame                    │
│                                          │
│ Display Name [Custom Flame]              │
│ Emission Rate [25 /sec]                  │
│ Max Particles [200]                      │
│ Lifetime  Min [0.5]  Max [1.5]           │
│ Color Start [#ff8800] End [#ff0000]      │
│ Size  Start [0.3] End [0.05]             │
│ Velocity (x,y,z) [0, 0.4, 0]             │
│ Spread Cone [25°]                        │
│ Gravity (x,y,z) [0, -0.1, 0]             │
│ Blend Mode [Additive]  Shape [Circle]    │
└──────────────────────────────────────────┘
```

## Stories

### 045.1 — Domain types + built-in factories + content library wiring

- Define `VFXDefinition`, `VFXBinding`, `VFXSpawn`,
  `RegionVFXState`, `VFXBlendMode`, `VFXShape` types.
- Add `vfxDefinitions: VFXDefinition[]` to
  `ContentLibrarySnapshot` with normalizer integration.
- Add `vfxBindings: VFXBinding[]` to
  `ItemPresentationProfile` with normalizer (defaults `[]`).
- Add `vfx?: RegionVFXState` to `RegionDocument` with
  normalizer (defaults to `{ spawns: [] }`). This mirrors
  the existing `region.audio?: RegionAudioState` field
  (`packages/domain/src/region-authoring/index.ts:239`) and
  the matching `createRegionAudioState()` factory at
  line 469. Add a parallel `createRegionVFXState()` factory
  used by region-init / normalization.
- Implement `createDefaultFlameVFX()` and
  `createDefaultSparkleVFX()` factories. Each returns a
  fully-shaped `VFXDefinition` with:
  - `definitionId: createUuid()` — opaque UUID, fresh per
    invocation
  - `metadata.builtInKey: "default-flame"` /
    `"default-sparkle"` — stable lookup key
- Seed both on project init via the existing built-in-
  definitions pipeline. Note: built-in shaders today use
  semantic project-prefixed ids
  (`${projectId}:shader:fog-tint`); VFX deliberately moves
  to UUID + `metadata.builtInKey` for the cleaner identity
  model. Do NOT replicate the shader pattern. Existing
  shader-id behavior stays as-is in this epic; the
  divergence is acknowledged.
- Lookup helper: `findBuiltInVFXDefinition(library,
  builtInKey)` — finds a built-in by its `metadata.builtInKey`
  in a library snapshot. Used by tooling that needs to refer
  to a built-in across different project libraries.
- Author the JSON Schema artifact at
  `packages/domain/schemas/vfx-definition.schema.json`.
- Round-trip + normalizer tests.

**Files touched:**
- `packages/domain/src/content-library/vfx-definition.ts` (new)
- `packages/domain/src/content-library/index.ts` (extend
  ContentLibrarySnapshot, integrate built-in seeding)
- `packages/domain/src/item-definition/index.ts` (vfxBindings
  field + normalizer)
- `packages/domain/src/region-authoring/index.ts` (add
  `RegionVFXState` interface + `vfx?: RegionVFXState` field
  on `RegionDocument` + `createRegionVFXState()` factory,
  mirroring the existing `RegionAudioState` pattern at
  lines 140 / 239 / 469)
- `packages/domain/schemas/vfx-definition.schema.json` (new)
- `packages/domain/src/index.ts` (re-exports)
- `packages/testing/src/vfx-domain.test.ts` (new)

### 045.2 — Runtime particle emitter + manager

- Replace the 3-line stub at
  `packages/runtime-core/src/vfx/index.ts` with the real
  module.
- `VFXEmitter` class — per-emitter particle pool with
  acquire/release pattern, lifetime tracking, color/size
  interpolation, gravity + velocity integration.
- `VFXManager` — owns active emitters keyed by host id;
  boot/teardown lifecycle; per-frame tick loop.
- Wire VFXManager into the gameplay session update path.
- Bind emitter lifecycle to scene item-presence:
  - **Preferred:** subscribe to existing item-presence
    add/remove events on the scene observation surface, if
    one exists. Verify during implementation —
    `packages/runtime-core/src/scene/` and
    `coordination/gameplay-session.ts` are the places to
    look; the audio binding wiring (Plan 041) is a useful
    precedent.
  - **Fallback if no observable seam exists:** add an
    explicit per-tick VFX sync step inside the existing
    gameplay-session update — diff the current set of
    item-presence ids against last tick's, spin up emitters
    for new ids, tear down for removed. Do **not** invent a
    second scene-truth store or parallel observation
    pipeline; one source of truth (the existing scene
    state) is the rule, with VFX reading from it.
  - Pick the path during 045.2 implementation based on what
    actually exists; record the choice in commit / PR
    notes.
- Tests: pool acquire/release count is conserved; emitter
  produces expected particles/sec at given emission rate;
  shutdown cleans up cleanly without leaking pool entries.

**Files touched:**
- `packages/runtime-core/src/vfx/index.ts` (replace stub)
- `packages/runtime-core/src/vfx/VFXEmitter.ts` (new)
- `packages/runtime-core/src/vfx/VFXManager.ts` (new)
- `packages/runtime-core/src/vfx/types.ts` (new — internal)
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (wire manager + tick)
- `packages/testing/src/vfx-runtime.test.ts` (new)

### 045.3 — Render-web instanced particle renderer + TSL material

- `InstancedParticleRenderer` — one `THREE.InstancedMesh` per
  active VFX definition; instance attributes for position,
  scale, color, opacity, age.
- TSL fragment material per shape kind (circle gradient, square
  gradient). Reads instance attributes; applies blend mode.
  One material shared across all emitters of the same
  definition.
- Mount into render pipeline as a transparent-pass sibling of
  existing scene objects. Sort back-to-front per pipeline rules.
- Subscribes to VFXManager state and writes instance buffers
  per frame.
- Per the existing render-engine boundary lint (`tooling/check-render-engine-boundary.mjs`),
  this is a NEW renderer construction site — extend the
  allowlist (after `RenderView.ts` and `captureFrame.ts`).
- Tests: instance buffer is sized to definition's maxParticles
  on emitter creation; per-frame upload doesn't realloc;
  tearing down an emitter releases the InstancedMesh from the
  scene without leaking GPU resources.

**Files touched:**
- `packages/render-web/src/vfx/InstancedParticleRenderer.ts` (new)
- `packages/render-web/src/vfx/particleMaterial.ts` (new — TSL)
- `packages/render-web/src/vfx/index.ts` (new — public API)
- `packages/render-web/src/index.ts` (re-export)
- `tooling/check-render-engine-boundary.mjs` (allowlist
  extension if needed; verify whether VFX renderer needs to
  construct its own InstancedMesh — probably yes, similar
  to scatter pipeline)
- `packages/testing/src/viewport-migration-parity.test.ts`
  (extend allowlist matching the lint script)
- `packages/testing/src/vfx-rendering.test.ts` (new)

### 045.4 — Item + region binding consumption

- `VFXManager` reads `gameProject.itemDefinitions[].presentation.vfxBindings`
  and `regionDocument.vfx?.spawns ?? []` at scene load.
- For each binding: when the corresponding item presence is
  added to the scene, spin up an emitter parented to the
  presence's transform with the binding's `localOffset`.
- For each region spawn: spin up an emitter at the spawn's
  fixed world position.
- When item presence is removed (picked up, region unloaded,
  etc.), tear down its emitters cleanly.
- Region transitions: tear down old region's spawn-based
  emitters; spin up new region's.
- Tests: bound emitter follows the item's transform when the
  item moves (e.g., placed asset transform updated mid-session);
  region spawn stays at fixed position; cleanup on region
  swap.

**Files touched:**
- `packages/runtime-core/src/vfx/VFXDispatcher.ts` (new — wires
  bindings/spawns to manager)
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (instantiate dispatcher)
- `packages/runtime-core/src/scene/index.ts` — touch only
  if 045.2 chose the event-subscription path AND the events
  don't already exist. If 045.2 chose the per-tick sync
  fallback, scene/ stays untouched and the diff lives in
  the dispatcher / gameplay-session.
- `packages/testing/src/vfx-binding.test.ts` (new)

### 045.5 — Studio Library popover — VFX entry

- Extend `LibraryKind` in `packages/shell/src/index.ts` from
  `"materials" | "textures" | "shaders" | "audio"` to include
  `"vfx"`. Add a corresponding entry to whatever opens the
  popover (toolbar / palette button) — model exactly on the
  existing shaders entry.
- Extend `apps/studio/src/library/LibraryPopover.tsx` to handle
  `activeLibrary === "vfx"`:
  - `allItems` branch reads `vfxDefinitions` from the project's
    `ContentLibrarySnapshot`
  - List item rendering: name + small built-in badge for
    definitions that have `metadata.builtInKey`
  - Selection drives an inline parameter form below/beside the
    list (same shape the popover uses for the other kinds);
    built-ins render as read-only, project-authored as editable
- Parameter form: form-based, one field per VFXDefinition
  parameter with appropriate widget (NumberInput for scalars,
  ColorPicker for colors, Vector3Input for velocity / gravity,
  Select for blendMode / shape).
- Affordances: `[+ New]` (create blank project-authored),
  `[+ Duplicate selected]` (clone selected, including built-ins,
  into a fresh-UUID project-authored definition), `[Delete]`
  (project-authored only).
- Save flow: emit `UpdateVFXDefinition` (and create / delete
  / duplicate variants) semantic commands; persist via the
  standard project-save pipeline.
- **Live preview deferred to v2.** The popover format doesn't
  accommodate a render canvas cleanly; v1 ships parameter
  authoring without preview. Authors validate by binding to
  an item and viewing in Preview / Game.
- **Preview render boundary (binding for v2).** When the
  preview is added, it MUST be a new `RenderView` attached
  to the existing shared `WebRenderEngine` Studio already
  runs (see `packages/render-web/src/view/RenderView.ts` and
  `engine/WebRenderEngine.ts`). Explicitly forbidden: a
  second `WebRenderEngine` instance for the editor, an
  editor-only fake/mock renderer, or a new WebGPURenderer
  construction site outside the existing
  `check-render-engine-boundary.mjs` allowlist. Past
  viewport bugs trace to parallel render hosts drifting; the
  single-engine + many-RenderView pattern is the rule.
- Inspector extension on **Item** workspace: a "VFX Bindings"
  panel showing bound definitions + a picker to add/remove,
  with a small offset editor.
- Inspector extension on **Layout** workspace (when a region
  is selected): an "Ambient VFX" section showing
  `region.vfx.spawns` + a picker to add/remove + position
  editor. Reads the field as
  `region.vfx ?? createRegionVFXState()` so the optional
  shape doesn't leak into the UI; commands write back into
  `region.vfx.spawns`.

**Files touched:**
- `packages/shell/src/index.ts` (add `"vfx"` to `LibraryKind`)
- `apps/studio/src/library/LibraryPopover.tsx` (add `vfx`
  branch in the `allItems` switch + inline parameter form for
  selected VFX definition; mirror existing shaders branch)
- `apps/studio/src/library/` (any new sub-component for the
  VFX parameter form, e.g. `VFXDefinitionForm.tsx`, sized to
  the popover panel — not a workspace)
- `packages/workspaces/src/design/ItemWorkspaceView.tsx`
  (extend inspector with VFX bindings panel)
- `packages/workspaces/src/build/layout/LayoutWorkspaceView.tsx`
  (extend inspector with region `vfx.spawns` section,
  mirroring the existing audio inspector that consumes
  `region.audio`)
- `apps/studio/src/App.tsx` (commands + projection wiring)
- `packages/domain/src/commands/index.ts` (new commands:
  CreateVFXDefinition, UpdateVFXDefinition, DeleteVFXDefinition,
  DuplicateVFXDefinition, AddItemVFXBinding,
  RemoveItemVFXBinding, AddRegionVFXSpawn, RemoveRegionVFXSpawn,
  MoveRegionVFXSpawn)
- `packages/domain/src/authoring-session/index.ts` (handlers)

### 045.6 — Wordlarky integration

- Add a flame `VFXBinding` to the wordlarky Resonance Point
  item's `presentation.vfxBindings`. Reference the built-in
  flame's UUID (look it up by `metadata.builtInKey =
  "default-flame"` in the project's library snapshot at
  bind time). If tuning differs from the built-in, duplicate
  it in Studio to produce a project-authored definition
  (fresh UUID, no `builtInKey`) and bind that instead.
- Verify in-game: placed Resonance Point shows visible flame
  emitting from its position; frame budget within reasonable
  bounds.
- End-to-end test: fixture project mirroring wordlarky's
  setup; assert emitter is registered + ticks + produces
  expected particle count for the flame definition's emission
  rate.

**Files touched:**
- `/Users/nikki/projects/wordlarky/project.sgrmagic` (data
  only)
- `packages/testing/src/vfx-end-to-end.test.ts` (new)

### 045.7 — Layered VFX stack (aura + streamers + sparkles + light)

This story generalizes `VFXDefinition` from "particle emitter
only" to "any additive visual layer", and ships a layered
effect stack — translucent **aura** sphere + animated
**streamers** + small **sparkle** particles + a soft warm
**point light** — that can be bound to an item OR placed at
a region position. The resonance-point look from the
magical-orb references is the target. The light layer makes
the orb contribute real scene illumination (especially at
night) instead of just rendering as additive transparency.

**Conceptual frame.** VFX is the additive composition layer
on top of the asset pipeline. An item / region position can
stack multiple VFXBindings (already an array today); each
binding picks one VFXDefinition; each definition declares
what *kind* of visual it is. The full look at a host = the
optional base asset + every bound VFX layer composed in
explicit render order. Layers are independent — a streamer
does NOT reference an aura's surface in v1 — but the data
shape leaves room for cross-layer coupling later (no field
that bakes in independence).

**Domain extensions:**

- Add a `kind` discriminator to `VFXDefinition`:
  ```ts
  type VFXDefinitionKind =
    | "particle-emitter"
    | "shader-billboard"
    | "ribbon-streamer"
    | "point-light";
  ```
  Existing flame / sparkle definitions become
  `kind: "particle-emitter"` (zero behavior change for
  current data; normalizer fills the field on read for
  pre-045.7 projects).
- Refactor `VFXDefinition` into a tagged union:
  ```ts
  interface VFXDefinitionBase {
    definitionId: string;
    displayName: string;
    metadata: VFXDefinitionMetadata;
  }
  interface ParticleEmitterDefinition extends VFXDefinitionBase {
    kind: "particle-emitter";
    emitter: ParticleEmitterParams;  // existing flame/sparkle fields
  }
  interface ShaderBillboardDefinition extends VFXDefinitionBase {
    kind: "shader-billboard";
    billboard: ShaderBillboardParams;
  }
  interface RibbonStreamerDefinition extends VFXDefinitionBase {
    kind: "ribbon-streamer";
    streamer: RibbonStreamerParams;
  }
  interface PointLightDefinition extends VFXDefinitionBase {
    kind: "point-light";
    light: PointLightParams;
  }
  type VFXDefinition =
    | ParticleEmitterDefinition
    | ShaderBillboardDefinition
    | RibbonStreamerDefinition
    | PointLightDefinition;
  ```
  Each kind owns a sub-record so kind-specific fields don't
  leak across the union.
- `ShaderBillboardParams`: `coreColor`, `haloColor`,
  `coreRadius`, `haloRadius`, `pulseRate`, `rotationRate`,
  `size`. Renders as a single camera-facing quad with a TSL
  fragment computing fresnel-style core + soft halo +
  optional rim ring.
- `RibbonStreamerParams`: `count` (number of streamers),
  `length`, `width`, `color`, `orbitSpeed`, `verticalDrift`,
  `easeShape` (`"linear" | "ease-out"`). Renders as N
  trail-style ribbon meshes orbiting / streaming away from
  the host position.
- `PointLightParams`: `color` (hex / RGB), `intensity`
  (scalar, in the same units the rest of the engine's lights
  use), `distance` (falloff radius; 0 = infinite per Three's
  convention), `decay` (default 2 for physically-correct
  inverse-square), `pulseRate?` (optional Hz; intensity
  oscillates ±10% if set), `pulseAmount?` (default 0.1).
  Renders as a `THREE.PointLight` parented to the host
  transform; contributes to scene illumination via Three's
  forward lighting (no transparent-pass entry, so
  `renderOrder` is inert for this kind — keep it on the
  binding for shape consistency, just unused).
- Add explicit render-order plumbing on the binding side
  (NOT on the definition):
  ```ts
  interface VFXBinding {
    bindingId: string;
    vfxDefinitionId: string;
    localOffset: { x: number; y: number; z: number };
    renderOrder: number;  // smaller = drawn first; default 0
  }
  interface VFXSpawn {
    spawnId: string;
    vfxDefinitionId: string;
    position: { x: number; y: number; z: number };
    renderOrder: number;
  }
  ```
  Render order applies *within* the transparent pass for
  layers attached to the same host. Default 0; ties broken
  by binding array index.

**Built-in additions:**

- `createDefaultAuraVFX()` — `kind: "shader-billboard"`,
  warm-cool palette, slow pulse, used as the resonance-point
  body.
- `createDefaultStreamersVFX()` — `kind: "ribbon-streamer"`,
  4 streamers, slow orbit, soft rim color.
- `createDefaultGlowLightVFX()` — `kind: "point-light"`,
  warm color (~3000K equivalent), moderate intensity,
  modest falloff radius, slow pulse. Tuned to "the orb is
  glowing" — visible at night, subtle in day.
- (Existing `createDefaultFlameVFX` and
  `createDefaultSparkleVFX` keep their current shape under
  `kind: "particle-emitter"`.)

**Renderer fan-out (`packages/render-web/src/vfx/`):**

- New `ShaderBillboardRenderer` — owns a single
  `BufferGeometry` (camera-facing quad) per active billboard
  binding; one instance of `MeshBasicNodeMaterial` per
  definition with TSL nodes for core/halo/pulse/rotation
  driven by `time()`. Adds to scene as a transparent-pass
  sibling. Same render-engine boundary lint allowlist
  treatment as the particle renderer (no new
  WebGPURenderer construction site — uses the shared
  `WebRenderEngine` like everything else).
- New `RibbonStreamerRenderer` — owns N strip-style
  geometries per active streamer binding; vertex positions
  computed from orbit angle + streamer index in TSL or CPU
  per frame (depending on count; start CPU for v1, defer
  GPU compute).
- New `LightVFXRenderer` — wraps `THREE.PointLight`. On
  bind: instantiate light, parent to host transform, push
  to `scene`. On unbind: remove + dispose. Per-frame: if
  `pulseRate` is set, modulate `intensity` via
  `baseIntensity * (1 + pulseAmount * sin(time * 2π *
  pulseRate))`. No transparent-pass participation; no
  WebGPURenderer construction site (Three's existing
  forward lighting handles it).
- `VFXManager` (runtime-core) gains a renderer-binding-kind
  switch so it dispatches each binding to the right
  renderer and respects `renderOrder` (where applicable —
  point lights ignore it). The dispatcher does NOT
  type-check definition kind — it routes by
  `definition.kind` at runtime so future kinds slot in
  without an exhaustive switch.
- `InstancedParticleRenderer` is unchanged behaviorally;
  just becomes one of four peer renderers under a shared
  `VFXRendererRegistry` (or equivalent dispatch helper).

**Studio surface:**

- `LibraryPopover` (`vfx` mode) parameter form switches
  based on selected definition's `kind`:
  - `particle-emitter` → existing form (rate, lifetime,
    color, etc.)
  - `shader-billboard` → core/halo color pickers, radius
    sliders, pulse rate
  - `ribbon-streamer` → count, length, width, orbit speed
  - `point-light` → color, intensity, distance, decay,
    optional pulse rate + amount
- New-VFX flow gets a kind picker first, then the
  appropriate parameter form.
- Item inspector "VFX Bindings" panel (Story 045.5) gains a
  small `Render Order` integer field per binding row
  (default 0, ± nudgers).
- Layout inspector "Ambient VFX" section gains the same
  `Render Order` field per spawn.

**Independence invariant (explicit non-goal):**

- v1 layers do NOT reference each other. A streamer cannot
  query "the bounds of the aura on this same host"; a
  particle cannot collide with a billboard. Each layer is
  positioned and animated only by its own params + the host
  transform.
- The data model leaves room for future coupling (e.g., a
  streamer kind could later add an
  `attachToBindingId?: string` field), but no v1 field
  bakes in the independence assumption — meaning we don't
  ship a "layers are flat / non-referencing" guarantee that
  would block adding such a field later. Loose coupling
  through layer composition is the only allowed coupling
  shape for v1; explicit cross-references are deferred.

**Resonance Point uses the new stack:**

- Wordlarky's Resonance Point item updates its
  `presentation.vfxBindings` from a single flame to a
  four-binding stack: aura (`renderOrder: 0`), streamers
  (`renderOrder: 1`), sparkles (`renderOrder: 2`), glow
  light (`renderOrder: 0` — inert for lights). The flame
  definition stays in the library; this story just changes
  which definitions the resonance point binds. Day-scene
  readability of the orb + visible light contribution at
  night are both validation criteria.

**Tests:**

- Domain: tagged-union round-trip + normalizer (each kind
  preserves its sub-record; normalizer fills `kind:
  "particle-emitter"` and `renderOrder: 0` on legacy data).
- Runtime: a single host with four bindings of distinct
  kinds (billboard + streamer + particle + light) spins up
  the right renderer for each; teardown releases all four
  cleanly; render order is honored across the transparent
  pass for the three drawing kinds; the point light is
  added to / removed from the scene's light set on
  bind / unbind without leaks.
- Studio: kind picker on new-VFX flow; per-kind parameter
  form switches when selection changes.
- End-to-end: resonance-point fixture renders all three
  layers at expected positions; no z-fighting or layer
  drop-out.

**Files touched:**
- `packages/domain/src/content-library/vfx-definition.ts`
  (refactor to tagged union, add `ShaderBillboardParams` +
  `RibbonStreamerParams` + `PointLightParams`, add `kind`
  discriminator + factory functions for new built-ins)
- `packages/domain/src/item-definition/index.ts` (add
  `renderOrder: number` to `VFXBinding`)
- `packages/domain/src/region-authoring/index.ts` (add
  `renderOrder: number` to `VFXSpawn`)
- `packages/domain/schemas/vfx-definition.schema.json` (
  union schema with discriminator)
- `packages/runtime-core/src/vfx/VFXManager.ts` (kind-based
  dispatch, render-order sort)
- `packages/runtime-core/src/vfx/types.ts` (snapshot types
  for the new kinds)
- `packages/render-web/src/vfx/ShaderBillboardRenderer.ts`
  (new)
- `packages/render-web/src/vfx/RibbonStreamerRenderer.ts`
  (new)
- `packages/render-web/src/vfx/LightVFXRenderer.ts` (new)
- `packages/render-web/src/vfx/VFXRendererRegistry.ts` (new
  — dispatch helper)
- `packages/render-web/src/vfx/index.ts` (re-export new
  renderers)
- `apps/studio/src/library/LibraryPopover.tsx` (kind-aware
  parameter form)
- `apps/studio/src/library/VFXDefinitionForm.tsx` (split
  into per-kind sub-forms or single form with conditional
  sections)
- `packages/workspaces/src/design/ItemWorkspaceView.tsx`
  (renderOrder field on binding rows)
- `packages/workspaces/src/build/layout/LayoutWorkspaceView.tsx`
  (renderOrder field on spawn rows)
- `packages/domain/src/commands/index.ts` (extend create /
  update commands with kind + per-kind params; new
  `SetVFXBindingRenderOrder`,
  `SetVFXSpawnRenderOrder` commands)
- `/Users/nikki/projects/wordlarky/project.sgrmagic` (
  resonance-point binds aura + streamers + sparkles +
  light; data only)
- `packages/testing/src/vfx-domain.test.ts` (extend with
  union round-trip + normalizer cases for all four kinds)
- `packages/testing/src/vfx-layered-stack.test.ts` (new —
  four-binding host)
- `packages/testing/src/vfx-end-to-end.test.ts` (extend
  with resonance-point layered render + light contribution
  assertion)

### 045.8 — Projector decal VFX kind

Add `decal` as a fifth `VFXDefinitionKind` for projecting
animated textures onto scene geometry — magic circles, glow
patches under the host, projected runes. Distinct enough
from the four kinds in 045.7 to deserve its own story
because it touches the scene-depth pipeline.

**Why projector and not geometry decals.** Three's built-in
`DecalGeometry` produces static geometry conformed to a
target mesh, which means re-projection on parameter change
and a target-mesh dependency. We instead use the
projector pattern: a screen-space quad with a TSL fragment
that samples scene depth, reconstructs world-space
position, and discards pixels outside an oriented decal
box. This lets decals project onto any geometry under them
(landscape + placed assets) without per-target geometry
generation, and animates cheaply via TSL. The scene-depth
infrastructure already exists in render-web — see the
existing usage of `RuntimeRenderPipeline.getSceneDepthNode`
in landscape / post-process code (per the project memory
note: TSL post-process depth must be wired explicitly via
`scenePass`, never `viewportLinearDepth`).

**Domain extensions:**

- Extend `VFXDefinitionKind` to add `"decal"`:
  ```ts
  type VFXDefinitionKind =
    | "particle-emitter"
    | "shader-billboard"
    | "ribbon-streamer"
    | "point-light"
    | "decal";
  ```
- New tagged-union arm:
  ```ts
  interface DecalDefinition extends VFXDefinitionBase {
    kind: "decal";
    decal: DecalParams;
  }
  ```
- `DecalParams`:
  - `size: { x: number; y: number }` — extent of the decal
    box on its projection plane
  - `depth: number` — extrusion of the decal box along its
    projection normal (how far above/below the plane the
    box catches geometry)
  - `projectionNormal: "down" | "up" | "host-forward"` —
    which way the decal projects (default `"down"` = magic
    circle on the ground)
  - `colorMap: AssetReference | null` — texture asset
    sampled for the projected color
  - `tint: ColorRGBA` — multiplied into the sampled color;
    alpha drives blend strength
  - `rotationRate?: number` — radians/sec; rotates the
    sampled UVs (slowly-spinning runes)
  - `pulseRate?: number` — Hz; oscillates alpha
  - `blendMode: "additive" | "normal"` — how the decal
    composites with what's underneath

**Built-in additions:**

- `createDefaultRuneCircleDecal()` — `kind: "decal"`,
  procedural rune-circle texture (or asset-bundled), slow
  rotation, soft pulse. Used as the resonance-point ground
  glyph.

**Renderer:**

- New `DecalVFXRenderer` (`packages/render-web/src/vfx/DecalVFXRenderer.ts`).
  Per active decal binding: a screen-space quad
  (`PlaneGeometry(2,2)` in NDC, depth-prepass-adjacent in
  the transparent pass — TBD during implementation whether
  it needs its own pass slot or fits in the existing
  transparent pass). TSL fragment:
  1. Reads scene depth at this fragment via
     `RuntimeRenderPipeline.getSceneDepthNode` (NOT
     `viewportLinearDepth` — per the memory note).
  2. Reconstructs world-space position from depth + screen
     UV + inverse-projection matrix.
  3. Transforms world position into decal-local space (
     subtract host translation, rotate by host orientation,
     scale by decal box extent).
  4. Discards fragments where any local-space coord is
     outside `[-0.5, 0.5]`.
  5. Samples `colorMap` using the local-space xy as UVs
     (with `rotationRate` applied to the UV space).
  6. Outputs `tint * sampled.rgb`, alpha modulated by
     `pulseRate` and box-edge softening.
- Same render-engine boundary lint treatment as the other
  renderers (no new WebGPURenderer; uses shared
  `WebRenderEngine`).
- Registers under `VFXRendererRegistry` as the
  `"decal"`-kind handler. Render order applies in the
  transparent pass.

**Studio surface:**

- `LibraryPopover` parameter form gains a `decal` arm:
  size sliders, depth, projection-normal select, color map
  asset picker, tint, optional rotation/pulse rates, blend
  mode.
- New-VFX kind picker offers "decal" as a fifth choice.

**Resonance Point gains a fifth binding:**

- Add a `default-rune-circle` decal binding to the
  resonance-point stack, projecting onto the ground under
  the orb (`renderOrder: -1` so it renders before the
  aura billboard so the billboard can layer over it).

**Tests:**

- Domain: round-trip + normalizer for the `decal` kind.
- Render: scene-depth sampling produces correct
  world-space reconstruction (regression test against a
  known camera + landscape configuration); fragments
  outside the decal box discard; UV rotation matches
  expected angle at given times.
- End-to-end: resonance-point fixture renders the decal
  on the landscape under the orb at the expected position;
  the decal moves with the host transform.

**Files touched:**
- `packages/domain/src/content-library/vfx-definition.ts`
  (add `DecalParams` + `DecalDefinition` arm + factory)
- `packages/domain/schemas/vfx-definition.schema.json`
  (extend union)
- `packages/runtime-core/src/vfx/types.ts` (snapshot
  shapes for decal)
- `packages/runtime-core/src/vfx/VFXManager.ts` (dispatch
  arm for decal)
- `packages/render-web/src/vfx/DecalVFXRenderer.ts` (new)
- `packages/render-web/src/vfx/VFXRendererRegistry.ts`
  (register decal handler)
- `packages/render-web/src/vfx/index.ts` (re-export)
- `apps/studio/src/library/LibraryPopover.tsx` (decal
  branch in kind switch)
- `apps/studio/src/library/VFXDefinitionForm.tsx` (decal
  parameter form)
- `packages/domain/src/commands/index.ts` (decal-kind
  fields in create/update commands)
- `/Users/nikki/projects/wordlarky/project.sgrmagic` (
  resonance-point gains rune-circle decal binding; data
  only)
- `packages/testing/src/vfx-domain.test.ts` (decal
  round-trip + normalizer)
- `packages/testing/src/vfx-decal-projection.test.ts`
  (new — depth-reconstruction correctness)
- `packages/testing/src/vfx-end-to-end.test.ts` (extend
  with decal validation)

## Success criteria

- All `pnpm typecheck`, `pnpm test`, `pnpm lint`,
  `node tooling/check-package-boundaries.mjs`,
  `node tooling/check-mechanics-boundary.mjs`, and
  `node tooling/check-render-engine-boundary.mjs` pass.
- Goal-line test passes end-to-end.
- The engine has zero references to game-specific
  vocabulary ("wordlarky", "rackwick", "resonance",
  "resonance-point", etc.) outside of test fixtures and the
  wordlarky project file (the same invariant from epics
  043 / 044). Generic VFX-category names like "flame" and
  "sparkle" ARE allowed in the engine — they're built-in
  effect categories analogous to existing built-in shader
  names ("fog-tint", "bloom", "cloud-shadows").
- Frame budget for typical resonance-point scenes (2-4
  emitters at ~100 particles each) is < 1ms per frame on
  midrange hardware.
- A second hypothetical project could use the same VFX system
  with totally different definitions (e.g., crystalline
  sparkles, dust motes, fireflies-as-decoration) by adding
  data only.

## Risks

1. **Item-presence transform updates mid-frame.** Bound
   emitters need to follow their host item's transform; if
   the item is moved (animated, picked up, etc.), the emitter
   must update its base position before the per-frame
   particle simulation runs. Story 045.4 needs to be careful
   about ordering: transform sync → emitter base position
   update → particle simulation → renderer attribute upload.
2. **InstancedMesh frustum culling.** Existing
   memory: skinned meshes have stale-bbox frustum culling
   issues; instanced meshes have similar stale-bbox issues
   if the instance positions span a wide range. Story 045.3
   may need to disable frustum culling on particle
   `InstancedMesh`es or compute a conservative bounding
   sphere. Verify before relying on default culling.
3. **TSL material caching across emitter lifecycles.** Per
   the existing memory note "Three TSL effect nodes with
   scalar JS-number args must be cached per binding" — the
   particle material must be constructed once per VFX
   definition and reused, not reconstructed per emitter
   instance. Cache materials keyed by definitionId.
4. **JS-side particle update cost ceiling.** B-tier
   architecture caps at ~10,000 particles total in scene
   before main-thread cost is meaningful. If a designer
   authors a definition with `maxParticles: 50000` and
   `emissionRate: 5000/sec`, frame drops will surface. Worth
   a soft warning in Studio (e.g., highlight maxParticles
   over 5000 as "may impact performance"), but not a hard
   limit since some games may legitimately want more.
5. **Live preview render boundary (v2).** When the preview
   lands, the implementation must attach a new `RenderView`
   to the existing shared `WebRenderEngine` — NOT spin up a
   second engine or an editor-only fake renderer. The
   single-engine + many-RenderView contract is what keeps
   editor and runtime visuals in sync; past viewport bugs
   came from violating it. Throttling rapid inspector edits
   to the preview surface is the only secondary concern.
6. **Built-in definition migration.** When the built-in
   flame definition's parameters change in a future engine
   version, projects referencing it by id will silently get
   the new values. Acceptable for cosmetic tuning; would
   matter if a project authored a binding that depended on
   specific old behavior. Mitigation: built-in definitions
   versioned by id (e.g., `built-in:flame:v1`), bumping the
   id on breaking changes. Defer until first migration is
   actually needed.

## Builds on

- **Existing content library pattern** — VFXDefinition is
  another library kind alongside ShaderDefinition,
  MaterialDefinition, etc.
- **Existing render-engine boundary script** — VFX renderer
  joins the allowlist (RenderView, captureFrame, now also
  InstancedParticleRenderer if needed).
- **Existing TSL shader runtime** — particle materials are TSL
  fragments using the same shader runtime infrastructure as
  surface shaders.
- **Item-presence + region scene state** — VFX manager binds
  emitter lifecycle to the existing scene state. Whether that
  binding goes through observable add/remove events or
  through a per-tick diff inside gameplay-session is decided
  during 045.2 implementation based on what seam already
  exists. The non-negotiable: VFX reads from the existing
  scene as the single source of truth — no parallel scene
  store.
- **Plan 044 (mechanics emitHandler)** — future event-driven
  VFX (one-shot bursts on cast success, etc.) can reuse the
  emit-handler plugin pattern; out of scope for this epic but
  the seam is already there.

## Notes for AI authors of VFXDefinitions

- Built-ins ship with sensible defaults — duplicate one and
  tweak rather than authoring from scratch.
- **`definitionId` is always a UUID, never a semantic string.**
  Bindings reference VFXDefinitions by their UUID. To find
  "the built-in flame" in arbitrary code, use
  `findBuiltInVFXDefinition(library, "default-flame")` — the
  `metadata.builtInKey` is the stable lookup key, NOT the id.
  When you duplicate a built-in to tweak it, the new
  definition gets a fresh UUID and no `builtInKey`.
- Particle counts have real performance impact: keep
  `maxParticles` under ~1000 per definition for normal use;
  exceed only if you genuinely need it.
- `colorStart.a` and `colorEnd.a` control opacity; particles
  fade-out cleanly by setting `colorEnd.a = 0`.
- For warm-glow effects (flame, candle, magical shimmer), use
  `blendMode: "additive"` — colors add to the background,
  producing the bright bloom look.
- For solid effects (smoke, debris), use `blendMode: "normal"`
  and rely on the alpha channel for transparency.
- To tune a definition in v1: bind it to a placeholder item
  in your project and view in Preview. (An in-popover live
  preview is planned for v2 — see Story 045.5.)
