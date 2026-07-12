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

### 068.5 — Slim the Asset Manager modal

Remove the Surfaces and Deform/Effect editors from the asset
definition inspector in the modal (`AssetDefinitionInspector`): it
keeps display name, type, source, import/replace. Point the removed
sections' users at the Layout inspector (empty-state hint). Delete
dead editor wiring rather than hiding it. Definition defaults remain
in the schema and resolution untouched.

### 068.6 — Viewport + explorer truth

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
- Reference-plus-local-layers surface composition (keep the library
  link, own only decoration layers) — today Make Local / Inline forks
  the whole surface, so later library improvements do not propagate
  to decorated instances. Trigger: the first library-surface tweak
  nikki expects to show up on already-decorated instances.
- Dedicated UV-view paint window (model + flattened UV preview,
  Substance-style). In-viewport painting ships first for context; the
  toolbar's mask thumbnail covers mirror-spotting. Trigger: the first
  prop where in-viewport strokes cannot reach or cannot be precise
  enough.

## Not in this epic

- New surface/shader authoring capabilities (Plan 065 owns that
  vocabulary; this epic only moves WHERE assignments happen).
- Presence (NPC/item/player) appearance scoping.
- Water (Plan 066) and particles (Plan 067).
