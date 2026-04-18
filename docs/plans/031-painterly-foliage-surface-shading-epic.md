# Plan 031: Painterly Foliage Surface Shading Epic

**Status:** Implemented
**Date:** 2026-04-16

## Epic

### Title

Ship an authored `foliage-surface` shader that consumes the data Blender's
FoilageMaker already exports — leaf textures, per-vertex canopy tint, sun-
exterior bias, custom normals — and produces the warm, painterly, sun-lit
stylized trees the target reference uses. Extend the shader binding model so
surface and deform shaders can coexist on one asset, without replacing the
authored material's texture.

### Goal

Three product outcomes, in priority order:

1. **The imported tree looks authored.** Leaf sprite texture renders. Per-
   cluster canopy tint variation reads clearly. Sun-hit leaves get warm
   highlights; interior leaves stay cool. Match Blender's visual intent.
2. **Foliage surface and foliage wind coexist on the same asset.** The
   shader binding model supports a surface shader plus a deform shader
   applied to the same mesh, so foliage can be both textured and animated.
3. **Foliage assets pick up the painterly surface by default.** New imports
   get `foliage-surface` wired automatically — no per-asset setup required.

One architectural outcome:

- **Shader binding model grows from "one shader per asset" to "one surface
  shader + one deform shader per asset."** Current `resolveBindingForOwner`
  returns a single `EffectiveShaderBinding`; this epic extends it to return
  a structured `EffectiveShaderBindingSet` with distinct surface and deform
  slots. Post-process remains separate (per-environment, already distinct).

### Why this epic exists

Plan 028 stories 28.1–28.5 shipped: Blender authoring, procedural trees,
export, import. Stories 28.6 (runtime optimization — LOD, billboard handoff,
instancing) and 28.7 (forest-scale verification) remain open but are **not
blocked by this epic** — they'll ship separately once the visual baseline
is right. Shipping LOD for trees that look wrong is the wrong ordering.

Plan 029 shipped the shader graph pipeline, including `foliage-wind` as a
`mesh-deform` shader. It deforms vertices for wind sway but has no fragment
output, which silently orphans the authored GLB texture when applied to a
foliage asset. The current imported-tree rendering shows uniform green leaves
with no texture detail because the leaf sprite never reaches the fragment
shader.

Plan 030 shipped environment lighting, shadows, and the authored post-process
stack. It gets the lighting and atmosphere right, but a well-lit
texture-less tree still reads as generic. The surface shader is the piece
that makes the tree look *authored* rather than primitive.

The Blender exporter encodes exactly the data this epic's shader consumes.
Nothing in the authoring pipeline needs to change; only the runtime shader.

### Core thesis

We've been describing this as "two problems" (texture orphaning + painterly
look) but it's one: **the runtime has no shader that reads what Blender
writes.** Ship that shader, wire it as the default for foliage assets, and
both problems resolve together.

## Scope

### In scope

- **First-class shader slot typing.** `ShaderSlotKind`,
  `SHADER_SLOT_KINDS`, `SHADER_SLOT_TARGET_KINDS`, and
  `EffectiveShaderBindingSet` defined in `packages/runtime-core/src/shader/bindings.ts`.
  Slot assignment enforces `targetKind` matching at resolution time — a
  `mesh-deform` graph cannot be bound to a surface slot. Slot kind is a
  closed enum; adding a new slot is a deliberate architectural change.
  See *Architecture rework > Shader slots — first-class concept* for the
  canonical type definitions.
- **Shader binding model: two-binding per asset** via the slot set.
  Resolution runs through runtime-core; finalization applies both slots
  independently. Existing `applyShaderToRenderable` paths migrate through
  the singular-binding shim in Story 1.
- **Built-in `foliage-surface` shader graph** (target `mesh-surface`) that:
  - Samples the GLB's authored leaf texture via `UVMap` (`TEXCOORD_0`)
  - Multiplies by vertex-color RGB (`canopy_tint_gradient`) for per-cluster
    hue variation
  - Uses vertex-color alpha (`sun_exterior_bias`) to drive a warm
    fake-subsurface term on sun-hit leaves (additive warm tint on exterior
    canopy faces)
  - Uses view-direction fresnel for backlit-leaf translucency (brighter when
    viewing a leaf against the sun)
  - Outputs to `colorNode` as the fragment's base color
- **Default binding wiring.** When `resolveBindingForOwner` sees an asset
  with `assetKind: "foliage"` and no explicit surface override, it returns
  `foliage-surface` as the surface slot; `foliage-wind` remains the deform-
  slot default.
- **Node registry additions** required by the new shader:
  - `input.material-texture` — samples the currently-bound material's
    `baseColorTexture` via UVs. This is the node that fixes the orphaning.
  - `input.view-direction-world` — already exists as `viewDirection`;
    confirm it's wired for `mesh-surface` targets.
  - `math.fresnel` or equivalent — 1 − NdotV raised to a power. May already
    exist as `effect.fresnel`; verify target validity for `mesh-surface`.
