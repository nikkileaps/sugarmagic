# Proposal 001: Sugarbuilder + Sugarengine Unification Into Sugarmagic

**Status:** Proposed
**Date:** 2026-03-31

## Summary

Sugarmagic should be a new application that unifies Sugarbuilder's region-authoring capabilities with Sugarengine's runtime and game-facing systems.

The goal is not to embed Sugarbuilder unchanged inside Sugarengine. The goal is to create a new host application with:

- one runtime
- one renderer
- one region scene model
- one material and landscape implementation
- one editor shell
- one save/load path for region authoring

Sugarbuilder and Sugarengine have taught us what works. Sugarmagic should keep the strong parts and intentionally leave behind the duplicated semantics, export drift, and UI assumptions that are now costing too much time.

## Why We Are Proposing This

The current split between Sugarbuilder and Sugarengine has become structurally expensive.

Even when both applications are built on the same underlying stack, the separation creates recurring classes of problems:

- rendering parity drift
- duplicated material behavior
- duplicated landscape behavior
- duplicated sky and atmosphere behavior
- export/import mismatch
- "works in builder, breaks in engine" bugs
- lost time moving between applications to verify obvious things

This is not a one-off bug problem. It is an architecture problem.

For the intended workflow, visual trust is the product:

- if a region looks right in the editor, it must look right in runtime
- if a material is authored once, it must not need separate interpretation in another app
- if landscape paint works once, it must not need a second implementation to display correctly

The current two-application model keeps reintroducing the same risk from different angles.

## Product Decision

Sugarmagic becomes the long-term home for:

- region layout
- atmosphere and lookdev
- landscape painting
- material graph authoring and assignment
- region gameplay configuration
- runtime preview and playtest

Sugarbuilder becomes legacy/migration-only.

Sugarengine's runtime concepts survive, but they are re-homed inside Sugarmagic rather than staying in a separate app boundary.

## What Sugarmagic Is

Sugarmagic is:

- a unified region authoring and runtime application
- a game-aware editor shell
- a live runtime-backed authoring environment
- a place where visual authoring and region gameplay configuration coexist

Sugarmagic is not:

- a thin wrapper around Sugarbuilder
- a renamed copy of Sugarengine
- a temporary bridge app with duplicate internals
- a compatibility shell for every old code path

## Core Product Principles

Sugarmagic should be built under these hard rules.

### 1. One Source of Truth

Each runtime-visible concept must have one authoritative representation.

Examples:

- one region scene document
- one landscape state model
- one material graph document
- one environment model
- one placed-asset model

No duplicate editor-side and runtime-side truth for the same visible result.

### 2. Single Enforcer

Each important behavior should have one implementation that enforces the rules.

Examples:

- one material graph compiler
- one landscape renderer
- one sky and cloud system
- one region loader
- one save/load pipeline for authored regions

### 3. One-Way Dependencies

The architecture should flow downward:

- app shell
- editor workspaces and tools
- region domain services
- runtime systems
- rendering primitives

Editor tools may depend on runtime systems. Runtime systems must not depend on editor UI code.

### 4. One Type Per Behavior

Important behaviors should not be smeared across ad hoc objects.

Examples:

- `RegionDocument`
- `LandscapeDocument`
- `EnvironmentDocument`
- `MaterialGraphDocument`
- `PlacedAsset`
- `RegionWorkspaceState`

### 5. Goals Must Be Verifiable

Sugarmagic should only accept architecture decisions that can be tested and observed.

Examples:

- the same region data drives editor view and playtest view
- the same material compiler drives layout and playtest
- the same landscape renderer displays paint in edit mode and runtime mode

## Primary Product Goal

The primary goal is:

**A user can open a region in Sugarmagic, edit it visually and structurally, and play it in the same application without needing an export/import roundtrip to verify whether the authored result is real.**

That is the bar the product should be designed around.

## Secondary Product Goals

- adopt Sugarengine's visual style and shell discipline
- inherit Sugarengine's shell color palette as Sugarmagic's initial shell palette
- inherit Sugarengine's icon set and icon semantics as Sugarmagic's initial shell iconography baseline
- keep Sugarbuilder's strongest authoring workflows
- reduce time lost to parity debugging
- make region authoring feel like editing the game itself, not preparing data for another app
- create a stable home for future growth instead of continuing to pile onto split products

## Non-Goals

Sugarmagic should not initially try to solve everything.

Non-goals for the first major foundation:

- replacing Blender for modeling or sculpting
- becoming a general-purpose animation suite
- solving every publishing/distribution concern on day one
- preserving every legacy workflow if it conflicts with the new source-of-truth rules
- supporting dual-first-class standalone Sugarbuilder and Sugarmagic authoring forever

