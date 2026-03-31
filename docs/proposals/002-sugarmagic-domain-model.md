# Proposal 002: Sugarmagic Domain Model

**Status:** Proposed
**Date:** 2026-03-31

## Summary

Sugarmagic needs a domain model that unifies the strongest parts of Sugarbuilder and Sugarengine without inheriting their split-brain architecture.

This proposal defines the high-level domain model for Sugarmagic.

It is intentionally:

- high level
- product- and domain-oriented
- independent of UI layout
- independent of store shape
- independent of serialization format

The goal is to identify the core concepts Sugarmagic must own, how they relate, and which concepts are canonical versus derived.

This document should be strong enough that:

- editor workflows can be derived from it
- storage schemas can be derived from it
- runtime systems can be derived from it
- publish/export artifacts can be derived from it

## Why This Exists

Sugarbuilder and Sugarengine currently divide the same conceptual world across different products, different documents, and different runtime assumptions.

That split has produced repeated confusion about:

- what the real region is
- which document owns visual truth
- which document owns gameplay truth
- what is source data versus derived runtime output
- whether a system is editor-only, runtime-only, or both

Sugarmagic needs a clean domain model first so we do not recreate those problems under a new name.

## Design Requirements

The domain model must satisfy these requirements.

## ProductMode Concept

Sugarmagic should use `ProductMode` as the top-level application framing concept for major authoring contexts.

`ProductMode` is an application-shell concept, not a replacement for domain concepts.

It exists to organize how users work with the same canonical domains through different high-level product intentions.

The initial `ProductMode` set is:

- `Design`
- `Build`
- `Render`

A future `Animate` ProductMode may exist later, but it is out of scope for the current product foundation.

### Important distinction

`ProductMode` is not the same thing as:

- a domain
- a persisted document
- an editor-only micro-mode
- a tool mode
- a panel or tab

A `ProductMode` is a top-level product context that exposes and composes existing domains for a particular kind of work.

### Relationship to domains

The domain model remains the source of truth for what the product actually owns.

`ProductMode` is how those domains are presented and edited at the shell level.

That means:

- domains define ownership
- `ProductMode` defines the user's high-level working context

Sugarmagic should not invent separate domain meaning inside ProductModes.
ProductModes must be derived from domains, not the other way around.

## Workspace Concept

Sugarmagic should use `Workspace` as the concrete editing context inside a `ProductMode`.

If `ProductMode` is the top-level product lane, `Workspace` is the active editing surface within that lane.

### Important distinction

`Workspace` is not:

- a domain owner
- a top-level shell concept competing with `ProductMode`
- a canonical persisted document
- a tool session

`Workspace` is:

- a scoped editor surface
- attached to one active domain subject
- responsible for UI composition and scoped session state for that subject

### Relationship to ProductMode

The intended hierarchy is:

1. app
2. `ProductMode`
3. `Workspace`
4. tool session
5. local component state

That means:

- `ProductMode` answers what category of work is active
- `Workspace` answers what exact authored subject is currently being worked on

### Workspace owns

A `Workspace` should own or coordinate:

- active subject reference
- viewport context
- camera and framing state
- selection state for that editing surface
- inspector context
- available tools for that surface
- workspace-local derived projections
- tool-session coordination scoped to that surface

### Workspace does not own

- canonical authored truth itself
- runtime semantics
- app-global shell identity
- another workspace's transient state

### Architectural note

In implementation terms, a `Workspace` should usually be composed from:

- a workspace descriptor
- a subject reference
- shell/ProductMode composition
- `zustand` state for workspace-scoped coordination
- domain and runtime adapters for the active subject

### Examples

- `Build` ProductMode
  - `RegionWorkspace(regionId)`
  - `LandscapeWorkspace(regionId)`
- `Design` ProductMode
  - `QuestWorkspace(questId)`
  - `DialogueWorkspace(dialogueId)`
- `Render` ProductMode
  - `VFXWorkspace(vfxId)`
  - `PresentationWorkspace(presentationId)`

### 1. One runtime-visible concept, one canonical owner

If a thing is part of what the user is authoring or what the player experiences, it must have one authoritative domain owner.

### 2. Authoring truth and runtime truth must line up

Sugarmagic may have editor-only transient state, but authored world state must not need a second parallel interpretation to become runtime-real.

### 3. UI is derived, not foundational

The domain model should not assume panel layouts, tabs, stores, or specific interaction widgets.

### 4. Persistence is derived, not foundational

The domain model should not be designed around today's JSON shapes or old export files.

### 5. Derived artifacts are not source of truth

