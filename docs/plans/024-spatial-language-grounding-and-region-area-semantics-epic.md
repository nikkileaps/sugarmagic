# Plan 024: Spatial Language Grounding and Region Area Semantics Epic

**Status:** Proposed  
**Date:** 2026-04-06

## Epic

### Title

Add authored region-area semantics and runtime spatial grounding so Sugarmagic can resolve deictic language such as `here`, `inside`, `outside`, `nearby`, and `at my shop` against authoritative runtime world state instead of letting NPC dialogue infer location from broad lore alone.

### Goal

Deliver a first-pass spatial language model that:

- adds authored semantic areas to regions
- maps live entity XYZ positions into those authored areas at runtime
- publishes the resolved spatial facts into the runtime blackboard
- allows SugarAgent to ground questions such as:
  - `Where are we?`
  - `Do you know if X is near here?`
  - `Are we inside the station?`
  - `What's in this area?`
- prevents unsupported deictic claims such as:
  - `here at my cheese shop`
  - when the player and NPC are actually standing outside the station
- creates one general-purpose spatial foundation that can later support:
  - conversation grounding
  - quest triggers
  - NPC behavior and routing
  - scene affordances
  - scripted checks
  - guided/agent runtime behavior

## Why this epic exists

Sugarmagic now has the first pass of runtime blackboard-backed grounding for coarse location truth:

- current region truth can answer questions such as `Where are we?`
- SugarAgent can use region `lorePageId` as a grounding anchor

That is useful, but it is too coarse for natural spatial language.

Current failure mode:

- Rick Roll owns a cheese shop in the station
- player and NPC are standing outside the station in the open exterior area
- the model blends:
  - `current region = station`
  - `NPC has lore relation to cheese shop`
- and then says something like:
  - `right here at my cheese shop`

That is not a lore problem.

That is a missing runtime spatial-semantics problem.

The system needs to know not only:

- what region entities are in

but also:

- what named semantic area they are currently occupying
- whether they are inside or outside
- whether the player and NPC share the same area
- whether the NPC is near, in, or merely associated with another place
- what authored place `here` resolves to right now

## Core recommendation

Sugarmagic should introduce a general-purpose spatial grounding layer built on top of the runtime blackboard.

That layer should have two parts:

### 1. Authored region area semantics

Regions should define authored named areas such as:

- `station.exterior`
- `station.interior`
- `ticket_hall`
- `platform`
- `cheese_kiosk`

These are not quest-specific triggers.

They are the semantic map of the playable space.

### 2. Runtime spatial resolution

Runtime systems should publish live entity positions and resolve those positions into authored areas.

That derived truth should then be written into the blackboard.

This gives the rest of the game one authoritative answer to questions like:

- where is the player right now?
- where is this NPC right now?
- are they in the same authored area?
- what does `here` mean right now?
- is the NPC currently at their shop, or merely in the broader station region?

## Scope

This epic includes:

- a new authored region-area concept in the region document model
- region-area editing in authoring UX
- runtime spatial resolution from XYZ positions to authored areas
- blackboard fact domains for resolved current area and spatial relations
- SugarAgent grounding changes for deictic language
- generation/planning guards against unsupported spatial claims
- a path for later trigger/proximity systems to reuse the same area model

## Out Of Scope

This epic does not include:

- full navmesh/pathfinding
- full GOAP or behavior trees
- full trigger/event scripting replacement
- detailed physics or collision systems
- solving every future interior/exterior loading optimization
- probabilistic belief/perception modeling of space

This epic is about authoritative spatial language grounding first.

## Architecture

## Source-of-truth split

Spatial truth should follow the same architectural rules as other runtime truth:

### Authored source

The region document owns:

- named semantic areas
- their bounds/volumes
- their display names
- optional area lore page ids
- parent/child nesting relationships
- optional tags like `interior`, `exterior`, `room`, `stall`, `platform`

### Runtime source

The runtime blackboard owns:

- live entity positions
- resolved current area for each entity
- derived area relationships
- occupancy truth
- same-area and nearby relationships

### Explicit rule

Do not let SugarAgent infer `here` purely from broad region lore or from an NPC's general lore associations.

`Here` must resolve from runtime spatial facts.

## Proposed authored model

Recommended first-pass shape:

```ts
type RegionAreaKind =
  | "zone"
  | "interior"
  | "exterior"
  | "room"
  | "stall"
  | "platform"
  | "shop";

interface RegionAreaBounds {
  kind: "box";
  center: [number, number, number];
  size: [number, number, number];
}

interface RegionAreaDefinition {
  areaId: string;
  displayName: string;
  lorePageId: string | null;
  parentAreaId: string | null;
  kind: RegionAreaKind;
  bounds: RegionAreaBounds;
}
```

Notes:

- keep v1 bounds simple with authored boxes
- do not start with arbitrary polygons or navmesh-derived geometry
- nesting matters:
  - `station` can contain `station.interior`
  - `station.interior` can contain `cheese_kiosk`
- this gives the runtime a semantic place hierarchy instead of raw trigger blobs

## Proposed blackboard facts

Built on Plan 023.

### Existing facts

- `entity.position`

### New spatial facts

```ts
interface EntityCurrentAreaFact {
  entityId: string;
  areaId: string | null;
  areaDisplayName: string | null;
  areaKind: RegionAreaKind | null;
  areaLorePageId: string | null;
  parentAreaId: string | null;
}

interface EntitySpatialRelationFact {
  entityId: string;
  otherEntityId: string;
  sameArea: boolean;
  sameParentArea: boolean;
  distanceMeters: number | null;
  proximityBand: "immediate" | "local" | "remote";
}
```

Recommended keys:

- `entity.position`
- `entity.current-area`
- `entity.spatial-relation`

Lifecycle guidance:

- `entity.position`: `frame` or `ephemeral`
- `entity.current-area`: `ephemeral`
- `entity.spatial-relation`: `ephemeral`

Owner systems:

- movement/spawn system owns `entity.position`
- spatial resolver system owns `entity.current-area`
- spatial resolver system owns `entity.spatial-relation`

### Proximity classification rule

Do not let the LLM define what `near` means.

The runtime spatial layer should define discrete proximity meaning.

Recommended first-pass bands:

- `immediate`
  - same authored area
- `local`
  - different area, same parent area
- `remote`
  - different parent area, same region

SugarAgent should use this resolved classification when answering:

- `near here`
- `close by`
- `around here`

This keeps spatial language testable and consistent.

## Spatial resolver system

Sugarmagic should add a runtime system that:

1. reads authoritative entity positions
2. reads authored area definitions for the active region
3. resolves which area contains each entity
4. resolves basic relations such as:
   - same area
   - same parent area
   - approximate distance
5. writes derived facts into the blackboard

Recommended resolution rule:

- choose the smallest containing area first
- if multiple nested areas contain the point, pick the most specific one
- if none contain the point, fall back to null or the broadest region-level area if authored

This system should be deterministic and explainable.

### Spatial stability rule

Area resolution must include a stability layer so entities do not flicker between adjacent areas when standing on a boundary.

Recommended first-pass rule:

- do not immediately switch `entity.current-area` on a single boundary-crossing sample
- require either:
  - a small hysteresis buffer
  - or short multi-frame confirmation
- prefer stability unless the entity has clearly entered a more specific contained area

This protects:

- dialogue grounding
- quest logic
- proactive NPC behavior
- spatial debugging

from jitter caused by threshold-edge movement or floating-point noise.

### Specificity rule

When a point falls within multiple nested authored areas:

- the smallest containing authored volume wins

Example:

- if a point is inside:
  - `station`
  - `station.interior`
  - `cheese_kiosk`
- the resolved current area must be:
  - `cheese_kiosk`

This rule must be deterministic and consistent across all consumers.

### 3D containment rule

Area resolution must be fully three-dimensional.

Do not use a 2D-only containment test.

This avoids false positives such as:

- resolving a player standing below a second-floor kiosk as being inside that kiosk

The resolver must consider:

- X
- Y
- Z

when determining the containing area.

## SugarAgent integration

SugarAgent should consume the spatial facts rather than inferring local place truth from lore alone.

### Interpret

Detect deictic spatial queries such as:

- `where are we?`
- `is X near here?`
- `what's in here?`
- `are we inside the station?`

Then anchor them to runtime current-area semantics, not just region-level semantics.

### Retrieve

Prefer retrieval from:

1. current area lore page
2. parent area lore page
3. current region lore page
4. NPC lore page

depending on the question shape.

### Plan / Generate

Add an explicit policy rule:

- the system must not claim:
  - `here`
  - `inside`
  - `outside`
  - `at my shop`
  - `in this room`
- unless that relation is supported by runtime spatial facts

This is the critical anti-hallucination guard for spatial language.

## NPC association vs current occupancy

This epic should make an explicit distinction between:

- places an NPC is associated with
- places the NPC is currently occupying

Example:

- Rick Roll may have `workAreaId = cheese_kiosk`
- but his live `entity.current-area` may be `station.exterior`

That means the system may safely say:

- `My shop is inside the station.`

but should not say:

- `We're here at my shop.`

unless `entity.current-area.areaId === cheese_kiosk`.

This distinction is one of the main reasons this spatial model matters.

## Future adjacency and visibility note

Containment alone is not the full story of spatial awareness.

Examples:

- an NPC inside a kiosk may still see the station hall through an open window
- an NPC inside a closed room may not have the same awareness of adjacent spaces