## Product Shape

Sugarmagic should use a mode-based editor shell with Sugarengine-style presentation.

For the initial shell foundation, this should be interpreted concretely:

- preserve Sugarengine's established shell palette unless and until a later proposal intentionally changes it
- preserve Sugarengine's established icon set and icon semantics unless and until a later proposal intentionally changes them
- build reusable shell and layout components instead of relying on page-level placeholder styling
- use Mantine as the backing component library for those reusable shell and layout components

### Workspace Structure

The core region workspace should look like this:

- left: region list, scene explorer, assets browser
- center: live viewport
- right: inspector and tool-specific panels
- top or subnav: workspace and mode switching

### Region Modes

The region workspace should support at least these modes:

- `Gameplay`
- `Layout`
- `Landscape`
- `Materials`
- `Atmosphere`

This keeps complexity visible but bounded.

The goal is not to merge everything into one undifferentiated screen. The goal is one host shell with intentional editing modes over the same live scene.

## What We Keep From Sugarengine

Sugarmagic should inherit these strengths from Sugarengine:

- runtime-first scene ownership
- game-aware region concepts
- region registry and world placement concepts
- gameplay-oriented configuration
- playtest loop
- content-root awareness
- engine shell discipline
- UI style direction

## What We Keep From Sugarbuilder

Sugarmagic should inherit these strengths from Sugarbuilder:

- atmosphere and lighting controls
- gradient sky and cloud authoring
- landscape paint workflows
- material graph authoring
- asset layout and lookdev workflows
- surface/material assignment workflows
- visual scene composition focus

## What We Intentionally Leave Behind

Sugarmagic should not inherit these failure patterns:

- duplicate runtime implementations across apps
- export as the normal way to validate visual truth
- editor-time behavior that requires a second runtime reinterpretation
- old compatibility paths kept alive out of fear
- ad hoc document formats that overlap in meaning

## Canonical Runtime and Editor Contract

Sugarmagic should have one runtime-visible region contract.

That contract should own:

- placed assets
- landscape state
- environment state
- materials and graph references
- markers
- region gameplay configuration

There may still be separate editor-only UI state, but there must not be separate visible-scene truth.

Examples of editor-only state:

- current selection
- active tool
- current brush radius
- expanded inspector section
- transient gizmo state

Examples of canonical authored state:

- asset transforms
- landscape channels and paint payloads
- material graph documents
- atmosphere configuration
- markers and region metadata

## Rendering and Runtime Policy

Sugarmagic should maintain one render/runtime implementation for runtime-visible content.

That means:

- one renderer configuration
- one material graph runtime
- one landscape implementation
- one sky/cloud implementation
- one region scene load path

The editor viewport and playtest viewport may differ in overlays and camera behavior, but they must share the same rendering semantics for authored content.

## Editor Architecture Policy

Sugarmagic should be one app, but not one blob.

Recommended top-level boundaries:

- `app/` or `shell/`
- `editor/regions/`
- `editor/tools/`
- `domain/regions/`
- `runtime/`
- `rendering/`
- `content/`

The editor should depend on runtime and domain services.
The runtime should not depend on editor UI.

## Region Data Policy

Sugarmagic should establish one canonical region document early.

That document should cover at least:

- region identity
- grid/world placement
- placed assets
- landscape state
- environment state
- materials used by the region
- markers
- gameplay-relevant region configuration

This document is more important than the initial UI.

If the data model or change lifecycle is still split, the product will drift again.

## Material Policy

Material graph authoring must be runtime-real.

That means:

- graph documents are not editor-only decorations
- the same graph contract drives editor rendering and runtime rendering
- there is one material compiler/runtime for authored graph behavior

Sugarmagic should not accept a design where material graphs are authored in one context and approximated later somewhere else.

## Landscape Policy

Landscape paint must be displayed by the same implementation in edit mode and playtest mode.

That includes:

- channel weights
- color channels
- material channels
- splat payload interpretation
- tiling and material assignment

Landscape is a core example of why the unified app exists.

## Atmosphere Policy

Atmosphere should be runtime-owned and editor-controlled.

That includes:

- lighting
- fog
- bloom
- SSAO
- sky gradient
- clouds

The editor should expose controls, but the systems themselves should remain runtime systems.

## Gameplay Policy

Gameplay region configuration and visual region authoring should live in the same host app but remain mode-separated.

This is important.

The new app should not collapse visual editing and gameplay setup into the same overloaded inspector by default.

Instead:

- same region
- same scene
- separate editing modes
- shared save flow

## Migration Strategy

Sugarmagic should be built as a forward migration, not a big-bang rewrite fantasy.

### Phase 0: Foundation Decision