Baked geometry, packed splatmaps, thumbnails, compiled materials, and publish-ready bundles are outputs of the domain, not the domain itself.

## Store Boundary Clarification

This proposal remains intentionally independent of exact store shape.

However, Sugarmagic should still be explicit about one implementation direction:

- `zustand` may be used for shell state, ProductMode state, selection state, tool-session state, and other UI-facing coordination state
- those stores are not the canonical owner of authored domain meaning

In practical terms:

- the domain model should be consumable by stores
- the domain model should not be defined by store layout
- canonical authored mutation should still flow through semantic commands and transactions
- workspaces may coordinate domain access, but they are not domain owners

## Kinds of Change

Sugarmagic should distinguish two different kinds of change at the domain level.

### Authoring Change

An `Authoring Change` modifies canonical authored truth.

Examples:

- changing a region placement
- painting landscape state
- changing environment state
- editing a quest graph
- editing plugin configuration

These changes belong to authored domains and must pass through the formal command and transaction boundary described in [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md).

### Runtime State Change

A `Runtime State Change` modifies live play or preview state.

Examples:

- simulated NPC movement
- temporary drag previews
- quest flags changing during playtest
- player state changing during runtime

These changes belong to `Runtime Session`, not to canonical authored truth.

### Rule

The same visible object may participate in both authored and runtime contexts, but the change kinds must remain distinct.

That distinction is required to keep canonical authored truth, runtime session state, and undoable authoring history coherent.

## Top-Level Product Domains

Sugarmagic should be understood as seven high-level domains.

These domains are not ProductModes.

They describe ownership and meaning.

The shell-level `ProductMode` structure should be derived from these domains rather than replacing them.

1. `Game Project`
2. `Content Library`
3. `Region Authoring`
4. `Gameplay Authoring`
5. `Plugins`
6. `Runtime Session`
7. `Publish Artifacts`

These domains are related, but they do not own the same things.

## 1. Game Project Domain

The `Game Project` domain is the root authored container.

It is the primary unit opened, saved, validated, and published by Sugarmagic.

### Game Project owns

- project identity
- project root and authored content roots
- project-level settings
- region registry
- shared catalogs used by authored content
- episode and progression definitions
- plugin configuration and project-level optional systems
- project-scoped policies for runtime and publishing

### Game Project does not own directly

- transient editor tool state
- currently selected object
- active brush
- currently running play session state

### Key idea

A `Game Project` is not just a file.
It is the authored game root and the permanent home for all authored content.

## 2. Content Library Domain

The `Content Library` domain owns reusable authored resources that regions and gameplay content can reference.

This domain combines ideas that were previously scattered across Sugarbuilder asset catalogs and Sugarengine content roots.

### Content Library owns

- asset definitions
- material definitions
- material graph documents
- NPC definitions
- dialogue definitions
- quest definitions
- item definitions
- inspection definitions
- resonance point definitions
- VFX definitions
- spell definitions
- reusable authored content records that are referenced by regions or episodes

### Content Library conceptually contains

#### Asset Definition

An `Asset Definition` is an imported or authored reusable world object template.

It owns concepts such as:

- source geometry identity
- bounds and pivot
- placement defaults
- material slot definitions
- metadata defaults
- optional collision/export defaults

#### Material Definition

A `Material Definition` is a reusable authored surface appearance.

It owns:

- material identity
- material graph document
- texture set references
- tiling defaults
- tint defaults
- runtime-visible shading meaning

#### Gameplay Content Definitions

Reusable gameplay records belong here as catalog content:

- NPC definitions
- dialogue graphs
- quest graphs / objective graphs
- item definitions
- inspection records
- resonance point definitions
- VFX definitions
- spells and caster-facing actions

### Key idea

The content library domain owns reusable authored content.
It does not own where that content is placed in the world.

## 3. Region Authoring Domain

The `Region Authoring` domain owns the authored state of a region as a place.

This is the domain that unifies Sugarbuilder's visual scene model with Sugarengine's region identity and placement rules.

A `Region` should be treated as the main authored world-space unit.

### Region owns

- region identity
- region placement in the world grid
- authored visual scene content
- authored environment state
- authored landscape state
- authored markers
- region-local gameplay placements and references

### Region does not own

- global catalog definitions
- quest logic definitions
- global player progression state
- transient play session state

### Region contains four main subdomains

1. `Region Scene`
2. `Region Environment`
3. `Region Landscape`
4. `Region Gameplay Placements`

### 3.1 Region Scene

The `Region Scene` owns the authored visual contents placed into the region.

It includes concepts such as:

- placed asset instances
- scene-authored lights
- decals
- markers
- layers or grouping concepts if they remain useful
- authored transforms and visibility/lock metadata

#### Placed Asset Instance

A `Placed Asset Instance` is the placement of an `Asset Definition` into a region.

It owns:

- identity within the region
- reference to the asset definition
- transform
- visibility/lock/export flags
- region-local metadata overrides
- region-local material overrides where that remains valid

### 3.2 Region Environment

The `Region Environment` owns the authored atmosphere and visual world settings for the region.

It includes:

- lighting rig or lighting profile
- fog
- bloom
- SSAO
- sky state
- cloud state
- backdrop state

This domain should be runtime-owned and editor-controlled.

### 3.3 Region Landscape

The `Region Landscape` owns terrain-like painted surface state for the region.

It includes:

- enabled state
- size and resolution policy
- channel definitions
- channel bindings to colors or materials
- painted influence field across the landscape

It does not include brush tool state as canonical authored data.

Brush radius, strength, and active mode belong to authoring session state, not the region domain.

### 3.4 Region Gameplay Placements

A region is not only a visual container. It is also a gameplay arena.

This subdomain owns region-local gameplay placements and anchors such as:

- NPC placements
- triggers
- pickups
- inspectable placements
- resonance point placements
- VFX spawn placements
- future gameplay anchors and semantic markers

This is where Sugarengine's region gameplay model and Sugarbuilder's scene marker model should be reconciled.

### Key idea

A region is one authored place that contains both its visual world and its region-local gameplay placements.
Those aspects should not be split into separate products or separate truths.

## 4. Gameplay Authoring Domain

The `Gameplay Authoring` domain owns game-wide authored content and progression that is not local to one region.

This is where Sugarengine already has significant domain depth.

### Gameplay Authoring owns

- seasons and episodes
- quest graphs and objective graphs
- dialogue graphs and branching interaction content
- world-state-relevant authored conditions and actions
- NPC behaviors and optional AI/plugin interaction policies
- player-facing gameplay configuration such as caster/spell configuration
- title-screen or game-level presentation configuration where relevant

### It does not own

- the actual transient runtime state of a play session
- the rendered scene graph
- transient interaction UI state

### Important distinction

Gameplay Authoring is authored content.
Runtime Session is live state.
Those are related, but not the same domain.

## 5. Plugins Domain

The `Plugins` domain owns optional, bounded extensions that can participate in authored games and runtime sessions without becoming invisible hard dependencies of the core product.

This needs to be a first-class domain because plugins are not just low-level config. They introduce real product capabilities, authoring affordances, runtime behaviors, and deployment concerns.

### Plugins owns

- plugin definitions and identity
- plugin installation and enablement at the project level
- plugin-scoped configuration
- plugin capability declarations
- plugin-owned authored data where a plugin is explicitly allowed to own such data
- plugin runtime integration contracts
- plugin persistence boundaries

### Plugins does not own

- the canonical core region model
- the canonical material, landscape, or environment domains
- unrestricted direct mutation of runtime world state
- hidden parallel product architecture outside Sugarmagic

### Key distinction

A plugin may extend a domain, but it should not silently replace the domain owner.

For example:

- a plugin may add optional interaction behavior for NPCs
- a plugin may add optional authored metadata or workflows
- a plugin may contribute runtime systems under explicit contracts

But the plugin system should not become an excuse for unclear ownership.

### Plugin subdomains

The plugin domain should be thought of in three parts:

1. `Plugin Registry`
2. `Plugin Configuration`
3. `Plugin Runtime Contract`

#### Plugin Registry

Owns what plugins exist and how Sugarmagic knows about them.

#### Plugin Configuration

Owns whether a plugin is enabled for a project, what settings it uses, and what authored capabilities it is allowed to participate in.

#### Plugin Runtime Contract

Owns how plugins interact with live runtime systems, world state, and optional authored data under a controlled boundary.

### Why this is top-level

Plugins affect:

- project composition
- authored capabilities
- runtime behavior
- persistence
- publish/deploy shape

That is enough surface area that they should be modeled as a first-class domain instead of being scattered across project settings, gameplay logic, and runtime session internals.

## 6. Runtime Session Domain

The `Runtime Session` domain owns live play state and simulation state.

It is not an authored-content domain.

It exists because Sugarmagic must support playtest and runtime preview in the same host application.

### Runtime Session owns

- loaded regions and streaming state
- live entity state
- live world state
- quest progression state for the current session
- inventory state for the current session
- player state and position
- active dialogue state
- active plugin/runtime session state
- current playtest mode and pause state

