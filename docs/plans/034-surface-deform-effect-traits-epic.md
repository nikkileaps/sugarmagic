# Plan 034: Surfaceable / Deformable / Effectable Traits Epic

**Status:** Implemented
**Date:** 2026-04-21

> **2026-04-21 revision** (before any implementation): earlier drafts
> unified per-slot content, whole-mesh vertex deformation, and
> whole-mesh fragment modulation under one "layer stack" model, then
> a follow-up draft folded them into a single umbrella trait. Both
> conflated three different pipeline stages under one name. This
> revision models each stage as its **own trait** a Definition can
> opt into: `Surfaceable` (has surface slots), `Deformable` (has a
> deform slot), `Effectable` (has an effect slot). `AssetDefinition`
> implements all three. `RegionLandscapeState` implements all three.
> Future definitions opt in à la carte. Each trait carries one
> concept that lines up 1:1 with a GPU pipeline stage. Function
> signatures only ask for the trait they actually use. No domain
> "layers" concept anywhere.

## Epic

### Title

Turn the ad-hoc collection of per-slot materials, asset-level SURFACE
and DEFORM shaders, and landscape channel materials into three
principled traits: **Surfaceable**, **Deformable**, **Effectable**.
Each trait declares one shader slot kind on a Definition; each slot
holds one shader graph; a graph's **Output node** determines which
trait's slot it can fill. The runtime runs deform in vertex, surface
in fragment per slot, and effect in fragment after surface — three
pipeline stages, three traits, three authoring concepts.

### Goal

Four product outcomes, in priority order:

1. **One designer concept per pipeline stage.** A designer who wants
   "bark on the trunk, leaves on the foliage, wind on the whole tree,
   cloud shadows on the whole tree" picks a Surface for each mesh
   slot, picks a Deform for the asset, picks an Effect for the asset.
   Three interactions, three different places, each mapping one-to-one
   to where the work runs in the GPU pipeline.
2. **Multi-slot Surfaces on one mesh.** Assets with N material slots
   (trunk + foliage, body + helmet + cape) bind a Surface per slot.
   No more "one Material for the whole mesh" limitation. Directly
   supports the tree example we have today and every future
   multi-part asset.
3. **Compositional traits across Definition types.** Assets,
   landscape state, and future Definitions opt into whichever traits
   apply to them. A billboard card Definition might be Surfaceable
   only. A particle system might be Deformable + Effectable without a
   classic Surface. A decal volume might be Effectable alone. No
   forced `deform: null` + `effect: null` fields on Definitions that
   have no meaningful deform or effect concept.
4. **No layers concept in the domain.** If a future feature wants
   DCC-style "moss-over-bark" compositing within a single Surface,
   it's a UI affordance that generates a compound shader graph — not
   a cross-cutting domain abstraction. Domain stays lean.

Two architectural outcomes:

- **Graph output-node kind is the single source of truth for trait
  compatibility.** A graph with `output.surface` fills a
  `Surfaceable`'s slot. `output.deform` fills a `Deformable`'s.
  `output.effect` fills an `Effectable`'s. Slot validation reduces
  to "does this graph's output node match this slot's trait?"
- **One runtime composition point per pipeline stage, not one
  layer-stack folder.** The mesh-apply path wires the surface's
  fragment outputs into `MeshStandardNodeMaterial`, wires the deform
  graph's vertex outputs into the material's `vertexNode`, and, if
  present, wires the effect graph to intercept the surface's fragment
  outputs. Three well-defined hand-offs, not a generic fold over N
  layers.

### Why this epic exists

Plan 032 landed `MaterialDefinition` as "shader graph + parameter
snapshot" and bound it per asset slot. Story 32.12 collapsed landscape
channels onto the same shader-graph rendering math. Both were real
progress. But several concepts didn't fit into the Material frame and
remain scattered:

- **Asset-level SURFACE shader.** A legacy asset-level dropdown that
  applies to every slot with no Material bound. Precedence ("Material
  wins when bound, SURFACE is fallback") is documented in the epic
  but invisible to authors in the UI.
- **Asset-level DEFORM shader.** The wind-sway graph on foliage. Runs
  in vertex. Currently special-cased by the foliage-embedded-material
  importer. Applies to the whole mesh regardless of which per-slot
  Material is bound.
- **Landscape channel Material.** Works, but "channel" is a
  landscape-local concept with its own splatmap blending that doesn't
  generalize.
- **SurfacePicker UI** (shipped on the materials branch as part of
  Plan 032). Designer picks Color | Material for a landscape channel.
  Exactly the shape this epic formalizes as first-class — but
  currently only landscape uses it and the domain still calls channel
  content a "material binding."
- **FoilageMaker / PBR import.** Produces MaterialDefinitions bound
  to `standard-pbr` or `foliage-surface-3`. No place to also attach
  a wind-sway or seasonal tint except by forking the graph.

Each of those works. Together they form a maze. An author who wants
"the foliage uses a PBR material, the whole tree sways in wind, and
the whole tree gets cloud shadows passing over it" currently has no
way through the UI — the wind path is foliage-special-cased, the
cloud shadow has no home at all, and the Material binding can only
represent one of the three.

The Blender solution is clean and well-understood: a Material's
Output node has three input sockets (Surface, Volume, Displacement),
each accepting a graph. Shader nodes flow into whichever socket.
"Material" vs "color" vs "texture" is just what kind of graph you
built. There are no "layers." Composition inside a single surface is
done with graph nodes (Mix Shader, Layer Weight, etc.), not with a
separate layer-stack abstraction.

We adopt that shape, split across three traits so a Definition only
declares the pipeline stages it cares about.

### Core model

Three orthogonal traits in the domain. A Definition implements
whichever traits apply to it by exposing the corresponding field.

| Trait | Field | Count | Pipeline stage | Output node |
|---|---|---|---|---|
| `Surfaceable` | `surfaceSlots` | N (one per mesh material slot) | Fragment, per slot | `output.surface` |
| `Deformable` | `deform` | 0 or 1 | Vertex, whole-mesh | `output.deform` |
| `Effectable` | `effect` | 0 or 1 | Fragment, whole-mesh, after surface | `output.effect` |

Each slot either is empty (`null`) or holds one **`Surface`** — a
discriminated union representing what the designer picked. The UI
entry points (Color / Texture / Material / Shader) map 1:1 to union
variants; they are *what the author picked*, not distinct domain
types.

The graph's Output node is the authority on trait compatibility:

- `output.surface` → graph can fill a `Surfaceable`'s slot. Has
  color, normal, roughness, metalness, ao, emissive, alpha outputs.
- `output.deform` → graph can fill a `Deformable`'s slot. Has vertex
  position and vertex normal outputs.
- `output.effect` → graph can fill an `Effectable`'s slot. Reads
  `input.accumulator.*` (the post-surface values at this pixel) and
  writes modified outputs to `output.effect.*`.

Runtime validation: attempting to assign a Surface whose resolved
graph's output node doesn't match the slot's trait fails with a
diagnostic at compile time and shows in the UI as "incompatible
shader for this slot."

Concrete Definition compositions today:

- `AssetDefinition` — `Surfaceable` + `Deformable` + `Effectable`.
  Mesh geometry with per-slot surfaces, optional whole-mesh deform
  (wind sway on foliage), optional whole-mesh effect (cloud shadow).
- `RegionLandscapeState` — `Surfaceable` + `Deformable` +
  `Effectable`. Per-channel surfaces (with splatmap compositing as a
  runtime-internal detail), optional whole-landscape deform (grass
  sway), optional whole-landscape effect (seasonal tint).

Future Definitions pick their traits à la carte — a billboard
Definition might be `Surfaceable` only; a particle Definition might
be `Deformable + Effectable` without a classic surface; a decal
Definition might be `Effectable` alone. Each gets only the fields
and pipeline integration it actually needs.

## Scope

### In scope

- **`Surface` discriminated union** as slot content (used by all three
  traits' slots; only the UI shortcuts differ between trait pickers):
  ```ts
  type Surface =
    | { kind: "color"; color: number /* rgb hex */ }
    | {
        kind: "texture";
        textureDefinitionId: string;
        tiling: [number, number];
      }
    | { kind: "material"; materialDefinitionId: string }
    | {
        kind: "shader";
        shaderDefinitionId: string;
        parameterValues: Record<string, unknown>;
        textureBindings: Record<string, string>;
      };
  ```
  The `color` and `texture` variants are inline authoring shortcuts;
  the runtime materializes them into synthesized shader-graph
  evaluations using two new built-in primitives
  (`built-in:flat-color` and `built-in:flat-texture`). The `material`
  variant references a library `MaterialDefinition`. The `shader`
  variant inlines a graph instance with its own parameters.

- **Three domain traits** in `packages/domain/src/surface/index.ts`:
  ```ts
  export interface Surfaceable {
    readonly surfaceSlots: readonly SurfaceSlot[];
  }
  export interface Deformable {
    readonly deform: Surface | null;
  }
  export interface Effectable {
    readonly effect: Surface | null;
  }
  ```
  Structural interfaces. A Definition implements a trait by having the
  field. No explicit `implements` keyword needed in TypeScript;
  structural subtyping suffices for function signatures.

- **`SurfaceSlot` base shape + per-host refinements** for cases where
  the slot carries host-specific metadata:
  ```ts
  export interface SurfaceSlot {
    readonly slotName: string;
    readonly surface: Surface | null;
  }
  export interface AssetSurfaceSlot extends SurfaceSlot {
    readonly slotIndex: number;   // GLB material slot index
  }
  export interface LandscapeSurfaceSlot extends SurfaceSlot {
    readonly tilingScale: [number, number] | null;
    // splatmap channel index = array position
  }
  ```
  Both refinements satisfy `readonly SurfaceSlot[]` via TS structural
  subtyping. `Surfaceable`-taking functions that only need
  `slotName` + `surface` work uniformly; code that needs extras
  narrows to the concrete refinement.

- **Three output-node kinds in the shader-graph domain**, with
  matching `ShaderDefinition.targetKind` enum values:
  `"mesh-surface"`, `"mesh-deform"`, `"mesh-effect"`. The existing
  `targetKind` field already exists — this epic formalizes its
  values and wires them through trait-compatibility validation.

- **AssetDefinition implements all three traits**:
  ```ts
  interface AssetDefinition extends Surfaceable, Deformable, Effectable {
    // …existing fields…
    surfaceSlots: AssetSurfaceSlot[];      // one per mesh material slot
    deform: ShaderOrMaterial | null;       // whole-mesh vertex
    effect: ShaderOrMaterial | null;       // whole-mesh fragment modulation
  }
  ```
  `defaultShaderBindings.{surface, deform}` is removed — its
  capabilities are expressible via `surfaceSlots` (the surface
  fallback) and `deform` (the deform shader). The narrowed
  `ShaderOrMaterial` type on `deform` / `effect` makes it
  structurally impossible to save an `AssetDefinition` whose deform
  field is `{ kind: "color" }` — the domain shape rejects it.

- **RegionLandscapeState implements all three traits**:
  ```ts
  interface RegionLandscapeState extends Surfaceable, Deformable, Effectable {
    // …existing fields…
    surfaceSlots: LandscapeSurfaceSlot[];  // renamed from channels[]
    deform: ShaderOrMaterial | null;       // optional whole-landscape deform
    effect: ShaderOrMaterial | null;       // optional whole-landscape effect
  }
  ```
  The old `channels` array becomes `surfaceSlots` — the slots carry
  the same `channelId`/`tilingScale` metadata as before, just under
  the uniform trait-field name.

- **Surface resolver in `runtime-core`**:
  `resolveSurface(surface, contentLibrary) → EffectiveShaderBinding`.
  Lives in `packages/runtime-core/src/shader/bindings.ts` alongside
  the existing `resolveMaterialEffectiveShaderBinding` — per that
  module's header, runtime-core is the single enforcer for slot
  policy (defaults, overrides, target-kind validation), and Surface
  resolution is exactly that kind of semantic work. render-web then
  consumes the already-resolved `EffectiveShaderBinding` via its
  existing `ShaderRuntime.evaluateMeshSurfaceBinding` helper (and
  the two new siblings introduced by Story 34.2). The package
  boundary stays clean: runtime-core decides what the authored
  intent *means*; render-web realizes the resolved meaning into TSL
  nodes.

- **Runtime wiring** in the mesh-apply path (function signatures ask
  only for the traits they use):

  ```ts
  // Only needs surface slots
  function applyMeshSurfaces(host: Surfaceable, …);

  // Only needs the deform slot
  function applyMeshDeform(host: Deformable, material: MeshStandardNodeMaterial, …);

  // Only needs the effect slot + the surface's output node set
  function applyMeshEffect(host: Effectable,
                           surfaceNodeSet: ShaderSurfaceNodeSet,
                           material: MeshStandardNodeMaterial, …);
  ```
  Per slot: resolve via the resolver, evaluate via the existing
  `evaluateMeshSurfaceBinding`, assign to the material slot. If the
  host is Deformable with a non-null deform, wire deform vertex
  outputs to `material.vertexNode`. If the host is Effectable with a
  non-null effect, interpose its fragment outputs between the
  surface outputs and the material's color/roughness/etc.
  assignments (effect reads the surface's outputs as
  `input.accumulator.*`, writes modified values).

- **Landscape apply path**: same per-slot Surface resolution.
  Splatmap compositing of the N per-slot surface results stays
  exactly as it is today in `rebuildMaterialNodes` — this epic does
  not change landscape blending math, just renames `channel.materialDefinitionId`
  into `surfaceSlots[i].surface`. Optional landscape-level deform
  and effect wire through the same `vertexNode` / accumulator
  interposition as assets.

- **No migration of old projects.** Authoring has not shipped to
  users; there are no existing projects whose saved files need
  carrying forward. The old shapes
  (`MaterialSlotBinding.materialDefinitionId`,
  `RegionLandscapeState.channels[]`,
  `AssetDefinition.defaultShaderBindings.{surface,deform}`) get
  replaced in-place by the new trait shape — no normalizer, no
  "legacy field read as input" fallback. Any project the team is
  currently working on is regenerated from scratch once the new
  shapes land.

- **UI**:
  - Asset inspector: one `SurfacePicker` per mesh material slot
    (existing component — reuse). Plus two new inspector sections:
    "Deform" (single Surface picker constrained to deform Materials)
    and "Effect" (single Surface picker constrained to effect
    Materials). The legacy SURFACE + DEFORM dropdowns are removed.
  - Landscape workspace: existing per-channel SurfacePicker stays —
    now reads from `surfaceSlots[i]` instead of `channels[i]`. Add
    two new optional slot pickers at the landscape level for Deform
    and Effect.
  - `SurfacePicker` component takes an optional `acceptedTargetKind`
    prop (`"mesh-surface"` / `"mesh-deform"` / `"mesh-effect"`). The
    Material tab filters by resolving each candidate Material's
    `shaderDefinitionId` to its `ShaderDefinition` and comparing
    `shaderDefinition.targetKind` against `acceptedTargetKind` —
    `targetKind` lives on the graph, not on `MaterialDefinition`
    itself. Color / Texture tabs are hidden when
    `acceptedTargetKind !== "mesh-surface"` (those shortcuts only
    make sense for surfaces).

- **Built-in primitive graphs** registered with the shader library:
  - `built-in:flat-color` (`targetKind: "mesh-surface"`) — one
    `input.parameter(color)` wired to `output.surface.color` +
    alpha; neutral defaults for normal/roughness/metalness/ao.
  - `built-in:flat-texture` (`targetKind: "mesh-surface"`) — one
    `input.material-texture` wired to `output.surface.color`;
    tiling parameter controls UV scale.
  - The existing foliage wind-sway graph has its `targetKind`
    formalized to `"mesh-deform"` (previously carried by the
    asset-level DEFORM dropdown's existence rather than the graph
    itself). Labeling change; graph behavior is identical.

### Out of scope

- **In-surface layer composition.** Moss over bark, decals over
  walls, Substance-Painter-style layer stacks inside one Surface —
  deferred. If we ever want this, it's UI that generates a compound
  shader graph (equivalent to Blender's Mix Shader), not a new
  domain concept.
- **Per-slot Effect shaders.** Effect is whole-mesh in this epic. If
  a feature wants "fresnel edge-glow on only one slot," that's a
  concern of that slot's surface graph.
- **Post-lighting effects.** `output.effect` modifies pre-lighting
  attributes (color/normal/roughness/…), not shaded output. If we
  later need post-lit tinting, that's an `output.post-effect` in v2.
- **Thumbnail rendering for the Material / Surface library.** UI
  polish — text + swatch previews in v1.
- **Runtime-dynamic Surface mutation** (game-time animated tint).
  Authored truth; runtime gameplay does not mutate Surfaces.
- **Rich procedural masks on Surface content.** The old "Layer with
  a mask" design is gone — Surface content has no per-slot mask
  anymore. The only "mask-like" behavior is the landscape splatmap,
  which is landscape-internal.

## Architecture

### Current state

```
AssetDefinition
├── defaultShaderBindings:     (legacy, asset-level)
│   ├── surface: shaderDefId?  — applied to ALL slots with no Material
│   └── deform:  shaderDefId?  — applied to ALL meshes (vertex shader)
│
└── materialSlotBindings[]:    (Plan 032, per-slot)
    └── { slotName, slotIndex, materialDefinitionId? }

RegionLandscapeState.channels[]:
└── { channelId, mode, color, materialDefinitionId?, tilingScale? }
    — three "modes" (base / color / material) glued together in
    ad-hoc validation; SurfacePicker UI hides the glue but the
    domain still reflects it
```

Three parallel binding shapes. `MaterialDefinition` is the shared
primitive but not the shared slot concept. No home for whole-mesh
effect shaders.

### Target state

```
AssetDefinition  implements Surfaceable, Deformable, Effectable
├── surfaceSlots: AssetSurfaceSlot[]   — one per mesh material slot
│   └── { slotName, slotIndex, surface: Surface | null }
├── deform: ShaderOrMaterial | null     — whole-mesh vertex shader
└── effect: ShaderOrMaterial | null     — whole-mesh fragment modulation

RegionLandscapeState  implements Surfaceable, Deformable, Effectable
├── surfaceSlots: LandscapeSurfaceSlot[]  — per channel (renamed)
│   └── { slotName, channelId, surface: Surface, tilingScale }
├── deform: ShaderOrMaterial | null        — optional whole-landscape vertex
└── effect: ShaderOrMaterial | null        — optional whole-landscape fragment

ShaderDefinition
└── targetKind: "mesh-surface" | "mesh-deform" | "mesh-effect" | …

Surface  (discriminated union — what fills any slot)
├── { kind: "color"; color }
├── { kind: "texture"; textureDefinitionId; tiling }
├── { kind: "material"; materialDefinitionId }
└── { kind: "shader"; shaderDefinitionId; parameterValues; textureBindings }

MaterialDefinition  (unchanged — library primitive)
└── { shaderDefinitionId; parameterValues; textureBindings }
      └── targetKind is derived: materialDefinition.shaderDefinitionId
          → shaderDefinition.targetKind (lookup in content library)
```

Three orthogonal traits. One slot-content shape (`Surface`). One
library primitive (`MaterialDefinition`). No layers, no masks on
content, no blend modes on content.

### Domain types

```ts
// packages/domain/src/surface/index.ts

export type Surface =
  | { kind: "color"; color: number }
  | {
      kind: "texture";
      textureDefinitionId: string;
      tiling: [number, number];
    }
  | { kind: "material"; materialDefinitionId: string }
  | {
      kind: "shader";
      shaderDefinitionId: string;
      parameterValues: Record<string, unknown>;
      textureBindings: Record<string, string>;
    };

/**
 * Subset of `Surface` valid as content for a `Deformable.deform` or
 * `Effectable.effect` slot. The `color` and `texture` shortcut
 * variants synthesize surface-kind graphs (`built-in:flat-color` /
 * `built-in:flat-texture`) and so only make sense inside a
 * `Surfaceable` slot; allowing them on deform/effect would express
 * a state the runtime cannot realize. Narrowing the type rejects
 * those cases at the domain boundary (load, commands, imports,
 * hand-written fixtures) without relying on UI enforcement.
 *
 * This covers the STRUCTURAL mismatch only. The SEMANTIC check —
 * "does the referenced graph actually have targetKind=mesh-deform
 * / mesh-effect" — happens at runtime in `resolveSurface`; see
 * Validation rules below.
 */
export type ShaderOrMaterial = Extract<
  Surface,
  { kind: "material" } | { kind: "shader" }
>;

export interface SurfaceSlot {
  readonly slotName: string;
  readonly surface: Surface | null;
}

export interface AssetSurfaceSlot extends SurfaceSlot {
  readonly slotIndex: number;
}

export interface LandscapeSurfaceSlot extends SurfaceSlot {
  readonly channelId: string;
  readonly tilingScale: [number, number] | null;
}

export interface Surfaceable {
  readonly surfaceSlots: readonly SurfaceSlot[];
}

export interface Deformable {
  readonly deform: ShaderOrMaterial | null;
}

export interface Effectable {
  readonly effect: ShaderOrMaterial | null;
}

export function createColorSurface(color: number): Surface;
export function createTextureSurface(
  textureDefinitionId: string,
  tiling?: [number, number]
): Surface;
export function createMaterialSurface(materialDefinitionId: string): Surface;
export function createShaderSurface(
  shaderDefinitionId: string,
  params?: Record<string, unknown>,
  textures?: Record<string, string>
): Surface;
```

Shader-graph domain gains explicit output-kind types:

```ts
// packages/domain/src/shader-graph/index.ts — existing targetKind
// becomes precise enum values; output nodes gain .kind.

export type ShaderTargetKind =
  | "mesh-surface"
  | "mesh-deform"
  | "mesh-effect"
  | "post-process"    // existing, unrelated to this epic
  | …;

// New output-node kinds registered in the node catalog:
//   "output.deform"  — vertex position, vertex normal
//   "output.effect"  — reads input.accumulator.*, writes modified
//                      color / normal / roughness / metalness / ao /
//                      alpha
// (`output.fragment` stays as the mesh-surface output — it becomes
// an alias for `output.surface` at the node-catalog level, since
// the legacy name is already embedded in every existing shader
// graph.)
```

### Validation rules

Two independent invariants about "what Surface may fill which
trait's slot." Each is enforced at a different layer; together they
make the saved project incapable of expressing a state the runtime
cannot realize.

**Rule 1 — Structural kind (compile-time, domain boundary).**
`{ kind: "color" }` and `{ kind: "texture" }` can never fill a
Deformable or Effectable slot. These variants synthesize
surface-kind graphs (`built-in:flat-color` / `built-in:flat-texture`)
and have no meaning in a vertex or effect pass. Enforced by the
narrowed `ShaderOrMaterial` type on `Deformable.deform` /
`Effectable.effect`. TypeScript rejects code that tries to assign
a color or texture Surface to those fields; serialization round-
trips reject it too because domain types narrow during decoding.

**Rule 2 — Semantic target kind (runtime, resolver).** A graph with
`targetKind: "mesh-surface"` cannot fill a deform or effect slot
even if the Surface structurally is a `material` or `shader`
variant — the referenced graph's output-node kind must match the
slot's trait. Enforced in
`resolveSurface(surface, contentLibrary, expectedTargetKind)` in
runtime-core: if the resolved graph's `targetKind` doesn't match
`expectedTargetKind`, the resolver returns a diagnostic instead of
an `EffectiveShaderBinding`. The diagnostic names the offending
definition id and trait, and the caller (mesh-apply, landscape-apply)
logs it via the shared logger and leaves the slot in an unbound
fallback state rather than silently rendering garbage.

Enforcement locations:

| Layer | Catches | How |
|---|---|---|
| TypeScript / domain types | Rule 1 (structural) | `ShaderOrMaterial` narrows `Deformable.deform` / `Effectable.effect` |
| Domain IO decoder | Rule 1 (defensive) | The deserializer in `packages/domain/src/io/index.ts` validates decoded deform / effect slots; a file with `deform: { kind: "color" }` is a loud error, not silent coercion. Defense against hand-edited files, bad importers, and bugs; no "legacy" involved. |
| Domain command executor | Rule 1 (runtime commands) | Commands that write deform / effect fields accept `ShaderOrMaterial`; TypeScript again |
| `resolveSurface` in runtime-core | Rule 2 (semantic) | Runtime diagnostic; one place for every caller |
| `SurfacePicker` UI | Both (UX) | Color / Texture tabs hidden for non-surface pickers; Material list filtered by the `shaderDefinitionId → shaderDefinition.targetKind` lookup. UI is the last line of defense, not the first. |

The UI hides states the domain forbids; the domain forbids states
the runtime can't realize. A malformed file (hand-edited, broken
importer, bug in a command) never reaches the runtime — the IO
decoder catches Rule 1, the resolver catches Rule 2. No "impossible
state" path to a frozen viewport.

### Runtime pipeline

**Resolution (runtime-core):**
```ts
function resolveSurface(
  surface: Surface,
  contentLibrary: ContentLibrarySnapshot,
  expectedTargetKind: ShaderTargetKind
): ResolveSurfaceResult;

type ResolveSurfaceResult =
  | { ok: true; binding: EffectiveShaderBinding }
  | { ok: false; diagnostic: SurfaceResolverDiagnostic };
```
Lives in `packages/runtime-core/src/shader/bindings.ts` next to the
existing `resolveMaterialEffectiveShaderBinding`. Behavior by
`Surface` kind, then the universal Rule-2 check:

- `kind: "color"` → binding against `built-in:flat-color` with
  `parameterValues = { color }`.
- `kind: "texture"` → binding against `built-in:flat-texture` with
  `parameterValues = { tiling }`,
  `textureBindings = { texture: textureDefinitionId }`.
- `kind: "material"` → delegate to
  `resolveMaterialEffectiveShaderBinding`.
- `kind: "shader"` → binding built directly from the Surface's
  `shaderDefinitionId` + `parameterValues` + `textureBindings`.

After constructing the binding, the resolver looks up the
referenced `ShaderDefinition.targetKind` and compares it against
`expectedTargetKind` (Validation Rule 2). On mismatch it returns
`{ ok: false, diagnostic }` rather than a binding; callers log the
diagnostic and fall back to an unbound slot. Pure function of
authored inputs; no Three/WebGPU types in sight.

**Realization (render-web):**
`ShaderRuntime.evaluateMeshSurfaceBinding(binding, ctx)` /
`evaluateMeshDeformBinding(binding, ctx)` /
`evaluateMeshEffectBinding(binding, ctx, accumulator)` take an
already-resolved `EffectiveShaderBinding` and return a
`ShaderSurfaceNodeSet` / vertex-node set / effect-node set. Lives in
`packages/render-web/src/ShaderRuntime.ts`. render-web is never
handed an authored `Surface`.

Mesh-apply wiring (per mesh, in `applyShaderToRenderable`):

```ts
import { resolveSurface } from "@sugarmagic/runtime-core";

// host: AssetDefinition (implements Surfaceable + Deformable + Effectable)

// 1. For each surface slot on the Surfaceable:
for (const slot of host.surfaceSlots) {
  if (!slot.surface) continue;
  const result = resolveSurface(slot.surface, contentLibrary, "mesh-surface");
  if (!result.ok) { logDiagnostic(result.diagnostic); continue; }
  const nodeSet = runtime.evaluateMeshSurfaceBinding(result.binding, ctx);
  assignToMaterialSlot(material, slot.slotIndex, nodeSet);
}

// 2. If the host is Deformable with a non-null deform:
if (host.deform) {
  const result = resolveSurface(host.deform, contentLibrary, "mesh-deform");
  if (!result.ok) logDiagnostic(result.diagnostic);
  else {
    const deformNodes = runtime.evaluateMeshDeformBinding(result.binding, ctx);
    material.vertexNode = deformNodes.vertexNode;
  }
}

// 3. If the host is Effectable with a non-null effect:
if (host.effect) {
  const result = resolveSurface(host.effect, contentLibrary, "mesh-effect");
  if (!result.ok) logDiagnostic(result.diagnostic);
  else {
    const effectNodes = runtime.evaluateMeshEffectBinding(result.binding, ctx, {
      accumulator: surfaceNodeSet  // the just-assigned surface outputs
    });
    // Reassign material slots to the effect's outputs, which now wrap
    // the surface accumulator with the effect's modifications.
    material.colorNode = effectNodes.colorNode;
    material.normalNode = effectNodes.normalNode;
    // …etc
  }
}
```

Three explicit hand-offs, one per pipeline stage, one per trait. No
"fold over N layers." Resolution (domain → semantic binding) happens
in runtime-core; realization (semantic binding → TSL nodes) happens
in render-web. The two never mix.

Landscape-apply wiring (in `rebuildMaterialNodes`):

```ts
import { resolveSurface } from "@sugarmagic/runtime-core";

// host: RegionLandscapeState (implements Surfaceable + Deformable + Effectable)

const perSlotSets = host.surfaceSlots.flatMap(slot => {
  const result = resolveSurface(slot.surface, contentLibrary, "mesh-surface");
  if (!result.ok) { logDiagnostic(result.diagnostic); return []; }
  return [runtime.evaluateMeshSurfaceBinding(
    result.binding,
    { ...ctx, uvOverride: worldUV(slot.tilingScale) }
  )];
});
const composited = splatmapCompositeByChannel(perSlotSets, splatContext);
assignToLandscapeMaterial(material, composited);

if (host.deform) { /* same as asset */ }
if (host.effect) { /* same as asset */ }
```

Splatmap compositing stays exactly as today — this epic does not
change landscape blending math.

### UI shape

**Asset inspector:**

```
SURFACES                       (one picker per mesh material slot — Surfaceable)
  ▸ Trunk (slot 0):   [Bark ▼]
  ▸ Foliage (slot 1): [Leaves Aspen ▼]

DEFORM                         (Deformable)
  [None ▼]   ← SurfacePicker with acceptedTargetKind="mesh-deform"

EFFECT                         (Effectable)
  [None ▼]   ← SurfacePicker with acceptedTargetKind="mesh-effect"
```

Each picker is the existing `SurfacePicker` component, constrained by
`acceptedTargetKind` for Deform/Effect.

**Landscape workspace:**

```
CHANNELS                       (Surfaceable — per-channel surface slots)
  ≡ Base:   [Grass ▼]
  ≡ Moss:   [Moss ▼]
  ≡ Stone:  [#4A4A4A ▼]

DEFORM (optional, whole landscape)     (Deformable)
  [None ▼]

EFFECT (optional, whole landscape)     (Effectable)
  [None ▼]
```

Identical shape to the asset inspector — that uniformity is the
whole point.

## Stories

### 34.1 — Domain types: traits + `Surface` + output-node kinds

**Outcome:** `Surfaceable` / `Deformable` / `Effectable` interfaces
live in `packages/domain/src/surface/index.ts` alongside the `Surface`
discriminated union, `SurfaceSlot` / `AssetSurfaceSlot` /
`LandscapeSurfaceSlot` shapes, and the four `create*Surface`
factories. Shader-graph domain gains precise `ShaderTargetKind` enum
values and new output-node kinds `output.deform` and `output.effect`
(alongside the existing `output.fragment`, which is retained as the
mesh-surface output node). Two built-in primitive graphs registered
in the default shader library: `built-in:flat-color` and
`built-in:flat-texture`, both `targetKind: "mesh-surface"`.

**Files touched:**
- `packages/domain/src/surface/index.ts` (new) — traits, `Surface`,
  slot shapes, factories
- `packages/domain/src/shader-graph/index.ts` — output-node kinds,
  `targetKind` enum tightened, `createBuiltInFlatColorShaderGraph`
  + `createBuiltInFlatTextureShaderGraph`
- `packages/domain/src/content-library/index.ts` — register the two
  built-ins in `createDefaultContentLibrarySnapshot`
- `packages/domain/src/index.ts` — re-export
- `packages/testing/src/surface-traits.test.ts` (new) — asserts that
  `AssetDefinition` (via structural typing) satisfies `Surfaceable`
  & `Deformable` & `Effectable`
- `packages/testing/src/surface-primitive-graphs.test.ts` (new) —
  compile flat-color + flat-texture, assert zero error diagnostics,
  assert their `targetKind`

### 34.2 — `resolveSurface` (runtime-core) + deform/effect evaluators (render-web)

**Outcome:** Two halves on the correct sides of the package boundary:

- **Resolution in `runtime-core`.** `resolveSurface(surface,
  contentLibrary, expectedTargetKind) → ResolveSurfaceResult`
  lands in `packages/runtime-core/src/shader/bindings.ts`, alongside
  the existing `resolveMaterialEffectiveShaderBinding`. Handles all
  four `Surface` kinds uniformly AND enforces Validation Rule 2:
  after constructing the candidate binding, it compares the
  referenced graph's `targetKind` against `expectedTargetKind` and
  returns `{ ok: false, diagnostic }` on mismatch rather than
  silently producing an invalid binding. Pure function of authored
  inputs; zero Three/WebGPU types. Pattern match: this is semantic
  policy — "what does this authored intent mean, and is it
  consistent?" — which the bindings module's header file
  explicitly reserves for runtime-core: "web hosts only apply
  already-resolved meaning."
- **Realization in `render-web`.** `ShaderRuntime` gains
  `evaluateMeshDeformBinding(binding, ctx)` and
  `evaluateMeshEffectBinding(binding, ctx, accumulator)` siblings to
  the existing `evaluateMeshSurfaceBinding`. All three take an
  already-resolved `EffectiveShaderBinding` and produce TSL node
  sets — no awareness of `Surface` as a shape.

render-web is never handed an authored `Surface`. Call sites that
want to go from `Surface → TSL nodes` import `resolveSurface` from
`@sugarmagic/runtime-core` and hand the result to the ShaderRuntime
evaluator of the appropriate trait.

**Files touched:**
- `packages/runtime-core/src/shader/bindings.ts` — add `resolveSurface`
  next to `resolveMaterialEffectiveShaderBinding`; each `Surface`
  variant gets its own synthesis path (flat-color / flat-texture
  → built-in graph lookup; material → delegate to the existing
  resolver; shader → direct binding)
- `packages/runtime-core/src/index.ts` — re-export `resolveSurface`
- `packages/render-web/src/ShaderRuntime.ts` —
  `evaluateMeshDeformBinding`, `evaluateMeshEffectBinding` (mirror
  the existing `evaluateMeshSurfaceBinding` shape; consume
  `EffectiveShaderBinding`)
- `packages/testing/src/surface-resolver.test.ts` (new) — exercise
  `resolveSurface` in isolation (no render-web import): each
  `Surface` kind produces the expected `EffectiveShaderBinding`
  when `expectedTargetKind` matches the referenced graph's
  `targetKind`; unknown material ids fail loud; and — the
  Validation Rule 2 case — a `Surface { kind: "material" }`
  referencing a `mesh-surface` Material evaluated with
  `expectedTargetKind: "mesh-deform"` returns
  `{ ok: false, diagnostic }`, not a binding. Test asserts both
  the diagnostic message and the absence of a binding.
- `packages/testing/src/mesh-evaluator.test.ts` (new) — exercise the
  two new ShaderRuntime evaluators against hand-crafted
  `EffectiveShaderBinding` inputs (no `Surface` in sight) and
  assert the returned TSL node sets have the expected output
  fields wired.

### 34.3 — Apply trait shape to `AssetDefinition` + `RegionLandscapeState`

**Outcome:** In-place type replacement on the two concrete
Definition types. No migration of saved data (there are no users
and no existing projects to carry forward — any in-progress project
on the team is regenerated from scratch after this story lands).

- `AssetDefinition` loses `materialSlotBindings[]` and
  `defaultShaderBindings`; gains
  `surfaceSlots: AssetSurfaceSlot[]` so it structurally satisfies
  `Surfaceable`. (Deform and Effect fields come in Stories 34.6
  and 34.7.)
- `RegionLandscapeState` loses `channels[]`; gains
  `surfaceSlots: LandscapeSurfaceSlot[]` carrying `channelId` and
  `tilingScale` on each slot so it satisfies `Surfaceable`.
- `MaterialSlotBinding` becomes `AssetSurfaceSlot` (renamed + shape
  change: `materialDefinitionId` → `surface: Surface | null`).
- `RegionLandscapeChannelDefinition` becomes
  `LandscapeSurfaceSlot` (renamed + shape change).
- Default factories (`createDefaultAssetDefinition`,
  `createDefaultRegionLandscapeState`) produce the new shape.
- Commands that currently manipulate the old shapes
  (`BindAssetSlotMaterial`, `CreateLandscapeChannel`,
  `UpdateLandscapeChannel`, etc.) are updated to take and produce
  `Surface` payloads; their handlers write to the new fields.

**Rule 1 defensive validation** lives in the IO decoder for
`packages/domain/src/io/`: a saved file whose deform or effect
field carries `{ kind: "color" }` or `{ kind: "texture" }` — which
`ShaderOrMaterial` would have prevented at compile time — fails
the load with a typed error naming the asset id and field. This
isn't a "migration" step; it's a defense against hand-edited
files, broken importers, and bugs. Passes a well-formed project
through unchanged.

**Files touched:**
- `packages/domain/src/content-library/index.ts` — home of
  `AssetDefinition` (line 71) and `MaterialSlotBinding` (line 65).
  Replace `MaterialSlotBinding` with `AssetSurfaceSlot`; replace
  `AssetDefinition.materialSlotBindings` with `.surfaceSlots` and
  drop `defaultShaderBindings`.
- `packages/domain/src/region-authoring/index.ts` — home of
  `RegionLandscapeChannelDefinition` (line 86) and
  `RegionLandscapeState` (line 114). Replace the channel shape
  with `LandscapeSurfaceSlot`; rename `channels` to `surfaceSlots`
  on `RegionLandscapeState`.
- `packages/domain/src/commands/executor.ts` — command handlers
  consume `Surface` payloads and write to the new fields.
- `packages/domain/src/io/index.ts` — IO decoder adds the Rule 1
  defensive check on deform / effect fields (the check exists but
  is trivially satisfied since no legacy data ever reaches it;
  defense-in-depth for future bugs).
- `packages/testing/src/surface-shape.test.ts` (new) — construct
  the new AssetDefinition and RegionLandscapeState through their
  default factories; assert structural satisfaction of
  `Surfaceable`; Rule 1 sanity test: feed the IO decoder a
  hand-rolled malformed object with
  `deform: { kind: "color", color: 0 }`, assert the decoder
  rejects it loudly.

### 34.4 — Mesh-apply uses `resolveSurface` per slot

**Outcome:** `applyShaderToRenderable` resolves each slot's
`Surface` via `resolveSurface` and passes the binding to
`evaluateMeshSurfaceBinding`. Function signature narrows: the
per-slot helper takes a `Surfaceable`, not the whole
`AssetDefinition`. Any pre-trait fallback path is gone as a
consequence of 34.3's in-place type replacement — the old fields
don't exist to fall back on.

**Files touched:**
- `packages/render-web/src/applyShaderToRenderable.ts` —
  `applyMeshSurfaces(host: Surfaceable, …)` helper
- `packages/runtime-core/src/shader/bindings.ts` — delete any
  code paths that read `MaterialSlotBinding.materialDefinitionId`
  or `defaultShaderBindings` (those types are gone after 34.3)
- `packages/testing/src/mesh-surface-apply.test.ts` (new) — asset
  with multiple slots, each bound to a different Surface kind
  (color / texture / material / shader), renders each slot correctly

### 34.5 — Landscape uses `resolveSurface` per slot

**Outcome:** `rebuildMaterialNodes` reads `host.surfaceSlots` instead
of `host.channels`, calls `resolveSurface` →
`evaluateMeshSurfaceBinding` for each slot, feeds the node sets into
the existing splatmap composite. Signature of the helper narrows to
take a `Surfaceable`. Splatmap math is unchanged. Channel color-mode
uses the `built-in:flat-color` Surface kind under the hood instead
of the ad-hoc color path.

**Files touched:**
- `packages/render-web/src/landscape/mesh.ts` — switch per-slot
  resolution to `resolveSurface`; helper now takes `Surfaceable`
- `packages/testing/src/landscape-runtime.test.ts` — extend to cover
  all four Surface kinds on slots
- Delete the ad-hoc `channel.mode === "color"` branch from the
  runtime now that the built-in flat-color graph handles it
  uniformly

### 34.6 — `Deformable` trait on AssetDefinition

**Outcome:** `AssetDefinition.deform: ShaderOrMaterial | null` is a
first-class field, satisfying `Deformable`. Mesh-apply evaluates
it via `evaluateMeshDeformBinding` and assigns the result's vertex
outputs to `MeshStandardNodeMaterial.vertexNode`. The existing
foliage wind-sway graph has its `targetKind` formalized to
`"mesh-deform"` so it can legally fill a Deform slot. The
foliage-embedded-materials importer produces assets with
`deform: { kind: "shader", shaderDefinitionId: "<wind-sway>",
parameterValues, textureBindings }`. Asset inspector grows a
Deform picker. Function signature of the new deform helper:
`applyMeshDeform(host: Deformable, …)`.

**Files touched:**
- `packages/domain/src/content-library/index.ts` — add `deform:
  ShaderOrMaterial | null` field to `AssetDefinition`
  (`AssetDefinition` lives here, not in region-authoring).
- `packages/domain/src/shader-graph/index.ts` — formalize the wind
  graph's `targetKind` as `"mesh-deform"`; no other behavior change.
- `packages/render-web/src/applyShaderToRenderable.ts` — wire deform
  output → `material.vertexNode`.
- `packages/io/src/imports/foliage-embedded-materials.ts` — emit
  the new `deform` field on imported assets.
- `packages/workspaces/src/build/assets/` — inspector gains Deform
  picker.
- `packages/testing/src/mesh-deform.test.ts` (new) — import a
  foliage asset through the importer; assert its `deform` field is
  populated with `kind: "shader"` referencing the wind-sway graph
  and that mesh-apply wires deform output to the material's
  `vertexNode`.

### 34.7 — `Effectable` trait + `output.effect` + `input.accumulator.*`

**Outcome:** `AssetDefinition.effect: ShaderOrMaterial | null` is a
first-class field, satisfying `Effectable`. Shader graphs gain the
ability to author effect passes: `output.effect` as an output-node
kind and the `input.accumulator.*` builtin family
(accumulator.color, accumulator.normal, accumulator.roughness,
accumulator.metalness, accumulator.ao, accumulator.alpha) wire an
effect graph to read the surface's post-evaluation outputs and
write a modified fragment. Mesh-apply, after assigning surface
outputs, evaluates the effect graph with the surface's output
nodes bound as the accumulator inputs, then reassigns the
material's slots to the effect's outputs. A demo effect is
registered for smoke testing (e.g. `built-in:cloud-shadow-demo`);
authoring rich effects is out of scope — the infrastructure is what
this story delivers. Helper signature:
`applyMeshEffect(host: Effectable, surfaceNodeSet, …)`.

The work splits across the three layers per the established
ownership rules (domain = node catalog; runtime-core = IR + compiler
+ evaluator context shapes; render-web = TSL materialization):

**Domain — node catalog:**
- `packages/domain/src/shader-graph/index.ts` — register the
  `output.effect` output-node kind in the node catalog (alongside
  `output.surface` and `output.deform` from Story 34.1) with its
  input ports (color, normal, roughness, metalness, ao, alpha).
  Register the `input.accumulator.color/.normal/.roughness/
  .metalness/.ao/.alpha` node family as a builtin source with no
  external inputs (its value comes from the evaluator context at
  materialization time). Extend `ShaderTargetKind` / output
  node-to-trait mapping so a graph with `output.effect` resolves to
  `targetKind: "mesh-effect"`.

**Runtime-core — IR + compiler + evaluator context:**
- `packages/runtime-core/src/shader/ir.ts` — extend the compiled-IR
  shape to carry an effect-output set (color/normal/roughness/
  metalness/ao/alpha node references) in addition to the existing
  surface-output set. Add an accumulator-input reference family in
  the IR so the compiler can record "this output reads from
  accumulator.X" semantically without materializing a TSL node.
- `packages/runtime-core/src/shader/compiler.ts` — extend the
  compile path (currently the surface/deform case switch) to emit
  the effect IR shape when an `output.effect` node is the graph's
  output. Resolve `input.accumulator.*` source nodes to
  accumulator-input IR references, not to literal constants.
  Diagnostics: a graph whose `targetKind` is `"mesh-effect"` but
  that doesn't consume any accumulator input earns a warning (the
  effect is pointless); a graph that references accumulator inputs
  but whose output is `output.surface` is an error (accumulator
  only has meaning inside an effect pass).
- `packages/runtime-core/src/shader/bindings.ts` — extend the
  evaluator-context shape to carry an optional
  `accumulator: EffectiveShaderBinding | AccumulatorSourceRef`
  field so callers can declare "here are the surface outputs that
  should back the accumulator at materialization time." Plumb this
  through whatever context factory already exists. (Stays in
  runtime-core because the *shape* of evaluator context is semantic
  policy; the TSL materialization that reads it is render-web's
  job.)

**Render-web — TSL materialization:**
- `packages/render-web/src/ShaderRuntime.ts` — implement
  `evaluateMeshEffectBinding(binding, ctx, accumulator)`. This is
  the new materialization entry: walks the effect-IR's output
  nodes, materializes them into TSL nodes, and when it encounters
  an accumulator-input IR reference, substitutes the corresponding
  TSL node from the caller-supplied `accumulator: ShaderSurfaceNodeSet`
  (the already-materialized surface outputs). Returns a
  `ShaderSurfaceNodeSet` that the caller assigns to the material
  slots, replacing the surface's node set.
- `packages/render-web/src/applyShaderToRenderable.ts` — effect
  interposition step (as sketched in the Architecture section):
  after `evaluateMeshSurfaceBinding` assigns surface outputs,
  evaluate the effect via `evaluateMeshEffectBinding` with the
  just-computed surface node set as the accumulator, and reassign
  the material slots to the effect's outputs.

**Content-library + UI:**
- `packages/domain/src/content-library/index.ts` — add `effect:
  Surface | null` field to `AssetDefinition` (AssetDefinition lives
  here, not in region-authoring).
- `packages/workspaces/src/build/assets/` — Effect slot picker in
  the inspector.

**Tests:**
- `packages/testing/src/effect-compiler.test.ts` (new,
  runtime-core-only) — compile a graph that uses
  `input.accumulator.color` into IR, assert the IR carries an
  accumulator-input reference (not a literal); compile a graph with
  mismatched targetKind ↔ accumulator usage, assert the expected
  diagnostic.
- `packages/testing/src/mesh-effect.test.ts` (new, full-stack) —
  stand up a simple effect graph (accumulator.color * tint
  parameter) and verify it composes with a standard-pbr surface
  end-to-end through `applyShaderToRenderable`.

### 34.8 — Landscape opts into `Deformable` + `Effectable`

**Outcome:** `RegionLandscapeState.deform` and `.effect` fields are
added, satisfying `Deformable` and `Effectable` respectively. Same
pipeline wiring as the asset side — the helpers
`applyMeshDeform(host: Deformable, …)` and
`applyMeshEffect(host: Effectable, …)` work unchanged because they
ask for traits, not concrete types. The landscape workspace grows
two slot pickers below Channels. Default factory produces both
fields as `null`.

**Files touched:**
- `packages/domain/src/region-authoring/index.ts` — add `deform` +
  `effect` to `RegionLandscapeState`; `createDefaultRegionLandscapeState`
  sets both to `null`.
- `packages/render-web/src/landscape/mesh.ts` — call the existing
  deform + effect helpers; the signatures already accept
  `Deformable` / `Effectable` so no new code paths are needed.
- `packages/workspaces/src/build/landscape/index.tsx` — inspector
  gains the two pickers.

### 34.9 — Asset inspector UI refresh

**Outcome:** Asset inspector uses the existing `SurfacePicker`
component for every surface slot. The old SURFACE and DEFORM
asset-level dropdowns are deleted — `surfaceSlots` and `deform`
replaced them at the domain level in stories 34.3 and 34.6.
Deform and Effect slot pickers are inspector sections of their
own. `SurfacePicker` takes an `acceptedTargetKind` prop: Color /
Texture tabs are hidden when `acceptedTargetKind !== "mesh-surface"`;
Material tab filters by resolving each candidate Material's
`shaderDefinitionId` to its `ShaderDefinition` and comparing
`shaderDefinition.targetKind` against `acceptedTargetKind`.
(Target kind is a property of the referenced graph, not of the
Material itself; `MaterialDefinition` carries no `targetKind`
field.)

**Files touched:**
- `packages/workspaces/src/build/assets/` — inspector layout rewrite
- `packages/ui/src/components/SurfacePicker.tsx` — optional
  `acceptedTargetKind` prop
- Snapshot tests for the new inspector shape

### 34.10 — ADR + boundary lint

**Outcome:** ADR 012 *Surface / Deform / Effect trait model*:
documents the three traits, the Output-node-kind compatibility rule,
the one-graph-per-slot invariant, the explicit rejection of a
"layers" domain concept, and the à-la-carte trait-implementation
story for future Definitions. Lint guard
`tooling/check-surface-trait-boundary.mjs` that fails CI if a new
code path constructs a direct `materialDefinitionId` binding on an
asset or landscape slot — every binding must flow through the
`Surface` shape.

**Files touched:**
- `docs/adr/012-surface-deform-effect-traits.md` (new)
- `docs/adr/README.md`
- `tooling/check-surface-trait-boundary.mjs` (new)
- `package.json` — lint target

## Success criteria

- **Three traits, three pipeline stages, one shader graph each.** No
  code path composites N layers to produce one slot's rendering.
  `Surfaceable`'s slots each have one graph; `Deformable`'s deform
  has one graph; `Effectable`'s effect has one graph.
- **Function signatures use the minimum trait they need.** `grep`
  for helpers that take an entire `AssetDefinition` when they only
  read `surfaceSlots` returns nothing after Story 34.4. The same for
  deform + effect after 34.6 / 34.7.
- **Structural-typing asserts pass.** A TypeScript test file
  constructs sample `AssetDefinition` and `RegionLandscapeState`
  values and asserts (via typechecker) that they satisfy the three
  traits.
- **The tree scenario works.** Import a two-slot foliage asset with
  an embedded bark material on slot 0 and a leaf material on slot
  1; assign a wind-sway Deform to the whole asset; assign a
  cloud-shadow Effect to the whole asset. All three composite
  correctly in the Editor viewport.
- **Landscape with per-channel Surfaces paints correctly.** Create a
  region with three channels (grass / dirt / rock), each a Surface
  (material or color), paint splatmap weights between them, verify
  the composite renders as expected. Splatmap math is unchanged
  from the pre-epic path — this is a sanity check on the per-slot
  Surface resolution path, not a migration equivalence test.

## Risks

- **Effect ordering with PBR lighting.** `output.effect` writes
  pre-lighting attributes (color/normal/roughness/…). Lighting
  evaluation happens downstream in `MeshStandardNodeMaterial`.
  Authors who expect "effect is a post-lit tint" will get something
  different — they're modifying albedo, not shaded color. Document
  clearly. If post-lighting effects become necessary, they're a
  separate `output.post-effect` kind in v2, wired after the material
  has computed shaded output. Deferred.
- **Accumulator inputs in effect graphs.** `input.accumulator.*`
  needs to resolve to the *surface's* final outputs when the effect
  is wired. At shader-runtime, that means passing the surface's
  output nodes into the effect's evaluation context. Straightforward
  in TSL but requires a new evaluator context field. Covered in
  Story 34.7.
- **Trait-compatibility validation in the editor.** The
  `SurfacePicker`'s Material tab filters via the lookup chain
  `material.shaderDefinitionId → shaderDefinition.targetKind`, then
  keeps only Materials whose resolved graph kind matches
  `acceptedTargetKind`. `MaterialDefinition` itself has no
  `targetKind` field — target kind is a graph property, and the UI
  must do the one-hop resolution. Small UI concern but needs doing
  correctly; handled in Story 34.9.
- **Splatmap blending of effect outputs.** When a landscape host is
  `Effectable` with a non-null effect, it runs after the splatmap
  composite of N slots' surface outputs. That's consistent with
  "whole-landscape effect" — effect sees the post-composite
  accumulator. If we ever wanted per-slot effects on landscape,
  that's a per-slot `effect` field — future work.
- **Per-slot `tilingScale` on landscape.** Under the new model,
  `tilingScale` is a field on `LandscapeSurfaceSlot` (alongside
  `surface` and `channelId`); it's applied as an `uvOverride`
  multiplier when evaluating that slot's Surface. It stays on the
  slot rather than inside the Surface itself because it's a
  landscape-host concern, not a universal Surface concept.

## Builds on

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
  — one rendering path. This epic reinforces it by giving every
  trait one evaluator.
- [Plan 029: Shader Graph Pipeline](/Users/nikki/projects/sugarmagic/docs/plans/029-shader-graph-pipeline-epic.md)
  — this epic adds two new output-node kinds to that pipeline
  (`output.deform`, `output.effect`) and formalizes `targetKind`.
- [Plan 032: Material System and Library Epic](/Users/nikki/projects/sugarmagic/docs/plans/032-material-system-and-library-epic.md)
  — `MaterialDefinition` stays exactly as Plan 032 defined it. A
  Material is the library primitive; a Surface is slot content that
  can reference a Material.
- [Plan 033: Unified Viewport State Subscription Epic](/Users/nikki/projects/sugarmagic/docs/plans/033-unified-viewport-state-subscription-epic.md)
  — orthogonal. Surface edits are domain commands; the viewport
  subscribes either way.
