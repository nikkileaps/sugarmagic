# Plan 010: Design Player Definition Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Create the first real `Design > Player` workspace in Sugarmagic so the player becomes an authored definition with a dedicated preview surface instead of a mix of hardcoded runtime assumptions and editor-only proxy markers.

### Goal

Deliver the first truthful player-authoring slice in Sugarmagic by:

- introducing a real `Design > Player` workspace
- defining a canonical player definition owned by the project, not by a region
- keeping player spawn placement out of the Player workspace and in `Build > Layout`
- making the Player workspace inspector-driven:
  - no left panel
  - right panel for authored fields
  - center viewport for player preview
- preserving the useful parts of Sugarengine's old Player panel:
  - model binding
  - named animation-slot binding
- preserving the useful part of Sugarbuilder's old player-related workflow:
  - a visible player-scale reference, now upgraded into real player physical profile truth
- previewing the authored player in the viewport:
  - capsule fallback when no model is bound
  - model preview when a model is bound
  - animation preview when clips are bound

This epic should create the first clean `Player` source of truth without smuggling in region placement or gameplay systems that belong elsewhere.

## Recommendation

### Workspace recommendation

`Player` should be a `Design` workspace, not a `Build` workspace and not a region workspace.

Recommended first shape:

- `Design > Player`
  - no left panel
  - right panel for authored player properties
  - center viewport for player preview only

### Why this should be its own workspace

Because the player is not the same kind of thing as:

- a placed asset
- a region-scoped spawn point
- a transient preview session entity
- a runtime-only ECS record

The player is a reusable authored definition.

That means it needs a home for:

- identity
- physical dimensions
- movement profile
- model binding
- animation slot binding
- future presentation/interaction tuning

### Boundary clarification

The following **do not belong** in the first `Design > Player` workspace:

- spawn location
- region-specific facing
- region-specific overrides
- inventory
- loadout
- caster
- runtime camera tuning that depends on region/world context
- NPC/item/trigger placement

Those are separate concerns.

In particular:

- `Player definition`
  - belongs in `Design > Player`
- `Player spawn placement`
  - belongs in `Build > Layout` as a region placement concern

## Why this epic exists

Right now the project has enough shared runtime path to preview a player moving through the world, but it still lacks a clean authored player definition surface.

That means several things are still too implicit:

- player dimensions
- player display name
- player model binding
- player animation binding
- movement-related authored defaults

Sugarbuilder only had a partial answer:

- a `player-scale` marker in the scene
- a capsule visualization
- generic marker editing

Sugarengine had a stronger answer in one specific area:

- a dedicated `Player` panel for model and animation bindings

But Sugarengine's `Player` surface also mixed in things that should not define the first Sugarmagic Player workspace for this game:

- caster settings
- spawn settings
- `jump` animation slot

This epic exists to keep the good parts and discard the wrong coupling.

## Legacy concepts to preserve

Relevant references:

- [Sugarbuilder `defaults.ts`](/Users/nikki/projects/sugarbuilder/src/editor/domain/defaults.ts)
- [Sugarbuilder `SceneGraphController.ts`](/Users/nikki/projects/sugarbuilder/src/editor/three/SceneGraphController.ts)
- [Sugarengine `PlayerPanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/player/PlayerPanel.tsx)
- [Sugarengine `useEditorStore.ts`](/Users/nikki/projects/sugarengine/src/editor/store/useEditorStore.ts)

### Core lessons from Sugarbuilder

#### 1. A visible player-scale proxy is useful

Sugarbuilder's `player-scale` marker was not a real Player editor, but it solved one useful problem:

- the user could see human-scale proportions in the scene

That idea should survive, but in Sugarmagic it should come from canonical player dimensions, not from a special-case editor marker.

#### 2. Generic marker editing is not enough for Player

Sugarbuilder treated the `Player` proxy like a generic scene marker.

That was useful as a stopgap, but it is not enough for Sugarmagic because it does not provide:

- real player definition ownership
- model binding
- animation binding
- a clean preview surface

### Core lessons from Sugarengine

#### 1. Model binding belonged in a dedicated Player surface

Sugarengine's Player panel had a useful authored seam for:

- `playerModel`
- `playerAnimations`

That part is worth preserving.

#### 2. Named animation slots were a good first authoring seam

Sugarengine's player UI bound clips into named slots rather than trying to author a full animation graph.

That is still the right first slice for Sugarmagic.

#### 3. Not every old field should carry forward

Sugarengine's Player panel also included:

- `jump`
- caster configuration
- spawn settings

Those should not be copied blindly into Sugarmagic's first Player workspace.

For this game, the minimum useful animation slots are:

- `idle`
- `walk`
- optionally `run` if the game truly has a run state

`jump` should not be included unless the actual game needs it.

## Corrected Sugarmagic domain direction

The player should become a project-owned authored definition.

### Canonical player concepts for Sugarmagic

This epic should introduce a project-owned concept closer to:

- `PlayerDefinition`
  - `definitionId`
  - `displayName`
  - `physicalProfile`
    - `height`
    - `radius`
    - `eyeHeight`
  - `movementProfile`
    - `walkSpeed`
    - `runSpeed?`
    - `acceleration?`
  - `presentation`
    - `modelAssetPath | null`
    - `animationSlots`
      - `idle`
      - `walk`
      - `run?`

This is authored project truth.

It is **not**:

- region placement
- runtime session state
- a scene marker

### One source of truth rule

The viewport preview should not invent a second player model.

It should always render from the same `PlayerDefinition` the right panel is editing:

- no model bound -> capsule fallback from physical profile
- model bound -> render the bound model
- animation slot chosen -> preview that authored slot

## Core architecture clarification for this epic

### Ownership split

The split should be:

- `packages/domain`
  - canonical player definition data
- `packages/runtime-core`
  - player preview construction semantics
  - capsule fallback generation
  - model/animation preview loading seam
- `packages/workspaces`
  - `Design > Player` UI
  - viewport HUD for preview controls
- `apps/studio`
  - viewport composition
- `targets/web`
  - not involved in the first Player workspace slice

### Rendering rule

The Player workspace should use a dedicated authored preview path, but it must still honor the same underlying player semantics we intend runtime to use.

That means:

- player capsule shape derives from authored physical profile
- model binding derives from authored definition
- animation slot meaning derives from authored definition

### Preview scope rule

This viewport is a **player preview surface**, not a mini gameplay runtime.

The first slice should support:

- viewing the capsule/model
- orbiting around it
- previewing bound animation slots

It should not try to recreate region gameplay.

## Product and UI direction

### Workspace shape

Recommended first shape:

- left panel:
  - none
- center viewport:
  - player preview stage
  - neutral floor/grid
  - orbit camera
  - viewport HUD for animation preview controls
- right panel:
  - player authored properties

### Right panel sections

Recommended first sections:

- `Identity`
  - `Name`
- `Physical`
  - `Height`
  - `Radius`
  - `Eye Height`
- `Movement`
  - `Walk Speed`
  - `Run Speed` only if the game uses a run state
- `Model`
  - `Model Path`
- `Animations`
  - `Idle`
  - `Walk`
  - `Run` only if real

### Viewport HUD

Recommended first HUD controls:

- `Capsule / Model` display status
- animation slot picker
  - `Idle`
  - `Walk`
  - `Run` if authored
- play/pause if needed

## Scope of the epic

### In scope

- `Design > Player` workspace shell
- canonical `PlayerDefinition` project-owned model
- right-panel authored player editing
- capsule fallback preview
- model binding
- animation-slot binding
- animation preview in viewport
- no-left-panel shell behavior for this workspace

### Out of scope for this epic

- player spawn placement
- region-specific facing
- caster configuration
- inventory/loadout
- combat/magic systems
- dialogue speaker authoring
- gameplay state machine authoring
- full animation graph/state machine tools
- multiplayer/session identity

## Stories

### Story 1: Establish `Design > Player` as a real workspace

Create the workspace boundary before implementing player data.

#### Tasks

- add `Player` as a real `Design` workspace kind in the live shell
- make the workspace right-panel-driven
- make the workspace contribute no left panel
- give the workspace a dedicated viewport preview contribution
- ensure it does not depend on region selection

#### Acceptance criteria

- the user can enter `Design > Player`
- the workspace shows no left panel
- the workspace shows a right panel and a player preview viewport
- the workspace does not require a selected region

### Story 2: Introduce canonical `PlayerDefinition`

Create a real authored player definition owned by the project.

#### Tasks

- add a project-owned player definition shape under `packages/domain`
- add defaults for:
  - name
  - height
  - radius
  - eye height
  - movement defaults
  - empty model binding
  - empty animation slots
- normalize project load/create paths to ensure valid player definition state
- keep the shape independent from region data

#### Acceptance criteria

- the project has one canonical player definition
- player dimensions are authored truth, not hardcoded viewport assumptions
- the domain model does not mix player definition with region placement

### Story 3: Add a shared runtime-core player preview representation

Create the singular interpreter for authored player preview.

#### Tasks

- add a `runtime-core` player preview subsystem
- support capsule fallback derived from physical profile
- support model preview when a model path is bound
- support a clean preview-scene contract for the workspace viewport
- avoid editor-only fake player semantics outside the shared preview subsystem

#### Acceptance criteria

- no bound model renders a capsule fallback
- bound model renders the authored player model
- the preview representation is derived from canonical player definition state

### Story 4: Build the first Player inspector

Make the right panel useful before animation preview gets richer.

#### Tasks

- add `Identity` section
- add `Physical` section
- add `Movement` section
- add `Model` section
- add `Animations` section
- wire all changes through canonical command/transaction boundaries

#### Acceptance criteria

- the user can edit player name, dimensions, movement defaults, model path, and animation slots
- edits persist as canonical authored player truth
- the viewport updates when authored player values change

### Story 5: Add model binding and animation slot binding

Preserve the useful Sugarengine seam without pulling over the old over-scoped panel.

#### Tasks

- support model path binding
- support animation slot binding for at least:
  - `idle`
  - `walk`
- optionally support `run` if the game needs it
- do not add `jump` unless it is actually required
- define how missing/bad paths surface to the UI

#### Acceptance criteria

- the user can bind a model to the player
- the user can bind idle/walk animation clips
- missing/invalid paths fail clearly without crashing the workspace

### Story 6: Add viewport animation preview controls

Turn the center viewport into a useful authored preview, not just a static model stage.

#### Tasks

- add viewport HUD controls for animation preview
- allow switching preview clip between available authored slots
- support play/pause or replay if needed
- show capsule fallback if no model is bound
- keep orbit preview controls local to this workspace

#### Acceptance criteria

- the user can preview the authored player in the viewport
- the user can switch between bound animation slots
- the viewport remains a player preview surface, not a region gameplay view

### Story 7: Remove hardcoded player assumptions from preview defaults where appropriate

Use authored player truth where it is already available.

#### Tasks

- identify runtime preview/player defaults that should come from the authored player definition
- wire safe first-slice values from `PlayerDefinition` into preview boot where appropriate
- keep spawn placement and region-specific concerns out of this step

#### Acceptance criteria

- preview can consume authored player dimensions/model information where appropriate
- region-specific spawn remains outside the Player workspace and outside this story's ownership

## Minimal first implementation slice

The minimum acceptable visible slice for this epic is:

1. a real `Design > Player` workspace
2. no left panel
3. right-panel player definition editing
4. capsule fallback preview in the viewport
5. model binding
6. idle/walk animation slot binding
7. viewport animation preview

Anything less than that risks making the Player workspace feel like an empty settings form instead of a real authored surface.

## Suggested implementation order

1. `Design > Player` workspace shell
2. canonical `PlayerDefinition`
3. shared runtime-core player preview subsystem
4. right-panel inspector sections
5. model binding and animation slots
6. viewport animation preview controls
7. runtime preview cleanup around authored player defaults

## Risks

### 1. Mixing spawn placement into the Player workspace

That would blur authored player definition with region placement and create the wrong dependency direction.

### 2. Pulling over Sugarengine's caster panel wholesale

That would over-scope the workspace immediately and mix in systems we explicitly do not want here.

### 3. Keeping player dimensions implicit in viewport code

That would repeat the old proxy-marker problem instead of upgrading it into real authored truth.

### 4. Building a fake preview that is unrelated to runtime player semantics

That would create another editor/runtime drift seam.

### 5. Copying old animation slot assumptions blindly

If the game does not use `jump`, it should not appear just because an old panel had it.

## Verification strategy

### Product verification

- enter `Design > Player`
- confirm there is no left panel
- confirm the right panel edits the player definition
- confirm the viewport shows a capsule fallback by default
- bind a model path
- confirm the viewport shows the model
- bind idle/walk animations
- confirm the viewport can preview them
- save and reload
- confirm authored player settings persist

### Architecture verification

- player definition is project-owned canonical truth
- player spawn is not owned by the Player workspace
- viewport preview derives from canonical player definition state
- player preview camera/tool state does not bleed into other workspaces
- no region dependency exists for editing the player definition

## Builds On

- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Plan 004: Build Layout Workspace Navigation Epic](/Users/nikki/projects/sugarmagic/docs/plans/004-build-layout-workspace-navigation-epic.md)
- [Plan 005: Preview Launch and Runtime Session Epic](/Users/nikki/projects/sugarmagic/docs/plans/005-preview-launch-and-runtime-session-epic.md)
- [Plan 009: Landscape Ground Plane and Splatmap Epic](/Users/nikki/projects/sugarmagic/docs/plans/009-landscape-ground-plane-and-splatmap-epic.md)
