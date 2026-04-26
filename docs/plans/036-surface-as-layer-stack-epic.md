# Plan 036: Surface as Layer Stack Epic

**Status:** Proposed
**Date:** 2026-04-22

> **2026-04-22 framing** (before any implementation): Epic 034 landed
> the Surfaceable / Deformable / Effectable trait split and is the
> right abstraction for pipeline stages. It is NOT the final shape of
> a slot's contents. Today `Surfaceable.surfaceSlots[i].surface` is a
> flat discriminated union (color / texture / material / shader) —
> one thing per slot. That model can't express:
>
> - painterly composition within one slot (bark + moss + lichen)
> - scatter geometry (grass, flowers, clover, rocks) that grows
>   *from* a surface rather than replacing it
> - reusable library primitives built from layered sub-elements
>   (authorable, previewable, dropped into a roof or a landscape
>   channel as one thing)
>
> The gap is at a specific level of abstraction: **within a single
> Surfaceable slot, the contents are a stack of layers with masks and
> blend modes**, not one flat variant. This epic replaces the flat
> Surface type with a LayerStack-shaped Surface. Pipeline stages
> (Deformable / Effectable) remain exactly as Epic 034 defined them —
> a layer stack is the *content of a surface slot*, not a replacement
> for the three-trait split.
>
> This is the good version of the "layers" idea that an earlier draft
> of Epic 034 tried to reach for and my own feedback killed too
> hard. The correction: layers compose the contents of one slot;
> traits separate pipeline stages. Two orthogonal concepts.
>
> This epic specs the entire arc — foundation through scale + runtime
> reactivity — as three implementation stages with team-testing
> pauses between them. Each stage ships a complete, visible
> capability increment; the epic doesn't actually land until all
> three stages do.

## Epic

### Title

Replace the flat Surface type with a **layered Surface** — an
ordered stack of typed Layers (appearance, scatter, emission) with
per-layer masks and blend modes. Elevate `SurfaceDefinition` to a
first-class content-library primitive so Surfaces (like Materials)
can be authored once, previewed at full fidelity on author-selected
primitive geometry (plane / cube / sphere), and referenced from
asset slots or landscape channels. Grass, flowers, clover, rocks
all become Scatter layer variants inside this same shape, not
parallel systems.

### Goal

Four product outcomes, in priority order:

1. **Designers build rich painterly surfaces by stacking and masking,
   not by writing shader graphs.** "Bark base, moss on edges, lichen
   in low spots, wildflowers at low density, warm-sun emission on
   top" is a layer stack. Each layer has a source and a mask. No
   custom shader graph required for any piece.
2. **Scatter geometry is first-class inside Surfaces.** Grass,
   flowers, clover, rocks are Scatter layers in the same stack as
   appearance layers. Adding grass to a landscape channel means
   adding a Scatter layer. Adding moss to a cabin's roof slot means
   adding a Scatter layer. Same authoring flow everywhere.
3. **Reusable Surface library.** A SurfaceDefinition is a named,
   preview-able bundle of layers. "Wildflower Meadow," "Mossy Bark,"
   "Autumn Lawn." Authors build one, preview at full fidelity on
   plane / cube / sphere geometry (the exact same compositor +
   scatter + lighting path the in-game landscape uses), slot it
   into any Surfaceable definition's slot. Edits propagate. Like
   Substance Painter's material library, like Unreal's Material
   Layers library.
4. **Uniform across every Surfaceable.** A landscape channel slot
   holds a Surface. An asset mesh slot holds a Surface. A future
   billboard / decal / entity slot holds a Surface. Same shape, same
   authoring flow, same library. No special-casing grass for
   landscape or moss for roofs.

Two architectural outcomes:

- **One abstraction per concern.** Layers compose the *contents of a
  slot*. Traits separate *pipeline stages*. Splatmaps select *which
  surface* (i.e. which slot's stack) applies where on a landscape.
  Three independent compositional systems; none of them conflate.
- **Industry-aligned authoring model.** This is how Substance
  Painter, Unreal Material Layers, Unity HDRP Layered Lit, and
  (structurally) Photoshop all work. Designers coming from those
  tools find the mental model familiar.

### Why this epic exists

Reference images the team pinned for the target look (Genshin-style
painterly landscapes with rich grass, flowers, warm-light bloom, and
varied ground) share one authoring pattern across every industry
tool that produces them: **the visible surface of a thing is built
by stacking and masking layered elements over a base**, not by
picking one material out of a menu.

Epic 034 gave us the right pipeline-stage split (Surfaceable /
Deformable / Effectable) and the right per-slot insight (one slot,
one `Surface`). What it didn't give us is what happens *inside* that
one Surface. Today the answer is "one flat discriminated-union
variant." That answer can't express the target look without forcing
authors into custom shader graphs, which is the failure mode Epic
034's `SurfacePicker` was explicitly built to avoid.

The concrete friction points already showing up without this epic:

- **Grass has no home.** It doesn't fit into a flat Surface union as
  a new `kind` (mutual exclusion is wrong — you want grass AND
  flowers AND a green ground all on one channel). It doesn't fit as
  a parallel optional field (doesn't scale past one scatter kind —
  flowers, clover, rocks each would need their own toggle). It DOES
  fit as a Scatter layer in a layer stack, alongside appearance
  layers.
- **Moss on a roof has no home.** Same reason — it's scatter over
  an existing material on an asset slot. Needs layers to exist on
  asset slots, not only landscape.
- **Reusable painterly Surfaces have no home.** Today's flat
  Surface is inline per-slot. "Wildflower Meadow" can't be a
  library entity in the flat model because there's nothing to
  package — a single material reference doesn't capture the
  meadow's character. With a LayerStack, "Wildflower Meadow"
  becomes a named SurfaceDefinition carrying (green material base
  + tall grass scatter + wildflower scatter + warm emission) as one
  reusable asset.
- **Designer vocabulary keeps bumping into the flat model.** Every
  time the team describes a target look, the description is
  inherently layered ("green ground, patches of tall grass, some
  flowers, a little clover, warm highlights"). The domain should
  speak that vocabulary directly.

Epic 034's previous draft tried to introduce layers and got the
scope wrong — it tried to unify pipeline stages (Deform, Effect)
with layer stacks. That was wrong; pipeline stages are genuinely
different from layer stacks. This epic keeps that separation clean
and only introduces layers where they belong: **inside one
Surfaceable slot's contents**.

### Core model

Three layer kinds composed in an ordered stack within a single
Surface:

| Layer kind | What it adds | Composited via |
|---|---|---|
| **Appearance** | Base appearance (color / texture / material / shader) | Blend mode + opacity + mask into the accumulator |
| **Scatter** | Instanced geometry (grass, flowers, clover, rocks) above the accumulated appearance | Mask modulates per-pixel density; instanced draw |
| **Emission** | Additive emissive contribution (glow, warm-sun, bloom tint) | Mask-modulated additive add to `emissiveNode` |

Rules:

- Layer 0 must be an **Appearance** layer with `blendMode: "base"`.
  Nothing stacks on nothing.
- Layers 1..N composite in order. Appearance layers composite into
  the running accumulator; scatter layers enqueue instanced draws;
  emission layers add to the emissive channel.
- Every layer has `enabled`, `opacity`, `mask`, `displayName`,
  `layerId`.
- Deformable and Effectable stay exactly as Epic 034 defined them.
  Deform runs in vertex before any surface layer composition;
  effect runs in fragment after the entire surface stack has
  composited. Layers don't cross into those stages.

A slot holds a **`SurfaceBinding`**: either an inline `Surface` the
author built on this slot, or a reference to a library
`SurfaceDefinition` for reuse. Parallel to how a layer's material
content can be a material reference or an inline shader instance.

## Staging

The epic is implemented in **four** stages. Each stage ships a
shippable, testable capability jump; the team pauses at each stage
boundary for in-app QA, product review, and aesthetic sign-off
before the next stage begins. The whole epic is considered landed
only when Stage 3 has passed validation. Stage 0 is a prerequisite
refactor that cleans up the rendering-infrastructure ownership
before layer-stack work lands on top of it.

### Stage 0 — Render infra split (prerequisite refactor)

**Shippable goal:** One `WebRenderEngine` (singleton per Studio /
per runtime host), many `RenderView`s. Shared GPU device, shared
ShaderRuntime, shared AuthoredAssetResolver, shared active
Environment state — all owned by the engine. Per-view scene,
camera, canvas, pipeline, overlay subscribers. Every existing
viewport in the app (authoring viewport + player / NPC / item
design viewports + published-web runtime host) re-based onto the
split. Design viewports finally render against the project's
current environment instead of hardcoded ad-hoc lighting — a
correctness fix in addition to the architectural one.

**`packages/render-web` stays boundary-clean.** The engine is
store-agnostic: it exposes imperative setters
(`setContentLibrary` / `setEnvironment` / `setAssetSources`) and
the callers own the subscription plumbing. Studio has a single
render-engine projector that reads `projectStore` / `shellStore` /
`assetSourceStore` and pushes into the engine. The published
runtime has its own projector reading its own state shape. No
`@sugarmagic/shell` import ever appears inside `packages/render-web`;
the lint guard in Story 36.0.3 enforces this structurally.

Why this exists as Stage 0 rather than a separate epic: Stage 1's
Surface Library workspace introduces a new center-panel preview
viewport (Story 36.8); Stage 1's landscape scatter introduces
per-view InstancedMesh management; Stage 2 adds asset-slot scatter
that spawns InstancedMeshes under asset scene graphs in other
views. All of that gets noticeably messier if built on top of the
current WebRenderHost shape, where "app-singleton stuff" and
"per-view stuff" are conflated in a single factory function. Fix
the foundation once; pay less everywhere afterward.

Scope: Stories 36.0.1–36.0.3.

- `WebRenderHost` is split + renamed. The app-singleton pieces
  (GPU device, ShaderRuntime, AuthoredAssetResolver, active
  environment state, env-change notifications) move into
  `WebRenderEngine`. The per-view pieces (scene, camera, canvas,
  WebGPURenderer bound to the shared device, render pipeline,
  overlay subscribers) move into `RenderView`.
- Existing viewports (authoringViewport, playerViewport,
  npcViewport, itemViewport) are migrated to create a `RenderView`
  bound to the shared `WebRenderEngine` instead of each
  allocating their own WebGPURenderer. Design viewports get the
  biggest efficiency + correctness win — they stop duplicating
  GPU device allocation and stop using hardcoded HemisphereLight /
  DirectionalLight setups, instead rendering against the project's
  current environment.
- `targets/web/src/runtimeHost.ts` gets the same treatment for
  the published runtime target: one `WebRenderEngine` at game
  bootstrap; the gameplay loop holds a `RenderView` for the
  primary gameplay camera. Future runtime viewports (e.g.
  rearview mirror, security-camera feeds, in-game screens) are
  additional `RenderView`s sharing the same engine.
- ADR 013 (renumbered if necessary) + lint guard.

**Test pause before Stage 1:** Every existing viewport renders
identically to before the split, visually. No regression in the
authoring viewport's landscape/layout/spatial workflows. Design
viewports now render using the project's current environment
(verified by switching environments and seeing the player /
NPC / item preview lighting change). **Construction of
renderers, devices, shader runtimes, and asset resolvers is
confined to the correct source files** (one file per construct,
enforced by the lint guard) — not to be read as "one live
renderer in the app." `WebGPURenderer` is the only
many-live-instances-one-source-file case: RenderView is the
sole constructor, and it legitimately produces one instance per
mounted view. `GPUDevice` / `ShaderRuntime` /
`AuthoredAssetResolver` are one-source-file AND one-live-
instance each (engine-owned). See the pause-criterion section
of Story 36.0.3 for the precise table. Landscape scatter,
asset-slot scatter, and the Surface Library preview in later
stages can be built confidently against the new split; we're
not deferring architectural debt.

### Stage 1 — Foundation (v1)

**Shippable goal:** A region landscape can render rich painterly
surfaces with grass, flowers, and emission layers composed from a
reusable library. The Surface Library workspace works, with a
full-fidelity preview that renders the Surface exactly as the game
would on author-selectable primitive geometry (plane / cube /
sphere). A fresh project has starter content (Wildflower Meadow,
Autumn Field, Manicured Lawn, etc.) that matches the
reference-image aesthetic when previewed.

Scope: Stories 36.1–36.10. Layer stack domain shape; library
primitives (Surface / GrassType / FlowerType); runtime compositor;
CPU scatter on landscape slots; SurfacePicker rewrite; Surface
Library workspace + preview; starter content; ADR 013 + lint.

**Not yet in Stage 1:** asset-slot scatter (moss on a roof), painted
masks, procedural noise masks, rocks, per-slot overrides on
referenced Surfaces, GPU compute scatter, scatter LOD, player
displacement.

**Test pause before Stage 2:** Does the Surface Library preview
(on any of plane / cube / sphere) look like the reference images?
Is the layer stack editor intuitive? Do authors reach for a mask
kind we don't ship? Is the CPU scatter fast enough on a reference
scene at realistic density? Any domain-shape issues that would be
painful to unwind after more code builds on top?

### Stage 2 — Authoring Power (v2)

**Shippable goal:** Every authoring scenario the reference images
imply is expressible. Moss on a roof works end-to-end. Authors can
paint masks directly in the editor (like Substance Painter's
mask-paint mode). A slot can reference a library Surface and tweak
just one layer's opacity without forking. Procedural-noise masks
unlock organic transitions (patches, clumps, gradients).

Scope: Stories 36.11–36.15. Asset-slot scatter realization (this
is the big one — makes grass-on-roof real); painted mask textures;
per-slot layer overrides on referenced Surfaces; `RockTypeDefinition`
+ rocks scatter variant; procedural-noise masks (Perlin, Voronoi,
world-position gradients).

**Not yet in Stage 2:** GPU compute scatter, scatter LOD, player
displacement — those are perf + reactivity, not authoring power.

**Test pause before Stage 3:** Can authors build the scenes they
actually want? Do painted masks feel responsive? Do asset-slot
scatter binds survive asset re-imports and mesh topology changes?
Any perf cliffs showing up at this authoring density that we need
to address before adding more runtime features?

### Stage 3 — Scale + Reactivity (v3)

**Shippable goal:** Runs at 60fps on reference hardware with a
full-density landscape (500K+ scatter instances across multiple
scatter layers), with player / NPC pushing through scatter
reacting visibly, and distance LOD hiding / thinning scatter past
the visible range. The epic is considered complete.

Scope: Stories 36.16–36.20. GPU compute scatter + indirect draw;
scatter frustum + distance culling; scatter LOD (density thin +
mesh swap at distance); player / NPC displacement buffer; perf
validation + final ADR closeout.

**Test pause before the epic is declared done:** Frame-time
budget under target scenarios. Displacement feels good in
gameplay playtest. No visual regressions from Stage 1 / 2. ADR 013
finalized with "how we got here" notes.

## Scope

### In scope

- **`Surface` as a LayerStack.** Today's flat Surface union is
  repurposed: the 4-variant union becomes `AppearanceContent` (what
  an appearance layer carries). `Surface` itself becomes
  `{ layers: Layer[] }`.

- **`Layer` discriminated union** with three variants
  (`appearance`, `scatter`, `emission`). Each carries common
  properties (id, name, enabled, opacity, mask) and kind-specific
  content.

- **`AppearanceContent`** — the renamed Epic 034 Surface union:
  ```ts
  type AppearanceContent =
    | { kind: "color"; color: number }
    | { kind: "texture"; textureDefinitionId: string;
        tiling: [number, number] }
    | { kind: "material"; materialDefinitionId: string }
    | { kind: "shader"; shaderDefinitionId: string;
        parameterValues: Record<string, unknown>;
        textureBindings: Record<string, string> };
  ```

- **`ScatterContent`** — discriminated by scatter kind, each
  referencing a new library definition type:
  ```ts
  type ScatterContent =
    | { kind: "grass"; grassTypeId: string }
    | { kind: "flowers"; flowerTypeId: string }
    | { kind: "rocks"; rockTypeId: string };
  ```
  Extensible à la carte; each new kind is one union variant + one
  library definition.

- **`EmissionContent`** — appearance-like but additive:
  ```ts
  type EmissionContent =
    | { kind: "color"; color: number; intensity: number }
    | { kind: "texture"; textureDefinitionId: string;
        intensity: number; tiling: [number, number] }
    | { kind: "material"; materialDefinitionId: string };
  ```

- **`Mask` type** — scalar-field-per-pixel source for a layer:
  ```ts
  type Mask =
    | { kind: "always" }
    | { kind: "texture"; textureDefinitionId: string;
        channel: "r" | "g" | "b" | "a" }
    | { kind: "splatmap-channel"; channelIndex: number }
    | { kind: "fresnel"; power: number; strength: number }
    | { kind: "vertex-color-channel"; channel: "r" | "g" | "b" | "a" }
    | { kind: "height"; min: number; max: number; fade: number };
  ```
  The first five are v1. `height` is v1 too since it's cheap
  (world-Y gradient — cliff faces vs. valleys). **Painted masks**
  (author brushes a mask texture directly in the editor) are v2.

- **`BlendMode`** for appearance layers:
  `"base" | "mix" | "multiply" | "add" | "overlay"`. Normal-channel
  blending stays in tangent space; for non-`"mix"` modes on
  `normalNode`, the UI greys them out for normals unless the author
  explicitly opts in (the math is non-commutative and easy to get
  wrong).

- **`SurfaceBinding`** — slot-content shape:
  ```ts
  type SurfaceBinding<C extends SurfaceContext> =
    | { kind: "inline"; surface: Surface<C> }
    | { kind: "reference"; surfaceDefinitionId: string };
  ```
  Slot fields on `Surfaceable` definitions narrow by slot kind:
  `AssetSurfaceSlot.surface: SurfaceBinding<"universal"> | null`
  (only universal Surfaces — no splatmap-channel masks), while
  `LandscapeSurfaceSlot.surface: SurfaceBinding<SurfaceContext> | null`
  (either universal or landscape-only Surfaces are valid on
  landscape slots). See *Validation rules (mask context)* below.

- **`SurfaceDefinition`** — new content-library primitive:
  ```ts
  interface SurfaceDefinition {
    definitionId: string;
    definitionKind: "surface";
    displayName: string;
    surface: Surface;  // the layer stack
  }
  ```
  Lives in `ContentLibrarySnapshot.surfaceDefinitions[]`. Authors
  create, preview, save, reference from slots.

- **Scatter-type library primitives**:
  - `GrassTypeDefinition` — tuft mesh (procedural or asset), density,
    height/scale/rotation jitter, tip-base color gradient, color
    jitter, wind deform reference.
  - `FlowerTypeDefinition` — same shape, different default params
    (flowers are sparser + more varied + often have a petal billboard
    instead of a tuft).
  - `RockTypeDefinition` (v2) — mesh reference + scale jitter.
  Each new primitive gets its own `createDefault*`, its own
  content-library slice.

- **Runtime appearance compositor** — folds the layer stack's
  appearance layers into one `EffectiveShaderBinding`-equivalent.
  Lives in `runtime-core` (semantic) with TSL realization in
  `render-web` (blend math per channel, mask evaluation, normal
  tangent-space handling).

- **Runtime scatter realization** — takes a scatter layer's
  resolved binding + the owner's surface sampler (landscape
  splatmap grid OR asset mesh material-slot triangles), produces
  an `InstancedMesh` parented under the owner's scene group.
  Updates only when the scatter layer, its mask, or the sampler
  changes.

- **Per-landscape-channel surface binding** — unchanged from the
  trait model: `LandscapeSurfaceSlot.surface: SurfaceBinding | null`.
  Channel splatmap decides which slot's surface dominates per pixel;
  the surface's own layer stack composites internally. The two
  systems are cleanly separated.

- **Preview workspace for SurfaceDefinition** — small 3D preview
  (cube or sphere) with environment lighting, rendering the Surface
  live as the author edits layers. Substance-Painter-style.

- **Starter library** — ship 4-5 SurfaceDefinitions, 3-4
  GrassTypeDefinitions, 2-3 FlowerTypeDefinitions so authors can
  see the system working out of the box:
  - Surfaces: Wildflower Meadow, Autumn Field, Mossy Bark,
    Manicured Lawn, Clover Patch.
  - Grass: Short Lawn, Wild Tall, Autumn Golden, Dry Sparse.
  - Flowers: White Meadow, Yellow Buttercup, Purple Wildflower.

### Out of scope (beyond Stage 3)

The epic covers Stages 1–3 in full. These items sit outside even
Stage 3 and belong to future epics:

- **Bringing back `input.previous-layer-*` builtins.** Within a
  Surface's layer stack, composition is via blend mode + mask, not
  by having a layer's shader graph sample the accumulator below
  it. If you want accumulator-reading behavior that's the
  Effectable trait's job (effect runs after the whole surface stack
  has composited and reads the finished accumulator, not a
  mid-stack one). Same stance as Epic 034.
