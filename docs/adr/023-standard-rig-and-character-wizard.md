# ADR 023: Standard Rig Contract and Character Wizard Output

Status: accepted
Date: 2026-07-07

## Context

Sugarmagic generates game-ready animated characters from static humanoid
GLBs (the Character Wizard in Studio). Every generated character shares
one skeleton so that one animation library serves them all. The rules in
this ADR were settled during implementation against a real layered chibi
character; several were learned the hard way and are load-bearing.

## Decisions

### 1. One versioned rig contract, owned by domain

`STANDARD_RIG` in `packages/domain/src/standard-rig/` is the single
source of truth for bone hierarchy, names, and rest transforms. It is
bone-compatible with the Quaternius universal humanoid rig, pinned to a
specific upstream revision and vendored (`vendor/quaternius-ual/`,
regenerated only by `scripts/vendor-character-clips.mjs`). Upstream
changes never flow in silently. `STANDARD_RIG_SCHEMA_VERSION` gates any
divergence; changing the contract requires a version bump and an
explicit migration story, because every clip ever shipped binds to it
by bone NAME.

### 2. Wizard skeletons use the 23-bone CORE subset

`STANDARD_RIG_CORE`: root, hips, three spine links, neck, head, and
shoulder / upper arm / forearm / hand plus thigh / shin / foot / toe per
side. No finger bones — hands are one bone each. The full 53-bone
contract remains recorded for a future detailed-hands tier. Finger
tracks are stripped from vendored clips at vendor time; the contract
test fails if one reappears.

### 3. Clips are rotation-only plus one hips translation

The upstream library bakes translation and scale tracks for every bone.
Translation tracks override a bone's local offset — its length — so
playing them replaces a character's proportions with the library rig's.
Vendoring strips clips to rotation tracks plus the hips translation
(root-motion bob), which is scaled per character by hip-height ratio at
copy time (`scaleClipHipsTranslation` in `packages/io/src/glb/`).

### 4. Rest-pose alignment on the bind; clips play VERBATIM

Generated skeletons re-aim each bone's rest orientation (shortest arc)
so its +Y axis runs along the character's actual limb direction
(`generateStandardSkeleton` in `packages/character-rig/src/skeleton.ts`);
the head special-cases to world-up so face pitch is immune to marker
lean. With the bind aligned, verbatim rotation playback reproduces the
library's world-space poses at the character's own proportions — which
IS correct retargeting. Do NOT bake per-bone rest-delta corrections into
clip keyframes: two attempts (one-sided local offset, two-sided
world-delta factors) both mis-rotated limbs and were deleted; the
derivation target "character rest + library delta" is wrong, the target
is "mesh direction = library world bone direction".

### 5. Weight binding: geodesic voxel, behind a Strategy seam

`GeodesicVoxelWeightSolver` (Dionne & de Lasa, SCA 2013) in the pure,
THREE-free `packages/character-rig` package, run in a Studio worker.
Component-aware voxel closing bridges satellite shells (eyes, clothing)
without welding adjacent body parts. Hand touch-up is a first-class
step, not a failure mode: the wizard's weight-paint step edits the
`SkinWeights` arrays with pure ops (`paint.ts`) and reassembles the same
GLB.

### 6. Wizard output is ordinary content, stamped with its recipe

Output is a standard skinned GLB + standard clip GLBs in the project's
`assets/`, registered as ordinary `CharacterModelDefinition` /
`CharacterAnimationDefinition`s — nothing downstream knows the wizard
exists, and publish targets carry wizard characters with zero
target-side work. The rigged GLB carries `asset.extras.sugarmagicRig`
(rig id, schema version, confirmed landmarks, source path), the
untouched source GLB is kept alongside, and `rigId` on the definition
marks provenance — so the wizard can reopen its own output for editing
with markers and painted weights intact. Editing in an external DCC
remains possible (standard GLB, bone names are the interface) at the
cost of the recipe stamp.

## Consequences

- Any CC0 clip from the pinned library (46 animations in the current
  revision) can be surfaced to every wizard character with no
  retargeting work.
- Characters whose rest pose differs wildly from upright-humanoid
  (quadrupeds, arbitrary body plans) are out of contract by design.
- The contract test suite (`packages/testing/src/standard-rig-contract.test.ts`)
  is the enforcement point: contract/data drift, finger tracks, or
  non-hips translation tracks fail before anything ships.

## Amendments

### 2026-07-08 — schema v2: the optional tail extension (Plan 064)

`STANDARD_RIG_SCHEMA_VERSION` is 2. Three hand-authored bones
(`DEF-tail.001..003` off `DEF-hips`, rest arc curling toward
vertical) form an OPTIONAL, ADDITIVE extension
(`packages/domain/src/standard-rig/tail-extension.ts`). Name-based
binding degrades gracefully in both directions — tail-less
characters ignore tail tracks and tail-less clips leave tail bones
at rest — so v1 content required no migration. This is the
template for future optional chains (ears).

### 2026-07-08 — relaxed-pose refinements + layered-clothing rule

The vendored relaxed base pose is mirror-symmetrized (the library
idle is an asymmetric combat stance) and elbow/wrist offsets are
scaled toward identity (arms hang straight, not bent) at vendor
time. Decision 5's "hand touch-up is first-class" gained a settled
doctrine for layered clothing: garments take their weights by
ROBUST TRANSFER from the surfaces beneath them (confident
point-on-surface matches + Laplacian inpainting, after Abdrashitov
et al., SIGGRAPH Asia 2023; `shrinkwrapWeights` in
packages/character-rig), cascading inner-to-outer. Weight
MIRRORING is reserved for mirror-symmetric geometry and reports
unmatched twins.
