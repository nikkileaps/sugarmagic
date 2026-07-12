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

### 068.4 — Slim the Asset Manager modal

Remove the Surfaces and Deform/Effect editors from the asset
definition inspector in the modal (`AssetDefinitionInspector`): it
keeps display name, type, source, import/replace. Point the removed
sections' users at the Layout inspector (empty-state hint). Delete
dead editor wiring rather than hiding it. Definition defaults remain
in the schema and resolution untouched.

### 068.5 — Viewport + explorer truth

Scene-scoped appearance must read as such everywhere the instance
shows: the viewport re-resolves when the active Scene changes (verify
the projection already carries activeScene through
`resolveEffectiveAssetShaderBindings` — extend if the binding
resolution predates scenes), and the explorer/inspector indicate when
the current look is a Scene restyle of a base placement. Ensure
preview-vs-committed staleness (shader ensure loop) picks up override
changes without a reload.

## Deferred

- "Set as default for this asset" action promoting an instance's
  overrides to the definition. Trigger: nikki repeatedly re-applies
  the same override to fresh placements of one asset.
- Shader PARAMETER overrides (`shaderParameterOverrides`) getting the
  same scene scoping. Trigger: a Scene needs a tweaked parameter, not
  a different surface.
- Bulk edit (apply an override to every instance of an asset in the
  region). Trigger: first region with dozens of restyled instances.
- Instance-scoped painted masks (moss on THIS roof only — painted
  mask addresses are per assetDefinitionId + slot today, so a painted
  layer reads the same on every instance). Procedural masks (noise /
  height / world-gradient) already vary per placement and cover much
  of the want. Trigger: a scene where two instances of one asset need
  visibly different painted detail.

## Not in this epic

- New surface/shader authoring capabilities (Plan 065 owns that
  vocabulary; this epic only moves WHERE assignments happen).
- Presence (NPC/item/player) appearance scoping.
- Water (Plan 066) and particles (Plan 067).
