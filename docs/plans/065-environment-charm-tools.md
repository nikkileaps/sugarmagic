# Plan 065 — Environment charm tools: scatter brush, water, ambient particles, masking UX

Status: proposed
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

### 065.3 — Stylized water v1 (plane + shader)

A `water` region element: a placeable rectangular water plane
(position, size, surface height) rendered with a stylized water
material — depth-tinted color ramp (shallow -> deep), scrolling
surface normals/sparkle, and EDGE FOAM where the water meets
geometry (scene-depth delta). Parameters exposed: shallow/deep
colors, foam color/width, scroll speed/direction, wave scale.

- Rides the environment/render seams (ADR 014): a scene controller
  in packages/render-web alongside landscape/environment
  controllers; domain gets the water settings type on the region;
  Layout workspace places/sizes it like an asset.
- Rivers-as-splines are explicitly v2 (defer with trigger: first
  region that needs a bending stream; the shader carries over).

### 065.4 — Ambient particle layers

Environment-level particle systems for drifting charm: leaf-fall,
dust motes, petals, fireflies as authorable presets. Region-wide
(or box-bounded) emitters, GPU-instanced quads, wind-aligned
drift + flutter, soft fade in/out. Parameters: preset, density,
size range, color/tint, drift direction/speed, flutter amount.

- Lives on `EnvironmentDefinition` beside fog/sky/post; realized
  by a small controller in packages/render-web (instanced quads,
  no physics, deterministic seeded motion in the vertex stage —
  cheap and deploy-safe).
- Presets ship as built-ins like the wind/grass presets do.

### 065.5 — Masking + channel authoring UX rework

The splatmap-channel and layer-mask workflows work but are janky:
channel management, painted-mask gating rules (inline-only), mask
type discoverability, and the layer-stack editor ergonomics all
have friction. nikki is field-testing the current flow and will
supply the concrete gripe list; this story is scoped by those
findings. Known candidates from the audit, to be confirmed:

- Channel list management (add/rename/reorder/delete, visibility
  toggles, per-channel thumbnails).
- The painted-mask constraint (inline surfaces only) surprises
  users silently; either lift it or explain it in the UI.
- Mask editing entry points are buried; brush-mode handoff between
  landscape paint and mask paint is unclear.
- No visualization of a mask's effect in isolation (a "show this
  mask as heatmap" toggle, like the weight heatmap).
- No channel-weight heatmap in the viewport. Confirmed in the
  field (2026-07-10): scatter density reads as "established" at
  ~7% weight while the channel's ground color is still invisible
  at that weight, so underpainting looks like a broken surface
  instead of a light touch. A weight overlay would make this a
  five-second diagnosis; also consider a higher default brush
  strength for channel painting.

## Not in this epic

Terrain height/sculpting + slope masks (deferred above, trigger
recorded). Spline tools (roads, river ribbons). Grass displacement
by characters (Story 36.18 remains deferred). Time-of-day
animation. Mega-forest instanced prop rendering.
