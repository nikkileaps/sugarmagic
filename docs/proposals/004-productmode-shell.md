# Proposal 004: Sugarmagic ProductMode Shell

**Status:** Proposed
**Date:** 2026-03-31

## Summary

Sugarmagic should organize its top-level application shell around three `ProductMode`s:

- `Design`
- `Build`
- `Render`

These are not low-level editing modes. They are top-level product contexts that organize how the user works with the same canonical domains.

This proposal defines the Sugarmagic shell around `ProductMode`, explains what each `ProductMode` should own at the shell level, and maps each one back to the domain model established in [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md) and [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md).

## Why This Proposal Exists

Sugarmagic needs a shell structure that is:

- clear to users
- stable as the app grows
- derived from the product's domain model
- not trapped by the old boundaries of Sugarbuilder versus Sugarengine

The application should not be organized around:

- the legacy app split
- internal implementation modules
- low-level tool types
- a pile of unrelated tabs

Instead, Sugarmagic should present a small number of strong top-level product contexts.

## Core Rule

`ProductMode` is the only term Sugarmagic should use for this top-level shell concept.

Do not use competing terms such as:

- editor mode
- top-level mode
- app mode

for this same concept.

`Workspace` is allowed as a lower-level concept inside a `ProductMode`, but the shell-level concept remains `ProductMode`.

## Initial ProductModes

Sugarmagic should begin with three ProductModes.

1. `Design`
2. `Build`
3. `Render`

A future `Animate` ProductMode may exist later, but it is explicitly out of scope for the current foundation.

## ProductMode Transition Rule for Playtest

Switching between an authoring `ProductMode` such as `Build` and a play-oriented context should use **snapshot semantics**, not an in-place hot reset of the same mutable scene state.

### Rule

When the user starts playtest:

- preserve the current workspace/session state
- create a `Runtime Session` from the current committed authored state
- isolate runtime mutations inside that session

When the user stops playtest:

- dispose the runtime session
- restore the workspace/session state
- return the user to the last committed authored state plus their preserved workspace context

### Important consequence

The product behavior should feel like:

- `pause workspace context`
- `run isolated play session`
- `resume workspace context exactly where the user left it`

not:

- mutate the live authored scene in place
- try to hot-reset every changed runtime object afterward

### Precondition rule

If there is an active transient interaction session when playtest begins, Sugarmagic should require that session to be resolved first.

In short English pseudo code:

1. If a tool session is live, commit or cancel it.
2. Snapshot current workspace/session context.
3. Start isolated runtime session from committed authored state.
4. On stop, tear down runtime session.
5. Restore workspace/session context.

## ProductMode Philosophy

A `ProductMode` should not define new domain truth.

A `ProductMode` should:

- gather related domain workflows into a coherent product context
- provide an intentional shell and navigation structure for those workflows
- share the same canonical project, region, and runtime systems as every other ProductMode

A `ProductMode` should not:

- redefine the domain model
- own duplicate persisted state for canonical concepts
- create alternate runtime interpretations of the same authored content

## Workspace Definition

Within Sugarmagic, a `Workspace` should be the concrete editing surface inside a `ProductMode`.

In short:

- `ProductMode` selects the top-level lane of work
- `Workspace` selects the active editing surface and subject within that lane

### Workspace examples

- `Build`
  - `RegionWorkspace(regionId)`
  - `LandscapeWorkspace(regionId)`
- `Design`
  - `QuestWorkspace(questId)`
  - `DialogueWorkspace(dialogueId)`
- `Render`
  - `VFXWorkspace(vfxId)`

### Workspace composition

A `Workspace` should compose:

- an active subject reference
- workspace UI surfaces
- workspace-scoped camera and selection state
- workspace-scoped tool and inspector coordination
- access to domain commands and runtime-backed preview for that subject

## Shell State and Store Model

Sugarmagic should use explicit shell/application state for ProductMode composition and authoring-session coordination.

Expected examples include:

- active `ProductMode`
- navigation state
- visible panels
- selection context
- active tool session state
- shell notifications and status state

`zustand` is a good default implementation choice for this layer.

### Important rule

This shell state is not canonical authored truth.

That means:

- `ProductMode` state is shell state
- selection state is shell/authoring-session state
- tool-session state is transient authoring state
- none of these should become the canonical owner of region, material, landscape, environment, or gameplay-authored meaning

### Placement guideline

Within the shell:

- local component state should own strictly local UI behavior
- `zustand` should own cross-shell coordination such as ProductMode, selection, navigation, and tool-session state
- canonical authored state should remain outside the shell store and be accessed through the documented domain and command boundaries

Workspace-scoped state is the default home for camera, selection, and active editing coordination for one subject.

## State Lifetime and Scoping Rules

Sugarmagic should make shell and ProductMode state lifetime explicit so modes do not bleed into each other.

### Rule

State should be owned at the narrowest scope that still supports the workflow:

- local component scope for strictly local presentation state
- tool-session scope for transient interaction state
- ProductMode scope for mode-specific shell coordination
- workspace/viewport scope for ongoing authoring context such as camera and framing

### ProductMode transition rule

When ProductMode changes:

- shared workspace state may be preserved if it is explicitly declared cross-mode
- mode-specific transient sessions must be resolved, suspended, or discarded
- one ProductMode must not silently inherit another ProductMode's transient tool state

### Camera ownership rule

Camera state should belong to the active workspace/viewport context by default, not to the entire app.

This is important because the shell should preserve orientation and trust during long authoring sessions.

### Camera restoration rule

When moving between ProductModes in the same workspace:

- preserve the meaningful authoring camera context by default
- do not apply stale tool-specific camera offsets from the prior ProductMode

When entering playtest:

- snapshot the authoring camera context

When leaving playtest:

- restore that authoring camera context instead of reusing the runtime camera

## Relationship to the Domain Model

The domain model remains primary.

The shell derives from these domains:

- `Game Project`
- `Content Library`
- `Region Authoring`
- `Gameplay Authoring`
- `Plugins`
- `Runtime Session`
- `Publish Artifacts`

The shell should expose them through ProductModes without changing their ownership.

## ProductMode: `Design`

`Design` is the ProductMode for authoring game content and systemic meaning.

This is where the user defines what the game is asking the player to do, who inhabits the world, and how authored game content behaves.

### Primary domain mapping

`Design` primarily composes:

- `Gameplay Authoring`
- `Content Library`
- `Plugins`

### `Design` should include work such as

- quests
- objective structures
- dialogue and conversation content
- NPC definitions and behavior configuration
- items
- inspection content
- spells / caster-facing authored content
- seasons and episodes
- game-level authored progression structures
- plugin-authored game content where explicitly supported

### `Design` should not be the primary home for

- region layout
- landscape painting
- atmosphere lookdev for a region
- VFX/compositing polish for a region

### Key idea

`Design` is the ProductMode for authored game meaning.

## ProductMode: `Build`

`Build` is the ProductMode for authoring the world as a place.

This is the ProductMode that most directly absorbs Sugarbuilder's strongest workflows.

### Primary domain mapping

`Build` primarily composes:

- `Region Authoring`
- `Content Library`
- `Plugins`

### `Build` should include work such as

- region creation and management
- region scene composition
- placed assets
- placed lights
- decals
- landscape authoring
- materials as applied to world surfaces and assets
- region environment and atmosphere authoring
- markers
- region-local gameplay placements

### `Build` should not be the primary home for

- quest graph authoring
- episode progression authoring
- project-wide NPC/dialogue library authoring
- presentation/compositing-focused polish workflows

### Important distinction

`Build` owns world-intrinsic authored state.

That includes:

- `Region Scene`
- `Region Environment`
- `Region Landscape`
- `Region Markers`
- `Region Gameplay Placements`

These are all defined by the region document and related domain models, not by Build-specific parallel data structures.

### Key idea

`Build` is the ProductMode for authored world structure.

## ProductMode: `Render`

`Render` is the ProductMode for authored presentation and polish.

This ProductMode should be intentionally narrower than a vague "everything visual" bucket.

### Primary domain mapping

`Render` primarily composes:

- presentation-facing parts of `Region Authoring`
- reusable presentation assets from `Content Library`
- `Plugins` that contribute presentation and runtime-polish capabilities

### `Render` should include work such as

- VFX authoring
- compositing and presentation systems
- polish-oriented runtime presentation work
- future camera/presentation tooling if adopted

### `Render` should not become the home for

- core region environment ownership
- canonical landscape ownership
- region layout and world structure
- quest/NPC/item authored content

### Important distinction

World-intrinsic authored visuals belong in `Build`.

Examples that should remain in `Build`:

- region sky
- clouds
- lighting
- fog
- landscape state

`Render` is for presentation-facing layers and polish, not for moving core region ownership out of the region domain.

### Key idea

