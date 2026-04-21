# Plan 034: Surface as Layer Stack Epic

**Status:** Proposed
**Date:** 2026-04-20

> **2026-04-20 revision** (before any implementation): earlier drafts
> split layers into a five-kind discriminated union (Color / Texture /
> Material / Shader / Effect). That distinction was UI vocabulary
> leaking into the domain. Blender treats everything as a shader
> graph — a "solid color" material is a graph with two nodes
> (Principled BSDF + Output). We adopt the same model: there is ONE
> layer shape under the hood, carrying a shader-graph reference
> plus parameter values plus texture bindings. UI keeps the four
> familiar entry points (Color / Texture / Material / Shader) as
> *templates* that produce pre-populated instances of the same
> domain shape. The rest of this epic reflects that unified model.

## Epic

### Title

Unify the scattered "how does authored content become rendered surface"
concepts — asset-level Surface shader, per-slot Material binding,
landscape channel material, foliage embedded material, PBR texture
import — into one first-class domain concept: **Surface**. A Surface
is an ordered stack of layers that composite PBR attributes (basecolor,
normal, roughness, metallic, AO, alpha) before lighting is evaluated.
Every existing binding becomes a Surface with one or more layers. The
UI shows an asset's rendering identity as a stack of layers; the domain
represents it as a first-class `SurfaceDefinition`; the runtime
composites the stack into a single `ShaderSurfaceNodeSet` and hands it
to the existing mesh-surface apply path.

### Goal

Four product outcomes, in priority order:

1. **One coherent authoring concept.** Authors stop seeing "MATERIALS,
   SURFACE, DEFORM, landscape channels" as separate systems with
   unclear overlap. They see **Surfaces** everywhere: on mesh slots,
   on landscape channels, on billboard cards. Surfaces can be saved
   and reused.
2. **Layer stacking (Photoshop-for-PBR).** A Surface can be more than
   one thing: a base Material plus an overlay shader, plus an effect
   layer for wind / shimmer, plus a cutout mask. Authors compose by
   dragging layers in a stack, setting blend modes, attaching masks.
   Under the hood layers composite PBR attributes per-pixel before
   lighting — Unreal's Material Layers model, not "alpha-blend two
   rendered materials."
3. **One import path, one render path, one editing path.** GLB import
   produces Surfaces. Substance PBR import produces Surfaces.
   FoilageMaker import produces Surfaces. The runtime evaluates
   Surfaces through the same shared evaluator
   (`evaluateMeshSurfaceBinding` extended to composite layer sets).
   The authoring UI is a Surface editor and a Surface Library
   workspace.
4. **Landscape becomes a Surface consumer.** Today's per-channel
   Material binding + splatmap mix is one special case of a Surface
   stack with splatmap-driven masks. Collapsing landscape into the
   Surface system proves the abstraction and removes yet another
   parallel render path.

Two architectural outcomes:

- **One rendering math.** The existing `ShaderSurfaceNodeSet` contract
  (Story 32.12) is already the right shape. Extend the runtime to
  fold N layer-evaluated sets into one composite set via blend modes
  + masks. Mesh-surface apply and landscape apply both end up calling
  the same composite evaluator.
- **`Material` becomes a library primitive, not a binding point.**
  Materials continue to exist — they're a named shader graph +
  parameter snapshot, reusable across Surfaces. Surfaces REFERENCE
  Materials (as the content of a layer with `source.kind ===
  "material"`). Asset slots bind to
  Surfaces, not Materials directly. One more layer of indirection,
  but the indirection is load-bearing: it's what makes composition
  possible.

### Why this epic exists

Plan 032 shipped a Material system with a clear thesis — "Material =
shader graph + parameter snapshot, one rendering math" — but the
authoring UI and the import paths accumulated parallel concepts
during implementation that the thesis doesn't cover:

- **Per-asset SURFACE / DEFORM shader dropdowns** (legacy, pre-Material).
  Still visible in the asset inspector. Still applies when no Material
  is bound to a slot. Precedence model is "Material wins when bound,
  SURFACE is fallback for unbound slots" — documented but invisible
  to authors unless they read the epic.
- **Per-slot MATERIALS section.** The new Material binding. Cannot
  compose with SURFACE. Authors see both sections and reasonably
  assume they layer; they don't.
- **Landscape channels** (Plan 009 + Story 32.6 + 32.12). A channel
  binds a Material. Splatmap weights blend channels. Works through
  the shader graph system, but the Channel concept is landscape-
  specific and not reusable elsewhere.
- **FoilageMaker embedded-materials importer** (latest on this branch).
  Extracts embedded GLB textures, auto-creates TextureDefinitions +
  MaterialDefinitions, wires material slots. Good — but the
  auto-created Material binds to `standard-pbr` or `foliage-surface-3`
  with no way to compose additional effects (seasonal tint, wind
  shimmer, custom fresnel) on top without forking the shader.
