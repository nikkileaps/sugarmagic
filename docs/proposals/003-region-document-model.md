# Proposal 003: Sugarmagic Region Document Model

**Status:** Proposed
**Date:** 2026-03-31

## Summary

Sugarmagic needs one canonical region document.

This document defines what a `Region` is in Sugarmagic, what it owns directly, what it references, what is derived from it, and what is intentionally excluded from it.

The purpose of this proposal is to eliminate the old split where:

- Sugarbuilder owned the visual scene
- Sugarengine owned the gameplay region
- export artifacts sat awkwardly in the middle

Sugarmagic should replace that with one authored region model that is valid for both editing and runtime.

## Why This Proposal Exists

The domain proposal established that `Region Authoring` is one top-level domain with both visual and gameplay-local subdomains.

This proposal goes one step further and defines the canonical authored object for that domain.

This is necessary because Sugarmagic will fail if it keeps any of these old patterns:

- a visual region document separate from a gameplay region document
- a runtime-only region model that does not match authored truth
- a region export bundle treated like the real region
- region-local placements stored outside the region for historical reasons

The `Region Document` must become the canonical authored place unit.

## Design Goals

The region document must satisfy these goals.

### 1. One region, one place

A region should describe one authored place in the world.

That means it must include both:

- visual composition
- region-local gameplay placements

### 2. Stable enough for multiple workflows

The same region document should support:

- layout editing
- atmosphere editing
- landscape editing
- material assignment workflows
- gameplay placement editing
- runtime loading
- playtest
- publish/export derivation

### 3. References shared content, owns local state

A region should reference reusable shared content from the project library, but it should own local placement and local authored state.

### 4. Clear canonical boundary

It must be obvious which parts of the region are:

- canonical authored truth
- derived runtime outputs
- editor-only transient state

## Serialization Boundary Clarification

`One canonical region document` does **not** mean `one giant serialized blob`.

Sugarmagic should treat the `Region Document` as a **canonical authored aggregate**, not as a requirement that all authored, editor-only, and runtime-facing data live in one physical file.

This distinction matters because unified tools often fail by forcing runtime loading to drag editor persistence along with it. Sugarmagic should not do that.

### Core rule

There should be:

- one canonical authored `Region Document` as the semantic source of truth
- multiple serialization views of that same truth where needed
- clear separation between canonical authored data, persistent editor-assistance data, and derived runtime artifacts

That preserves `one source of truth` without forcing `one bloated file format`.

### Serialization strata

Sugarmagic should separate region persistence into three strata.

#### 1. Canonical authored region payload

This is the runtime-relevant and authoring-relevant region truth.

It includes things like:

- identity
- placement
- scene placements
- environment
- landscape
- markers
- region-local gameplay placements

This is the payload the shared runtime should be able to load directly for preview and playtest.

#### 2. Persistent authoring sidecar payload

This is persistent editor-assistance state.

It may include things like:

- inspector expansion state
- saved panel layout preferences
- cached foldout state
- editor bookmarks
- editor-only visualization preferences
- optional authoring annotations that do not change runtime meaning

This payload is not canonical region truth and must not be required by the runtime load path.

#### 3. Derived runtime and publish projections

These are generated from canonical authored truth.

They may include things like:

- baked geometry
- packed landscape payloads
- target manifests
- target-specific runtime bundles

These are not authored truth.

### Zero-copy principle for runtime-facing load

The shared runtime should be able to load the runtime-relevant authored region payload without first hydrating persistent editor sidecars.

In short English pseudo code:

1. Load canonical authored region payload.
2. Ignore editor-assistance sidecars unless an authoring surface explicitly asks for them.
3. Build runtime state directly from the canonical authored region payload.
4. Load derived publish artifacts only in publish or target-specific flows.

### What this means for the single-source-of-truth rule

`Single source of truth` should be interpreted as:

- one semantic owner for authored region meaning
- one canonical authored aggregate
- no duplicated authored truth across editor and runtime models

It should **not** be interpreted as:

- one mandatory monolithic file
- runtime needing editor-only persistence to function
- editor conveniences being promoted to canonical gameplay/world data

### Consequence

The final persisted format may be:

- one primary region file plus sidecars
- a region folder with clearly separated files
- or another tiered schema

But whatever shape is chosen later, it must preserve this rule:

- canonical authored region truth remains singular
- editor-assistance persistence remains optional to runtime loading
- publish/runtime artifacts remain derived

## Definition

A `Region Document` is the canonical authored description of one world region in Sugarmagic.

It owns:

- the region's identity
- the region's world placement
- the region's visual scene composition
- the region's environment
- the region's landscape
- the region's markers
- the region's region-local gameplay placements

It references:

- reusable content definitions from the project library

It does not own:

- project-global catalogs
- project-global progression definitions
- runtime session state
- exported geometry bundles
- compiled runtime objects

## Region Document Boundary

### Region owns directly

- region metadata
- scene composition
- environment state
- landscape state
- markers
- region-local gameplay placements
- optional region-scoped settings and policies

### Region references

- assets
- materials
- NPC definitions
- dialogues indirectly through gameplay content references
- items
- inspections
- resonance point definitions
- VFX definitions
- any other reusable project-level content

### Region does not own

- the project's content library
- seasons/episodes/quest graphs as canonical definitions
- player save state
- world-state progression state
- live entities or loaded scene graph instances
- baked publish artifacts

## Region Document Subdomains

A canonical region document should be understood as seven subdomains.

1. `Region Identity`
2. `Region Placement`
3. `Region Scene`
4. `Region Environment`
5. `Region Landscape`
6. `Region Markers`
7. `Region Gameplay Placements`

## 1. Region Identity

The region identity subdomain answers:

- what region is this?
- how is it referred to in the project?
- what stable identity does it use for references?

### Region Identity should include concepts like

- stable region id
- display name
- slug/path identity if needed
- optional descriptive metadata
- region-level versioning or migration metadata if needed

### It should not include

- runtime export paths as the primary identity
- transient editor state

## 2. Region Placement

The region placement subdomain answers:

- where does this region exist in the game world?
- how does it participate in world-grid or world-layout systems?

### Region Placement should include concepts like

- grid position
- world placement policy
- optional region size policy if region sizing is not globally fixed

### Important rule

World placement belongs to the region document, not to a derived export artifact.

This keeps Sugarmagic aligned with runtime world composition and streaming.

## 3. Region Scene

The region scene subdomain owns the visual scene graph authored inside the region.

This is the replacement for Sugarbuilder's scene ownership within a region.

### Region Scene should include concepts like

- placed asset instances
- placed lights
- decals
- scene grouping/organization constructs if still useful
- authored visibility/lock flags
- authored local metadata overrides

### Placed asset instances

A placed asset instance should own:

- stable instance identity
- reference to an asset definition
- transform
- display/organization metadata
- region-local overrides
- authored local flags such as hidden, locked, excluded, or similar if those remain useful

### Placed lights

Placed lights belong in the region scene because they are scene-authored objects in the world, not just environment presets.

### Scene organization concepts

Layers, folders, tags, and other organization tools may still exist, but they should be treated as supporting structures within the region scene rather than as the primary model.

## 4. Region Environment

The region environment subdomain owns all runtime-real atmosphere and environment settings for the region.

This should replace any notion that environment is only an editor preview concern.

### Region Environment should include concepts like

- lighting profile or authored lighting state
- fog
- bloom
- SSAO
- sky
- clouds
- backdrop settings if retained

### Important rule

The region environment is canonical authored runtime state.
It is not editor-only decoration.

## 5. Region Landscape

The region landscape subdomain owns the terrain-like painted ground state for the region.

### Region Landscape should include concepts like

- enabled state
- extent/size
- subdivision/resolution policy
- channel definitions
- channel bindings to colors or materials
- painted influence field

### Region Landscape should not include

- current brush mode
- brush radius
- brush strength
- temporary stroke previews

Those are editor workspace concerns, not authored region truth.

### Important rule

The region landscape must be sufficient to reconstruct the same landscape in both edit mode and play mode.

## 6. Region Markers

The region markers subdomain owns authored semantic anchors that exist in the region but are not yet equivalent to hard gameplay entities.

Markers matter because they are useful both for world authoring and for future gameplay wiring.

### Region Markers should include concepts like

- stable marker identity
- marker kind
- transform or position
- label/display metadata
- visual metadata such as color if useful
- optional authored metadata payload

### Important distinction

Markers are not automatically the same thing as triggers, NPC placements, or player spawns.

They are authored semantic anchors.

They may later be mapped into gameplay semantics under explicit rules, but the region document should not collapse those concepts prematurely.

## 7. Region Gameplay Placements

The region gameplay placements subdomain owns gameplay-relevant objects that are placed in this region.

This is the part that Sugarengine historically owned separately from Sugarbuilder's scene.

Sugarmagic should bring it into the same region document.

### Region Gameplay Placements should include concepts like

- NPC placements
- trigger placements
- pickup placements
- inspectable placements
- resonance point placements
- VFX spawn placements
- future region-local gameplay anchors

### Each placement should own

- stable placement identity
- reference to a reusable library definition where relevant
- local transform or position
- region-local override metadata where relevant

### Important rule

These are part of the region document because they are region-local authored content, not global game systems.

## Region Document and Shared Content

A region should reference shared definitions from the project content library.

### Region should reference, not duplicate

