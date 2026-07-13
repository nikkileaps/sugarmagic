# Plan 068 — Asset surface assignment in Layout, scoped base/scene

Status: proposed
Owner: nikki + claude
Date: 2026-07-12

Related: Plan 058 (Scene overlays — the base/scene containment model
this extends), Plan 065 (surface authoring vocabulary: built-in
surfaces, duplicate-to-edit, SurfaceBindingEditor), ADR 025 (color
semantics the editors already obey).

## Purpose

Asset appearance is edited in the wrong place. Surface, deform, and
effect assignment currently live in the Asset Manager modal — the
import tool — so changing what a placed rock looks like means leaving
the scene you are looking at. Meanwhile the Layout inspector, which
already shows the selected instance, edits nothing about its look.

Move appearance assignment to where the author is looking: the Layout
inspector for the selected instance, with the same editor components
the landscape channels use. And make each assignment scopable the way
placements already are — base (region) by default, promotable to
scene so one Scene can restyle a base placement without forking it.

The Asset Manager modal becomes what its name says: import glb/fbx,
rename, manage. Nothing about appearance.

Resolution precedence when this epic lands:

```text
scene override (new)  >  instance override (exists)  >  definition default (exists)
```

Definition defaults stay in the domain as the fallback tier ("what a
lavender looks like unless told otherwise") — they just stop being
editable in the modal. Whether they need a "set as default for this
asset" affordance is deferred until nikki misses it in practice.

## Architecture and reuse

Patterns this epic runs on — all established precedent, no new
machinery:

- **Semantic command + transaction.** Every inspector edit is one
  command through the executor (extended
  `SetPlacedAssetShaderOverride` with a scope argument, the shape the
  brush commands set with `scope`), one undo step. The executor's
  `mapPlacedAssetsEverywhere` idiom keeps commands scope-blind where
  possible; only the scene-override write is scope-aware by nature.
- **Plan 058 containment scoping.** Scene restyles are an overlay
  record composed by `composeRegionContents` — the ONE composer.
  No second composition path, no scope flags on instances.
- **Single enforcer of resolution.** `resolveBindingSetForOwner`
  (runtime-core) remains the only place precedence is decided. It
  gains the scene tier AND returns per-slot PROVENANCE (definition |
  instance | scene) so the inspector's "where does this value come
  from" chips read the resolver's answer instead of re-deriving the
  chain in UI. Viewport, inspector, and tests all consume the same
  resolution.
- **One-way deps.** domain (types + commands) -> runtime-core
  (resolution) -> workspaces (inspector UI) -> studio (composition).
  The inspector never touches canonical truth directly.
- **Model/View state split (Plan 054).** Which slot card is expanded,
  popover open state: component-local. Canonical assignment: domain
  documents via commands. Nothing shader-shaped enters a zustand
  store.

Component reuse (reuse first, extract when shared, build only the
scope control):

- `SurfaceBindingEditor` — reused as-is; the landscape channel edit
  flow is the reference UX.
- `MaterialSlotBindingsEditor` + `ShaderSlotEditor` — currently owned
  by the asset modal inspector; hoisted to a shared workspaces module
  in 068.3/068.4 so the Layout inspector consumes them and the modal
  sheds them (the components outlive their current home; delete the
  modal wiring, not the editors).
- Scene badge — the explorer's inline scene chip gets extracted into
  a small reusable ScopeBadge (+ toggle variant) used by both the
  explorer and the new Appearance section, so scope reads identically
  everywhere.
- Inspector composition follows the existing LayoutWorkspaceView
  section/FactRow idiom; popovers use `withinPortal` (the options-bar
  clipping lesson).

## Stories

### 068.1 — Per-slot instance overrides (domain)

The existing `PlacedAssetInstance.shaderOverrides` is one shader per
slot kind — but asset definitions carry per-MATERIAL-slot surfaces
(`surfaceSlots[]`: a cliff has rock + moss slots). Instance surface
overrides gain the same granularity: override any material slot's
surface binding independently, deform/effect stay asset-wide.
Extend/replace `SetPlacedAssetShaderOverride` accordingly (delete the
coarse path if nothing else consumes it — one enforcer). Resolution in
`resolveBindingSetForOwner` merges per-slot: overridden slots win,
untouched slots fall through to the definition.

Decided during implementation (2026-07-12): the whole-owner surface
override FALLBACK tier (legacy slot-"surface" shader override silently
painting unassigned slots) is DELETED, not preserved — no UI ever
dispatched it and a scan of the real wordlark project data found zero
occurrences, so there is nothing to migrate. An unassigned slot keeps
the imported model material (a defined default). A BROKEN surface
reference resolves to a loud magenta error surface (the slot sibling
of the error-fallback mesh) plus a diagnostic; 068.3 surfaces that
diagnostic in the inspector with a fix path (re-pick the surface).

### 068.2 — Scene-scoped overrides for base placements (domain)

The one genuinely new semantic. `RegionSceneOverlay` gains asset
appearance overrides keyed by instanceId (per-slot surface + deform +
effect, same shape as 068.1). `composeRegionContents`/resolution apply
them ON TOP of the composed instance: scene override > instance
override > definition default. Commands take a scope argument
(base | scene) the way the brush commands took `scope`; scene-scoped
writes require an active Scene and land in the overlay, base writes
land on the instance. Note: overrides on a scene-scoped INSTANCE are
already scene-scoped by containment — the overlay record is only for
restyling BASE placements per Scene; guard against double-scoping.

### 068.3 — Layout inspector: appearance section

Selected placed asset's inspector gains an Appearance section:
material-slot cards (reusing `MaterialSlotBindingsEditor` /
`SurfaceBindingEditor` — the landscape channel flow) plus
Deform/Effect rows (`ShaderSlotEditor`). Each assignment shows where
its value comes from (definition default / base override / scene
override) and carries a Base/Scene scope control defaulting to Base,
using the same scene badge language the explorer already speaks.
Clearing an override falls back down the chain. One command per edit
gesture, undo-clean.

UX model (decided 2026-07-12): slots map 1:1 to the mesh's material
slots — NO channels abstraction between slot and surface. The
channel-like richness (stacking, masking, "paint moss on the roof")
already lives INSIDE the Surface: surfaces are layer stacks, every
layer takes a `Mask`, and `PaintedMaskTargetAddress` already has an
`asset-slot` scope. Landscape needed channels because terrain
splat-blends whole surfaces across one mesh; assets are already
partitioned by Blender's material slots. One blending system: the
surface layer stack.

Painted-mask flow (the load-bearing part of this move): the layer
mask popover only ARMS the brush (`setActiveMaskPaintTarget`);
strokes land in the VIEWPORT on the actual mesh via the existing
mask-paint overlay, which already speaks `asset-slot`. Painting an
asset mask from the modal was useless because the modal has no
viewport — armed from the Layout inspector with the object selected,
it becomes the landscape flow: panel arms, viewport paints. Verify
the arm-from-inspector path end to end in 068.3 (it has only ever
been reachable through the modal).

### 068.4 — Instance-aware painted masks + in-viewport paint mode

The UV paint machinery (brush-into-mask-texture, UV hit math, live
preview, scatter-mask evaluation) predates this epic and only knows
DEFINITION-owned layers. Make it reach the per-instance surfaces this
epic created, with the paint UX decided 2026-07-12:

- **Addressing**: `PaintedMaskTargetAddress` gains an instance-owned
  arm (instanceId + slotName + layerId). The paint-target resolver
  finds the armed layer wherever it lives: definition slot, instance
  override, or Scene record. Strokes filter by instanceId — painting
  YOUR outcrop never lands on its siblings.
- **Interaction (the concrete flow)**: picking Mask Type "Painted" on
  a layer for the FIRST time closes the popovers and enters paint
  mode immediately; re-entry is a Paint button in the layer's mask
  popover. In paint mode: a brush ring follows the object's surface
  under the cursor, a toolbar appears top-left (radius / strength /
  falloff sliders, Paint/Erase toggle, live mask-texture thumbnail,
  Done button), left-drag paints, camera orbit stays live, and ALL
  other Layout tools (click-select, gizmo, scatter brush) are
  suspended. Done or Escape exits and restores them.
- **Architecture**: in the Layout workspace, painting is an
  `InteractionController` pushed onto the layout InputRouter (the
  scatter-brush pattern) — NOT the overlay's legacy raw listeners,
  which would fight the transform controller. Landscape-workspace
  painting keeps its existing path.
- **Appearance layers update mid-stroke; grass repopulates on mouse
  RELEASE** (scatter rebuild is triggered by the stroke commit, not
  per-frame). Acceptance test is the outcrop scenario: inline stone
  surface (gradient base + painted scuffs + grass scatter layer with
  a painted mask), scuffs and grass coverage both painted directly on
  the placed instance in the viewport.
- **Mask lifecycle cleanup (nikki: not deferred)**: every painted
  layer owns a mask texture definition + `masks/*.png`. A save-time
  SWEEP (single enforcer, not per-deletion bookkeeping hooks) collects
  every painted-mask id referenced by ANY surface — library, landscape
  slots, definition slots, instance overrides, Scene records — and
  removes unreferenced mask texture definitions and their files.
  Deleting an instance, clearing an override, or removing a layer can
  never strand PNGs past the next save.
- Delete the redundant "Make Local" button (the Binding Mode dropdown
  already forks the referenced surface when switched to Inline).
- Paint strokes are NOT undoable via command history (they write PNGs
  through the IO seam, same as landscape painting). Accepted for v1.

OUTCOME (2026-07-12): shipped and mechanically sound -- addressing,
stroke filtering, controller mode, and the mask sweep all hold. But
field QA hit a wall the machinery cannot fix: painting samples the
mesh's AUTHORED UVs, and real assets don't have paintable UVs. The
outcrop: 2384 triangles sharing 362 unique UV coords, 6.4x
overlapping coverage of the UV square, 757 zero-area UV triangles --
one click stamped confetti across the whole rock. No paint UX fixes
authored-UV overlap; see 068.8. Everything built here stays
load-bearing (the studio paints through the same address + texture
path).

### 068.5 — Master-detail surface editing in the inspector

The popover-in-popover-in-popover chain (slot popover > layer
settings popover > mask popover) was a vanishing-risk stack and had
no room to breathe. Replaced with the Blender material-slot pattern
(nikki's call, 2026-07-12): the slot LIST stays at the top of the
Appearance section; selecting a slot renders its full surface editor
BELOW the list in the same panel — Binding Mode, then the layer
stack with per-layer settings and mask editors expanding INLINE
(accordion) under their rows. Zero popovers in the flow; the panel
scrolls; the viewport remains the live preview it already is (every
edit is a command against the placed object).

Notes: mask editing becomes live-commit inline (the popover's
draft+Apply buffer dies — it already caused one shipped bug when
arming paint closed the chain before Apply). The Asset Manager modal
keeps the popover editors until 068.6 removes its appearance
sections entirely; landscape channels can adopt master-detail later
if the pattern earns it.

OUTCOME (2026-07-12): shipped; kills the vanishing-popover class of
bugs and stays the right home for gradients / blend / scatter
settings. Verdict from nikki: still not a sufficient PAINTING
environment — combined with the UV wall (068.4 outcome), the decision is
no more half measures: a dedicated Paint Studio (068.9/068.10) with
engine-generated paint UVs (068.8) underneath.

### 068.6 — Slim the Asset Manager modal

Remove the Surfaces and Deform/Effect editors from the asset
definition inspector in the modal (`AssetDefinitionInspector`): it
keeps display name, type, source, import/replace. Point the removed
sections' users at the Layout inspector (empty-state hint). Delete
dead editor wiring rather than hiding it. Definition defaults remain
in the schema and resolution untouched.

### 068.7 — Viewport + explorer truth (renumbered; see below for 068.8+)

Scene-scoped appearance must read as such everywhere the instance
shows: the viewport re-resolves when the active Scene changes (verify
the projection already carries activeScene through
`resolveEffectiveAssetShaderBindings` — extend if the binding
resolution predates scenes), and the explorer/inspector indicate when
the current look is a Scene restyle of a base placement. Ensure
preview-vs-committed staleness (shader ensure loop) picks up override
changes without a reload.

### 068.8 — Paint UVs (engine-generated paint channel)

The root fix for the 068.4 outcome. Painted masks stop sampling
authored UVs and sample a dedicated PAINT UV channel instead:

- Importer prefers an authored second UV channel (TEXCOORD_1) when
  the GLB ships one (nikki can use Blender's geometry-nodes
  auto-unwrap setups when she wants artist-tuned islands; zero
  round-trip required when she doesn't).
- Otherwise: "Generate Paint UVs" runs xatlas (MIT, verified
  2026-07-12; the Godot lightmap-UV2 pattern) in a worker and bakes
  TEXCOORD_1 into the imported GLB copy -- one artifact, persists,
  regenerates on reimport. Expose two knobs with sane defaults:
  chart angle tolerance and island padding (padding is load-bearing:
  soft brushes bleed across island borders without it).
- Sampling switch: mesh triangle sampler (scatter), ShaderRuntime
  painted-mask sampling, and the mask-paint overlay raycast all read
  the paint channel when present, authored UV0 otherwise (with a
  visible "no paint UVs" badge in the Appearance section + Paint
  Studio banner).
- Third-party notice entry for xatlas; license-check the specific
  WASM wrapper before it lands.

OUTCOME (2026-07-12, the long night): shipped and field-verified end
to end — painted grass on the outcrop, one dot per click. Five
distinct bugs wore one confetti-shaped symptom on the way:
1. Blob-worker fetch: root-relative wasm URLs cannot resolve in a
   blob worker; absolute URLs required.
2. The xatlas wrapper marks float attributes `normalized`
   (glTF-invalid); WebGPU has no normalized float vertex formats and
   crashed createRenderPipeline. Bake sanitizes; the LOADER also
   sanitizes every renderable (no file on disk may crash the render
   loop).
3. Brush scale: a fixed pixel stamp covered dozens of atlas islands
   (outcrop: 923 islands, median 6px). Brush radius now means METERS
   ON THE SURFACE via per-hit texel density.
4. Split-brain mask sampling: GPU saw live paint, CPU scatter
   placement raced the async resolver reload and read stale pixels.
   Live painted-mask pixel registry; placement samples it first.
   Stroke/fill commits explicitly invalidate the owning renderable
   (deterministic rebuild, no emergent refresh chains).
5. A zombie scatter build for a DELETED layer survived lease
   bookkeeping (129k blades with a released material). The apply path
   now name-sweeps every `asset-scatter:*` group before building —
   orphans cannot survive an apply.
Also shipped: Fill button (always black) in the Paint/Erase group,
and TRUTHFUL mask thumbnails (real pixels, live-updating; the flat
placeholder had made a black mask indistinguishable from white).
Interim: asset blades inherit the LANDSCAPE ground bake (068.11
replaces this with the asset's own compiled surface).

### 068.11 — Asset surface bake: blades inherit the mesh's own compiled surface

Nikki's correction (2026-07-12): grass painted on the outcrop must
inherit the color of the ROCK'S OWN composited surface under each
blade — her deliberately-painted green layer, gradients, scuffs, all
compiled together — NOT the terrain. This is the landscape's
ground-bake pattern generalized to arbitrary meshes, enabled by the
paint UV atlas:

- **Texture-space bake**: render each scatter-bearing slot's meshes
  once with an UNLIT bake material — colorNode = the slot surface's
  composited color (evaluateLayerStackToNodeSet, same nodes the real
  material uses; no second compositor), vertexNode = paint UV
  remapped to clip space. Ground-bake lessons apply verbatim:
  readback + row-flip into a plain DataTexture (NEVER sample RTs from
  scatter shaders), stable texture identity, content refreshes per
  bake.
- **Bake queue**: applies register bake requests; RenderView executes
  them in the pre-render pass (the ground-bake slot) since the apply
  path has no renderer.
- **Blades sample the bake at their paint UV**: samples already carry
  paintUv; pack it through the compute pipeline into an instanced
  attribute (READ IN THE VERTEX STAGE — the instanced-attribute
  fragment-stage lesson), card root color samples the bake DataTexture
  with it. Terrain-bake inheritance remains the fallback when a slot
  has no bake (first frames / no scatter).
- **Refresh**: the same stroke-commit invalidation that rebuilds
  scatter re-registers the bake, so painting the rock retints its
  grass.

Executes BEFORE 068.9/068.10 (the Paint Studio's 3D pane wants this
bake anyway, and the parked Surfaces-preview mini-bake is the same
machinery).

### PIVOT (2026-07-13): the Surface Brush is the goal

After 068.11 landed, we stepped back and researched how Substance
Painter, Blender, Unreal, and Unity actually do artist-friendly
surface painting, and mapped our own code against it (see
ADR 026). Findings, all confirmed:

- Our data model IS the industry model: Surface = layer stack, each
  Layer has a Mask, masks painted-or-procedural, SurfaceDefinition =
  reusable "smart material". The world-space projection brush IS
  Blender projection painting. The foundation is correct; the magic
  is an ABSTRACTION on top, not a rewrite.
- THE decomposition (settled, ADR 026): a surface is the SHARED
  "what" (a library reference), coverage is the PER-INSTANCE "where"
  (a painted mask on an inline override). The
  painted-masks-inline-only rule already enforces exactly this split.
- Substrate decision (settled, ADR 026): texture masks, NOT vertex
  colors. nikki's call -- the low-poly mesh density can't carry the
  handcrafted touches of detail that sell the painterly style, and
  texture masks are already working. Vertex-color mask kind stays
  available as a future lever.

So 068.9/068.10 re-scope from "a paint-mask studio" to the SURFACE
BRUSH plus the Surface Studio. 068.6/068.7 still hold. 068.11 is done
and SET DOWN -- scatter-color inheritance works; do not extend it
(overhangs etc.) until the Surface Brush is proven.

### 068.9 — The Surface Brush (the magic)

Arm a library surface, paint on a placed asset in the Layout
viewport, and the surface appears where you paint. That is the whole
UX. Under the hood (all pieces exist today):

- A Surface Brush tool in the Layout toolbar (sibling to the scatter
  brush; joins the same InputRouter, top controller wins).
- Arming shows a surface picker (the project's library surfaces --
  the "what").
- On the first stroke over an instance's slot: resolve that slot to
  an INLINE override if it isn't already (fork the reference,
  preserving its layers as the base -- makeBindingLocal), and ensure
  a masked layer carrying the chosen surface exists (create it +
  a fresh painted MaskTextureDefinition). Then arm the existing
  painted-mask painter at that layer and paint via the world-space
  projection brush (068.11).
- Result: instance inline override = shared base + a masked layer of
  the chosen surface, painted where brushed. The material is reused
  by reference-in-spirit (the layer's content points at the library
  surface's look); only the mask is per-instance.
- Scope control (Base/Scene) reuses the AssetAppearanceSection
  plumbing -- a scene-scoped brush writes the Scene override tier.
- "no paint UVs yet" -> offer Generate Paint UVs inline (068.8), same
  as the Appearance section.

Open question to resolve in build: does the painted layer reference
the whole library surface (a new `surface-ref` layer content kind --
cleanest, mirrors Substance fill-with-material) or flatten the
surface's top appearance into an appearance layer (simpler, v1)? Pick
during implementation; the decomposition holds either way.

### 068.10 — Surface Studio (layers + UV)

The "open the actual UV and masks to adjust" half of nikki's vision.
From the Surface Brush (or the Appearance section), the Surface
Studio exposes the instance slot's inline layer stack (the existing
master-detail LayerStackView, 068.5) alongside a UV VIEW: the mask
texture with the paint-UV island wireframe drawn over it, pan/zoom,
direct 2D painting into the same canvas, live-synced with the 3D
paint. This is where an author hand-tunes what the brush created --
reorder layers, swap the surface, adjust masks, spot mirror/seam
issues the 3D view hides.

Not necessarily a separate full-screen window (painting-in-context
beats an isolated viewer -- Substance/Blender both paint in the main
3D view with a UV panel). A dockable panel or overlay is the default;
revisit a dedicated window only if in-context proves cramped.

### 068.12 — UV test grid surface (debug aid)

A Blender-style UV test grid, shipped as a built-in "UV Test Grid"
surface you can apply to any asset slot to see how the UV mapping
lands on the mesh -- distortion, stretching, island seams. The grid
is procedural (drawn from a UV coordinate via the same node ops the
perlin/voronoi masks already use), so no bundled texture.

Keyed to the PAINT UVs (uv1), not the authored uv0: uv1 is the
xatlas-generated atlas the Surface Brush and asset scatter actually
sample, and its fragmentation (the outcrop bakes to ~900 islands) is
where nearly every paint/grass wart this epic has come from. Applying
the grid to a rock draws the atlas islands directly on the surface so
a smeared stroke or misplaced mask becomes visible. Appearances
currently only sample uv0, so this wires the grid node to read uv1 the
way painted masks already do. A uv0 variant/toggle is a later add if
authored-UV inspection is ever wanted.

## Deferred

- "Set as default for this asset" action promoting an instance's
  overrides to the definition. Trigger: nikki repeatedly re-applies
  the same override to fresh placements of one asset.
- Shader PARAMETER overrides (`shaderParameterOverrides`) getting the
  same scene scoping. Trigger: a Scene needs a tweaked parameter, not
  a different surface.
- Bulk edit (apply an override to every instance of an asset in the
  region). Trigger: first region with dozens of restyled instances.
- Reference-plus-local-layers surface composition (keep the library
  link, own only decoration layers) — today Make Local / Inline forks
  the whole surface, so later library improvements do not propagate
  to decorated instances. Trigger: the first library-surface tweak
  nikki expects to show up on already-decorated instances.
- ~~Dedicated UV-view paint window~~ PROMOTED to 068.9/068.10
  (2026-07-12): the trigger fired on the first real asset -- authored
  UVs made in-viewport painting unusable, and nikki called no more
  half measures.

### Save-UX papercuts (backlog, do at epic wrap; nikki 2026-07-13)

Surfaced after making Save Game always-available (not every mutation
flips the dirty flag -- painted-mask strokes are the known gap):

- **Unsaved-changes indicator** in the bottom system-message strip
  (where "build workspace ready" shows): a small persistent hint like
  "Unsaved changes..." reflecting save state, since the menu item no
  longer conveys it by graying out. Also worth: fix the underlying
  dirty-flag gaps (painted-mask strokes, likely others) so the
  indicator is truthful rather than always-on.
- **Save-in-progress spinner**: saving is slow enough now
  (managed-file reconciliation + mask sweep + region writes) that it
  reads as unresponsive. Show a spinner / progress affordance in the
  system strip or menu while the save runs.

## Not in this epic

- New surface/shader authoring capabilities (Plan 065 owns that
  vocabulary; this epic only moves WHERE assignments happen).
- Presence (NPC/item/player) appearance scoping.
- Water (Plan 066) and particles (Plan 067).