- **Shader runtime changes** to thread both slots through finalization:
  - `ShaderRuntime.applyShaderSet(set, target)` replaces or wraps the
    current `applyShader`. Surface and deform IR cache and compile
    independently; both write into the same `MeshStandardNodeMaterial`
    instance (`colorNode` from surface, `positionNode` from deform).
- **Migration path** for existing documents: if an asset's current
  `defaultShaderDefinitionId` points at `foliage-wind`, migrate it into the
  *deform* slot and leave the surface slot unset (defaults to
  `foliage-surface`). No user-visible disruption; saved foliage assets keep
  working.
- **Texture sampler ShaderRuntime finalizer support.** The
  `input.material-texture` node realizes to a TSL texture sampler bound to
  the input material's `.map`. ShaderRuntime caches the sampler node per
  material (same cache-and-mutate pattern as bloom) so texture swaps
  propagate live without recompilation.
- **Sun direction threading via `input.sun-direction` node.**
  Adds the node to the registry (valid for `mesh-surface` and
  `mesh-deform`), exposes `ShaderRuntime.setSunDirection(dir)` for hosts
  to push the environment's authored sun direction, and wires
  `EnvironmentSceneController` to call it alongside `applySunLight`.
  Finalizes as a cached uniform node with in-place `.value` updates.
- **HDR color picker UI.** Extends `ColorField` (or adds an `HDRColorField`
  alternate) to show per-channel numeric inputs (0..4 range) when the
  associated `ShaderParameter.colorSpace === "hdr"`. `ShaderParameter`
  gains the optional `colorSpace` field. `foliage-surface`'s `warmColor`
  and `rimColor` declare `"hdr"`; all other existing color parameters
  default to `"sdr"` (unchanged behavior).
- **Shader-slot inspector UI component.** A reusable
  `ShaderSlotEditor` component under `packages/ui` (or `packages/workspaces`
  shared components) that renders one row per slot kind. Each row shows:
  - slot kind label (Surface / Deform)
  - the currently-bound shader's display name (from its
    `ShaderGraphDocument.displayName`), or "None" / preset-default label
  - a dropdown to swap the shader (sourced from
    `contentLibrary.shaderDefinitions` filtered to the slot's
    `SHADER_SLOT_TARGET_KINDS[slot]` target kind)
  - an **"Edit shader graph" link-button** that navigates to the Render
    product mode's shader graph editor with the bound shader open
  - inline parameter overrides for the slot's bound shader, reusing the
    existing `PostProcessParameterField` pattern from the Plan 030 stack
    editor
  The component gets used wherever asset-level shader binding is authored:
  the Build-mode asset inspector, placed-asset inspector, and NPC/item
  presence inspectors. It is the standard UI for all shader-slot authoring.
- **Trunk vs. leaves handling (v1 resolution).** The foliage-surface
  shader is applied to the full foliage mesh — both trunk and leaves. The
  current pipeline has no material-slot / mesh-part masking, so per-
  sub-mesh shader application is out of scope. Trunks will render using
  the same shader graph as leaves; practical impact is minor because
  bark's `sun_exterior_bias` vertex alpha is 0 (the warm-subsurface
  highlight only fires on leaf-marked vertices). Trunk texture still
  samples via `input.material-texture`. A future material-slot masking
  story is deferred.

### Out of scope (explicitly)

- **PBR surface shader for non-foliage assets** (rocks, buildings). Valid
  follow-up (Plan 032?), but foliage is what's driving the current visual
  gap. Other asset kinds keep their current shader resolution.
- **Substance texture-set import.** Foliage already ships its texture
  embedded in the GLB; non-foliage Substance-authored asset import is a
  larger separate concern.
- **Wind-foliage interaction polish.** The existing `foliage-wind` keeps
  working in the deform slot. Tuning its sway feel, gust patterns, or
  per-asset wind-metadata consumption is not part of this epic. When this
  epic ships, wind plus painterly surface will Just Work because of the
  two-binding model.
- **Plan 028 stories 28.6 / 28.7** — runtime foliage optimization (LOD,
  billboard handoff, instancing) and forest-scale verification. Separate
  follow-up. Visual quality first; scale later.
- **Per-instance seed-driven variation beyond vertex colors.** The canopy
  tint gradient already varies per-vertex from the Blender authoring; that's
  enough for v1. Per-instance random hue offsets (same asset placed twice,
  two slightly different hues) are deferred.
- **Leaf animation curls or detail-normal variation.** The custom normals
  the Blender side already emits drive enough soft shading for the target
  look. Extra detail-normal maps are a nice-to-have.

