# Plan 009: Landscape Ground Plane and Splatmap Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Bring the first real region landscape into Sugarmagic by adding a runtime-real ground plane, a dedicated `Build > Landscape` workspace, and a port path for Sugarbuilder's channel-and-splatmap landscape architecture.

### Goal

Deliver the first truthful landscape slice in Sugarmagic by:

- making landscape a real region-owned authored system
- adding a minimal visible ground plane in the authored viewport and preview
- giving landscape its own `Build > Landscape` workspace instead of hiding it inside `Layout`
- preserving Sugarbuilder's core landscape architecture:
  - channel-based landscape meaning
  - implicit base channel
  - splatmap weight payload
  - brush-driven paint workflow
  - one landscape renderer seen in authoring and runtime
- centralizing landscape rendering semantics in `runtime-core`
- creating a clean path from minimal plane rendering to full mask/channel painting

This epic is intentionally a minimal first pass, but it must head in the final architectural direction from the start.

## Recommendation

### Workspace recommendation

Landscape should **not** be folded into `Build > Layout`.

Landscape is region-scoped, but the editing UX should live in its own workspace:

- `Build > Layout`
  - placed assets
  - scene folders
  - transform/gizmo workflows
  - region scene composition
- `Build > Landscape`
  - channel authoring
  - mask previews
  - brush settings
  - landscape plane rendering
  - future splat/material paint workflows

### Why this should be a separate workspace

Because the authoring mindset and tool lifecycle are different.

`Layout` is primarily:
- object selection
- placement
- transform sessions
- folder/tree composition

`Landscape` is primarily:
- brush sessions
- paint previews
- channel selection
- mask interpretation
- landscape-specific debug/inspection views

If we collapse those together too early, we will recreate the exact bleed problems we have been trying to get rid of:

- gizmo and brush interaction fighting each other
- layout selection state becoming landscape state
- landscape overlays and channels cluttering layout workflows
- tool-specific camera/overlay assumptions leaking between systems

So the right model is:

```text
landscape data = region-owned canonical truth
landscape editing = dedicated Build workspace
landscape rendering = shared runtime-core implementation
```

### Region size clarification

This epic should not redefine `Region` as a globally fixed-size tile.

For this slice:

- the landscape plane size is the canonical ground footprint
- the viewport grid is only an editor aid
- the region remains an authored semantic unit

New regions should still start from a standard default authored footprint so the tool feels predictable.

Recommended default:

- `100m x 100m` authored ground footprint
- the default landscape plane inherits that footprint
- individual regions may override it later

Later runtime streaming may derive smaller partitions from region content, but the author should still create regions intentionally.

## Why this epic exists

The whole Sugarmagic effort started in large part because landscape parity across Sugarbuilder and Sugarengine was painful.

Landscape is the exact kind of system that punishes split ownership:

- canonical paint data in one app
- visual interpretation in another
- shader/material drift
- runtime/export mismatch
- editor-only fake rendering paths

That is why the earlier architecture work explicitly moved landscape up in priority.

This epic is the first real stress test of whether Sugarmagic can keep all of this aligned:

- canonical region landscape state
- authoring brush lifecycle
- runtime-real landscape rendering
- preview parity
- persistence/export correctness

## Sugarbuilder concepts to preserve

Sugarbuilder's implementation gives us the right design concepts even though its ownership boundaries were not the final Sugarmagic shape.

Relevant references:

- [Sugarbuilder `LandscapeSplatmap.ts`](/Users/nikki/projects/sugarbuilder/src/editor/three/LandscapeSplatmap.ts)
- [Sugarbuilder `LandscapeMesh.ts`](/Users/nikki/projects/sugarbuilder/src/editor/three/LandscapeMesh.ts)
- [Sugarbuilder `LandscapeBrush.ts`](/Users/nikki/projects/sugarbuilder/src/editor/services/LandscapeBrush.ts)
- [Sugarbuilder `LandscapeProperties.tsx`](/Users/nikki/projects/sugarbuilder/src/editor/components/LandscapeProperties.tsx)
- [Sugarbuilder ADR-029: Splatmap-Based Ground System](/Users/nikki/projects/sugarbuilder/docs/adr/029-splatmap-ground-system.md)
- [Sugarbuilder runtime export plan](/Users/nikki/projects/sugarbuilder/docs/plans/sugarengine-runtime-parity-export.md)

### Core architecture lessons from Sugarbuilder

These parts are worth preserving.

#### 1. Landscape is not object placement

Sugarbuilder gave landscape its own editor mode:
- `layout`
- `landscape`
- `environment`

That was the right product shape.

