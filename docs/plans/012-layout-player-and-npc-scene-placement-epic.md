# Plan 012: Layout Player and NPC Scene Placement Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Create the first real `Build > Layout` scene-presence placement flow for `Player` and `NPCs` in Sugarmagic so region-scoped gameplay presences can be added, seen in the `Scene Explorer`, positioned in the viewport, and edited numerically in the inspector instead of being hidden behind brittle form-only spawn fields.

### Goal

Deliver the first truthful region-scoped gameplay placement slice in Sugarmagic by:

- keeping reusable authored definitions in `Design`
  - `Player`
  - `NPCs`
- keeping region-scoped placement in `Build > Layout`
- making `Player` and `NPCs` appear in the `Scene Explorer` as things in the scene
- replacing the `Add Asset` action with a general `Add` action for scene content
- supporting the first placement flows:
  - add `Player`
  - add `NPC`
- allowing the user to position those scene presences directly in the viewport
- surfacing explicit spawn coordinates in the inspector so placement can be adjusted numerically too
- keeping the user-facing UX scene-oriented even if the underlying data model uses region-owned placement records

This epic should make `Player` and `NPC` placement feel like normal scene authoring, not like a separate spawn-point editor bolted onto the side.

## Recommendation

### Workspace recommendation

This belongs in `Build > Layout`, not in a new dedicated spawn workspace.

Recommended first shape:

- `Build > Layout`
  - `Scene Explorer` shows:
    - folders
    - placed assets
    - `Player`
    - NPC scene entries by display name
  - center viewport allows direct placement and transform editing
  - right inspector shows exact spawn coordinates and referenced definition details

### Why this should stay in Layout

Because these are still region-scoped scene things.

They need the same core authoring surfaces as other scene content:

- scene tree visibility
- viewport placement
- gizmo interaction
- inspector properties
- region save/reload

A separate spawn workspace would unnecessarily split one scene-authoring loop into two UIs that both want:

- the same region viewport
- the same camera
- the same transform tools
- the same scene tree
- the same inspector

### UX recommendation

The `Scene Explorer` should present these as things in the scene.

That means the user-facing labels should be:

- `Player`
- `Station Guard`
- `Ticket Clerk`

Not:

- `Player Start`
- `NPC Spawn`
- `NPC Spawn Point`

The spawn meaning is still real, but it belongs in behavior and inspector language, not in the primary scene-tree label.

### Add-flow recommendation

The existing `Add Asset` action in `Layout` should become a general `Add` action.

Initial menu contents:

- `Asset`
- `Player`
- `NPC`

Behavior:

- `Asset`
  - keeps the current asset-add flow
- `Player`
  - adds the region's Player scene presence at origin if none exists
  - if one already exists, select and focus it instead of creating a duplicate
- `NPC`
  - opens a searchable picker of project-owned NPC definitions
  - selecting one creates that NPC's scene presence at origin

### Inspector recommendation

When a `Player` or `NPC` scene presence is selected, the right inspector should show explicit spawn properties:

- `Spawn X`
- `Spawn Y`
- `Spawn Z`

The viewport remains the primary placement surface, but the inspector provides exact numeric control.

### Boundary clarification

The following **do belong** in this epic:

- region-owned Player presence
- region-owned NPC scene presences
- viewport placement in `Layout`
- `Scene Explorer` entries for those presences
- spawn-position editing in the inspector

The following **do not belong** in this epic:

- `Design > Player` definition editing
- `Design > NPCs` definition editing
- item placements
- dialogue behavior
- AI behavior
- faction/lore/plugin concerns
- a separate spawn workspace

In particular:

- `Player definition`
  - belongs in `Design > Player`
- `NPC definition`
  - belongs in `Design > NPCs`
- region-specific Player/NPC placement
  - belongs in `Build > Layout`

## Why this epic exists

Sugarmagic now has the right project-owned authored definitions for:

- `Player`
- `NPCs`

But the runtime still needs region-scoped truth for where those things enter a region.