- **PBR texture-set importer** (Story 32.4). Creates a Material bound
  to `standard-pbr` (ORM) or `standard-pbr-separate`. Same
  "one-material-wins, no composition" story.

Each of these works in isolation. The problem is they're parallel — a
designer who wants "the foliage's painterly shading PLUS a red
seasonal tint PLUS a wind sway" has no path through the current UI.
The shader graph system is powerful enough to express all three, but
expressing them requires forking a shader graph or writing one from
scratch. Every author hits this eventually; every author currently
answers it by giving up and shipping a single hardcoded shader.

The "Surface as stack of layers" mental model is how every mature
authoring tool already solves this (Unreal Material Layers, Unity
HDRP Layered Lit, Photoshop, Substance Painter). Sugarmagic has the
runtime machinery to support it — `ShaderSurfaceNodeSet` compositing
is already how landscape blends N channels. This epic makes the
machinery authorable.

### Core thesis

**A Surface is an ordered stack of layers that compose PBR
attributes, not rendered appearances, before lighting is evaluated.**
Every layer is typed (Color, Texture, Material, Shader, Effect),
carries a blend mode, and may carry a mask. Every existing binding
point (mesh slot, landscape channel, billboard card) is a Surface
reference. One compositing evaluator subsumes per-slot Material
rendering, landscape channel blending, and any future layered
authoring.

Mapping to prior art:
- **Unreal Engine Material Layers** (UE4.24+): nearly identical
  model. Each layer exposes the material attribute output; a Layer
  Blend composites two layers. We borrow the attribute model but
  flatten the explicit "Blend node" into a per-layer `blendMode` +
  `mask` for UI simplicity.
- **Unity HDRP Layered Lit Shader**: 4 layers with a mask texture
  picking which wins per pixel. Simpler, fixed-layer-count. Our
  Surface extends to arbitrary layer count and richer mask types.
- **Substance Painter / Designer**: layer paradigm at authoring
  time. We adopt the vocabulary (layer, base, blend mode, mask,
  opacity) so authors migrating from those tools find the mental
  model familiar.

## Scope

### In scope

- **`SurfaceDefinition` domain type.** Named, library-listed asset
  with `surfaceDefinitionId`, `displayName`, `layers: SurfaceLayer[]`.
  Persisted in `ContentLibrarySnapshot.surfaceDefinitions[]`.
- **One unified `SurfaceLayer` shape.** Every layer — whether
  authored as a flat color, a texture fill, a named Material, or a
  custom shader graph — is one domain shape. Composition controls
  (enabled, opacity, blendMode, mask) plus a `source` that is either
  an inline shader reference (`shaderDefinitionId` + parameter values
  + texture bindings) or a named Material reference
  (`materialDefinitionId` + optional per-layer overrides).
- **Four authoring entry points in the UI** — "Add Color," "Add
  Texture," "Add Material," "Add Shader" — each of which is a
  *template* that produces an instance of the one domain shape:
  - **Color** → layer with `source: { kind: "shader",
    shaderDefinitionId: "built-in:flat-color", parameterValues: {
    color: [r, g, b, a] } }`. The built-in `flat-color` graph is one
    `input.parameter` wired to `output.fragment.color` with neutral
    defaults for the other PBR outputs.
  - **Texture** → layer with `source: { kind: "shader",
    shaderDefinitionId: "built-in:flat-texture", textureBindings: {
    texture: "..." } }`. The built-in `flat-texture` graph is one
    `input.material-texture` wired to `output.fragment.color`,
    neutral defaults elsewhere.
  - **Material** → layer with `source: { kind: "material",
    materialDefinitionId: "..." }`. References a library
    MaterialDefinition; the Material's shader + param snapshot +
    texture bindings provide the layer's rendering. Per-layer
    `parameterOverrides` / `textureBindingOverrides` follow the
    Plan 032 §32.1 precedence rule (overrides override values, never
    replace the shader).
  - **Shader** → layer with `source: { kind: "shader",
    shaderDefinitionId: "<any>", parameterValues, textureBindings }`.
    Drops any existing shader graph into the stack (foliage-surface-3,
    debug shaders, custom effects, wind-sway).
- **Effect layers are not a separate kind.** A shader graph that
  modifies the layer below is just a shader layer whose graph
  happens to reference `input.previous-layer-*` builtins. Wind sway,
  rim fresnel, warm-sun highlight all become "Add Shader" with the
  appropriate graph selected. The `input.previous-layer-*` node
  family is net-new plumbing (see Story 34.9 below) — the LAYER
  model stays unified.