#### 2. Channel meaning is authored separately from paint weights

Sugarbuilder's landscape model split:
- `channels`
  - what each layer means
  - color/material association
- `splatmapData`
  - where each channel has influence

That is a good separation and should carry forward.

#### 3. Base channel is implicit

Sugarbuilder treated channel `0` as the base layer and stored only painted channels in splat textures.

That is a strong idea because it:
- reduces payload size
- makes the untouched ground deterministic
- gives the user a stable default ground appearance

#### 4. Brush state is not landscape state

Sugarbuilder had separate active-channel and brush settings in workspace/store state while the actual painted result lived in the landscape document and live splatmap.

That is architecturally correct and matches Sugarmagic's command/transaction rules.

#### 5. One mesh interprets the landscape

Sugarbuilder's `LandscapeMesh` was the visible interpreter of the landscape document and splatmap, not a second conceptual landscape.

Sugarmagic needs the same rule, but with cleaner ownership:
- one runtime-core landscape renderer
- authoring viewport uses it
- preview uses it
- published target uses it

#### 6. Export should separate metadata from high-volume weight payload

Sugarbuilder's later export planning was also correct here:
- metadata/channel meaning in `map.json`
- large splat payload in a sidecar

That should be the Sugarmagic direction too.

## Corrected Sugarmagic domain direction

Unlike environment, landscape **is** region-owned authored truth.

That means the region owns:
- whether landscape is enabled
- landscape dimensions/subdivision policy
- channel definitions
- canonical painted influence field

It does **not** mean the whole region must equal the landscape footprint.

### Default footprint policy

Sugarmagic should adopt a standard default authored ground footprint for new regions:

- `100m x 100m`

This is a starting point, not a global law.

The purpose is to give:

- predictable camera defaults
- predictable brush defaults
- a consistent initial sense of scale
- a useful blank authored space

without forcing every region to stay the same size forever.

### Region-owned, not environment-owned

Sugarbuilder stored landscape under environment:
- `project.scene.environment.landscape`

That should **not** carry over to Sugarmagic.

In Sugarmagic, the correct owner is:
- `Region Document`
  - `landscape`

### Canonical landscape concepts for Sugarmagic

This epic should evolve `RegionLandscapeState` into something closer to:

- `enabled`
- `size`
- `subdivisions`
- `channels`
- `paintPayloadRef` or canonical paint payload

For the first shipped Sugarmagic implementation, the canonical paint payload may live inline on the region as raw encoded splatmap layer pages, as long as:

- the payload is still canonical authored truth
- authoring and preview read the same payload through `runtime-core`
- the model can later graduate to a sidecar without changing channel meaning

Where each channel owns:
- `channelId`
- `displayName`
- `mode`
  - `color | material`
- `color`
- `materialDefinitionId | null`

And the brush session owns separately:
- active channel id
- brush mode
- brush radius
- brush strength
- brush falloff
- stroke preview state

In short English pseudo code:

```text
region landscape = canonical painted ground truth
landscape workspace = transient brush authoring state
runtime-core landscape renderer = one interpreter of canonical truth
```

## Core architecture clarification for this epic

### One runtime-owned landscape implementation

Landscape rendering and interpretation should live in `runtime-core`.

That means `runtime-core` should own:
- landscape document normalization
- channel-weight interpretation
- ground plane mesh generation
- splatmap texture creation / update
- channel blending semantics
- runtime-visible landscape descriptor
- future material-channel blending policy

It must not live in:
- `apps/studio` as a separate authoring-only fake landscape renderer
- `targets/web` as target-specific landscape interpretation
- `packages/workspaces` as rendering ownership

### Studio versus workspace versus runtime-core

The split should be:

- `packages/domain`
  - canonical region landscape data
- `packages/runtime-core`
  - landscape renderer and semantic interpreter
- `packages/workspaces`
  - landscape workspace UI, brush orchestration, channel selection, mask inspection
- `apps/studio`
  - authoring viewport composition and preview launch
- `targets/web`
  - published/preview web host around the same runtime-core landscape path

### Rendering rule

The first visible landscape plane in authoring must be the same landscape implementation used by preview.

No editor-only substitute plane.

That is the whole point of doing landscape now.

## Product and UI direction

### Build context rule

Landscape is region-scoped.

So unlike Environment:
- `Build > Landscape`
  - context selector = `Region`

That part should stay aligned with `Build > Layout`.

### Workspace shape for the first slice

Recommended first shape:

- left panel:
  - channel list
  - active channel
  - brush controls
  - later mask thumbnails
- center viewport:
  - authored scene plus shared runtime-core landscape plane
