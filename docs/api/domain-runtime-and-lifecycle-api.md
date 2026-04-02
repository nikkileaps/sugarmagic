# API 003: Domain, Runtime, and Lifecycle API

## Purpose

This document explains the main developer-facing concepts for working with Sugarmagic's authored domains, runtime session model, and lifecycle transitions.

It is the closest thing in this set to a conceptual API handbook.

## Core Concept Families

Sugarmagic is organized around a small set of major concept families.

### Canonical authored concepts

These define authored truth.

Examples:

- `Game Project`
- `Region Document`
- `Content Library` definitions
- `Gameplay Authoring` definitions
- plugin configuration and plugin-owned authored records where allowed

### Runtime concepts

These define live execution state.

Examples:

- `Runtime Session`
- loaded region state
- live world state
- ECS world state
- active quest state
- player state
- live plugin runtime state

### Derived concepts

These are projections or delivery artifacts.

Examples:

- packed runtime payloads
- geometry bake outputs
- publish manifests
- deployment bundles

## State Ownership API

Developers should think about Sugarmagic state in four ownership buckets.

### `application state`

Shell-facing and authoring-session-facing state such as:

- active `ProductMode`
- navigation state
- panel visibility
- selection state
- active tool session coordination

This state may be implemented with `zustand`.

### `canonical authored state`

Authored truth such as:

- `Game Project`
- `Region Document`
- authored gameplay definitions
- plugin-authored records where allowed

This state is not owned by a UI store.

### `runtime session state`

Live execution state such as:

- loaded runtime world state
- ECS `World` state
- player and NPC state during playtest
- live quest/session state

This state is owned by `Runtime Session`, not by shell stores.

### `derived view state`

View-friendly or cached projections such as:

- inspector-ready projections
- filtered trees
- memoized viewport-facing summaries

These may be exposed through stores, but they remain derived.

### Rule

`zustand` is appropriate for application and session coordination state.

It must not become:

- canonical authored truth
- runtime session truth
- a bypass around semantic commands and transactions

### State ownership matrix

| State kind | Canonical owner | Typical examples | Recommended home | Persistence expectation |
| --- | --- | --- | --- | --- |
| UI component-local state | component instance | popover open state, hover state, local draft input, local tab selection | local component state | usually not persisted |
| application state | shell/orchestration layer | active `ProductMode`, global selection, active tool, panel visibility, navigation state | `zustand` | optional preference or sidecar persistence only |
| canonical authored state | domain documents | `Region Document`, authored environment, authored landscape, quest definitions | domain plus command/transaction boundary | canonical authored persistence |
| runtime session state | `Runtime Session` | live playtest entity state, player state, session quest flags | runtime/session coordinators | disposable or host-policy persistence |
| derived view state | derived projection | filtered trees, inspector-ready projections, summaries | selectors, memoized derivations, thin stores | disposable |

### Fast decision rules

1. If deleting the state changes authored meaning, it belongs to canonical authored state.
2. If deleting the state only changes the current play or preview session, it belongs to runtime session state.
3. If the state exists to coordinate panels, ProductModes, selection, or tools, it belongs to application state.
4. If the state matters only inside one component, keep it local to that component.

## Workspace API

Developers should treat `Workspace` as the concrete editing context inside a `ProductMode`.

### Definition

A `Workspace` is:

- one active editing surface
- for one active domain subject
- with its own viewport, selection, inspector, tooling, and scoped session state

### Workspace composition

A workspace typically consists of:

- workspace descriptor
- active subject reference
- workspace-scoped `zustand` state
- viewport and camera context
- selection context
- inspector context
- tool-session coordination
- access to domain commands and runtime-backed preview

### Workspace implementation guideline

Concrete workspace behavior should live in authoring-facing workspace implementation modules, not in:

- `ProductMode` descriptor packages
- `runtime-core`
- `runtime-web`

except for the lower-level viewport capabilities those modules may expose.

For example:

- `runtime-core` may define scene descriptors and shared runtime semantics
- `runtime-web` may expose viewport, overlay-root, and picking helpers
- the concrete `Build > Layout` gizmo/session logic should still live in the Layout workspace implementation layer

### Workspace examples

- `RegionWorkspace(regionId)`
- `LandscapeWorkspace(regionId)`
- `QuestWorkspace(questId)`
- `DialogueWorkspace(dialogueId)`
- `VFXWorkspace(vfxId)`

### Rule

`Workspace` is where the app remembers how the user is working on a subject.

It is not where the app stores what the authored subject means.

## Runtime Gameplay Foundation API

Sugarmagic’s runtime session model should include a minimal gameplay foundation derived from Sugarengine’s ECS architecture.

### Conceptual pieces

- `World`
  - runtime owner of live entities, components, and system execution
- `System`
  - ordered simulation unit that updates the `World`
- player-controlled runtime entity
  - first controllable subject in preview/playtest

### First preview/playtest slice

For the first real preview loop, the minimum gameplay foundation should support:

- player spawn
- movement / locomotion
- runtime follow camera

This is the minimum bar for “the game is running” in preview.

### Important rule

This gameplay foundation belongs to runtime/session architecture.

It must not be implemented as:

- shell-local simulation state
- authoring workspace state
- editor-only preview code that bypasses runtime session truth

## State Lifetime and Scoping Rules

Sugarmagic should make state lifetime explicit so ProductModes and tools do not bleed into each other.

### Lifetime buckets

Use these default lifetimes:

- `component lifetime`
  - local UI behavior that may disappear on unmount
- `tool-session lifetime`
  - transient state for an active drag, brush, gizmo, or graph manipulation
- `ProductMode-session lifetime`
  - shell coordination state specific to the active ProductMode
- `workspace lifetime`
  - state that should survive within the current region/workspace context across normal panel rerenders
- `runtime-session lifetime`
  - playtest or preview state that must be discarded when that runtime session ends
- `persistent sidecar lifetime`
  - durable authoring assistance that may survive app restarts without becoming authored truth

### Scoping rule

State should be scoped to the narrowest owner and shortest lifetime that still satisfies the workflow.

If state survives longer or higher than it needs to, it becomes a mode-bleed risk.

### ProductMode bleed prevention rule

Switching ProductModes should:

- preserve only the shell/workspace state that is explicitly declared cross-mode
- dispose or suspend ProductMode-scoped tool/session state
- never let one ProductMode's transient tool state silently become another ProductMode's starting state

### Editor overlay rule

Editor overlays such as:

- gizmos
- object-origin markers
- world cursors
- temporary preview overlays

are valid workspace/tool-session state.

They should be:

- derived from workspace selection, tool state, and runtime-backed viewport context
- rendered as non-canonical editor overlays
- excluded from canonical authored persistence and runtime scene descriptors

They should not be treated as authored content.

### Camera ownership rule

Camera state should not be app-global by default.

The default owner should be the active viewport/workspace context.

That means:

- camera pose is not canonical authored truth
- camera pose is not ProductMode-independent by default
- camera pose should survive ordinary rerenders inside the same workspace
- camera pose should only reset when an explicit workflow rule calls for reset

### Camera restoration behavior

When switching ProductModes within the same workspace:

- preserve camera state if the same viewport/workspace context remains meaningful
- do not silently apply another ProductMode's stale tool camera offsets or temporary framing state

When starting playtest:

- snapshot the authoring camera/workspace context before entering the runtime session

When stopping playtest:

- restore the snapped authoring camera/workspace context instead of deriving camera state from the ended runtime session

### Anti-bleed examples

- a landscape brush radius must not become layout transform state
- a render-presentation preview camera must not overwrite the build workspace camera unless explicitly requested
- a playtest chase camera must not become the resumed authoring camera by accident

## Change Kinds API

Sugarmagic expects developers to distinguish two kinds of change.

### `Authoring Change`

A change to canonical authored truth.

Examples:

- moving a placed object in a region
- editing a quest definition
- painting landscape state
- changing environment settings

### `Runtime State Change`

A change to live runtime session state.

Examples:

- NPC movement during playtest
- player damage during simulation
- temporary drag previews
- quest flags changing in a live session

### Rule

Only `Authoring Change` participates in canonical authored history and persistence.

`Runtime State Change` belongs to `Runtime Session` unless explicitly promoted through an authored command.

## Command and Transaction API

Developers should think about authored mutation through three layers.

### 1. Tool or UI intent

A user interacts with the system.

Examples:

- drag
- paint
- click a control
- add a node

### 2. Semantic command

The interaction becomes a semantic authoring command.

Examples:

- `MovePlacedAsset`
- `PaintLandscape`
- `UpdateEnvironment`
- `CreateQuestNode`

### 3. Transaction

The semantic command commits through a transaction boundary.

The transaction:

- validates preconditions
- applies canonical mutation atomically
- records history information
- triggers derived runtime refresh

## Lifecycle States API

For major authored systems, developers should think in these states.

### `transient`

Live interaction state that is not yet canonical.

Examples:

- active drag
- active brush stroke
- temporary preview overlay

### `preview`

Renderable or visible intermediate state used during interaction.

Examples:

- provisional object position while dragging
- provisional landscape preview while brushing

### `committed`

Canonical authored mutation has been accepted through a command and transaction.

### `persisted`

Committed canonical authored state has been written through persistence boundaries.

### `derived`

Runtime projections or publish artifacts have been refreshed from canonical truth.

## Playtest Lifecycle API

The playtest model should be understood like this.

### Enter playtest

1. resolve active transient authoring sessions
2. snapshot workspace context
3. create isolated `Runtime Session` from committed authored state

### During playtest

- runtime state mutates inside `Runtime Session`
- canonical authored truth does not mutate automatically

### Exit playtest

1. dispose the runtime session
2. restore workspace context
3. return to last committed authored state

### Important rule

Stopping playtest is not a hot reset of the authored scene.

It is restoration of workspace context after an isolated runtime session ends.

## Persistence API Concepts

Developers should think in four persistence strata.

1. `canonical-authored`
2. `authoring-sidecar`
3. `derived-runtime`
4. `publish-artifact`

### Rule

A file, record, or payload should always be classifiable as one of these.

If it cannot be classified, the boundary is unclear.

## Runtime Material API Concepts

The material pipeline exposes three main developer-facing concepts.

### `canonical material graph`

The authored material source of truth.

### `normalized material IR`

The stable intermediate representation produced by the semantic compiler.

### `compile profile`

The context-specific compilation policy.

Profiles include:

- `authoring-preview`
- `runtime-preview`
- `published-target`

### Rule

Material meaning is singular.

Compile output may vary by profile.

## Landscape API Concepts

Landscape work should be understood through these concepts.

### `canonical landscape state`

The authored painted and configured landscape truth.

### `brush session`

The transient interaction that may produce preview and then command commit.

### `runtime projection`

Any packed or accelerated form of the landscape used by runtime or publish flows.

### Rule

Brush state is not the landscape.

The painted result is the landscape.

## Plugin API Concepts

Plugins should integrate through explicit capabilities.

Developer-facing concepts include:

- plugin manifest
- plugin capability
- plugin configuration
- plugin runtime contribution
- plugin command contribution
- plugin shell contribution

### Rule

Plugins may extend the system, but they do not silently replace domain owners.

## Developer Mental Model

A good default mental model for Sugarmagic is:

1. canonical authored documents define meaning
2. commands and transactions mutate them
3. runtime sessions execute from them
4. derived projections accelerate them
5. publish artifacts deliver them

That model should be enough for most developers to orient themselves before touching implementation details.

## Builds On

- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [ADR 008: Material Semantics and Compile Profiles](/Users/nikki/projects/sugarmagic/docs/adr/008-material-semantics-and-compile-profiles.md)
