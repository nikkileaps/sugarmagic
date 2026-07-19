# API 002: System and Package API

## Purpose

This document describes the intended high-level module and package API boundaries for Sugarmagic.

It is for engineers who need to know:

- which major modules exist
- what each module should expose
- how modules are allowed to depend on each other
- which modules are suitable for shared runtime consumption by published targets

## Package-Level Architecture

Sugarmagic is expected to converge on a package-oriented internal architecture similar to this:

```text
/apps/studio
/targets/web
/packages/shell
/packages/productmodes
/packages/workspaces
/packages/domain
/packages/runtime-core
/packages/plugins
/packages/io
/packages/ui
/packages/testing
```

These should be treated as implementation-stable module boundaries, not just folders.

## Shell Layout Convention

The Sugarmagic shell uses a panel-based layout. Layout containers are called **Panels** — they are pure rectangular regions that do not know or care what content they hold. What goes inside each panel (mode bar, inspector, viewport, status) is determined by the consumer, not the layout.

```text
┌─────────────────────────────────────────────────┐
│                 HeaderPanel                      │
├───────────┬─────────────────────┬───────────────┤
│           │                     │               │
│ LeftPanel │    CenterPanel      │  RightPanel   │
│           │                     │  (future)     │
│           │                     │               │
├───────────┴─────────────────────┴───────────────┤
│                 BottomPanel                      │
└─────────────────────────────────────────────────┘
```

| Panel | Role | Current content |
|-------|------|----------------|
| HeaderPanel | Top strip, fixed height | App title, Game menu, ProductMode tabs |
| LeftPanel | Left column, fixed width | Workspace header, `SceneExplorer`, `Inspector` |
| CenterPanel | Main content area, fills remaining space | Viewport (Three.js canvas) |
| RightPanel | Right column (not yet active) | Reserved for future use |
| BottomPanel | Bottom strip, fixed height | Status bar |

These names are layout terms, not semantic descriptions. The `ShellFrame` component in `packages/ui` accepts `headerPanel`, `leftPanel`, `centerPanel`, and `bottomPanel` as props. Semantic names like `SceneExplorer`, `Inspector`, `Viewport`, or `ModeBar` describe what fills a panel, not the panel itself.

## Allowed Dependency Direction

At a high level:

- shell depends on ProductModes and reusable UI composition
- ProductModes depend on domain, runtime, plugin, and UI modules
- runtime depends on canonical documents and plugin capabilities
- IO depends on canonical documents and target/persistence contracts
- domain does not depend on shell UI

### Rule

The default flow is:

1. shell
2. authoring orchestration
3. domain and runtime
4. IO and target adapters

Any dependency that reverses this flow should be treated as suspicious.

## State Ownership and Store API

Sugarmagic should make one more boundary explicit at the package level.

- `zustand` is the default store technology for shell-facing and authoring-session-facing application state
- canonical authored truth remains in domain documents
- runtime session truth remains in runtime systems

In practical terms:

- stores may coordinate ProductMode activation, navigation, selection, tool sessions, panel state, and other UI-facing session state
- stores may expose view-friendly derived state
- stores must not become the canonical owner of authored region, material, landscape, environment, or gameplay-authored meaning

### Rule

Store technology belongs to the shell/orchestration layer.

It must not redefine domain ownership or replace the command/transaction boundary.

### Practical guideline

The default placement should be:

- local component state for strictly local UI behavior
- `zustand` for cross-shell and authoring-session coordination
- workspace-scoped `zustand` state for active subject coordination
- domain contracts for canonical authored truth
- runtime/session contracts for live simulation truth

## Region and Streaming API

Sugarmagic should distinguish between:

- explicit authored regions
- derived runtime streaming partitions

At the package/API level that means:

- `packages/domain` owns authored region meaning
- `packages/runtime-core` may derive finer streaming cells/chunks internally

Current authored default:

- new regions start with a `100m x 100m` default landscape footprint

That default is a starting authored ground footprint, not a hard global rule for all future regions.

## Workspace API

Sugarmagic should treat `Workspace` as a first-class application concept under `ProductMode`.

`Workspace` means:

- one active editing surface
- for one active domain subject
- with its own scoped UI composition and session state

### Rule

`Workspace` is not a competing top-level shell concept.

The hierarchy remains:

1. app
2. `ProductMode`
3. `Workspace`

