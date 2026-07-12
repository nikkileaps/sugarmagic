# Plan 066 — Stylized water

Status: proposed
Owner: nikki + claude
Date: 2026-07-12

Related: ADR 014 (render engine seams), ADR 025 (shader color space
rules — all water color math follows it), Plan 065 (this story was
065.3 before being promoted to its own epic; 065 keeps a pointer).

## Purpose

The reference environments have streams, ponds, and shorelines the
flat-world regions currently cannot express at all — water is the
single largest "charm" element with no v1. Promoted out of Plan 065
because water touches more seams than a single story honestly
covers: a new region element type, a new scene controller, a
depth-reading shader, placement UI, and (eventually) audio and
gameplay hooks.

## Stories

### 066.1 — Water region element + placement

A `water` element on the region document: rectangular plane with
position, size, and surface height. Layout workspace places and
sizes it like an asset (gizmo move/scale, inspector fields).
Persists on the region beside landscape; the game runtime renders
it wherever the region loads.

- Domain type + commands (create/update/delete, one undo each).
- Scene controller in packages/render-web beside the landscape /
  environment controllers (ADR 014 seams) — owns the plane mesh
  and material lifecycle.

### 066.2 — Stylized water material

The look: depth-tinted color ramp (shallow -> deep via scene-depth
delta), scrolling surface normal/sparkle detail, and EDGE FOAM
where water meets geometry. Parameters: shallow/deep colors, foam
color/width, scroll speed/direction, wave scale.

- Authored as a shader graph where practical so parameters ride
  the existing shader-editing story; effect nodes (scene depth
  delta) may need one or two new node types, built as GENERAL
  nodes per the no-one-offs rule.
- Color parameters follow ADR 025 (authored sRGB, declared
  chokepoint conversions).

### 066.3 — Water audio + ambience hook

Water placement should be hearable: an optional sound-cue binding
on the water element (lapping/stream loop) that registers with the
existing region ambience/sound-emitter machinery rather than a new
audio path.

## Deferred

- Rivers as splines (bending streams). Trigger: the first region
  that needs a stream that turns a corner. The 066.2 shader carries
  over unchanged; only the mesh/UV generation is new.
- Swimming / water gameplay (buoyancy, depth triggers). Trigger:
  a design doc asks for the player to enter water.
- Reflections beyond sparkle (SSR/planar). Trigger: a shoreline
  vista shot where their absence visibly hurts.

## Not in this epic

Waterfalls, rain/weather, water physics of any kind.