### Runtime Session does not own

- canonical authored region content
- canonical quest definitions
- canonical asset or material definitions

### Key idea

Sugarmagic must clearly separate:

- authored game content
- from live game state

Playtest runs on authored content, but does not redefine it.
### Relationship to playtest transitions

When Sugarmagic enters playtest, `Runtime Session` should be created from a snapshot of the current committed authored state.

When playtest ends, `Runtime Session` should be discarded and the workspace context should resume.

This means:

- runtime session state is isolated
- authored state is not hot-mutated by default during playtest
- returning from playtest should restore the workspace context rather than attempt to unwind runtime mutations from the live scene graph


## 7. Publish Artifacts Domain

The `Publish Artifacts` domain owns derived outputs that are generated from authored content for deployment, optimization, or packaging.

This domain is important specifically because both Sugarbuilder and Sugarengine drifted by treating output formats as if they were core authored truth.

### Publish Artifacts owns

- baked region geometry
- packed landscape payloads
- compiled/baked material artifacts if needed
- publish manifests
- deployment-oriented runtime bundles
- target-specific delivery artifacts

### Publish Artifacts does not own

- the canonical region
- the canonical material graph
- the canonical landscape state
- the canonical gameplay content

### Key idea

Export and publish artifacts are derivatives.
They are not the place where Sugarmagic should store its true authored model.

## Canonical Domain Objects

At a high level, Sugarmagic should converge on the following canonical object families.

### Root object

- `GameProject`

### Shared content objects

- `AssetDefinition`
- `MaterialDefinition`
- `MaterialGraphDocument`
- `NPCDefinition`
- `DialogueDefinition`
- `QuestDefinition`
- `ItemDefinition`
- `InspectionDefinition`
- `ResonancePointDefinition`
- `VFXDefinition`
- `SpellDefinition`

### Region objects

- `RegionDefinition`
- `RegionScene`
- `PlacedAssetInstance`
- `PlacedLightInstance`
- `DecalInstance`
- `MarkerInstance`
- `EnvironmentDefinition`
- `LandscapeDefinition`
- `LandscapeChannelDefinition`
- `RegionGameplayPlacements`

### Asset assembly objects

These come from Sugarbuilder's asset-editing and material-authoring work and should remain explicit.

- `AssetAssemblyDocument`
- `SurfaceRole`
- `SurfaceRegion`
- `SurfaceMapping`
- `ProjectionDefinition`

The exact names may evolve, but the domain concepts matter.

#### Why these matter

An asset needs a domain for its Sugar-authored assembly, not just its imported source geometry.

That assembly domain owns concepts like:

- continuous authored surfaces
- semantic material roles
- mapping strategy
- projection behavior
- asset-local geometric overrides

This is distinct from both raw imported geometry and region placement.

### Gameplay project objects

- `SeasonDefinition`
- `EpisodeDefinition`
- `PlayerConfig`
- `WorldRuleDefinition`

### Plugin objects

- `PluginDefinition`
- `PluginConfig`
- `PluginCapability`
- `PluginRuntimeBinding`
- `PluginStateBoundary`

### Runtime session objects

- `PlaySession`
- `LoadedRegionState`
- `WorldState`
- `QuestState`
- `InventoryState`
- `PlayerState`

Again, exact names may evolve, but the conceptual boundaries should remain.

## Domain Relationships

The high-level domain relationship should look like this:

```text
GameProject
  owns ContentLibrary
  owns RegionDefinitions[]
  owns GameplayAuthoring
  owns PluginConfiguration
  owns ProjectPolicies

ContentLibrary
  owns reusable definitions referenced by regions and gameplay systems

RegionDefinition
  owns RegionScene
  owns RegionEnvironment
  owns RegionLandscape
  owns RegionGameplayPlacements

PlacedAssetInstance
  references AssetDefinition
  may reference AssetAssemblyDocument behavior

MaterialDefinition
  owns MaterialGraphDocument

GameplayAuthoring
  references ContentLibrary definitions and RegionDefinitions

Plugins
  contribute optional capabilities across authored and runtime domains through explicit contracts

PlaySession
  references GameProject authored content
  derives loaded runtime state from it

PublishArtifacts
  derive from GameProject, RegionDefinition, ContentLibrary, and GameplayAuthoring
```

## Source of Truth Rules By Domain

### Canonical authored truth

These should be treated as canonical authored truth:

- game project
- shared content definitions
- region definitions
- region-local placements
- environment state
- landscape state
- gameplay authored content
- plugin configuration and plugin-authored records where explicitly allowed
- asset assembly documents
- material graph documents

