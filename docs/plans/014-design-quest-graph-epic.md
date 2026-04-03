# Plan 014: Design Quest Graph Epic

**Status:** Proposed  
**Date:** 2026-04-03

## Epic

### Title

Create the first real `Design > Quests` workspace in Sugarmagic by faithfully porting Sugarengine's staged quest beats graph, runtime quest progression, and shipped gameplay quest UI while reusing the new shared graph primitives in `packages/ui` and keeping runtime quest execution ECS-native.

### Goal

Deliver the first truthful quest-authoring and quest-runtime slice in Sugarmagic by:

- introducing a real `Design > Quests` workspace
- preserving the proven Sugarengine quest workflow:
  - left panel for quest CRUD and search
  - center quest overview and stage graph canvas
  - right panel for selected quest, stage, or node properties
- defining canonical project-owned quest definitions with UUID identity everywhere:
  - quest ids
  - stage ids
  - node ids
  - reward ids where identity is required
- preserving Sugarengine's stage-first quest structure instead of collapsing everything into one giant graph
- preserving the four real quest node behaviors from Sugarengine:
  - `objective`
  - `narrative`
  - `condition`
  - `branch`
- reusing the graph primitives already extracted into `packages/ui`
- keeping quest-specific graph rules in the quest workspace and runtime-core quest domain layers
- shipping real quest gameplay in Preview and the published game via `runtime-core`, not editor-only mock state
- keeping the design open for future SugarAgent and Sugarlang integration without letting plugin concepts distort the base quest architecture
- adhering to ECS principles in runtime execution so authored quest flow is enforced by runtime systems and components rather than ad hoc host glue

This epic should make quests a first-class authored system in Sugarmagic without mixing them with dialogue-editor logic, region placement workflows, or plugin-specific agent authoring.

## Recommendation

### Workspace recommendation

`Quests` should be a `Design` workspace.

Recommended first shape:

- `Design > Quests`
  - left panel for quest list and CRUD
  - center quest overview and stage graph canvas
  - right panel for selected quest/stage/node properties

This should follow how the quest editor actually ended up behaving in Sugarengine:

- the left panel carried the quest list
- the center handled quest overview, stage flow, and graph editing
- the right panel mattered when a node was selected, even if some old local code paths still returned `inspector: null`

### Why this should be its own workspace

Because a quest definition is not the same kind of thing as:

- a dialogue definition
- an NPC definition
- a region placement
- a runtime session transcript
- a plugin-owned agent contract

A quest definition is a project-owned authored progression graph with real runtime consequences.

That means it needs a home for:

- quest CRUD
- stage authoring
- graph editing inside stages
- node property editing
- reward definition
- validation
- runtime preview parity

### Boundary clarification

The following do **not** belong in the first `Design > Quests` workspace:

- SugarAgent beat contract authoring
- Sugarlang quest-writing/generation workflows
- region placement of quest actors or markers
- inventory authoring itself
- NPC behavior trees
- plugin-owned dialogue/session state

In particular:

- `Quest definition`
  - belongs in `Design > Quests`
- `Quest runtime state`
  - belongs in `runtime-core`
- `Quest tracker/journal/notifications`
  - belong in shipped runtime UI inside `runtime-core`
- `SugarAgent` and `Sugarlang`
  - later plug into quest-trigger seams and runtime presentation seams, not the core authored quest model

## Why this epic exists

Quests in Sugarengine evolved into one of the deeper orchestration systems in the product.

By the end, the strong ideas were:

- stage boundaries remained the primary authoring structure
- each stage contained a meaningful graph instead of a flat list
- runtime quest enforcement lived in a single quest manager
- quest progression was integrated with dialogue, world state, and gameplay triggers
- shipped gameplay UI exposed active objectives and quest updates

Those ideas are worth preserving.

What should not be preserved is the accidental mess around them:

- legacy/backward-compat fields and fallbacks
- editor-only modals doing too much of the real property work
- plugin-specific SugarAgent contract authoring mixed into the core quest editor
- any ambiguity around ids or node semantics

This epic exists to preserve the proven end-state while cleaning the seams.

## Legacy concepts to preserve

Relevant references:

- [Sugarengine `QuestPanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/quest/QuestPanel.tsx)
- [Sugarengine `QuestDetail.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/quest/QuestDetail.tsx)
- [Sugarengine `ObjectiveNodeCanvas.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/quest/ObjectiveNodeCanvas.tsx)
- [Sugarengine `ObjectiveGraph.ts`](/Users/nikki/projects/sugarengine/src/engine/quests/ObjectiveGraph.ts)
- [Sugarengine `QuestManager.ts`](/Users/nikki/projects/sugarengine/src/engine/quests/QuestManager.ts)
- [Sugarengine `types.ts`](/Users/nikki/projects/sugarengine/src/engine/quests/types.ts)
- [Sugarengine `QuestTracker.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/QuestTracker.ts)
- [Sugarengine `QuestJournal.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/QuestJournal.ts)
- [Sugarengine `QuestNotification.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/QuestNotification.ts)
- [Sugarengine quest/episode integration doc](/Users/nikki/projects/sugarengine/docs/dev/quest-episode-integration.md)

