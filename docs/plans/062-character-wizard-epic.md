# Plan 062 — Character Wizard (rig, bind, animate — minutes not hours)

Status: proposed
Owner: nikki + claude
Date: 2026-07-06

Related: the character asset pipeline this rides on — `CharacterModelDefinition` / `CharacterAnimationDefinition` (content library, entity-owned, Plan 038 lineage), the GLB import path in `packages/io/src/imports/`, and the asset shipping + preload pipeline (Plans 059/060) that makes any authored GLB reach players cache-correct with zero per-target work.

## Purpose

Creating a game-ready character should take minutes, not hours. Today a static humanoid GLB from Blender (or anywhere) still needs skeleton building, rigging, weight painting, animation import, and retargeting before it can walk around a sugarmagic game — repetitive DCC work that every character repeats and that has nothing to do with making the game.

The Character Wizard is a guided Studio workflow that turns a static stylized-humanoid GLB into a fully rigged, animated, game-ready character asset: import, confirm a few joint positions, generate. It is a **character prep wizard**, not an animation package — authors who outgrow it export to Blender; authors who don't never open a DCC tool again after modeling.

The wizard's output is deliberately boring: an ordinary character-model GLB plus ordinary animation GLBs in the project's `assets/` directory, registered as the existing content-library definition kinds. Nothing downstream knows the wizard exists.

## Scope (v1 target characters)

Stylized humanoids only: humanoid proportions, A-pose or T-pose, standing upright, roughly symmetrical, imported as GLB. Cozy-game / Animal-Crossing-ish proportions are the design center — and (not coincidentally) the best case for automatic weighting. Explicitly out: quadrupeds, monsters, arbitrary body plans, thin layered clothing (skirts/capes — document the limitation). Optional tail support is planned but not v1.

## Decisions (2026-07-06, nikki + discussion)