- right panel:
  - minimal inspector or none for the first slice

This differs from Environment on purpose.

Landscape genuinely benefits from a control panel because:
- channel switching is frequent
- brush settings are tool-state heavy
- mask preview is helpful
- later debug modes will need a home

## Scope of the epic

### In scope

- dedicated `Build > Landscape` workspace
- region-scoped landscape context
- minimal runtime-real ground plane rendering
- canonical region landscape domain expansion
- channel model derived from Sugarbuilder
- splatmap/mask architecture plan carried into code seams
- first brush/session architecture, even if the first slice stops short of full rich painting
- shared runtime-core landscape path for authoring and preview
- persistence/export direction for landscape metadata and payload separation

### Out of scope for this epic

- heightmap terrain sculpting
- procedural grass/foliage regeneration
- full material graph authoring for landscape channels
- advanced worker offload for brush rasterization
- publish-side optimized packed landscape formats beyond the first canonical seam
- final debug overlays for every channel mode

## Stories

### Story 1: Establish `Build > Landscape` as a real workspace

Create the workspace boundary before implementing the plane.

#### Tasks

- add `Landscape` as a real Build workspace kind in the live shell
- keep it region-scoped
- define a dedicated landscape workspace host/view
- ensure landscape workspace state is separate from layout workspace state
- ensure layout camera/gizmo state does not bleed into landscape brush state

#### Acceptance criteria

- the user can enter `Build > Landscape`
- the active context is a region, not an environment
- landscape tool state is not owned by Layout
- switching between `Layout` and `Landscape` does not mix interaction state

### Story 2: Expand canonical `RegionLandscapeState`

Replace the current placeholder landscape model with a real authored landscape document shape.

#### Tasks

- expand `/packages/domain/src/region-authoring/index.ts`
- add region landscape size and subdivision concepts
- add channel definitions with stable ids
- add canonical paint payload reference or canonical paint payload shape
- keep brush settings out of canonical region truth
- update default region creation so every region can own a valid minimal landscape
- initialize new regions with the standard `100m x 100m` default landscape footprint

#### Acceptance criteria

- `Region Document` can fully describe a minimal landscape
- channel meaning is canonical authored truth
- brush settings remain transient workspace/tool state
- the domain model matches the runtime/render ownership direction

### Story 3: Add a shared runtime-core landscape renderer for the minimal plane

Render a real ground plane through `runtime-core`, not editor-local code.

#### Tasks

- add a real landscape subsystem under `packages/runtime-core/src/landscape`
- create a minimal runtime descriptor from region landscape state
- create a ground plane mesh from canonical size/subdivision data
- support enabled/disabled landscape visibility
- render a stable base surface even before channel painting exists
- wire Studio authoring viewport to use this landscape renderer
- wire preview/web target to use the same landscape renderer

#### Acceptance criteria

- a region with landscape enabled renders a visible ground plane in authoring
- the same region renders the same plane in preview
- no separate editor-only landscape renderer exists
- the plane is clearly owned by `runtime-core`

### Story 4: Port Sugarbuilder's channel model into Sugarmagic

Bring over the important channel semantics before brush painting gets complicated.

#### Tasks

- port the concept of `LandscapeChannel`
- preserve explicit `color | material` channel mode
- preserve the implicit base channel idea
- define how many painted channels the first runtime slice supports
- define the first canonical paint payload format around channel weights
- make the left panel show channel list and active-channel selection

#### Acceptance criteria

- the workspace exposes a channel list
- the domain has stable channel meaning
- the base channel remains implicit rather than redundantly painted
- the runtime landscape renderer can consume the channel definition model

### Story 5: Introduce a real splatmap/mask subsystem seam

Create the architectural seam for painted weights even if the very first visible pass is minimal.

#### Tasks

- derive a `LandscapeSplatmap`-style subsystem inside `runtime-core`
- keep raw weight payload ownership separate from UI state
- define how channels pack into textures or payload pages
- support channel-mask rendering for authoring previews
- define a serialization seam that can later move to sidecar payloads cleanly
- avoid baking PNG data URLs directly into permanent long-term architecture decisions

#### Acceptance criteria

- there is one clear owner for painted weight data
- mask rendering comes from the landscape subsystem, not ad hoc UI code
- the architecture already points toward sidecar payloads for larger landscapes
- channel-weight interpretation is singular across authoring and preview

### Story 6: Add landscape brush session architecture

Create the brush/session boundary cleanly before broadening paint features.

#### Tasks

- add a landscape brush/session controller in the workspace layer
- add active channel, radius, strength, and falloff as workspace state
- add brush preview in the viewport
- route stroke application through the command/transaction boundary
- replace the current placeholder `PaintLandscape` command payload with a real semantic payload or transaction pattern
- make preview-only stroke state transient until commit