## Workspace Implementation API

Sugarmagic should also distinguish between:

- `Workspace` as an architecture concept
- workspace implementation modules as the code that realizes one concrete workspace

### Recommended package home

Concrete workspace implementation logic should live in a dedicated authoring-facing home such as:

```text
/packages/workspaces/
  /build/
    /layout/
    /environment/
    /assets/
  /design/
  /render/
```

### Important rule

Workspace implementation modules are not the same thing as `ProductMode` descriptors.

They are allowed to depend on:

- shell-facing coordination contracts
- domain commands and canonical document types
- runtime-facing viewport capabilities
- shared UI components

They should not be treated as publishable runtime packages by default.

## `SceneExplorer` API

`SceneExplorer` should be treated as a reusable UI component, not as a layout term.

### Definition

`SceneExplorer` is a reusable UI component for:

- showing a tree of scene elements
- showing folders and nested scene structure
- selection and focus behavior
- lightweight management controls appropriate to the active workspace

### Rule

`SceneExplorer` is rendered inside a layout panel, but it is not itself a `Panel`.

For the initial `Build > Layout` pass, `SceneExplorer` should begin as:

- a real tree, not a flat debug list
- folder-aware from the start
- derived from canonical region/workspace structure
- synchronized with viewport selection and gizmo state

Current capabilities beyond the initial pass:

- asset rows drag onto folder rows to re-parent (dispatches
  `MovePlacedAssetToFolder`; dropping on the region root un-folders;
  no-op drops are guarded so they cannot clear the redo stack)
- folder expansion is a persisted UI preference (localStorage):
  collapsed by default, region roots expanded by default, explicit
  toggles remembered across reloads

## `/apps/studio` API

### Purpose

The Sugarmagic host app.

### Should expose

- application boot entry
- shell composition root
- shell/app-state store wiring
- ProductMode activation wiring
- dev entry points
- authoring viewport wiring
- preview lifecycle orchestration
- preview window launch and stop wiring
- asset-transform pipeline (glTF re-emit helpers)

### Should not expose as canonical APIs

- domain mutation logic
- runtime semantics
- file-format logic

`apps/studio` is a composition host.

It is also the owner of preview orchestration:

- opening the preview window
- preview boot and ready messaging
- snapshot and restore of authoring context

It should use the shared `targets/web` host path for the actual running preview.

### Renderable-lifecycle reconciler (shared)

Both hosts render placed assets through ONE reconciler
(`packages/render-web/src/renderable-reconciler.ts`, Plan 070.2): the
studio authoring viewport and the game runtime host each call
`createRenderableReconciler(config)` and drive it with
`reconcile(desiredObjects)`. It diffs the desired `SceneObject[]`
against its live set and applies add / update-in-place / remove; host
differences are injected as config (model loader, url resolver,
fallback meshes, shader runtime, grouping gate, per-entry hooks) rather
than forked code paths. Async-load safety lives here: a finished load
adopts only if that instanceId is still desired with the same
`representationKey`, and a monotonic generation (bumped on
`dispose()`) discards loads that resolve after teardown.

- **Instancing.** With `grouping: true` (the game host, and the studio
  viewport since 070.6), >= 2 instanceable objects sharing a
  `representationKey` collapse into one `THREE.InstancedMesh` group
  (`instanced-group.ts`) instead of N renderables. Members stay
  individually pickable (`instanceOrder[index]` -> instanceId) and
  editable in place (`updateInstance(index, transform)` patches one
  matrix, no rebuild). A lone instanceable object stays a singleton.