## Architecture rework

### Shader slots — first-class concept

A **shader slot** is a named, typed channel on a rendered asset into which
at most one authored shader can be bound. Slots are orthogonal: a single
asset can have one shader per slot, each operating on a different stage of
the material pipeline (vertex position vs. fragment color, today; more in
the future). The slot set is a closed, versioned enum — not an ad-hoc
string — so the resolver, the runtime finalizer, the command system, and
the UI all reference the same canonical list.

```typescript
// packages/runtime-core/src/shader/bindings.ts (new, canonical definition)

/**
 * Canonical list of shader slots an asset can occupy. Extending this is a
 * deliberate, architectural act — adding a slot means adding a new
 * independently-resolvable shader channel, with matching support in the
 * resolver, the ShaderRuntime finalizer, the command system, and the
 * inspector UI. It is NOT a place to stash ad-hoc shader categories.
 *
 * Keep this narrow. Today: surface (fragment) and deform (vertex). If a
 * future need arises (e.g., emissive-only, shadow-only), it gets
 * considered here first, not added opportunistically.
 */
export type ShaderSlotKind = "surface" | "deform";

export const SHADER_SLOT_KINDS: readonly ShaderSlotKind[] = [
  "surface",
  "deform"
] as const;

/**
 * A populated slot: the kind, the shader target it accepts, and the
 * binding itself. The targetKind constraint is the compile-time contract
 * between the slot and the shader graph's `targetKind` field — a slot
 * only accepts shaders whose `targetKind` matches SHADER_SLOT_TARGET_KINDS.
 */
export interface ShaderSlotBinding {
  readonly slotKind: ShaderSlotKind;
  readonly binding: EffectiveShaderBinding;
}

/**
 * Each slot maps to exactly one shader graph `targetKind`. A graph
 * authored as `mesh-surface` can only occupy a surface slot; a
 * `mesh-deform` graph can only occupy a deform slot. This is enforced at
 * resolution time (resolveEffectiveAssetShaderBindings rejects slot
 * assignments whose targetKind disagrees).
 */
export const SHADER_SLOT_TARGET_KINDS: Record<
  ShaderSlotKind,
  ShaderGraphDocument["targetKind"]
> = {
  surface: "mesh-surface",
  deform: "mesh-deform"
};

/**
 * The full slot assignment for an asset. Missing slots resolve to null —
 * the asset uses its native material behavior for that stage.
 */
export type EffectiveShaderBindingSet = {
  readonly [K in ShaderSlotKind]: EffectiveShaderBinding | null;
};
```

Why this matters: currently the codebase has informal distinctions like
"mesh-deform shaders go here, mesh-surface shaders go there, billboard-
surface shaders go somewhere else." Making slots a typed concept with a
closed enum and a per-slot target-kind mapping means the compiler catches
misuse. A `mesh-deform` graph cannot accidentally be assigned to a surface
slot; a new slot cannot be invented without touching the canonical list
and every consumer.

Billboard-surface remains its own render path (billboards don't participate
in the two-binding slot set — they're handled by the billboard system, not
the mesh-surface pipeline). Post-process bindings are per-environment and
not slots on assets. Both are deliberately excluded from `ShaderSlotKind`.

### Current flow

```
asset (foliage) + content library
      │
      ▼
resolveBindingForOwner → single EffectiveShaderBinding (foliage-wind)
      │
      ▼
applyShaderToRenderable → ShaderRuntime.applyShader
      │
      ▼
material.positionNode = wind displacement
material.colorNode    = (not set — orphans the authored texture)
```

### Target flow

```
asset (foliage) + content library
      │
      ▼
resolveBindingsForOwner → EffectiveShaderBindingSet
  surface: EffectiveShaderBinding (foliage-surface)
  deform:  EffectiveShaderBinding (foliage-wind)
      │
      ▼
applyShaderToRenderable → ShaderRuntime.applyShaderSet
      │
      ▼
material.positionNode = wind displacement       (from deform slot)
material.colorNode    = textured + tinted color (from surface slot)
```

### Binding override precedence (unchanged in principle, extended per slot)

For each slot independently:
1. Per-instance `shaderOverride` on the `PlacedAssetInstance` / presence
2. Per-asset `defaultShaderDefinitionId`
3. `assetKind`-driven default (`foliage-surface` for surface slot on foliage
   assets, `foliage-wind` for deform slot)