Older Sugarengine flows pushed that kind of setup into detached form fields and separate editor assumptions because it did not have the same truthful shared viewport-based scene loop that Sugarmagic now has.

That means Sugarmagic has an opportunity to do this better:

- treat Player and NPCs as scene things in `Layout`
- let the user place them directly in the region viewport
- use the inspector for exact spawn coordinates instead of using the inspector as the only placement tool

This epic exists to take advantage of the new shared scene loop instead of carrying forward the old limitation.

## Engine UX parallels to preserve

### Unity-style lesson

Unity's core scene-authoring pattern is:

- scene objects live in the scene hierarchy
- the viewport is the primary placement surface
- the inspector edits exact properties

That is the direction Sugarmagic should follow here.

### Unreal-style lesson

Unreal's core scene-authoring pattern is similar:

- actors live in the World Outliner
- actors are placed in the viewport
- exact values live in the Details panel

That is a better fit than inventing a separate spawn editor.

## Corrected Sugarmagic domain direction

The user-facing UX should show scene things.

Under the hood, Sugarmagic still needs a clean region-owned data model.

### Canonical scene-presence concepts for Sugarmagic

This epic should introduce region-owned concepts closer to:

- `RegionPlayerPresence`
  - `presenceId`
  - `transform`
- `RegionNPCPresence`
  - `presenceId`
  - `npcDefinitionId`
  - `transform`

These are region-authored placement records.

They are **not**:

- project-owned reusable NPC definitions
- project-owned Player definition data
- runtime-only transient entities

### Definition versus presence rule

The split should stay strict:

- `PlayerDefinition`
  - project-owned authored definition
- `NPCDefinition`
  - project-owned authored definition
- `RegionPlayerPresence`
  - region-owned placement of the player in this region
- `RegionNPCPresence`
  - region-owned placement of a referenced NPC definition in this region

### UUID rule

Canonical authored identity for region-scoped scene presences must use UUIDs.

That means:

- `RegionPlayerPresence.presenceId` must be a UUID
- `RegionNPCPresence.presenceId` must be a UUID
- `RegionNPCPresence.npcDefinitionId` references a UUID-backed `NPCDefinition`
- display names are labels, not identity

### One-player-per-region rule

This first slice should enforce one Player presence per region.

That means:

- adding `Player` when none exists creates one at origin
- adding `Player` when one already exists selects the existing one
- duplicate Player entries should not be allowed in the same region in this first slice

## Core architecture clarification for this epic

### Ownership split

The split should be:

- `packages/domain`
  - canonical region-owned Player/NPC presence data
  - canonical region document serialization
- `packages/runtime-core`
  - shared scene-presence visual semantics
  - player presence representation in authored/runtime scenes
  - NPC presence representation in authored/runtime scenes
- `packages/workspaces`
  - `Build > Layout` UI
  - `Scene Explorer` presentation
  - Add menu
  - inspector editing for selected presence
- `apps/studio`
  - viewport composition
- `targets/web`
  - preview/runtime consumption of the same region presence truth

### Scene-explorer rule

`Scene Explorer` should remain scene-oriented.

So it should render scene-presence nodes alongside other scene content instead of exposing raw implementation categories.

That means the explorer should show:

- `Player`
- NPC display names

while still preserving clean underlying type distinctions in the data model and commands.

### Rendering rule

Layout viewport rendering and Preview/runtime rendering should share the same underlying presence semantics.

That means:

- player presence visual derives from the authored `PlayerDefinition`
- NPC presence visual derives from the referenced `NPCDefinition`
- region presence transform is the region-owned spawn/placement truth

No editor-only fake Player/NPC visuals should be introduced in `Layout` if they would drift from the shared runtime path.

## Stories

### Story 1: Canonical region-owned Player and NPC presence foundation

Create region-owned Player/NPC presence data so the region can truthfully own scene placement without absorbing the project-owned definition data.

#### Tasks

