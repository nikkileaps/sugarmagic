# Plan 032: Material System and Material Library Epic

**Status:** Implemented
**Date:** 2026-04-18

## Epic

### Title

Introduce a first-class **Material** concept — a named, library-listed
asset that binds a shader graph to a specific parameter/texture snapshot —
along with the machinery to author, store, reuse, and bind materials to
landscape channels and (later) mesh material slots. Use Blender as the
single source of truth for which slots an imported mesh has; use the
Sugarmagic Material Library as the source of truth for what actually gets
rendered in each slot.

### Goal

Four product outcomes, in priority order:

1. **An author can import a Substance Designer PBR texture set as a
   Material and bind it to a landscape channel**, producing a tiled,
   lit, normal-mapped ground surface. This is the first end-to-end
   use-case that proves the architecture.
2. **Materials are reusable.** "Forest Dirt" can be bound to a landscape
   channel AND, later, to a mesh slot, without duplication. Edits
   propagate to every consumer on next render.
3. **Blender is the material-slot authority for meshes.** An imported
   GLB's material slots come through as named strings; Sugarmagic
   surfaces them in the asset inspector; the author binds each to a
   Material from the library. Renaming, adding, or removing slots in
   Blender is the only way to change the slot set — Studio never lets
   the author add a new slot. This is the lesson from Sugarbuilder:
   re-implementing mesh-selection material assignment in the editor
   was a dead end.
4. **One shader graph, many materials.** The existing shader-graph
   system becomes the "parent" for Materials. Authors don't duplicate
   shaders to get variants; they make two Materials referencing the
   same shader with different parameter values.

Two architectural outcomes:

- **Separation of "what is the rendering math" (shader graph) from
  "what are the concrete inputs to that math" (material).** Today the
  inputs live as inline `shaderOverrides` on each asset. They get lifted
  into a shared, named, library-listed thing.
- **Material as a domain concept, owned by `@sugarmagic/domain`.**
  Resolution happens in `@sugarmagic/runtime-core` (pure data, no web
  deps). GPU binding lives in `@sugarmagic/render-web`. Same one-way
  dependency discipline as every other rendered concept.

### Why this epic exists

Today every asset and every landscape channel carries raw, inline
shader parameter overrides. For the foliage shader that worked fine —
there's one shader, its parameters are small, and they live next to the
thing they apply to. For landscape authoring the gap becomes obvious:
a dirt ground is a whole PBR texture set (basecolor + normal +
occlusion/roughness/metallic + tiling params), an author will tune it
once and want to reuse it across multiple channels and across multiple
regions. Reauthoring the same parameters per-channel is a non-starter.