4. No binding (leave the material's native surface / no deform)

Either slot can be null. A foliage asset with `shaderOverride` pointing at
`:built-in:foliage-surface` with the deform slot unset = textured tree, no
wind — a valid authored choice.

## Domain contract changes

Additive. Nothing existing breaks.

The slot types (`ShaderSlotKind`, `SHADER_SLOT_KINDS`,
`SHADER_SLOT_TARGET_KINDS`, `EffectiveShaderBindingSet`) are defined in
`packages/runtime-core/src/shader/bindings.ts` as shown in the
*Architecture rework > Shader slots — first-class concept* section above.
They are exported from runtime-core and consumed by render-web, domain
commands, and the workspaces UI.

Resolver signatures:

```typescript
export function resolveEffectiveAssetShaderBindings(
  asset: PlacedAssetInstance,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBindingSet;

export function resolveEffectivePresenceShaderBindings(
  presence: Pick<
    RegionNPCPresence | RegionItemPresence,
    "shaderOverride" | "shaderParameterOverrides"
  >,
  assetDefinition: AssetDefinition | null,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBindingSet;

// Existing singular resolvers route to set.surface ?? set.deform with a
// deprecation comment. Removed in Story 6.
```

Per-asset shader override shape grows to support per-slot overrides.
`slot` is a required field on new `AssetShaderOverride` entries; migration
handles pre-existing records.

```typescript
// packages/domain/src/region-authoring/index.ts (existing shape, extended)
import type { ShaderSlotKind } from "@sugarmagic/runtime-core";

export interface AssetShaderOverride {
  shaderDefinitionId: string;
  slot: ShaderSlotKind;
}
```

Saved documents with existing `shaderOverride` entries (no `slot`) migrate
at `normalizeContentLibrarySnapshot` time:
- `shaderOverride.shaderDefinitionId` resolves to a shader whose
  `targetKind === "mesh-deform"` → `slot: "deform"`
- otherwise → `slot: "surface"`

### Sun direction threading

The `foliage-surface` shader needs the scene's sun direction to compute
sun-bias highlights. Sun direction is authored per-environment on
`EnvironmentDefinition.lighting.sun` (azimuth + elevation). Rather than
sampling a scene-global TSL uniform opaquely, the shader reads it via a
dedicated built-in input node:

```typescript
// In the shader graph node registry:
//   nodeType: "input.sun-direction"
//   outputs:  { value: "vec3" } — world-space unit vector
```

Realization: `ShaderRuntime` exposes a `setSunDirection(dir: Vector3)`
method. `EnvironmentSceneController` calls it each time it applies a new
environment (same lifecycle as `applySunLight`). The sun-direction node
finalizes to a cached uniform node whose `.value` gets updated in place,
so live-editing the sun azimuth updates the foliage shading without
recompilation — same cache-and-mutate pattern as bloom and parameters.

This is cheaper than reconstructing the direction from view-space math,
authored-explicit about the dependency, and matches the "authored world
state flows through explicit nodes" architecture the shader pipeline
already established.

### HDR color picker UI

The `foliage-surface` shader's `warmColor` and `rimColor` parameters
intentionally use HDR values (individual channels above 1.0) to produce
the bright warm glow the reference requires. The current `ColorField`
component clamps to 0..1 via a 24-bit hex encoding — insufficient.

This epic extends `ColorField` to support an HDR mode driven by parameter
metadata:

- New `ShaderParameter` field: `colorSpace?: "sdr" | "hdr"` (defaults to
  `"sdr"`). When `"hdr"`, the picker shows three per-channel numeric
  inputs (0..4 each) instead of the hex-picker popover. The hex-picker
  popover remains available as a secondary mode for SDR-compatible tuning.
- `foliage-surface` parameters declare `colorSpace: "hdr"` for `warmColor`
  and `rimColor`. Other color parameters (scene color grade, vignette
  tint, etc.) keep `"sdr"` by default.
- `vec3ToColorNumber` / `colorNumberToVec3` stop clamping in HDR mode;
  the underlying `ShaderParameterValue` storage (`[number, number, number]`)
  already supports out-of-range values — only the UI was clamping.

This unblocks HDR color authoring for any future shader that needs it.

## Stories

### Story 1: Two-binding shader model in runtime-core

**Goal.** Replace the single-binding contract with a slot-based set. No
render changes yet; everything still compiles and runs.

**Tasks.**

- Add the canonical slot types to `packages/runtime-core/src/shader/bindings.ts`:
  - `ShaderSlotKind` — closed enum union (`"surface" | "deform"`).
  - `SHADER_SLOT_KINDS` — readonly tuple matching the enum, usable for
    iteration.
  - `SHADER_SLOT_TARGET_KINDS` — `Record<ShaderSlotKind, ShaderGraphDocument["targetKind"]>`
    mapping each slot to its accepted target kind.
  - `EffectiveShaderBindingSet` — the full slot assignment type.
  - `ShaderSlotBinding` — the populated-slot shape (slot kind +
    binding), used where code needs to iterate slots generically.
  Each type gets a tsdoc comment explaining what it is and the rule for
  adding new slots (a deliberate architectural act, not opportunistic).
- Add `resolveEffectiveAssetShaderBindings` and
  `resolveEffectivePresenceShaderBindings` that return sets.
- Internally, the new resolvers call the same `resolveBindingForOwner`
  primitive once per slot in `SHADER_SLOT_KINDS`, with slot-specific
  defaults:
  - Surface slot default for foliage assets: `foliage-surface` (once
    Story 3 ships it; until then, surface slot for foliage is null)
  - Surface slot default for non-foliage assets: null
  - Deform slot default for foliage assets: `foliage-wind`
  - Deform slot default for non-foliage assets: null
- Enforce `targetKind` matching: if a shader override points at a graph
  whose `targetKind !== SHADER_SLOT_TARGET_KINDS[slot]`, the resolver
  returns null for that slot and pushes an error diagnostic that surfaces
  in authoring. Fail loud, matches Plan 029's "compilation errors must
  throw" contract for authoring.
- Keep `resolveEffectiveAssetShaderBinding` (singular) for one turn of
  callers, routing it to `set.surface ?? set.deform` with a deprecation
  comment. Delete in Story 6 once all callers migrate.

**Acceptance.**

- TypeScript checks confirm that an `AssetShaderOverride` with
  `slot: "surface"` pointing at a `mesh-deform` shader is catchable as a
  runtime diagnostic at resolve time (not a silent mis-bind).
- Unit tests (`shader-runtime-contract.test.ts`): a foliage asset with no
  overrides resolves to `{ surface: foliage-surface, deform: foliage-wind }`
  once Story 3's shader ships (surface-null until then, still with
  deform=foliage-wind). A foliage asset with a surface override resolves
  that override in the surface slot and retains the deform default. A
  non-foliage asset resolves to `{ surface: null, deform: null }`. An
  override whose shader's targetKind doesn't match the slot produces a
  diagnostic, and the slot resolves to null.
