# Plan 013: Design Dialogue Graph Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Create the first real `Design > Dialogues` workspace in Sugarmagic by faithfully porting Sugarengine's dialogue graph editor, runtime dialogue semantics, and node-property workflow while extracting reusable graph primitives into `packages/ui` for future graph-based authoring surfaces.

### Goal

Deliver the first truthful dialogue-authoring slice in Sugarmagic by:

- introducing a real `Design > Dialogues` workspace
- preserving the proven three-panel Sugarengine dialogue workflow:
  - left panel for dialogue CRUD and search
  - center graph canvas
  - right panel for selected node properties
- defining canonical project-owned dialogue definitions with UUID identity
- correcting the old `speaker`/`speakerId` ambiguity from Sugarengine
- extracting reusable graph UI primitives into `packages/ui`
- keeping dialogue-specific behavior in the dialogue workspace layer
- preserving the useful runtime split from Sugarengine:
  - authored dialogue graph data
  - runtime dialogue flow manager
  - runtime dialogue presenter interface
  - shipped game dialogue UI that is separate from editor UI
- making dialogue actually playable in Preview and the published game, not just editable in Design
- keeping the design open for future Sugarlang integration without letting Sugarlang own or distort the base dialogue graph architecture

This epic should make dialogue a first-class authored system in Sugarmagic without mixing it with region placement, NPC behavior trees, or plugin-owned conversation systems.

## Recommendation

### Workspace recommendation

`Dialogues` should be a `Design` workspace.

Recommended first shape:

- `Design > Dialogues`
  - left panel for dialogue list and CRUD
  - center graph canvas
  - right panel for selected node properties

This should mirror how the dialogue editor actually ended up behaving in Sugarengine.

### Why this should be its own workspace

Because a dialogue definition is not the same kind of thing as:

- a scene placement
- a runtime-only conversation session
- an NPC definition
- a quest definition
- a plugin-owned language interaction

A dialogue definition is a project-owned authored graph.

That means it needs a home for:

- dialogue CRUD
- graph editing
- node text and speaker authoring
- choice branching
- conditional branching
- node-enter events
- playtest flow

### Boundary clarification

The following do **not** belong in the first `Design > Dialogues` workspace:

- Sugarlang generation workflows
- plugin-specific enrichment UI
- NPC behavior tree authoring
- region placement or trigger placement
- runtime session ownership
- chat/host-turn conversation workflows

In particular:

- `Dialogue definition`
  - belongs in `Design > Dialogues`
- `Dialogue playback session`
  - belongs in runtime/session state
- `Sugarlang-generated or agent-driven turns`
  - should later plug into the same runtime dialogue-presenter seam, not replace the authored dialogue graph model

## Why this epic exists

Dialogue was one of the deepest systems in Sugarengine and took time to reach a good shape.

By the end, the system had a few genuinely strong architectural ideas:

- dialogue definitions were graph-authored content
- runtime flow lived behind a dialogue manager
- runtime rendering lived behind a presenter interface
- the presenter already exposed plugin-friendly enrichment and action zones
- the editor used a graph canvas with workable node editing, conditional edges, and inline playtesting

Those ideas are worth preserving.

What should not be preserved is the accidental mess around them:

- dialogue-specific code packed into giant editor files
- graph primitives living too close to dialogue-specific rendering
- `speaker` storing a UUID under the wrong field name

This epic exists to preserve the strong end-state while cleaning the seams.

## Legacy concepts to preserve

Relevant references:

- [Sugarengine `DialoguePanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/dialogue/DialoguePanel.tsx)
- [Sugarengine `DialogueNodeCanvas.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/dialogue/DialogueNodeCanvas.tsx)
- [Sugarengine `DialogueInspector.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/dialogue/DialogueInspector.tsx)
- [Sugarengine `NodeCanvas.ts`](/Users/nikki/projects/sugarengine/src/editor/components/NodeCanvas.ts)
- [Sugarengine `DialogueManager.ts`](/Users/nikki/projects/sugarengine/src/engine/dialogue/DialogueManager.ts)
- [Sugarengine `types.ts`](/Users/nikki/projects/sugarengine/src/engine/dialogue/types.ts)
- [Sugarengine runtime `DialoguePanel.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/DialoguePanel.ts)
- [Sugarengine dialogue docs](/Users/nikki/projects/sugarengine/docs/api/06-dialogue.md)

### Core lessons from Sugarengine

#### 1. The final dialogue UX was a true three-panel workspace

The useful interaction shape was:

- left panel: dialogue list
- center: graph canvas
- right panel: node properties when a node is selected

That should carry forward.

#### 2. The graph editor was strong enough to preserve

Sugarengine's dialogue graph supported:

- pan/zoom
- minimap
- node drag
- drag-to-connect
- fit view
- start node highlighting
- choice ports
- dashed conditional edges
- inline playtest highlighting

That should carry forward, but the reusable graph parts should be extracted more cleanly.

#### 3. Runtime presenter separation was the right idea

Sugarengine separated:

- dialogue graph data
- runtime dialogue flow manager
- runtime dialogue presenter UI

That is the correct architecture for Sugarmagic too.

#### 4. The speaker model was semantically right but named badly

Sugarengine had the right concept:

- player
- player VO
- narrator
- excerpt
- NPC speaker ids

But the field name was wrong:

- `speaker` stored a UUID, not a display string

Sugarmagic should fix that from the start.

## Corrected Sugarmagic domain direction

Dialogues should become project-owned authored definitions.

### Canonical dialogue concepts for Sugarmagic

This epic should introduce a project-owned concept closer to:

- `DialogueDefinition`
  - `definitionId`
  - `displayName`
  - `startNodeId`
  - `nodes`

- `DialogueNodeDefinition`
  - `nodeId`
  - `displayName?`
  - `speakerId?`
  - `speakerLabel?`
  - `text`
  - `onEnterEventId?`
  - `next`

- `DialogueEdgeDefinition`
  - `targetNodeId`
  - `choiceText?`
  - `condition?`

This is authored project truth.

It is **not**:

- runtime dialogue state
- a presentation widget
- a plugin-owned conversation transcript

### UUID rule

Canonical authored identity must use UUIDs.

That means:

- `DialogueDefinition.definitionId` must be a UUID
- `DialogueNodeDefinition.nodeId` must be a UUID
- dialogue display names are labels, not identity

### Speaker rule

The canonical authored field must be:

- `speakerId`

not:

- `speaker`

The runtime/presenter layer may resolve that into a display name later, but authored truth must keep identity and display separate.

### Built-in speaker rule

Sugarmagic should preserve first-class built-in speaker concepts:

- Player
- Player VO
- Narrator
- Excerpt

And also allow:

- NPC definition ids as speakers

## Core architecture clarification for this epic

### Ownership split

The split should be:

- `packages/domain`
  - canonical dialogue definitions
- `packages/runtime-core`
  - runtime dialogue manager
  - speaker resolution seam
  - condition evaluation seam
  - presenter contract
  - shipped game dialogue UI/presenter used by Preview and the published game
- `packages/ui`
  - reusable graph primitives
- `packages/workspaces`
  - dialogue workspace composition
  - dialogue-specific graph rendering
  - dialogue-specific right-panel editing
  - playtest workspace UI
- `apps/studio`
  - shell composition only
- `targets/web`
  - not required for the first dialogue authoring slice

### Reusable graph rule

Reusable graph primitives should live in `packages/ui`.

That means `packages/ui` should own the generic pieces such as:

- pannable/zoomable graph canvas
- graph viewport transform state
- minimap
- node drag
- connection drag
- generic port rendering
- edge rendering
- fit-to-content behavior
- node selection behavior

The dialogue workspace should own only the dialogue-specific parts:

- node appearance
- speaker badges
- choice port layout
- conditional edge styling choices
- dialogue node inspector fields
- dialogue playtest behavior

### Runtime/presenter rule

The runtime dialogue flow should preserve Sugarengine's separation:

- dialogue manager owns flow
- presenter owns visual output

This is especially important because future Sugarlang support will want to plug into runtime conversation presentation without owning the base graph editor.

### Runtime UI rule

The playable dialogue UI is part of the shipped runtime surface and must stay separate from editor UI.

That means:

- editor graph UI belongs to `packages/ui` + `packages/workspaces`
- game dialogue UI belongs to `packages/runtime-core`
- `apps/studio` must not own the playable dialogue panel
- `targets/web` should only host/mount the runtime dialogue UI, not redefine it

Preview and the published game should therefore use the same dialogue presenter implementation and the same runtime dialogue flow.

### Sugarlang future seam

This epic must keep space for future Sugarlang integration, but Sugarlang is explicitly **not** part of this implementation.

Design implication:

- the base dialogue graph/editor must stand on its own
- the runtime presenter must remain extensible
- plugin-specific enrichment/actions should later compose into the runtime presenter, not redefine the authored dialogue data model

## Workspace UX recommendation

### Left panel

The left panel should provide:

- searchable dialogue list
- add dialogue action in the title bar
- right-click on dialogue row for deletion
- display name + quick metadata
  - node count
  - short id if helpful

### Center panel

The center panel should provide the graph canvas:

- graph background/grid
- node rendering
- connection rendering
- graph toolbar
  - playtest
  - add node
  - fit view
  - delete dialogue