- **Per-layer composition controls:** `enabled` (bool),
  `opacity: number` (0..1), `blendMode: SurfaceBlendMode`
  ("base" | "multiply" | "add" | "overlay" | "mix"), and
  `mask: SurfaceMask | null`.
- **Mask types** (for v1):
  - `texture` — sample a TextureDefinition channel
  - `splatmap-channel` — the landscape splatmap case; a specific
    weight index with an optional `normalize-remainder: true` for the
    base channel
  - `fresnel` — view-angle falloff with configurable power + strength
  - `vertex-color-channel` — read a vertex-color channel (FoilageMaker
    foliage-tint mask)
  - `always` — no mask, full-coverage
  Richer masks (world-gradient, height-blend, procedural) are v2.
- **Runtime composite evaluator.** Extend `ShaderRuntime` with
  `evaluateSurfaceDefinition(surface, options) → ShaderSurfaceNodeSet`.
  Internally: evaluate each layer to a `ShaderSurfaceNodeSet` via
  the existing `evaluateMeshSurfaceBinding` (for Material and Shader
  layers) or a direct literal build (for Color, Texture), then fold
  the N sets per-channel using blend mode + mask. Output is one
  final `ShaderSurfaceNodeSet` ready for `applyIRToMaterial`'s
  material assignment step.
- **Asset inspector redesign.** Per-slot "Surface" picker replaces
  the MATERIALS section. No more SURFACE / DEFORM asset-level
  dropdowns — they collapse into the Surface (DEFORM becomes an
  layer whose graph reads `input.previous-layer-*` builtins — see
  Story 34.9). A nested layer editor lets authors
  reorder, toggle, and tune layers in place.
- **Surface Library workspace.** New Build workspace sibling of
  Material Library. Lists Surfaces, offers "New Surface," lets
  authors edit multi-layer Surfaces, import a Material as a single-
  layer Surface in one click.
- **Migration: existing `MaterialSlotBinding.materialDefinitionId`
  becomes `surfaceDefinitionId`.** Loader migration auto-creates a
  single-layer Surface wrapping each legacy Material binding, at the
  moment a project is loaded. No author action required.
- **Landscape as a Surface consumer.** Per-region landscape becomes a
  single Surface with N layers (each `source.kind === "material"`),
  each masked by a splatmap-channel mask. Channel paint = painting a
  mask. Collapses
  Plan 032 / Story 32.12's parallel landscape code path into the
  unified Surface evaluator.
- **Import paths produce Surfaces.** PBR texture-set import →
  Surface with one `source: "material"` layer bound to standard-pbr
  or standard-pbr-separate. FoilageMaker embedded-material import →
  per-slot Surfaces with one `source: "material"` layer each
  (foliage-surface-3 for leaves, standard-pbr for trunk).

### Out of scope

- **`input.previous-layer-*` builtins (v1).** The plumbing that lets
  a shader-source layer modify the accumulator below it — covered in
  design above, deferred in implementation to Story 34.9 (v2). V1
  ships with layers that each produce an independent
  `ShaderSurfaceNodeSet`; modifier-style layering (rim fresnel, wind
  sway, warm-sun-on-top) comes with the previous-layer builtins.
  Wind sway keeps the current deform shader wiring until v2 lands.
- **Rich procedural masks.** World-position gradients, perlin-noise
  masks, height-blend masks — useful but deferrable. V2.
- **Material graph composition / sub-graphs / graph references from
  inside graphs.** This epic does NOT turn shader graphs into
  composable building blocks for other shader graphs; that's a
  different, larger refactor. Surfaces compose at the
  `ShaderSurfaceNodeSet` level, not the graph-node level. Each
  layer's graph still compiles independently.
- **Thumbnail / preview rendering of Surfaces and layers in the
  library.** UI polish. Ship text + color previews in v1.
- **Surface-level undo beyond the command system.** Layer edits go
  through domain commands (like every other authored mutation);
  undo works via the existing command history. Finer-grained "scrub
  layer opacity" undo is a UX polish, not this epic.
- **Runtime-dynamic layer modification** (game-time tint, animated
  opacity). Surfaces are authored truth; runtime gameplay doesn't
  mutate them. A future "MaterialInstance with runtime
  parameter-override" is a separate concern.

## Architecture rework

### Current state

```
AssetDefinition
├── defaultShaderBindings:     (legacy, asset-level)
│   ├── surface: shaderDefId?  — applied to ALL slots with no Material
│   └── deform:  shaderDefId?  — applied to ALL meshes
│
└── materialSlotBindings[]:    (Plan 032, per-slot)
    └── { slotName, slotIndex, materialDefinitionId? }
        └── materialDefinitionId → MaterialDefinition
                                   ├── shaderDefinitionId
                                   ├── parameterValues
                                   └── textureBindings

RegionLandscapeState.channels[]:  (Plan 009/32.12, landscape-specific)
└── { channelId, mode, color, materialDefinitionId?, tilingScale? }
    └── materialDefinitionId → MaterialDefinition  (same Material concept as above)
    └── splatmap-weight blending is HARDCODED in landscape/mesh.ts
```