- **Grouping key is asset + surface, not folder.** `representationKey`
  (`runtime-core/src/scene/index.ts`) folds
  `effectiveMaterialSlots`, so same-surface placements share ONE
  material (the epic's draw/material win) regardless of scene folder.
  Scatter GROUPS (below) are a separate, authoring-only axis.
- **Render budget.** `reconciler.stats()` returns
  `{ singletons, groups, instances, drawUnits }` and
  `ShaderRuntime.getMaterialStats()` exposes the material cache;
  `packages/testing/src/render-budget.test.ts` asserts a fixture
  meadow stays under a draw-unit budget with no GPU (Plan 070.8).

### Scatter groups (derived) + folder visibility

`resolveScatterGroups(region)` (`@sugarmagic/domain`) DERIVES scatter
groups from brushed placements by folder identity (folderless brushed
instances fall back to a synthetic per-asset bucket) -- no persisted
entity, no migration (Plan 070.3). Its live consumer is the Scene
Explorer per-folder visibility eye: `resolveHiddenAssetInstanceIds`
takes the COMPOSED contents (base + active-Scene overlay, via
`composeRegionContents` -- NOT base `region.placedAssets`, or
scene-scoped items never hide) and the authoring viewport drops hidden
assets from the reconcile input. Ephemeral (`viewport.hiddenFolderIds`),
never persisted.

### Asset-transform pipeline

`apps/studio/src/asset-pipeline/` holds the studio's glTF re-emit
helpers -- the exceptions to "should not expose file-format logic",
exported from the package barrel because tests import them across the
package boundary:

- `bakePaintUvsIntoGlb` (`asset-pipeline/paint-uvs.ts`): bakes a
  TEXCOORD_1 paint-UV channel (xatlas) into an imported GLB.
- `correctAssetOriginToBottomCenter` (`asset-pipeline/origin-correct.ts`):
  re-pivots an imported GLB to bottom-center so a placement's gizmo sits
  on the mesh. Refuses animated GLBs (the re-emit would drop their
  clips).

Both share the load (`GLTFLoader`) -> transform -> re-emit
(`GLTFExporter`) -> `writeBlobFile` shape and are driven from the asset
library UI. A GLTFExporter round-trip does not preserve everything it is
handed (animation clips need explicit `options.animations`; the paint-UV
path additionally sanitizes normalized-float attributes WebGPU rejects),
so any new pipeline step must audit what its re-emit drops.

### Purpose

The deployable web game target shell.

### Should expose

- published web entry point
- runtime boot wiring
- target asset base configuration
- target startup hooks

### Should depend on

- `runtime-core`
- approved target-facing plugin capabilities

### Important rule

`targets/web` should be thin.

It must not become a second engine.

It also should not be treated as the owner of a shared editor-and-game visual language.

What it shares with Sugarmagic is runtime and delivery architecture, not the editor shell palette, shell chrome, or shell icon language.

It also must not depend on editor-only workspace implementation packages.

### Publish rule

The intended published target dependency graph is:

- `targets/web`
- `runtime-core`
- approved runtime-facing plugins
- published content artifacts

It must not pull in:

- `shell`
- editor-only workspace implementation modules
- editor gizmos, editor overlays, or ProductMode-specific authoring logic

## `/packages/shell` API

### Purpose

Top-level application shell and shared hosting surfaces.

### Should expose

- app frame API
- shell/app-state store contracts
- workspace host API
- viewport host API
- inspector host API
- command surface registration API
- shell navigation API
- notification/status surface API

### Should not expose

- canonical domain mutation directly
- runtime semantics directly
- canonical authored truth as store-owned state

### Typical state examples

- global selection state
- active ProductMode
- panel layout and visibility
- active tool-session coordination
- viewport tool settings (`ScatterBrushSettings` -- non-null while
  the Layout scatter brush is armed; the brush palette and jitter
  ranges are UI state, the landed instances are canonical)
- shell notifications

## `/packages/productmodes` API

### Purpose

Top-level product-context composition.

### Should expose

- ProductMode descriptors
- workspace descriptors or workspace registration contracts
- ProductMode contribution contracts
- ProductMode activation/deactivation hooks
- ProductMode-facing store selectors or bindings where useful
- ProductMode command registrations
- ProductMode inspector/panel contributions
- ProductMode viewport overlay contributions

### Important rule

ProductModes compose systems.

They do not own domain truth.

They may consume shell-facing store state, but they must not turn that store state into canonical authored meaning.

They also must not become the home for full workspace implementation logic.

`packages/productmodes` should remain primarily declarative:

- descriptors
- labels
- available workspace kinds
- registration metadata
- composition hooks

It should not become the package where Build/Layout gizmos, viewport interaction controllers, or workspace-specific editor logic permanently live.

## `/packages/workspaces` API

### Purpose

Authoring-only implementation modules for concrete workspaces.

### Should expose

- concrete workspace implementations such as `LayoutWorkspace(regionId)`
- workspace-specific interaction/session controllers
- workspace-specific editor overlays such as gizmos, origin markers, and world cursors
- workspace-specific selection-to-tool mapping
- workspace-specific inspector and panel composition helpers

### Should depend on

- `shell`
- `domain`
- `runtime-core`
- `ui`
- abstract viewport contracts supplied by the active host

### Should not expose

- publish-target entry points
- canonical runtime semantics that belong in `runtime-core`
- published target host behavior that belongs in `targets/web`

### Important rule

`packages/workspaces` is an authoring-facing layer.

It is where editor viewport tooling should live when that tooling is:

- ProductMode-specific
- workspace-specific
- not part of the published runtime

Authoring viewport composition belongs on the studio side of the boundary.

`packages/workspaces` may depend on viewport contracts and runtime-facing scene semantics, but it should not depend on a separate browser-runtime package seam.

### Viewport interaction contracts

The interaction layer (`packages/workspaces/src/interaction/`) carries
these behavioral contracts:

- **One `InputRouter` per viewport element.** Tools join the owning
  workspace's router as controllers on a stack (top controller wins);
  a tool must never attach a second router to the same element.
- **Hover rides the same stack.** Pointer motion with no active
  gesture dispatches to the top controller's `onHoverMove` (and
  `onHoverLeave` on exit); hover affordances (handle brighten,
  outlines, brush cursors) live in controllers, never in raw DOM
  listeners, so they respect controller precedence and there is
  exactly one copy of the event normalization (the router's).
- **`HitTestService` is the single enforcer of hit resolution.** It
  serves three modes (select / gizmo / surface). Select hits resolve
  to the ancestor tagged `userData.sugarmagicSceneObject`, whose node
  name is the instanceId -- hover outline, click-select, the gizmo,
  and the Scene Explorer all agree because they all resolve through
  it. Never interpret raw raycast hits in a tool.
- **Hidden objects are never hit.** Three's Raycaster intersects
  invisible objects; the service filters them. Anything toggled off
  via `.visible` (inactive gizmo mode groups, hidden overlays) cannot
  steal picks. Purely visual overlays that share the overlay root
  (the selection hover hull) are raycast-inert.
- **Transform drags are ray-based.** The pure math lives in
  `interaction/transform-math.ts` (tested in
  `packages/testing/src/transform-math.test.ts`): the pointer ray is
  projected onto the dragged axis line, rotation plane, or trackball
  plane, so objects track the cursor 1:1 at any zoom or FOV. There
  are no pixel-delta sensitivity constants. Degenerate configurations
  (axis viewed edge-on) freeze the drag instead of letting values fly.
- **Gizmo axes are WORLD axes.** The gizmo renders world-aligned and
  keeps a constant on-screen size (scaled per frame from camera
  distance); object rotation is never applied to the gizmo root.
- **One gesture = one command = one undo step.** Drags preview
  transiently and commit a single semantic command on release;
  Escape cancels and restores the drag-start values.

### Gizmo handle affordances

Handle names encode meaning: `gizmo-<mode>-<axis>` where mode is
`move | rotate | scale` and axis is `x | y | z | center`. Hovered
handles brighten; hovering a selectable object shows an orange
back-face-hull outline (the "you can click this" cue).

Center handles manipulate all axes at once, dragging on the
camera-facing plane through the object:

- **move center** (octahedron): free move -- the object follows the
  cursor in the camera plane.
- **scale center** (cube): uniform scale on all three axes, by ratio
  of grab-point distance from center.
- **rotate center** (faint trackball sphere inside the rings): free
  rotate -- drag direction spins around the perpendicular in-plane
  axis, composed as a world-space rotation.

Pick priority: the small move/scale center handles win over axis
handles sharing the same ray (otherwise a camera looking straight
down an axis hands the click to an edge-on handle that cannot drag).
The rotate trackball is the coarse target and loses to the thin
rings. Enforced in `HitTestService`; regression-tested in
`packages/testing/src/hit-test-service.test.ts`.

## `/packages/domain` API

### Purpose

Canonical authored documents and domain invariants.

### Should expose

- canonical document types and references
- validation contracts
- semantic command types
- transaction contracts
- history contracts
- domain-level query services
- migration and version contracts for canonical payloads

### Should not expose

- shell UI details
- `zustand` store shapes as domain contracts
- live renderer object types
- browser-only primitives as domain requirements

## `/packages/runtime-core` API

### Purpose

Shared runtime semantics used by authoring preview, playtest, and published targets.

### Should expose

- runtime boot and teardown API
- scene and region loading API
- runtime session API
- ECS gameplay-foundation API
- `World` and `System` contracts or equivalent runtime gameplay kernel boundaries
- player spawn / movement / follow-camera runtime services
- material semantics and compile-profile API
- landscape runtime API
- environment runtime API
- VFX runtime API
- plugin runtime hook API
- authoritative coordination APIs for applying accepted deltas

### Important rule

This is the primary shared runtime boundary that both Sugarmagic and published targets should be able to consume.

Runtime session state may be surfaced to stores or views through adapters, but the store is not the owner of that truth.

It must not absorb editor gizmo logic, ProductMode-specific workspace controllers, or editor-only overlay behavior as runtime semantics.

For the first preview/playtest migration slices, `runtime-core` should be the home of the minimal gameplay foundation ported from Sugarengine’s ECS model.

That means preview should become runtime-real by growing `runtime-core`, not by adding shell-local preview behavior in `apps/studio` or `packages/workspaces`.

## `/targets/web` and studio host split

The web host boundary needs one explicit rule because earlier drafts were too soft here.

### `targets/web` owns

- the published web entry point
- web runtime host creation around `runtime-core`
- target-safe boot wiring
- target asset-base integration
- host lifecycle for the running web game

### `targets/web` must not own

- preview window lifecycle
- `window.open(...)`
- opener/child window messaging
- authoring snapshot and restore
- editor-only viewport overlays
- editor workspace interaction behavior

### `apps/studio` owns

- preview launch and stop
- preview ready/boot handshake
- authoring viewport composition
- authoring camera and overlay behavior
- authoring snapshot and restore

### Important rule

Preview should boot through the same `targets/web` host path intended for published web targets.

That does not make preview orchestration a web-target concern.

## `/packages/plugins` API

### Purpose

Plugin capability model and plugin-host integration.

### Should expose

- plugin manifest contract
- capability registration contract
- plugin lifecycle hooks
- plugin command contribution contract
- plugin shell contribution contract
- plugin runtime contribution contract

### Important rule

Plugins extend through declared capability boundaries.

They must not introduce hidden side channels.

## `/packages/io` API

### Purpose

Game-root, persistence, import, export, and publish boundaries.

### Should expose

- game-root discovery API
- canonical document load/save API
- import/indexing API
- export API for compatibility outputs
- publish API for target artifacts
- schema and migration APIs

For the initial authored-loop milestone, these boundaries should support a browser-first implementation using the File System Access API for canonical project read/write.

If OPFS is used, it should be limited to caches, sidecars, or other non-canonical persistence roles.

### Important rule

IO is responsible for moving data across boundaries.

It is not the owner of domain meaning.

## `/packages/ui` API

### Purpose

Reusable components and view-layer building blocks for Sugarmagic-owned shell and editor surfaces.

### Should expose

- Mantine-backed reusable shell and layout components
- reusable components
- inspector components
- graph and tree view components
- shell-usable panels
- design tokens and styling primitives
- shared icon wrappers and icon usage contracts
- shared theme integration for Sugarengine-derived shell palette tokens

For the current foundation, this package should be understood primarily as the home for editor and shell-facing UI primitives.

### State guidance

UI components should prefer local component state for purely local presentation behavior.

If a component needs shared shell/application state, it should consume that through shell/orchestration store contracts rather than inventing a second ownership path.

### Should not expose

- domain ownership
- direct mutation of canonical documents
- arbitrary published-game UI look-and-feel as if every game should inherit the editor shell design system

## `/packages/testing` API

### Purpose

Shared harnesses and test fixtures.

### Should expose

- canonical fixture loaders
- game-root fixture helpers
- runtime harness API
- publish harness API
- plugin test harness APIs

## Shared Runtime Consumption Contract

The most important package-level contract is this:

- `runtime-core` defines shared runtime semantics
- `targets/web` defines the published web host around `runtime-core`
- `apps/studio` uses the same `runtime-core` plus `targets/web` host path for preview, while keeping preview lifecycle ownership for itself

That means engineers should treat these packages as:

- stable runtime boundaries
- not random internal grab-bags

## Builds On

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 007: Execution and Concurrency Model](/Users/nikki/projects/sugarmagic/docs/adr/007-execution-and-concurrency-model.md)
- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
