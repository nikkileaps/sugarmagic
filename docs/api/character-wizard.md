# Character Rigging: Wizard + Weight Workbench

Turn a static stylized-humanoid GLB into a rigged, animated,
game-ready character — and refine its skinning — without leaving
Studio. Architecture rules live in
[ADR 023](/Users/nikki/projects/sugarmagic/docs/adr/023-standard-rig-and-character-wizard.md);
this page is the user-and-integrator surface.

## The Character Wizard (create + markers)

Open the Player or NPC workspace and click the rig button in the
character preview. For an unrigged model it launches the wizard:

1. **Import** — pick a GLB (upright, facing forward, A-pose or
   T-pose) and name the character (the name seeds asset file names
   and is locked once committed).
2. **Joints** — 16 detected joint markers rendered on the model;
   drag to correct. Mirroring is on by default (one drag places
   both sides). Toggle **Has tail** to add three sagittal markers
   (base / mid / tip) and rig a real tail chain.
3. **Finish** — generates the skeleton (rest-aligned to your
   marker positions), solves weights (geodesic voxel binding, in a
   worker), attaches idle/walk/run, writes assets, and binds the
   workspace's animation slots. You land back in the workspace
   with a playable character.

Re-opening for marker-level changes ("Adjust markers" in the
workbench) re-solves and regenerates: recipe-carrying generated
animation slots are rebuilt at the new skeleton scale; library
slots are re-copied.

## The Weight Workbench (refine skinning)

For a rigged character the rig button TOGGLES the workspace center
into the weight workbench:

- **Properties column** (left): **Bones** — filterable list; the
  selected bone drives the heatmap and the brush. **Pieces** —
  isolation scopes: material pieces, plus VIRTUAL body regions
  (Head / Torso / Tail / Arms / Legs) derived from the automatic
  solve's partition; isolating a scope ghosts everything else and
  limits every tool to it. **Actions** — fill scope with bone,
  region re-solve, weight mirroring, resets, fresh auto-solve,
  and the hand-off to marker editing.
- **Tool rail** (viewport top-left, mutually exclusive tools with
  tool-scoped settings):
  - 🖌 **Brush** — Add / Subtract / Smooth / Fill modes with radius
    and strength. Subtract borrows a receiving bone from
    surrounding territory, so it works on fully-owned regions.
  - ⬚ **Box select** — drag a screen box to select vertices
    (yellow tint); **X-ray** selects through the model; shift adds.
    "Assign N to bone" rigidly assigns the selection.
  - 🧲 **Shrinkwrap** — robust weight transfer (confident
    surface-match + inpainting) from one or MORE source pieces
    onto the current scope or selection. The layered-clothing
    workflow: wrap garments inner-to-outer (shirt from body;
    jacket from body + shirt + pants). Reports matched/inpainted
    counts.
- **T-pose toggle** (viewport top-right): poses the model at the
  contract rest so limbs lift clear of the body for box selection.
  Display-only.
- **Playback** (bottom-center, same as every viewport): Static /
  idle / walk / run + play-pause — judge weights in motion without
  leaving the bench. Static is the true bind pose.
- **Save weights** commits the model only — animation files,
  definitions, and bindings are untouched.

Tool guidance learned the hard way: **Mirror weights requires
mirror-symmetric geometry** (it reports how many vertices had no
twin — asymmetric clothing will have many; use Shrinkwrap there
instead), and the reset actions restore the SESSION-START state —
"Fresh auto-solve" is the one that re-runs the actual solver.

## What lands in the project

```
assets/character-models/<name>-rigged.glb    the playable character
assets/character-models/<name>-source.glb    untouched import (edit fuel)
assets/character-animations/<name>-<Clip>.glb  idle / walk / run
assets/character-animations/QUATERNIUS-ATTRIBUTION.md
```

All ordinary content-library definitions — publish targets,
preloading, and caching treat wizard output like any imported
asset. The rigged GLB carries its recipe (`sugarmagicRig` extras:
landmarks incl. tail markers, rig id/schema); painted weights are
decoded straight from the file when the workbench opens.

## Integration points (for engineers)

- `packages/character-rig` — pure, THREE-free algorithm layer:
  detection, rest-aligned skeleton generation (optional tail
  chain), geodesic voxel weight solve (`WeightSolver` strategy
  seam), paint/select/mirror ops, body-region segmentation,
  region-scoped re-solve, robust weight transfer
  (`shrinkwrapWeights`, after Abdrashitov et al. 2023).
- `packages/io/src/glb/` — GLB read/pack/extract, skinned
  assembly, clip hips scaling, tail-track merge, recipe readers;
  `packages/io/src/character-wizard/` — the commit functions.
- `packages/workspaces/src/design/character-wizard/` — the lean
  wizard + marker and paint viewports;
  `.../weight-workbench/WeightWorkbench.tsx` — the workbench;
  Studio injects services from `apps/studio/src/character-wizard/`.
- The standard rig contract (schema v2 with the optional tail
  extension) and vendored clips: see ADR 023.

## Scope and limits

Stylized humanoids (cozy-game proportions are the design center),
optional tail. Quadrupeds, arbitrary body plans, and cloth physics
are out. External DCC editing of the output GLB works (bone names
are the interface) but drops the reopen-for-edit recipe.