- add canonical Player presence data under `packages/domain`
- add canonical NPC presence data under `packages/domain`
- ensure every presence uses a UUID identity
- define minimal v1 authored fields:
  - Player presence
    - `presenceId`
    - `transform`
  - NPC presence
    - `presenceId`
    - `npcDefinitionId`
    - `transform`
- add command/session support for:
  - create Player presence
  - move/update Player presence
  - remove Player presence if removal is allowed in this first slice
  - create NPC presence
  - move/update NPC presence
  - remove NPC presence
- make region persistence serialize scene presences as canonical region truth
- enforce the one-Player-per-region rule in command handling

#### Acceptance criteria

- regions own Player/NPC scene presence data canonically
- presence ids are UUIDs
- NPC scene presences reference UUID-backed NPC definitions
- Player and NPC presence edits go through the normal command boundary
- one Player presence per region is enforced

### Story 2: Generalize the `Layout` add action

Replace the special-case `Add Asset` action with a general scene add action.

#### Tasks

- rename the Layout header action from `Add Asset` to `Add`
- make the Add menu show:
  - `Asset`
  - `Player`
  - `NPC`
- preserve the current asset-add behavior under the `Asset` choice
- add `Player` creation from the same menu
- add `NPC` creation entry that opens an NPC picker
- keep menu language scene-oriented, not implementation-oriented

#### Acceptance criteria

- Layout has one general `Add` action
- `Asset`, `Player`, and `NPC` are available from that action
- the asset flow still works
- Player/NPC additions route into the same region scene model

### Story 3: Add Player scene presence to `Layout`

Allow users to add and place the Player in the region through the existing scene workflow.

#### Tasks

- create a Player scene entry at origin when `Add > Player` is selected and no Player exists
- if a Player already exists, select/focus it instead of creating a duplicate
- show the Player in `Scene Explorer` as `Player`
- render the Player presence in the viewport using the shared player representation
- allow selecting and moving the Player in the viewport
- allow selecting the Player from the scene tree

#### Acceptance criteria

- `Add > Player` creates one Player scene presence at origin
- the Player appears in the `Scene Explorer`
- the Player can be repositioned in the viewport
- duplicate Players are not created in the same region

### Story 4: Add searchable NPC scene-presence creation

Allow users to add NPCs to the region from a searchable picker of project-owned NPC definitions.

#### Tasks

- open a searchable NPC picker when `Add > NPC` is selected
- list NPC definitions by display name
- create a selected NPC scene presence at origin
- show created NPCs in `Scene Explorer` using display names
- allow multiple NPC scene presences referencing the same NPC definition if needed
- ensure NPC selection routes to the correct scene entry and inspector state

#### Acceptance criteria

- `Add > NPC` opens a searchable NPC picker
- selecting an NPC definition creates a scene presence at origin
- the new NPC appears in `Scene Explorer` by display name
- the same NPC definition can be placed more than once if desired

### Story 5: Scene Explorer representation and context actions

Make scene presences feel like normal scene content in the explorer.

#### Tasks

- render Player and NPC scene nodes in the explorer alongside assets/folders
- keep labels user-facing and scene-oriented
- support selection from the explorer
- add right-click context menus appropriate to each node type
- for Player/NPC scene nodes, support at least:
  - `Delete` where deletion is allowed
- ensure explorer selection and viewport selection stay in sync

#### Acceptance criteria

- Player and NPCs appear as scene nodes, not technical spawn-point labels
- selecting them from the explorer selects them in Layout
- context menus work on the new scene node types
- explorer and viewport selection remain synchronized

### Story 6: Viewport placement and transform editing

Use the existing Layout viewport as the primary placement surface for Player and NPC scene presences.

#### Tasks

- render Player and NPC scene presences in the Layout viewport
- support selecting them by clicking in the viewport
- support moving them with the existing gizmo/transform workflow
- keep their scene visuals truthful to the shared Player/NPC presentation rules
- ensure moving them updates the region-owned transform, which becomes runtime spawn truth

#### Acceptance criteria

- Player and NPC presences are visible in the Layout viewport
- users can move them in the viewport
- moving them updates the canonical region transform
- Layout and Preview consume the same presence transform truth