Three parallel binding shapes (`defaultShaderBindings`,
`materialSlotBindings`, `landscape.channels`), each resolving to
`EffectiveShaderBinding`, each taking a different path through
precedence logic. Material is the shared primitive but not the shared
binding shape.

### Target state

```
AssetDefinition
└── materialSlotBindings[]:    (single binding shape for meshes)
    └── { slotName, slotIndex, surfaceDefinitionId? }
        └── surfaceDefinitionId → SurfaceDefinition
                                  └── layers: SurfaceLayer[]
                                      (each references a Material,
                                       Texture, or Shader + mask +
                                       blend mode)

RegionLandscapeState:
└── surfaceDefinitionId → SurfaceDefinition
                          └── layers: SurfaceLayer[]  (one per channel,
                              source.kind="material", mask=splatmap-channel)
```

One binding shape. One SurfaceDefinition concept. One composite
evaluator. `MaterialDefinition` continues to exist unchanged —
it's content referenced inside a layer via `source.kind === "material"`, not a binding point.
`defaultShaderBindings` disappears from the asset (all its
capabilities are expressible via a Surface).

### Types (domain)

```ts
// packages/domain/src/surface/index.ts

export type SurfaceBlendMode =
  | "base"        // the first layer — sets the baseline
  | "mix"         // lerp(prev, this, mask * opacity)
  | "multiply"    // prev * lerp(1, this, mask * opacity)
  | "add"         // prev + this * mask * opacity
  | "overlay";    // classic photoshop overlay; applies per-channel

export type SurfaceMask =
  | { kind: "always" }
  | { kind: "texture"; textureDefinitionId: string; channel: "r" | "g" | "b" | "a" }
  | { kind: "splatmap-channel"; channelIndex: number; normalizeRemainder: boolean }
  | { kind: "fresnel"; power: number; strength: number }
  | { kind: "vertex-color-channel"; channel: "r" | "g" | "b" | "a" };

/**
 * Where the layer gets its shader graph + parameter values from.
 *
 * `"shader"` inlines a specific shader graph and its parameter values
 * directly on the layer. Used by the "Add Color," "Add Texture," and
 * "Add Shader" UI templates, each of which pre-fills a different
 * shaderDefinitionId (the built-in flat-color graph, the built-in
 * flat-texture graph, or a user-picked authored graph).
 *
 * `"material"` references a named MaterialDefinition from the
 * content library. The Material's shader + parameter snapshot +
 * texture bindings provide the layer's defaults. `parameterOverrides`
 * and `textureBindingOverrides` apply per-layer on top, following
 * the Plan 032 §32.1 precedence rule: overrides change parameter
 * VALUES, never the shader.
 */
export type SurfaceLayerSource =
  | {
      kind: "shader";
      shaderDefinitionId: string;
      parameterValues: Record<string, unknown>;
      textureBindings: Record<string, string>;
    }
  | {
      kind: "material";
      materialDefinitionId: string;
      parameterOverrides: Record<string, unknown>;
      textureBindingOverrides: Record<string, string>;
    };

export interface SurfaceLayer {
  layerId: string;
  displayName: string;
  enabled: boolean;
  opacity: number;          // 0..1
  blendMode: SurfaceBlendMode;
  mask: SurfaceMask;        // "always" is the default
  source: SurfaceLayerSource;
}

export interface SurfaceDefinition {
  surfaceDefinitionId: string;
  definitionKind: "surface";
  displayName: string;
  layers: SurfaceLayer[]; // layers[0] is the base (blendMode must be "base")
}
```

### Built-in primitive shader graphs

Two new shader graphs ship alongside the existing `standard-pbr`,
`foliage-surface-*`, etc., and back the Color / Texture UI templates:

- **`built-in:flat-color`** — one `input.parameter` (color, vec4)
  wired to `output.fragment.color` and `output.fragment.alpha`. All
  other PBR outputs (normal, roughness, metalness, ao) stay at the
  runtime's neutral defaults (flat up-facing normal, roughness=1,
  metalness=0, ao=1).
- **`built-in:flat-texture`** — one `input.material-texture` keyed to
  `texture` (texture2d, textureRole=color), wired to
  `output.fragment.color` and `output.fragment.alpha`. Tiling is
  handled inside this graph with the same UV-scale pattern
  standard-pbr uses, driven by a `tiling` vec2 parameter.

