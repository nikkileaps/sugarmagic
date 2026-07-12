# Plan 065 — Environment charm tools: scatter brush, water, ambient particles, masking UX

Status: complete (065.1-2 shipped; 065.3-4 promoted to Plans 066/067; 065.5 deferred with trigger)
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

## Not in this epic

Terrain height/sculpting + slope masks (deferred above, trigger
recorded). Spline tools (roads, river ribbons). Grass displacement
by characters (Story 36.18 remains deferred). Time-of-day
animation. Mega-forest instanced prop rendering.