- No render changes yet; the existing pipeline continues to work via the
  singular-binding shim.

---

### Story 2: Node registry additions (material texture + sun direction + helpers)

**Goal.** Add the `input.material-texture` node that fixes the core
orphaning bug, the `input.sun-direction` node that threads authored sun
direction into the shader, plus any missing helpers the painterly shader
needs.

**Tasks.**

- Add `input.material-texture` to `SHADER_NODE_DEFINITIONS`. Takes an
  optional UV port (defaults to the mesh's `TEXCOORD_0`) and outputs a
  `vec4` color. Valid for `mesh-surface`, `mesh-deform`, and
  `billboard-surface`.
- Extend the finalizer in `ShaderRuntime` to realize
  `input.material-texture` as a TSL `texture(material.map, uv)` node. If
  the material has no `.map`, realize as a white constant so the shader
  doesn't crash on material-less meshes.
- Cache the sampler per material (same cache-and-mutate pattern as bloom)
  so swapping textures at runtime updates uniforms rather than
  recompiling. Invalidate on `shaderRuntime.invalidate()` /
  `setContentLibrary()`.
- Add `input.sun-direction` to `SHADER_NODE_DEFINITIONS`. Takes no inputs;
  outputs a `vec3` (world-space unit vector). Valid for `mesh-surface` and
  `mesh-deform`.
- Add `ShaderRuntime.setSunDirection(direction: { x: number; y: number; z: number })`.
  First call creates a cached uniform node; subsequent calls update its
  `.value` in place. The `input.sun-direction` finalizer returns this
  cached uniform node. `EnvironmentSceneController` calls
  `shaderRuntime.setSunDirection(...)` each `apply()` pass (alongside the
  existing sun-light application) using the authored sun's
  `directionFromAngles(azimuthDeg, elevationDeg)` vector.
- Audit existing `effect.fresnel` — currently valid for `mesh-surface`?
  If not, extend `validTargetKinds` so the foliage-surface graph can use
  it. Similarly for `input.view-direction`.

**Acceptance.**

- Per-node tests in `shader-runtime-contract.test.ts` build minimal graphs
  using `input.material-texture` and `input.sun-direction`, compile
  cleanly, and finalize to TSL graphs whose outputs depend on the
  material's `.map` and the runtime-provided sun direction respectively.
- Applying a material texture to a `mesh-surface` shader on a GLB asset
  produces the same visual output as Three's default PBR path when the
  shader just passes the texture through.
- Changing the authored sun direction at runtime (e.g., dragging the
  azimuth slider) updates the `input.sun-direction` uniform value in place
  without triggering a shader recompile — verified by cache-invalidation
  count.

---

### Story 3: Built-in `foliage-surface` shader graph

**Goal.** Ship the painterly foliage surface graph as a built-in, wired up
to consume everything Blender's FoilageMaker exports.

**Tasks.**

- Add `createDefaultFoliageSurfacePostProcessShaderGraph` (the name mirrors
  the existing convention; despite the `PostProcess` suffix in siblings'
  factory names, this is a `mesh-surface` target — the naming convention
  from Plan 030 applies). Register in `createBuiltInShaderDefinitions`.
- Graph shape:
  ```
  texture = input.material-texture(uv=TEXCOORD_0)
  tint    = input.vertex-color.rgb           // canopy_tint_gradient
  sunBias = input.vertex-color.a              // sun_exterior_bias (0..1)
  ndotl   = max(0, dot(worldNormal, sunDir))
  ndotv   = max(0, dot(worldNormal, viewDir))
  rimTerm = pow(1 − ndotv, rimPower)          // backlit translucency
  warmTint   = mix(white, warmColor, sunBias * ndotl)
  base    = texture.rgb * tint * warmTint
  final   = base + rimColor * rimTerm * sunBias
  ```
- Parameters authors can tune (declared with `colorSpace: "hdr"` for
  colors that need values above 1.0 — Story 5 ships the HDR picker UI):
  - `warmColor: color3` (HDR, default `(1.15, 1.05, 0.9)`)
  - `rimColor: color3` (HDR, default `(1.2, 1.0, 0.7)`)
  - `rimPower: float` (default `2.5`)
  - `rimStrength: float` (default `0.4`)
  - `tintStrength: float` (default `1.0`; at 0 canopy tint is ignored)
- Built-in shader definition id: `${projectId}:shader:foliage-surface`.
- Deterministic node positions for stable golden-master JSON (matches the
  Plan 029 convention).

**Acceptance.**

- The shader compiles cleanly through the Plan 029 semantic compiler (no
  error diagnostics).
- Applied to a FoilageMaker-exported tree, the result visibly shows: leaf
  sprite texture detail, per-cluster tint variation, warm highlights on
  exterior canopy leaves, subtle rim glow on backlit leaves.
- A per-graph test in `shader-runtime-contract.test.ts` verifies compile-
  and-finalize.

---

### Story 4: ShaderRuntime applies both slots; render-web threads the set through

**Goal.** Apply both surface and deform shaders to the same mesh's material
instance. This is the change that actually makes the rendered tree look
right.

**Tasks.**

- Add `ShaderRuntime.applyShaderSet(set, target)` that applies the surface
  slot first (sets `colorNode`, `opacityNode`, etc. if present), then the
  deform slot (sets `positionNode`). Both slots write into the same
  `MeshStandardNodeMaterial` instance — they don't conflict because they
  target different node slots.
- If either slot is null, that slot is skipped — the material keeps its
  native surface (for null surface) or stays undeformed (for null deform).
- Update `applyShaderToRenderable` in `packages/render-web/src/` to call
  `resolveEffectiveAssetShaderBindings` and `applyShaderSet` instead of the
  singular pair. Supports the migration from Story 1.
- Per-slot material cache keys (so a surface-only change doesn't
  invalidate a deform-only recompile and vice versa).
- Same cache-and-mutate pattern as Plan 030 established for bloom: if an
  overridden parameter on the surface binding changes, update uniforms in
  place rather than re-finalizing.

**Acceptance.**

- A foliage asset placed in the scene renders with textured leaves + wind
  sway simultaneously — confirmed in the authoring viewport and the game
  preview.
- A foliage asset with `shaderOverride` on the surface slot pointing at a
  different surface shader honors the override while keeping wind.
- A non-foliage asset (e.g., the building from the current test scene)
  continues to render via its native `MeshStandardMaterial`; no regression.
- The TSL compiled-shader cache reuses surface and deform compilations
  independently — verified by a test that counts `applyShader` invocations
  across a surface-only parameter change and asserts deform's cache entry
  was not rebuilt.

---

### Story 5: Shader-slot inspector UI + HDR color picker

**Goal.** Give authors the standard inspector surface for binding shaders
to slots, tuning per-slot parameter overrides, and jumping to the shader
graph editor. Ship the HDR color picker the foliage-surface parameters
need. This is the single reusable UI component for all asset-level shader
binding — not a foliage-specific widget.

**Tasks.**

- Add `ShaderSlotEditor` component in `packages/ui` (or
  `packages/workspaces` shared components, depending on coupling to
  domain types). Props:
  ```typescript
  interface ShaderSlotEditorProps {
    bindingSet: EffectiveShaderBindingSet;
    availableShaders: ShaderGraphDocument[]; // filtered by caller (usually all)
    onChangeSlot: (slot: ShaderSlotKind, shaderDefinitionId: string | null) => void;
    onChangeParameter: (
      slot: ShaderSlotKind,
      override: ShaderParameterOverride
    ) => void;
    onNavigateToShaderEditor: (shaderDefinitionId: string) => void;
  }
  ```
  Renders one row per `SHADER_SLOT_KINDS` entry. Each row:
  - Slot kind label (Surface / Deform) with an icon
  - Shader dropdown (filtered automatically to the slot's
    `SHADER_SLOT_TARGET_KINDS[slot]` target kind)
  - "Edit shader graph" link-button (icon + optional label). Calls
    `onNavigateToShaderEditor(shaderDefinitionId)`.
  - Expandable "Parameters" panel reusing the `PostProcessParameterField`
    pattern from Plan 030's stack editor. Renders one field per shader
    parameter, using the component types from Task 2 below (HDR colors
    get the HDR picker; floats get the numeric input; SDR colors get the
    hex picker).
  - Disabled / greyed state when `bindingSet[slot] === null` AND the
    slot has no asset-kind default (non-foliage assets' surface slot,
    etc.) — the dropdown can still be used to pick a shader.
- Add `ShaderParameter.colorSpace?: "sdr" | "hdr"` to the domain type.
  `foliage-surface` declares `warmColor` and `rimColor` as `"hdr"`.
  Defaults to `"sdr"` for backwards compatibility — every existing color
  parameter keeps its current behavior.
- Extend `ColorField` (or add a parallel `HDRColorField` selected by
  parameter metadata; prefer the extension path for shared tuning logic).
  HDR mode:
  - Shows three numeric inputs (R, G, B) each accepting 0..4 with step
    0.01 and precision 2. Label under each.
  - No hex input, no popover picker — the hex format can't represent
    out-of-range values without conversion ambiguity.
  - Still supports swatches row (for quick-set to SDR-like values); hex
    swatches get converted to `[r, g, b]` in the 0..1 range.
  - Removes the clamp in `vec3ToColorNumber` when the parameter is HDR.
- Wire `onNavigateToShaderEditor` in callers (asset inspector,
  placed-asset inspector, foliage-surface parameter inspector, etc.) to
  navigate to the Render product mode with the target shader opened for
  editing. The Render workspace already has a shader graph editor from
  Plan 029; this just becomes deeper-linkable.
- Replace ad-hoc shader-override UI in the Build-mode asset inspector
  and placed-asset inspector with `ShaderSlotEditor`. This removes the
  pre-existing custom-shader override dropdown since the new component
  supersedes it; do not keep two parallel shader-binding UIs.

**Acceptance.**

- An author opens the asset inspector on a foliage asset and sees the
  `ShaderSlotEditor` listing Surface (foliage-surface) and Deform
  (foliage-wind) slots, with their parameters expanded. Clicking "Edit
  shader graph" on the Surface row navigates to the Render workspace with
  the foliage-surface graph loaded.
- Swapping the Surface slot's shader via the dropdown dispatches an
  `UpdateAsset` (or equivalent) command that sets
  `shaderOverride: { shaderDefinitionId, slot: "surface" }`. Reverting
  to the default clears the override.
- Editing `warmColor`'s red channel via the HDR picker to 2.0 produces a
  visible brighter warm highlight in the authoring viewport. The value
  persists through save/reload. The SDR `ColorField` path for non-HDR
  parameters remains visually unchanged from before this story.
- The Plan 030 post-process stack editor's parameter inspector still
  works (it renders the same parameter types via the same field
  components; this story's HDR-color extension is additive).
- The singular custom-shader-override widget formerly in the asset
  inspector is gone; `ShaderSlotEditor` is the only asset-level shader
  binding UI.

---

### Story 6: Migration + cleanup

**Goal.** Existing saved documents upgrade cleanly; deprecated APIs are
removed; docs are updated.

**Tasks.**

- `normalizeContentLibrarySnapshot` migration:
  - Saved assets with `defaultShaderDefinitionId` pointing at a
    `foliage-wind` shader migrate to not set `defaultShaderDefinitionId`
    (null) — the new foliage resolution defaults cover it.
  - Saved `shaderOverride` entries without a `slot` get a slot inferred
    from the shader's `targetKind` (`mesh-deform` → `deform`; everything
    else → `surface`). After migration, `slot` is required.
- Delete the `resolveEffectiveAssetShaderBinding` singular shim from
  Story 1 once confirmed nothing calls it. Update any callers still on the
  singular path.
- Update `packages/runtime-core/README.md` and
  `packages/render-web/src/README.md` to describe the typed shader-slot
  model (with references to `ShaderSlotKind` and
  `SHADER_SLOT_TARGET_KINDS`).
- Add a project memory entry: foliage assets always have surface + deform
  slots, both defaulted, both authorable independently, through the
  canonical `ShaderSlotEditor` UI.

**Acceptance.**

- A v2 project saved before this epic opens in a post-epic build, and its
  foliage assets render with the painterly surface automatically — no
  author action required.
- No references to `resolveEffectiveAssetShaderBinding` (singular) remain
  in source.
- Repo boundary checker / typecheck clean.

---

## Failure modes and guardrails

- **Asset has no leaf texture in its GLB.** The `input.material-texture`
  node falls back to white, so the graph still renders — leaves will be
  pure tint color (no texture detail) rather than crashing. Import
  validation in Story 28.1 already fails loudly on malformed GLBs, so this
  is only reachable via hand-authored bad assets.
- **User has a custom surface shader already set via `shaderOverride`.**
  Resolution honors the override (Story 1 precedence rules). Foliage-
  surface is *only* the default.
- **Vertex color attribute missing from the GLB.** Graph still runs — the
  vertex-color nodes resolve to `(1, 1, 1, 1)` white with full sun-bias,
  so the tree looks washed but not broken. Plan 028's import validator
  rejects foliage GLBs without `COLOR_0` anyway, so this is a belt-and-
  braces case.
- **Live-edit performance during slider drag.** Cache-and-mutate handles
  parameter tweaks; structural changes (swapping the surface shader entire)
  trigger one finalize per slot, not per mesh.
- **Two-binding invalidation thrash.** A revision bump on either slot's
  shader document invalidates that slot only; the other slot's cached
  finalization remains. Verified in Story 4 tests.

## Open questions

None blocking at draft time. Items previously flagged as open questions
(sun direction threading, HDR color picker, trunk vs. leaves) are now
resolved decisions captured in the *In scope* section and the Architecture
rework section. Future implementation-time questions should be raised as
review comments on the relevant story, not retroactively added here.

## What this does not solve alone

- **Forest-scale performance.** A thousand textured-rim-shaded trees will
  be expensive. Plan 028 Stories 28.6 / 28.7 still need to ship for the
  LOD / billboard / instancing story.
- **Authored-variation across instances.** Different trees in a forest
  still share the same GLB's vertex colors. Per-instance seed-driven
  hue offsets would add more "painted by hand" feel; deferred.
- **Non-foliage painterly surfaces.** Buildings, rocks, props still render
  as standard PBR. A general painterly-PBR follow-up (Plan 032?) can
  build on the two-binding architecture this epic establishes.

## Relationship to existing plans

- **Plan 028** (Blender foliage authoring and export) — this epic consumes
  the data Plan 028 already emits. Plan 028 stories 28.6 / 28.7 (runtime
  optimization, forest-scale verification) remain open and will stack on
  top of this epic's output.
- **Plan 029** (Shader graph pipeline) — extends the node registry and
  shader runtime established there. Uses the same built-in factory
  convention, same semantic compiler, same cache-and-mutate patterns.
- **Plan 030** (Environment lighting and post-process authoring) — scene
  lighting and tonemap already work with the current foliage material;
  this epic adds the painterly surface on top. The environment's authored
  sun direction flows into the foliage shader via
  `ShaderRuntime.setSunDirection` + the `input.sun-direction` node (see
  *Domain contract changes > Sun direction threading*).

## Success criteria

1. Opening a fresh project with an imported FoilageMaker tree renders
   the tree with visible leaf texture, per-cluster canopy tint variation,
   and warm sun-hit highlights — without any per-asset shader
   configuration.
2. Wind sway from `foliage-wind` is preserved and visible alongside the
   surface shading.
3. Opening the asset inspector on any asset shows the `ShaderSlotEditor`
   with one row per `SHADER_SLOT_KINDS` entry; clicking "Edit shader
   graph" on a populated slot navigates to the Render workspace with the
   bound shader opened. Swapping the slot's shader via the dropdown
   persists through save/reload.
4. HDR color parameters (`warmColor`, `rimColor` on `foliage-surface`)
   are tunable to values above 1.0 via per-channel numeric inputs, and
   the visual result matches the stored value.
5. Rotating the authored sun direction in the Environment inspector
   updates foliage sun-bias highlights live, without shader recompilation
   (confirmed by the cache-invalidation test from Story 2).
6. A v2 project saved before this epic opens with foliage assets
   rendering painterly; no user action required.
7. All existing tests continue to pass; new tests cover slot typing
   (target-kind enforcement), two-binding resolution, material-texture
   sampling, sun-direction threading, HDR color parameter round-trip,
   and `foliage-surface` compile + finalize.

## Dependencies

- Plan 029 (shader graph pipeline, ShaderRuntime, node registry)
- Plan 028 Stories 28.1–28.5 (Blender authoring + export + import already
  shipping COLOR_0, UVMap, leaf texture)
- Plan 030 (environment lighting + tonemap; the foliage surface reads
  scene-wide lighting state)

## Unblocks

- Plan 028 Stories 28.6 / 28.7 — once trees look right, optimizing them is
  a meaningful optimization rather than premature work on a visually-
  broken asset class.
- A future general-purpose painterly PBR surface shader for non-foliage
  assets can reuse the two-binding model, the `input.material-texture`
  node, and the authoring patterns established here.