- asset definitions
- material definitions
- NPC definitions
- item definitions
- inspection definitions
- resonance point definitions
- VFX definitions

### Region may own local overrides where needed

Examples:

- per-instance transform
- per-instance display name
- per-instance metadata overrides
- per-placement prompt text
- per-placement behavior flags

### Region should not duplicate shared canonical definitions

For example:

- the region should not redefine the entire NPC library entry just because an NPC is placed there
- the region should not redefine a material graph because one asset instance uses that material

## Region Document and Asset Assembly

Sugarmagic needs to preserve the distinction between reusable asset definition and Sugar-authored asset assembly.

A region should not try to own all asset assembly logic directly.

### Region should reference

- asset definitions
- asset assembly documents where those are the relevant authored surface/material interpretation layer

### Region should own

- which assembled/defined asset instance is placed where
- local per-instance overrides if allowed

### Important rule

Asset assembly remains its own authored domain, but region placement is where those assembled assets become part of a place.

## Region Document and Runtime Session

The region document is authored truth.
The runtime session is live derived state.

### The runtime session may derive from the region document

- loaded scene graph
- live entity state
- streaming membership
- loaded material instances
- live landscape GPU payloads
- current trigger overlap state

### But the runtime session must not replace the region document

A live simulation is not the same as authored region content.

## Region Document and Publish Artifacts

Publish/export artifacts may be derived from the region document, but they are not themselves the region.

### Derived artifacts may include

- baked geometry bundles
- packed surface/material binding manifests
- packed landscape payloads
- deployment-specific region bundles

### But the region document remains canonical

This is one of the main protections against repeating the old architecture mistakes.

## Region Document and Editor State

Sugarmagic will need editor workspace state, but that state must not be confused with the canonical region document.

The concrete editing surface for a region should be a `RegionWorkspace` inside the appropriate `ProductMode`, not the region document itself.

### Editor-only region workspace state may include

- current mode
- selected entities
- inspector state
- current brush settings
- transform session previews
- placement session previews
- camera framing preferences

### RegionWorkspace relationship

`RegionWorkspace(regionId)` should be understood as:

- subject: one `RegionDocument`
- UI composition: viewport, outliner, inspector, and region-relevant tool surfaces
- scoped state: camera, selection, active tool, inspector context, and transient previews

The important rule is:

- `RegionWorkspace` edits the region document
- `RegionWorkspace` does not replace the region document as source of truth

### Important rule

Editor workspace state may depend on the region document, but it must not become a shadow copy of it.

## Proposed Canonical Region Object Shape

At a conceptual level, the canonical region object should look like this:

```text
RegionDocument
  identity
  placement
  scene
  environment
  landscape
  markers
  gameplayPlacements
```

This is not a required literal TypeScript interface.
It is the conceptual shape that other designs should derive from.

## Ownership Rules

### Region document is canonical for

- region-local authored content
- visual composition in that region
- environment in that region
- landscape in that region
- markers in that region
- gameplay placements in that region

### Region document is not canonical for

- shared library definitions
- project-wide progression and content catalogs
- runtime play session state
- publish artifacts

## What This Proposal Rules Out

This proposal rules out the following patterns.

### 1. Split visual region vs gameplay region truth

Sugarmagic should not maintain one object for scene authoring and another for region gameplay placements as permanent parallel truths.

### 2. Treating map/export bundles as the real region

A `geometry.glb + map.json` style output may still exist as a publish artifact, but it must not be the canonical authored region in Sugarmagic.

### 3. Editor-only environment or landscape truth

Environment and landscape are authored runtime state, not disposable preview state.

### 4. Region-local gameplay placements living permanently outside the region

NPC placements, triggers, pickups, inspectables, resonance points, and VFX spawns should all be part of the region document's authored place model.

## Verifiable Outcomes

This proposal is correct when all of the following are true.

1. A single region document can drive both visual and gameplay-local authoring for a place.
2. Runtime systems can load a region directly from the canonical region model or from clear derived artifacts.
3. Environment and landscape no longer depend on separate editor-only ownership models.
4. Region-local gameplay placements no longer need a second parallel region object to exist.
5. Editor workspace state can be cleanly separated from authored region truth.

## Follow-On Questions

This proposal should be followed by more specific decisions about:

- the exact persisted region format
- how region scene organization constructs should work
- the exact region-local placement models for NPCs, triggers, pickups, inspectables, resonance points, and VFX
- whether markers remain purely generic or gain typed subcategories
- how asset assembly references are represented in placed asset instances

## Final Position

Sugarmagic needs one authored region document.

If the region remains split across visual editing, gameplay editing, and publish artifacts, the new app will inherit the same structural confusion as the old tools.

The region document should become the canonical authored place object around which the rest of Sugarmagic is built.
