# Animation Generation

Generate and tune idle/walk/run animations for standard-rig
characters without keyframes or external tools. Architecture rules
live in
[ADR 024](/Users/nikki/projects/sugarmagic/docs/adr/024-procedural-animation-generation.md)
(extending
[ADR 023](/Users/nikki/projects/sugarmagic/docs/adr/023-standard-rig-and-character-wizard.md));
this page is the user-and-integrator surface.

## Using it

Open the Player or NPC workspace and click the animation button
(next to the rig button) in the character preview HUD — available
for Character-Wizard-generated models.

The panel shows the three animation slots (idle / walk / run).
Per slot:

- **Source**: "Generated" (procedural) or "Library clip" (the
  vendored CC0 clip). Slots choose independently — keep the
  library walk, generate the idle.
- **Personality sliders** (Generated): Energy (speed, arm swing),
  Bounce (vertical bob, hips), Curiosity (head + torso motion),
  Fidgetiness (variation, weight shifts). The preview regenerates
  live as you drag. "Reroll variation" picks a different flavor of
  the same settings.
- **Adjust pose**: freezes the preview at the character's base
  pose with draggable handles on the wrists. Dragging swings the
  whole arm at the shoulder (elbow angle preserved); Mirror (on by
  default) drives both arms symmetrically. The pose applies to all
  generated slots — it is the character's stance, not one clip's.
- **Edit curves**: reshape a semantic motion curve (Breathing,
  Weight Shift, Head Motion, Arm Drift, Bounce for idle; Weight
  Shift, Hip Twist, Torso Lean, Bounce for walk/run) with
  draggable control points. Double-click adds a point;
  double-click a point removes it; the ends wrap (one loop). An
  edited curve replaces that channel's generated signal until
  "Reset curve"; sliders keep driving everything else.

**Save** writes only the changed slots and rebinds them. Reopening
the panel restores sliders, pose, and curves exactly — the full
recipe travels inside each generated clip file.

## Interplay with the Character Wizard

- Repainting weights (markers untouched) never touches
  animations — the new weights simply deform under the same clips.
- Moving joint markers regenerates generated slots automatically
  at the new skeleton scale, personality and pose intact; library
  slots are re-copied.

## What lands in the project

```
assets/character-animations/<name>-Generated_Idle.glb   (etc.)
```

Ordinary `CharacterAnimationDefinition`s with deterministic ids —
re-saving a slot replaces its definition in place. Generated clips
are standard contract clips (see ADR 024 decision 1): publish
targets, preloading, caching, and runtime playback are unchanged.

## Integration points (for engineers)

- `packages/character-rig/src/motion/` — the pure generation
  layer: curve primitives, `MotionComponent` stacks, the
  channel-to-bone projection table, track sampling, the relaxed
  base pose, override-curve evaluation.
- `packages/domain` `MotionRecipe` — the persisted, versioned
  editing-state contract.
- `packages/io/src/glb/` `buildClipGlb` / `readClipRecipe` — clip
  assembly and recipe reading; the commit path is
  `commitCharacterAnimationClips` in `packages/io/src/character-wizard/`.
- `packages/ui` `CurveEditor` — the reusable periodic-curve
  surface.
- `packages/workspaces/src/design/animation-panel/` — the panel +
  pose viewport; Studio injects services from
  `apps/studio/src/character-wizard/`.

## Scope and limits

Idle, walk, and run generators; standard-rig humanoids only.
Left/right-paired gait channels are not curve-editable (gait
symmetry). No animation state machines, IK, mocap, or facial
animation — the external-DCC escape hatch (import a clip GLB with
matching bone names) remains for anything beyond the panel.