### Right panel

The right panel should show selected node properties.

If no node is selected:

- show a lightweight empty state or selected-dialogue summary

If a node is selected, show:

- node display name
- speaker
- excerpt source title when needed
- dialogue text
- on-enter event
- next/choices
- connection conditions
- delete node when allowed

This should mirror the final Sugarengine dialogue editing behavior and align it cleanly with Sugarmagic's right-panel pattern.

## Stories

### Story 1: Canonical dialogue definitions

Introduce canonical project-owned dialogue definitions in the domain layer.

Tasks:

- add `DialogueDefinition` and related node/edge types to the domain package
- store dialogues in the project-owned canonical document
- make dialogue definition ids and node ids UUIDs
- use `speakerId` rather than `speaker` in canonical authored data
- add normalization helpers for dialogue definitions

Acceptance criteria:

- dialogues are stored as project-owned canonical data
- authored identity is UUID-based
- canonical dialogue types separate identity from display labels

### Story 2: Reusable graph primitives in `packages/ui`

Extract a reusable graph-editing foundation that is not dialogue-specific.

Tasks:

- create graph canvas primitives in `packages/ui`
- support pan/zoom
- support node drag
- support connection drag between ports
- support minimap
- support fit-to-content
- support node selection
- support generic node and edge rendering seams

Acceptance criteria:

- dialogue graph can be built from reusable graph UI primitives
- graph primitives contain no dialogue-specific fields or assumptions
- future graph workspaces can reuse the same graph foundation

### Story 3: `Design > Dialogues` workspace shell

Create the workspace shell with the correct three-panel structure.

Tasks:

- add `Dialogues` to `Design` navigation
- add left-panel dialogue list and search
- add add-dialogue action in the left-panel title bar
- add right-click delete on dialogue rows
- add center graph surface host
- add right-panel state for selected node

Acceptance criteria:

- `Design > Dialogues` exists
- the workspace uses left panel, center graph, right panel
- the shell matches the intended Sugarengine dialogue workflow

### Story 4: Dialogue graph editing

Build the dialogue-specific graph layer on top of the reusable graph primitives.

Tasks:

- render dialogue nodes with:
  - title
  - speaker badge
  - text preview
  - start-node highlighting
- render edges for linear and choice branches
- render conditional edges with distinctive styling
- support drag-to-connect node linking
- support add node
- support delete node with start-node and last-node safety rules
- support dialogue rename and metadata editing

Acceptance criteria:

- users can create and connect nodes visually
- start-node rules are enforced
- deleting a node removes invalid references to it
- graph interactions feel consistent with Sugarengine's mature behavior

### Story 5: Right-panel node inspector

Move node editing into the right panel while preserving the actual Sugarengine capability set.

Tasks:

- add node name editing
- add speaker selection
- add excerpt source title override
- add dialogue text editing
- add on-enter event editing
- add next/choice editing
- add connection condition editing
- add delete-node control when allowed

Acceptance criteria:

- selecting a node populates the right panel
- all core node properties are editable there
- the graph no longer needs a dialogue-specific overlay inspector

### Story 6: Condition editing

Port the connection-condition authoring model faithfully.

Tasks:

- support edge conditions in canonical dialogue data
- support condition types from Sugarengine's final dialogue editor:
  - flag
  - has item
  - quest active
  - quest completed
  - quest stage
  - not
- render condition state clearly in both graph and inspector

Acceptance criteria:

- conditions can be authored on outgoing edges
- conditional edges are visible and understandable in the graph
- condition editing works from the right panel

### Story 7: In-editor playtest mode

Port the graph playtest loop into Sugarmagic.

Tasks:

- add playtest mode to the graph toolbar
- start playtest from the dialogue start node
- highlight the active node during playtest
- render continue vs choice behavior
- support restart when playtest reaches an end node
- make clear that condition evaluation is limited or mocked if full game state is not present

Acceptance criteria:

- users can walk through authored dialogue without leaving the workspace
- active graph node is visible during playtest
- playtest reflects branch structure faithfully

### Story 8: Runtime dialogue flow and shipped game dialogue UI

Port the runtime dialogue flow architecture into `runtime-core` and restore a working playable dialogue surface for Preview and the published game.

Tasks:

- add a runtime dialogue manager
- add a dialogue presenter contract
- add the shipped game dialogue presenter/UI in `runtime-core`
- support speaker name resolution
- support on-enter event emission
- support condition filtering
- support advancing and ending dialogue
- keep runtime presenter extensibility for future plugin enrichment/actions
- wire Preview to use the same runtime dialogue presenter and manager
- wire the published game host to use the same runtime dialogue presenter and manager

Acceptance criteria:

- runtime dialogue flow is not editor-only logic
- Preview can start and complete authored dialogue using the shared runtime path
- the published game uses the same runtime dialogue presenter/UI as Preview
- runtime flow and runtime presentation are separated cleanly
- future Sugarlang integration can target the presenter seam without replacing the base dialogue model

### Story 9: Runtime proximity interaction and `Press E` prompt

Restore the Sugarengine-style proximity interaction loop that makes dialogue actually discoverable and usable in gameplay.

Tasks:

- add a runtime `InteractionSystem` in `runtime-core`
- keep it separate from trigger-volume logic:
  - `InteractionSystem` = nearby interactables + interact key
  - `TriggerSystem` = area enter/exit events
- track the nearest interactable scene presence within a fixed interaction radius
- support at least:
  - NPC dialogue interaction
  - future extension for other interactable types
- expose nearby-interaction change events from the runtime path
- add the shipped runtime interaction prompt UI in `runtime-core`
- show a `Press E` prompt when the player is near an NPC that can actually start dialogue
- hide the prompt when interaction is unavailable or blocked by another runtime UI
- route `E` through the shared runtime interaction path instead of editor-only click behavior
- start the same shared runtime dialogue manager/presenter from that interaction path in Preview and the published game
- lock movement while dialogue is active and consume the interact press so the same press does not double-trigger follow-up interaction

Acceptance criteria:

- Preview shows a `Press E` prompt when the player is close enough to an NPC with dialogue
- pressing `E` starts dialogue through the shared runtime path
- the published game uses the same runtime proximity interaction path
- the interaction prompt UI is shipped runtime UI, not editor UI
- dialogue start is driven by a runtime interaction system, not by trigger zones
- the architecture preserves a clean seam for future non-dialogue interactables

## Design constraints

### Do not mix dialogue with NPC behavior editing

Dialogue definitions should stay separate from NPC behavior logic.

### Do not conflate interaction with trigger volumes

Dialogue interaction should come from a dedicated runtime interaction system, not from the trigger-zone system.

### Do not let plugin requirements distort the base model yet

Sugarlang should influence the seam design, but not the base dialogue schema for this first port.

### Do not bury graph primitives in the dialogue workspace

The reusable graph layer must live in `packages/ui`, not inside dialogue-specific code.

### Do not collapse authored identity and display labels

Use UUIDs and explicit authored ids for identity.

## Verification

Verification should include:

- typecheck passes
- build passes
- dialogue CRUD works
- graph drag/connect works
- node selection populates the right panel
- node property edits update canonical dialogue data
- conditional edges render distinctly
- in-editor playtest works
- Preview can play authored dialogue through the shared runtime presenter/UI
- the published game path can play authored dialogue through the same runtime presenter/UI
- Preview shows the runtime `Press E` interaction prompt for nearby NPC dialogue
- pressing `E` near a valid NPC starts dialogue through the shared runtime interaction path
- runtime dialogue manager can step through a registered dialogue definition
- reusable graph primitives can be imported without dialogue-specific assumptions

## Risks

### Risk: graph primitives become dialogue-shaped

Mitigation:

- keep graph primitives generic and render-prop driven
- put dialogue semantics in the workspace layer

### Risk: Sugarlang pressures the model too early

Mitigation:

- design the presenter seam for future extension
- keep Sugarlang out of the first implementation

### Risk: right-panel editing becomes too cramped

Mitigation:

- keep the graph in the center
- use a scrollable right panel
- preserve quick graph actions in the center toolbar

### Risk: dialogue start gets implemented as an editor-only click hack

Mitigation:

- make runtime interaction a required story in this epic
- keep interaction prompt UI in `runtime-core`
- require `E`-driven gameplay interaction in Preview and the published game

## Recommended implementation order

1. canonical dialogue domain types
2. reusable graph primitives in `packages/ui`
3. dialogue workspace shell
4. dialogue graph rendering and editing
5. right-panel node inspector
6. condition editing
7. playtest mode
8. runtime dialogue flow foundation
9. runtime interaction prompt and `E`-to-dialogue path

## Done definition

This epic is done when:

- `Design > Dialogues` exists as a three-panel workspace
- dialogues are project-owned canonical definitions with UUID identity
- selected nodes are edited in the right panel
- the graph editor supports branching and conditions
- playtest works inside the workspace
- `packages/ui` owns reusable graph primitives
- runtime dialogue flow is restored behind a manager/presenter split
- Preview and the published game use the same shipped runtime dialogue presenter/UI
- Preview and the published game use the shared runtime `Press E` interaction prompt path for NPC dialogue
- the design leaves a clean future seam for Sugarlang without making Sugarlang a dependency of the first dialogue port
