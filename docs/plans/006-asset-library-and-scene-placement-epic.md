# Plan 006: Asset Library and Scene Placement Epic

**Status:** Proposed  
**Date:** 2026-04-01

## Epic

### Title

Bring core asset management and scene placement into Sugarmagic so assets can be imported, organized, placed, manipulated, removed, and edited entirely inside `Build`.

### Goal

Turn Sugarmagic's current placeholder authored scene into the first real asset-driven world-building loop by:

- importing asset definitions into the project
- showing assets and folders in the `SceneExplorer`
- placing asset instances into the active region
- selecting and manipulating placed assets in the viewport and tree
- removing placed assets from the region
- editing asset definitions from inside the same product
- supporting real scene folders so authored structure is manageable from the start

This epic exists to prove that Sugarmagic can host the core Sugarbuilder spatial-authoring loop inside the new architecture without reintroducing the old split between:

- asset definition truth
- scene instance truth
- editor-only organization state
- runtime-visible region truth

### Why this epic exists

Plan 004 established the first real `Build > Layout` structure and real workspace navigation.

Plan 005 established preview as a real runtime session launched from the same product.

What is still missing is the heart of Build-mode world authoring:

- a real asset library
- a real scene tree
- real scene placement
- real instance manipulation
- a clean entry into asset editing

Without this epic, `Build` still lacks the basic loop people expect from a world-building tool:

- import asset
- organize asset
- place asset
- move it
- duplicate it
- remove it
- edit the source asset when needed

This is one of the strongest parts of the old Sugarbuilder workflow and one of the most important loops to bring over next.

### Sugarbuilder behavior to preserve at the product level

This epic should preserve the good parts of Sugarbuilder's asset-management and placement flow:

- assets can be imported into the project and reused across regions
- the scene tree reflects authored structure instead of only flat debug data
- placing an asset into the scene creates a real region-local instance
- the same asset definition can be placed multiple times
- placed assets can be selected both from the viewport and the tree
- placed assets can be moved, rotated, and scaled
- placed assets can be removed from the scene without destroying the project asset definition
- the user can jump from a placed instance to editing the source asset definition

Relevant implementation references:

- [Sugarbuilder asset domain types](/Users/nikki/projects/sugarbuilder/src/editor/domain/types.ts)
- [Sugarbuilder layout interaction controller](/Users/nikki/projects/sugarbuilder/src/editor/three/SceneGraphController.ts)
- [Sugarbuilder scene graph / placement behavior](/Users/nikki/projects/sugarbuilder/src/editor/three/SceneGraphController.ts)
- [Sugarbuilder export service for placed assets](/Users/nikki/projects/sugarbuilder/src/editor/services/SugarengineExportService.ts)

Sugarmagic should not copy Sugarbuilder's old architecture literally.

In particular, this epic should not recreate:

- separate editor-only asset truth and runtime-only asset truth
- placed-instance mutation paths that bypass commands and transactions
- scene-tree folder structures that are only UI and not part of canonical authored region structure
- asset editing flows that blur source asset definitions and placed asset instances into one ambiguous object

## Core domain clarification for this epic

This epic should make one boundary completely explicit.

### Asset definition versus placed asset instance

`Content Library` owns asset definitions.

That means:

- imported source asset records
- source file references
- asset metadata
- asset-editing state that changes what the asset is

`Region Document` owns placed asset instances.

That means:

- which asset definition is placed in the region
- instance transform
- instance folder membership in the region scene tree
- instance-local naming or labels where allowed
- any region-local instance overrides that are part of authored region truth

In short English pseudo code:

```text
import asset -> create or update asset definition in Content Library
place asset -> create region-local placed asset instance referencing asset definition
edit asset definition -> update Content Library asset
move placed asset -> update Region Document instance state
remove placed asset -> delete region-local instance only
remove asset definition -> remove source asset record, subject to reference safety rules
```

### Folder ownership clarification

This epic should also make folder ownership explicit.

There are two different folder ideas that must not be confused.

1. library organization
- organization of asset definitions inside the project asset library

2. region scene organization
- organization of placed asset instances inside a region scene tree

This epic should at minimum deliver real folder behavior for the region scene tree used by `Build > Layout`.

If library folders are implemented in the same slice, they should follow the same boundary discipline.

If they are not implemented yet, the epic must not fake that they already exist.

## Product and architecture clarification

For Sugarmagic, this epic should be treated as a `Build` epic.

That means:

- `Build` remains the home of region and world authoring
- scene placement happens in `Build > Layout`
- asset editing may launch a dedicated asset-authoring context, but the initiating workflow is still part of Build's world-making loop

This epic should not create:

- a second scene graph just for UI convenience
- a second asset registry inside shell stores
- a placement path that differs between the viewport and the tree
- a delete path that silently mixes scene deletion and project-asset deletion

## Core transition rules for this epic

### Import asset

When the user imports an asset:

1. ingest the source into the project asset library
2. create or update a canonical asset definition
3. expose the asset in the relevant explorer surface
4. make the asset available for region placement

Pseudo code:

```text
choose source asset
validate source
create asset definition in Content Library
index asset definition for Build workflows
show imported asset in explorer
```

### Place asset

When the user places an asset into a region:

1. resolve the chosen asset definition
2. create a placed asset instance in the active region
3. assign it an initial transform and scene-tree location
4. select the new instance in both viewport and explorer
5. allow immediate manipulation

Pseudo code:

```text
pick asset definition
create placed asset instance in active region
assign initial transform
insert into region scene tree
select new instance
```

### Edit asset

When the user chooses to edit an asset from a placed instance:

1. resolve the source asset definition referenced by the instance
2. switch into the asset-authoring entry for that definition
3. preserve the distinction between source asset changes and region-local instance changes

Pseudo code:

```text
selected placed instance -> assetDefinitionId
open asset definition editing context
save edits back to Content Library asset definition
refresh dependent placed instances through normal runtime/authoring refresh paths
```

### Delete behavior

Delete behavior must be explicit.

There should be at least two distinct actions:

1. `Remove From Scene`
- removes the placed asset instance from the active region

2. `Remove From Project`
- removes the asset definition from the project library
- must account for references from placed instances before destructive removal

These must not be a single ambiguous delete action.

## Scope of the epic

### In scope

- import asset definitions into the project
- show scene items in a real `SceneExplorer`
- create region scene subfolders
- rename region scene folders
- move items between region scene folders
- place asset instances into the active region
- select placed assets from viewport and tree
- move, rotate, and scale placed asset instances
- duplicate placed asset instances
- remove placed asset instances from the active region
- enter asset-definition editing from Build workflows
- keep viewport selection and tree selection synchronized
- keep canonical asset-definition truth and placed-instance truth separate

### Out of scope for this epic

- full material region editing on assets
- advanced mesh/face editing
- decals as a separate system
- bulk import polish beyond the first usable import flow
- thumbnail pipelines unless they are trivial
- library-wide advanced metadata management beyond what is required for the first asset loop
- destructive asset-definition deletion if reference-safety policy is not ready yet

## Stories

### Story 1: Asset library foundation

Create the canonical asset-definition flow that allows real assets to enter the project and become available to Build workflows.

#### Tasks

1. Define the canonical asset-definition model needed for the first loop.
2. Implement asset import into the project/content library.
3. Persist asset definitions through canonical project persistence.
4. Expose imported assets to Build surfaces without creating shell-owned duplicate truth.
5. Make imported assets queryable by placement workflows.

#### Acceptance criteria

- Imported assets become canonical asset definitions in the project.
- Imported assets survive save and reload.
- Build workflows can list and choose imported assets.
- No UI store becomes the source of truth for imported assets.

### Story 2: Real SceneExplorer tree for Build > Layout

Replace the remaining placeholder scene listing behavior with a real tree that supports folders and placed assets as authored scene structure.

#### Tasks

1. Represent region scene structure as a real tree.
2. Support region scene subfolder creation.
3. Support region scene folder rename.
4. Support moving placed assets into and out of folders.
5. Keep explorer selection synchronized with viewport selection.

#### Acceptance criteria

- `SceneExplorer` shows a real tree rather than a flat list.
- Region scene folders can be created and renamed.
- Placed assets can be reparented into folders.
- Tree selection and viewport selection remain synchronized.

### Story 3: Place asset instance into region

Enable users to create real placed asset instances in the active region from imported asset definitions.

#### Tasks

1. Add a Build workflow for choosing an asset definition to place.
2. Create a placed asset instance in the active region.
3. Insert the new instance into the canonical region scene structure.
4. Select the created instance immediately.
5. Render the placed instance through the existing authored runtime path.

#### Acceptance criteria

- A user can choose an imported asset and place it in the active region.
- Placement creates a region-local placed instance, not a second asset definition.
- The placed instance appears in both viewport and `SceneExplorer`.
- Save and reload preserves the placed instance.

