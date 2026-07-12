# Plan 065 — Environment charm tools: scatter brush, water, ambient particles, masking UX

Status: in progress — review remediation (065.1-2 shipped; 065.3-4 promoted to Plans 066/067; 065.5 deferred with trigger; 065.6+ from the end-of-epic multi-agent review, 2026-07-12)
Owner: nikki + claude
Date: 2026-07-09

Related: ADR 012/013 (surface + layer stack — the scatter and mask
machinery this rides), ADR 014 (render engine seams), ADR 003/015
(region ownership, library-first content). Informed by a full
audit of the landscape pipeline (2026-07-09).

## Purpose

Get the biggest environment-building wins that DON'T require
sculpted terrain, so the first playable prototype (Paul) ships on
beautiful flat-world regions. The reference imagery is stylized
cozy: dense meadows, scattered woods and props, a stream, drifting
leaves, golden light. The audit found the painting/scatter/
atmosphere foundation strong; the gaps this epic closes are the
workflow gap (props place one-by-one), the water gap (none), the
life gap (no ambient motion), and the usability gap (channel +
mask authoring is janky).

**Deliberately deferred: terrain height.** Sculpted ground is the
single biggest visual gap BUT it pulls in character grounding
(walk-on-height physics, slope handling, camera) — a heavy lift
that must not block the prototype. Revisit trigger: the prototype
is in Paul's hands and the flat ground is the loudest remaining
complaint. (When it lands, a slope mask should land with it —
that's the auto-material moment.)

## Stories

### 065.1 — Layout Sketch (grease-pencil blockout ink)

A studio-only annotation layer for blocking out a region before
building it: freehand strokes drawn directly on the landscape
plane (roads, zones, building footprints, arrows). Planning ink,
not content — it NEVER renders in game or preview (the "preview
is the game" doctrine, 2026-07-09).

- Pencil tool in the landscape workspace ToolRail beside brush/
  eraser. Options bar: small ink color palette, pen size,
  opacity, eraser toggle, show/hide sketch toggle.
- Strokes rasterize into ONE dedicated sketch bitmap per region
  (~2048 square). Bitmap ink, not vector strokes — erase-and-
  redraw beats stroke editing for blockout, at a fraction of the
  work. Brush projection reuses the landscape paint world-XZ ->
  UV math (trivial on the flat plane).
- Rendered as a transparent overlay plane just above the
  landscape in the STUDIO viewport only. No changes to the shared
  landscape material, no runtime code — the game ignores the
  field entirely.
- Persists as an authoring-only payload on the region beside
  paintPayload so sketches survive sessions.
- Bundled complement: import a reference image as an underlay
  (same overlay plane, loaded texture, adjustable opacity) for
  tracing a layout drawn elsewhere.
- v1 defers: ink undo (erase is the undo), text labels, vector
  strokes.

### 065.2 — Scatter/prop paint brush

Spray placed assets instead of placing them one-by-one: pick one
or MORE asset definitions as a palette, then paint — instances
land with density control, random pick from the palette, and
scale / rotation-yaw / position jitter ranges. Erase mode removes
brushed instances under the cursor. Same brush ergonomics as the
landscape paint overlay (radius, falloff, ring cursor, undoable
commits).

- Grounded: the Layout workspace owns placed assets
  (`PlacedAssetInstance`, packages/domain/src/region-authoring);
  the brush interaction pattern is the landscape overlay
  (apps/studio/src/viewport/overlays/landscape-authoring.ts);
  placement commits batch through the normal command path (one
  undoable command per stroke, not per instance).
- Output is ordinary placed instances — inspectable, movable with
  the existing gizmo afterward, nothing downstream changes.
- Perf note, explicit: brushed props are real instances (draw call
  each). Fine for prototype-scale woods (dozens-to-hundreds);
  instanced rendering for mega-forests is a named defer, and the
  65K-per-layer GPU scatter path remains the answer for grass-
  scale density.

### 065.3 — Stylized water v1 — PROMOTED to Plan 066

Promoted to its own epic (2026-07-12): water touches more seams
than one story covers (region element type, scene controller,
depth-reading shader, placement UI, audio hook). See
`docs/plans/066-stylized-water.md`.

### 065.4 — Ambient particle layers — PROMOTED to Plan 067

Promoted to its own epic (2026-07-12): even a tiny particle system
is its own vocabulary (presets, emitters, environment vs region
ownership). See `docs/plans/067-ambient-particles.md`.

### 065.5 — Masking + channel authoring UX rework — DEFERRED

Deferred (2026-07-12): the story was always scoped by nikki's
field-tested gripe list, and field use of the mask + noise workflow
(the ground-variety layers driving the terrain-tinted grass) went
smoothly — no concrete gripes to build against. Revisit trigger:
the first CONCRETE masking/channel friction encountered in real
authoring; scope that session's story by the actual complaint, not
this list. The audit candidates below stay as a memory aid only —
per the consult-code-not-plans rule, re-derive from the field, do
not build from this list.

- Channel list management (add/rename/reorder/delete, visibility
  toggles, per-channel thumbnails).
- The painted-mask constraint (inline surfaces only) surprises
  users silently; either lift it or explain it in the UI.
- Mask editing entry points are buried; brush-mode handoff between
  landscape paint and mask paint is unclear.
- No visualization of a mask's effect in isolation.
- No channel-weight heatmap in the viewport (~7% weight reads as
  established scatter while the ground color is invisible; a weight
  overlay makes that a five-second diagnosis).

## Review remediation stories (2026-07-12)

From the end-of-epic multi-agent review (8 finders over the branch
diff, findings hand-verified). Fix tier first, then lower tier.

### 065.6 — Ground bake churn fix

`applyLandscapeState` sets `groundBakeDirty = true` BEFORE the
no-op reference guard (packages/render-web/src/landscape/mesh.ts),
so every identity re-apply (texture loads, unrelated session
changes) fires a 512px bake + 1MB GPU readback. Move the dirty
flag after the guard; add an explicit `markGroundBakeDirty()`
called from the texture-loaded path (the one caller that
legitimately needs a rebake without a landscape change). Consider
throttling rebakes during interactive splat painting.

### 065.7 — Scatter brush stroke cancel

The input router treats Escape as cancel; the brush controller has
no `onCancel`, so a cancelled half-stroke's placements silently
leak into the next stroke's commit
(packages/workspaces/src/build/layout/scatter-brush.ts). Implement
onCancel: discard the in-flight stroke and clear the preview.

### 065.8 — Erase restricted to brush-created props (DECIDED)

Erase mode currently deletes ANY placed asset under the cursor —
a swipe can delete hand-placed props. Decision (nikki,
2026-07-12): restrict erase to brush-created instances, matching
Unreal's foliage-erase behavior. Requires marking brushed
instances (e.g. a `brushed` flag or the auto-folder membership as
the marker) and filtering the erase hit-test.

### 065.9 — Panel popover clipping regression

The shell aside's new `overflowY: auto` (scrollbar fix) creates a
clip context; non-portaled popovers (LayerMaskPopover at 300px in
a 280px panel, layer settings) now clip. Portal them
(withinPortal) or clamp widths.

### 065.10 — CPU scatter fallback lift constant

packages/render-web/src/scatter/index.ts still lifts instances
0.01 in the CPU fallback path; the GPU paths were reduced to
SCATTER_GROUND_LIFT (0.002) when fixing the floating-grass bug.
One-line alignment.

### 065.11 — Delete the dead inheritance enforcer

`applyBaseLayerColorInheritance`
(packages/runtime-core/src/shader/bindings.ts) still runs on every
scatter resolve but always no-ops since the pre-resolution seeding
fix. Bias toward deletion: remove the call and the function; the
seeding path is the single enforcer.

### 065.12 — Brush + explorer hygiene batch

Three small verified fixes: (a) dropping an asset onto its own
current folder dispatches a no-op MovePlacedAssetToFolder that
wipes the redo stack — guard it; (b) the brush session folder
survives active-region switches — reset it when the region
changes; (c) clearing or switching a scatter layer's shader leaves
stale textureBindings in the document — prune them on shader
change.

### 065.13 — Layout Sketch persistence + undo weight (lower tier)

Each sketch stroke does a synchronous 2048x2048 toDataURL and the
multi-MB PNG string lands in every unbounded undo checkpoint; the
data-URL bitmap also persists on RegionDocument and ships to
preview/publish with no stripping enforcer. Rework: async encode,
cap/redline undo retention for sketch payloads, strip authoring-
only payloads at publish.

### 065.14 — Landscape brush settings single source (lower tier)

LandscapeBrushSettings/LandscapeBrushMode exist in BOTH shell and
workspaces and the branch extended both in lockstep; the new
ScatterBrushSettings correctly lives only in shell. Collapse the
landscape duplicate to the shell definition.

### 065.15 — Per-frame scatter-hook traversal (lower tier)

RenderView traverses the entire scene graph every frame to find
`sugarmagicScatterPrepare` hooks; also its comment still claims an
onBeforeRender fallback this branch deleted. Registry instead of
traversal; fix the comment while there.

### 065.16 — Layout options-bar render scoping (lower tier)

Scatter brush slider drags re-render the entire Layout workspace
view per tick (viewport store subscription at view scope). Scope
the options bar into its own component/subscription.

### 065.17 — Shader material cache stranding (lower tier)

Material cache entries keyed by ground-texture uuid are stranded
across landscape mesh recreations (resize/dispose); parameter/
effect caches likewise on content-library swaps. Add release on
landscape mesh dispose or key rotation.

### 065.18 — Card Foliage builtin naming cleanup (lower tier)

Shipping builtins are "Card Foliage 2" (described in its own doc
comment as a diagnostic baseline) and "Card Foliage 4", with 1 and
3 deleted. Rename to intentional names (e.g. "Card Foliage Flat" /
"Card Foliage") — needs nikki's naming call, plus migration for
layers referencing the old ids.

## Not in this epic

Terrain height/sculpting + slope masks (deferred above, trigger
recorded). Spline tools (roads, river ribbons). Grass displacement
by characters (Story 36.18 remains deferred). Time-of-day
animation. Mega-forest instanced prop rendering.
