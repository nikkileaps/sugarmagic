# Plan 011: Design NPC Definition Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Create the first real `Design > NPCs` workspace in Sugarmagic so NPCs become project-owned authored definitions with proper CRUD, preview, model binding, and animation-slot binding instead of a pile of region placement concerns and legacy Sugarengine behavior/chat settings.

### Goal

Deliver the first truthful NPC-authoring slice in Sugarmagic by:

- introducing a real `Design > NPCs` workspace
- defining canonical NPC definitions owned by the project, not by a region
- making the workspace use a three-panel shape:
  - left panel for NPC list and CRUD
  - center viewport for NPC preview
  - right panel for NPC properties
- preserving the useful parts of Sugarengine's old NPC surface:
  - list/search/create/delete/select
  - display name
  - description
  - model binding
  - named animation-slot binding
- deliberately excluding the old Sugarengine capability areas that are not part of this first slice:
  - behavior tree editing
  - faction
  - default dialogue
  - SugarAgent / chat / lore fields
- previewing each NPC truthfully:
  - capsule fallback when no model is bound
  - model preview when a model is bound
  - animation preview when clips are bound

This epic should create a clean NPC definition source of truth without smuggling in placement, spawn logic, dialogue systems, or plugin-owned behavior.

## Recommendation

### Workspace recommendation

`NPCs` should be a `Design` workspace, not a `Build` workspace and not a region workspace.

Recommended first shape:

- `Design > NPCs`
  - left panel for NPC list
  - center viewport for selected NPC preview
  - right panel for selected NPC authored properties

### Why this should be its own workspace

Because an NPC definition is not the same kind of thing as:

- a placed region instance
- a runtime-only entity
- a dialogue node
- an interaction plugin configuration

An NPC definition is a reusable authored definition.

That means it needs a home for:

- canonical identity
- authored description
- presentation/model binding
- animation slot binding
- future NPC definition settings that still belong to the NPC itself

### Boundary clarification

The following **do not belong** in the first `Design > NPCs` workspace:

- region placement
- spawn location
- region-specific facing
- behavior tree editing
- faction
- default dialogue
- chat / SugarAgent fields
- lore scopes
- quest usage editing
- runtime interaction policy owned by plugins

In particular:

- `NPC definition`
  - belongs in `Design > NPCs`
- `NPC placement / spawn`
  - belongs later in `Build > Layout` as a region placement concern
- `NPC interaction/chat behavior`
  - belongs later to the SugarAgent/plugin migration slice

## Why this epic exists

Right now Sugarmagic has enough workspace and preview infrastructure to author project-owned definitions cleanly, but NPCs still do not have their own truthful home.

Sugarengine had a capable NPC tab, but it mixed together several different kinds of concerns:

- core NPC identity
- model and animation binding
- dialogue linkage
- behavior tree authoring
- chat/agent configuration
- lore retrieval settings

That was useful in Sugarengine, but it is the wrong starting shape for Sugarmagic.

This epic exists to keep the parts we know we want now and reject the parts that belong elsewhere.

## Legacy concepts to preserve

Relevant references:

- [Sugarengine `NPCPanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/npc/NPCPanel.tsx)
- [Sugarengine `NPCDetail.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/npc/NPCDetail.tsx)
- [Sugarengine `useEditorStore.ts`](/Users/nikki/projects/sugarengine/src/editor/store/useEditorStore.ts)

### Core lessons from Sugarengine

#### 1. NPCs benefited from real CRUD and a dedicated list

Sugarengine's NPC surface got one thing very right:

- NPCs were first-class authored things with a list, create action, selection, editing, and delete flow

That should carry forward.

#### 2. Model binding and named animation slots were useful

Sugarengine's NPC editor had a useful authored seam for:

- `model`
- `modelHeight`
- `animations`

That is still the right first slice for Sugarmagic.

#### 3. The old tab mixed in too much unrelated behavior

Sugarengine's old NPC surface also included:

- behavior tree editing
- default dialogue linkage
- faction
- SugarAgent / lore / chat fields

Those are not the right v1 shape for Sugarmagic's `Design > NPCs` workspace.

### Core lessons from the new Player workspace

The `Design > Player` workspace established a stronger pattern that NPCs should follow:

- workspace-owned preview viewport
- no region placement concerns
- authored properties in the right panel
- model fallback to a capsule when no model is bound