### Story 4: Manipulate and duplicate placed assets

Bring the core placed-instance interaction loop into Sugarmagic for real asset instances.

#### Tasks

1. Support selection of placed assets from viewport and tree.
2. Support move, rotate, and scale for placed instances.
3. Support duplicate for placed instances.
4. Keep manipulation command-driven and transaction-safe.
5. Preserve the distinction between manipulating the instance and editing the source asset definition.

#### Acceptance criteria

- A placed asset instance can be moved, rotated, and scaled.
- Duplicate creates a second placed instance referencing the same asset definition.
- Undo and redo operate on instance manipulation correctly.
- Instance manipulation does not mutate the source asset definition.

### Story 5: Remove from scene versus remove from project

Make delete semantics safe and unambiguous.

#### Tasks

1. Implement `Remove From Scene` for placed instances.
2. Define and expose a distinct `Remove From Project` action for asset definitions.
3. If project deletion is not yet safe, gate it behind a clear reference policy and defer execution.
4. Ensure the UI language makes the distinction obvious.

#### Acceptance criteria

- Removing a placed instance removes it only from the active region scene.
- Project-asset removal is a distinct action from scene removal.
- The user cannot accidentally destroy project assets by using a scene-level delete action.

### Story 6: Asset editing entry from Build

Create the first clean bridge from placed-instance workflows into source asset-definition editing.

#### Tasks

1. Add an explicit `Edit Asset` entry from selected placed assets.
2. Resolve the source asset definition from the selected instance.
3. Open the correct asset-authoring context for that definition.
4. Ensure saved asset-definition changes propagate back through the normal refresh path.

#### Acceptance criteria

- A placed asset can open its source asset-definition editing flow.
- The edit flow operates on the asset definition, not the region instance.
- After saving, dependent placed instances refresh through normal system boundaries.

## Acceptance criteria for the epic

- Sugarmagic can import a real asset into the project.
- Sugarmagic can show a real region scene tree with folders in `Build > Layout`.
- Sugarmagic can place imported assets into the active region as region-local instances.
- Sugarmagic can select, move, rotate, scale, duplicate, and remove placed instances.
- Sugarmagic distinguishes asset-definition truth from placed-instance truth everywhere in the user flow.
- Sugarmagic distinguishes `Remove From Scene` from `Remove From Project`.
- Sugarmagic provides a real entry into asset-definition editing from Build workflows.
- Save and reload preserve the asset library and region placements.
- The implementation uses canonical documents plus commands and transactions rather than shell-owned duplicate state.

## Architecture notes for implementation

### Single source of truth

This epic must preserve:

- `Content Library` as the source of truth for asset definitions
- `Region Document` as the source of truth for placed asset instances and region scene organization

### Single enforcer

There should be one canonical placement path and one canonical instance-mutation path.

The viewport and the tree may initiate the same action, but they must converge on the same command and transaction boundary.

### One-way dependency rule

Expected direction:

1. `apps/studio`
2. `packages/productmodes` and `packages/workspaces`
3. `packages/domain` and `packages/runtime-core`
4. `packages/io`

### One type per behavior rule

Do not blur:

- asset definition
- placed asset instance
- folder node
- explorer tree item
- viewport overlay state

Each should have a clear owning type and owning layer.

## Risks and failure modes

### 1. Asset definition and placed instance get blurred

If the implementation uses one shape for both, the edit and delete model will become ambiguous fast.

### 2. Scene tree becomes UI-only

If folders live only in UI state, save/reload and multi-surface consistency will break.

### 3. Delete semantics become dangerous

If scene deletion and project deletion are not clearly separated, users will lose trust immediately.

### 4. Placement bypasses commands and transactions

If viewport drag or tree commands mutate canonical region state directly, history and consistency will drift.

### 5. Asset editing becomes a second truth path

If asset edits are cached locally and not committed through the canonical asset-definition model, the architecture will regress toward the old split.

## Verification strategy

At minimum, verification for this epic should include:

1. import asset into the project
2. save and reload
3. place asset into region
4. move, rotate, scale, and duplicate it
5. create and rename a folder
6. move the placed instance into the folder
7. remove the placed instance from the scene
8. verify the project asset definition still exists
9. enter `Edit Asset` from a placed instance
10. verify the source asset-definition path is the one being edited
11. preview the region and confirm placed assets appear through the normal runtime path

## Builds on

- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