#### Acceptance criteria

- brush settings live in landscape workspace state, not canonical region state
- a stroke can preview, commit, and persist cleanly
- canonical landscape changes happen through semantic commands/transactions
- no direct UI mutation of region landscape truth exists

### Story 7: Implement the first real paint loop

Make the minimal landscape truly authored, not just displayed.

#### Tasks

- allow painting one or more non-base channels onto the plane
- update the runtime-core landscape renderer live in authoring
- ensure preview shows the same painted result
- allow saving/reloading the region with the painted result intact
- expose per-channel mask thumbnails in the landscape panel, following the useful Sugarbuilder pattern

#### Acceptance criteria

- the user can paint the landscape in `Build > Landscape`
- the painted result is visible immediately
- preview shows the same painted result
- save/reload preserves the painted result
- channel masks can be inspected from the workspace UI

### Story 8: Define the persistence and export seam

Make sure landscape does not become a giant inline blob forever.

#### Tasks

- define the authored persistence shape for landscape metadata
- define the weight payload storage seam separately from metadata
- keep export/publish shape consistent with the earlier Sugarmagic persistence proposals
- derive the runtime export contract from Sugarbuilder's useful `map.json + payload` split
- document a first acceptable on-disk format and the migration path to packed payloads

#### Acceptance criteria

- landscape metadata and weight payload meaning are clearly separated
- runtime/publish consumers can reconstruct the same landscape truth
- the architecture does not assume one giant inline JSON forever
- the export seam supports both color channels and future material channels

## Minimal first implementation slice

The minimum acceptable visible slice for this epic is:

1. a real `Build > Landscape` workspace
2. a visible landscape plane rendered by `runtime-core`
3. region-owned canonical landscape state
4. one or more defined channels
5. a minimal paint loop that changes visible landscape state
6. preview parity

Anything less than that risks recreating the old fake-editor-path problem.

## Suggested implementation order

1. `Build > Landscape` workspace shell
2. canonical `RegionLandscapeState` expansion
3. shared runtime-core ground plane renderer
4. channel model and left-panel UI
5. splatmap subsystem seam
6. brush session architecture
7. first real paint loop
8. persistence/export seam cleanup

## Risks

### 1. Folding landscape into Layout because it feels faster

That would be a mistake.

It would create interaction bleed and make later brush workflows much harder to stabilize.

### 2. Creating an editor-only ground plane

That would immediately violate the one-runtime rule that landscape was supposed to validate.

### 3. Treating brush state as canonical region state

That would violate the command/transaction architecture and make undo/redo much harder.

### 4. Storing giant inline splat payloads forever

That may be acceptable as a tiny first persistence hack, but it must not become the target architecture.

### 5. Porting Sugarbuilder literally instead of porting its good concepts

Sugarbuilder stored landscape under environment and used store-owned live refs.

Sugarmagic should preserve the good concepts but place ownership correctly.

## Verification strategy

### Product verification

- enter `Build > Landscape`
- confirm the workspace is region-scoped
- confirm a ground plane is visible
- confirm the same region shows the same ground plane in preview
- paint a channel
- confirm the visual result updates in authoring and preview
- save and reload
- confirm the painted landscape is preserved

### Architecture verification

- `runtime-core` is the only owner of landscape rendering semantics
- Studio does not have a second editor-only landscape renderer
- landscape brush state is workspace-owned transient state
- canonical landscape truth lives in region documents
- preview and published web host use the same runtime-core landscape path

## Builds On

- [Proposal 001: Sugarbuilder + Sugarengine Unification](/Users/nikki/projects/sugarmagic/docs/proposals/001-sugarbuilder-sugarengine-unification.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 007: Execution and Concurrency Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/007-execution-and-concurrency-architecture.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Plan 004: Build Layout Workspace Navigation Epic](/Users/nikki/projects/sugarmagic/docs/plans/004-build-layout-workspace-navigation-epic.md)
- [Plan 005: Preview Launch and Runtime Session Epic](/Users/nikki/projects/sugarmagic/docs/plans/005-preview-launch-and-runtime-session-epic.md)
- [Plan 006: Asset Library and Scene Placement Epic](/Users/nikki/projects/sugarmagic/docs/plans/006-asset-library-and-scene-placement-epic.md)
- [Plan 008: Environment Light Presets and Shared Render Pipeline Epic](/Users/nikki/projects/sugarmagic/docs/plans/008-environment-light-presets-and-shared-render-pipeline-epic.md)
