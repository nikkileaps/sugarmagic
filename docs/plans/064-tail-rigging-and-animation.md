# Plan 064 — Tails: rig extension, binding, and wag

Status: shipped (2026-07-08)
Owner: nikki + claude
Date: 2026-07-07

Related: Plan 062 (Character Wizard — named "tails (phase 2)" from
day one), Plan 063 (procedural animation — the wag rides its
component framework). ADR 023 governs the contract change; ADR 024
governs the generated motion.

## Purpose

Tailed characters are the design center of this product's games,
and today a tail is a workaround: mesh Fill-painted rigid to a
spine bone, moving only with the torso. This epic makes tails
first-class: the wizard rigs them with real bones, the weight
solver binds them, generated animations wag them, and even
library-clip slots get tail motion. The acceptance image is
specific: a cute idle tail wag.

## Decisions

1. **The tail is an OPTIONAL contract extension, versioned.** Three
   bones — `DEF-tail.001..003` chained off `DEF-hips` — defined in a
   hand-authored domain module (`STANDARD_RIG_TAIL_EXTENSION`), NOT
   generated from the vendored source (the Quaternius rig has no
   tail; this is our extension, so its rest pose — an arc up and
   back — is ours to author). `STANDARD_RIG_SCHEMA_VERSION` bumps to
   2 per ADR 023, with the compatibility story written down:
   additive optional bones. Name-based binding degrades gracefully
   in BOTH directions — tail-less characters ignore tail tracks,
   tail-less clips leave tail bones at rest — so no existing
   content migrates.
2. **The wizard grows a "Has tail" toggle** in the Joints step:
   three extra markers (base / mid / tip), manually placed in v1
   (detection heuristics for rear protrusions can come later —
   detection assists, the human decides). Skeleton generation
   appends the rest-aligned chain exactly like limbs; the geodesic
   solver binds the tail region through the same segment machinery.
   Existing Fill-painted tails keep working unchanged; re-running
   the wizard with the toggle upgrades them.
3. **The wag is a MotionComponent** emitting per-bone sway channels
   with PHASE LAG down the chain (base leads, tip whips after) —
   the lag is the cuteness and cannot be expressed as gains on one
   channel, hence one semantic channel per tail bone. Amplitude and
   rate map into the existing personality controls (Fidgetiness
   drives liveliness, Energy drives rate); the composite "Tail"
   curve is editable in the panel like any other semantic channel.
4. **Library-clip slots get the wag baked in at copy time.** The
   vendored clips have no tail tracks, so a tailed character on a
   library walk would drag a rigid tail. Clips are per-character
   COPIES — io gains a track-merge step that appends generated tail
   tracks into the copied library clip for tailed characters. No
   runtime changes, no blending machinery; the copy is simply a
   better clip.
5. **Recipes stay schema-v1.** Tail parameters are an additive
   optional field on `MotionRecipe` (readers already accept older
   recipes; additive fields need no bump). The wizard's rig recipe
   (`sugarmagicRig` extras) gains the optional tail markers the
   same way, so edit-in-place round-trips tails.

## Architecture (no new layers)

- **domain** — the tail extension module (bones, rest pose,
  landmark names, schema-version bump + compatibility note) and the
  optional recipe/landmark fields.
- **character-rig** — skeleton generation appends the chain from
  tail landmarks (same rest-alignment math as limbs); tail segments
  flow into `computeBoneSegments` (weights) and the projection
  table gains the per-bone tail channels; the wag
  `MotionComponent` joins the idle/walk/run stacks conditionally
  (tailed skeletons only).
- **io** — `mergeClipTracks` (append animation channels/samplers +
  accessors to an existing clip GLB) used at library-clip copy for
  tailed characters; wizard recipe stamp carries tail landmarks.
- **workspaces + studio** — the Joints-step toggle + three markers
  (MarkerViewport already supports arbitrary landmark sets), a
  "Tail" entry in the panel's editable curves, weight-paint bone
  picker inherits the new bones automatically.

## Decisions from implementation (2026-07-07/08 — the weight-tooling saga)

The epic's stories shipped as planned; verification on the real
character then drove a WEEK's worth of weight tooling and a full UX
rework into scope. The load-bearing outcomes:

- **Tail rest arc is authored squirrel-upright** (steep curl toward
  vertical) — the design-center default; per-character stance lives
  in pose-adjust overrides. Pose adjust gained tail handles (swing at
  the base, curl at the tip; sagittal, no mirroring).
- **The relaxed base pose is symmetrized and de-slouched at vendor
  time**: the library idle's mean is a combat stance (right arm held
  back, ~29 degrees of elbow bend) — mirror-averaged L/R pairs and
  forearm/hand offsets scaled toward identity (~9 degrees) so
  generated clips hang straight and symmetric. Better weights EXPOSED
  both flaws; they were invisible while sleeves ignored arms.
- **Walk arm counter-swing needs SAME-side channel phases**: the
  swing rotation applies in the arm's hanging frame, which inverts
  the world sense of the axis vs the thigh — textbook opposite phases
  produced arms pinned to the legs. Comment pinned at the component.