Neither graph is more "special" than any other. They're library
primitives the UI knows how to pre-fill. Authors can create
additional primitive graphs (flat-emissive, flat-metallic, etc.)
without domain code changes — they'd just need an "Add Custom
Primitive" template entry in the UI.

Added to `ContentLibrarySnapshot`:
```ts
export interface ContentLibrarySnapshot {
  // …existing…
  surfaceDefinitions: SurfaceDefinition[];
}
```

`ContentDefinitionKind` gains `"surface"`.

### Runtime composite evaluator

New public method on `ShaderRuntime`:

```ts
evaluateSurfaceDefinition(
  surface: SurfaceDefinition,
  options: {
    geometry: THREE.BufferGeometry | null;
    carrierMaterial: THREE.Material;
    uvOverride?: unknown;     // for landscape-world-projection
    splatmapContext?: SplatmapContext | null; // for splatmap masks
  }
): ShaderSurfaceNodeSet | null;
```

Internally:

1. Resolve each layer's source to an `EffectiveShaderBinding`:
   - `source.kind === "shader"`: synthesize an `EffectiveShaderBinding`
     directly from the layer's `shaderDefinitionId` + `parameterValues`
     + `textureBindings`.
   - `source.kind === "material"`: resolve via
     `resolveMaterialEffectiveShaderBinding` (existing,
     runtime-core), then apply `parameterOverrides` and
     `textureBindingOverrides` on top.
2. Evaluate each `EffectiveShaderBinding` to a `ShaderSurfaceNodeSet`
   via the existing `evaluateMeshSurfaceBinding` — one code path for
   every layer kind because every layer reduces to a binding.
3. Evaluate each layer's `mask` to a scalar TSL node (0..1). New
   case: `splatmap-channel` mask consults the `splatmapContext` the
   caller passed (the landscape path sets this; mesh slots pass null
   and reject splatmap masks with a graph diagnostic).
4. Fold the N sets in order via `foldLayers(sets, masks, blendModes)`:
   - Start with the base layer's set as the accumulator.
   - For each subsequent layer, blend per-channel: `composite =
     blend(composite, layerSet, blendMode, maskNode * layer.opacity)`.
   - Normal blending stays in tangent space.
5. Return the accumulator.

Callers (mesh slot apply, landscape apply) each get one
`ShaderSurfaceNodeSet`, which they hand to `applyIRToMaterial`'s
material-assignment step. The assignment step itself is unchanged.

### UI shape

**Asset inspector, per-slot Surface:**

```
MATERIALS (renames to just the list of slots)

▸ Trunk (slot 1)
  Surface: [bark-surface ▼] [Edit]

▾ Leaves (slot 2)
  Surface: [leaves-aspen-surface ▼] [Edit] [+]
    ┌──────────────────────────────────┐
    │ ≡ Seasonal Tint      👁  Overlay 30%  │ ← inline edit
    │ ≡ Wind Shimmer        👁  Add 100%     │
    │ ≡ Foliage Surface 3   👁  Base 100%    │
    └──────────────────────────────────┘
```

Expanded per-slot reveals the layer stack inline (Photoshop-style).
Layers drag-reorder. The Surface itself is named and lives in the
Surface Library; "Edit" opens it in the library workspace for
multi-slot reuse.

**Surface Library workspace:**

Sibling of Material Library. Lists Surface Definitions. Click a
Surface → editor panel showing its layer stack + per-layer parameter
editor. "New Surface" creates an empty one. "New Surface from
Material" wraps an existing Material as a single-layer Surface.

## Stories

### 34.1 — `SurfaceDefinition` domain types + content-library wiring

**Outcome:** `SurfaceDefinition` + `SurfaceLayer` + `SurfaceLayerSource`
+ `SurfaceMask` types in `packages/domain/src/surface/`. Added to
`ContentLibrarySnapshot.surfaceDefinitions[]` with normalizer default.
`"surface"` added to `ContentDefinitionKind` union. Two new built-in
shader graphs (`flat-color`, `flat-texture`) registered in the
default shader library, backing the Color and Texture UI templates.
Round-trip test: save a project with a multi-layer Surface
(including both `source.kind === "shader"` and `source.kind ===
"material"` layers), load it back, equality.

**Files touched:**
- `packages/domain/src/surface/index.ts` (new) — types + convenience
  factories that produce instances of the one unified `SurfaceLayer`
  shape with the appropriate `source` pre-filled. These factories
  are the named shortcut for the four UI templates, not distinct
  types: `createSurfaceDefinition`, `createColorLayer(color)`,
  `createTextureLayer(textureDefId)`,
  `createMaterialLayer(materialDefId)`,
  `createShaderLayer(shaderDefId, params)`.