- declare Sugarmagic the long-term host
- freeze major standalone-Sugarbuilder-only expansion
- define what must migrate first
- define what can remain legacy during transition

### Phase 1: Canonical Region Model and Change Lifecycle

Before porting workflows, define both:

- the canonical region model that Sugarmagic will own
- the lifecycle by which a change moves from transient interaction state to committed authored truth

Phase 1 must define more than fields.

It must define at least these states:

- transient interaction state
- preview state
- committed authored state
- persisted canonical state
- derived runtime and publish projections

And it must define the boundaries between them.

Examples:

- when a brush stroke is only preview
- when a drag becomes a committed authoring command
- when canonical documents are persisted
- when derived runtime projections are refreshed

This lifecycle is part of the foundation, not follow-on polish.


This is the first technical foundation.

### Phase 2: Host Shell

Build the Sugarmagic shell and region workspace container.

Get the product skeleton in place before deep authoring features.

### Phase 3: Read-Only Region View

Open a region, load it, inspect it, and navigate it inside Sugarmagic.

No heavy editing yet.

### Phase 4: Landscape Mode

Port landscape tools before atmosphere.

Landscape is the better early stress test for the unified architecture because it exercises:

- canonical authored region state
- transient brush state versus committed authored state
- runtime rendering truth
- worker-friendly heavy computation
- persistence and sidecar boundaries
- derived runtime projections
- compatibility and publish derivation

If Sugarmagic can keep landscape truthful across authoring, preview, persistence, and publish, then the core architecture is holding.

This should be treated as the first major architecture stress test after the shell and read-only region view.

### Phase 5: Atmosphere Mode

Port atmosphere controls after landscape.

Atmosphere is still a valuable early slice, but it is not the best first proof that the one-runtime, one-source-of-truth architecture is actually working under pressure.

### Why Landscape moves up

Landscape is where the old two-application model most clearly produced parity pain.

It combines:

- authoring interaction
- runtime rendering
- packed payload derivation
- heavy compute pressure
- persistence complexity
- visual trust requirements

That makes it a better early architecture validator than a safer, narrower slice.

This eliminates one of the highest-cost parity domains.

### Phase 6: Layout Mode

Port placement, selection, transforms, and outliner workflows.

### Phase 7: Materials Mode

Port material graph authoring and surface/material assignment.

### Phase 8: Gameplay Mode Integration

Bring gameplay-region configuration into the same unified region workspace.

### Phase 9: Sunset Legacy Sugarbuilder

Once the main authoring flows are stable in Sugarmagic, freeze and retire Sugarbuilder.

## Recommended First Slice

The first meaningful Sugarmagic slice should be:

- open a region
- render it with the unified runtime
- inspect environment state
- edit atmosphere live
- save the region back to the canonical region document

This proves the host shell and the single-runtime rule without trying to port everything at once.

## Risks

### 1. Recreating the Old Split Inside One App

This is the biggest danger.

If Sugarmagic contains separate editor-render and runtime-render subsystems hidden behind one window, the migration fails.

### 2. Porting UI Before Locking the Data Model

If the shell is built before the canonical region model is defined, the same duplication will reappear under a new name.

### 3. Treating Migration as a Visual Copy Exercise

Sugarmagic should adopt Sugarengine style and shell discipline, not embed Sugarbuilder as a visual foreign body.

### 4. Keeping Too Many Legacy Paths Alive

The more compatibility burden we carry, the faster the new app will inherit the old confusion.

## Success Criteria

This proposal is successful when:

1. A region can be opened and edited entirely inside Sugarmagic.
2. The same runtime systems render authored content in edit mode and playtest mode.
3. Landscape, atmosphere, layout, and materials no longer require separate app-to-app parity work.
4. Region authoring no longer depends on a normal export/import validation loop.
5. Sugarmagic feels like one coherent product, not two tools taped together.

## Immediate Next Steps

1. Write `ADR-001` for Sugarmagic declaring the single-runtime rule.
2. Define the canonical region document.
3. Define the Sugarmagic shell and region workspace structure.
4. Choose the first vertical slice: `Atmosphere`.
5. Freeze new standalone-Sugarbuilder feature growth unless it directly supports migration.

## Open Questions

These questions should be answered before implementation starts in earnest:

- What is the canonical persisted region document format?
- What existing Sugarengine editor shell pieces are worth keeping versus replacing?
- Which current Sugarbuilder workflows are strong enough to preserve nearly as-is?
- What is the precise retirement path for Sugarbuilder projects and data?
- Which editor-only overlays belong in the runtime viewport, and which belong in shell-level UI?

## Final Position

Sugarmagic is worth doing because the current split is producing recurring, structural waste.

The right move is not to keep teaching two apps to agree.
The right move is to stop asking two apps to agree at all.
