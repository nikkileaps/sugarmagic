# Plan 007: Layout Viewport Camera Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Add a real authored-world camera to `Build > Layout` without bleeding camera behavior into other workspaces, preview, or the published runtime.

### Goal

Bring the first real viewport camera controls into Sugarmagic's `Build > Layout` so the user can navigate the authored scene comfortably while preserving the architectural boundaries we learned the hard way from Sugarbuilder and Sugarengine.

This epic should deliver:

- a real layout-only viewport camera controller
- an `OrbitControls`-based authored-scene camera for `Build > Layout`
- predictable orbit / pan / zoom behavior derived from the proven Sugarbuilder editor camera
- clean interaction coexistence with selection, gizmos, and transform sessions
- strict separation between authoring camera behavior and runtime / preview camera behavior
- no camera-state bleed across workspaces

### Why this epic exists

Plan 004 established the first real `Build > Layout` workspace shell.

Plan 006 established the first real scene loop:

- import asset
- place asset
- select asset
- manipulate asset

What is still missing is the ability to comfortably move around the authored scene in Layout itself.

Without this, the current layout viewport still behaves like a mostly static stage:

- hard to inspect placement from different angles
- hard to work at different scales
- hard to manage larger regions
- too easy to mistake viewport limitations for scene problems

At the same time, camera behavior is one of the easiest places to accidentally corrupt the architecture:

- putting editor camera behavior into shared runtime code
- letting one workspace's camera state leak into another
- accidentally sharing authoring camera assumptions with preview/runtime

So this epic is not just about controls. It is about getting the ownership boundary right.

### Sugarbuilder behavior to preserve at the product level

This epic should derive its layout camera behavior from the proven Sugarbuilder editor viewport pattern:

- a dedicated editor camera controller for the scene viewport
- `OrbitControls` as the underlying authored-scene camera interaction model
- orbit-style authored-scene navigation
- world-oriented controls appropriate for level/layout work
- camera interaction that coexists cleanly with transform interactions
- the ability to keep the editor camera entirely separate from runtime/game cameras

Relevant references:

- [Sugarbuilder `SceneViewportCameraController.ts`](/Users/nikki/projects/sugarbuilder/src/editor/three/SceneViewportCameraController.ts)
- [Sugarbuilder `EditorViewportController.ts`](/Users/nikki/projects/sugarbuilder/src/editor/three/EditorViewportController.ts)
- [Sugarbuilder `OrbitCameraRig.ts`](/Users/nikki/projects/sugarbuilder/src/core/OrbitCameraRig.ts)

Sugarmagic should **not** copy Sugarbuilder's whole viewport architecture literally.

What it should preserve is the core ownership lesson:

- editor camera behavior belongs to the editor viewport/workspace layer
- not the runtime
- not preview
- not shared authored content semantics

## Core architecture clarification for this epic

### Layout camera ownership

The layout camera is **authoring interaction state**, not authored scene truth.

That means it must **not** live in:

- `runtime-core`
- preview session state
- published target host state
- canonical `Region Document`

It belongs to the `Build > Layout` workspace layer.

For this epic, the implementation should explicitly use `OrbitControls` in that layout workspace layer, following the Sugarbuilder pattern. `OrbitControls` should be treated as:

- a layout authoring interaction detail
- owned by the layout workspace/controller
- attached only while `Build > Layout` is active

It must **not** be treated as:

- runtime camera behavior
- preview camera behavior
- a shared editor-wide singleton camera abstraction
- canonical authored state

In short English pseudo code:

```text
layout camera = workspace interaction state
preview camera = runtime session state
published game camera = target/runtime behavior
canonical region = owns none of those
```

### Workspace separation rule

This epic must make one rule explicit:

- a workspace may own a camera controller for how that workspace views the scene
- but that camera controller must not be treated as shared shell truth

So:

- `Build > Layout` may own a layout viewport camera controller
- `Build > Environment` may later choose a different authoring camera behavior
- `Build > Assets` may later choose a different asset-inspection camera behavior
- preview owns its own runtime camera behavior entirely separately

No single authoring camera abstraction should become a hidden shared enforcer across all of those unless the architecture deliberately chooses that later.

### Runtime separation rule

This epic must not:

- change preview camera behavior
- change runtime/player-follow camera behavior
- introduce camera semantics into `runtime-core` that are only for authoring navigation

Runtime camera behavior remains governed by the runtime/preview architecture from Plan 005.

This epic is only about authored-scene navigation inside `Build > Layout`.

## Product behavior clarification

For this first slice, the layout camera should support:

- `OrbitControls`-based authored-scene navigation
- orbit around the authored scene
- pan
- zoom / dolly
- a sensible initial isometric-style view

It should coexist with:

- left-click selection
- transform gizmos
- viewport overlays

The camera should feel like a real world-building viewport camera, not like the runtime/player camera.

### Interaction coexistence rule

This epic should explicitly preserve:

- left click for selection and transform interactions
- camera orbit/pan on non-conflicting input paths
- transform interaction priority when a transform session is active

The camera must not make selection and gizmo interactions unreliable.

## Scope of the epic

### In scope