- `packages/domain/src/shader-graph/index.ts` — add
  `createBuiltInFlatColorShaderGraph`, `createBuiltInFlatTextureShaderGraph`
- `packages/domain/src/content-library/index.ts` — register the two
  built-in primitive shaders; add `surfaceDefinitions[]` to
  `ContentLibrarySnapshot` with normalizer default
- `packages/domain/src/index.ts` — re-export
- `packages/testing/src/surface-definition-round-trip.test.ts` (new)
- `packages/testing/src/surface-primitive-shaders.test.ts` (new) —
  compile flat-color + flat-texture, assert both produce a
  color+alpha fragmentOutput with no error diagnostics

### 34.2 — Runtime composite evaluator

**Outcome:** `ShaderRuntime.evaluateSurfaceDefinition` method. Every
layer resolves to an `EffectiveShaderBinding` (via its
`source`) and then goes through the existing
`evaluateMeshSurfaceBinding` — one code path for every layer. The
evaluator folds N node sets by blend mode + mask, returns one
`ShaderSurfaceNodeSet`. Pure — no material assignment; caller
assigns.

**Files touched:**
- `packages/render-web/src/ShaderRuntime.ts` —
  `evaluateSurfaceDefinition` + `resolveLayerBinding` (shader vs
  material source) + `evaluateMask` + `foldLayers`
- `packages/render-web/src/materialize/surface-blends.ts` (new) —
  per-channel blend math for the 5 blend modes; normal-channel
  blending stays tangent-space
- `packages/testing/src/surface-evaluator.test.ts` (new) —
  single-layer (shader source), single-layer (material source),
  multi-layer, masked (texture-channel + fresnel + splatmap-channel),
  all 5 blend modes

### 34.3 — Single-layer-Surface migration for existing Material
bindings

**Outcome:** Legacy `MaterialSlotBinding.materialDefinitionId` is
auto-converted at load time to a synthesized single-layer Surface
with one layer of `source.kind === "material"`.
`materialSlotBindings[i].surfaceDefinitionId`
becomes the new canonical shape. Old field is read as a migration
input; new field is the write target. Existing projects open
unchanged visually.

**Files touched:**
- `packages/domain/src/region-authoring/index.ts` — `MaterialSlotBinding`
  gains `surfaceDefinitionId: string | null`, legacy
  `materialDefinitionId` stays as migration input (read-only)
- `packages/domain/src/io/index.ts` — normalization step: for every
  `materialDefinitionId`-binding, synthesize a Surface in the content
  library and rewrite the binding to point at the new Surface's id
- `packages/domain/src/commands/` — commands that manipulated
  material bindings now manipulate Surface bindings
- `packages/testing/src/surface-migration.test.ts` (new)

### 34.4 — Mesh-slot apply uses the Surface evaluator

**Outcome:** `applyShaderToRenderable` resolves each slot to a
`SurfaceDefinition` (via `surfaceDefinitionId`), evaluates via
`ShaderRuntime.evaluateSurfaceDefinition`, and assigns the resulting
node set to the mesh's material. The per-slot Material resolution
path (what Story 32.8 landed) collapses into the Surface path —
single-layer Surface = Material.

**Files touched:**
- `packages/render-web/src/applyShaderToRenderable.ts`
- `packages/runtime-core/src/shader/bindings.ts` — `EffectiveMaterialSlotBinding`
  gains `surface: SurfaceDefinition` reference alongside (or replacing)
  the old `.surface: EffectiveShaderBinding` field
- `packages/testing/src/surface-mesh-apply.test.ts` (new) — mesh with
  a multi-layer Surface renders with the composited nodes

### 34.5 — Landscape ported to a Surface consumer

**Outcome:** `RegionLandscapeState.channels[]` collapses into a
single `surfaceDefinitionId`. The landscape's Surface has one layer
per channel with `mask: { kind: "splatmap-channel", channelIndex: i,
normalizeRemainder: i === 0 }`. Painting a channel paints its mask
(mask → splatmap layer i). `RuntimeLandscapeMesh.rebuildMaterialNodes`
becomes a thin wrapper that evaluates the landscape's Surface via
`evaluateSurfaceDefinition`, passing a `splatmapContext` with the
current splat textures. No more per-channel hand-coded loop.

**Files touched:**
- `packages/domain/src/region-authoring/index.ts` — RegionLandscapeState
  migrates `channels[]` → `surfaceDefinitionId`
- `packages/render-web/src/landscape/mesh.ts` — the 150-line
  `rebuildMaterialNodes` shrinks to 20 lines of "get the surface,
  evaluate, apply"
- `packages/render-web/src/ShaderRuntime.ts` — splatmap-channel mask
  evaluation is a new mask case
