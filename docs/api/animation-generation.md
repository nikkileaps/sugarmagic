# Animation Generation

Generate and tune idle/walk/run animations for standard-rig
characters without keyframes or external tools. Architecture rules
live in
[ADR 024](/Users/nikki/projects/sugarmagic/docs/adr/024-procedural-animation-generation.md)
(extending
[ADR 023](/Users/nikki/projects/sugarmagic/docs/adr/023-standard-rig-and-character-wizard.md));
this page is the user-and-integrator surface.

## Using it

Click the animation button in the Player or NPC workspace preview
(available for wizard-rigged characters) — the workspace center
becomes ANIMATION MODE (a mode tab beside the rig workbench; one
click switches between them).

- **Animations list** (left column): the three slots (idle / walk
  / run), each with a G/L badge — Generated or Library — that
  toggles the slot's source on click. Slots choose independently:
  keep the library walk, generate the idle. Dirty slots show `*`.
- **Personality** (Generated slots): Energy (speed, arm swing),
  Bounce (vertical bob, hips), Curiosity (head + torso motion),
  Fidgetiness (variation, weight shifts, tail liveliness). The
  preview regenerates live as you drag; "Reroll variation" picks a
  different flavor of the same settings.
- **Adjust pose** (viewport tool rail): puppet handles at the
  wrists (and on tailed characters, the tail: swing at the base,
  curl at the tip). Dragging a wrist swings the whole arm at the
  shoulder; Mirror drives both arms symmetrically. The pose
  applies to all generated slots — it is the character's stance,
  not one clip's.
- **Curves**: reshape a semantic motion curve (Breathing, Weight
  Shift, Head Motion, Arm Drift, Bounce for idle; Weight Shift,
  Hip Twist, Torso Lean, Bounce for walk/run; Tail on tailed
  characters) with draggable control points in a strip under the
  preview. Double-click adds a point; double-click a point removes
  it; the ends wrap. An edited curve replaces that channel's
  generated signal until "Reset curve".
- Playback (Static + slots, play/pause) sits bottom-center, as in
  every Studio viewport.

**Save** writes only the changed slots and rebinds them. The full
recipe travels inside each generated clip file — reopening
restores sliders, pose, and curves exactly. On open, each
generated slot is regenerated through the CURRENT engine and
byte-compared against the bound file: engine improvements surface
automatically as dirty slots to save, never trapped in stale
files.

## Tails

Characters rigged with the wizard's "Has tail" toggle wag: a
phase-lagged sway component joins every generated clip, and
LIBRARY clips get tail tracks merged into the per-character copy
at the host clip's loop duration — a tailed character wags on a
library walk too.

## Interplay with the Character Wizard

- Repainting weights (markers untouched) never touches
  animations — the new weights simply deform under the same clips.
- Moving joint markers regenerates generated slots automatically
  at the new skeleton scale, personality and pose intact. Slots
  bound to any non-generated clip (Quaternius library or a custom
  Animation Library import) keep their OWN bytes, re-scaled to the
  new hip height — a re-edit never swaps a custom clip back to a
  bundled default.

## Animation Library

A project-level pool of reusable clips, separate from the
per-character definitions above. Browse it under Libraries >
Animations; assign a clip to a character slot from the Animations
panel via the "Choose from Animation Library" browser.

- `AnimationLibraryDefinition` (`packages/domain`) — kind
  `"animation-library"`, with `origin: "generated" | "imported"`.
  Session CRUD: `addAnimationLibraryDefinitionToSession` (upserts
  by `definitionId`), `updateAnimationLibraryDefinitionInSession`,
  `removeAnimationLibraryDefinitionFromSession`. Removal cascades:
  any Player/NPC slot bound to the deleted entry is nulled, same
  as per-character animation removal.
- **Slot binding**: the browser stores the library `definitionId`
  directly in `animationAssetBindings`. Resolution goes through
  `resolveCharacterAnimationBinding` (the single enforcer, also
  behind `getCharacterAnimationDefinition`): per-character pool
  first, then the library pool, synthesizing a
  `CharacterAnimationDefinition` proxy on the fly. Runtime playback
  and the workspace previews both resolve through it.
- **Import** (`packages/io` `importAnimationLibraryFromGlbFile`):
  one library entry per animation action in a Blender GLB;
  validates that tracks target standard-rig bone names, strips
  meshes/materials to a skeleton-only clip, writes to
  `assets/animations/`. Re-importing the same filename replaces
  the existing entry in place (iterate on the Blender source).
- **Seed** (`packages/io` `seedCozyAnimations`): generates the
  three Cozy starter clips on project open, skipping well-known
  ids (`cozySeedDefinitionId`) already in the session — safe to
  call every open.

Tests: `packages/testing/src/animation-library-definition.test.ts`
and `animation-import.test.ts`.

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