### Story 7: Inspector spawn properties and reference details

Expose exact placement data in the inspector for selected scene presences.

#### Tasks

- when Player is selected, show:
  - `Spawn X`
  - `Spawn Y`
  - `Spawn Z`
- when NPC is selected, show:
  - referenced NPC display name
  - `Spawn X`
  - `Spawn Y`
  - `Spawn Z`
- make numeric edits flow through the same command boundary as viewport transforms
- keep inspector terminology explicit that these coordinates define runtime spawn location in this region

#### Acceptance criteria

- selected Player/NPC scene presences show exact spawn coordinates in the inspector
- numeric edits update the same region transform used by viewport placement
- inspector and viewport edits stay in sync

### Story 8: Preview/runtime integrity and authored-loop verification

Ensure the placement flow survives the normal authored loop and drives preview truthfully.

#### Tasks

- save and reload region-owned Player/NPC presence data
- preserve UUID identity across save/load
- ensure preview/runtime boot uses the same region-owned presence transforms
- verify Player preview/runtime start uses the Player presence transform
- verify NPC preview/runtime scene placement uses NPC presence transforms
- add tests for create/update/delete/save/load behavior and one-Player-per-region enforcement

#### Acceptance criteria

- Player/NPC scene presences survive save/reload without identity drift
- preview/runtime use the same region placement truth
- one-Player-per-region enforcement is covered by tests
- NPC scene placement survives save/reload and re-preview

## Explicit Non-Goals For This Epic

These are intentionally out of scope:

- item placement
- trigger placement
- dialogue behavior
- AI behavior and schedules
- faction/lore/plugin data
- region-specific NPC behavior overrides
- a separate spawn workspace
- hiding all of this behind technical `spawn point` labels in the main UI

Those can come later in separate epics.

## Verification Strategy

This epic is complete when all of the following are true:

1. A user can open `Build > Layout` and see a general `Add` action instead of an `Add Asset` special case.
2. Choosing `Add > Player` adds one Player to the region at origin or selects the existing one if already present.
3. Choosing `Add > NPC` opens a searchable NPC picker and creates a selected NPC in the region at origin.
4. `Scene Explorer` shows `Player` and NPC display names as things in the scene.
5. The user can select Player/NPC entries from the tree and from the viewport.
6. The user can drag those scene presences in the viewport and have that become runtime spawn truth for the region.
7. The inspector shows exact spawn coordinates and numeric edits stay synchronized with viewport placement.
8. Save/reload preserves presence identity and placement.
9. Preview/runtime consume the same region-owned placement truth.
10. No separate spawn workspace or definition-editing leakage is introduced.

## Risks and watch-outs

### 1. Don’t let the UI leak implementation jargon

The internal model may still use region-owned placement records, but the primary UX should stay scene-oriented.

That means:

- `Player`
- NPC display names

not implementation-heavy labels like `NPC Spawn Point`.

### 2. Don’t blur project-owned definition data with region-owned placement data

`PlayerDefinition` and `NPCDefinition` remain project-owned definitions.

Their placement in a region is a separate authored truth.

That split must stay strict or the system will become confusing fast.

### 3. Don’t fork editor scene visuals from runtime presentation semantics

The Layout viewport should show Player/NPC scene presences using the same shared underlying presentation semantics that Preview/runtime use.

### 4. Don’t make placement a second inspector-only workflow

The viewport should remain the primary placement surface.

The inspector exists for exact numeric edits, not as the only way to position these things.

## Suggested implementation order

1. Story 1: Canonical region-owned Player and NPC presence foundation
2. Story 2: Generalize the `Layout` add action
3. Story 3: Add Player scene presence to `Layout`
4. Story 4: Add searchable NPC scene-presence creation
5. Story 5: Scene Explorer representation and context actions
6. Story 6: Viewport placement and transform editing
7. Story 7: Inspector spawn properties and reference details
8. Story 8: Preview/runtime integrity and authored-loop verification