- Tests: landscape still renders the same way before/after the port

### 34.6 — Surface Library workspace

**Outcome:** New Build workspace under "Materials" tab or as a peer
tab. Lists Surface Definitions. Edit view shows the layer stack
editor (reorder, toggle, opacity, blend mode, mask editor, per-layer
parameter editor). "Import Material as Surface" quick-action.

**Files touched:**
- `packages/workspaces/src/build/surfaces/` (new workspace)
- `apps/studio/src/App.tsx` — workspace registration
- `packages/ui/src/components/SurfaceLayerStack.tsx` (new) — reusable
  layer stack editor component, same as used inline in asset
  inspector
- `packages/ui/src/components/SurfaceMaskEditor.tsx` (new) — mask
  authoring UI (texture picker, fresnel params, splatmap channel
  picker)

### 34.7 — Asset inspector redesign: Surface per slot

**Outcome:** Asset inspector shows a Surface picker per material
slot. Expanded slot shows the layer stack editor inline. Asset-level
SURFACE / DEFORM dropdowns are removed (SURFACE is subsumed; DEFORM
becomes a shader-source layer using `input.previous-layer-*`
builtins per Story 34.9).

**Files touched:**
- `packages/workspaces/src/build/assets/` — inspector layout
- `packages/ui/src/components/SurfacePicker.tsx` — extend with
  "Create new Surface" quick-action
- Removal of `AssetDefinition.defaultShaderBindings.surface` (or
  deprecation-flag — confirm no tests reference it after 34.3's
  migration)

### 34.8 — Import paths produce Surfaces

**Outcome:** `importPbrTextureSet` returns a `SurfaceDefinition` (one
`source: "material"` layer) instead of a bare Material.
`importSourceAsset` for foliage GLBs produces Surfaces per slot (one
`source: "material"` layer each,
parent = foliage-surface-3 for leaves, standard-pbr for trunk).
`pbr-import.test.ts` + `foliage-import.test.ts` extended to verify.

**Files touched:**
- `packages/io/src/imports/index.ts`
- `packages/io/src/imports/pbr-texture-set.ts`
- `packages/io/src/imports/foliage-embedded-materials.ts`
- `apps/studio/src/App.tsx` — `handleImportPbrMaterial` wires the
  returned Surface into content library + asset bindings

### 34.9 — `input.previous-layer-*` builtins + wind-sway migration (V2)

**Outcome:** Any shader layer can modify the layer below by
referencing the new `input.previous-layer-color`, `-normal`,
`-roughness`, `-metalness`, `-ao`, `-alpha` builtins in its graph.
No new layer kind — these are just shader graphs that happen to read
from the accumulator instead of (or alongside) their own sampling.
The existing foliage-wind deform shader is re-authored as a shader
graph using these builtins, registered as a reusable library
primitive (`built-in:wind-sway`), and authors drop it in via "Add
Shader → Wind Sway." The asset-level DEFORM dropdown disappears.

**Files touched:**
- `packages/domain/src/shader-graph/index.ts` — add
  `input.previous-layer-*` node family to the node catalog
- `packages/runtime-core/src/shader/ir.ts` — builtins for
  previous-layer access
- `packages/runtime-core/src/shader/compiler.ts` — compile case
- `packages/render-web/src/ShaderRuntime.ts` — materialize
  previous-layer builtins from the current fold accumulator in
  `FinalizationContext`
- Foliage wind deform shader — re-authored as a shader graph using
  the new builtins; registered as `built-in:wind-sway`
- Any migration to strip the obsolete
  `AssetDefinition.defaultShaderBindings.deform` field after all
  legacy projects are known to have been re-saved through 34.3

This story is tagged V2 / follow-up. V1 can ship with wind-sway
still wired through the legacy `defaultShaderBindings.deform` path
alongside the new Surface system; 34.9 retires that path.

### 34.10 — Documentation + ADR + boundary lint

**Outcome:** ADR 012: "Surface is the Rendering-Identity Primitive."
Documents the single-binding-shape rule, the layer composition
contract, and migration guarantees. Lint extension: a new
`tooling/check-surface-boundary.mjs` that fails CI if a new code
path creates a direct `materialDefinitionId`-based binding outside
the migration adapter.

**Files touched:**
- `docs/adr/012-surface-as-rendering-identity.md` (new)
- `docs/adr/README.md`
- `tooling/check-surface-boundary.mjs` (new)
- `package.json` — lint target

## Success criteria

- **One binding shape.** `grep` for `materialDefinitionId` in binding
  types across `packages/domain/src/` and `packages/runtime-core/src/`
  returns results only inside SurfaceLayer definitions and migration
  adapters.