The same pressure is coming for meshes. Once an author imports a
building with six material slots (wall, roof, trim, glass, floor, door),
each wanting its own PBR texture set, every slot-level override becomes
a candidate for reuse across the project ("this same brick pattern is
on four buildings"). Without a Material layer, those six text-set
bindings get copy-pasted per building and drift over time.

This epic adds the Material layer and validates it end-to-end on
landscape first. Mesh-slot binding follows inside the same epic but
ships as a later story so the landscape use case unblocks early.

### Core thesis

**A Material is a reference to a shader graph plus a snapshot of
parameter values.** Nothing is hardcoded into it; the shader graph is
unchanged. The value of the abstraction is that the snapshot is named,
reusable, and lives in a shared library — and that editing the shader
graph once updates every material that references it.

Mapping to UE5 for anyone cross-referencing: **Sugarmagic Shader Graph
= UE Material (parent)**; **Sugarmagic Material = UE Material Instance
Constant (MIC)**. We do not adopt UE's parent-Material-vs-MaterialFunction
split — our shader-graph system is the single authoring surface for both.

## Scope

### In scope

- **`MaterialDefinition` domain type.** Named, library-listed asset
  with `materialDefinitionId`, `displayName`, `shaderDefinitionId`
  (the parent shader graph), `parameterValues` (sparse override map
  over that graph's declared parameters), and `textureBindings` (map
  of texture-parameter-id → `TextureDefinition` reference).
- **`TextureDefinition` domain type.** Named texture asset with
  `textureDefinitionId`, `displayName`, `sourcePath` (relative path
  under the project's `assets/` directory), `colorSpace` (`linear` or
  `srgb`), and `packing` (`rgba`, `orm`, `normal`, etc.). Texture
  instances are not parameters on individual materials — they are
  first-class assets so a single basecolor PNG can be referenced by
  multiple materials.
- **Content-library storage.** `MaterialDefinition[]` and
  `TextureDefinition[]` added to `ContentLibrarySnapshot` alongside
  `shaderDefinitions`, `assetDefinitions`, `environmentDefinitions`.
  Normalize and merge via the existing
  `normalizeContentLibrarySnapshot` path.
- **Built-in `standard-pbr` shader graph.** A new `mesh-surface` shader
  graph with parameters for basecolor texture, normal texture,
  ORM-packed texture, tiling (vec2), roughness scale, metallic scale.
  Serves as the default parent for imported-texture-set Materials.
  Lives alongside the existing shaders; does not replace them.
- **`Material Library` workspace** under the Build product mode,
  peer of Assets / Environment / Landscape. MVP UX:
  - List view of materials with name and parent-shader name (thumbnail
    sphere preview deferred to a polish story).
  - "New Material" flow: pick parent shader graph → name → edit
    parameters/textures.
  - "Import PBR Texture Set" flow: choose an exported texture-set
    folder. Import-time discovery infers map roles from filename
    conventions (`basecolor` / `albedo`, `normal`, `orm`, `roughness`,
    `metallic`, `ambientOcclusion`, `height`) and auto-creates
    `TextureDefinition`s plus a `MaterialDefinition` bound to
    `standard-pbr`.
  - Import fails loudly on missing required maps or duplicate role
    matches, and surfaces explicit warnings for imported textures that
    `standard-pbr` does not bind yet (for example `height`).
  - Inline parameter editor reusing the existing shader-parameter UI
    (numeric, color, enum) plus a new texture picker that selects
    from the texture library.
  - Search/filter by name. Folder-browsing alone is insufficient per
    research on library UX.
- **Texture import path.** Copy the selected image files into the
  project's `assets/textures/` subdirectory, create a
  `TextureDefinition` pointing at the relative path, add to the
  content library. Handles PNG and JPEG in v1; HDR textures deferred.
- **Landscape render-ownership cleanup (prework; see Story 32.5).**
  The existing landscape mesh realization lives in `runtime-core` but
  imports Three directly — a pre-existing boundary violation that this
  epic would extend. Story 32.5 moves Three-dependent landscape code
  to `render-web` before the material-mode wiring lands, so this
  epic's "no boundary violations" claim holds honestly. See
  *Architecture rework > Pre-existing landscape boundary violation*
  for the split between what stays in runtime-core (pure data) and
  what moves to render-web (GPU realization).
- **Landscape channel material-mode wiring (the first-bite outcome).**
  `RegionLandscapeChannelDefinition.mode === "material"` already exists
  in the data model but has never been wired to rendering. This epic:
  - Exposes a MaterialDefinition picker in the landscape-channel
    inspector when `mode === "material"`.
  - Extends the render-web landscape mesh (post-32.5 move) so the
    colorNode for a material-mode channel samples basecolor / normal /
    ORM from the referenced material's textures instead of using the
    flat `color` field.
  - Applies world-space tiling from the material's `tiling_x` /
    `tiling_y` parameters.
  - Blends material-mode and color-mode channels cleanly via the
    existing splatmap weight math.
- **Mesh material-slot binding (the second-bite outcome).** Runs
  after landscape lands.
  - GLB import reads the glTF material list and creates one
    `MaterialSlotBinding` per authored material on the resulting
    `AssetDefinition`. Slot key is **the glTF material name**
    (string equality). Index is display-only.
  - Assets workspace gains a "Materials" panel listing each slot name
    with a MaterialDefinition picker.
  - The existing shader-binding resolver (`resolveBindingForOwner`
    and friends) grows a material-aware path. See
    *Architecture rework > Parameter resolution precedence* for the
    canonical three-tier precedence rule. In short: a
    `MaterialSlotBinding` on the `AssetDefinition` **replaces** the
    legacy `defaultShaderBindings[n].parameterValues` entry for that
    slot (they don't coexist per-slot); per-placement
    `PlacedAssetInstance.shaderOverrides` continue to win over both.
    If a slot has no material bound, current behavior is preserved
    verbatim.
  - Per-mesh-section material application in `ShaderRuntime` so each
    mesh section in a multi-material GLB renders with its bound
    material independently. (Plan 031 explicitly deferred this; now
    is when it lands.)
- **Blender slot-naming guidance.** The `foilagemaker/README.md` and
  a new `docs/authoring/blender-material-slots.md` document the
  convention: **glTF material names are stable, unique, and never
  renamed mid-project.** Include a note that reimporting a GLB matches
  slots by name — rename in Blender and the Studio binding drops to
  unset until the author rebinds.
- **Migration path for inline `shaderOverrides`.** Existing assets
  with `shaderOverrides` or `shaderOverride` continue to resolve. The
  normalizer does NOT auto-create Materials from legacy inline
  overrides — the conversion is an authoring decision, surfaced in
  the inspector as a one-click "Promote overrides to Material" action
  (nice-to-have; safe to defer to a polish story).

### Out of scope (explicitly)

- **Material Instance inheritance (material-of-a-material).** UE's
  MIC → MIC chain. Adds complexity without a concrete use case for a
  single-author stylized project. Revisit when "this material is
  90% the same as that one, I want to override one param" becomes a
  real pain point.
- **`MaterialInstanceDynamic` / runtime parameter mutation.** Used in
  UE for damage overlays, dissolve effects, health bars. No concrete
  Sugarmagic use case yet. Defer.
- **Static switch parameters and shader-permutation machinery.** Our
  TSL compile path is fast enough that on-demand variant compilation
  keyed by parameter hash is the right choice. No compile-time-branching
  permutation explosion like UE.
- **`.sbsar` / Substance plugin integration.** Authors export a flat
  PBR texture set from Substance Designer and import that. The plugin
  workflow is not worth the dependency for our stylized, Blender-native
  pipeline.
- **Component-level material overrides.** UE allows overriding a mesh's
  material per-placed-instance. Sugarmagic's equivalent would be
  "override the Oak tree's bark material just for this one placement."
  Useful someday, but choosing a single override level (asset-definition
  only) now prevents the "why doesn't it look right in level X"
  debugging pathology UE teams run into. Revisit when a concrete need
  shows up.
- **Material-function / shader-subgraph system.** Our current shader
  graph is flat. UE's Material Functions provide reusable subgraphs. If
  our shader graphs start growing repetitive sub-networks we'll
  revisit; they don't today.
- **Landscape Edit Layers (non-destructive paint stacking).** Current
  flat-splatmap model is the right complexity level for now.
- **Thumbnail preview rendering for the material library.** Important
  for long-term UX but deferred to a polish story. MVP ships with
  name + parent-shader text only.
- **Decals and particles as material consumers.** Materials are
  consumed by meshes and landscape channels in this epic. Decals /
  particles would be additional consumers if/when those systems land.
- **Physical materials** (UE's friction / audio / footstep metadata
  layer). Gameplay adjacency, not rendering. Separate concern.

## Architecture rework

### The Material-as-parameter-snapshot model

Both `MaterialDefinition` and `TextureDefinition` land in
`packages/domain/src/content-library/index.ts` alongside the other
library-level definitions (`AssetDefinition`, `EnvironmentDefinition`,
`ShaderGraphDocument`). Two `ContentDefinitionKind` union members are
involved: `"material"` is **already declared** in the union (line ~44
of the current file) — it was reserved but never populated, so this
epic is the one that finally gives it a shape. `"texture"` is NOT in
the union today and MUST be added as part of Story 32.1. Forgetting
to add it will produce a TypeScript error at the first `TextureDefinition`
literal.

```typescript
// packages/domain/src/content-library/index.ts (additions)

// --- extend the existing ContentDefinitionKind union ---
export type ContentDefinitionKind =
  | "asset"
  | "material"       // already present, now populated by MaterialDefinition
  | "texture"        // NEW — must be added for TextureDefinition below
  | "npc"
  | "dialogue"
  | "quest"
  | "item"
  | "inspection"
  | "resonance-point"
  | "vfx"
  | "environment"
  | "shader";

export interface TextureDefinition {
  definitionKind: "texture";
  textureDefinitionId: string;
  displayName: string;
  /** Relative to the project's `assets/textures/` directory. */
  sourcePath: string;
  /** How the renderer should interpret the color values. */
  colorSpace: "linear" | "srgb";
  /**
   * Channel semantics of the file. `rgba` = no special packing;
   * `orm` = red=AO, green=roughness, blue=metallic (standard
   * industry convention); `normal` = tangent-space normal map.
   */
  packing: "rgba" | "orm" | "normal";
}

export interface MaterialDefinition {
  definitionKind: "material";
  materialDefinitionId: string;
  displayName: string;
  /** The shader graph this material instantiates. */
  shaderDefinitionId: string;
  /**
   * Sparse override map. Keys are ShaderParameter.parameterId of the
   * referenced shader graph. Values must be type-compatible with the
   * shader's declared parameter type. Any parameter not present here
   * uses the shader graph's declared default.
   */
  parameterValues: Record<string, unknown>;
  /**
   * Map of shader parameter id → texture definition id, for parameters
   * whose shader-declared type is `texture2d`. Separate from
   * parameterValues so texture references can be migrated
   * independently (rename, re-import, etc.) without touching
   * scalar/color params.
   */
  textureBindings: Record<string, string>;
}

export interface ContentLibrarySnapshot {
  // ... existing fields ...
  textureDefinitions: TextureDefinition[];
  materialDefinitions: MaterialDefinition[];
}
```

### Parameter resolution precedence

Three tiers, evaluated top-down per parameter. First tier that has a
value for the parameter wins; ties (same tier, multiple sources) are
impossible by construction because each tier is single-source.

1. **Per-placement inline override** —
   `PlacedAssetInstance.shaderOverrides[slot][parameterId]`, if
   present. Highest priority. This is the existing per-placement
   escape hatch ("this specific oak has a redder bark tint") and
   survives this epic unchanged.
2. **Material parameter value** — if the asset-level slot binding
   (`AssetDefinition.materialSlotBindings[n]`) points at a
   `MaterialDefinition`, use that material's
   `parameterValues[parameterId]` if present.
3. **Shader graph declared default** — the parameter's `defaultValue`
   in the `ShaderGraphDocument`. Always exists (every parameter has
   a default).

**At the asset level, Material binding and legacy
`defaultShaderBindings` parameter overrides do not coexist for the
same slot.** For a given slot, the asset is in exactly one of three
states:

- **A. Slot bound to a Material.** Tier 2 resolves against that
  material. Any legacy `defaultShaderBindings[n].parameterValues` for
  this slot is ignored (migration path is "promote to Material" or
  "leave alone"; see Story 32.7).
- **B. Slot has legacy inline parameter overrides (no material).**
  Tier 2 resolves against those inline overrides — backward-compatible
  with every 0.17.x-era asset. This is the majority of existing content
  on day one.
- **C. Slot has neither.** Tier 2 is empty; resolution falls through
  to the shader's declared default.

This is identical in spirit to UE's MIC → parent → shader-default
chain: the Material tier is the named, reusable middle layer; the
per-placement tier is the per-instance escape hatch; the shader
default is the floor.

**Why not a four-tier model** (per-placement > material > asset-inline
> shader-default)? Because letting material and asset-inline coexist
at the same slot forces authors to reason about *two independent
"asset-level defaults"* when debugging "why does this parameter have
this value?" UE teams repeatedly regret this kind of split per the
research that informed this epic. We pick one: Material OR legacy
inline, not both. The legacy inline path exists only for backward
compatibility and will age out as authors promote to Materials.

**Landscape channels:** only tiers 2 and 3 apply; there is no
per-placement override concept for a channel. When
`mode === "material"`, the Material's parameter values feed the
landscape shader; otherwise the channel's `color` field is used
directly (current 0.17.x behavior).

### What inline overrides can and cannot replace

A consequence of the three-tier model that needs naming explicitly
before the resolver gets written: when a slot is bound to a Material,
inline overrides can change **parameter values** but cannot change
the **shader**. The Material pins the shader for that slot; inline is
the per-placement escape hatch for parameter tweaks only.

Concretely, the fields of a `ShaderBindingOverride` entry on
`PlacedAssetInstance.shaderOverrides[slot]` are interpreted as follows:

| Inline field | Slot has Material bound | Slot has no Material bound |
|---|---|---|
| `shaderDefinitionId` | **Ignored.** Material chooses the shader. | Honored — selects the shader for this slot on this placement. |
| `parameterValues[paramId]` | Honored — overrides Material's parameter value for this placement (tier 1 of the precedence chain). | Honored — overrides the asset-level default or the shader default. |
| `textureBindings[paramId]` (textures) | Honored — overrides Material's texture reference for this placement. | Honored — sets a texture for this placement. |

The "ignored" row is the one that needs code-level enforcement. The
resolver must not silently combine an inline `shaderDefinitionId`
with a Material's shader in some unspecified way; it must pick one or
the other based on whether the slot has a Material bound, and log (or
surface in validation) when an inline `shaderDefinitionId` is
discarded because the slot is material-bound. That surface warning
catches the case where an author promoted a slot to a Material but
left a legacy inline shader override sitting on a placement, wondering
why their tweak isn't taking effect.

**Rationale:** this matches UE's MIC model — a Material Instance's
parent is fixed; only its parameters can be instance-overridden. The
"surprise shader swap at one placement" debugging pathology UE teams
regret is precisely what this rule prevents. It also keeps the
Material binding semantically strong: "this slot uses Oak Bark
Material" means *Standard PBR with Oak's parameter snapshot, always*
— if you want a different shader for one placement, you bind a
different Material or unbind the slot.

### Slot binding on AssetDefinition

```typescript
// packages/domain/src/content-library/index.ts (additions to AssetDefinition)

export interface MaterialSlotBinding {
  /**
   * The glTF material name from the imported GLB. Stable across
   * reimports as long as the Blender material isn't renamed. This
   * is the match key — not the index. See landscape-layer model in
   * Plan 009 for the same "name-keyed binding" rationale.
   */
  slotName: string;
  /** Positional index in the source GLB, display-only. */
  slotIndex: number;
  /** null = use the asset's default / fall back to current behavior. */
  materialDefinitionId: string | null;
}

export interface AssetDefinition {
  // ... existing fields ...
  /**
   * One entry per glTF material name in the source mesh. Created on
   * import, never added to or removed from in Studio — Blender is
   * the authority for slot existence. Reimports reconcile by name.
   */
  materialSlotBindings: MaterialSlotBinding[];
}
```

**Non-negotiable: slot name as the match key.** The UE research called
out that string-equality-on-slot-name is the only reimport-stable
binding model. Index-based matching scrambles on Blender material
reordering. We inherit this lesson; do not accept a PR that compares
by index.

### Landscape channel material-mode

The channel definition already has the scaffolding:

```typescript
export interface RegionLandscapeChannelDefinition {
  channelId: string;
  displayName: string;
  mode: "color" | "material";           // ← already here
  color: number;                         // used when mode === "color"
  materialDefinitionId: string | null;   // ← already here, never wired
}
```

This epic wires `materialDefinitionId` through the runtime landscape
mesh so material-mode channels sample their bound material's textures
instead of using the flat `color`. No schema change; only resolution
and rendering.

### Dependency direction

- **`packages/domain`**: `MaterialDefinition`, `TextureDefinition`,
  `MaterialSlotBinding`, migration/normalize logic. No rendering deps.
- **`packages/runtime-core`**: material resolution — given an asset and
  a slot, return the effective shader + parameter set. Pure data, no
  Three. Lives next to `resolveBindingForOwner`.
- **`packages/render-web`**: material-aware GPU binding.
  `ShaderRuntime.applyMaterial(material, target)` mirroring the
  existing `applyShader` / `applyShaderSet` path. Per-mesh-section
  iteration in `applyShaderToRenderable`. Landscape mesh realization
  (geometry, TSL material nodes, splatmap texture upload) and the
  material-mode channel extension live here as well.
- **`apps/studio`**: Material Library workspace UI. Asset inspector
  Materials panel. Landscape channel material picker.

Boundary tests (existing `check-package-boundaries.mjs`) must pass:
runtime-core cannot import Three; render-web cannot be imported by
runtime-core.

### Pre-existing landscape boundary violation (owned by this epic)

`packages/runtime-core/src/landscape/mesh.ts` currently imports `three`,
`three/webgpu`, and `three/tsl` — and `packages/runtime-core/src/landscape/index.ts`
exposes a `createLandscapeSceneController` whose public interface
returns `THREE.Group` references. This is tech debt predating 032 (it
landed with Plan 009's landscape splatmap). The violation is not
introduced by this epic but IS extended by it — the landscape
material-mode wiring in Story 32.6 would add more Three + TSL code to
that file.

Rather than pile more violations on and defer the cleanup indefinitely,
this epic owns the move explicitly as **Story 32.5**, which lands
before the material-mode wiring. The split is:

- **Stays in `runtime-core`**: pure landscape data (`RegionLandscapeState`,
  `LandscapeRuntimeDescriptor`, `resolveLandscapeDescriptor`,
  `LandscapeSceneWarning`, `LandscapeBrushStroke`, the
  `LandscapeSplatmap` painted-weight-data model). No Three, no TSL.
  These are the concepts any future target (Tauri desktop, mobile,
  headless test harness) would need.
- **Moves to `render-web`**: `RuntimeLandscapeMesh` (Three mesh and
  MeshStandardNodeMaterial), `createLandscapeSceneController` (the
  scene-graph owner that returns `THREE.Group`), and anything else
  that touches GPU resources or Three types.

After this move, the `LandscapeSplatmap` data structure remains in
runtime-core (it's a typed byte-buffer wrapper, no Three), but the
GPU upload of its buffers into `THREE.DataTexture`s happens in the
render-web side.

**Import updates required when the move lands:**

- `targets/web/src/runtimeHost.ts` — import
  `createLandscapeSceneController` from `@sugarmagic/render-web`
  instead of `@sugarmagic/runtime-core`.
- `packages/render-web/src/host/WebRenderHost.ts` — same.
- `packages/testing/src/landscape-runtime.test.ts` — move to a
  render-web test location (or re-import from render-web if it stays
  in `@sugarmagic/testing`). The test exercises Three material
  construction, so it cannot live in a runtime-core-only test scope.

This cleanup is the reason the landscape material-mode story ships as
32.6, not 32.5 — the move has to land first or the plan would need to
drop its "no boundary violations" success criterion.

## Stories

### 32.1 — Domain types and content-library wiring

**Outcome:** `TextureDefinition`, `MaterialDefinition`, and
`MaterialSlotBinding` exist in the domain, persist through project
save/load, and survive content-library normalization. No UI yet; no
rendering yet. Round-trip test writes a project with a material, loads
it back, asserts equality.

**Files touched:**
- `packages/domain/src/content-library/index.ts` — this is where
  `AssetDefinition` actually lives today (NOT
  `region-authoring/index.ts`, which covers region-scene concepts
  like `RegionSceneFolder`, `PlacedAssetInstance`,
  `RegionLandscapeChannelDefinition`, etc.). All of these changes
  land in this one file:
  - Add `"texture"` to the `ContentDefinitionKind` union.
  - Add `TextureDefinition` and `MaterialDefinition` interfaces
    (see *Architecture rework > The Material-as-parameter-snapshot
    model*).
  - Add `textureDefinitions: TextureDefinition[]` and
    `materialDefinitions: MaterialDefinition[]` to
    `ContentLibrarySnapshot`, with `normalizeContentLibrarySnapshot`
    defaulting them to empty arrays for backward compatibility with
    already-saved projects.
  - Add `materialSlotBindings: MaterialSlotBinding[]` to
    `AssetDefinition` (also in this same file), default empty on
    existing assets via the normalizer.
- `packages/domain/src/shader-graph/index.ts` — pin the node
  contract for `input.material-texture` and extend shader-graph
  parameters to carry texture typing. Both changes are prerequisites
  for Story 32.2's `standard-pbr` graph needing to name multiple
  distinct textures (basecolor vs. normal vs. ORM):

  - **Node contract (`input.material-texture`).** The node
    currently has empty settings and no input ports — a legacy
    "THE texture for this material" shape from the single-texture
    era. This story pins it into its real shape:

    ```ts
    {
      nodeType: "input.material-texture",
      displayName: "Material Texture",
      category: "input",
      validTargetKinds: ["mesh-surface", "billboard-surface"],
      inputPorts: [
        // optional: unwired falls back to the primary UV channel
        // (uv()), matching UE's TextureSample Coordinates pin
        inputPort("uv", "UV", "vec2", { optional: true })
      ],
      outputPorts: [
        outputPort("color", "Color", "color"),
        outputPort("alpha", "Alpha", "float")
      ],
      settings: [setting("parameterId", "Parameter", "string", "")]
    }
    ```

    `parameterId` is required and names the shader-graph texture
    parameter this node samples. The node never names a concrete
    `TextureDefinition` — concrete binding happens one level up
    (Material → shader parameter, or per-placement inline
    override → shader parameter). The node is a *reference*, not a
    value carrier.

  - **Shader-graph parameter list (`ShaderGraphParameter`)
    extension.** Today the parameter list is scalar-only
    (`float`, `color`, `vec3`). Grow it to a discriminated union
    that can also declare texture parameters:

    ```ts
    type ShaderGraphParameter =
      | { kind: "float"; parameterId; displayName; default: number }
      | { kind: "color"; parameterId; displayName; default: [number, number, number] }
      | { kind: "vec3"; parameterId; displayName; default: [number, number, number] }
      | {
          kind: "texture";
          parameterId;
          displayName;
          textureRole: "color" | "normal" | "data";
          // allows a shader graph to pin a built-in default texture
          // (e.g. the 1×1 neutral white used when no material is
          // bound); null means "fallback to runtime's default"
          default: { textureDefinitionId: string } | null;
        };
    ```

    `textureRole` is authoritative for sampler colorspace: `color`
    → sRGB decode on sample, `normal` → linear + two-channel
    reconstruction if we later ship BC5, `data` → raw linear. The
    node itself stays generic; role lives on the parameter
    declaration so the resolver can set up the correct
    `three.Texture.colorSpace` / sampler configuration when it
    binds the texture to the compiled material.

  - **One-shot migration of existing uses.** Every existing
    `{ nodeType: "input.material-texture", settings: {} }` in the
    current shader-graph module (15 call sites across Foliage
    Surface 1/2/3, the debug shaders, and friends) is rewritten
    to `settings: { parameterId: "baseColor" }`, and each affected
    shader graph's parameter list gains a
    `{ kind: "texture", parameterId: "baseColor", textureRole: "color", default: null }`
    entry. Because these graphs are code-defined defaults (not
    stored in project JSON), no saved-project migration is needed.
    Run the round-trip test after to confirm nothing still carries
    a `settings: {}` material-texture.

- `packages/domain/src/index.ts` — re-export the new types for
  downstream consumers.
- `packages/testing/` — content-library round-trip test: write a
  project with a `MaterialDefinition`, a `TextureDefinition`, and
  an `AssetDefinition` carrying a `MaterialSlotBinding`; load it
  back; assert structural equality including normalization. Add a
  second test covering the shader-graph node migration: parse all
  built-in graphs, assert zero `input.material-texture` nodes with
  empty `parameterId`, and assert each such node's `parameterId`
  resolves against its graph's parameter list (no dangling refs).

### 32.2 — Built-in `standard-pbr` shader graph

**Outcome:** New `mesh-surface` shader graph registered alongside
Foliage Surface 3 etc. Parameter list (declared using the extended
`ShaderGraphParameter` union from Story 32.1):

- `basecolor_texture` — `kind: "texture"`, `textureRole: "color"`,
  `default: null`
- `normal_texture` — `kind: "texture"`, `textureRole: "normal"`,
  `default: null`
- `orm_texture` — `kind: "texture"`, `textureRole: "data"`
  (Substance ORM pack: occlusion = R, roughness = G, metallic = B),
  `default: null`
- `tiling` — `kind: "vec3"` (xy used, z ignored),
  `default: [1, 1, 0]`
- `roughness_scale` — `kind: "float"`, `default: 1.0`
- `metallic_scale` — `kind: "float"`, `default: 0.0`

Graph wiring: three `input.material-texture` nodes, each keyed to
one of the texture parameters above, all fed the same `tiling`-scaled
UV (primary UV × `tiling.xy`). Standard PBR math feeds `colorNode` /
`emissiveNode` and the MeshStandardNodeMaterial's roughness / metallic
scalars (ORM green channel × `roughness_scale`; ORM blue channel ×
`metallic_scale`).

**Files touched:**
- `packages/domain/src/shader-graph/index.ts` — new
  `createDefaultStandardPbrShaderGraph`. Consumes the node contract
  and parameter union pinned in Story 32.1; does not redefine them.
- `packages/render-web/src/ShaderRuntime.ts` — resolve
  `input.material-texture` through the three-tier precedence chain
  (per-placement inline → Material binding → shader-graph parameter
  default), apply colorspace based on `textureRole` of the resolved
  parameter, and wire the result to the consumer node's color/alpha
  output ports.

### 32.3 — Texture import and library

**Outcome:** Studio can import a PNG/JPEG file as a `TextureDefinition`.
File is copied into `assets/textures/`, a definition is added to the
content library, it appears in a basic list. No separate workspace for
textures in v1 — they're accessed exclusively through the material
editor's texture picker. (A dedicated texture workspace is a reasonable
follow-up if the project grows.)

**Files touched:**
- `apps/studio/src/asset-sources/` — texture import extension or a
  sibling `texture-sources/` module, TBD at implementation time based
  on whether texture blob-URL management mirrors asset-source patterns.
- `packages/io/src/imports/index.ts` — new `importSourceTexture`
  routine, sibling to the existing `importSourceAsset` /
  `analyzeSourceAssetFile` functions that already live there. Reuses
  the same `FileSystemDirectoryHandle` + sanitized-filename plumbing
  so textures land under `assets/textures/` using the conventions
  already established for GLB imports.

### 32.4 — Material Library workspace

**Outcome:** New workspace under Build. Lists materials. Lets author
create a new material picking a parent shader, edit parameter values,
and assign textures. "Import PBR Texture Set" shortcut ingests a
Substance/Sugarbuilder-style export folder, infers map roles by
filename, and creates one material unit in one gesture.

**Files touched:**
- `packages/workspaces/src/build/materials/` — new workspace, mirroring
  `packages/workspaces/src/build/environment/` layout.
- `apps/studio/src/App.tsx` — workspace registration.
- Reuses the existing shader-parameter UI components for the editor.

### 32.5 — Landscape render-ownership cleanup (prework)

**Outcome:** Landscape mesh realization (Three geometry, TSL
MeshStandardNodeMaterial, GPU texture upload) moves out of
`packages/runtime-core/src/landscape/` and into
`packages/render-web/src/landscape/`. The pure data side
(descriptor, paint payload, channel definitions, the in-memory
`LandscapeSplatmap` byte-buffer model) stays in runtime-core. No
behavior change — this is a pure refactor to honor the one-way-
dependency rule before we extend the landscape rendering code in
Story 32.6.

This story exists because `packages/runtime-core/src/landscape/mesh.ts`
currently imports `three`, `three/webgpu`, and `three/tsl`, and
`createLandscapeSceneController` returns `THREE.Group`. The violation
predates 032 (landed with Plan 009) but 032's material-mode wiring
would extend the Three-dependent code; owning the move first lets the
rest of 032 claim "no boundary violations" honestly.

**Files touched:**
- Move `packages/runtime-core/src/landscape/mesh.ts` →
  `packages/render-web/src/landscape/mesh.ts`.
- Keep `packages/runtime-core/src/landscape/splatmap.ts` in
  runtime-core (pure byte-buffer logic), but move the
  `THREE.DataTexture` upload to the render-web mesh file so
  `splatmap.ts` no longer needs to touch Three.
- Move `createLandscapeSceneController` from
  `packages/runtime-core/src/landscape/index.ts` to
  `packages/render-web/src/landscape/index.ts`. Keep the descriptor
  / resolver functions (`resolveLandscapeDescriptor`,
  `resolveLandscapeDescriptorFromState`) in runtime-core.
- Update imports in `targets/web/src/runtimeHost.ts`,
  `packages/render-web/src/host/WebRenderHost.ts`, and
  `packages/testing/src/landscape-runtime.test.ts` to source
  `createLandscapeSceneController` from `@sugarmagic/render-web`.
- If the existing landscape-runtime test exercises Three material
  construction (it does), move or adapt it to run under a render-web
  test scope.
- Existing package-boundary check
  (`tooling/check-package-boundaries.mjs`) should pass after the
  move; if it doesn't already flag the current violation, tighten
  it so future regressions fail CI.

**Success criterion:** `rg "from \"three" packages/runtime-core` returns
no results. `rg "THREE\." packages/runtime-core` returns no results.

### 32.6 — Landscape channel material-mode rendering

**Outcome:** Author can select `mode: "material"` on a landscape
channel and pick a Material from the library. The landscape surface
renders with that material's basecolor, normal, and ORM textures,
tiled by the material's tiling parameters. Blends cleanly with
color-mode channels via existing splatmap weights. End-to-end:
Substance Designer → PBR textures → import → Material Library → bind
to channel → paint → see it in the viewport.

This is the **first-bite deliverable** that proves the architecture.

**Files touched (all in render-web now, post-32.5 move):**
- `packages/render-web/src/landscape/mesh.ts` — material-mode
  channel sampling, tiling, normal-map blend.
- `packages/render-web/src/` — material resolution for landscape.
- `packages/workspaces/src/build/landscape/` — channel inspector
  extension: MaterialDefinition picker when `mode === "material"`.

### 32.7 — Mesh material-slot binding on import

**Outcome:** GLB import creates `MaterialSlotBinding` entries keyed by
glTF material name. Reimport reconciles by name (existing bindings
preserved; renamed/removed slots drop bindings; new slots start
unset). Assets workspace gains a Materials panel listing the slots
with a picker per slot.

**Files touched:**
- `packages/io/src/imports/index.ts` — extend `importSourceAsset` (or
  its GLB analysis helpers `readGlbJsonChunk` /
  `analyzeSourceAssetFile`) to surface the source GLB's material-name
  list alongside the existing attribute and validation data it
  already returns. The downstream `AssetDefinition` construction
  reads that list and creates the initial `materialSlotBindings`.
- `packages/domain/src/content-library/index.ts` — reconciliation
  logic on reimport.
- `packages/workspaces/src/build/assets/` — Materials panel in asset
  inspector.

### 32.8 — Per-slot material application at render time

**Outcome:** When a mesh has multiple material slots and each is bound
to a different Material, each mesh section renders with its own
material's shader + parameters + textures. Previously deferred from
Plan 031; ships here.

**Files touched:**
- `packages/runtime-core/src/scene/` — resolver extension to return
  per-slot effective material.
- `packages/render-web/src/applyShaderToRenderable.ts` — iterate mesh
  sections, apply correct material per section.
- `packages/render-web/src/ShaderRuntime.ts` — `applyMaterial` entry
  point.

### 32.9 — Blender authoring doc + in-Studio naming guidance

**Outcome:** `docs/authoring/blender-material-slots.md` documents the
convention. FoilageMaker README adds a link. Studio shows a warning
in the Materials panel if a slot's name matches the positional default
`Material.00N` (Blender's auto-name), nudging authors to rename in
Blender before stabilizing the asset.

**Files touched:**
- `docs/authoring/blender-material-slots.md` (new).
- `tooling/foilagemaker/README.md` — cross-link.
- `packages/workspaces/src/build/assets/` — Materials panel warning.

### 32.10 — Scope expansion: shared authored-asset resolver boundary

**Status:** Added after the rest of the epic shipped, in response to
Preview-vs-editor-viewport rendering divergence that couldn't be
diagnosed or fixed without a proper boundary in place.

**Why this was needed.** The original epic stored `assetSources:
Record<string, string>` (relative path → blob URL) and threaded it
through every render-web call site. Each site independently did
`fileSources[path] ?? path` to resolve URLs, and ShaderRuntime and
`RuntimeLandscapeMesh` each kept their own `Map<string, three.Texture>`
cache keyed on `${definitionId}:${resolvedSource}:…`. Three cracks
surfaced:

1. **Silent URL fallback.** On a map miss both `ShaderRuntime.resolve-
   TextureBindings` and `RuntimeLandscapeMesh.loadExternalTexture`
   fell through to the raw relative path. That 404'd differently per
   page origin (Studio vs. Preview window vs. published build),
   producing "looks different in Preview vs. editor viewport" with
   zero logged root cause.
2. **Parallel texture caches.** The same `TextureDefinition` loaded
   through a mesh shader and through a landscape channel became two
   `three.Texture` instances. Any per-site configuration drift (wrap,
   repeat, colorspace at populate-time) turned into visible
   divergence.
3. **URL in the cache key.** Blob URL churn on the same
   `TextureDefinition` missed the cache even though the logical
   texture was unchanged.

**Outcome.** A single owned-by-`WebRenderHost` resolver replaces the
dumb map as the render-web boundary for authored-asset identity:

```ts
interface AuthoredAssetResolver {
  resolveAssetUrl(relativeAssetPath: string): string | null;
  resolveTextureDefinition(
    definition: TextureDefinition,
    options?: { repeatX?: number; repeatY?: number }
  ): three.Texture;
  sync(
    contentLibrary: ContentLibrarySnapshot | null,
    assetSources: Record<string, string>
  ): void;
  getContentLibrary(): ContentLibrarySnapshot | null;
  dispose(): void;
}
```

Contract:
- `resolveAssetUrl` returns `null` on miss — never the raw path.
  Callers surface explicit errors / magenta fallback meshes on null.
- `resolveTextureDefinition` caches by `(definitionId, repeatX,
  repeatY)`. Blob URL churn for the same definition triggers an
  in-place reload on the existing `three.Texture`, keeping GPU
  bindings and material caches stable.
- `sync` is the one mutation entry point. `WebRenderHost.apply-
  Environment` calls it before every downstream render pass; no inner
  code mutates resolver state.
- Content-library diff on `sync` evicts textures whose definitionId
  disappeared, so removed `TextureDefinition`s don't leak GPU memory.

Debug logging is rudimentary on purpose — every significant resolver
event (sync, cache miss, load start, load complete, url change,
eviction, url miss) prints a prefixed `[authored-asset-resolver]`
line through `console.debug` / `console.warn`. This is what the
engineer diagnosing Preview-vs-editor divergence reads to confirm
that a texture actually loaded from the URL they expected, in both
hosts.

**Files touched:**
- `packages/render-web/src/authoredAssetResolver.ts` — new module
  owning the resolver factory, texture cache, and placeholder /
  colorspace policy previously split between `authoredTexture.ts`
  and each caller's private cache.
- `packages/render-web/src/authoredTexture.ts` — deleted. Its
  `getOrCreateAuthoredTexture` was folded into the resolver's
  internal load path; keeping the old module around would have left
  a shadow boundary that could drift again.
- `packages/render-web/src/host/WebRenderHost.ts` — creates the
  resolver on host construction, exposes it on the public host
  interface (`host.assetResolver`), wires it into the shader
  runtime and landscape controller, and calls `assetResolver.sync`
  at the top of `runPendingEnvironment`. Disposes the resolver on
  unmount.
- `packages/render-web/src/ShaderRuntime.ts` — accepts an optional
  `assetResolver` in constructor options. When provided (the host
  case), the runtime consumes it for every texture resolution and
  never writes to it. When omitted (standalone / test case), the
  runtime constructs and owns a private resolver, syncing it from
  the `fileSources` arg on every `resolveTextureBindings` call for
  backward compat with direct ShaderRuntime callers.
- `packages/render-web/src/landscape/index.ts` —
  `createLandscapeSceneController` accepts an optional resolver
  (same ownership pattern as ShaderRuntime). `RuntimeLandscapeMesh`
  no longer owns an `externalTextureCache`; it asks the resolver.
- `packages/render-web/src/landscape/mesh.ts` — `loadExternalTexture`
  and `materialTextureForChannel` shed their `fileSources` params
  and route through the injected resolver.
- `packages/testing/src/shader-runtime-contract.test.ts` — one test
  re-targeted: the pre-refactor contract was "distinct finalized
  material on blob URL change" (because the old cache key included
  the URL). The new contract is "same finalized material across
  blob URL churn for the same TextureDefinition" — which is what
  actually makes Studio's frequent `useAssetSources` regenerations
  stop churning GPU state.

**Non-goals.**
- Changing the shape of `applyShaderToRenderable` /
  `ensureShaderSetAppliedToRenderable`. Those keep their
  `fileSources: Record<string, string>` signatures for caller
  ergonomics (both Studio's `authoringViewport` and
  `targets/web/runtimeHost` construct these maps at call time). The
  resolver sync has already happened upstream at
  `WebRenderHost.applyEnvironment` by the time these functions run,
  so the argument is harmless; state tracking still uses its
  reference identity as a quick change-detection hash.
- Converting GLB URL lookup sites to `assetResolver.resolveAssetUrl`.
  Those already short-circuit on `null` (never raw-path fallback), so
  they don't exhibit the silent-failure pathology. They remain simple
  `assetSources[path] ?? null` lookups for now; a future pass can
  route them through the resolver so the debug log sees GLB misses
  too.

**Success signal.** When a texture goes missing or diverges between
Studio and Preview, a developer can open DevTools, filter on
`[authored-asset-resolver]`, and read the actual load sequence for
that texture — sync timing, URL resolution, cache hits, load
completion. Previously that information didn't exist; divergence
could only be diagnosed by hypothesis-and-binary-search.

### 32.11 — Scope expansion: complete the `standard-pbr` shader graph + PBR fragment output

**Status:** Added after initial epic shipped, in response to mesh
material-slot rendering not working — a cube bound to a Material
built from a Substance PBR texture set rendered as if only basecolor
was wired, because the shader graph and the fragment output node
were both incomplete. This story completes the contract Story 32.2
specified but under-delivered on.

**Why this is needed.** Story 32.2 called for a `standard-pbr`
shader graph with three `input.material-texture` nodes (basecolor,
normal, ORM), tiling-scaled UVs, ORM channel splits feeding
roughness / metallic / AO, and the results wired into
`MeshStandardNodeMaterial`'s `colorNode` / `roughnessNode` /
`metalnessNode` / `aoNode` / `normalNode`. The implementation that
shipped has only one node in the graph (`basecolor-texture` →
`output.color`, `output.alpha`). The other five texture parameters
are declared but never consumed.

Root cause is not laziness — the shader graph system itself is
missing the plumbing:

1. `output.fragment` (packages/domain/src/shader-graph/index.ts:836)
   exposes only `color` and `alpha` input ports. There is no legal
   way to say "here is my normal / roughness / metallic / AO" in a
   graph, so even if standard-pbr had three material-texture nodes,
   their outputs would have nowhere to go.
2. `input.material-texture` outputs only `color` (vec3) and `alpha`
   (float). ORM channel splits (`.g` → roughness, `.b` → metallic,
   `.r` → AO) are not expressible because there are no per-channel
   output ports on material-texture and no `math.channel` /
   `math.swizzle` node.
3. The IR compiler (`runtime-core/shader/compiler.ts`) and
   `ShaderRuntime.applyIRToMaterial` only handle color / alpha
   outputs. Even if the graph could declare extra outputs, the
   runtime would not wire them onto the material.

Because these three pieces are missing, the engineer who tried to
ship Story 32.2 had no path to a full PBR graph. Landscape
material-mode rendering (Story 32.6) shipped by hand-rolling the
full PBR TSL in `packages/render-web/src/landscape/mesh.ts:rebuild-
MaterialNodes` directly against `MeshStandardNodeMaterial`,
bypassing the graph system entirely. That parallel implementation
is why landscape material-mode works and mesh material-mode does
not — see Story 32.12 for the architectural consequence of that
divergence.

**Outcome.** `standard-pbr` becomes a real PBR shader graph,
consumed through the same `ShaderRuntime.applyShaderSet` path as
every other mesh-surface shader. A cube with a material slot bound
to a PBR-texture-set Material renders with basecolor + normal
mapping + ORM-driven roughness/metalness/AO, with the Material's
tiling applied, all driven by the graph.

**Files touched:**

- `packages/domain/src/shader-graph/index.ts`:
  - Extend `output.fragment` input ports with optional `normal`
    (vec3), `roughness` (float), `metalness` (float), `ao` (float).
    Defaults match `MeshStandardNodeMaterial`'s unconfigured values
    (normal = `vec3(0, 0, 1)` in tangent space, roughness = 1.0,
    metalness = 0.0, ao = 1.0). Color + alpha remain as-is.
  - Extend `input.material-texture` output ports with `r` (float),
    `g` (float), `b` (float), `a` (float) alongside existing
    `color` (vec3) and `alpha` (float). This is what makes ORM
    channel splits expressible without a separate swizzle node.
  - Rewrite `createDefaultStandardPbrShaderGraph` to the Story 32.2
    spec: three material-texture nodes keyed to `basecolor_texture`,
    `normal_texture`, `orm_texture`. A tiling-multiply node on UV
    (UV × `tiling.xy`) feeding each material-texture's `uv` input.
    Scalar multiplies: `orm.g × roughness_scale` →
    `output.fragment.roughness`; `orm.b × metallic_scale` →
    `output.fragment.metalness`; `orm.r` → `output.fragment.ao`.
    Normal: `normal_texture.color` → `output.fragment.normal` (the
    `normalMap()` tangent-to-world wrapping is applied by the
    runtime, not authored in the graph — see the runtime change
    below). Basecolor: `basecolor_texture.color` →
    `output.fragment.color`; `basecolor_texture.alpha` →
    `output.fragment.alpha`.

- `packages/runtime-core/src/shader/compiler.ts`:
  - Emit additional output ports in the IR for `output.fragment`
    when its `normal` / `roughness` / `metalness` / `ao` inputs are
    wired. Defaults flow through when those inputs are unwired so
    existing single-color graphs (Foliage Surface 1/2/3 etc.)
    continue to compile cleanly.

- `packages/render-web/src/ShaderRuntime.ts`:
  - Update `applyIRToMaterial` to wire the IR's new outputs onto
    the target material:
      `roughness` → `material.roughnessNode`
      `metalness` → `material.metalnessNode`
      `ao` → `material.aoNode`
      `normal` → `material.normalNode = normalMap(normalIrNode)`
    The `normalMap()` wrapping lives here (not in the graph)
    because it's a runtime concern tied to tangent-frame
    reconstruction, which graph authors shouldn't need to author by
    hand. The same wrapping is what landscape's hand-rolled code
    currently uses.
  - `sampleMaterialTextureNode` already handles the `parameterId`
    routing correctly (Story 32.1 node contract). The only runtime
    change for material-texture is adding the four new per-channel
    outputs in the IR-to-TSL translation: `r` = `sample.r`, etc.

- `packages/testing/src/`:
  - Extend `material-resolution.test.ts` to assert that all six
    texture parameters (basecolor, normal, ORM, roughness,
    metallic, AO) are in the effective binding's `textureBindings`.
  - New `standard-pbr-graph.test.ts`: compile the default
    `standard-pbr` graph, assert the IR contains outputs for color,
    alpha, normal, roughness, metalness, ao, each traceable back to
    the expected source node.
  - Add a shader-runtime test asserting `applyShaderSet` against a
    Material with an ORM texture binding produces a
    `MeshStandardNodeMaterial` with non-null `roughnessNode` /
    `metalnessNode` / `aoNode` / `normalNode`.

**Non-goals.**

- Collapsing the landscape path onto this graph. That's Story 32.12;
  this story lands the graph and the mesh path first so the graph
  is proven before landscape adopts it.
- Adding emissive / subsurface / clearcoat / sheen. Story 32.2's
  scope is color, alpha, normal, roughness, metalness, AO; extras
  are follow-up stories when an author actually asks for them.
- Authoring-time UV transform nodes beyond scalar tiling. The
  `tiling` parameter multiplies primary UV; a future story can add
  rotation / offset / second UV set if needed.

**Success criterion.** Substance Designer → folder of PBR PNGs →
"Import PBR Texture Set" in the Material Library → bind the
resulting Material to a mesh slot → viewport renders the cube (or
whatever mesh) with the textures sampled, normal-mapped,
ORM-driven roughness/metallic/AO visible under different lighting.
PBR-folder-to-Material import flow (Story 32.4 + Sugarbuilder
parity) is preserved and starts rendering correctly end-to-end.

### 32.12 — Scope expansion: collapse landscape hand-rolled TSL into the shader graph system

**Status:** Added after Story 32.11. Depends on 32.11 landing first.

**Why this is needed.** Story 32.6 shipped landscape material-mode
rendering by hand-rolling the full PBR TSL against
`MeshStandardNodeMaterial` directly in
`packages/render-web/src/landscape/mesh.ts:rebuildMaterialNodes`.
That code re-implements the same basecolor / normal / ORM
splitting / tiling / scalar multiply math that the `standard-pbr`
shader graph is supposed to own, but divorced from the graph
system. Consequences:

1. **Two PBR implementations coexist.** Fixing a bug in one does
   not fix the other. Today they differ in reality: the hand-rolled
   landscape version is correct; the graph version (pre-32.11) is
   a one-node stub. Even after 32.11 closes the gap, drift risk is
   permanent while two implementations exist.
2. **The epic's core thesis — "Material = shader graph + parameter
   snapshot, one rendering math" — is violated.** Landscape channels
   bind Materials that reference `standard-pbr`, but the landscape
   render code ignores that shader reference entirely and runs its
   own math.
3. **Author-authored alternatives to `standard-pbr` cannot be used
   on landscape.** If a user authors a new shader graph (stylized
   ground, wet surface, whatever) and wraps it in a Material, mesh
   slots can bind it, but landscape channels will silently render
   the hardcoded PBR math regardless of which shader the Material
   references.

**Outcome.** One PBR implementation. Landscape channels and mesh
surfaces both evaluate their bound Material's shader graph through
the same code path. A new shader graph authored for ground
surfaces (say "stylized-ground") can be bound to a landscape
channel and render exactly as authored, not as overridden by the
landscape layer.

**The architectural challenge.** Landscape cannot literally call
`shaderRuntime.applyShaderSet` N times on the same
`MeshStandardNodeMaterial` — that would replace the material's
nodes N times, not blend them. Landscape needs all N channels'
PBR outputs evaluated per-pixel and blended by splatmap weights
inside a single compiled shader. The shape that makes this work:

- Extract a helper that takes an `EffectiveShaderBinding` + a
  resolver + a UV node and returns
  `{ colorNode, alphaNode, normalNode, roughnessNode, metalnessNode, aoNode }`
  — the set of TSL nodes a compiled shader emits. This is what
  `ShaderRuntime.applyIRToMaterial` already conceptually produces
  internally; the Story 32.12 work is extracting it into a reusable
  function so it can be invoked without a target material.
- Mesh-surface path (`applyIRToMaterial` today) calls this helper
  once per mesh slot and writes the result onto the target
  `MeshStandardNodeMaterial`. No behavior change.
- Landscape path calls this helper N times (once per channel's
  Material binding), then blends the N result sets per-pixel using
  splatmap weights: `colorNode = Σᵢ (channelᵢ.colorNode × weightᵢ)`,
  and similarly for the scalar and vector outputs. This is the same
  weighted sum the current hand-rolled code does; what changes is
  that the per-channel PBR evaluation now comes from the shader
  graph, not from hand-rolled TSL.

**Files touched:**

- `packages/render-web/src/ShaderRuntime.ts`:
  - Extract a new exported function `evaluateShaderBindingToSurfaceNodes(
    binding, { assetResolver, geometry, uvNode })` that returns
    `{ colorNode, alphaNode, normalNode, roughnessNode, metalnessNode, aoNode }`.
    This is `applyIRToMaterial`'s TSL-production innards without
    the "and now write it onto a target material" step.
  - `applyIRToMaterial` becomes a thin wrapper: call
    `evaluateShaderBindingToSurfaceNodes`, then assign its outputs
    onto the target material. No external behavior change for mesh
    surfaces.

- `packages/render-web/src/landscape/mesh.ts`:
  - Delete the hand-rolled PBR TSL in `rebuildMaterialNodes` (the
    per-channel basecolor/normal/ORM sampling, channel splits,
    scalar multiplies).
  - For each landscape channel whose mode is `"material"`: resolve
    the Material's `EffectiveShaderBinding` (the same one
    `resolveMaterialSurfaceBinding` in runtime-core already
    produces), call `evaluateShaderBindingToSurfaceNodes` with a
    channel-specific UV node (tiling-scaled world UV).
  - For each channel whose mode is `"color"`: synthesize a
    constant-color binding equivalent (no shader graph needed;
    wire color directly, default the PBR scalars). Could also be
    expressed as a built-in "flat-color" shader graph if we want
    zero exceptions.
  - Blend the N channels' surface-node sets with splatmap weights
    and assign to the landscape's `MeshStandardNodeMaterial`.
  - Material dependency tracking: if any of the bound Materials'
    shader graph revisions change, re-evaluate. ShaderRuntime's
    existing `invalidate(shaderDefinitionId)` hook is the right
    signal to listen for.

- `packages/runtime-core/src/landscape/`:
  - No changes expected. The pure data types (landscape channel
    definitions, splatmap math) already produce the right shape.

- `packages/testing/`:
  - New test: `landscape-standard-pbr-parity.test.ts` — assert the
    compiled landscape material's nodes are equivalent between the
    old hand-rolled path (frozen snapshot) and the new graph-driven
    path, for a single-channel material-mode landscape. Catches
    drift between 32.11 PBR semantics and the landscape collapse.
  - Extend `landscape-runtime.test.ts`: multi-channel material-mode
    landscape renders with expected blended results.

**Non-goals.**

- Per-channel UV set selection. All channels use the primary
  world-projected UV as today. Secondary UVs for landscape can be
  a future story.
- Custom shader graphs per channel. Landscape still assumes the
  Material's shader graph is compatible with mesh-surface target
  kind (i.e. outputs the standard PBR surface set). Stylized
  channel shaders with different outputs (emissive ground, etc.)
  are follow-ups.
- Blending strategy changes. The current splatmap-weighted sum is
  preserved. Reoriented Normal Mapping / partial-derivative normal
  blending can be a future improvement; 32.12 is about moving the
  existing math through the graph system, not changing the math.

**Success criterion.** Deleting
`packages/render-web/src/landscape/mesh.ts:rebuildMaterialNodes`'s
hand-rolled PBR TSL and replacing it with graph evaluation
produces visually identical landscape rendering (same textures,
same normal mapping, same tiling, same lighting response) as the
pre-32.12 hand-rolled path. A landscape channel bound to a
non-`standard-pbr` shader graph (once such a graph exists) renders
that graph's math, not PBR math.

## Success criteria

- **Substance Designer → landscape works end-to-end.** Export a three-
  texture PBR set from Substance, import into Studio, create a
  Material bound to `standard-pbr`, bind to a landscape channel,
  paint, see the tiled textured ground in both the authoring viewport
  and the game preview with no divergence.
- **Materials are reusable across channels.** One "Forest Dirt"
  material can be bound to the base channel of two different regions.
  Editing it updates both.
- **Imported GLBs surface their material slots by name.** A two-slot
  GLB ("Bark", "Leaves") lands as an asset with two slot rows in the
  inspector. Binding "Bark" to one material and "Leaves" to another
  causes each mesh section to render with its own material.
- **Reimport is stable.** Re-importing the same GLB with unchanged
  Blender material names preserves every slot binding. Renaming one
  material in Blender drops that one slot's binding; the others
  survive.
- **No boundary violations.** `runtime-core` remains free of Three
  imports; `render-web` is the only package binding materials to GPU.
- **Existing foliage trees keep rendering unchanged.** The migration
  path leaves every 0.17.x-era foliage asset rendering exactly as it
  does today. Author opt-in to promote inline overrides → Material.

## Risks and open questions

- **Normal-map blending math on landscape.** Summing tangent-space
  normals weighted by splatmap is well-known but easy to get subtly
  wrong (reoriented-normal-mapping vs. partial-derivative blending
  etc.). Landscape story should budget time to reference a known-good
  blend formula rather than hand-roll.
- **Texture streaming / memory.** v1 loads every texture into GPU
  memory at scene boot. Fine for the current project scale; revisit
  when a region's texture set exceeds comfortable VRAM.
- **Material rename surfaces.** Renaming a Material in the library
  should propagate — material bindings reference by id, not name, so
  renames are safe, but the UI needs to show the new name everywhere
  (landscape channel picker, asset slot picker). Confirm no stale
  name cached at view time.
- **Thumbnail rendering.** The library without thumbnails is going
  to age badly past ~20 materials. Budget a polish story post-MVP.
- **Foliage Surface 3 → Material?** Once this system exists, it'll be
  tempting to promote every per-asset shader binding into Materials.
  Don't do it reflexively; only when an author hits the reuse wall.
  Inline overrides exist for a reason.