- **Runtime-dynamic layer mutation from gameplay.** Surfaces are
  authored truth; runtime gameplay doesn't mutate them. A future
  runtime-parameter-instance concept is a separate epic. (Player
  displacement in Stage 3 is a rendering-time effect, not a
  mutation of the authored layer stack.)
- **Volumetric / non-surface scatter.** Particle systems,
  smoke, volumetric clouds — separate rendering-path epics. This
  epic is surface-bound scatter (grass, flowers, rocks, moss).
- **Authored layer thumbnails / generated preview icons in the
  library panel.** The Surface Library workspace's full-fidelity
  preview (plane / cube / sphere) covers the detailed view; a
  per-entry thumbnail in the list (like Substance Painter's tiny
  icons) is a polish pass.

Items moved OUT of "out of scope" compared to earlier drafts —
these are now staged work inside this epic:

- Asset-slot scatter realization → **Stage 2, Story 36.11**.
- Painted mask textures → **Stage 2, Story 36.12**.
- Per-slot layer overrides on referenced Surfaces → **Stage 2,
  Story 36.13**.
- Rocks scatter variant → **Stage 2, Story 36.14**.
- Procedural-noise masks → **Stage 2, Story 36.15**.
- GPU compute scatter + indirect draw → **Stage 3, Story 36.16**.
- Scatter frustum + distance culling → **Stage 3, Story 36.16** (folds with compute).
- Scatter LOD → **Stage 3, Story 36.17**.
- Player / NPC displacement → **Stage 3, Story 36.18**.

## Architecture

### Current state (after Epic 034)

```
Surfaceable.surfaceSlots[i].surface: Surface | null

  where Surface is flat:
    | { kind: "color"; color }
    | { kind: "texture"; textureDefinitionId; tiling }
    | { kind: "material"; materialDefinitionId }
    | { kind: "shader"; shaderDefinitionId; parameterValues; textureBindings }

Deformable.deform: ShaderOrMaterial | null   — unchanged
Effectable.effect: ShaderOrMaterial | null   — unchanged
```

### Target state

```
AssetSurfaceSlot.surface: SurfaceBinding<"universal"> | null
   ↑ narrowed: no splatmap-channel masks; inline Surfaces type-checked

LandscapeSurfaceSlot.surface: SurfaceBinding<SurfaceContext> | null
   ↑ accepts both "universal" and "landscape-only" Surfaces

  where SurfaceBinding<C>:
    | { kind: "inline";   surface: Surface<C> }
    | { kind: "reference"; surfaceDefinitionId: string }
      // reference's compatibility is checked by command executor +
      // IO decoder since the id is just a string at the type level

  and Surface<C>:
    { layers: Layer[], context: C }
      // layers[0].kind === "appearance" && layers[0].blendMode === "base"
      // context === "landscape-only" iff any layer.mask.kind === "splatmap-channel"

  and Layer:
    | { kind: "appearance"; ...LayerCommon;
        blendMode: BlendMode; content: AppearanceContent }
    | { kind: "scatter";    ...LayerCommon; content: ScatterContent }
    | { kind: "emission";   ...LayerCommon; content: EmissionContent }

Deformable.deform: ShaderOrMaterial | null   — unchanged
Effectable.effect: ShaderOrMaterial | null   — unchanged

ContentLibrarySnapshot.surfaceDefinitions[]: SurfaceDefinition[]  (new)
ContentLibrarySnapshot.grassTypeDefinitions[]: GrassTypeDefinition[]  (new)
ContentLibrarySnapshot.flowerTypeDefinitions[]: FlowerTypeDefinition[]  (new)
```

The 034 trait split stays exactly as-is. Deform and Effect fields
remain `ShaderOrMaterial | null` — they are not layer stacks because
they are not surface-composition concerns. They are pipeline-stage
slots.

### Domain types

Full definitions for the new shapes. All live in
`packages/domain/src/surface/` (the folder already exists from
Epic 034; this epic grows it):

```ts
// packages/domain/src/surface/layer.ts  (new)

export type BlendMode =
  | "base"
  | "mix"        // lerp into accumulator by mask * opacity
  | "multiply"
  | "add"
  | "overlay";

export type Mask =
  | { kind: "always" }
  | {
      kind: "texture";
      textureDefinitionId: string;
      channel: "r" | "g" | "b" | "a";
    }
  | { kind: "splatmap-channel"; channelIndex: number }
  | { kind: "fresnel"; power: number; strength: number }
  | {
      kind: "vertex-color-channel";
      channel: "r" | "g" | "b" | "a";
    }
  | { kind: "height"; min: number; max: number; fade: number };

export type AppearanceContent =
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

export type ScatterContent =
  | { kind: "grass"; grassTypeId: string }
  | { kind: "flowers"; flowerTypeId: string };
// Rocks and future scatter kinds are additive; each new entry
// gets its own library definition type in a follow-up story.

export type EmissionContent =
  | { kind: "color"; color: number; intensity: number }
  | {
      kind: "texture";
      textureDefinitionId: string;
      intensity: number;
      tiling: [number, number];
    }
  | { kind: "material"; materialDefinitionId: string };

export interface LayerCommon {
  layerId: string;
  displayName: string;
  enabled: boolean;
  opacity: number;         // 0..1
  mask: Mask;
}

export interface AppearanceLayer extends LayerCommon {
  kind: "appearance";
  blendMode: BlendMode;
  content: AppearanceContent;
}

export interface ScatterLayer extends LayerCommon {
  kind: "scatter";
  // opacity is ignored for scatter layers (density is the scalar
  // knob, modulated by mask). Kept on LayerCommon for uniformity.
  content: ScatterContent;
}

export interface EmissionLayer extends LayerCommon {
  kind: "emission";
  content: EmissionContent;
}

export type Layer = AppearanceLayer | ScatterLayer | EmissionLayer;

/**
 * A Surface's "context" captures which slot kinds it is legal
 * authored input for. A Surface that uses any mask requiring
 * landscape-specific runtime data (today: `splatmap-channel`) is
 * `"landscape-only"` and cannot be bound to an asset mesh slot. A
 * Surface that uses only universally-available masks is
 * `"universal"` and can be bound to any Surfaceable slot.
 *
 * This is the same pattern Epic 034 established with
 * `ShaderOrMaterial` narrowing deform / effect slots: make
 * impossible states unrepresentable at the type level, with IO-
 * decoder and command-executor checks as belt-and-braces for
 * anything the types can't catch (e.g. library references whose
 * identifier is just a string).
 */
export type SurfaceContext = "universal" | "landscape-only";

export interface Surface<C extends SurfaceContext = SurfaceContext> {
  readonly layers: readonly Layer[];
  readonly context: C;
  // Invariants:
  //   layers[0].kind === "appearance" && layers[0].blendMode === "base"
  //   context === "landscape-only" iff any layer has a splatmap-channel mask
  // Enforced by factories, IO decoder, and the `deriveSurfaceContext`
  // helper that layer mutation commands must re-run after every change.
}

export type SurfaceBinding<C extends SurfaceContext = SurfaceContext> =
  | { kind: "inline"; surface: Surface<C> }
  | { kind: "reference"; surfaceDefinitionId: string };
// The reference variant can't carry its referenced Surface's context
// at the type level (the id is just a string). Runtime resolution +
// the IO decoder check compatibility against the target slot.

/** Compute the correct `context` value for a set of layers.
 *  Called by factories and by command handlers after every
 *  layer mutation to keep the stored invariant accurate. */
export function deriveSurfaceContext(
  layers: readonly Layer[]
): SurfaceContext;
```

```ts
// packages/domain/src/surface/surface-definition.ts  (new)

export interface SurfaceDefinition {
  definitionId: string;
  definitionKind: "surface";
  displayName: string;
  surface: Surface;
}

export function createDefaultSurfaceDefinition(
  projectId: string,
  opts?: { displayName?: string; baseColor?: number }
): SurfaceDefinition;
```

```ts
// packages/domain/src/surface/grass-type.ts  (new)

export interface GrassTypeDefinition {
  definitionId: string;
  definitionKind: "grass-type";
  displayName: string;

  // Tuft source: procedural (v1 default) or asset-driven (v1 too).
  tuft:
    | {
        kind: "procedural";
        bladesPerTuft: number;     // 3..12
        heightRange: [number, number];
        widthBase: number;
        bendAmount: number;         // 0..1
      }
    | {
        kind: "asset";
        assetDefinitionId: string;  // references a library Asset
      };

  // Scatter parameters
  density: number;                  // tufts per m² at full mask weight
  scaleJitter: [number, number];    // min, max
  rotationJitter: number;           // 0..1
  heightJitter: number;             // 0..1

  // Appearance
  tipColor: number;
  baseColor: number;
  colorJitter: number;              // 0..1

  // Wind (reuses Epic 034's Deformable trait shape — the value is a
  // direct Material/Shader reference, not a layer stack)
  wind: { kind: "material"; materialDefinitionId: string }
      | { kind: "shader"; shaderDefinitionId: string;
          parameterValues: Record<string, unknown>;
          textureBindings: Record<string, string> }
      | null;
}
```

```ts
// packages/domain/src/surface/flower-type.ts  (new)

export interface FlowerTypeDefinition {
  definitionId: string;
  definitionKind: "flower-type";
  displayName: string;

  head:
    | {
        kind: "procedural";
        petalCount: number;
        radius: number;
        heightRange: [number, number];
      }
    | {
        kind: "asset";
        assetDefinitionId: string;
      };

  density: number;                  // flowers per m² at full mask weight
  scaleJitter: [number, number];
  rotationJitter: number;

  petalColor: number;
  centerColor: number;
  colorJitter: number;

  // Usually far gentler wind than grass
  wind: /* same ShaderOrMaterial-style shape as GrassType */ | null;
}
```

`ContentLibrarySnapshot` gains three new arrays:
`surfaceDefinitions[]`, `grassTypeDefinitions[]`,
`flowerTypeDefinitions[]`. `ContentDefinitionKind` gains
`"surface" | "grass-type" | "flower-type"`.

### Validation rules (mask context)

The domain has to prevent a state where a Surface bound to an
asset mesh slot carries a splatmap-channel mask — such a state has
no meaning at runtime (no splatmap exists on asset geometry) and
would at best produce a diagnostic and at worst produce silent
garbage. Same class of invariant Epic 034 enforced for
`ShaderOrMaterial` on deform / effect slots. Same multi-layer
defense: type-level where possible, then three non-UI enforcement
points as fallbacks for cases the types can't catch (library
references, hand-edited files, bugs).

**The invariant:** a Surface's `context` field is
`"landscape-only"` if and only if any of its layers' masks has
`kind: "splatmap-channel"`. Derived from layers; stored on the
Surface for type-level narrowing.

**Enforcement, in order of "catches the most cases":**

| Layer | Catches | How |
|---|---|---|
| TypeScript / domain types | Inline bindings: assigning a `Surface<"landscape-only">` to `AssetSurfaceSlot.surface` (typed `SurfaceBinding<"universal"> \| null`) fails at compile time | The `SurfaceBinding<C>` generic + slot field narrowing |
| Domain IO decoder | Hand-edited files, buggy importers, or loaded SurfaceDefinitions whose stored `context` doesn't match their layer contents | The decoder runs `deriveSurfaceContext(layers)` on every loaded Surface and rejects the load (loud error, names the offending SurfaceDefinition) if it doesn't match the stored `context` field. Separately: every `AssetSurfaceSlot` binding whose referenced SurfaceDefinition has `context === "landscape-only"` is rejected with a typed error naming both the slot and the Surface |
| Domain command executor | Authoring-time commands that would produce an incompatible state | `AddSurfaceLayer` / `UpdateSurfaceLayer` / `SetSurfaceBinding` commands recompute `context` via `deriveSurfaceContext` after the mutation and reject commands that would bump a Surface to `"landscape-only"` while it is currently bound to any AssetSurfaceSlot. The alternative — silently adding the splatmap mask and letting the type narrow — would turn a per-layer edit into an implicit binding change, which is exactly the kind of cross-slot coupling bug we want to prevent |
| Runtime resolver | Last line of defense for anything that slipped through | `resolveSurfaceBinding(binding, contentLibrary, callerContext)` (runtime-core) verifies the resolved Surface's `context` against `callerContext` and returns `{ ok: false, diagnostic }` rather than a binding, same pattern as Epic 034 |
| UI | Author ergonomics, not enforcement | `<MaskEditor>` greys out `splatmap-channel` when editing a layer that belongs to a Surface currently bound to any non-landscape slot, with a tooltip explaining why. Purely a guardrail — the domain would reject the state anyway |

**Principle carried forward from Epic 034.** The UI hides states
the domain forbids; the domain forbids states the runtime can't
realize. A malformed file (hand-edited, broken importer, bug in a
command) never reaches the runtime — the IO decoder catches it,
the command executor catches it, the resolver catches it. No
"impossible state" path to a broken render.

**Note on adding new mask kinds.** Any future mask that depends on
runtime context unavailable in non-landscape slots (e.g. a
"landscape-height-delta" mask, or anything that reads splatmap
state) gets the same treatment: the mask kind contributes to the
Surface's context derivation, and the SurfaceContext enum grows
if a new category emerges. Adding a new "universal" mask kind
(one that works everywhere — e.g. a procedural Voronoi mask)
requires no SurfaceContext change.

### Runtime pipeline

**Resolution (runtime-core, pure):**

```ts
// packages/runtime-core/src/shader/bindings.ts (extend)

export function resolveSurfaceBinding(
  binding: SurfaceBinding,
  contentLibrary: ContentLibrarySnapshot,
  callerContext: SurfaceContext
    // the kind of slot asking: "universal" for asset slots,
    // "landscape-only" is accepted only by landscape slots (asset
    // slots pass "universal" here and get a diagnostic back if the
    // resolved Surface is landscape-only)
): ResolveResult<Surface>;

// Per-layer resolution:

export function resolveAppearanceLayer(
  layer: AppearanceLayer,
  contentLibrary: ContentLibrarySnapshot
): ResolveResult<EffectiveShaderBinding>;

export function resolveScatterLayer(
  layer: ScatterLayer,
  contentLibrary: ContentLibrarySnapshot
): ResolveResult<EffectiveScatterBinding>;  // new — carries grass/flower type + resolved wind binding

export function resolveEmissionLayer(
  layer: EmissionLayer,
  contentLibrary: ContentLibrarySnapshot
): ResolveResult<EffectiveShaderBinding>;   // reuses shader-binding shape; intensity is a parameter
```

All four return `ResolveResult` discriminated unions — carry either
a binding or a diagnostic, never a silent failure. Epic 034's
`resolveSurface` is hard-renamed to `resolveAppearanceLayer` in
Story 36.4 (semantics identical; name more precise; all call
sites migrated in the same commit, no compatibility alias).

**Compositing (render-web, TSL):**

```ts
// packages/render-web/src/ShaderRuntime.ts (extend)

// Takes the N appearance layers' resolved bindings, evaluates each
// to a ShaderSurfaceNodeSet, composites them per-channel using blend
// mode + mask + opacity. Emission layers are accumulated into the
// emissive channel. Returns one final ShaderSurfaceNodeSet for the
// material assignment step.
evaluateLayerStackToNodeSet(
  appearanceBindings: EffectiveShaderBinding[],
  emissionBindings: EffectiveShaderBinding[],
  masks: Mask[],           // one per appearance layer (emission too)
  blendModes: BlendMode[], // one per appearance layer
  opacities: number[],     // one per appearance layer
  options: { geometry, carrierMaterial, uvOverride?, splatmapContext? }
): ShaderSurfaceNodeSet | null;
```

Mask evaluation gets its own sub-module
(`packages/render-web/src/materialize/mask.ts`):
`materializeMask(mask, context) → TSL scalar node`. Per-pixel scalar
in [0, 1]. `always` → const 1. `texture` → sample + channel-select.
`splatmap-channel` → read the current splatmap channel (caller must
pass splatmapContext for landscape; mesh slot callers pass null and
splatmap masks fail with a compile diagnostic). `fresnel` → view-dot.
`vertex-color-channel` → geometry attribute. `height` → worldY
gradient.