### Derived but important

These are important, but must remain derived:

- runtime scene graph
- compiled node/material instances
- landscape textures and GPU payloads
- baked geometry bundles
- packed export artifacts
- publish manifests
- thumbnails

### Editor-only transient state

These must remain editor-only and never be confused with authored truth:

- current selection
- active editing mode
- active tool
- brush settings
- inspector expansion state
- gizmo preview state
- draft drag/transform preview state

## Important Domain Decisions

### 1. Region is the main authored place unit

Sugarmagic should not preserve a split where one system owns the region visually and another owns the region as gameplay data.

A region should be one authored domain object with visual and gameplay-local subdomains.

### 2. Asset definition and asset assembly are distinct

An imported asset and a Sugar-authored assembled asset are not the same thing.

Sugarmagic should preserve that distinction:

- `AssetDefinition` = reusable source/template asset
- `AssetAssemblyDocument` = Sugarmagic-owned authored interpretation of that asset for materials, surfaces, mapping, and local overrides

### 3. Landscape is authored state, not brush state

The region owns the painted result and channel configuration.
The editor owns the current brush.

That distinction should remain explicit.

### 4. Environment is authored runtime state

Environment settings are authored content that should be directly runtime-real.
They are not just editor preview cosmetics.

### 5. Export artifacts are not the new source of truth

In Sugarmagic, publish/export should become a delivery concern, not the normal internal boundary between authoring and runtime truth.

## What This Proposal Intentionally Leaves Open

This proposal does not lock:

- exact TypeScript interfaces
- exact JSON shape
- exact Zustand/store layout
- exact file layout under the repo
- exact UI shell composition
- exact naming of every domain type

Those should be derived from this domain model, not the other way around.

## What This Proposal Rules Out

This proposal rules out the following architectural mistakes:

- one model for the editor and a different model for runtime-visible authored regions
- one landscape implementation for editing and another for runtime interpretation
- export bundles being treated as the canonical authored data model
- gameplay region data living permanently separate from authored region scene data
- material graph authoring existing without a runtime-real owning domain

## Verifiable Outcomes

This proposal is correct when all of the following are true:

1. Every major authored concept in Sugarmagic can be placed in one domain with one owner.
2. UI and ProductMode compositions can be derived from these domains without redefining them.
3. persistence formats can be derived from these domains without inventing parallel truths.
4. runtime systems can consume these domains directly or through clearly derived artifacts.
5. the team can say for any important object whether it is canonical, derived, or transient.

## Recommended Follow-On Documents

This proposal should be followed by at least three more documents:

1. a `Region Document Proposal`
   - focused on the canonical authored region object
2. a `ProductMode / Application Shell Proposal`
   - focused on how these domains become usable editing surfaces in Sugarmagic
3. a `Command and Transaction Architecture` proposal
   - focused on how authoring intent becomes canonical mutation without UI code mutating domain truth directly

## ProductMode-to-Domain Mapping

At the highest level, Sugarmagic should map its initial ProductModes to the defined domains like this:

### `Design` ProductMode

Primary domains:

- `Gameplay Authoring`
- `Content Library`
- `Plugins` where they contribute authored game capability

Typical concerns:

- quests
- dialogue
- NPC definitions and behavior configuration
- items
- inspections
- spells/caster-facing authored content
- episodes and progression structures

### `Build` ProductMode

Primary domains:

- `Region Authoring`
- `Content Library` for reusable world content
- `Plugins` where they contribute world-authoring capability

Typical concerns:

- regions
- layout
- landscape
- materials as applied in the world
- atmosphere and environment authoring
- markers
- region-local gameplay placements

### `Render` ProductMode

Primary domains:

- `Region Authoring`, specifically presentation-facing parts of authored regions
- `Content Library` for reusable VFX and presentation assets
- `Plugins` where they contribute presentation/runtime polish capability

Typical concerns:

- VFX authoring
- compositing/presentation systems
- presentation-layer polish
- future camera/presentation workflows if adopted

### Important rule

`ProductMode` should group domain work for the user, but it must not create parallel ownership models.

For example:

- `Build` ProductMode may expose `Region Environment`
- `Render` ProductMode may expose presentation-facing systems

But those remain domain concepts defined by the canonical domain model, not new shell-owned data models.

## Final Position

Sugarmagic needs domain clarity before it needs UI migration.

If the domain model is right, the UI, stores, and serialization can be designed coherently.
If the domain model is wrong, Sugarmagic will inherit the same confusion that made Sugarbuilder and Sugarengine drift apart.