NPCs should follow that pattern, with the main difference being that NPCs need a left panel list for CRUD because there are many NPC definitions instead of one project-owned Player definition.

## Corrected Sugarmagic domain direction

NPCs should become project-owned authored definitions.

### Canonical NPC concepts for Sugarmagic

This epic should introduce a project-owned concept closer to:

- `NPCDefinition`
  - `definitionId`
  - `displayName`
  - `description?`
  - `presentation`
    - `modelAssetPath | null`
    - `modelHeight?`
    - `animationSlots`
      - `idle`
      - `walk`
      - `run?`

This is authored project truth.

It is **not**:

- region placement
- runtime session state
- an interaction plugin configuration
- a dialogue node

### UUID rule

Canonical authored identity for NPCs must use UUIDs.

That means:

- `NPCDefinition.definitionId` must be a UUID
- display name is a label, not identity
- no brittle user-visible string ids should be used as canonical identity

This follows the larger Sugarmagic rule:

- authored identity = UUID
- display label = editable presentation

### One source of truth rule

The viewport preview must not invent a second NPC model.

It should always render from the same `NPCDefinition` the right panel is editing:

- no model bound -> capsule fallback from NPC presentation rules
- model bound -> render the bound model
- animation slot chosen -> preview that authored slot

## Core architecture clarification for this epic

### Ownership split

The split should be:

- `packages/domain`
  - canonical NPC definition data
- `packages/runtime-core`
  - NPC preview construction semantics
  - capsule fallback generation
  - model/animation preview loading seam
- `packages/workspaces`
  - `Design > NPCs` UI
  - left-panel CRUD list
  - right-panel property editing
  - viewport HUD for preview controls
- `apps/studio`
  - viewport composition
- `targets/web`
  - not involved in the first NPC workspace slice

### Rendering rule

The NPC workspace should use a dedicated authored preview path, but it must still honor the same underlying NPC presentation semantics we intend runtime to use.

That means:

- capsule fallback shape derives from authored NPC presentation/profile defaults
- model binding derives from authored definition
- animation slot meaning derives from authored definition

### Preview scope rule

The `Design > NPCs` viewport is a preview surface, not a gameplay simulation surface.

It should:

- show the selected NPC centered at origin
- show a neutral preview stage / ground reference
- allow orbit camera
- allow selecting preview clip

It should **not** try to become:

- region placement
- live pathfinding preview
- interaction preview
- AI simulation
- dialogue runner

## Stories

### Story 1: Canonical NPC Definition Foundation

Create a project-owned `NPCDefinition` domain model and authoring session seam so NPCs stop being implicit legacy editor state.

#### Tasks

- add canonical NPC definition data under `packages/domain`
- ensure every NPC definition uses a UUID id
- define minimal v1 authored fields:
  - `displayName`
  - `description?`
  - `modelAssetPath?`
  - `modelHeight?`
  - animation slots:
    - `idle`
    - `walk`
    - `run?`
- add command/session support for:
  - create NPC
  - update NPC
  - delete NPC
- make project persistence serialize NPC definitions as canonical project truth

#### Acceptance criteria

- NPC definitions are canonical project-owned data
- NPC ids are UUIDs
- create/update/delete flows go through the normal command boundary
- no region document owns NPC definitions

### Story 2: `Design > NPCs` Workspace Shell

Create the new `Design > NPCs` workspace with the correct panel layout.

#### Tasks

- add `NPCs` as a Design workspace entry
- make the workspace use:
  - left panel = NPC list
  - center = preview viewport
  - right panel = selected NPC properties
- ensure no region selector leaks into this workspace
- ensure no Build/Layout placement concerns appear here

#### Acceptance criteria

- `Design > NPCs` exists as a first-class workspace
- the workspace has a left panel, center viewport, and right panel
- it does not show region placement controls

### Story 3: NPC CRUD List In Left Panel

Implement the left-panel list and CRUD flow.

#### Tasks

- show a searchable NPC list in the left panel
- add an `Add NPC` icon button in the panel title bar
- create new NPCs with:
  - UUID identity
  - sane default display name
- select an NPC from the list
- add right-click context menu per NPC row with:
  - `Edit`
  - `Delete`
- list NPCs by display name, not UUID

#### Acceptance criteria

- users can add, select, and delete NPCs from the left panel
- the list shows display names
- canonical ids remain UUIDs under the hood
- right-click menu works on NPC list rows