This epic does not require a full authored portal/visibility model in v1.

But the architecture should leave room for future authored relations such as:

- adjacency
- line-of-sight visibility
- portal/opening connectivity

These should eventually build on the same semantic area model rather than creating a separate competing location system.

## Relationship to triggers

Triggers should not be the primary spatial language model.

Instead:

- authored areas provide the general semantic place model
- triggers may later reference those areas or overlap them
- quest systems and proximity events should reuse the same spatial semantics

This avoids building:

- one area model for dialogue
- one trigger model for quests
- one location model for NPC behavior

There should be one semantic place model.

## Authoring UX recommendation

First pass should be a dedicated Build workspace:

- `Build > Spatial`

Do not overload `Build > Layout` with a hidden mode system.

Do not make authored semantic areas primary children in Scene Explorer.

Those choices would blur:

- scene composition
- semantic place authoring

into one confusing surface.

### Workspace shape

#### Left panel

- panel title: `Areas`
- list/hierarchy of authored semantic areas
- selection of the active area
- create/delete area actions

#### Right panel

Selected area details:

- display name
- kind
- lore page id
- parent area
- later, optional vertical override fields if needed

#### Viewport

- top-down authoring view by default
- snapped rectangle drawing
- move/resize handles
- colored overlays
- area labels
- parent/child containment feedback

### Authoring model

Authors should define areas as:

- snapped 2D top-down rectangles

not:

- manually drawn 3D cubes

This matches the actual human mental model for region semantics.

### Runtime/internal model

The runtime may convert the authored 2D rectangles into 3D volumes behind the scenes by:

- extruding them vertically
- using a default authored height policy
- optionally supporting special overrides later

This keeps the runtime model correct without forcing awkward 3D volume authoring UX on the designer.

### Snapping requirement

Snapping and clean edge alignment are required for v1.

The UX should help authors avoid accidental gaps and slivers between adjacent areas, because those gaps would create unstable or incorrect spatial grounding.

Do not hide this entirely behind quest trigger tooling.

These are region semantics, not just event hooks.

## Debugging requirement

Story 0 for implementation should be a spatial debug overlay.

Developers need a way to see:

- authored area bounds in the world
- current entity XYZ positions
- resolved `entity.current-area`
- parent area
- proximity band between relevant entities

Without this, debugging spatial-language failures will be unnecessarily slow and ambiguous.

## Acceptance criteria

This epic is complete when:

- regions can author named semantic areas
- runtime publishes live entity positions into the blackboard
- runtime resolves current area from entity positions
- SugarAgent can answer `Where are we?` from current area truth when available
- SugarAgent can answer `Is X near here?` using current area and parent-area context
- NPCs stop making unsupported claims like `here at my shop` when not actually in that shop
- diagnostics clearly show:
  - entity position
  - resolved current area
  - current area lore page id
  - selected retrieval target for deictic grounding
  - proximity band for nearby-style queries
  - spatial stability state when an entity is near a boundary

## Implementation order

1. extend region document with authored area definitions
2. add first-pass region-area inspector UX
3. publish entity positions into blackboard consistently
4. add runtime spatial resolver system
5. add blackboard fact domains and accessors for current area
6. update SugarAgent interpret/retrieve/generate policy for deictic grounding
7. add spatial debug overlay, diagnostics, and smoke tests

## Relationship to other plans

This epic builds directly on:

- [Plan 023: Runtime-Core Blackboard and World State Architecture Epic](/Users/nikki/projects/sugarmagic/docs/plans/023-runtime-core-blackboard-and-world-state-architecture-epic.md)

This epic also supports and strengthens:

- [Plan 019: SugarAgent Conversation Provider and Turn Lifecycle Epic](/Users/nikki/projects/sugarmagic/docs/plans/019-sugaragent-conversation-provider-and-turn-lifecycle-epic.md)
- [Plan 022: SugarAgent Lore Wiki Source of Truth and Gateway Ingestion Epic](/Users/nikki/projects/sugarmagic/docs/plans/022-sugaragent-lore-wiki-source-of-truth-and-gateway-ingestion-epic.md)

## Summary

The right long-term fix for spatial language errors is not:

- more lore text
- quest-only triggers
- nearest-object guessing
- letting the LLM improvise `here`

The right fix is:

- authored semantic areas
- live entity positions
- deterministic runtime area resolution
- hysteresis-backed stable area resolution
- blackboard-published current-area truth
- blackboard-defined proximity bands
- strict deictic grounding in SugarAgent

That gives Sugarmagic one reusable spatial foundation for dialogue, quests, and runtime behavior.

It also creates the basis for future spatial auditing and repair:

- if generated dialogue makes a spatial claim that contradicts blackboard truth
- the system should eventually be able to flag and repair that claim
