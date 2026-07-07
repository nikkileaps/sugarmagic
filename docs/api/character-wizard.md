# Character Wizard

Turn a static stylized-humanoid GLB into a rigged, animated,
game-ready character without leaving Studio. Architecture rules and
rationale live in
[ADR 023](/Users/nikki/projects/sugarmagic/docs/adr/023-standard-rig-and-character-wizard.md);
this page is the user-and-integrator surface.

## Using it

Open the Player or NPC workspace and click the rig button in the
character preview HUD. The wizard steps:

1. **Import** — pick a GLB (upright, facing forward, A-pose or T-pose)
   and name the character. The name seeds asset file names and is
   locked once committed.
2. **Joints** — 16 detected joint markers rendered on the model; drag
   to correct. Mirroring is on by default (moving one side places its
   twin). Detection assists; you decide.
3. **Weights** (optional, skippable) — automatic binding runs first
   (in a worker, with progress); this step is the touch-up surface:
   - Heatmap of the selected bone's influence; searchable bone picker
     over the 23 core bones.
   - Brush modes: Add, Subtract, Smooth, Fill. Subtract borrows a
     receiving bone from surrounding territory, so it works even on
     fully-owned regions.
   - Piece isolation by material name — other pieces ghost out and
     stop catching the brush, so layered clothing and occluded parts
     are paintable. "Fill piece with bone" rigidly assigns a whole
     piece.
   - Mirror L>R / R>L stamps one side's weights onto the other with
     left/right bones swapped.
   - Animate toggle plays idle while you paint (live deformation);
     off = true bind pose.
4. **Preview** — idle/walk/run on the finished character.
5. **Finish** — assets are written and the workspace's animation slots
   are bound. Done.

## Editing later

For a wizard-made character the same rig button reopens the wizard
with markers and painted weights exactly as you left them (the model
GLB carries its recipe; see ADR 023 decision 6). Markers untouched =
your weights survive; markers moved = fresh automatic solve. Saving
overwrites the same asset files; bindings stay put.

## What lands in the project

```
assets/character-models/<name>-rigged.glb    the playable character
assets/character-models/<name>-source.glb    untouched import (edit fuel)
assets/character-animations/<name>-<Clip>.glb  idle / walk / run
assets/character-animations/QUATERNIUS-ATTRIBUTION.md
```

All ordinary content-library definitions (`CharacterModelDefinition`,
`CharacterAnimationDefinition`) — publish targets, preloading, and
caching treat wizard output like any imported asset.

## Integration points (for engineers)

- `packages/character-rig` — pure, THREE-free algorithm layer:
  detection, skeleton generation, geodesic voxel weight solve
  (`WeightSolver` strategy seam), weight-paint ops.
- `packages/io/src/glb/` — GLB read/pack/extract, skinned assembly,
  clip hips scaling, recipe reading. `packages/io/src/character-wizard/`
  — the commit function (import-family shape).
- `packages/ui` `WizardDialog` — the reusable stepper modal frame.
- `packages/workspaces/src/design/character-wizard/` — the wizard UI;
  Studio injects services (`apps/studio/src/character-wizard/`),
  including the weight-solve worker.
- The standard rig contract and vendored clips: see ADR 023.

## Scope and limits

Stylized humanoids (cozy-game proportions are the design center).
Quadrupeds, arbitrary body plans, and thin layered cloth physics are
out. Tails have no dedicated bones yet — the paint step's Fill tool
assigns a tail rigidly to a spine bone, which reads well on chunky
characters. External DCC editing of the output GLB works (bone names
are the interface) but drops the reopen-for-edit recipe.