### Core lessons from Sugarengine

#### 1. Quests were stage-first, not one giant graph

The real authored structure was:

- quest
  - stages
    - node graph inside each stage

That should carry forward.

#### 2. The graph was real runtime structure, not just editor decoration

Sugarengine had a pure graph model for objective dependencies and entry points.

That should carry forward.

#### 3. The right panel matters in the final UX

Even if some old code paths locally returned `inspector: null`, the actual quest editing workflow used a property surface when a node was selected.

Sugarmagic should make that explicit and first-class:

- left panel: quest list
- center: quest/stage graph
- right panel: selected quest/stage/node properties

#### 4. Runtime quest UI was part of the product, not a debug layer

Sugarengine shipped:

- quest tracker HUD
- quest journal overlay
- quest notifications

That separation is correct and should carry forward.

#### 5. Dialogue routing through quests was a first-class behavior

Quest talk objectives could override an NPC's default dialogue.

That behavior should carry forward.

#### 6. Plugin-specific quest authoring should not define the core quest model

The SugarAgent contract fields existed, but they were a later integration seam, not the heart of the quest system.

That should remain true in Sugarmagic.

## Corrected Sugarmagic domain direction

Quests should become project-owned authored definitions.

### Canonical quest concepts for Sugarmagic

This epic should introduce a project-owned concept closer to:

- `QuestDefinition`
  - `definitionId: UUID`
  - `displayName`
  - `description`
  - `startStageId`
  - `stageDefinitions`
  - `rewardDefinitions?`
  - `episodeBindingId?` later if/when episodes return

- `QuestStageDefinition`
  - `stageId: UUID`
  - `displayName`
  - `nextStageId?`
  - `entryNodeIds?`
  - `nodeDefinitions`
  - `editorNodePositions`

- `QuestNodeDefinition`
  - `nodeId: UUID`
  - `nodeBehavior: objective | narrative | condition | branch`
  - `objectiveSubtype?`
  - `narrativeSubtype?`
  - `description`
  - `targetId?`
  - `count?`
  - `optional?`
  - `dialogueDefinitionId?`
  - `completeOn?`
  - `prerequisiteNodeIds`
  - `failTargetNodeIds?`
  - `conditionDefinition?`
  - `onEnterActions?`
  - `onCompleteActions?`
  - `showInHud?`

- `QuestRewardDefinition`
  - `rewardId: UUID` if rewards need identity
  - `rewardType`
  - reward payload fields

This is authored project truth.

It is **not**:

- runtime quest state
- runtime journal UI state
- plugin-owned narrative contract state

### UUID rule

Canonical authored identity must use UUIDs.

That includes:

- quest ids
- stage ids
- node ids
- any additional authored entity ids added under this system

Display names and labels are not identity.

### ECS rule

Runtime quest execution must adhere to ECS-oriented architecture.

That means:

- components carry runtime quest-related state where entity state belongs on entities
- systems evaluate and advance runtime quest triggers where system behavior belongs in systems
- one enforcer owns quest progression semantics
- host code wires the seams but does not become the hidden quest execution layer

This does **not** mean every quest definition becomes an entity.

It does mean:

- runtime interaction, trigger, dialogue, and world-state changes should flow into quest progression through runtime systems and runtime-core coordination seams
- the host should not duplicate quest rules or progression logic

## Runtime architecture direction

The clean split should be:

- `packages/domain`
  - canonical authored quest definitions
- `packages/ui`
  - reusable graph primitives only
- `packages/workspaces`
  - quest editor workflow and quest-specific graph authoring UI
- `packages/runtime-core`
  - runtime quest state
  - quest progression enforcement
  - quest HUD/journal/notification game UI
  - quest/dialogue/world-state integration seams

### Runtime-core ownership

`runtime-core` should own:

- quest runtime state and progression
- tracked quest state
- active stage/node evaluation
- quest event emission
- runtime quest UI
- dialogue override lookup for quest talk objectives
- condition evaluation seam
- action execution seam

The editor should not own any of that gameplay behavior.

## First Sugarmagic UX recommendation

### `Design > Quests`

#### Left panel

- searchable quest list
- `Add Quest` icon button in the section title
- right-click quest row:
  - `Delete`
- display by quest display name
- warning/status badge when validation issues exist

#### Center panel

Default center view should show quest overview:

- quest header
- quest description
- stage cards in authored order
- mini graph preview for each stage
- `Add Stage`
- rewards summary
- validation summary

When a stage is opened:

- center becomes the stage graph canvas
- graph uses shared `packages/ui` graph primitives
- same core graph feel as dialogue
- stage graph supports:
  - node drag
  - connect edges
  - pass/fail edge styling
  - fit view
  - selection

#### Right panel

The right panel is real and required.

It should show:

- selected quest properties when the quest itself is selected
- selected stage properties when a stage card is selected
- selected node properties when a node is selected in the graph