1. **No Blender dependency — fully in-house.** The original proposal sketched shelling to headless Blender for auto-weights. Rejected: it would add a pinned host dependency and a hosted-Studio liability. Investigation showed the in-house path is tractable (decisions 2-4). Nothing in the product invokes a DCC tool.
2. **Weight binding: geodesic voxel binding** (Dionne & de Lasa, SCA 2013 — the algorithm Maya ships). Solid-voxelize the mesh (~64-128^3), BFS geodesic distances from each bone through interior voxels (weights cannot leak across the gap between legs), distance-falloff weights, normalize, cap at 4 influences, smooth. Designed for messy non-watertight game meshes; chunky stylized characters are its best case. Pure typed-array TypeScript in a worker; a one-time bake measured in seconds is acceptable. Naive nearest-bone weighting was rejected (breaks at shoulders/armpits); bone-heat/Pinocchio-style solvers were rejected as unnecessary (mesh Laplacians + watertight requirements for quality we don't need).
3. **The standard rig is bone-compatible with the Quaternius universal humanoid rig.** Every generated character shares one skeleton contract: hierarchy, bone names, orientations, rest pose — carried as a VERSIONED domain definition (see Architecture). Anchoring it to the Quaternius rig means the CC0 Universal Animation Library (120+ clips: full locomotion, sit, push, emotes, combat; glTF; CC0 for commercial use) plus its 130+-clip second volume apply to every wizard character with NO retargeting step — not offline, not by us, not by users. The proposal's Phase-2 animation wishlist (jump/sit/wave/push/attack/celebrate) becomes "which existing CC0 clips do we surface."
4. **Animation library: seed with CC0 clips, generate procedurally later.** v1 ships curated Quaternius clips (idle/walk/run first) bundled with Studio and COPIED into the game project's `assets/` on generate — the game root stays the self-contained source of truth, with license attribution alongside. Procedural gait synthesis (sine-based leg phasing, arm counter-swing, breathing idle; quaternion tracks written onto the same standard rig) is the planned later layer — its value is knobs clips can't give (personality/bounce sliders, speed synced to movement velocity) and it is the natural mechanism for tail secondary motion.
5. **Detection assists, the human decides.** Joint detection is symmetry + extremity heuristics on the A/T-pose bounding volume — no ML. It only has to be decent because the wizard renders draggable joint markers on the model and the user corrects the misses. Detection quality improves over time without ever being load-bearing.
6. **Wizard output is ordinary authored content.** The generated character lands as a standard `CharacterModelDefinition` (skinned GLB) + `CharacterAnimationDefinition`s (clip GLBs) via the existing import/commit machinery. Because Plans 059/060 ship and preload `assets/` uniformly, every current and future publish target inherits wizard characters with zero target-side work.

## Architecture (grounded in the current code — read 2026-07-06)

The codebase facts this design hangs on:

- `packages/domain/src/content-library/` owns `CharacterModelDefinition` + `CharacterAnimationDefinition` (entity-owned, `source.relativeAssetPath`, `clipNames` captured at import).
- `packages/io/src/imports/` already parses GLB binary chunks in pure TS (`readGlbChunks`, `collectAnimationClipNames`) and writes assets via `writeBlobFile` into `assets/character-models/` + `assets/character-animations/`; import functions return definitions for the session to commit.
- `packages/runtime-core/src/player|npc/` own GLTFLoader + AnimationMixer + SkinnedMesh playback. The runtime plays standard skinned GLBs today.
- `apps/studio/src/viewport/overlays/` has the raycaster/pointer overlay pattern (mask-paint) that draggable joint markers follow.
- `packages/workspaces/` is the presentation layer; import affordances live on `PlayerWorkspaceView` / `NPCWorkspaceView` with handlers threaded from App.

Layering (one-way deps, one source of truth, single enforcer):

- **Domain (`packages/domain`)** — types + normalizers only, no algorithms: `StandardRigDefinition` (the versioned bone contract: hierarchy, names, rest transforms, `rigSchemaVersion`) and the wizard-relevant metadata on generated definitions (e.g. `rigId` stamped on a generated CharacterModelDefinition so future features know it wears the standard rig). The rig contract is the single source of truth every animation ever shipped depends on; it changes only with a schema-version bump and an explicit migration story.
- **Rig core (new pure package, `packages/character-rig`)** — the algorithm layer, dependent on `domain` only, THREE-free, DOM-free (worker-safe): joint detection heuristics, skeleton generation from confirmed landmarks, solid voxelization + geodesic-voxel weight solve, clip attachment (standard rig = pure data graft), and skinned-GLB assembly. Operates on plain typed-array mesh structs. **Patterns:** a *Pipeline* of pure, individually testable stages (detect -> adjust -> generate skeleton -> bind -> attach clips -> assemble GLB); the weight solver behind a *Strategy* interface (`WeightSolver`) so refinement tools or better solvers slot in without touching the pipeline; *Adapter* functions at the package edge convert three.js buffer geometry <-> the pure structs (the only place three appears is the caller's side).
- **io (`packages/io`)** — extends the existing import module family with the GLB writer (the inverse of `readGlbChunks`, same pure chunk-level code) and the wizard's commit function following the established shape: write files into `assets/character-models/` + `assets/character-animations/`, return definitions; the authoring session commits them through the normal command/transaction path. Bundled CC0 clips + attribution file are Studio-shipped data that this step copies into the project.
- **Presentation (`packages/workspaces` + `apps/studio`)** — the wizard UI: a stepper surface (import -> markers -> preview -> generate) launched from the Player/NPC workspace, with the draggable-marker viewport overlay following the mask-paint pattern and preview via a plain three.js AnimationMixer scene. All state is wizard-local *View* state (MVVM seam per the store-separation rule); nothing persists until the final commit. The heavy solve runs in a worker with progress, mirroring the asset-preload progress UX.
- **Runtime + publish targets — untouched.** No runtime-core changes, no target-web changes, no deployment changes. This is the load-bearing separation guarantee: the wizard is authoring-side tooling whose output is content the existing engine/target seams already carry. A future non-web target that plays skinned GLBs plays wizard characters for free.

## Deliberate tensions + future-proofing

- **Rig contract vs. Quaternius drift.** We pin to a specific Quaternius rig revision and vendor the clips; upstream changes never flow in silently. If we ever diverge, `rigSchemaVersion` is the gate.
- **Weight quality ceiling.** v1 ships "good enough for stylized" with a weight-heatmap debug view (doubles as the foundation for a future refine-weights brush, which enters through the `WeightSolver`/overlay seams, not a rewrite).
- **Clip storage duplication.** Copying clips per-project duplicates bytes across games in exchange for self-contained game roots (the invariant Plans 046/059 rely on). Acceptable; a shared-cache optimization would be an io concern invisible to everything else.
- **Tails (phase 2)** ride the same seams: extra bone chain appended under the versioned rig contract's optional-extension rules, secondary motion generated procedurally per decision 4.

## UX + component mapping (2026-07-06, nikki — grounded in code)

The wizard lives in the EXISTING Player and NPC workspaces; no new workspace.

- **Entry point**: a rig-icon button in the character preview's HUD overlay, next to the animation-slot selector and play/pause control. In code: the absolute top-left `Group` in `packages/workspaces/src/design/CharacterPreview.tsx` — the preview component SHARED by `PlayerWorkspaceView` and `NPCWorkspaceView`, so one button serves both. Same `Tooltip` + `ActionIcon` pattern as play/pause.
- **The wizard is a modal stepper**: import -> joint markers -> generate/bind (worker, progress) -> preview -> finish. On finish it dismisses, and the workspace's animation slots are populated — the user immediately previews idle/walk/run with the existing selector.
- **"Slots populate on close" uses only existing wiring**: the wizard's finish step commits definitions through the io import/commit family and updates `presentation.animationAssetBindings` via the existing `UpdatePlayerDefinition` command (NPC mirror likewise); `previewSlots` derivation + `designPreviewStore.setAnimationSlot` already drive the selector from those bindings.
- **Component reuse (checked against `packages/ui/src/components/`)**: no wizard/stepper dialog exists (`CreateRegionDialog` / `ProjectManagerDialog` are one-off Modals) — so the stepper frame ships as a NEW REUSABLE `WizardDialog` in packages/ui (steps rail, content slot, back/next/finish, busy state), wizard-agnostic. Steps reuse `LabeledSlider`, `PanelSection`, theme tokens. `CharacterPreview` itself is reused AS the wizard's preview step (self-contained three scene taking model + slots + assetSources). The joint-marker step is the one new viewport, mirroring CharacterPreview's self-contained-scene architecture with the mask-paint raycaster pattern for dragging.

## Stories

### 062.1 — Standard rig contract + vendored clip library (domain + data)

- `StandardRigDefinition` in domain: bone hierarchy, names, orientations, rest pose, `rigSchemaVersion` — Quaternius-universal-rig-compatible per decision 3. Types + normalizers only; the contract is the single source of truth.
- Vendor the curated CC0 clips (idle/walk/run first; pin the Quaternius revision) as Studio-shipped data with the attribution file. Verify each vendored clip's tracks resolve against the rig contract (a test, not a hope).

### 062.2 — character-rig package: weight solver + skeleton generation

- New pure package `packages/character-rig` (depends on domain only; THREE-free, worker-safe): plain typed-array mesh structs; edge adapters three.js BufferGeometry <-> structs; skeleton generation from confirmed landmarks onto the rig contract; solid voxelization + geodesic-voxel weight solve behind the `WeightSolver` Strategy interface (falloff, 4-influence cap, smoothing passes).
- Tests on synthetic meshes: cylinder-limb weight sanity, the two-legs-no-leak case, non-watertight tolerance.

### 062.3 — Joint detection heuristics

- A/T-pose landmark estimation (16 joints per the proposal) via symmetry + extremity analysis in character-rig. Only has to be decent — the wizard's markers are the correction loop (decision 5).
- Tests against a small fixture set of stylized humanoid meshes, asserting landmarks land within tolerance.

### 062.4 — Skinned-GLB writer + wizard commit (io)

- GLB writer in `packages/io` (inverse of `readGlbChunks`): assemble the skinned model GLB — mesh + materials passthrough from the imported source, generated skeleton, weights. Vendored clips need no writer (already standard-rig GLBs; they are COPIED per decision 4).
- Wizard commit function following the import-family shape: write model GLB into `assets/character-models/`, copy selected clips + attribution into `assets/character-animations/`, return `CharacterModelDefinition` + `CharacterAnimationDefinition`s for the session to commit through the normal command path.

### 062.5 — `WizardDialog` reusable (ui)

- Generic stepper-modal component in `packages/ui/src/components`: steps rail, per-step content slot, back/next/finish, busy/progress state, cancel-with-confirm. Wizard-agnostic; the character wizard is its first consumer.

### 062.6 — The Character Wizard (workspaces + studio)

- Rig button in the CharacterPreview HUD (both workspaces inherit).
- Steps: import (reuse GLB file-picker machinery) -> joint markers (new self-contained marker viewport; drag to correct) -> generate (bind runs in a worker with progress, mirroring the asset-preload progress UX; weight-heatmap debug toggle) -> preview (reuse `CharacterPreview`) -> finish (commit via 062.4 + bind animation slots via the existing update commands).
- Wizard state is wizard-local View state; nothing persists before finish; cancel leaves the project untouched.

### 062.7 — Verify end-to-end

- nikki's own Blender character through the whole path: import static GLB -> adjust a few markers -> generate -> preview idle/walk/run in the wizard -> finish -> slots populated in the workspace -> preview in Studio -> deploy -> character animates in prod (assets pipeline carries it with zero target work).
- Regression: existing manually-imported character models + animations unaffected.

## Not in this epic

Facial rigs, hand poses, IK targets, animation editing/blending tools, arbitrary body plans, ML-based detection. Tail support and procedural gait/personality sliders are phase 2 of this feature but OUT of this epic's stories — they ride the seams named above (rig-contract extension rules, `WeightSolver`/overlay seams, clip-vs-procedural layering).