- **Robust weight transfer ("shrinkwrap") is the layered-clothing
  doctrine**: Abdrashitov et al. (SIGGRAPH Asia 2023) two-stage
  transfer — confident point-on-surface matches (distance + normal
  gates) + Laplacian inpainting for the rest — implemented pure in
  character-rig. MULTI-SOURCE matters: garments cascade inner-to-
  outer (shirt <- body; jacket <- body + shirt + pants) or open
  front panels inpaint from sleeve territory and flood with arm
  weights.
- **Mirror weights is for symmetric geometry ONLY and must report**:
  her jacket is 73% asymmetric (no mirror twins) — silent partial
  mirroring produced "mirroring has never worked" garbage for days.
  It now reports matched/unmatched counts; clothing uses shrinkwrap.
- **Virtual body regions** (head/torso/tail/arms/legs) come free from
  the pristine solve's dominant-bone partition — with two hard-won
  rules: coincident seam twins classify JOINTLY (a split pair hid an
  unfixable surface tear), and the partition inherits the solve's
  own leaks, so region-scoped operations accept a box SELECTION as
  the target override.
- **"Pristine" lies in edit sessions**: session-start state is
  whatever the file held, including damage. Resets are labeled
  "session start"; a "Fresh auto-solve (ALL pieces)" action runs the
  real solver in-session and re-baselines pristine + regions.
- **Box select (x-ray, shift-add) + T-pose viewing aid** turned
  occluded-region weighting (armpits) from brush archaeology into
  geometry. T-pose = the contract rest, free by construction.
- **UX rework (nikki's design)**: the wizard is lean again (import ->
  markers -> generate+commit); ALL weight tooling lives in the
  workspace WeightWorkbench (Blender-style properties column + tool
  rail: brush/box/shrinkwrap, tool-scoped settings); the animation
  panel became a workspace mode with the same structure; the rig and
  animation buttons are mode tabs; playback (Static/idle/walk/run +
  play/pause) is bottom-center in every viewport.
- **Stale generated clips self-heal**: the animation mode regenerates
  each recipe through the current engine on open and byte-compares —
  engine improvements reach saved characters as auto-flagged dirty
  slots instead of being trapped in old files.
- **Procedural accessories worked as a content experiment**: a
  ponytail (and bangs) were appended to the character's GLBs as
  head-weighted primitives, placed by MEASURING the skull surface
  from head-weighted vertices. Validated the pipeline end-to-end;
  productizing it is a defer.

## Stories

### 064.1 — Domain: tail contract extension

- `STANDARD_RIG_TAIL_EXTENSION` (3 bones off hips, authored rest
  arc), schema version 2 with the additive-optional compatibility
  rule documented in the module and in ADR 023's terms.
- Contract tests: extension bones parent correctly, core set
  unchanged, vendored clips still target core-only.

### 064.2 — Wizard: rig + bind tails

- "Has tail" toggle in the Joints step; base/mid/tip markers
  (mirroring-exempt: tails are sagittal). Skeleton generation
  appends the rest-aligned chain; segments feed the weight solver;
  the paint step's bone picker gains the tail bones.
- Rig recipe carries tail landmarks; edit-in-place round-trips.
- Regression: tail-less characters and existing Fill-painted tails
  byte-identical through the wizard.

### 064.3 — The wag

- `tailWag` component: per-bone sway channels, phase lag down the
  chain, personality-mapped amplitude/rate; joins all three
  generator stacks for tailed skeletons.
- Panel: "Tail" appears in the editable curves for tailed
  characters.
- Tests: lag ordering (tip trails base), amplitude monotonicity
  with Fidgetiness, tracks only emitted for tailed skeletons.

### 064.4 — Library-clip tail overlay

- io `mergeClipTracks`; library-clip copies for tailed characters
  gain generated tail tracks (duration-matched to the host clip's
  loop). Applied in the panel's library path and the wizard's
  clip-copy path.
- Tests: merged clip passes contract checks (tail translation
  still absent, rotation-only), untouched for tail-less characters.

### 064.5 — Verify end-to-end (DONE 2026-07-08, exhaustively)

- Mim re-runs the wizard with "Has tail": markers on her actual
  tail, real bones, solver-bound weights (retiring her Fill
  workaround), wag in generated idle AND in a library walk.
  Preview -> save -> gameplay -> deploy leg at next prod push.
- Regression: existing characters and clips unaffected.

## Defers (with revisit triggers)

- **Runtime spring/jiggle bones (plan 065 candidate)** — ponytail,
  tail tip, ears reacting to actual gameplay motion (the UE5-style
  AnimDynamics equivalent). Trigger: named and wanted; write plan
  065 when the cozy factor demands it.
- **Procedural accessory authoring in Studio** — the pony/bangs
  experiment as a real tool (parametric tuft/prop generator, surface-
  anchored, auto-weighted). Trigger: the third hand-scripted
  accessory request.
- **Elbow/knee pose handles** — pose adjust pivots shoulders and
  tail only; elbow bend needed a vendor-data change instead.
  Trigger: first pose note that needs a mid-chain joint.
- **Selection-scoped weight copy** — revisit shrinkwrap-onto-
  selection UX if garment-to-garment transfer wants finer targets.
- **Proper bangs modeling** — content work in Blender at the next
  model pass; the procedural shell is the placeholder.

## Not in this epic

Ears / generalized secondary appendages (the tail extension is the
template; generalize when a second appendage type is real).
Physics/spring tail dynamics (the wag is authored motion, not
simulation). Quadrupeds. Tail IK.