- **Asset inspector has no MATERIALS + SURFACE + DEFORM triplet.**
  One per-slot Surface picker. Layer stack inline.
- **Landscape renders identically before/after Story 34.5.** Visual
  regression test (or golden-image test if we have the infrastructure)
  confirms.
- **Legacy projects load with zero author-visible changes.** A project
  authored in the current branch opens in the post-34.3 branch with
  the same rendering, same inspector UI (just re-labeled), and the
  saved project file now contains `surfaceDefinitions` alongside the
  legacy `materialDefinitions`.
- **Multi-layer Surface renders correctly.** A Surface with (base
  Material + overlay Shader + masked color tint) produces the
  expected composite at each pixel, verified end-to-end in the
  viewport.
- **Material Library still useful.** MaterialDefinition remains a
  reusable content-library primitive; creating a Material and
  referencing it from multiple Surfaces works and edits propagate.

## Risks and open questions

- **Performance at rendering time.** An N-layer Surface samples and
  composites N times per pixel. Budget: 3-4 layer stacks per slot
  should be free on modern GPUs; 10+ may not. Need a per-layer
  "static vs runtime" analysis — layers whose contribution is
  constant (fully-opaque base with opaque overlay, no mask) can be
  collapsed at compile time. Defer the optimization to a follow-up
  story (34.11 probably) unless rendering budgets surface it.
- **Blend-mode semantics for normal maps.** Blending tangent-space
  normal samples is non-commutative in general. Plan: treat
  `base` / `mix` as defined (lerp with renormalize); `multiply` /
  `add` / `overlay` on normalNode are **undefined** in v1 and
  documented as "don't do this." The layer's UI for normal blend
  modes greys out non-mix modes unless the user opts in with an
  explicit override.
- **Asset thumbnails + Surface previews.** Implementing a mini-
  renderer for Surface preview thumbnails is its own thing. V1 ships
  with text previews. Called out as out-of-scope.
- **Per-slot Surface vs shared Surface reuse.** A Surface can be
  referenced from multiple asset slots + multiple landscape channels
  simultaneously. Editing the Surface propagates everywhere. Good
  reuse, but authors may expect per-slot Surface tweaks to be
  isolated. The three-tier precedence (Plan 032 §32.1 — per-
  placement inline overrides) generalizes: a MaterialSlotBinding can
  carry `layerOverrides` that selectively tweak a Surface's layer
  parameters without forking the whole Surface. V2 polish.
- **Undo granularity.** Layer reorder, toggle, opacity-scrub each
  need to be domain commands for proper undo integration. Per-
  keystroke undo on an opacity slider drag is a UX polish; first-
  pass is "commit on blur / drag-release," which gets us undo-per-
  action. Same pattern used for landscape channel color edits today.
- **Interaction with Epic 033 (Unified Viewport State Subscription).**
  Epic 033 moves viewport updates to store-subscription and kills
  imperative viewport methods. Surfaces don't need special
  accommodation — a SurfaceDefinition edit goes through a command,
  updates the store, viewport subscribes and re-evaluates. The two
  epics are orthogonal; either can ship first.
- **Migration durability.** Story 34.3's auto-migration must be
  idempotent and preserve `materialDefinitionId` reads for older-
  format snapshots indefinitely (we don't have a "drop legacy"
  migration version). Write tests that load a three-generations-old
  project.

## Builds on

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
  — one rendering path for authoring + playtest + published.
  Surfaces reinforce this by collapsing three parallel rendering
  paths (asset SURFACE, per-slot Material, landscape channels) into
  one Surface evaluator.
- [Plan 029: Shader Graph Pipeline](/Users/nikki/projects/sugarmagic/docs/plans/029-shader-graph-pipeline-epic.md)
  — shader graph system. Surfaces don't modify graphs; they
  composite graph evaluation results.
- [Plan 032: Material System and Library Epic](/Users/nikki/projects/sugarmagic/docs/plans/032-material-system-and-library-epic.md)
  — MaterialDefinition concept. Surfaces consume Materials as
  layers. Story 32.1's "inline override precedence" rule
  generalizes: at the asset slot level, authors may supply layer-
  parameter overrides on top of a referenced Surface.
- Story 32.10 (AuthoredAssetResolver), 32.11 (complete standard-pbr),
  32.12 (landscape unified with shader graph) — the shared
  `ShaderSurfaceNodeSet` contract and the `evaluateMeshSurfaceBinding`
  helper are the load-bearing primitives this epic's composite
  evaluator is built on top of.
- [Plan 033: Unified Viewport State Subscription](/Users/nikki/projects/sugarmagic/docs/plans/033-unified-viewport-state-subscription-epic.md)
  — orthogonal. Surface edits go through the store; the viewport
  subscribes either way.