- layout-only viewport camera controller
- orbit / pan / zoom behavior for `Build > Layout`
- initial authored-scene isometric view
- camera controller lifecycle attach/detach with `Build > Layout`
- camera interaction coexistence with current selection and gizmo workflows
- separation of layout camera state from preview/runtime

### Out of scope for this epic

- preview/runtime camera changes
- player-follow camera work
- cross-workspace shared camera system
- cinematic/editor animation camera systems
- camera bookmarks
- camera persistence into canonical authored documents
- advanced focus-on-selection and framing workflows beyond what is needed for the first usable slice

## Stories

### Story 1: Define the layout camera boundary

Make the architecture concrete in code before adding controls.

#### Tasks

- identify the exact ownership seam for a layout-only camera controller
- ensure the controller lives in the `Build > Layout` workspace layer
- confirm no authoring camera logic is added to `runtime-core`
- confirm no preview/runtime camera logic is touched
- define the viewport integration seam needed by the layout camera controller

#### Acceptance criteria

- the layout camera controller has a clear workspace-local home
- no runtime or preview package becomes the owner of authoring camera behavior
- no canonical region or project document gains camera state from this epic

### Story 2: Implement a layout-only viewport camera controller

Add the first real camera interaction for `Build > Layout`, modeled on the proven Sugarbuilder scene viewport camera behavior.

#### Tasks

- derive camera behavior from Sugarbuilder's `SceneViewportCameraController`
- use `OrbitControls` as the underlying interaction primitive
- implement a layout-scoped camera controller
- provide a sensible initial isometric view
- support orbit / pan / zoom
- configure non-conflicting input mappings so selection/gizmo workflows remain usable

#### Acceptance criteria

- the user can orbit, pan, and zoom in `Build > Layout`
- `Build > Layout` camera interaction is explicitly implemented with `OrbitControls`
- the initial layout camera starts from a sensible authored-world view
- the control scheme feels clearly authoring-oriented, not runtime-oriented

### Story 3: Coordinate camera interaction with transform interaction

Ensure camera and gizmo input do not fight each other.

#### Tasks

- verify transform sessions retain priority when active
- ensure gizmo drag does not accidentally trigger camera interaction
- ensure camera controls do not break left-click selection
- verify transform and camera input can alternate cleanly without stale state

#### Acceptance criteria

- selection still works
- gizmo drag still works
- camera interaction does not steal transform drag input
- transform interaction does not leave the camera in a broken state

### Story 4: Add cardinal camera view snapping

Add Blender-style quick view snapping so the user can jump to standard authored-scene views without manually orbiting every time.

#### Tasks

- add layout-only camera snap actions for standard orthographic-style viewpoints
- follow Blender's keypad mental model for the initial shortcut set:
  - `1` = front
  - `3` = side
  - `7` = top
- make the snapped views preserve the layout camera ownership boundary
- ensure snapping updates the `OrbitControls` target/view cleanly rather than fighting the controller
- ensure these shortcuts only affect `Build > Layout`

#### Acceptance criteria

- the user can press `1` to snap to a front view in `Build > Layout`
- the user can press `3` to snap to a side view in `Build > Layout`
- the user can press `7` to snap to a top view in `Build > Layout`
- view snapping feels immediate and predictable
- the shortcuts do not leak into preview/runtime or other workspaces

### Story 5: Keep camera state local to Layout

Make sure camera state stays where it belongs.

#### Tasks

- ensure the layout camera controller only attaches while `Build > Layout` is active
- ensure switching away from Layout detaches layout camera interaction cleanly
- ensure preview launch does not reuse the layout camera
- ensure runtime/preview still boot with their own camera behavior

#### Acceptance criteria

- layout camera interaction is active only in `Build > Layout`
- switching workspaces does not leak layout camera behavior into other views
- preview/runtime remain unaffected by this epic

### Story 6: Verify the first layout camera workflow end to end

Prove the result works in the actual authored loop.

#### Tasks

- import and place a real asset
- orbit / pan / zoom around it in Layout
- snap to front / side / top views
- select it from viewport and tree
- manipulate it with the gizmo
- switch away from Layout and back
- launch preview and confirm preview uses runtime camera behavior, not layout camera behavior

#### Acceptance criteria

- the layout camera is usable for normal world-building work
- layout selection and transform workflows still function
- preview remains architecturally and behaviorally separate

## Risks

- accidentally placing editor camera behavior into shared runtime code
- choosing input mappings that collide with selection/gizmo workflows
- creating a camera abstraction that quietly becomes shared across workspaces before that is actually intended
- letting layout camera state leak into preview or runtime-session boot

## Verification strategy

This epic is successful when:

1. `Build > Layout` has a real authored-world camera.
2. The camera behavior feels like editor/world-authoring navigation, not gameplay camera control.
3. Standard snapped views are available and predictable.
4. Selection and gizmo manipulation still work reliably.
5. Switching out of Layout removes layout camera ownership cleanly.
6. Preview still launches with runtime camera behavior unaffected by layout camera behavior.

## Recommended implementation order

1. Story 1: Define the layout camera boundary
2. Story 2: Implement the layout-only camera controller
3. Story 3: Coordinate camera and transform interaction
4. Story 4: Add cardinal camera view snapping
5. Story 5: Keep camera state local to Layout
6. Story 6: Verify the full authored loop