Blend math (`packages/render-web/src/materialize/layer-blends.ts`,
new):
- `"mix"`: `accumulator = mix(accumulator, layer, mask * opacity)`.
- `"multiply"`: `accumulator = accumulator * mix(1, layer, mask * opacity)`.
- `"add"`: `accumulator = accumulator + layer * mask * opacity`.
- `"overlay"`: classic Photoshop overlay, per-channel.
- Normal channel always uses `"mix"` regardless of author choice
  (with a UI warning when the author picks something else —
  tangent-space blending for non-mix modes is ill-defined and we
  don't want to ship broken normals).

**Scatter realization (render-web, landscape path for v1):**

```ts
// packages/render-web/src/landscape/scatter.ts (new)

export function buildScatterInstancesForLandscape(
  scatterLayer: ScatterLayer,
  scatterBinding: EffectiveScatterBinding,
  mask: Mask,
  landscape: RegionLandscapeState,
  splatmapContext: SplatmapContext
): THREE.InstancedMesh;
```

Walks the landscape's world-space grid at a density determined by
the scatter type's `density` × mask value at each sample point.
Jitters position, scale, rotation per-instance. Builds an
`InstancedMesh` with the tuft/flower mesh (procedural or resolved
from the referenced asset) and a material wired via shader graph
(tip-base gradient + per-instance color jitter + wind deform). The
landscape scene controller owns one InstancedMesh per scatter layer
per region.

Mesh-apply (asset slots) in v1: scatter layers are accepted, logged
as "asset slot scatter not yet realized," and skipped. Appearance +
emission layers apply normally.

**Mesh-apply wiring** in `applyShaderToRenderable`:

```
For each surface slot on the Surfaceable:
  binding = resolveSurfaceBinding(slot.surface, contentLibrary)
  surface = binding.ok ? binding.value : skip-slot
  
  appearanceLayers = surface.layers.filter(l => l.kind === "appearance")
  emissionLayers = surface.layers.filter(l => l.kind === "emission")
  scatterLayers = surface.layers.filter(l => l.kind === "scatter")
  
  appearanceBindings = appearanceLayers.map(resolveAppearanceLayer)
  emissionBindings = emissionLayers.map(resolveEmissionLayer)
  
  nodeSet = runtime.evaluateLayerStackToNodeSet(
    appearanceBindings.ok,
    emissionBindings.ok,
    [appearance masks + emission masks],
    [appearance blend modes],
    [appearance + emission opacities],
    {geometry, carrierMaterial: material}
  )
  
  assignToMaterialSlot(material, slot.slotIndex, nodeSet)
  
  // v1: scatter layers on asset slots deferred
  if scatterLayers.length > 0:
    warn("asset-slot scatter not yet realized; layer count:", scatterLayers.length)

If host.deform: same as Epic 034 (unchanged)
If host.effect: same as Epic 034 — reads the layer-composited accumulator
```

**Landscape-apply** in `rebuildMaterialNodes`:

```
For each channel's surface slot:
  binding = resolveSurfaceBinding(slot.surface, contentLibrary)
  surface = binding.ok ? binding.value : skip-channel
  
  [as above, build appearance / emission node set]
  
  perChannelNodeSets.push(nodeSet)
  
  // Landscape v1: scatter realization IS implemented
  for scatter layer in surface.layers where kind === "scatter":
    scatterBinding = resolveScatterLayer(layer, contentLibrary)
    mesh = buildScatterInstancesForLandscape(
      layer, scatterBinding.value, layer.mask,
      landscape, splatmapContext
    )
    landscapeSceneController.addScatterMesh(channelId, layer.layerId, mesh)

composited = splatmapCompositeByChannel(perChannelNodeSets, splatmapContext)
assignToLandscapeMaterial(material, composited)

If landscape.deform / effect: same as Epic 034
```

### UI shape

**SurfacePicker rewrite** — the slot-content picker becomes a layer
stack editor:

```
┌────────────────────────────────────────────────┐
│  SURFACE  ● Inline  ○ Reference [library ▼]   │
├────────────────────────────────────────────────┤
│  LAYERS                              + Add ▼  │ ← add layer menu
│  ┌──────────────────────────────────────────┐ │
│  │ ≡ Emission: Warm Sun     👁  30% [mask]  │ │
│  │ ≡ Scatter: Wildflowers   👁  20 p/m² ░   │ │
│  │ ≡ Scatter: Tall Grass    👁  80 p/m² ░   │ │
│  │ ≡ Appearance: Clay Path  👁  Overlay 40% │ │
│  │ ≡ Appearance: Green Grass 👁  BASE       │ │ ← must be bottom
│  └──────────────────────────────────────────┘ │
├────────────────────────────────────────────────┤
│  SELECTED LAYER                                │
│    Name: Clay Path                             │
│    Content: [Material ▼] [clay-red ▼]          │
│    Blend: [Overlay ▼]  Opacity: [════ 40%]    │
│    Mask: [Splatmap Channel 2 ▼]                │
└────────────────────────────────────────────────┘
```

Drag-reorder. Toggle visibility per layer. Edit selected layer's
content / blend / opacity / mask inline. + Add menu offers
Appearance / Scatter (→ Grass / Flowers / …) / Emission.

**Surface Library workspace** — new Build workspace peer to
Material Library:

```
┌──────────── SURFACE LIBRARY ─────────────────┐
│  ○ Wildflower Meadow     [New] [Import]     │
│  ● Mossy Bark                                │
│  ○ Autumn Field                              │
│  ○ Manicured Lawn                            │
├───────── EDIT: Mossy Bark ───────────────────┤
│   ┌──────────┐  LAYERS                       │
│   │  PREVIEW │  ≡ Emission: Lichen Tint      │
│   │ (cube/   │  ≡ Scatter: Moss Tufts        │
│   │  sphere) │  ≡ Appearance: Moss Patches   │
│   │          │  ≡ Appearance: Bark (BASE)    │
│   └──────────┘  [Selected layer's params]    │
└──────────────────────────────────────────────┘
```

Preview cube/sphere renders the Surface live with standard editor
lighting. Author edits; preview updates immediately via the existing
viewport subscription model (Epic 033).

Landscape workspace's per-channel Surface picker is the same
SurfacePicker. Asset inspector's per-slot picker is the same
SurfacePicker. Uniform UX.

## Stories

Stories are grouped by stage. Each stage ends with a testing pause;
the next stage doesn't begin until sign-off.

---

## Stage 0 — Render infra split (prerequisite refactor)

Three stories. Split `WebRenderHost` into shared
`WebRenderEngine` + per-view `RenderView`, migrate all existing
viewports, fix design viewports to honor the project environment,
add ADR + lint guard. Nothing in Stage 1 begins until Stage 0
passes its testing pause.

### 36.0.1 — Extract `WebRenderEngine`; rename + split `WebRenderHost` into `RenderView`

**Outcome:** `packages/render-web/src/host/WebRenderHost.ts` is
decomposed into two modules:

- `packages/render-web/src/engine/WebRenderEngine.ts` (new) —
  Studio- and runtime-singleton. Owns:
  - a single `GPUDevice` (constructed once, shared across every
    view via `new WebGPURenderer({ device })` which three.js
    supports natively)
  - the `ShaderRuntime` (compiles each unique shader signature
    once; cached results serve every view)
  - the `AuthoredAssetResolver` (loads each authored texture /
    GLB once; cached Textures serve every view)
  - the **active environment state** — lights config, sky
    config, fog, post-process chain. When the project's active
    environment changes (shell-store `activeEnvironmentId`
    changes, or the active region's env changes), the engine
    recomputes the environment state and notifies every attached
    `RenderView` to re-apply on its next frame.
  - `attachView(view)` / `detachView(view)` lifecycle so the
    engine knows which views need env-change notifications.

- `packages/render-web/src/view/RenderView.ts` (new, replacing
  the per-view pieces of WebRenderHost). Per-center-panel /
  per-visible-render-surface. Holds a reference to a
  `WebRenderEngine` and owns:
  - its own `THREE.Scene` (composition local to this view)
  - its own `THREE.Camera`
  - its own `WebGPURenderer` constructed with
    `{ device: engine.device }` — shares the GPU device
  - its own `RuntimeRenderPipeline` instance (driven by the
    engine's environment state on every env change)
  - its own DOM element (passed via `mount(element)`)
  - overlay subscriber teardowns
  - per-frame render loop (or callable `render()` under an
    outer loop the caller provides — same flexibility
    WebRenderHost offered)

- The old `createWebRenderHost(...)` factory is **deleted** in
  the same commit. No dual-export, no compatibility alias (same
  delete-over-coexist stance as the Story 36.4 `resolveSurface`
  rename). TypeScript catches every call site; each is migrated
  to the new shape in 36.0.2.

- **`WebRenderEngine` is store-agnostic.** `packages/render-web`
  has no `@sugarmagic/shell` dependency today; Stage 0 does not
  add one. Inversion of control: the engine exposes explicit
  imperative setters and the callers (Studio, published-runtime)
  own the subscription plumbing and push state in. This matches
  how `WebRenderHost` currently handles environment (via
  `applyEnvironment(region, contentLibrary, ...)`) — we keep that
  shape and extend it to cover asset sources and env-change
  notifications:

  ```ts
  export interface WebRenderEngine {
    readonly device: GPUDevice;
    readonly shaderRuntime: ShaderRuntime;
    readonly assetResolver: AuthoredAssetResolver;

    // Imperative setters — callers push state in. No store imports.
    setContentLibrary(library: ContentLibrarySnapshot): void;
    setAssetSources(sources: Record<string, string>): void;
    setEnvironment(
      region: RegionDocument | null,
      environmentOverrideId: string | null
    ): void;

    // Project-switch invalidation. Called by the caller's projector
    // when the active project changes (old project closes / new
    // project opens). See "Project-switch invalidation contract"
    // below for the exact semantics.
    resetForProjectSwitch(): void;

    // View lifecycle
    attachView(view: RenderView): void;
    detachView(view: RenderView): void;

    dispose(): void;
  }
  ```

  **Project-switch invalidation contract.** The engine is a
  process-singleton — it outlives any single project's lifetime.
  Some engine-owned state is legitimately per-project (cached
  THREE.Textures minted from the old project's file handle, the
  resolved Environment state derived from the old project's
  content) and MUST be invalidated when the project changes. Some
  engine-owned state is content-addressed and project-agnostic
  (compiled shader variants keyed by `shaderDefinitionId`, which
  embeds the project id by construction) and can legitimately
  survive project switches for efficiency. `resetForProjectSwitch`
  codifies the distinction rather than leaving it silent.

  Specifically, a `resetForProjectSwitch()` call:

  1. **Resets AuthoredAssetResolver fully.** Revokes every
     minted blob URL in the cache; calls `.dispose()` on every
     cached THREE.Texture so GPU resources are freed; clears the
     cache map; the resolver is ready to load fresh textures
     from the next project's file handle.
  2. **Clears active environment state.** The engine's current
     environment (sun direction, sky, fog, post-process chain
     config) is set to "unresolved"; until the caller calls
     `setEnvironment(...)` with the new project's data, attached
     views render against their default cleared environment, not
     a stale one from the previous project.
  3. **Does NOT clear the ShaderRuntime compiled-shader cache.**
     Shader cache keys embed project id in the shader definition
     id (`game:<projectId>:shader:<name>`), so cross-project
     collisions can't happen. Dead-weight entries for the old
     project's custom shaders are harmless and will age out
     naturally if they're never referenced again. The shader
     cache's `dispose()` method exists and can be called
     explicitly for a hard flush, but that's not the default.
  4. **Does NOT touch `GPUDevice` or per-view
     `WebGPURenderer`s.** GPU device allocation is expensive
     (~100ms in WebGPU); keeping it across project switches is
     the whole reason the engine is process-singleton. Views
     stay attached; their scenes persist until their owning
     workspaces unmount and clear them through the standard
     Epic 033 unmount path.

  **Expected caller behavior.** The Studio and runtime-target
  projectors (Story 36.0.2) detect project-switch by comparing the
  incoming session's `gameProject.identity.id` against the
  last-seen project id. When the id changes (including
  session becoming null, or null → session transition), the
  projector calls `resetForProjectSwitch()` BEFORE pushing the new
  state via `setContentLibrary` / `setAssetSources` /
  `setEnvironment`. Order matters: reset first, repopulate
  second, so no stale cache entry is live during the new
  project's first renders.

  Environment resolution (existing
  `resolveEnvironmentWithPostProcessChain` call currently in
  `WebRenderHost.runPendingEnvironment`) still runs inside the
  engine — it's pure compute against domain + runtime-core inputs
  that render-web already depends on. What moves OUT of the
  engine is the *decision of when to call it*, which becomes the
  caller's concern. Studio calls `setEnvironment(...)` from its
  projection-subscription path; the runtime-target calls it from
  its own lifecycle.

  When the engine's state changes (any of the three setters
  fire, or a combination of them), the engine notifies every
  attached `RenderView` so each view re-applies the updated
  environment on its next frame. Notification is a plain
  listener pattern on the engine — no `@sugarmagic/shell`
  import.

**Files touched:**
- `packages/render-web/src/engine/WebRenderEngine.ts` (new).
- `packages/render-web/src/view/RenderView.ts` (new).
- `packages/render-web/src/host/WebRenderHost.ts` — **deleted**.
- `packages/render-web/src/index.ts` — export
  `createWebRenderEngine`, `WebRenderEngine`, `createRenderView`,
  `RenderView`; remove the old `WebRenderHost` export.
- `packages/testing/src/render-engine.test.ts` (new) —
  construct a WebRenderEngine in a headless WebGPU test
  environment (or a mock-device harness if headless isn't yet
  available). Three suites:

  **Suite 1 — Multi-view basics:**
  - Attach two RenderViews with distinct scenes (different
    content).
  - Render both; assert both produce distinct output (not
    cross-contaminated: view A's scene doesn't appear in view
    B's render).
  - Push an environment change via `engine.setEnvironment(...)`;
    assert the notification reaches BOTH views and both
    re-render with the new environment on the next frame.
  - Assert the engine's device is the exact device used by
    both views' WebGPURenderers (pointer equality).

  **Suite 2 — Attach / detach isolation (the specific bug this
  architecture exists to prevent from regressing):**
  - Attach two views (A and B). Render both; both produce
    output.
  - **Detach view A. Render view B.** Assert B still produces
    output — **not blank, not error-raised, no stale state**.
    The specific assertion: B's rendered pixels after A's
    detach match B's pixels before A's detach (mock-device
    pixel comparison or, with real WebGPU, a scene-hash
    verification). This catches the real failure mode where
    one view's teardown reaches into shared engine state that
    a sibling view depends on (disposing a listener that
    serves all views, teardown of a shared GPU resource,
    corrupted env-notification list, etc.).
  - **While A is detached, push an environment change via
    `engine.setEnvironment(...)`.** Assert B receives the
    notification and re-renders; A — being detached — does not
    receive it (view listener lists correctly exclude detached
    views).
  - **Re-attach A.** Push another environment change. Assert
    both views now receive the notification and re-render.
    (Catches a different regression: attach/detach/reattach
    state corruption.)
  - **Dispose view A (not just detach).** Render B. Assert B
    still works. A fully-disposed view's teardown must not
    affect siblings any more than a detached one does.
  - **Detach and dispose all views.** Re-attach a fresh view.
    Render. Assert the fresh view works. (Catches: engine
    state after "empty" transition stays valid; re-attaching
    after a full teardown doesn't depend on ambient state from
    the previous views.)

  **Suite 3 — `resetForProjectSwitch` semantics:**
  - Load a texture for project A; confirm it's in the
    AuthoredAssetResolver's cache with a live blob URL and a
    non-disposed THREE.Texture.
  - Call `resetForProjectSwitch()`.
  - Confirm the blob URL has been revoked (attempting to fetch
    it fails with a network error), the THREE.Texture's
    `.dispose()` was called, and the cache is empty.
  - Confirm the engine's active environment state is cleared
    (attached views that query env state after reset get an
    "unresolved" sentinel, not the old project's environment).
  - Confirm the ShaderRuntime cache entries are NOT touched
    (compile a shader before reset, call reset, the compiled
    artifact is still present and reusable by the same key).
  - Load project B's texture; confirm a fresh Texture is minted
    from project B's bytes, no contamination from project A.

### 36.0.2 — Migrate every existing viewport to `RenderView`; push state into the engine from the callers

**Outcome:** Every caller of the old `WebRenderHost` moves to the
new `RenderView` bound to a shared `WebRenderEngine`. App
bootstrap creates the engine once; each viewport instance gets a
view bound to it. **The subscription plumbing that drives the
engine lives in the callers, not in render-web** — Studio owns a
single render-engine projector subscription that reads project/shell
state and calls the engine's explicit setters; the published-runtime
target owns its own equivalent projector. `packages/render-web` stays
store-agnostic.

Design viewports lose their hardcoded HemisphereLight /
DirectionalLight setup and start rendering against the project's
current environment — which is a **visible behavior change**:
switching environments at the project level now correctly lights
the Player / NPC / Item preview panels, not just the Build
viewport. This happens because the single Studio-side projector
pushes env into the single engine, and every attached view (Build
+ Design) re-applies.

Migrations:

- `apps/studio/src/App.tsx`:
  1. At app bootstrap, construct one `WebRenderEngine`. Hold a
     module-scoped reference (the engine is a process-singleton,
     not per-project).
  2. **Install the render-engine projector.** One
     `subscribeToProjection` subscription (Epic 033 helper) that
     watches `projectStore` (session content library, active
     region) + `shellStore` (active environment override) +
     `assetSourceStore` (blob URLs). The projector maintains a
     `lastSeenProjectId: string | null` local. On every
     subscription fire:
     - Compute the incoming project id (`session?.gameProject.identity.id ?? null`).
     - **If incoming id ≠ lastSeenProjectId, call
       `engine.resetForProjectSwitch()` FIRST.** This is the
       project-switch invalidation: old blob URLs revoked, old
       textures disposed, old environment state cleared, before
       any of the new state is pushed in. Catches both
       session → new-session (project switch) and session → null
       (project closed) and null → session (project opened).
     - Then call `engine.setContentLibrary(...)`,
       `engine.setAssetSources(...)`,
       `engine.setEnvironment(...)` with the current values.
     - Store the incoming id as `lastSeenProjectId`.

     One subscription, one conditional reset, three setter
     calls. This is the ONLY place Studio state crosses into the
     engine, and the ONLY place `resetForProjectSwitch` is
     called (aside from its unit tests).
  3. Viewport factories take the engine reference and construct
     RenderViews against it.

- `apps/studio/src/viewport/authoringViewport.ts` — replace
  `createWebRenderHost(...)` with
  `createRenderView({ engine, scene, camera, ... })`. The overlay
  registration pattern from Epic 033 is unchanged; it just binds
  against the RenderView now. **Does not subscribe to any store
  directly for engine state** — the App-level projector handles that.
- `apps/studio/src/viewport/playerViewport.ts` — replace the
  self-constructed `new WebGPURenderer(...)` + hardcoded
  HemisphereLight / DirectionalLight / stage-plane with a
  RenderView. The stage (plane + grid) stays as the view's scene
  composition; the environment (lights + sky + fog) comes from
  the shared engine via the notification path. If the author's
  selected environment is a "golden-hour-studio" preset, the
  Player preview now shows the player lit by golden hour. Same
  for NPC + Item viewports. No store subscription in the
  viewport itself — the App projector is the single source that
  pushes env state into the engine.
- `apps/studio/src/viewport/npcViewport.ts` — same migration.
- `apps/studio/src/viewport/itemViewport.ts` — same migration.
- `targets/web/src/runtimeHost.ts` — construct a
  `WebRenderEngine` at game bootstrap. Install the runtime's
  **own projector** — reads runtime state (whatever shape the
  published game uses for "current environment, current content
  library, current asset URLs"; different shape from Studio's
  stores) and calls the engine's setters. Same project-switch
  rule as Studio's projector: maintain a `lastSeenProjectId`, call
  `engine.resetForProjectSwitch()` when it changes, then push the
  new state. The published runtime rarely switches projects mid-
  session (typically one game per page load), but the same
  invariant holds for correctness on hot-reload and for hosts
  that do load multiple games per session. The primary gameplay
  camera lives on a `RenderView`. Future runtime-side viewports
  (picture-in-picture, screens, mirrors) would be additional
  views sharing the engine; not part of this story, but the
  split enables them.

Visual regression guard: before the migration lands, take
reference screenshots of (a) Build/Landscape workspace with a
populated region, (b) Build/Layout workspace with placed assets,
(c) Design/Player preview, (d) Design/NPC preview, (e)
Design/Item preview. After migration, the first two should be
pixel-identical (authoring viewport already used the engine's
env). The latter three should now correctly track the project's
current environment — confirm by switching envs and verifying
the preview lighting responds; compare against the authoring
viewport to confirm consistency.

**Files touched:**
- `apps/studio/src/App.tsx` — engine bootstrap.
- `apps/studio/src/viewport/RenderEngineProjector.ts` (new) — the
  Studio-side subscription that reads projectStore / shellStore /
  assetSourceStore via the Epic 033 `subscribeToProjection` helper.
  Maintains `lastSeenProjectId: string | null`; on every
  subscription fire, compares to the incoming project id and
  calls `engine.resetForProjectSwitch()` if changed, BEFORE
  calling `engine.setContentLibrary` / `setEnvironment` /
  `setAssetSources`. This file is the ONLY place in Studio where
  shell-store state flows into the engine AND the only site that
  invokes `resetForProjectSwitch` in production. Named for the
  CQRS / event-sourcing projector pattern: project upstream
  source-of-truth state onto the engine's derived read model.
- `apps/studio/src/viewport/authoringViewport.ts` — migrate to
  RenderView. Engine state comes in via the App projector; this
  viewport does not subscribe to stores for engine state.
- `apps/studio/src/viewport/playerViewport.ts` — migrate; delete
  hardcoded lighting; stage composition stays.
- `apps/studio/src/viewport/npcViewport.ts` — same.
- `apps/studio/src/viewport/itemViewport.ts` — same.
- `targets/web/src/RenderEngineProjector.ts` (new) — the
  runtime-target's equivalent projector. Reads whatever state
  shape the published runtime uses and pushes into the engine
  via the same setters; same project-switch rule as the Studio
  projector.
- `targets/web/src/runtimeHost.ts` — construct the engine at
  bootstrap; install the runtime projector; create RenderView for
  the primary gameplay camera.
- `packages/testing/src/viewport-migration-parity.test.ts` (new) —
  structural assertions mirroring the lint-guard rules, per the
  per-resource construction-site table:
  - `new WebGPURenderer(...)` appears ONLY in
    `packages/render-web/src/view/RenderView.ts` (many live
    instances at runtime is expected and fine).
  - `new ShaderRuntime(...)`, `createAuthoredAssetResolver(...)`,
    and GPU device acquisition appear ONLY in
    `packages/render-web/src/engine/WebRenderEngine.ts`.
  - `packages/render-web/` has no `@sugarmagic/shell` imports
    anywhere.
  Each check is a grep-style assertion; the lint guard enforces
  the same rules in CI. The test exists so local dev surfaces
  violations fast without needing the lint step.
- `packages/testing/src/render-engine-projector.test.ts`
  (new) — end-to-end projector test:
  - Set up a `projectStore` + `assetSourceStore` with project A
    loaded; mount the Studio render-engine projector against them;
    let the projector push initial state.
  - Load a texture into the AuthoredAssetResolver (simulating a
    view resolving project A's textures); confirm cache populated.
  - Call `projectStore.setActive(handleB, descriptorB, sessionB)`
    to switch to project B.
  - Assert the projector detected the id change, called
    `resetForProjectSwitch` exactly once, then called the three
    setters. Order verified.
  - Assert the AuthoredAssetResolver cache is empty after the
    switch (prior project A texture was disposed, its blob URL
    revoked).
  - Resolve a texture that exists in both projects with the same
    `definitionId` — assert the returned THREE.Texture references
    project B's bytes, not a stale project A artifact.
  - Additional case: transition from a loaded project to
    `projectStore.reset()` (session goes to null); assert
    `resetForProjectSwitch` fires.

### 36.0.3 — ADR + lint guard

**Outcome:** ADR 013 *Render Engine + Render View* documents:

- The split between the Studio-singleton engine and the
  per-view objects.
- The specific ownership list (device, ShaderRuntime,
  AuthoredAssetResolver, environment state on the engine; scene,
  camera, canvas, pipeline, overlays on the view).
- The invariant "one engine per app" — Studio has one, the
  published-runtime target has one; no intermediate "per-project"
  or "per-workspace" engine. Future viewports (rearview mirror,
  screen inside the game, etc.) are additional views bound to
  the existing engine.
- The invariant "views never construct their own device /
  ShaderRuntime / AuthoredAssetResolver" — they always consume
  them from their engine.
- **The "construction site vs. instance count" distinction**,
  to prevent misreading the lint guard:
  - `WebGPURenderer`: **one constructor site** (RenderView),
    **many live instances** (one per visible viewport). This is
    by design — multiple views means multiple renderers sharing
    the engine's device.
  - `GPUDevice`, `ShaderRuntime`, `AuthoredAssetResolver`:
    **one constructor site each** (Engine), **one live instance
    each** (one per app). The engine is a process-singleton and
    these live inside it.
  - Encodes directly into the lint guard's rules (scoped by
    source file), not derived from "count instances at runtime."
- **The inversion-of-control rule:** `packages/render-web`
  depends on `@sugarmagic/domain` and
  `@sugarmagic/runtime-core` (for semantic authored inputs) but
  not on `@sugarmagic/shell` (for Studio store concerns). The
  engine exposes imperative setters
  (`setContentLibrary` / `setEnvironment` / `setAssetSources`);
  callers — Studio's App projector, the runtime target's
  projector — own the subscription plumbing and push state in. This keeps
  the engine reusable across hosts with different state
  architectures and keeps the store layer free to evolve without
  breaking rendering.
- The environment-change flow: caller subscribes to its state
  → caller calls engine setter → engine recomputes env chain →
  engine notifies attached views → each view re-applies on its
  next frame.

Lint guard
`tooling/check-render-engine-boundary.mjs` that fails CI if any
of the following is violated. **The guard is about constructor
sites (the source file where the `new`-expression is written),
not about live instance counts at runtime.** RenderView
legitimately has many live instances — one per visible viewport
— and that's expected; the invariant is only that all of those
instances are created by one file.

- **WebGPURenderer construction is confined to one file.**
  `new WebGPURenderer(...)` is allowed ONLY in
  `packages/render-web/src/view/RenderView.ts`. Any other source
  file calling the constructor fails the guard. The view
  legitimately constructs many instances over the app's lifetime
  (one per `createRenderView` call); that's expected. The
  invariant is "no ad-hoc renderer allocation outside the view
  module," not "exactly one renderer lives at any moment."
- **GPUDevice acquisition is confined to one file.** The
  device-acquisition call (`navigator.gpu.requestAdapter(...).then(a =>
  a.requestDevice(...))` or equivalent) is allowed ONLY in
  `packages/render-web/src/engine/WebRenderEngine.ts`. Unlike the
  renderer this is genuinely singleton at runtime too: one engine
  per app, so one device per app.
- **ShaderRuntime construction is confined to one file.**
  `new ShaderRuntime(...)` is allowed ONLY in
  `packages/render-web/src/engine/WebRenderEngine.ts`. Also
  genuinely singleton at runtime (one per engine).
- **AuthoredAssetResolver construction is confined to one file.**
  `createAuthoredAssetResolver(...)` is allowed ONLY in
  `packages/render-web/src/engine/WebRenderEngine.ts`. Also
  genuinely singleton at runtime.
- **No imports of the deleted `WebRenderHost`.** Any file
  importing the deleted `WebRenderHost` type or
  `createWebRenderHost` factory fails the guard.
- **No Studio store layer in render-web.** Any file inside
  `packages/render-web/` importing from `@sugarmagic/shell` fails
  the guard. Store layer stays out of render-web; this is what
  enforces the inversion-of-control boundary structurally.

**Files touched:**
- `docs/adr/013-render-engine-and-view.md` (new) — or 014, if
  Epic 036's Layer Stack ADR takes 013. Renumber at authoring
  time, not a design concern.
- `docs/adr/README.md`.
- `tooling/check-render-engine-boundary.mjs` (new).
- `package.json` — wire the guard into the `lint` target.

---

## Stage 0 → Stage 1 testing pause

After 36.0.3 lands, the team exercises the authoring viewport
and every design viewport in app. Pause criteria before Stage 1
begins:

- No visual regression in authoring viewport. Landscape,
  layout, spatial workflows render identically to pre-split.
- Design viewports correctly inherit project environment.
  Switching the project's active environment changes lighting
  in the Player / NPC / Item preview panels, matching what the
  authoring viewport shows.
- **Mount / unmount isolation across live views — the
  regression we already hit once.** Open the Build workspace
  (authoring viewport live) + a Design workspace (player /
  NPC / item preview live) side-by-side. Switch design
  workspaces — e.g., player → NPC — which unmounts the player
  view and mounts the NPC view. Verify the authoring viewport
  continues rendering correctly through the switch: no blank
  frame, no stale state, no error in the console. Push an
  environment change while the transition is happening; confirm
  every currently-live view receives it. Structural test in
  `render-engine.test.ts` Suite 2 backs this up in CI; the
  in-app check is the "does it feel right" sign-off that
  surfaces regressions the test harness might miss.
- **Construction sites, not instance counts.**
  - `new WebGPURenderer(...)` appears in exactly one source file
    (`packages/render-web/src/view/RenderView.ts`). Multiple
    renderer instances at runtime are fine and expected — one
    per `createRenderView` call, one per viewport, many live
    concurrently. The invariant is that all of them come from
    the same file.
  - `new ShaderRuntime(...)` appears in exactly one source file
    (`packages/render-web/src/engine/WebRenderEngine.ts`) AND
    at runtime, exactly one instance lives per app.
  - `createAuthoredAssetResolver(...)` appears in exactly one
    source file (same as above) AND at runtime, exactly one
    instance lives per app.
  - GPU device acquisition happens in exactly one source file
    (same as above) AND at runtime, exactly one device lives
    per app.
  - All verified by the lint guard; manual `grep` confirms the
    construction-site rules too.
- **Project switch doesn't leak.** Open project A, let textures
  load into the viewport; close A and open project B; switch
  between the two a few times in rapid succession. Verified
  manually: no stale textures from A appear when B is active;
  no blob-URL leaks (the browser's Memory tab shows the
  resolver's cache holds only project B's entries when B is
  active). Structural verification: the projector test
  (`render-engine-projector.test.ts`) passes in CI.
- Stage 1's planned consumers — landscape scatter's
  InstancedMesh registry, Surface Library's preview viewport —
  are confident they can be built on top of the new split
  without architectural workarounds.

---

## Stage 1 — Foundation (v1)

Ships the layer-stack domain shape, landscape scatter, Surface
Library, and starter content. Team tests against the reference
images after 36.10 lands and before 36.11 begins.

### 36.1 — Domain types: Surface is a LayerStack

**Outcome:** `Surface` in `packages/domain/src/surface/index.ts`
becomes `{ layers: readonly Layer[]; context: SurfaceContext }`.
Layer variants (Appearance / Scatter / Emission), `LayerCommon`,
`Mask`, `BlendMode`, `AppearanceContent`, `ScatterContent`,
`EmissionContent` all defined. `SurfaceContext` (`"universal" |
"landscape-only"`) defined and `SurfaceBinding<C>` parameterized
by context. The old flat `Surface` union becomes
`AppearanceContent`. `ShaderOrMaterial` (used by
`Deformable.deform` / `Effectable.effect`) is untouched — it
references `AppearanceContent`'s `"material" | "shader"` variants
directly. Factories:
`createAppearanceLayer`, `createScatterLayer`, `createEmissionLayer`,
`createDefaultSurface` (one appearance-color base layer; context
= `"universal"`), and `createInlineSurfaceBinding` /
`createReferenceSurfaceBinding`. `deriveSurfaceContext(layers)`
helper computes the correct `context` given a layer set; factories
run it automatically. Any mutation helper that adds or edits a
layer must re-derive and re-store context — the invariant
(`"landscape-only"` iff any `splatmap-channel` mask) is stored but
always consistent with the layer contents.

**Files touched:**
- `packages/domain/src/surface/index.ts` — repurpose `Surface` to
  LayerStack shape; define `AppearanceContent` (former Surface
  union); define `Layer` variants + `Mask` + `BlendMode` +
  `SurfaceBinding`.
- `packages/domain/src/surface/layer.ts` — new; Layer factories.
- `packages/domain/src/surface/README.md` — update.
- `packages/testing/src/surface-layerstack.test.ts` (new) —
  structural-typing tests; base-layer invariant (factories reject
  a stack with a non-appearance / non-base layer 0); each layer
  kind's factory round-trips.

### 36.2 — `SurfaceDefinition` + scatter-type library primitives

**Outcome:** Three new content-library primitives:
`SurfaceDefinition`, `GrassTypeDefinition`, `FlowerTypeDefinition`.
Each gets its own slice on `ContentLibrarySnapshot`, its own
`createDefault*`, its own `get*` / `list*` accessors. `ContentDefinitionKind`
gains `"surface" | "grass-type" | "flower-type"`. Default content
library ships empty arrays for each; starter library content
lands in Story 36.9.

**Files touched:**
- `packages/domain/src/surface/surface-definition.ts` (new).
- `packages/domain/src/surface/grass-type.ts` (new).
- `packages/domain/src/surface/flower-type.ts` (new).
- `packages/domain/src/content-library/index.ts` — extend snapshot
  shape + normalizers + accessors.
- `packages/domain/src/index.ts` — re-export.
- `packages/testing/src/surface-library-primitives.test.ts` (new) —
  round-trip each primitive through save / load.

### 36.3 — Slots take `SurfaceBinding` (not flat Surface)

**Outcome:** `AssetSurfaceSlot.surface` becomes
`SurfaceBinding<"universal"> | null` and
`LandscapeSurfaceSlot.surface` becomes
`SurfaceBinding<SurfaceContext> | null` (both were `Surface | null`
in Epic 034). Because no users + no old projects (same stance as
Epic 034): in-place type replacement. No normalizer. Default
factories produce a `SurfaceBinding` wrapping a default
single-layer Surface with `context === "universal"`. Commands that
manipulated flat Surfaces now manipulate Layers or the top-level
binding, and re-derive `context` after every mutation.

**Mask-context enforcement implemented here** per the architecture
section's *Validation rules (mask context)*:

- **IO decoder** (`packages/domain/src/io/index.ts`): for every
  loaded Surface, run `deriveSurfaceContext(layers)` and fail the
  load loudly if the stored `context` field disagrees. Separately:
  for every AssetSurfaceSlot binding whose referenced
  SurfaceDefinition has `context === "landscape-only"`, fail the
  load with a typed error naming both the slot and the Surface.
- **Command executor**: `AddSurfaceLayer` / `UpdateSurfaceLayer` /
  `SetSurfaceBinding` commands recompute `context` via
  `deriveSurfaceContext`; reject commands that would bump a
  Surface to `"landscape-only"` while it is currently bound (or
  referenced via SurfaceDefinition) to any AssetSurfaceSlot.
- Type-level narrowing on the slot fields (`AssetSurfaceSlot.surface:
  SurfaceBinding<"universal"> | null`) is automatic from the 36.1
  type definitions; this story's type changes just slot them in
  at the use sites.

**Files touched:**
- `packages/domain/src/content-library/index.ts` —
  `AssetSurfaceSlot` field narrowed to
  `SurfaceBinding<"universal"> | null`.
- `packages/domain/src/region-authoring/index.ts` —
  `LandscapeSurfaceSlot` field accepts
  `SurfaceBinding<SurfaceContext> | null`.
- `packages/domain/src/commands/executor.ts` — add
  `AddSurfaceLayer`, `RemoveSurfaceLayer`, `ReorderSurfaceLayer`,
  `UpdateSurfaceLayer`, `SetSurfaceBinding` commands; each
  mutation helper re-runs `deriveSurfaceContext` and rejects
  context-violating commands with typed errors. Retire any old
  commands that manipulated flat Surfaces in-place.
- `packages/domain/src/io/index.ts` — IO decoder enforces three
  invariants on load: (1) `layers[0]` is appearance + base, (2)
  `Surface.context` matches `deriveSurfaceContext(layers)`, (3)
  every AssetSurfaceSlot binding resolves to a universal Surface.
  Each failure is a loud error naming the offending entity. Same
  pattern as Epic 034's Rule 1 defensive validation.
- `packages/testing/src/surface-binding-commands.test.ts` (new) —
  round-trip each new command; additional assertions for the
  context enforcement points:
  - Asserting `{ kind: "inline", surface: { layers: [/* no
    splatmap */], context: "universal" } }` assigns cleanly to an
    `AssetSurfaceSlot`; adding a splatmap-channel-masked layer to
    that same Surface rejects at command-executor time with a
    typed error.
  - Asserting a hand-edited snapshot with `context: "universal"`
    but a splatmap-channel mask in its layers fails the IO decoder
    loudly.
  - Asserting that a SurfaceDefinition with `context:
    "landscape-only"` referenced from an AssetSurfaceSlot fails
    the IO decoder loudly.

### 36.4 — Runtime: per-layer resolution + layer-stack compositor

**Outcome:** `runtime-core` gains four resolvers:
`resolveSurfaceBinding`, `resolveAppearanceLayer`,
`resolveScatterLayer`, `resolveEmissionLayer`. Each returns a
`ResolveResult` discriminated union (Epic 034 pattern). The old
`resolveSurface` is renamed to `resolveAppearanceLayer` (one-line
migration). `render-web`'s `ShaderRuntime` gains
`evaluateLayerStackToNodeSet` — walks N resolved appearance
bindings + masks + blend modes + opacities, evaluates each to a
`ShaderSurfaceNodeSet`, folds per-channel. Emission layers add to
the emissive channel. Mask evaluation lives in
`render-web/src/materialize/mask.ts`; blend math in
`materialize/layer-blends.ts`. No scatter realization yet — that's
Story 36.6.

**Files touched:**
- `packages/runtime-core/src/shader/bindings.ts` — four resolvers.
  The Epic 034 `resolveSurface` is **hard-renamed** to
  `resolveAppearanceLayer` in the same commit: no dual-export,
  no compatibility alias, no deprecation window. The repo is in
  active development, no users, no external consumers, Epic 034
  just shipped internally — carrying two names for one idea is
  just noise + a future cleanup task. TypeScript will flag every
  call site; each gets a one-line update in this story.
- `packages/runtime-core/src/index.ts` — re-export the new
  resolver names; remove the old `resolveSurface` export.
- `packages/render-web/src/ShaderRuntime.ts` —
  `evaluateLayerStackToNodeSet`.
- `packages/render-web/src/materialize/mask.ts` (new) — one
  function per `Mask` kind.
- `packages/render-web/src/materialize/layer-blends.ts` (new) —
  per-channel blend math for the five blend modes; normal always
  uses mix.
- `packages/testing/src/layer-stack-compositor.test.ts` (new) —
  single appearance layer; two-layer mix; multiply + mask;
  emission layer adds to emissive; unknown masks fail with
  diagnostic.

### 36.5 — Mesh-apply + landscape-apply consume layer stacks

**Outcome:** Both apply paths read `SurfaceBinding`, resolve it,
split layers by kind, call `evaluateLayerStackToNodeSet` for
appearance + emission, assign to the material. Scatter layers are
collected per-surface and handed off (landscape: realized in
Story 36.6; asset: logged as deferred).

**Files touched:**
- `packages/render-web/src/applyShaderToRenderable.ts` — replace
  the per-slot surface resolution with per-slot layer-stack
  evaluation; collect asset-slot scatter layers + log deferred.
- `packages/render-web/src/landscape/mesh.ts` — per-channel:
  resolve binding → split layers → evaluate appearance + emission
  stack → splatmap composite across channels. Collect scatter
  layers per channel for Story 36.6.
- `packages/testing/src/mesh-layerstack-apply.test.ts` (new) —
  asset with a two-layer stack (bark base + moss overlay with
  texture mask) renders correctly.
- `packages/testing/src/landscape-layerstack-apply.test.ts` (new) —
  landscape with a channel whose surface has emission layer
  composites correctly with splatmap weight.

### 36.6 — Landscape scatter realization (`GrassType` + `FlowerType`)

**Outcome:** Landscape controller, per region, walks every
channel's surface's scatter layers. For each scatter layer:
resolves the scatter binding, samples the splatmap + mask at a
grid matching the scatter type's density, builds an instance
buffer (position, scale, rotation, color-jitter seed), creates an
`InstancedMesh` with the tuft/flower mesh + a shader-graph
material (tip-base gradient + per-instance color + wind deform).
Wind deform reuses the `ShaderOrMaterial` binding shape on
`GrassType.wind` / `FlowerType.wind` — exactly Epic 034's
Deformable pattern applied to a scatter instance.

Instance mesh lifecycle: rebuilt when scatter layer, mask, or
splatmap changes. Cached per `(channelId, layerId)`.

Procedural tuft mesh (default for `GrassType.tuft.kind === "procedural"`):
builds a small triangle fan / triangle-strip cluster with N blades
each rotated around the tuft center, each a 3-vertex triangle with
curved Bezier-ish silhouette. 6-12 triangles per tuft. Normal
tilt trick (bend vertex normals outward) for the rounded painterly
look. One mesh per GrassType, reused across all instances.

Procedural flower head (default for `FlowerTypeDefinition.head.kind === "procedural"`):
circular petal arrangement, billboard or tilted plane with a
center color + petal color.

**Files touched:**
- `packages/render-web/src/landscape/scatter.ts` (new) —
  `buildScatterInstancesForLandscape`.
- `packages/render-web/src/landscape/tuft-mesh.ts` (new) —
  procedural tuft builder.
- `packages/render-web/src/landscape/flower-mesh.ts` (new) —
  procedural flower-head builder.
- `packages/render-web/src/landscape/mesh.ts` — wire in scatter
  realization; landscape controller manages an
  `InstancedMesh` registry per `(channelId, layerId)`.
- `packages/runtime-core/src/shader/bindings.ts` —
  `resolveScatterLayer` resolves the scatter type definition +
  its optional wind shader.
- `packages/testing/src/landscape-scatter.test.ts` (new) —
  landscape channel with a grass scatter layer produces an
  `InstancedMesh` with the expected instance count (within
  jitter tolerance); wind binding resolves; re-evaluation on
  mask change rebuilds.

### 36.7 — Layer stack editor: reusable primitives in `ui`, domain composition in `workspaces`

**Outcome:** Two-layer implementation that respects the codebase's
standing principle: **generic, editor-wide-reusable UI primitives
belong in `packages/ui` and get actively extracted during initial
implementation, not as a follow-up.** Building domain-aware
widgets directly in workspaces without looking for reusable bones
leads to parallel widgets, parallel bugs, and drifting
look-and-feel.

The split:

**`packages/ui` — generic primitives (plain-data props, no domain
imports, Mantine-only dependency):**

- **`SortableList<T>`** (new) — ordered list with drag-reorder,
  per-item toggle / duplicate / delete buttons, selection
  highlight. Takes `items: T[]`, `renderItem: (item, index) =>
  ReactNode`, `onReorder`, `onDelete`, `onToggle`, `onSelect`,
  `selectedId`. Fully generic. Used by the Layer stack editor;
  reusable anywhere else a reorderable list shows up later
  (scatter registry list, quest-node list, dialogue branches,
  any future "N of something in order" UI).
- **`LabeledSlider`** (new) — consistent `label + slider +
  current-value display` component with min/max/step. Thin wrap
  over Mantine's slider. Builds on top of a pattern that's
  currently re-implemented inline in several workspaces.
- **`KindTabs<K extends string>`** (new) — tabbed picker over a
  string-literal union with per-tab content render prop. The old
  SurfacePicker had this pattern hardcoded for
  Color/Texture/Material/Shader; extracting it means every future
  kind-picker (layer content kind, mask kind, scatter kind) uses
  the same widget and gets consistent tab behavior.
- **`MaskPreview`** (new) — small 2D heatmap preview. Takes a
  `sample: (u: number, v: number) => number` function and a
  resolution; renders a grayscale canvas. Generic because it
  only knows "scalar field in [0, 1]," nothing about what the
  field means.
- **Retire `packages/ui/src/components/SurfacePicker.tsx`** —
  flat tab-based picker doesn't match the layer-stack shape.
  Delete from the barrel export; call sites migrate below.

**`packages/workspaces/src/build/surfaces/` — domain-aware
composition (uses the ui primitives; reads domain types;
dispatches domain commands):**

- `SurfaceBindingEditor.tsx` — top-level editor for a slot's
  `SurfaceBinding`. Toggles inline ↔ reference; for inline,
  renders a domain-aware `LayerStackView`; for reference, a
  library picker.
- `LayerStackView.tsx` — composes `<SortableList<Layer>>` from
  `packages/ui`, passing domain-aware `renderItem` that shows the
  layer's kind badge, display name, enabled state. Dispatches
  `AddSurfaceLayer` / `RemoveSurfaceLayer` / `ReorderSurfaceLayer`
  / `UpdateSurfaceLayer` commands.
- `LayerDetailPanel.tsx` — selected-layer editor. Composes
  `<KindTabs>` for appearance-content kind selection (Color /
  Texture / Material / Shader), `<LabeledSlider>` for opacity,
  domain-specific content editors (color picker from existing
  `<ColorField>`, texture picker, material reference picker,
  scatter-type reference picker), the mask editor slot.
- `MaskEditor.tsx` — dispatches on `Mask.kind`. Each sub-editor
  is a local component that uses `<LabeledSlider>` /
  `<MaskPreview>` / `<ColorField>` from `packages/ui` for
  consistent widget shape. Stays domain-aware because it knows
  about TextureDefinition references, splatmap channel indices,
  etc.

The top bar of the `SurfaceBindingEditor` (inline / reference
toggle + library-reference picker) uses the existing `<Select>`
from Mantine; no new primitive needed for that.

**Working principle for this epic going forward.** During
implementation, whenever a UI pattern appears that could be
driven by plain data with no `@sugarmagic/*` imports, it goes
into `packages/ui`. This is an active search, not a passive
fallback. Two parallel widgets for the same visual idiom = a
bug waiting to happen + UI drift we'll pay for in polish time
later.

**Files touched:**
- `packages/ui/src/components/SortableList.tsx` (new) — generic.
- `packages/ui/src/components/LabeledSlider.tsx` (new) — generic.
- `packages/ui/src/components/KindTabs.tsx` (new) — generic.
- `packages/ui/src/components/MaskPreview.tsx` (new) — generic.
- `packages/ui/src/components/index.ts` — export the four new
  primitives; remove `SurfacePicker` export.
- `packages/ui/src/components/SurfacePicker.tsx` — **deleted**.
- `packages/workspaces/src/build/surfaces/SurfaceBindingEditor.tsx`
  (new).
- `packages/workspaces/src/build/surfaces/LayerStackView.tsx`
  (new).
- `packages/workspaces/src/build/surfaces/LayerDetailPanel.tsx`
  (new).
- `packages/workspaces/src/build/surfaces/MaskEditor.tsx` (new) —
  one sub-editor per `Mask.kind`, all composing `packages/ui`
  primitives.
- `packages/workspaces/src/build/surfaces/index.ts` (new) —
  barrel export.
- `packages/workspaces/src/build/landscape/index.tsx` — replace
  the old `<SurfacePicker>` call with `<SurfaceBindingEditor>`.
- `packages/workspaces/src/build/assets/` — replace the old
  `<SurfacePicker>` call with `<SurfaceBindingEditor>`, per-slot.
- `packages/testing/src/ui-sortable-list.test.ts` (new) —
  generic SortableList tests: drag-reorder, delete, toggle,
  selection. No domain types in the test.
- `packages/testing/src/surface-binding-editor.test.ts` (new) —
  render with sample layer stacks; assert drag-reorder produces
  the expected command; assert add-layer menu dispatches correct
  factory; assert the Mask editor dispatches correctly per kind.

### 36.8 — Surface Library workspace + full-fidelity preview

**Outcome:** New Build workspace peer to Material Library. Lists
SurfaceDefinitions; authors create, rename, duplicate, delete.
Edit view: layer stack editor + a 3D preview that **renders the
Surface exactly as it would render in the game** — full appearance
stack composite, full scatter realization, full emission, full
lighting. The preview is applied to author-selectable primitive
geometry: **plane**, **cube**, or **sphere**, picked from a small
control on the preview panel. Default is `plane` (matches the
landscape use case); cube and sphere are equally-fidelity previews
of the same Surface with different base geometry. "Import Material
as Surface" quick-action wraps an existing Material as a
single-appearance-layer Surface.

**Why full fidelity:** preview has no value if it lies about what
the game will render. A Surface that looks different in preview
and in-scene forces authors to iterate via deploy-and-reload,
which is what the preview workspace exists to avoid. Perf is not
a concern at preview scale (a cube is 12 triangles; even at full
scatter density the preview produces a few hundred instances in
a small viewport — trivial).

**Preview scatter samplers.** Scatter realization on the preview
geometry uses geometry-specific samplers (NOT the general
triangle-sampling pass that Stage 2 brings to asset slots — that
one is overkill for three well-known primitives):

- **Plane** → landscape-style 2D grid sampler over the plane's
  surface extent. Identical math to landscape scatter with a
  trivial 1-channel "always-1" splatmap. Smallest implementation.
- **Cube** → six-face grid sampler. For each of the six faces,
  project the 2D grid sampler onto the face using the face's
  orientation. Scatter instances get their tangent frame from
  the face normal so tufts stand up relative to the face.
- **Sphere** → Fibonacci-sphere sampler
  (`θ = i * goldenAngle, φ = acos(1 - 2*(i+0.5)/N)`). Deterministic,
  uniform distribution on the sphere surface. Instance up-vector
  = sphere surface normal at the sample point.

All three samplers live in
`apps/studio/src/viewport/surface-preview-samplers.ts` (new) —
preview-specific, not part of the general runtime scatter path.
~100 lines total.

**Masks on preview geometry.** Most mask kinds work transparently
on a plane (UV-based). Splatmap-channel masks don't apply (no
splatmap on a preview mesh — the editor renders splatmap-channel
masks as if channel weight = 1 everywhere, with a small note in
the mask editor that "splatmap masks only take effect when this
Surface is bound to a landscape channel"). Fresnel, vertex-color,
world-position gradient, texture, and height masks all render
truthfully.

The preview pipeline: a dedicated `SurfacePreviewViewport` that
mounts the selected primitive geometry under a neutral environment,
runs the full layer-stack compositor + scatter realization +
optional deform/effect from any referenced Material, consumes the
edited SurfaceDefinition through the existing viewport-store
subscription model (Epic 033), re-renders live. Mounts as a
`RenderView` on the shared `WebRenderEngine` (Stage 0) —
inherits the app's GPU device, ShaderRuntime compilation cache,
AuthoredAssetResolver texture cache, and project environment
automatically. Zero device duplication; shaders compiled for the
landscape's render of this same Surface serve this preview for
free.

**Files touched:**
- `packages/workspaces/src/build/surfaces/` (new workspace folder).
- `apps/studio/src/viewport/surfacePreviewViewport.ts` (new) —
  small preview viewport; subscribes to the projection slice
  exposing the currently-edited SurfaceDefinition + the selected
  preview geometry kind. Wires the scatter-realization path
  against the geometry-specific samplers below.
- `apps/studio/src/viewport/surface-preview-samplers.ts` (new) —
  three samplers (plane / cube / sphere) that produce scatter
  instance positions for a given scatter density + mask.
- `apps/studio/src/App.tsx` — register the new workspace + preview
  viewport; add a shell-store slice exposing "currently editing
  surface" + "preview geometry kind" for the preview subscription.
- `packages/shell/src/surface-editing/index.ts` (new) — tiny store
  for the current-edited-surface id and the selected preview
  geometry (`"plane" | "cube" | "sphere"`, default `"plane"`).
  Follows the Epic 033 store-per-concern pattern.
- `packages/workspaces/src/build/surfaces/SurfaceLibraryView.tsx`
  (new) — library list + edit view; includes a primitive-geometry
  toggle (plane / cube / sphere segmented control) above the
  preview viewport.
- `packages/testing/src/surface-preview-samplers.test.ts` (new) —
  each sampler produces the expected instance count at known
  density; plane-sampler instances all have up-vector ≈ +Y;
  cube-sampler has instances across all six face orientations;
  sphere-sampler is evenly distributed (Fibonacci check).

### 36.9 — Starter library content

**Outcome:** Ship an out-of-the-box library so a fresh project
has something to drop in. Registered as built-in defaults in
`createDefaultContentLibrarySnapshot`:

- **GrassTypes:** `short-lawn`, `wild-tall`, `autumn-golden`,
  `dry-sparse`.
- **FlowerTypes:** `white-meadow`, `yellow-buttercup`,
  `purple-wildflower`.
- **SurfaceDefinitions:** `wildflower-meadow` (green ground + wild
  tall grass + white-meadow flowers + warm emission),
  `autumn-field` (autumn-golden grass + yellow-buttercup sparse +
  muted emission), `mossy-bark` (bark material + procedural moss
  scatter placeholder until a MossScatter kind ships in v2 — or
  short-lawn pretending to be moss with greener tip color for
  now), `manicured-lawn` (short-lawn at high density, no flowers),
  `clover-patch` (short-lawn + scaled-down flowers).

Visual bar: running the editor on a fresh project, switching to
the Surface Library, previewing `wildflower-meadow` on the default
plane geometry looks something like the reference images — chunky
painterly grass, visible wildflowers, warm tint. Toggling the
preview to cube / sphere shows the same Surface wrapped on those
primitives with scatter correctly following surface normals.

**Files touched:**
- `packages/domain/src/content-library/builtins/grass-types.ts` (new).
- `packages/domain/src/content-library/builtins/flower-types.ts` (new).
- `packages/domain/src/content-library/builtins/surface-definitions.ts` (new).
- `packages/domain/src/content-library/index.ts` — register in
  `createDefaultContentLibrarySnapshot`.

### 36.10 — ADR + boundary lint + cleanup

**Outcome:** ADR 013 *Surface-as-LayerStack*: documents the shape,
the three layer kinds, the base-layer invariant, the split between
per-slot layer composition and per-thing pipeline stages (Epic
034's traits), and the distinction between a layer stack's internal
compositing and landscape splatmap compositing. Lint guard
`tooling/check-surface-layerstack-boundary.mjs` that fails CI if
(a) `Surface` is reshaped back to a flat discriminated union, or
(b) a code path constructs a slot surface that isn't wrapped in a
`SurfaceBinding`. Remove any dead shader-graph paths assuming a
flat Surface.

**Files touched:**
- `docs/adr/013-surface-as-layer-stack.md` (new).
- `docs/adr/README.md`.
- `tooling/check-surface-layerstack-boundary.mjs` (new).
- `package.json` — lint target.

---

## Stage 1 → Stage 2 testing pause

After 36.10 lands, the team exercises the Surface Library, the
SurfacePicker, and a landscape scene dressed with starter-library
Surfaces in app. Pause criteria before Stage 2 begins:

- Preview cube for each starter Surface matches reference-image
  aesthetic (subjective sign-off from product + art).
- Layer stack editor ergonomics: authors confirm the flow feels
  like Substance Painter / Photoshop, not like a debug inspector.
- No domain-shape surprises that would force a migration after
  v2 code builds on top. If the team finds a layer-kind or
  mask-kind they reach for that doesn't exist, flag it here and
  decide whether to slip it into 36.11–36.15 before Stage 2
  starts or defer to a future epic.
- CPU scatter perf on a reference landscape (medium density,
  2–3 scatter layers) holds 60fps on reference hardware. If it
  doesn't, Stage 3's compute scatter escalates in priority and
  Stage 2 may re-order around the perf cliff.

---

## Stage 2 — Authoring Power (v2)

Ships the authoring completeness that Stage 1 deliberately
deferred: scatter on asset mesh slots (moss on a roof), painted
masks, per-slot layer overrides on referenced Surfaces, rocks,
and procedural-noise masks. After this stage the authoring model
is considered "feature complete" — everything the reference images
imply is expressible in the editor.

### 36.11 — Asset-slot scatter realization (scatter on a roof)

**Outcome:** `applyShaderToRenderable` gains a mesh-triangle
sampler. For each scatter layer on an asset mesh slot, walk the
triangles belonging to that slot's material index, weight them by
area, generate Poisson-disk-ish (or uniform-random at density)
instance positions on triangle surfaces, build an `InstancedMesh`
parented under the asset's scene group with local-space
position/tangent-frame/scale/rotation per instance. Landscape
scatter (Stage 1) stays unchanged; this story adds the parallel
path for asset slots.

Mask evaluation for asset-slot scatter has a narrower set of
working mask kinds — `splatmap-channel` doesn't apply (no
splatmap exists on assets) and is returned as a compile
diagnostic. `always`, `texture`, `fresnel`, `vertex-color-channel`,
`height` (world-Y) all work.

Cache per `(assetDefinitionId, slotName, scatterLayerId)`. Invalidate
on: asset re-import, slot binding change, scatter layer mutation
(type, density, mask). Reuses the existing shader-signature cache
pattern from `applyShaderToRenderable`.

**Files touched:**
- `packages/render-web/src/asset-scatter.ts` (new) —
  `buildScatterInstancesForAssetSlot(asset, slotIndex, scatterLayer,
  scatterBinding, mask, contentLibrary) → InstancedMesh`.
- `packages/render-web/src/applyShaderToRenderable.ts` — after
  the surface layer stack applies, iterate scatter layers and
  build InstancedMeshes; remove the Stage-1 "deferred" warning.
- `packages/render-web/src/mesh-triangle-sampler.ts` (new) —
  area-weighted triangle sampling helper; shared between tests
  and the runtime.
- `packages/testing/src/asset-slot-scatter.test.ts` (new) —
  import a two-slot asset (trunk + roof); bind the roof slot to a
  Surface with a moss scatter layer; assert the resulting scene
  subgraph has an InstancedMesh with instance count ≈ expected
  density × triangle area within a tolerance.

### 36.12 — Painted mask textures

**Outcome:** Painted masks remain a real `Mask` variant, but they
are only authorable on **inline application-site surfaces**. A
shared `Surface Library Reference` stays shared and read-only at
the application point. If the author wants to customize that
channel/slot, they click **Make Local** to convert the binding to
an `Inline Surface`, and then edit the actual local layer stack
there. That local inline surface may use `{ kind: "painted";
maskTextureId }`; reusable `SurfaceDefinition`s in the Surface
Library may not.

This is intentionally simpler than the old override model:

- `Reference` means "use the library surface exactly as-is."
- `Make Local` means "fork a local inline copy for this specific
  channel or slot."
- Painted masks live only on that local inline copy.

No per-layer bounded override payload, no "Override here" toggles,
no split between library layer + local override layer. One source
of truth for shared surfaces, one obvious path for local
customization.

**Storage ownership — where the pixels actually live.** Painted
mask pixels still live as **IO-managed PNG files** in the project
directory, referenced by `MaskTextureDefinition`. They do **not**
embed binary data inside the project document.

**`MaskTextureDefinition` shape:**

```ts
export interface MaskTextureDefinition {
  definitionId: string;
  definitionKind: "mask-texture";
  displayName: string;
  source: { relativeAssetPath: string }; // e.g. "masks/abc123.png"
  format: "r8" | "rgba8";
  resolution: [number, number];
}
```

**Project directory layout.** Mask files live at
`<project-root>/masks/<definitionId>.png`. The `masks/` folder is
created lazily on first paint operation.

**Paint stroke flow (the data path):**

1. Author binds a Surface to a landscape channel or asset slot.
2. If the binding is a library reference and they want to
   customize it, they click **Make Local**. The binding becomes an
   `Inline Surface` seeded from the referenced library
   `SurfaceDefinition`.
3. On one of that inline surface's layers, author chooses
   `Mask Type = Painted`.
4. If `maskTextureId` is null, the UI creates a new
   `MaskTextureDefinition`, writes a blank PNG to
   `masks/<id>.png`, and stores the new `maskTextureId` on the
   inline layer's mask.
5. Author clicks **Paint in Viewport**. Brush input now targets
   that specific inline layer on that specific application site.
6. During drag, strokes accumulate into an in-memory canvas and
   preview live in the viewport.
7. On pointerup, the updated canvas is written back to the PNG via
   `packages/io`, `assetSourceStore` refreshes the blob URL, and
   render-web rebinds the updated texture.

**Which surface is the author brushing on?** Only real
application-site inline surfaces:

- Inline surface on a landscape channel → brush raycasts the
  landscape mesh in terrain/world paint space; the painted mask
  gates one layer *inside that channel*.
- Inline surface on an asset slot → brush raycasts the placed
  asset mesh at that slot's UVs; the painted mask gates one layer
  inside that slot's local inline surface.

The Surface Library preview is **not** a painted-mask authoring
surface in v2. Reusable library surfaces may use procedural masks
(`Noise`, `Voronoi`, `Gradient`, etc.), but custom painted masks
are application-owned local variation.

**Paint resolution.** `512×512 R8` is the default, but authors
choose per-site resolution on creation (`512`, `1024`, `2048`).

**Save/load + cleanup.** `MaskTextureDefinition`s serialize as
metadata only. The backing PNG is already on disk. On save,
Sugarmagic reconciles live inline painted-mask references and
deletes orphaned `MaskTextureDefinition`s and `masks/*.png` files
that are no longer reachable from any inline application-site
surface.

**Files touched:**

- `packages/domain/src/surface/mask.ts` — keep `painted` as a real
  mask source, but document/runtime-check that reusable library
  surfaces may not contain it.
- `packages/domain/src/content-library/index.ts` —
  `MaskTextureDefinition` in the content library and
  load-normalization that rejects painted masks inside reusable
  `SurfaceDefinition.surface`.
- `packages/io/src/masks/index.ts` — blank/create/read/write mask
  PNG helpers.
- `packages/io/src/project-lifecycle/index.ts` — save-time
  reconciliation of orphaned painted mask definitions/files.
- `packages/shell/src/viewport/index.ts` — active addressed
  `maskPaintTarget` slice for the currently painted inline layer.
- `apps/studio/src/viewport/overlays/mask-paint.ts` — viewport
  brush overlay for inline landscape-channel and asset-slot layers.
- `packages/workspaces/src/build/surfaces/MaskEditor.tsx` — only
  show `Painted` in inline application-site editing, not in the
  Surface Library.
- `packages/testing/src/painted-mask.test.ts` — verify blank mask
  creation, viewport writeback round-trip, and save-time orphan GC.

### 36.13 — Reference bindings stay shared; `Make Local` converts them to inline surfaces

**Outcome:** `SurfaceBinding.reference` stays simple:

```ts
type SurfaceBinding =
  | { kind: "inline"; surface: Surface }
  | { kind: "reference"; surfaceDefinitionId: string };
```

There is **no** `layerOverrides` model. If authors want a local
variation, they make the binding local and edit the resulting
inline surface directly.

**Authoring flow:**

1. Pick `Surface Library Reference`.
2. Choose a reusable `SurfaceDefinition`.
3. If shared behavior is correct, stop there.
4. If local variation is needed, click **Make Local**.
5. Sugarmagic clones the referenced `SurfaceDefinition.surface`
   into an `Inline Surface`.
6. The author now edits that local layer stack directly
   (including painted masks, which are only valid here).

This is a deliberate product simplification:

- no "Override layer here" switch
- no override diagnostics or orphan override bookkeeping
- no runtime merge semantics
- no confusion about whether a mask is on the shared surface or a
  local override shadow-copy

The tradeoff is explicit and acceptable: once a binding is made
local, it no longer live-tracks future edits to the library
surface. That is the point. Shared vs local is visible and
intentional.

**Files touched:**

- `packages/domain/src/surface/index.ts` — remove
  `layerOverrides` from `SurfaceBinding.reference`.
- `packages/runtime-core/src/shader/bindings.ts` — resolve
  references directly; delete `applyLayerOverride(...)` path and
  associated diagnostics.
- `packages/workspaces/src/build/surfaces/SurfaceBindingEditor.tsx`
  — replace the override panel with a `Make Local` action that
  clones the selected referenced surface into an inline binding.
- `packages/workspaces/src/build/surfaces/SurfaceLibraryView.tsx`
  — Surface Library stays reusable and shared; it does not expose
  painted-mask authoring.
- `packages/testing/src/surface-localize.test.ts` (new) — verify
  that `Make Local` clones the referenced surface into an inline
  binding and that later edits to the local inline surface do not
  mutate the library `SurfaceDefinition`.

### 36.14 — `RockTypeDefinition` + rocks scatter

**Outcome:** Fourth scatter kind. `RockTypeDefinition` structurally
parallels `GrassTypeDefinition` / `FlowerTypeDefinition` but
defaults to low density, heavy scale jitter, asset-mesh-reference
(rocks are usually hand-modeled, not procedural). Add
`{ kind: "rocks"; rockTypeId: string }` to the `ScatterContent`
union. One starter rock type in the library:
`small-field-stones`. All existing scatter infrastructure (CPU
scatter in Stage 1, asset-slot scatter from 36.11, mask evaluation,
wind on rocks = null since rocks don't sway) works unchanged — the
runtime dispatches on `scatterContent.kind`.

**Files touched:**
- `packages/domain/src/surface/rock-type.ts` (new).
- `packages/domain/src/surface/index.ts` — extend `ScatterContent`.
- `packages/domain/src/content-library/index.ts` —
  `rockTypeDefinitions[]` slice.
- `packages/domain/src/content-library/builtins/rock-types.ts`
  (new) — `small-field-stones` starter.
- `packages/runtime-core/src/shader/bindings.ts` —
  `resolveScatterLayer` handles `kind: "rocks"`.
- `packages/render-web/src/landscape/scatter.ts` +
  `packages/render-web/src/asset-scatter.ts` — instance-build path
  handles the rocks case (same shape, different mesh source).
- `packages/testing/src/rocks-scatter.test.ts` (new).

### 36.15 — Procedural-noise masks

**Outcome:** Three new Mask variants for organic transitions:
- `{ kind: "perlin-noise"; scale: number; offset: [x, y];
     threshold: number; fade: number }` — Perlin at scale,
  thresholded into a soft mask.
- `{ kind: "voronoi"; cellSize: number; borderWidth: number }` —
  Voronoi cell edges (for clump-edge masks, "patches of X").
- `{ kind: "world-position-gradient"; axis: "x" | "y" | "z";
     min: number; max: number; fade: number }` — arbitrary-axis
  gradient (for north-facing-slope moss, gradient transitions).

All three materialize in `render-web/src/materialize/mask.ts` as
TSL expressions — no new runtime-core work needed beyond the mask
kind registration.

**Files touched:**
- `packages/domain/src/surface/mask.ts` — three new variants.
- `packages/render-web/src/materialize/mask.ts` — three new
  materializers.
- `packages/workspaces/src/build/surfaces/MaskEditor.tsx` —
  add sub-editors for the three new Mask kinds (MaskEditor lives
  in workspaces, not `packages/ui`, per the boundary in Story
  36.7).
- `packages/testing/src/procedural-masks.test.ts` (new) —
  compile + evaluate each mask at a known world position; assert
  expected scalar output.

---

## Stage 2 → Stage 3 testing pause

After 36.15 lands, the team exercises asset-slot scatter, painted
masks, overrides, rocks, and procedural masks on realistic scenes.
Pause criteria before Stage 3 begins:

- Can authors build a grass-on-roof scene end-to-end without
  hitting workflow blockers?
- Do painted masks hold up under rapid brush input? No UI lag,
  no lost strokes, no phantom painting into the wrong layer?
- Frame-time budget on a full Stage-2 scene (landscape + several
  assets with scatter, layered Surfaces, painted masks): record
  baseline. Stage 3 targets 60fps; Stage 2's baseline tells us
  how much the compute-scatter work has to buy back.
- Asset re-import correctly invalidates per-asset scatter caches?
  Does the system handle a mesh topology change without orphaned
  instance data?
- Art review: is the game looking the way we want it to look?
  If yes, proceed to Stage 3 (scale + reactivity). If not, pause
  the epic and address the art gap before adding more runtime
  code.

---

## Stage 3 — Scale & Reactivity (v3)

Moves scatter from CPU-built instance buffers to GPU-driven
pipeline: compute-shader scatter + indirect draw, culling and LOD
done on the GPU, player / NPC displacement that actually bends
grass away as characters move through it. After this stage the
epic is done.

### 36.16 — GPU compute scatter + indirect draw + culling

**Outcome:** Move the scatter instance-buffer build out of CPU and
into a WebGPU compute pass. A `ScatterComputePipeline` in
`render-web`:

1. **Input buffers** (one set per scatter layer per owner):
   - density grid / UV sample grid (derived from mask at build
     time, uploaded once and updated on mask change)
   - terrain height sampler (landscape) or triangle surface
     sampler (asset) for positions
   - per-layer params (density, jitter ranges, color jitter seed)
   - camera frustum (per frame)
2. **Scatter compute pass**: each thread computes one candidate
   instance. Samples mask → density → rejects below threshold.
   Computes jittered position / scale / rotation / color seed.
   Writes into a **candidate instance buffer**.
3. **Visibility cull + compaction (4 dispatches per frame)**:
   - `markVisible` — per-candidate frustum + distance test, writes a
     0/1 flag into `frameActive[i]`.
   - `scanLocal` — per-workgroup inclusive prefix-sum over
     `frameActive[]` in workgroup-shared memory. Writes each thread's
     exclusive offset within its workgroup to `localOffsets[i]` and
     the workgroup total to `workgroupPartials[wgid]`.
   - `scanPartials` — single-workgroup inclusive scan over the
     partials array. Writes `workgroupOffsets[wgid]` (exclusive scan)
     plus the grand total to `visibleCount[0]` AND directly into
     `indirectDrawArgs[1]` (the instanceCount the GPU draws).
   - `scatterCompact` — visible candidates write their matrix / color
     / origin to `visibleMatrices/Colors/Origins[workgroupOffsets[wgid]
     + localOffsets[tid]]`. Output order is **deterministic** (sample
     index order) — no atomicAdd race.
4. **Indirect draw**: `setIndirect(indirectDrawArgs)` on the
   InstancedMesh's geometry; WebGPU reads the instanceCount written
   by `scanPartials` each frame, no CPU round-trip.

CPU becomes the orchestrator (one dispatch per scatter layer per
frame for the visibility pass; the scatter pass itself only runs
when mask / density / layer params change). 500K+ instances
across multiple layers stays within frame budget.

Follows the pattern demonstrated by the Codrops "False Earth"
project (1M grass blades in TSL via storage buffers + indirect
draw + compute culling) and the Ghost of Tsushima approach
described in the GDC 2021 talk, scaled to Sugarmagic's needs.

**Mesh type and instancing mechanism — canonical pattern (locked
in during 36.16 implementation).** The scatter rendered mesh is
`THREE.InstancedMesh`. `mesh.instanceMatrix` and
`mesh.instanceColor` are assigned to the
`StorageInstancedBufferAttribute` instances from the visible
buffer set; `setIndirect(indirectDrawArgs)` drives the actual
instance count each frame from the `scanPartials` output.

**Compaction must be deterministic — no atomicAdd packing.** A
naive cull pass that uses `atomicAdd(visibleCount, 1)` to assign
each visible candidate an output slot produces a non-deterministic
slot order across frames (the order parallel workgroups complete
the atomic op is implementation-defined). For BLEND-mode foliage —
e.g. Grass Surface 6 (`blendMode: "blend"` → `transparent: true`,
`depthWrite: false`) — alpha blending accumulates in instance
order, so non-deterministic order produces severe TV-static
flicker. The prefix-sum compaction above gives a stable
sample-index ordering: visible[k] always corresponds to the same
candidate sampleIndex j across frames, so the blend output is
stable. MASK-mode foliage tolerates non-determinism better
(depthWrite + alphaTest hides most order effects) but the surface
preview viewport — where each blade is only a few pixels wide —
makes the variance visible even in MASK mode. Keep the compaction
deterministic for both modes.

**Per-layer ceiling: 65,536 candidates.** The single-level
partials scan covers up to `SCATTER_SCAN_WORKGROUP_SIZE *
SCATTER_SCAN_WORKGROUP_SIZE = 65,536` candidates (workgroup size
256). Above this cap, `createScatterComputePipeline` returns
`null` and the CPU fallback in `scatter/index.ts` takes over,
with a console warning. Lifting the cap requires a recursive
partials scan or subgroup intrinsics on Chrome 134+; deferred to
a future story (the same one that revisits the LOD ceiling).

`InstancedMesh` is required because of how Three's WebGPU
backend handles mat4 vertex attributes: WGSL doesn't allow
`@location` on `mat4x4<f32>` (only scalars and vectors), and
`THREE.InstancedMesh` is the only path that auto-splits the
mat4 instance attribute into 4 vec4 attribute slots in the
generated WGSL. Using a plain `THREE.Mesh` with
`setAttribute("instanceMatrix", visibleMatrices)` produces a
WGSL validation error on the mat4 attribute. The
`StorageInstancedBufferAttribute` extends
`InstancedBufferAttribute`, so assigning it to
`mesh.instanceMatrix` routes through Three's optimized
mat4-splitting code path AND remains writable from compute via
storage()-node bindings declared elsewhere in the pipeline.
One GPU buffer, two binding views — compute writes via
storage, render reads via instance attribute.

**Why NOT wrap `material.positionNode` to apply the instance
matrix manually.** Tried and rejected during this story.
Reading the visible-matrix storage buffer via
`storage().element(instanceIndex)` in the wrapped positionNode
adds storage bindings to the vertex stage — and Three's
`MeshStandardNodeMaterial` already brings enough storage
bindings (lights, shadows, scene state) that any added storage
push the count past the WebGPU per-stage limit (observed at
16 storage buffers when the limit was 10 on this hardware).
Routing instance state through `mesh.instanceMatrix` /
`mesh.instanceColor` instead keeps the per-instance reads in
the vertex-attribute binding category, which has a much higher
per-stage limit.

**Storage buffer count discipline.** The cull pass uses 9
storage buffers (sample × 3, candidate × 5, visibleCount = 9)
and the device must be requested with
`maxStorageBuffersPerShaderStage` ≥ 9. The default WebGPU
limit is 8; engine startup requests up to 10 (capped at the
adapter's reported max) at device-creation time. If the
adapter doesn't support ≥ 9, GPU compute pipeline creation
fails at the storage-binding stage — the legitimate CPU path
fallback at `scatter/index.ts` then takes over with its
existing warning, the only legitimate fallback case.

**`instanceOrigin` carry-forward (resolved during Stage 1/2
wind-shader iteration).** The Stage-1 CPU scatter path bakes a
custom `instanceOrigin: vec2` `InstancedBufferAttribute` into
each scatter geometry — per-blade world XZ — because TSL's
`positionWorld` in the vertex stage doesn't include the
per-instance matrix on the InstancedMesh + NodeMaterial path
(observed during foliage-wind work). The wind-sway materializer
reads this attribute via `attribute("instanceOrigin", "vec2")` to
phase per-blade ambient noise. The compute pipeline emits the
equivalent: the compute cull pass appends per-visible-instance
world XZ into a `visibleOrigins` storage buffer that's also
bound to the geometry as `instanceOrigin` via `setAttribute`.
Unlike `mesh.instanceMatrix` (where Three has special handling
that conflicts with storage buffers), regular instanced
geometry attributes can be storage-backed without issue —
the renderer reads them through the normal vertex-attribute
binding path. So `wind-sway`'s existing
`attribute("instanceOrigin", "vec2")` call works unchanged on
both Stage-1 CPU and Stage-3 GPU paths.

**Pipeline side-effect: makes MSAA + alphaToCoverage feasible.**
While the compute pipeline is being plumbed, the underlying
WebGPU render configuration is being touched anyway. Story
36.16b (below) takes the opportunity to enable MSAA on the
scenePass and apply `alphaToCoverage` to foliage materials —
fixes the alpha-test sub-pixel shimmer documented as a TODO in
`packages/render-web/src/ShaderRuntime.ts:applyNodeSetToMaterial`.
Splitting it into its own story keeps the compute scatter
work auditable on its own.

**Files touched:**
- `packages/render-web/src/scatter/compute-pipeline.ts` (new) —
  full pipeline scaffold; TSL compute kernels for build candidates
  + markVisible + scanLocal + scanPartials + scatterCompact;
  rendered mesh is `THREE.InstancedMesh` with `setIndirect`-driven
  instancing reading from `indirectDrawArgs` (instanceCount written
  per frame by `scanPartials`). `mesh.instanceMatrix` and
  `mesh.instanceColor` are assigned the visible-buffer storage
  attributes directly (one GPU buffer, two binding views — compute
  writes via storage, render reads via instance attribute).
  `visibleOrigins` storage is bound to the geometry as
  `instanceOrigin` via `setAttribute` for the wind-sway
  materializer.
- `packages/render-web/src/scatter/instance-buffer.ts` (new) —
  GPU buffer lifecycle (alloc, resize, update). Owns the per-frame
  compaction-state buffers (`frameActive`, `localOffsets`,
  `workgroupPartials`, `workgroupOffsets`) in addition to the
  candidate / visible / indirect-args buffers.
- `packages/render-web/src/landscape/scatter.ts` — rewire to use
  the compute pipeline; the Stage-1 CPU path stays as a fallback
  for environments without WebGPU compute shaders (document as a
  graceful degradation path, not a primary route).
- `packages/render-web/src/asset-scatter.ts` — same rewire.
- `packages/render-web/src/view/RenderView.ts` — `setCamera`
  identity guard. Found during 36.16 perf debugging: the runtime
  host calls `renderView.setCamera(camera)` every frame with the
  same camera object (its transform updates, not the reference);
  the previous implementation unconditionally bumped the
  environment-state version, forcing `applyPostProcessStack` +
  `markSceneMaterialsDirty` to re-run every frame. That ate ~19ms
  of CPU per frame and capped FPS at ~51 even on an empty scene.
  The guard skips the dirty-bump when the camera reference hasn't
  changed.
- `packages/testing/src/compute-scatter.test.ts` (new) — run a
  known mask + density through the compute pass; read back the
  instance buffer; assert instance count matches CPU-path count
  within tolerance; assert frustum culling drops instances
  outside the test camera frustum; assert that the wind-sway
  vertex shader receives correct per-instance world XZ in the
  compute path (regression guard for the `instanceOrigin`
  carry-forward).

**Implementation arc (retrospective).** The first cut of 36.16
shipped with `atomicAdd`-based packing into a contiguous visible
range and indirect-draw. It rendered correctly under most camera
angles but produced severe per-frame flicker on Grass Surface 6
(BLEND mode) and a subtler shimmer on MASK-mode foliage in the
small surface preview viewport. Investigation traced the flicker
to the non-deterministic ordering of `atomicAdd` returns under
parallel workgroup execution: visible[k] mapped to a different
candidate sampleIndex each frame, so alpha-blended pixels mixed
in different orders frame-to-frame. A spike validated that
`workgroupArray` + `workgroupBarrier` + a Hillis-Steele inclusive
scan all work correctly in TSL on three.js v0.183.2 (the
primitives are exported but had not been exercised in this
codebase). The fix replaced the atomic compaction with the
two-level deterministic prefix-sum compaction documented above.
Same indirect-draw mechanism, deterministic visible-slot order,
no flicker.

### 36.16b — MSAA + `alphaToCoverage` for alpha-tested foliage

**Outcome:** Enable MSAA on the WebGPU scenePass and switch
foliage mask-mode materials from binary `alphaTest=0.5` cutout to
`alphaToCoverage`. Eliminates the per-frame pixel-flicker shimmer
on tall grass and other alpha-tested foliage when wind animates
blade vertices — a known limitation documented in the existing
TODO at `packages/render-web/src/ShaderRuntime.ts`
`applyNodeSetToMaterial`.

**Cause being fixed.** The foliage mask blend mode sets
`alphaTest = 0.5` and `depthWrite = true`. Every fragment is a
binary keep / discard at the alpha boundary. With wind shifting
blade vertices by tiny amounts each frame, individual pixels at
the alpha edge can flip on/off → scattered pixel flashes.

**Validation gotcha (retrospective from 36.16).** An earlier draft
of this story claimed "Confirmed by setting wind to Still Air on
all scatter layers — flashes vanish entirely." That observation
turned out to conflate two distinct flicker sources: (1) the
sub-pixel cutout shimmer this story addresses, AND (2) the
non-deterministic compute scatter instance order that 36.16 had to
solve before shipping. The Still-Air test eliminated wind-driven
vertex motion, which masked BOTH. After 36.16's deterministic
compaction landed, the surface preview no longer flickered with
Still Air — but BLEND-mode foliage (Grass Surface 6) had been
flickering for an entirely different reason. **Before implementing
36.16b, re-validate the residual MASK-mode shimmer with the current
deterministic-compaction pipeline:** turn on wind, observe whether
shimmer persists at the alpha cutout edges. If yes, MSAA +
`alphaToCoverage` is still warranted (the spec direction below
holds). If shimmer is now negligible, downgrade the urgency or
close as resolved-by-side-effect.

**Mechanism of the fix.** With MSAA enabled, the rasterizer
generates multiple coverage samples per pixel.
`alphaToCoverage = true` derives a partial-coverage mask from the
shader's output alpha — fractional coverage produces blended
edges instead of a hard binary. Sub-pixel motion now produces
sub-pixel coverage shifts instead of full-pixel pops. Foliage
edges become anti-aliased automatically.

**Files touched:**
- `packages/render-web/src/render/RuntimeRenderGraph.ts` (or
  wherever the renderer / scenePass is constructed) — enable
  MSAA on the scenePass with a sample count parameter (4×
  default for v1; configurable in the future).
- `packages/render-web/src/ShaderRuntime.ts`
  `applyNodeSetToMaterial` — for `blendMode === "mask"`, set
  `material.alphaToCoverage = true` and drop `alphaTest` to
  ~0.01 (coverage replaces the hard cutoff). Remove the TODO
  block.
- `packages/render-web/src/scatter/compute-pipeline.ts` —
  ensure the indirect-draw + InstancedMesh path is MSAA-compatible
  (target texture format, multisample state). The compaction
  pipeline itself doesn't change.
- `packages/testing/src/foliage-shimmer.test.ts` (new) — render
  a static grass field with wind motion across N frames; per-pixel
  diff between consecutive frames must stay under a tight
  threshold (proves the shimmer is gone at the pixel level).

**Out of scope:**
- Blend-mode foliage (`blendMode === "blend"`) is unchanged. It
  uses `transparent: true` + `depthWrite: false` for true alpha
  gradients (Grass Surface 6 base fade); MSAA still applies
  but `alphaToCoverage` doesn't.
- Performance comparison between alphaToCoverage and TAA — TAA
  is a deeper refactor (jittered camera, history buffer, motion
  vectors) and is deferred beyond this epic.

### 36.17 — Scatter LOD (distance density thin + mesh swap)

**Outcome:** Two LOD mechanisms running in the compute pass's
visibility cull:

1. **Distance density thin**: beyond `lod1Distance`, drop 3 of 4
   instances (or a configured ratio). Beyond `lod2Distance`, drop
   7 of 8. Smooth hash-based rejection — the same blade never
   suddenly pops in or out; rejection is deterministic per
   instance seed + distance band.
2. **Mesh swap**: beyond `distantMeshThreshold`, swap the tuft /
   flower mesh to a lower-poly variant (or a flat billboard, or a
   single-triangle decal). Each `GrassTypeDefinition` /
   `FlowerTypeDefinition` / `RockTypeDefinition` gains
   `lodMeshes: { near: MeshSource, far?: MeshSource,
   billboard?: MeshSource }`.
3. Beyond `maxDistance`, scatter fades out entirely — at that
   distance the terrain texture on the ground carries the visual
   impression of grass without per-instance draws. Matches Ghost
   of Tsushima's "very far → replaced by terrain texture" technique.

All three thresholds are authored per scatter type with project-wide
sensible defaults.

**Files touched:**
- `packages/domain/src/surface/grass-type.ts` +
  `flower-type.ts` + `rock-type.ts` — add `lodMeshes` + distance
  thresholds.
- `packages/render-web/src/scatter/compute-pipeline.ts` — extend
  the **markVisible** kernel with density-thin (additional
  hash-based rejection at distance bands) + mesh-band selection.
  The downstream scan + compact passes are unchanged: a
  density-thinned candidate just clears its `frameActive[i]` flag,
  same as a frustum-culled one. Mesh swap likely needs one
  InstancedMesh per LOD bin (each with its own visible buffer
  range), routed by the markVisible kernel writing into per-bin
  flag arrays.
- `packages/render-web/src/scatter/lod.ts` (new) — LOD math
  (hash-based deterministic rejection; mesh-band selection per
  instance).
- `packages/testing/src/scatter-lod.test.ts` (new) — instance
  beyond `lod1Distance` has a 3-in-4 chance of rejection,
  verified over many camera positions.

### 36.18 — Player / NPC displacement (canonical-entity-driven)

**Outcome:** A `DisplacementSourceBuffer` — a small GPU buffer
(e.g. 64 entries max for v1) containing active displacement
sources: `{ worldPosition: vec3, radius: float, strength: float,
falloff: float }`. Populated per frame by a **runtime-core
system** that reads canonical entity positions + authored
`displacementProfile` components. The editor uses the same system.
The published game uses the same system. Preview uses the same
system. Tests use the same system. One code path.

**Canonical-entity-driven vs. editor adapter — explicit choice.**
Earlier drafts of this story proposed an `apps/studio/...`
overlay that registered the player / NPCs into the registry "for
the editor," alongside a separate gameplay-side API that would do
the equivalent registration "for the runtime." That is exactly
the two-parallel-paths-for-one-concept pattern Epic 033 exists to
prevent. This story uses one path:

- `displacementProfile: { radius, strength, falloff } | null` is
  added as an authored field on the entity Definitions that can
  push scatter (PlayerDefinition, NPCDefinition, ItemDefinition,
  and any future definition that opts in). `null` = "this entity
  does not displace scatter." Default for PlayerDefinition is a
  sensible non-null value; default for others is `null`.
- A runtime-core system
  (`packages/runtime-core/src/displacement/displacement-system.ts`)
  walks the active scene's entities each frame, reads
  `entity.transform.position` and
  `entity.displacementProfile` via the existing scene-evaluation
  path that render targets already consume, and writes entries
  into `DisplacementSourceRegistry`. No plugin API, no editor
  overlay, no registration calls from gameplay code.
- Custom sources (a plugin-defined "wind gust" area effect, a
  spell that pushes scatter outward) opt in by authoring an
  entity that carries a `displacementProfile` — same mechanism.
  No new hook surface for plugins.

This matches Sugarmagic's domain-first pattern: authored property
on the Definition, runtime system consumes it uniformly. Adding a
new pushing entity doesn't require touching
`DisplacementSourceRegistry` or any host-specific code; it
requires setting a field on the Definition.

**Why this is safe to do in the editor.** In Build mode the
entities are static (no simulation runs), so displacement sources
are static and the effect is static — a placed player character
shows its displacement circle in the grass where it stands. If
the author drags the player via the transform gizmo, the entity's
transform updates through the existing command path
(`viewportStore.transformDrafts` → commit via Epic 033's
draft/commit flow), the displacement system re-reads the
committed position on the next frame, the displacement circle
follows. Same mechanism, no authoring-specific code path. In
Preview / published game, gameplay simulation moves the entities,
the system reads the simulated positions, displacement tracks
live.

**DisplacementSourceBuffer and scatter shader.** Scatter vertex
shader iterates the buffer, computes closest source, bends the
top of the tuft away from the source by an amount proportional
to `strength × (1 - distance / radius)^falloff`. Base vertices
stay planted; tip vertices bend. Buffer is sized for v1 at 64
sources; Stage 4 extension (beyond this epic's scope) would add
a grid-acceleration structure if gameplay demands thousands.

**Composition with wind (decided architecture).** Today the
scatter vertex shader is whatever the scatter layer's `deform`
slot binds — currently `foliage-wind` (an `effect.wind-sway`
shader graph) via the wind-preset Material indirection. Its
`output.vertex` is the sole `positionNode` override on the
scatter mesh. Displacement must compose with this without
fighting it.

**Decision: displacement is a new effect-op
(`effect.displacement`) authored into the existing wind shader
graph.** It runs in series with `effect.wind-sway`, both
contributing displacements that sum into the final
`output.vertex`. Concretely:
- Add `effect.displacement` to the shader-node registry in
  `packages/domain/src/shader-graph/index.ts`. Inputs:
  `position` (vec3), `mask` (float, treeHeight — "tip
  weight"), `displacementBufferRef` (handle, fed by
  scatter-system uniforms). Output: `displacement` (vec3).
- Update the built-in `foliage-wind` shader graph: `wind-sway`
  output and `displacement` output are summed into a final
  vertex node. Ordering doesn't matter (additive) but keep
  displacement after wind-sway in the graph for
  read-the-graph clarity.
- The materializer for `effect.displacement` reads the
  `DisplacementSourceBuffer` (uploaded each frame from
  `DisplacementSourceRegistry`), iterates active sources,
  computes the closest one's contribution, returns a vec3.
- Wind preset Materials (Still Air, Gentle Breeze, etc.)
  remain unchanged. Displacement strength comes from the
  per-entity `displacementProfile` on the entity Definition,
  NOT from the wind preset. Wind preset and displacement are
  independent layers of motion.

**Why this composition over alternatives:**
- *Separate vertex pass after wind:* TSL doesn't have a clean
  "two `positionNode` contributions" primitive. Forcing it
  would require a custom render pass or material wrapper —
  more code, less authorable.
- *Replace wind shader with displacement-aware variant:*
  forks the foliage-wind shader, doubles the surface area to
  maintain. Avoid.

This composition also gives us the natural moment to wire up
the currently-inert `windDirection` parameter on wind preset
materials. The ambient wave layer in `effect.wind-sway`
hardcodes `vec3(ambientBend, 0, 0)` (-X-only bend) today;
when displacement is added as a vec3-producing op,
`wind-sway` should likewise output a vec3 that respects
`windDirection`. Both layers then push along authored axes
and compose properly. Documented in the
`material-definitions.ts` TODO; resolve here.

**Files touched:**
- `packages/domain/src/content-library/index.ts` — add
  `displacementProfile: { radius: number; strength: number;
  falloff: number } | null` field to `PlayerDefinition`,
  `NPCDefinition`, `ItemDefinition`. Default
  `PlayerDefinition.displacementProfile` in `createDefaultPlayerDefinition`
  to a sensible non-null value (e.g. `{ radius: 1.5, strength:
  0.8, falloff: 2 }`); others default to `null`.
- `packages/domain/src/shader-graph/index.ts` — register the
  new `effect.displacement` node type (input ports: position,
  mask, displacement-buffer handle; output: vec3
  displacement). Update `createDefaultFoliageWindShaderGraph`
  to include the displacement op alongside wind-sway, with
  their outputs summed into `output.vertex`.
- `packages/render-web/src/materialize/effect.ts` — add the
  `effect.displacement` materializer: iterate
  DisplacementSourceBuffer, compute closest source, return
  vec3 contribution. While here, replace the `wind-sway`
  hardcoded `vec3(ambientBend, 0, 0)` axis with one driven by
  the wind shader's `windDirection` parameter (resolves the
  inert-parameter TODO in
  `packages/domain/src/content-library/builtins/material-definitions.ts`).
- `packages/runtime-core/src/displacement/index.ts` (new) —
  `DisplacementSourceRegistry` service (runtime data, not a
  store slice; see Epic 033's precedent for "runtime service vs.
  store").
- `packages/runtime-core/src/displacement/displacement-system.ts`
  (new) — per-frame system that reads entities + profiles and
  populates the registry. Registered into runtime-core's scene
  system pipeline so every host that runs scene evaluation gets
  displacement updates automatically.
- `packages/render-web/src/scatter/displacement-buffer.ts` (new)
  — GPU buffer upload from the registry each frame (render-web
  is the realization layer).
- `packages/render-web/src/scatter/compute-pipeline.ts` — bind
  the displacement buffer to the scatter draw's vertex shader;
  tuft mesh shaders read it.
- `packages/testing/src/displacement.test.ts` (new) — two
  categories:
  - **Unit:** construct a registry with a known source near a
    known scatter instance; assert the instance's computed tip
    position deflects in the expected direction by the expected
    amount.
  - **Integration:** run the displacement system against a
    synthetic scene containing a PlayerDefinition with a
    `displacementProfile`; assert the registry is populated
    after one system tick with the expected source; move the
    entity's transform; assert the registry reflects the new
    position after the next tick. Verifies the
    canonical-entity-driven path end to end with no
    editor-specific adapter in the test setup.

**Not in files touched** (explicit negative list — guards against
the two-paths regression this story exists to prevent):
- No `apps/studio/src/viewport/overlays/player-displacement.ts`
  or equivalent editor-only registration path.
- No plugin-side `registerDisplacementSource` /
  `unregisterDisplacementSource` API. Plugins opt into
  displacement by spawning entities with `displacementProfile`
  components, same as core entities.

### 36.19 — Perf validation + benchmarks

**Outcome:** A benchmark suite exercising three representative
scenes in **steady state** (no live editing, no parameter
changes — only camera + entity motion):

- **Small region** — 64×64m landscape, 2 channels, 1 scatter
  layer each at modest density. ~50K instances total. Target:
  60fps on reference hardware with plenty of headroom.
- **Dense landscape** — 128×128m, 3 channels, 2 scatter layers
  each (grass + flowers), painted masks with complex transitions.
  ~300K instances. Target: 60fps on reference hardware.
- **Full scene** — dense landscape + 20 assets each with
  scatter-bearing slots (moss on roofs, ivy on walls, grass
  around rocks). ~500K instances. Target: 60fps on reference
  hardware with displacement sources active.

**Realistic path to the dense / full-scene targets (informed by
36.16 measurements).** The compaction pipeline shipped in 36.16
is per-layer and capped at 65,536 candidates per layer
(`MAX_GPU_COMPACTION_CANDIDATES`). Reaching 300K–500K total
instances requires:
- Multiple scatter layers (each within its own 65K cap), AND
- 36.17's LOD doing real work — distance-band density thinning so
  most far-camera blades are eliminated by `markVisible` rather
  than rendered as full-detail geometry, AND
- Likely a `lodMeshes.billboard` or imposter-card swap beyond
  ~50m so far blades draw 2 triangles instead of ~50–80.

A bare grass field with all blades visible (the camera looking
straight at the meadow) measured ~10ms GPU at ~30K instances on
the M-series MacBook reference hardware after 36.16 shipped. That
linearly extrapolates poorly: at 300K instances every-blade-visible
would burst the budget. The expected steady-state operating point
with 36.17 LOD is "most blades not at full detail" — measurement
will confirm. If 36.19 shows the targets aren't reachable with
LOD alone, escalations are: (a) recursive partials scan to lift
the per-layer cap, (b) subgroup intrinsics on Chrome 134+ for
faster scans, (c) imposter rendering beyond ~30m. All deferrable
to a Stage-4 perf workstream if 36.19 finds the current
combination "good enough" for shipping target scenes.

Benchmarks run in CI and record frame-time + GPU-time telemetry.
Regressions fail the build. Results inform whether further perf
work is needed before declaring the epic done.

**Steady-state vs. interactive benchmarking — explicit choice.**
The Stage-1/2 `uniformForParameter` fix (literals instead of
shared TSL uniforms) means any change to a shader parameter
forces a fresh material acquire and a TSL recompile. That's
correct — the prior "shared uniform with `.value` mutation" path
silently failed to propagate parameter values to the GPU
(observed during wind-preset iteration). Steady-state frame
time is unaffected; interactive frame time during slider drags
will show recompile bubbles.
- **In scope for 36.19:** steady-state frame time at the three
  density tiers above. This is the published-game / preview
  metric that matters for shipping.
- **Out of scope for 36.19, captured as follow-up:** an
  "interactive editing latency" benchmark — drag a parameter
  slider while a scene is rendering and measure the
  recompile-bubble duration. Belongs in a Stage 4 (or
  separate authoring-perf) workstream.

**Files touched:**
- `packages/testing/src/scatter-benchmarks/` (new folder) — one
  test file per scene scenario; each fixture pre-warms the
  shader cache before sampling frame times so a first-frame
  compile cost doesn't pollute the steady-state numbers.
- `tooling/benchmark-report.mjs` (new) — aggregates run output;
  compares against a baseline checked into the repo.
- CI config — add a nightly benchmark job.

### 36.20 — Final ADR closeout + epic completion

**Outcome:** ADR 013 *Surface-as-LayerStack* (originally written
in 36.10 with the Stage 1 shape) updated with the full three-stage
architecture: asset-slot scatter, compute-driven pipeline,
displacement, LOD. Epic 036 marked `Status: Implemented`. A
retrospective note at the bottom of the ADR captures what we
learned per stage — especially anything from the testing pauses
that changed the plan.

**Files touched:**
- `docs/adr/013-surface-as-layer-stack.md` — extend to cover
  Stages 2 and 3.
- `docs/plans/036-surface-as-layer-stack-epic.md` — status flip.

## Success criteria

Per-stage. Each stage's criteria must pass before its testing
pause is cleared and the next stage starts.

### Stage 1 success criteria

- **One abstraction for slot content.** `grep` for the old flat
  `Surface` union shape finds nothing after Story 36.3. Every slot
  holds a `SurfaceBinding | null`; every `SurfaceBinding.kind`
  resolves to a layer stack.
- **Layer compositor passes authored tests.** Two-layer mix +
  mask, multiply + mask, emission adding to emissive, unknown mask
  producing diagnostic — all green.
- **Landscape-with-grass scenario ships.** A region landscape with
  a single channel painted to full weight, slot surface = a
  `wildflower-meadow` SurfaceDefinition, renders in the editor
  viewport with visible grass tufts + wildflowers + green ground.
  No custom shader authored by hand.
- **Grass on a roof WOULD work domain-wise.** An
  AssetDefinition's mesh slot bound to a Surface with a Scatter
  layer accepts and serializes cleanly; v1's deferral is purely
  runtime, the domain is unchanged from how landscape handles it.
  (Success check is a test that constructs the binding and
  round-trips it through the IO layer, not a visual test.)
- **Surface Library preview matches the reference, at full
  fidelity, on all three preview geometries.** Opening
  `wildflower-meadow` in the Surface Library with preview
  geometry = plane, the visual is recognizably in the same family
  as the Genshin-style reference images — chunky painterly grass,
  visible flowers, warm tint, composited appearance layers, full
  scatter realization. Toggling the preview geometry to cube and
  sphere shows the same Surface wrapped on those primitives with
  scatter following the surface normals correctly. No
  "appearance-only" preview reduction — preview renders what the
  game renders. (Subjective aesthetic sign-off; cube / sphere
  normal-tracking is a structural check in
  `surface-preview-samplers.test.ts`.)
- **Library reuse works.** Editing `wildflower-meadow` propagates
  to every slot referencing it, via the existing Epic 033
  subscription model. Tested by mounting two landscape channels
  that reference the same surface and editing one layer's opacity.
- **Epic 034 traits unchanged.** Deformable / Effectable slots
  still type-check against `ShaderOrMaterial | null`. Story 36.5's
  mesh-apply rewrite preserves the deform + effect wiring exactly.

### Stage 2 success criteria

- **Moss-on-roof scenario ships.** A cabin asset with a roof slot
  bound to a Surface containing a moss scatter layer renders with
  visible moss tufts on the roof mesh triangles, correctly
  following the mesh's surface normals. Tested by importing a
  two-slot asset + binding + visual check in the editor viewport.
- **Painted masks respond in real time.** Brushing on a mask in
  paint mode updates the rendered surface within one frame; no
  lag, no lost strokes at reasonable stylus / mouse sampling
  rates.
- **Per-slot overrides don't fork Surface references.** Test:
  reference `wildflower-meadow` from two slots, override one
  layer's opacity on slot A; assert slot B's rendering is
  unchanged (the library Surface wasn't mutated).
- **Layer overrides are bounded to presentation + tuning, not
  identity.** The `LayerOverride` type is narrow by kind — authors
  cannot construct an override that changes `layerId`, `kind`,
  `content.kind`, or any reference id (material/grass/flower/rock
  reference ids). Attempting such a change at the type level
  fails `tsc --noEmit`; attempting it via a hand-edited project
  file fails the IO decoder with a typed error. Verified by the
  negative TypeScript assertion in `surface-layer-overrides.test.ts`.
- **Procedural masks produce deterministic output.** A Perlin
  mask with the same seed + offset produces identical values on
  every run. Deterministic testability is important — art
  decisions about mask parameters have to be reproducible.
- **Rocks integrate without shape changes.** The same
  `buildScatterInstancesForLandscape` / `buildScatterInstancesForAssetSlot`
  path handles rocks by dispatching on `scatterContent.kind`; no
  new code path in the outer runtime.

### Stage 3 success criteria

- **Full scene target: 60fps @ 500K+ scatter instances on
  reference hardware** (defined as a mid-range 2025 M-series
  MacBook + Chrome stable). Verified by the benchmark suite in
  Story 36.19. Regressions fail CI.
- **Indirect-draw pipeline replaces CPU scatter by default.** GPU
  compute build + deterministic prefix-sum compaction + indirect
  draw is the default path for layers with up to
  `MAX_GPU_COMPACTION_CANDIDATES` (65,536) candidates. CPU path
  remains as a documented fallback for WebGPU-compute-missing
  environments AND for layers that exceed the per-layer cap. A
  test asserts the compute pipeline produces instance counts
  within tolerance of the CPU path given the same inputs.
- **Player displacement is visibly convincing, through the
  canonical entity path.** Walking through a grass field in
  Preview (gameplay simulation active) bends blades away from
  the player within a readable radius; no popping, no residual
  bend after the player passes. Same test repeated in a
  published-game build renders identically. In Build mode
  (static authoring), moving the player entity via the transform
  gizmo updates the displacement circle as the entity commits
  its new position — proving the same displacement system is
  live in authoring too, not a separate editor code path.
  Verified by end-to-end render comparison across Preview + an
  exported build.
- **No editor-only displacement path exists.** `grep` for
  `registerDisplacementSource` / `unregisterDisplacementSource`
  / a `player-displacement.ts` overlay under `apps/studio/`
  returns nothing. Displacement sources flow through exactly
  one path: authored `displacementProfile` on entity Definitions
  + the runtime-core displacement system reading entity
  positions.
- **LOD is invisible.** The density-thin transition across
  `lod1Distance` and `lod2Distance` doesn't produce visible
  popping — individual blades shouldn't flicker as the camera
  moves. Hash-based deterministic rejection verified by testing
  the same instance across many camera positions (either it's in
  or it's out, never oscillating).
- **ADR 013 is complete.** Covers the Stage 1 + Stage 2 + Stage 3
  architecture with a retrospective section capturing per-stage
  learnings.

## Risks

### Stage 1 risks

- **Compositor perf at rendering time.** An N-layer stack samples
  + composites N times per pixel. Budget: 3-5 layers per slot
  should be free on modern GPUs; 10+ risks frame time. Fold
  opaque-base + opaque-overlay at compile time where possible —
  defer the optimization to a follow-up story unless the preview
  cube or a landscape test shows an obvious regression.
- **Normal blending beyond `"mix"`.** Tangent-space normal blending
  for `multiply` / `add` / `overlay` is ill-defined; we force-normal
  blend to `"mix"` regardless of author choice, with a UI warning.
  Risk: authors assume their normal-map choice works and are
  confused when it doesn't. Mitigation: the layer detail panel
  greys out non-mix modes for normals and shows an explanatory
  tooltip.
- **Stage 1 CPU scatter ceiling.** CPU scatter + one
  InstancedMesh per (channel, layer) scales to ~200K instances on
  reference hardware before frame time suffers. If the Stage 1
  testing pause shows target scenes exceeding this, Stage 3's
  compute scatter escalates in priority (possibly interleaved
  into Stage 2).
- **Preview viewport cost.** The Surface Library preview shares
  the authoring `ShaderRuntime` and renders the selected primitive
  geometry (plane / cube / sphere) at full fidelity — layer
  compositing, scatter, emission, lighting. Trivial at preview
  scale (cube = 12 triangles; ~hundreds of scatter instances at
  full density on a small viewport), so no "appearance-only"
  reduction. The only real cost is the second viewport's render
  loop running alongside the authoring viewport — measured in
  Story 36.8's test to confirm it stays comfortably below a 1ms
  frame budget on reference hardware.
- **Library reference + Epic 033 subscription.** When a
  SurfaceDefinition changes, every slot referencing it must
  re-evaluate. The projection subscription path already handles
  content-library changes; we just need to confirm that
  `surfaceDefinitions[]` mutation triggers re-apply on all
  consumers. Tested in Story 36.8.
- **Masks on asset slots with no splatmap.** Addressed
  structurally, not as a "UI greying + runtime diagnostic" soft
  check. See *Validation rules (mask context)* in Architecture:
  `SurfaceContext` narrowing on `AssetSurfaceSlot` prevents the
  state at the type level; the IO decoder, command executor, and
  runtime resolver are three independent non-UI enforcement
  points for the cases types can't catch (library references,
  hand-edited files, bugs). Listed here only as a risk worth
  remembering during implementation, not as a design-open
  question — the resolution is spec'd.

### Stage 2 risks

- **Asset-slot scatter cache invalidation on re-import.** When an
  artist re-imports a GLB that was carrying scatter-bearing
  slots, the mesh topology may change — triangle count / ordering
  / slot indices. Cache keys by `(assetDefinitionId, slotName,
  layerId)` but the underlying triangle set differs. Story 36.11
  must invalidate caches keyed by anything that depends on
  triangle geometry whenever the asset's mesh hash changes.
- **Painted-mask storage bloat.** A masked layer per Surface per
  slot, each holding its own mask texture, multiplies quickly. A
  project with 50 Surfaces × 3 painted masks each × 512×512 RGBA
  = ~150MB of mask data. Mitigation: masks default to single-
  channel (R8), which quarters the storage. A Stage 2 polish
  story can add shared-mask references (multiple layers sharing
  one mask texture via the `texture` Mask kind, author-owned
  separately from the layer).
- **Layer override key drift.** Two drift scenarios — both
  resolved structurally by Story 36.13's merge rules:
  (a) a referenced Surface is edited to remove a layer that has
  overrides in another slot → the override's `layerId` no longer
  matches, `applyLayerOverride` drops it with a `layerId`
  diagnostic, editor shows the drop as a per-slot warning badge
  ("Overridden layer X no longer exists in the referenced
  Surface — clear this override");
  (b) a referenced Surface is edited to change a layer's kind
  (unusual but possible) → `targetKind` mismatch triggers a drop
  with a different diagnostic. Neither case is an error; the
  override payload can sit dormant until the author clears it or
  the library Surface restructures again.
- **Procedural mask determinism.** All procedural masks must
  produce the same output for the same input. GPU float precision
  quirks can cause deterministic-looking noise to shift
  imperceptibly between devices. Lock the seed and document as a
  known quantization artifact if it shows up.

### Stage 3 risks

- **Compute shader availability in the browser.** WebGPU compute
  shaders require a reasonably recent browser + hardware. Fallback
  path (CPU scatter from Stage 1) must stay maintained and
  exercised in at least one test scenario in CI, not bit-rotted.
- **Indirect-draw API stability.** three.js WebGPURenderer's
  indirect-draw support evolves; Story 36.16 tracks the current
  API. If three.js's indirect-draw API changes during the
  implementation window, the story may need a small pivot.
- **Displacement source count.** The GPU buffer has a hard cap
  (Story 36.18 proposes 64 sources). For large combat scenes with
  many NPCs displacing grass, that may not be enough. Stage 3
  ships with 64; Stage 4 could introduce a grid-acceleration
  structure for thousands of sources if gameplay demands it.
- **LOD pop visibility.** Density-thin LOD transitions use
  hash-based deterministic rejection, but cross-band transitions
  as the camera moves can still produce subtle shimmer. Story
  36.17 may need a blend band (instances fade their scale over a
  short distance rather than snapping rejected) if the visible
  shimmer is objectionable.
- **Per-stage art sign-off.** Each stage's art sign-off is
  subjective. The testing-pause structure exists specifically so
  the team catches aesthetic drift early. If Stage 1's preview
  cube doesn't match the reference, Stage 2 shouldn't start.

## Builds on

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
  — one rendering path across authoring, preview, and published.
  This epic reinforces it by giving every slot ONE layer-stack
  evaluator.
- [Plan 029: Shader Graph Pipeline](/Users/nikki/projects/sugarmagic/docs/plans/029-shader-graph-pipeline-epic.md)
  — shader graphs are still the atomic renderable unit. Layers
  composite graph outputs; they don't replace graphs.
- [Plan 032: Material System and Library Epic](/Users/nikki/projects/sugarmagic/docs/plans/032-material-system-and-library-epic.md)
  — `MaterialDefinition` stays atomic + reusable. An appearance
  layer's `material` variant references a Material. Surfaces
  compose Materials; they don't replace them.
- [Plan 033: Unified Viewport State Subscription Epic](/Users/nikki/projects/sugarmagic/docs/plans/033-unified-viewport-state-subscription-epic.md)
  — the Surface preview viewport is a new subscriber in the same
  pattern; no new state-flow machinery needed.
- [Plan 034: Surfaceable / Deformable / Effectable Traits Epic](/Users/nikki/projects/sugarmagic/docs/plans/034-surface-deform-effect-traits-epic.md)
  — the trait split stays. This epic only changes the contents of
  a Surfaceable slot (flat → layer stack). Deform and Effect are
  untouched.