`Render` is the ProductMode for presentation and polish.

## Shared Shell Behavior Across ProductModes

All ProductModes should share the same fundamental application shell assumptions.

### Shared assumptions

- one opened `Game Project`
- one canonical content library
- one runtime/rendering stack
- one project save flow
- one project-level navigation system
- one playtest/runtime session boundary

### Important rule

Changing ProductMode must not change the meaning of canonical authored data.

It only changes the user's working context and tool surface.

## Proposed Top-Level Shell Structure

At the highest level, the shell should look like this:

```text
Sugarmagic
  Project Navigation
  ProductMode Switcher
    Design
    Build
    Render
  Shared Runtime Viewport / Panels / Inspectors
  Shared Save / Validate / Playtest Actions
```

This is conceptual, not a literal layout mandate.

## ProductMode Navigation Model

Each ProductMode should expose a focused internal navigation structure, but that internal navigation is secondary to the ProductMode itself.

### `Design` internal navigation examples

- Quests
- Dialogue
- NPCs
- Items
- Inspections
- Spells
- Episodes

### `Build` internal navigation examples

- Regions
- Layout
- Landscape
- Materials
- Atmosphere
- Markers

### `Render` internal navigation examples

- VFX
- Compositing
- Presentation

These are examples of shell organization, not new domain models.

## Region-Centric Behavior in the Shell

Because the region document is canonical for authored places, `Build` and portions of `Render` should be region-centric.

That means:

- region selection should be a first-class shell concern
- changing the active region should update the live authored place context
- region-local editing should always be understood as editing the canonical region document

This avoids sliding back into detached scene-editing metaphors that lose connection to runtime region identity.

## Build-First Implementation Bias

Although all three ProductModes should be defined now, implementation should likely begin with `Build`.

Why:

- it captures the highest-cost parity problems from the old split
- it absorbs Sugarbuilder's most urgent capabilities
- it directly exercises the canonical region document
- it proves the one-runtime rule where it matters most

### Recommended implementation order

1. `Build`
2. `Design`
3. `Render`

This is an implementation priority, not a product-importance ranking.

## ProductMode and Runtime Session

All ProductModes should be able to rely on the same `Runtime Session` domain where needed.

### Examples

- `Build` can use the runtime viewport and playtest for region validation
- `Design` can use runtime-backed previews for dialogue or interaction validation
- `Render` can use runtime playback for presentation validation

The shell must not create separate runtime systems per ProductMode.

## ProductMode and Plugins

`Plugins` are a top-level domain and should be able to participate in ProductModes under explicit contracts.

### Examples

- a plugin may extend `Design` with optional game-content workflows
- a plugin may extend `Build` with optional world-authoring workflows
- a plugin may extend `Render` with optional presentation workflows

### Important rule

A plugin may extend a ProductMode, but it must not silently redefine the canonical ownership model behind it.

## What This Proposal Rules Out

This proposal rules out the following shell mistakes.

### 1. Organizing the app around the old app split

Sugarmagic should not have top-level shells that effectively mean:

- Sugarbuilder area
- Sugarengine area

That would preserve the old architecture under new branding.

### 2. Using ProductModes as disguised domain duplication

`Design`, `Build`, and `Render` should not each define their own conflicting versions of the same region, material, or gameplay concept.

### 3. Letting `Render` absorb all visual ownership

`Render` should not become a vague dumping ground for anything visual.
Core region environment and landscape ownership remain in `Build` through `Region Authoring`.

### 4. Letting shell structure lead domain structure

The shell should reflect the domain model, not replace it.

## Verifiable Outcomes

This proposal is correct when all of the following are true.

1. Sugarmagic can describe its top-level app structure entirely in terms of `ProductMode`.
2. Each ProductMode maps cleanly back to the defined domains.
3. The shell does not require duplicate domain models to function.
4. The user can understand the product at the highest level as:
   - `Design` the game
   - `Build` the world
   - `Render` the presentation
5. The first implementation slice can begin in `Build` without blocking the long-term shell model.

## Follow-On Work

This proposal should be followed by more concrete documents for:

- Build ProductMode shell details
- Design ProductMode shell details
- Render ProductMode shell details
- canonical project navigation model
- region-focused editing flows inside Build

## Final Position

Sugarmagic should use `ProductMode` as the top-level shell concept.

The initial ProductModes should be:

- `Design`
- `Build`
- `Render`

This gives the product a strong, domain-aligned structure without reintroducing the old split between authoring and runtime truth.