This is the correct Sugarmagic version of the final quest UX.

## Story breakdown

### Story 1: Canonical quest definitions in domain

Introduce project-owned quest definitions with UUID identity for quests, stages, and nodes.

Acceptance criteria:

- `GameProject` can own quest definitions
- quest ids are UUIDs
- stage ids are UUIDs
- node ids are UUIDs
- canonical types live in `packages/domain`
- command/session editing path exists

### Story 2: Reusable quest graph on top of shared graph primitives

Reuse the shared graph surface from `packages/ui` instead of creating a second bespoke graph system.

Acceptance criteria:

- quest stage graph composes shared graph primitives from `packages/ui`
- quest-specific rendering and port rules stay outside `packages/ui`
- prerequisite edges render distinctly
- fail edges render distinctly
- selection and drag behavior match dialogue graph expectations

### Story 3: `Design > Quests` workspace shell

Create the first real Quests workspace.

Acceptance criteria:

- left panel quest list exists
- center quest overview exists
- right panel exists
- quest CRUD is available
- quest search works

### Story 4: Quest overview and stage authoring

Port the quest overview authoring flow.

Acceptance criteria:

- quest display name editable
- quest description editable
- stage add/delete exists
- stage ordering/start stage flow exists
- mini graph preview exists per stage
- rewards section exists
- validation summary exists

### Story 5: Stage graph authoring and node properties

Port the core stage graph authoring model.

Acceptance criteria:

- quest stage graph supports the four node behaviors:
  - objective
  - narrative
  - condition
  - branch
- node property editing happens in the right panel
- node subtypes and target fields are editable
- prerequisites and fail targets can be authored through graph edges
- `onEnter` and `onComplete` action lists are editable

### Story 6: Runtime quest manager and progression in `runtime-core`

Port the real runtime quest progression layer.

Acceptance criteria:

- `runtime-core` owns quest runtime progression
- active quests can start
- stages can advance
- objectives can complete
- conditions can be evaluated
- branch routing works
- tracked quest state exists
- host does not duplicate quest rules

### Story 7: Runtime quest HUD, journal, and notifications

Port the shipped gameplay UI for quests.

Acceptance criteria:

- Preview and published game can show a quest tracker HUD
- Preview and published game can show quest notifications
- Preview and published game can open a quest journal overlay
- runtime quest UI is separate from editor UI
- runtime quest UI lives in `packages/runtime-core`

### Story 8: Dialogue integration

Port the real dialogue-routing behavior for talk objectives.

Acceptance criteria:

- runtime can ask quests whether a talk objective overrides NPC dialogue
- quest talk objectives can reference a dialogue definition
- `completeOn` supports dialogue-end completion first
- Preview/gameplay uses the runtime-core quest/dialogue path, not editor-only glue

### Story 9: World-state and trigger integration seams

Preserve the quest runtime seams that let other gameplay systems drive progression.

Acceptance criteria:

- runtime quest conditions can evaluate against shared runtime world state
- gameplay triggers can complete or advance quest objectives through runtime-core seams
- ECS runtime systems can feed quest progression without bypassing the quest enforcer
- the design remains ready for later SugarAgent/Sugarlang integration without needing a rewrite

## What not to port in the first slice

Do not port these into the first Sugarmagic quest slice:

- SugarAgent beat contract authoring
- delivery mode selection
- lore fact editing for quest nodes
- episode UI if episodes themselves are not yet back in Sugarmagic
- legacy compatibility fields and migration helpers

Those can return later through cleaner seams.

## Verification

The epic is only done when all of these are true:

1. `Design > Quests` exists as a first-class workspace.
2. Quest, stage, and node ids are UUIDs.
3. Stage graphs reuse shared `packages/ui` graph primitives.
4. The right panel shows selected node properties during graph editing.
5. Runtime quest progression works in Preview.
6. Runtime quest tracker/journal/notifications are shipped game UI in `runtime-core`.
7. Talk objectives can override NPC dialogue in Preview/gameplay.
8. Runtime quest progression follows ECS-oriented seams instead of host-owned hidden logic.

## Recommended implementation order

1. Canonical quest domain model and command/session editing.
2. `Design > Quests` shell with left/center/right panels.
3. Quest overview and stage cards.
4. Stage graph authoring on shared graph primitives.
5. Right-panel property editing for nodes.
6. Runtime quest manager in `runtime-core`.
7. Runtime tracker/journal/notification UI.
8. Dialogue override integration.
9. World-state / runtime system integration seams.

## Risks

### 1. Recreating quest logic in host code

This would violate the architecture immediately.

Keep runtime progression in `runtime-core`.

### 2. Letting plugin concepts leak into the base quest model

SugarAgent and Sugarlang are future integrations, not the quest system itself.

### 3. Flattening stages away

That would lose one of the strongest authoring structures Sugarengine settled on.

### 4. Building a second graph framework for quests

Reuse the graph primitives in `packages/ui`.

### 5. Forgetting that the right panel is part of the quest UX

Node editing should not get buried back into ad hoc modals or temporary overlays.