### Story 4: Right-Panel NPC Property Editing

Implement the first right-panel NPC property editor.

#### Tasks

- add `Identity` section:
  - `Display Name`
  - `Description`
- add `Model` section:
  - `Model Asset`
  - `Model Height`
- add `Animation Slots` section:
  - `Idle`
  - `Walk`
  - `Run`
- make the right panel scroll when content is long
- ensure updates immediately drive the selected NPC preview

#### Acceptance criteria

- users can edit NPC display name, description, model, model height, and animation slots
- the panel scrolls cleanly
- edits immediately update canonical NPC definition data

### Story 5: NPC Preview Viewport

Create the center preview viewport for the selected NPC.

#### Tasks

- add a dedicated NPC preview viewport path
- render the selected NPC at origin on a neutral preview surface
- if no model is bound:
  - show a capsule fallback
- if a model is bound:
  - show the model
- make the fallback visually distinct from the Player fallback so the two workspaces do not feel identical by accident
- add an orbit camera controller for NPC preview

#### Acceptance criteria

- selecting an NPC updates the center preview
- no model bound shows a capsule fallback
- bound model shows in the viewport
- preview is workspace-owned and not tied to region placement

### Story 6: Animation Preview Controls

Allow the user to preview authored NPC animation slots in the viewport.

#### Tasks

- add viewport HUD controls for preview clip selection
- support slot choices:
  - `Idle`
  - `Walk`
  - `Run`
- support play/pause preview control if the slot exists
- hide or disable preview controls for unbound slots
- keep the preview semantics shared through `runtime-core`, not reimplemented in the workspace

#### Acceptance criteria

- users can preview bound NPC animation slots in the viewport
- missing slots fail gracefully
- preview controls do not mutate canonical authored data except explicit slot edits

### Story 7: Persistence, Reload, And Preview Integrity

Ensure the NPC workspace survives the normal authored loop.

#### Tasks

- save and reload project-owned NPC definitions
- preserve UUID identity across save/load
- ensure selected NPC definitions reopen correctly after reload
- verify preview still renders the same NPC model/capsule after reopening
- add tests for create/update/delete/save/load behavior

#### Acceptance criteria

- NPC definitions survive save/reload without identity drift
- preview remains truthful after reload
- CRUD behavior is covered by tests

## Explicit Non-Goals For This Epic

These are intentionally out of scope:

- behavior tree authoring
- faction
- default dialogue
- SugarAgent / chat / lore scopes
- region spawn placement
- NPC pathing / AI simulation
- dialogue usage panels
- quest usage panels
- portrait authoring

Those can come later in separate epics if they still make sense.

## Verification Strategy

This epic is complete when all of the following are true:

1. A user can open `Design > NPCs` and see:
   - left panel NPC list
   - center preview viewport
   - right panel properties
2. A user can create a new NPC and it receives a UUID id.
3. A user can rename the NPC and add an optional description.
4. A user can bind a model and see it in the preview.
5. A user can leave model empty and see a capsule fallback instead.
6. A user can bind `idle` / `walk` / `run` slots and preview those clips in the viewport.
7. A user can delete an NPC from the left-panel context menu.
8. Save/reload preserves NPC identity and authored fields.
9. No region placement or SugarAgent behavior/configuration leaks into this workspace.

## Risks and watch-outs

### 1. Don’t accidentally recreate the old Sugarengine junk drawer

The old NPC tab mixed together many systems.

This first Sugarmagic NPC workspace must stay disciplined:

- definition editing only
- no behavior tree
- no dialogue management
- no plugin-owned agent settings

### 2. Don’t let preview semantics fork from runtime semantics

The workspace preview should use shared NPC presentation semantics from `runtime-core`, not a custom editor-only rendering path that will drift.

### 3. Don’t let display names become identity

Display names are labels.

Canonical NPC identity must remain UUID-based so renames do not break references later.

## Suggested implementation order

1. Story 1: Canonical NPC Definition Foundation
2. Story 2: `Design > NPCs` Workspace Shell
3. Story 3: NPC CRUD List In Left Panel
4. Story 4: Right-Panel NPC Property Editing
5. Story 5: NPC Preview Viewport
6. Story 6: Animation Preview Controls
7. Story 7: Persistence, Reload, And Preview Integrity
