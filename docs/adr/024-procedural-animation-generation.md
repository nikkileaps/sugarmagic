# ADR 024: Procedural Animation Generation

Status: accepted
Date: 2026-07-07

## Context

Studio generates idle/walk/run animations procedurally for
standard-rig characters (the animation panel), replacing or
complementing the vendored CC0 clip library. The library's clips
carry someone else's personality (its only standing idle is a
combat stance); generation makes personality a parameter. These
rules were settled during implementation on a real chibi character
and extend ADR 023.

## Decisions

### 1. Generated clips are ordinary contract clips

Output obeys ADR 023 exactly: rotation tracks on core bones plus
one hips translation, absolute contract-local rotations, bound by
bone NAME at playback. `buildClipGlb` (`packages/io/src/glb/`)
emits the same shape as a vendored clip; per-character hip-height
scaling, the standard-rig contract tests, and every publish target
treat generated clips identically. Nothing downstream knows
generation exists.

### 2. Composition: components -> semantic channels -> bones

A generator is a stack of `MotionComponent`s (breathing, weight
shift, leg cycle, arm counter-swing...), each contributing periodic
curves to SEMANTIC channels; contributions to a channel sum.
`CHANNEL_PROJECTION` (`packages/character-rig/src/motion/`) is the
single place channels meet bone names. Run is the walk component
stack at a different gait parameterization, never a fork. Users
think in motion terms; bone names appear in one table.

### 3. Determinism is a hard rule

Same recipe = byte-identical clip. All curves are harmonics at
integer cycle counts (loops close by construction) plus PERIODIC
seeded value noise; the only randomness source is the recipe's
seed. No wall clock, no unseeded random. This makes generation
testable, diffs meaningful, and regeneration safe.

### 4. The recipe rides the clip

`MotionRecipe` (domain: generator id + schema version, personality
params, seed, pose overrides, curve overrides) is stamped into the
clip GLB's `asset.extras.sugarmagicAnimation`. Reopening a
generated slot restores its full editing state from the file —
the same Memento pattern as the wizard's rig recipe (ADR 023
decision 6). Readers reject newer schema versions rather than
misinterpret them.

### 5. Motion layers on an extracted relaxed base pose

The contract rest is a T-pose; generating small offsets around it
leaves characters T-posing. The vendor script extracts a relaxed
base pose from the library's own Idle_Loop (per-bone mean rotation
as an offset from rest, `STANDARD_RIG_RELAXED_POSE`); generation
layers motion on the ARM-chain subset — arms hang like the library
authored, legs and spine stay neutral-upright. User pose
adjustments (puppet handles: wrist drag pivots the whole arm at
the shoulder, shortest-arc, mirrored) compose on top and persist
in the recipe.

### 6. User curve overrides replace channel signals

A semantic-curve override (periodic Catmull-Rom through control
points, wrap-around seam) REPLACES that channel's generated
signal; personality sliders keep driving everything else.
Left/right-paired locomotion channels are not user-editable —
reshaping one side breaks gait symmetry; that is DCC territory.

### 7. Generated and library clips coexist per slot

Each animation slot independently binds a generated clip or a
vendored library clip. Wizard edits preserve slot character:
weights-only edits touch nothing animation-side; skeleton-changing
edits regenerate recipe-carrying slots at the new hip scale and
re-copy library slots.

## Consequences

- New generators (sit, wave, carry...) are component stacks — one
  story each on the existing framework, no new layers.
- A future tail-bone contract extension gets wag components and
  even tail motion baked into copied library clips for free
  (name-based binding degrades gracefully in both directions).
- Runtime velocity-synced playback rate remains a runtime concern,
  out of scope here.
- Enforcement: `packages/testing/src/character-motion*.test.ts`
  pins determinism, loop closure, contract compliance, personality
  monotonicity, and override semantics.
