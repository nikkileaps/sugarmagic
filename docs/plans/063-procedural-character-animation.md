# Plan 063 — Procedural character animation

Status: proposed
Owner: nikki + claude
Date: 2026-07-07

Related: Plan 062 (Character Wizard) — this is the phase-2 its decision 4
promised ("procedural gait synthesis... personality/bounce sliders...
knobs clips can't give"). ADR 023 governs everything this plan emits:
generated animations are ordinary clip GLBs on the standard rig core,
rotation-only plus hips translation.

## Purpose

Generate a believable first-pass idle / walk / run in seconds, then
tweak personality until it matches the character — without keyframes,
without a DCC, without stock-clip energy that doesn't fit the game.

062 proved the pipeline and exposed the gap: the vendored library's
locomotion is solid, but its only standing idle is a combat-ready
stance, its talking idle reads twitchy on chibis, and no amount of
library curation produces "cozy". Stock clips are somebody else's
personality. Studio generates motion whose personality is a slider.

## Where the vision doc and reality disagree (resolved up front)

The vision draft this plan derives from (nikki + external discussion,
2026-07-07) is adopted with three corrections:

1. **Blink is OUT.** It appears in the idle component list but facial
   animation is (correctly) excluded from scope — and wizard characters
   have no facial rig; eyes are mesh shells bound to the head bone.
   Blink returns if/when a facial tier exists.
2. **Curve editing is a LATE story, not the core.** Personality sliders
   regenerate everything; semantic-curve Bezier editing is the
   power-user layer on top. It ships in this epic but last, behind a
   reusable ui `CurveEditor`, and nothing else depends on it.
3. **Movement-speed sync is runtime territory and OUT.** Generated walk
   stride is authored to read well at the runtime's existing movement
   speed, same as the library clips. Driving clip playback rate from
   velocity is a runtime feature for a future plan.

## Decisions

1. **Composition model: motion components -> semantic curves -> bone
   tracks.** A generator (idle/walk/run) is a stack of components
   (breathing, weight shift, head motion, arm drift; leg cycle, hip
   sway, arm counter-swing, bounce, head stabilization). Each component
   emits SEMANTIC curves (scalar-over-phase, e.g. "chest breathe
   amount"); a fixed mapping projects semantic curves onto standard-rig
   bone rotations. Users think in motion terms, never bone terms.
2. **Personality controls are the primary interface**: Energy, Bounce,
   Curiosity, Fidgetiness (per the vision doc's mapping to
   speed/vertical motion/head activity/idle variation). Slider change =
   immediate regeneration = live preview. Small count, opinionated
   ranges, cozy defaults.
3. **Deterministic generation.** Same recipe -> byte-identical clip.
   Variation comes from seeded noise (seed in the recipe), never wall
   clock or unseeded random. This makes generation testable, diffs
   meaningful, and regeneration safe.
4. **Recipes ride the clip, exactly like 062.9.** Generated clip GLBs
   carry `asset.extras.sugarmagicAnimation` (generator id + version,
   personality params, seed, curve overrides). Reopening a generated
   animation restores the sliders and edited curves. Same
   stamped-recipe pattern, same reopen affordance, same "output is
   ordinary content" guarantee.
5. **Generated and library clips coexist per slot.** The library's
   Walk/Jog are good; its idle is the problem. Each animation slot picks
   its source: a Studio generator or a vendored library clip.
   Nothing forces regeneration of what already works.
6. **Perfect loops by construction.** All components are periodic in
   phase [0,1); curves close by definition. No loop-seam authoring, no
   crossfade hacks.
7. **Output obeys ADR 023.** Rotation tracks on core bones + one hips
   translation track, quaternion keyframes sampled from the composed
   curves (adaptive or fixed-rate sampling — implementation detail
   behind the io writer). The standard-rig contract tests apply to
   generated clips unchanged.

## Architecture (same seams as 062, no new layers)

- **`packages/character-rig`** (pure, THREE-free) gains a `motion/`
  module: curve primitives (periodic composites of sine + seeded noise
  + Bezier segments), the `MotionComponent` Strategy interface, the
  three generators as component stacks, semantic-curve -> bone-rotation
  projection over `STANDARD_RIG_CORE`, and track sampling. No worker
  needed at these sizes; pure functions, heavily unit-tested.
- **`packages/domain`** gains only the recipe TYPES
  (`MotionRecipe`: generator id/version, params, seed, curve
  overrides) — the persisted contract, versioned like the rig.
- **`packages/io`** gains `buildClipGlb` (tracks -> animation GLB with
  samplers/accessors; the write-side sibling of the clip readers) and
  recipe stamp/read helpers. Commit reuses the 062 character-wizard io
  family (same directories, same definition kinds, attribution not
  required for generated output).
- **`packages/ui`** gains `CurveEditor` (late story): reusable
  Bezier-handle curve surface, consumer-agnostic.
- **`packages/workspaces`** gains the animation panel: launched from
  the character preview HUD next to the rig button (Player + NPC both,
  same shared component), gated like Edit on `rigId` — standard-rig
  characters only. Per-slot generator picker + personality sliders +
  live preview through the existing `CharacterPreview`; save commits
  clips and rebinds slots via the exact 062 commit/rebind path
  (upsert-safe, blob refresh included).

## Patterns and build-vs-buy (recorded 2026-07-07)

Design patterns in play — all continuations of the 062 seams:

- **Pipeline of pure stages**: generate channels -> project -> sample ->
  write GLB -> commit; each stage a pure, separately-tested function.
- **Strategy, twice**: `MotionComponent` (one conceptual piece of
  motion — breathing, weight shift, leg cycle — contributing curves to
  semantic channels; generators are component STACKS composed by
  `composeComponents`) and the generator seam itself (idle/walk/run all
  emit `ComposedMotion` into one sampler).
- **Data-driven single source of truth**: `CHANNEL_PROJECTION` is the
  only place semantic channels meet bone names.
- **Memento**: the `sugarmagicAnimation` recipe in clip extras restores
  editor state on reopen — the 062.9 recipe pattern, same lineage as
  Plan 055's SaveParticipant.
- **Curves are plain data** (harmonics + seeded periodic noise, no
  closures): serializable into recipes, ready for §063.5 overrides.
- Layering unchanged: domain (types) <- character-rig (pure, THREE-free,
  zero new deps) <- io <- workspaces/studio (services DI). Runtime and
  publish targets untouched.

Build-vs-buy, surveyed before 063.3:

- **Gait/idle synthesis**: no JS/TS OSS exists; the ecosystem's
  "procedural animation" is runtime IK (THREE.IK et al), a different
  problem. Hand-rolled core (~350 lines) also carries a hard
  requirement no general library gives: deterministic byte-identical
  output.
- **`simplex-noise`**: rejected — our periodic value noise is ~30
  dependency-free lines and character-rig stays zero-dep/worker-safe.
- **`@gltf-transform/core`**: evaluated for the 063.3 clip writer,
  rejected — io already has tested chunk-level GLB code from 062 with
  the byte-level control the merge/stamp semantics need, and a clip GLB
  is a small fixed shape. Revisit trigger: io/glb growing
  general-purpose transform features.
- **`bezier-js`** (tiny, MIT): PLANNED for §063.5 curve math instead of
  hand-rolling Bezier evaluation. Theatre.js rejected as the curve UI
  (full studio environment, own state model — fights the MVVM store
  rules); `CurveEditor` is bespoke Mantine.

## Stories

### 063.1 — Motion core: curves, components, idle generator

- Curve primitives + seeded noise; `MotionComponent` interface;
  semantic->bone projection over the core rig; track sampling.
- Idle = breathing + weight shift + head motion + arm drift, with the
  personality mapping (Energy/Bounce/Curiosity/Fidgetiness).
- Tests: determinism (same recipe = same tracks), loop closure,
  contract compliance (core bones only, unit quaternions), personality
  monotonicity sanity (more Bounce = more hips amplitude).

### 063.2 — Walk + run generators

- Leg cycle (phase-offset legs, knee flexion), hip sway, arm
  counter-swing, body bounce, head stabilization; hips translation bob.
  Run = walk components at run parameterization, not a fork.
- The acceptance bar is Mim: cozy walk/run that reads at least as well
  as the library clips at the runtime's movement speed.

### 063.3 — io: clip writer + recipe

- `buildClipGlb` (tracks -> GLB animation), `sugarmagicAnimation` recipe
  stamp + reader, domain recipe types.
- Generated clips pass the standard-rig contract test suite unchanged;
  round-trip test (write -> read -> identical tracks; recipe survives).

### 063.4 — Animation panel (workspaces + studio)

- Motion button in the CharacterPreview HUD (rigId-gated). Panel: slot
  list (idle/walk/run), per-slot source picker (generator | library
  clip), personality sliders with live regenerate-and-preview, save.
- Save commits generated clip GLBs + rebinds slots through the 062
  edit-commit path. Reopening a generated slot restores its recipe.

### 063.5 — Pose adjust: puppet handles on the base pose (added 2026-07-07, nikki)

Generated motion layers on a relaxed base pose (extracted from the
library idle's mean; arms-down fix). The pose itself must be
tweakable without keyframes: "pull her arms further from the body"
is a POSE note, not an animation note. An "Adjust pose" mode in the
animation panel freezes the preview at the base pose and shows
draggable handles at the wrists (and elbows if free): dragging a
wrist pivots the arm at the SHOULDER via shortest-arc rotation
(single-joint, not chain IK), mirrored by default like the wizard's
markers. Release regenerates the clip live. The per-bone pose
overrides persist in the MotionRecipe (`basePoseOverrides`) and
compose onto the relaxed base at generation, so they survive reopen
and ride the clip like everything else. Scope guard: no spine
bending, no foot planting, no chain IK — that is DCC territory; this
is the same mechanism a future pose library stands on.

### 063.6 — Semantic curve editing (late, additive)

- `CurveEditor` in packages/ui (reusable Bezier curve surface).
- Per-semantic-curve overrides (Breathing, Weight Shift, Head Motion,
  Arm Swing, Bounce) layered onto generator output; overrides persist
  in the recipe and survive regeneration where compatible (param
  changes that invalidate an override drop it with a visible notice,
  never silently).

### 063.7 — Verify end-to-end

- Mim gets the Animal Crossing treatment: generated cozy idle replaces
  the combat stance; walk/run either generated or kept from the
  library, her call. Preview -> save -> gameplay -> (next deploy) prod.
- Regression: wizard edit-in-place, library-clip characters, and
  manually imported animations all unaffected.

## Future (named so the seams stay honest, OUT of this epic)

Additional generators (jump, sit, wave, carry, celebrate, sleep, cast —
the vision doc's list) each become one component-stack story riding
063.1's framework. Runtime velocity-synced playback rate. Tail
secondary motion (needs 062's deferred tail chain first). Facial tier
(unlocks blink). Animation state machines, IK, mocap, retargeting
arbitrary rigs: still out.
