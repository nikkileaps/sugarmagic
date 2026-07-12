# Plan 067 — Ambient particle layers

Status: proposed
Owner: nikki + claude
Date: 2026-07-12

Related: ADR 014 (render engine seams), Plan 065 (this story was
065.4 before being promoted to its own epic; 065 keeps a pointer).
The instanced-quad + seeded-vertex-motion approach mirrors the
scatter/wind machinery from the grass work (2026-07-11).

## Purpose

The "life gap": regions are still. Drifting leaves, dust motes,
petals, and fireflies are the cheapest motion that makes a scene
feel alive. Promoted out of Plan 065 because a particle system —
even a deliberately tiny one — is its own vocabulary (emitters,
presets, lifetimes, environment vs region ownership) and deserves
scoping that a single story was glossing over.

## Stories

### 067.1 — Particle layer type + built-in presets

An ambient particle layer authorable on `EnvironmentDefinition`
beside fog/sky/post: preset + density + size range + color tint +
drift direction/speed + flutter amount. Presets ship as built-ins
(leaf-fall, motes, petals, fireflies) the way wind/grass presets
do — duplicate-to-edit, factory-merged on load.

### 067.2 — Render controller

A small controller in packages/render-web (ADR 014 seams):
GPU-instanced quads, no physics — deterministic seeded motion
computed in the vertex stage (the wind-sway idiom), wind-aligned
drift + flutter, soft fade at spawn/despawn. Region-wide emitter
volume for v1.

- Lessons that MUST carry over from the grass work: instanced
  attributes read in the vertex stage only; any bake/texture the
  quads sample published as a plain DataTexture; color parameters
  per ADR 025.

### 067.3 — Bounded emitters + authoring polish

Box-bounded emitters (fireflies by the pond, motes in a sunbeam)
placed in the Layout workspace; per-region overrides of the
environment-level layers; density preview that reads correctly in
the Studio viewport.

## Deferred

- Interaction with characters (leaves swirling on walk-through).
  Trigger: prototype feedback names it.
- Collision/settling (leaves landing on roofs). Trigger: a shot
  where pass-through visibly breaks the illusion.
- Weather systems (rain, snow as gameplay states). Trigger: a
  design doc asks for weather, not ambience.

## Not in this epic

VFX particles (spell effects, hit sparks — those belong to a
gameplay-effects system), audio-reactive particles, soft-particle
depth fade against geometry (revisit with the water epic's
scene-depth machinery if both land).
