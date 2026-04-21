# Plan 033: Unified Viewport State Subscription Epic

**Status:** Implemented
**Date:** 2026-04-20

## Epic

### Title

Replace the authoring viewport's multiple imperative update entry
points with a single subscribe-to-store data-flow model. The viewport
becomes a reactive consumer of canonical state (zustand stores) rather
than an imperative target of parallel UI commands. UI components fire
actions; the store updates; the viewport observes and reacts — exactly
once, with full context, every time.

### Goal

Three product outcomes:

1. **The authoring viewport renders the correct result on the
   first try, not the second.** The class of bug where two
   imperative updates fire in the same tick, one with partial
   context, and the partial one clobbers the complete one, stops
   existing. The editor viewport is a pure function of canonical
   store state.
2. **The editor UI stops knowing anything about the viewport.** UI
   components fire actions on the project/shell/viewport store. They
   don't reach through a `useRef` into the viewport and imperatively
   mutate it. "Landscape changed" becomes a store mutation, full stop —
   the fact that a viewport exists at all is the viewport's business,
   not the landscape workspace's.
3. **Transient authoring overlays become a first-class citizen of
   the store.** Live drafts for a landscape edit, a transform drag,
   or a material-picker hover all have the same shape: a
   draft-overlay in the store that the viewport merges with
   committed truth. No side-channel imperative methods.

This is about the in-editor authoring viewport only. The launched
Preview window — which the author opens explicitly to play the
game — is out of scope and is addressed separately; see Out-of-scope.

Two architectural outcomes:

- **One update path.** The viewport subscribes to one selector and
  re-applies from the selector's output. No parallel
  `updateFromRegion` / `previewLandscape` / `paintLandscapeAt` /
  `previewTransform` surface area. The viewport interface shrinks to
  DOM-lifecycle only (`mount` / `unmount` / `resize` / `render` /
  `subscribeFrame`) plus store wiring.
- **Extends ADR 001's "Single Runtime Authoring Rule" to state
  flow.** ADR 001 says there is one runtime path for rendering
  authored content; Epic 033 says there is one update path for
  authored content reaching that runtime. Both apply the same
  principle: eliminate parallel code paths that can drift.

### Why this epic exists

The working session on 2026-04-20 spent hours chasing a single bug:
the editor viewport showed a landscape channel as flat green after
the author bound it to "Wordlark Brick", even though the authored
session state was correct. Instrumentation revealed the actual
failure:

1. React useEffect fires `updateFromRegion(fullState)` with
   `contentLibrary` → landscape rebuilds with the material ✓
2. Something else — the landscape workspace's live-preview pipeline
   — fires `previewLandscape(landscape)` with no `contentLibrary` →
   landscape rebuilds with *flat color fallback*, clobbering the good
   material ✗

Neither call was wrong in isolation. The bug was that *both existed*
and neither could see the other's state. The fix was a one-liner at
the `previewLandscape` call site, but the bug class is architectural:
the `WorkspaceViewport` interface has **four separate imperative
update entry points** (`updateFromRegion`, `previewLandscape`,
`paintLandscapeAt`, `previewTransform`), each callable with partial
context, each capable of overwriting the others. Other recent
incidents with the same root cause inside the editor viewport:

- Asset-sources blob URL churn (a parallel useEffect triggering a
  full re-apply that stomped in-flight loads).
- GLB texture binding staleness inside the editor viewport (an
  imperative GLB-load callback racing the mount-init completion).
- Scene-wide material cache invalidation (required threading a
  callback through the resolver because no store signal existed).
- Lighting divergence between back-to-back authoring updates
  (different one-shot apply sequences inside the same editor
  viewport, each holding stale assumptions).

Every one of these is a symptom of the same pattern: **parallel
imperative entry points into a single long-lived rendering engine
that has no authoritative "here is the full truth right now" source
to reconcile against.**

The pattern we want is the one the rest of the codebase is already
using: zustand stores as canonical truth, observers (React components
today, the viewport tomorrow) subscribing to slices. The project
already ships three zustand vanilla stores
(`projectStore`, `shellStore`, `previewStore`). React's UI
components are correctly wired through `useStore(store, selector)`.
The viewport is the last consumer still driven imperatively — and
it's the consumer where parallel mutations are most likely to
conflict because it's the one that holds render-pipeline state across
many frames.

### Core thesis

**The editor viewport is an observer, not a target.** It mounts
itself to a DOM element, subscribes to a projection of canonical
state, and re-applies whenever that projection changes. Nothing else
calls into it, ever. UI components that need to change what the
viewport shows fire actions on the store; the viewport sees the
result on its own subscription.

Mapping to patterns:

- **Unidirectional data flow** (Flux / Redux / classic zustand):
  actions → store → subscribers → render. The viewport is a
  subscriber that happens to render to a WebGPU canvas instead of to
  the DOM.
- **Observer pattern** (GoF): the store is Subject, the viewport is
  one Observer. UI components are Observers too (via React), but they
  are *separate* observers of the same Subject, not a middleman
  between the user and the viewport.
- **ECS parallel**: Sugarmagic's runtime-core ECS (World/System/
  entities, ADR 001) already works this way at runtime — systems
  read component state and write their outputs each tick; nothing
  imperatively "updates" a system mid-frame. Epic 033 pulls the same
  shape up to the authoring layer.

## Scope

### Stores introduced by this epic

Three new shell-level zustand stores, alongside existing
`projectStore` / `shellStore` / `previewStore`. Each has one
canonical owner and one concern — no field on any new store is a
mirror of a field on another store. Ownership is decided here, up
front, so no later story invents a state island as a side effect:

| Store | Owns | Does not own | Introduced in |
|---|---|---|---|
| `viewportStore` | Transient authoring drafts that commit into authored truth: `landscapeDraft`, `transformDrafts`, `activeToolCursor`, `brushSettings`. | Canonical selection (shellStore), preview-mode UI state (designPreviewStore), asset URLs (assetSourceStore). | Story 33.1 |
| `assetSourceStore` | The derived `Record<relativeAssetPath, blobUrl>` map, plus its blob-URL lifecycle (`start(handle, projectStore)` / `stop()`, stable-fingerprint regeneration, revoke-on-replace). | Authored truth (projectStore), runtime-texture state (remains in render-web). | Story 33.1 |
| `designPreviewStore` | Preview-mode UI state for Player/NPC/Item workspaces: `activeDefinitionId`, `activeAnimationSlot`, `isAnimationPlaying`, orbit `cameraFraming`. Scoped to one previewed definition at a time; cleared on workspace change. | Authored truth, build-viewport draft state, canonical selection. | Story 33.7 |

**Player/NPC/Item preview-only state (`activeAnimationSlot`,
`isAnimationPlaying`, orbit camera framing) is owned by
`designPreviewStore` — decided up front, not deferred into Story
33.7.** It is not extended onto `shellStore` (which holds
cross-workspace UI state, not kind-scoped preview config); it is
not folded into `viewportStore` (whose invariant is "transient
drafts that commit into authored truth" — preview config never
commits); it is not left React-local (which would recreate the
parallel-update-path this epic exists to eliminate). Full rationale
and contract in the "Design-preview state ownership" section.

### In scope

- **ViewportStore.** A zustand vanilla store that holds
  *transient* authoring overlays the viewport observes: landscape
  draft, transform drafts, paint stroke cursor, and brush settings.
  The projection selector combines this with active-region and
  content-library from projectStore, environment override and
  canonical selection from shellStore, and the derived asset-source
  map from assetSourceStore. The projection — not any single store
  — is the truth the viewport reads.

- **Dedicated `assetSourceStore` owning the blob-URL map.** Asset
  sources (`Record<relativeAssetPath, blobUrl>`) are **derived
  state**: produced from the project's `FileSystemDirectoryHandle`
  plus the current `ContentLibrarySnapshot.{assetDefinitions,
  textureDefinitions}`. They are NOT authored truth (projectStore's
  concern) and they are NOT transient viewport overlays
  (viewportStore's concern). They also have their own lifecycle
  (blob-URL revocation, stable-fingerprint regeneration) that
  doesn't belong next to session-mutation actions. They get their
  own store, same shell level as projectStore / shellStore /
  previewStore / viewportStore. See *Architecture rework → Asset
  source ownership* below for the full contract.
- **Dedicated `designPreviewStore` owning Player/NPC/Item
  preview-mode UI state.** `activeDefinitionId`,
  `activeAnimationSlot`, `isAnimationPlaying`, and orbit
  `cameraFraming` become first-class store fields, replacing the
  React-local useState they live in today
  (`PlayerWorkspaceView.tsx:87`, `NPCWorkspaceView.tsx:124`, and the
  equivalent in `ItemWorkspaceView`). Scoped to one active
  definition; `beginPreview(id)` / `endPreview()` bracket the
  lifecycle. Full contract in *Architecture rework →
  Design-preview state ownership*.
- **Viewport subscription lifecycle.** The viewport's `mount()` call
  attaches a store subscription; `unmount()` detaches it. Between
  those, the viewport receives every store change and runs one
  `applyProjection(projection)` method. No other public method
  mutates render state.
- **Transient-state modeling.** Live preview of landscape edits,
  transform drags, material-picker hover, etc. all land in the store
  as explicit transient fields (e.g.
  `viewport.draft.landscape`,
  `viewport.draft.transforms: Record<instanceId, transform>`). UI
  components dispatch actions to update drafts; commit converts a
  draft into a `applyCommand(session, …)` domain command and clears
  the draft. The viewport's projection merges draft-over-committed
  when rendering.
- **Action surface for authoring interactions.** `previewLandscape`,
  `paintLandscapeAt`, `previewTransform` become store actions:
  `setLandscapeDraft(landscape)`, `paintLandscape(stroke)` (domain
  command), `setTransformDraft(instanceId, transform)`,
  `commitTransformDraft(instanceId)`. Every mutation the UI performs
  is an action on the store.
- **Migration of the four workspace viewports.** Build (authoring)
  first — it has the most parallel entry points and the worst bugs.
  Then Player/NPC/Item. These have only one imperative entry point
  each (`updateFromPlayer` / `updateFromNPC` / `updateFromItem`),
  but their React components currently hold non-trivial preview
  state locally (`activeAnimationSlot`, `isAnimationPlaying`,
  orbit-camera quaternion) that has no store owner today. Story
  33.7 introduces a dedicated `designPreviewStore` to own this
  state — it is NOT a "trivial" migration; it's a "one entry point
  per kind, plus establishing a new store" migration. See the Store
  shape section and Story 33.7 for the explicit ownership split.

### Out of scope

- **The launched Preview window.** Preview is a separate,
  intentionally-launched playback of the game. It receives a
  one-shot snapshot of the session at launch and does not need —
  and deliberately does *not* receive — continuous sync with
  in-editor authoring changes. Editor ↔ Preview live parity is a
  different problem with different tradeoffs (postMessage
  boundaries, preview-window lifecycle, async asset-source
  arrival), and if it's ever wanted it gets its own epic. Epic 033
  is strictly about the *in-editor authoring viewport's* state
  flow.
- **Rewriting the rendering pipeline inside the viewport.** The work
  is *how the viewport receives its inputs*, not *what it does with
  them*. `WebRenderHost`, `ShaderRuntime`, `AuthoredAssetResolver`,
  landscape mesh, material apply — all unchanged.
- **Replacing React.** The UI layer stays React + zustand. The
  change is that the viewport bypasses the React component tree and
  subscribes directly, alongside React, not through it.
- **Changing the ECS in runtime-core.** Gameplay ECS (World/System)
  is orthogonal and already conforms to "one update path, one
  tick." This epic deals with authoring-layer state flow.
- **Redux or other state library.** zustand is in, it's appropriate,
  and swapping libraries is pure churn.
- **A universal "refresh everything" button.** The point of this
  refactor is that such a button isn't needed — state flow IS the
  refresh mechanism. If a specific bug demands it later, it's a
  one-liner action; we don't spec it upfront.

## Architecture rework

### Current state (today)

```
┌────────────────┐     session mutation     ┌──────────────┐
│  UI component  │───── applyCommand ──────→│ projectStore │
│ (React)        │                          │   (zustand)  │
└───────┬────────┘                          └──────┬───────┘
        │                                          │
        │    useStore subscribes                   │
        │←─────────────────────────────────────────┘
        │
        │  React re-renders
        ▼
┌────────────────┐   useEffect dep change   ┌───────────────────┐
│  App.tsx       │─── viewportRef.current───→│ Viewport          │
│  useEffect     │    .updateFromRegion({…}) │ (imperative mut.) │
└────────────────┘                           └───────────────────┘
            ▲                                         ▲
            │                                         │
  UI sometimes calls these DIRECTLY                   │
  bypassing React's dep tracking                      │
            │                                         │
  LandscapeWorkspace.previewLandscape(landscape)──────┤
  LandscapeWorkspace.paintLandscapeAt({…})────────────┤
  LayoutWorkspace.previewTransform(id, pos, …)────────┘
```

Four imperative entry points reach the viewport. React useEffect
drives the `updateFromRegion` path; the other three are called from
workspace views directly on the viewport ref, with *partial context*
(no content library, no asset sources, no environment id). When
any two fire in the same React tick in the wrong order, the partial
call clobbers the full one.

### Target state (this epic)

```
┌────────────────┐  action (setLandscapeDraft, commitPaint, etc.) ┌────────────┐
│  UI component  │──────────────────────────────────────────────→│ projectStore │
│  (React)       │                                                │ shellStore  │
└────────────────┘                                                │ viewportStore│
       │                                                          └──────┬──────┘
       │                                                                 │
       │  useStore subscribes for UI render                               │
       │←────────────────────────────────────────────────────────────────│
       │                                                                 │
                                                                          │
┌───────────────────┐                                                     │
│ Viewport          │  store.subscribe(projectionSelector, apply)         │
│ (DOM-lifecycle    │←────────────────────────────────────────────────────┘
│  + subscription   │
│  to projection)   │
└───────────────────┘
       │
       │ applyProjection(p) — the ONLY mutation path
       ▼
┌────────────────────┐
│ WebRenderHost etc. │
└────────────────────┘
```

The viewport interface reduces to:

```ts
export interface WorkspaceViewport {
  // DOM lifecycle (unchanged)
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  mount(container: HTMLElement): void;
  unmount(): void;
  resize(width: number, height: number): void;
  render(): void;
  subscribeFrame(listener: () => void): () => void;
  setProjectionMode(mode: "perspective" | "orthographic-top"): void;
}
```

Everything else — `updateFromRegion`, `previewLandscape`,
`paintLandscapeAt`, `previewTransform`, `renderLandscapeMask`,
`serializeLandscapePaintPayload`, surface/authored/overlay `Group`
accessors — is either:
- moved to store actions + subscription (state changes), or
- moved to a dedicated service module the workspace UI talks to
  directly (pure queries like `renderLandscapeMask` that produce a
  canvas on demand), or
- moved *into* the viewport as an overlay subscriber (for
  scene-graph objects like gizmos, brush cursors, and selection
  highlights — see "Overlay ownership" below).

### Store shape

One new zustand vanilla store, `viewportStore`, co-located with the
existing shell stores in `packages/shell/src/viewport/index.ts`:

```ts
export interface ViewportState {
  // Transient authoring overlays — cleared on commit.
  landscapeDraft: RegionLandscapeState | null;
  transformDrafts: Record<string, {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }>;
  // UI hints (viewport-local, not authored truth).
  activeToolCursor: LandscapeCursor | null;
}

export interface ViewportActions {
  setLandscapeDraft(landscape: RegionLandscapeState | null): void;
  clearLandscapeDraft(): void;
  setTransformDraft(instanceId: string, transform): void;
  clearTransformDraft(instanceId: string): void;
  setActiveToolCursor(cursor: LandscapeCursor | null): void;
}
```

**On selection:** there is no `selectionHighlight` in viewportStore.
Canonical selection already lives on `shellStore.selection`; the
selection-highlight overlay subscriber reads directly from there.
Duplicating it into viewportStore would create two authorities for
the same concept and force a sync action whose only job is to copy
one slice into another.

If a future feature needs viewport-only selection variants (hover
preview before click-commit, marquee-drag ghost), those are
genuinely distinct from committed selection and should land as
their own named slices — e.g. `hoverHighlightIds` or
`marqueeSelectionPreview` — not as overloads of the same field.

`projectStore` (existing, unchanged) remains the source of
**committed** authoring truth. `viewportStore` holds
**uncommitted/transient** viewport state that the UI manipulates
during an interaction and either commits (via a domain action on
projectStore) or discards.

The viewport subscribes to a derived projection combining
projectStore + shellStore + viewportStore + assetSourceStore:

```ts
function selectViewportProjection(
  p: ProjectState,
  s: ShellState,
  v: ViewportState,
  a: AssetSourceState
): ViewportProjection {
  return {
    region: getActiveRegion(p.session),                           // committed
    contentLibrary: p.session?.contentLibrary ?? null,            // committed
    assetSources: a.sources,                                      // derived (file handle × content library)
    environmentOverrideId: s.activeEnvironmentId,                 // UI-chosen
    selection: s.selection,                                       // canonical (shellStore)
    landscapeOverride: v.landscapeDraft,                          // transient
    transformOverrides: v.transformDrafts,                        // transient
    cursor: v.activeToolCursor                                    // transient
  };
}
```

The viewport's `applyProjection(projection)` is the single entry
point that reconciles all of these into scene state.

### Asset source ownership

Derived state gets its own store. `assetSources` sits alongside
projectStore / shellStore / viewportStore / previewStore in
`packages/shell/src/asset-sources/`. The rationale is a clean
three-way ownership split:

- **projectStore** owns *canonical authored truth* (handle,
  descriptor, session). Its actions mutate persisted state via
  `applyCommand`.
- **assetSourceStore** owns *derived platform bridges* — turning
  authored content-library references into runtime-fetchable URLs.
  Its actions react to projectStore changes but produce no authored
  truth; their only output is a `Record<relativeAssetPath, string>`
  that changes identity exactly when the asset path set changes
  (blob-URL churn on content-library edits that don't touch paths
  is exactly the bug the current `useAssetSources` fingerprint
  fixes).
- **viewportStore** owns *transient authoring overlays* —
  uncommitted drafts and UI hints that will either commit into the
  project or be discarded.

### `assetSourceStore` contract

```ts
// packages/shell/src/asset-sources/index.ts
import { createStore } from "zustand/vanilla";

export interface AssetSourceState {
  sources: Record<string, string>;
  syncCount: number;
}

export interface AssetSourceActions {
  /**
   * Lifecycle handoff. Called when a project becomes active
   * (projectStore.phase === "active"). Takes ownership of the
   * FileSystemDirectoryHandle for reads and the content library for
   * path discovery. Subscribes to projectStore under the hood for
   * incremental refresh — the caller does NOT have to manually
   * resync on session mutations.
   */
  start(
    handle: FileSystemDirectoryHandle,
    projectStore: ProjectStore
  ): void;

  /**
   * Stop watching, revoke every minted blob URL, reset `sources` to
   * `{}`. Called when the project closes / reopens.
   */
  stop(): void;
}

export type AssetSourceStore = ReturnType<typeof createAssetSourceStore>;

export function createAssetSourceStore(): AssetSourceStore { /* … */ }
```

Implementation mirrors the current `useAssetSources` hook:

- **Stable-fingerprint regeneration.** The store subscribes to
  projectStore and recomputes sources ONLY when the union
  `assetDefinitions.source.relativeAssetPath +
  textureDefinitions.source.relativeAssetPath` identity changes.
  Unrelated session mutations (shader edits, transform tweaks,
  environment edits) don't churn the map.
- **Blob URL lifecycle.** Each regeneration mints a fresh map and
  revokes superseded entries. Disposed asset-paths have their URLs
  revoked. `stop()` revokes everything.
- **Async readiness.** Reads are async; the store emits the new
  map once reads complete. Between request and completion, the
  previous map stays live so in-flight GLTFLoader / image fetches
  keep working (same guarantee the current hook provides).

### Why not put assetSources on projectStore directly

Because it mixes canonical authored state with derived runtime state,
which was the mistake that led to the `assetSources` blob-URL churn
bug on this branch. projectStore's shape is authored truth only. Any
"combine authored + derived" concern becomes someone else's problem —
in this case, the projection selector's.

### Why not a plain module-level service

A module-level `createAssetSourceService()` returning `{ sources,
subscribe, start, stop }` is a legitimate shape and would work.
Using a zustand store instead picks up two bonuses for free:

1. **Same subscription protocol as every other shell store.** The
   viewport's `subscribeToProjection` combines stores uniformly; no
   special adapter for asset sources.
2. **DevTools / debugging uniformity.** If the shell later adopts
   zustand's `devtools` middleware or builds an internal store
   inspector, the asset-source store shows up alongside everything
   else.

A future refactor could collapse this back into a service if the
store shape stays trivially one-field. Not worth forking the pattern
now.

### Design-preview state ownership

Player, NPC, and Item workspaces each render a preview of a single
authored definition. Their React views today hold three pieces of
state that have no store owner:

- `activeAnimationSlot: string | null` — which of the definition's
  bound animation slots the preview is playing.
- `isAnimationPlaying: boolean` — play/pause.
- Orbit camera framing — currently a `cameraQuaternion` useState in
  `PlayerWorkspaceView.tsx:87` and similar in `NPCWorkspaceView.tsx`
  / `ItemWorkspaceView.tsx`.

None of this is authored truth (it doesn't commit back into the
project). None of it is a transient-then-committed authoring draft
(unlike paint strokes or transform drags). And it isn't
cross-workspace UI state like selection or environment override
either. It's *preview-mode configuration* for whichever design
workspace is currently active.

That's a distinct concern, so it gets its own store:
`designPreviewStore` in `packages/shell/src/design-preview/index.ts`.

```ts
// packages/shell/src/design-preview/index.ts

export interface DesignPreviewState {
  /**
   * The authored definition currently being previewed. Null when
   * no design workspace is active. Changing this clears the
   * animation slot, play state, and camera framing — preview state
   * is scoped to one definition at a time.
   */
  activeDefinitionId: string | null;

  activeAnimationSlot: string | null;
  isAnimationPlaying: boolean;

  /**
   * Orbit camera state for the preview viewport. Stored as a
   * quaternion + orbit distance so the projection can fully
   * reconstruct camera pose without the viewport holding an
   * imperative camera controller.
   */
  cameraFraming: {
    quaternion: [number, number, number, number];
    orbitDistance: number;
    target: [number, number, number];
  } | null;
}

export interface DesignPreviewActions {
  /**
   * Called when a design workspace mounts a definition. Resets all
   * preview state and sets the active id. Idempotent on the same id.
   */
  beginPreview(definitionId: string): void;

  /** Called when the workspace unmounts or switches definitions. */
  endPreview(): void;

  setAnimationSlot(slot: string | null): void;
  setAnimationPlaying(playing: boolean): void;
  setCameraFraming(framing: DesignPreviewState["cameraFraming"]): void;
}
```

**Why not shellStore:** `shellStore` holds cross-workspace UI state
(selection, active tool, environment override). Animation playback
and orbit-camera framing are design-workspace-only concerns, and
they're scoped to the active definition rather than to the
application as a whole. Folding them into shellStore would widen
its shape without unifying its semantics.

**Why not extend `viewportStore`:** viewportStore holds *transient
drafts that commit into authored truth* (landscape paint, transform
drag). Design-preview state never commits — it's display
configuration. Keeping the two stores separate keeps the
"transient authoring draft" invariant tight: every field on
viewportStore has a commit/discard lifecycle; every field on
designPreviewStore is ephemeral UI selection that's thrown away on
workspace change.

**Why not keep it React-local:** because the viewport would then
need a React-side bridge to observe it — exactly the parallel
update path Epic 033 exists to eliminate. React components can
still `useStore(designPreviewStore, selector)` for their own
rendering; the viewport subscribes via the same projection helper
as every other store.

### Design-preview projection selectors

Unlike the build authoring viewport, the design viewports are per-
kind and don't share the same projection shape. Each gets its own
selector:

```ts
// packages/shell/src/design-preview/projection.ts

export function selectPlayerPreviewProjection(
  p: ProjectState,
  s: ShellState,
  d: DesignPreviewState,
  a: AssetSourceState
): PlayerPreviewProjection {
  return {
    playerDefinition: getPlayerDefinition(p.session, d.activeDefinitionId),
    assetSources: a.sources,
    animationSlot: d.activeAnimationSlot,
    isAnimationPlaying: d.isAnimationPlaying,
    cameraFraming: d.cameraFraming,
    environmentOverrideId: s.activeEnvironmentId
  };
}
// selectNpcPreviewProjection and selectItemPreviewProjection are
// the same shape with their respective definition lookups.
```

Each design viewport subscribes to its own projection via the same
`subscribeToProjection` helper the build viewport uses. The
React workspace views (`PlayerWorkspaceView`, etc.) read slice
values via `useStore(designPreviewStore, selector)` and dispatch
actions on user input. No React-local useState for preview config,
no `getViewport()` escape hatches, no imperative `updateFromPlayer`
call.

### Overlay ownership

The current `WorkspaceViewport` interface exposes three `Object3D`
accessors — `authoredRoot`, `overlayRoot`, `surfaceRoot` — and the
Build workspaces reach in and attach their own controllers to them:

- `LayoutWorkspaceView` attaches a transform-gizmo controller to
  `authoredRoot` + `overlayRoot`
  (`packages/workspaces/src/build/layout/LayoutWorkspaceView.tsx:305`).
- `LandscapeWorkspaceView` attaches a brush-cursor mesh, a hit-test
  service, and an input router to all three roots
  (`packages/workspaces/src/build/landscape/index.tsx:372` via the
  `attach(el, camera, authoredRoot, overlayRoot, surfaceRoot)`
  contract at `landscape-workspace.ts:43`).

Shrinking the viewport interface (Story 33.8) without relocating
these callers would leave them orphaned. The question is where they
go.

**They do not go into the store.** A `THREE.Object3D` is a mutable,
graph-shaped handle with parent pointers, world-matrix caches, and
GPU bindings. Putting one in a zustand store breaks the store's
core contract (every read is a snapshot of declarative truth) and
reintroduces exactly the parallel-mutation problem Epic 033 exists
to eliminate.

**They go into the viewport itself, as overlay subscribers.** Each
current workspace-side controller gets decomposed into two halves:

1. Its **state** — selection ids, draft transforms, active tool,
   cursor position, brush settings — moves into the appropriate
   store (projectStore / shellStore / viewportStore) with store
   actions for mutation. This is the half Stories 33.1–33.3 already
   cover.
2. Its **scene-graph presence** — the gizmo meshes, the brush ring,
   the selection outlines, the mesh attachment itself — moves into
   a viewport-private overlay subscriber. Each overlay subscriber
   is a module inside `apps/studio/src/viewport/overlays/` that
   lives for the viewport's lifetime, reads the same projection
   selector the main viewport does (or a narrower slice of it via
   `subscribeWithSelector`), and owns its own `THREE.Group` under
   the viewport's private overlayRoot. It mounts/updates/unmounts
   scene objects in response to projection changes and dispatches
   store actions on pointer interaction.

The shape of an overlay subscriber:

```ts
// apps/studio/src/viewport/overlays/transform-gizmo.ts
export function mountTransformGizmoOverlay(
  ctx: ViewportOverlayContext
): () => void {
  const group = new THREE.Group();
  ctx.overlayRoot.add(group);

  // Pointer handlers call store actions directly:
  //   shellStore.getState().setSelection(ids)
  //   viewportStore.getState().setTransformDraft(id, next)
  //   applyCommand(...) on drop
  installPointerHandlers(ctx.domElement, ctx.camera, group);

  const unsub = subscribeToProjection(
    ctx.stores,
    selectGizmoSlice,                 // narrower than the full projection
    (slice) => updateGizmoGroup(group, slice, ctx.camera),
    { equalityFn: shallowEqual }
  );

  return () => {
    unsub();
    disposePointerHandlers(ctx.domElement);
    ctx.overlayRoot.remove(group);
    disposeGroup(group);
  };
}
```

The viewport's `mount()` method instantiates every registered
overlay subscriber during setup and holds their teardown functions
for `unmount()`. Workspaces never touch the scene graph.

### Replacing `authoredRoot` / `overlayRoot` / `surfaceRoot`: two layers, not one

Before Story 33.8 deletes the three `Object3D` accessors, there
must be a defined replacement. The replacement is a **two-layer**
split rather than one shared API:

**Public layer (`WorkspaceViewport` interface — what workspaces
see):** DOM lifecycle only. No scene-graph access. Post-33.8:
`mount` / `unmount` / `resize` / `render` / `subscribeFrame` /
`setProjectionMode`. That's it. Workspaces cannot obtain a
scene-graph handle from the viewport under any circumstances.

**Internal layer (`ViewportOverlayContext` — what overlay
subscribers see):** a concrete scene-access contract passed to
overlays at registration time. It IS the "small viewport scene-
access API" — just scoped to code that lives inside
`apps/studio/src/viewport/overlays/` rather than exposed on the
public interface. The type:

```ts
// apps/studio/src/viewport/overlay-context.ts

export interface ViewportOverlayContext {
  // Scene-graph mount points — typed groups with fixed semantics.
  // Overlays add children; they never reparent the roots themselves.
  readonly overlayRoot: THREE.Group;   // transient visuals in viewport space
  readonly authoredRoot: THREE.Group;  // world-space attachment (gizmo targets)
  readonly surfaceRoot: THREE.Group;   // landscape + ground-plane attachment

  // Camera + DOM — for raycasting, pointer handlers, cursor reads.
  readonly camera: THREE.Camera;
  readonly domElement: HTMLElement;

  // Store handles the overlay may subscribe to (pre-bundled).
  readonly stores: {
    projectStore: ProjectStore;
    shellStore: ShellStore;
    viewportStore: ViewportStore;
    assetSourceStore: AssetSourceStore;
    designPreviewStore: DesignPreviewStore;
  };

  // Bound helper — the overlay calls this instead of wiring its
  // own multi-store subscription by hand.
  subscribeToProjection<T>(
    selector: (state: StoreBundleState) => T,
    listener: (next: T) => void,
    opts?: { equalityFn?: (a: T, b: T) => boolean }
  ): () => void;

  // Render-loop tick for overlays that need per-frame updates
  // (gizmo billboard scaling against camera distance, etc).
  subscribeFrame(listener: () => void): () => void;
}

/** Factory signature for every overlay in `overlays/`. */
export type ViewportOverlayFactory =
  (ctx: ViewportOverlayContext) => /* teardown */ () => void;
```

**Registration is constructor-time, not runtime.** The authoring
viewport factory takes its overlay list as a parameter; overlays
are not registered dynamically by workspaces:

```ts
// apps/studio/src/viewport/authoringViewport.ts
export function createAuthoringViewport(opts: {
  overlays: ViewportOverlayFactory[];
  // ...other options
}): WorkspaceViewport {
  // ...
  function mount(container: HTMLElement) {
    // ...standard mount work...
    const ctx = buildOverlayContext(/* internal refs */);
    teardowns = opts.overlays.map((factory) => factory(ctx));
  }
  function unmount() {
    teardowns.forEach((t) => t());
    teardowns = [];
    // ...standard unmount work...
  }
  // Public interface: mount/unmount/resize/render/subscribeFrame/
  // setProjectionMode ONLY. Never returns ctx.
}
```

The concrete overlay list for the authoring viewport, resolved at
the `createAuthoringViewport` call site in `App.tsx`:

```ts
createAuthoringViewport({
  overlays: [
    mountLandscapeMeshAttachmentOverlay,
    mountTransformGizmoOverlay,
    mountLandscapePaintCursorOverlay,
    mountLandscapeHitTestOverlay,
    mountSelectionHighlightOverlay
  ]
});
```

Design viewports (player / npc / item) take their own overlay
lists — at minimum the orbit-camera overlay from Story 33.7, and
nothing else unless a later feature adds one.

### Why not "dedicated shared services" for Layout / Landscape interaction

An alternative the engineer raised: keep the interaction logic in
a shared package like `packages/interaction/landscape-paint/` and
have the viewport expose a narrow `getSceneSlots()` or equivalent
so the shared service can attach. Rejected for three reasons:

1. **It preserves the scene-graph leak in a different shape.** A
   shared service that takes `{ overlayRoot, authoredRoot }` as
   arguments still couples to viewport internals; anyone who
   needs to construct the service (including tests) has to
   synthesize scene-graph handles. The point of 33.8 is that only
   viewport-internal code ever sees those handles.
2. **Interaction logic is not currently reused across viewports.**
   The landscape paint cursor is authoring-only; the transform
   gizmo is authoring-only; the orbit-camera controller is design-
   viewport-only. There's no second consumer to justify the
   sharing layer, and YAGNI applies — if a second consumer shows
   up, an overlay can be promoted to a shared module *then*
   without forcing the premature abstraction now.
3. **Overlay factories are already the sharing unit.** If two
   viewports wanted the same overlay, they'd both register the
   same factory. That's a one-line import, not a shared-service
   architecture. The factory contract is the API.

The overlay-context + factory-list pattern is the smallest API
that: (a) gives scene-graph access to code that legitimately needs
it, (b) never exposes that access to workspaces, (c) makes
overlays mechanically swappable for tests (call the factory with a
mock context), and (d) lets the `WorkspaceViewport` public
interface drop to pure DOM lifecycle.

**Sequencing note for implementation.** The overlay-context type
and the factory contract land in Story 33.4 (alongside the first
overlay — landscape paint cursor). Each subsequent overlay story
consumes the same contract. Story 33.8's interface shrink is
purely a deletion pass at that point: every caller of the old
accessors has been migrated to an overlay factory, and the three
`Object3D` accessors can be removed without breaking anything.

The five overlay subscribers Epic 033 introduces:

- **transform-gizmo** — gizmo handles + manipulation; driven by
  `shellStore.selection` + `viewportStore.transformDrafts`.
  Relocated from `LayoutWorkspaceView`.
- **landscape-paint-cursor** — brush ring + hover readout; driven
  by `shellStore.activeTool` + `viewportStore.activeToolCursor` +
  landscape brush settings. Relocated from `LandscapeWorkspaceView`.
- **landscape-hit-test** — raycast service that converts pointer
  events into paint strokes. Dispatches
  `viewportStore.paintLandscape({...})` on drag. Relocated from
  `LandscapeWorkspaceView`.
- **selection-highlight** — outlines / wireframe overlay for
  selected entities; driven exclusively by `shellStore.selection`
  (the canonical authority — no viewport-local mirror).
- **landscape-mesh-attachment** — the landscape controller itself.
  It's already viewport-internal in `createLandscapeSceneController`
  today, but still *parameterized* by a `surfaceRoot` passed in
  from the workspace. The attachment point becomes the viewport's
  private landscape root.

Workspaces keep their React chrome (toolbars, side panels, brush
settings, selection readout). They dispatch store actions. They do
not receive, hold, or mutate scene-graph handles.

Why this instead of a `sceneSlots` service exposed by the viewport:

A service like `viewport.getOverlaySlot("transform-gizmo")` would
work but preserves the leak — workspaces still know that
"transform gizmo" is a scene-graph concept and reach for it. By
making the overlay subscriber the atomic unit, and keeping *both*
its state slice and its scene presence inside the viewport + store
ecosystem, the workspace layer truly doesn't know the viewport has
a scene graph at all.

### Subscription integration

zustand vanilla's `store.subscribe(listener)` fires on every state
change. For combined projections, we use `subscribeWithSelector`
middleware (zustand's built-in) to avoid re-applying when unrelated
slices change:

```ts
// Inside authoringViewport.ts mount():
const unsubscribe = subscribeToProjection(
  { projectStore, shellStore, viewportStore, assetSourceStore },
  selectViewportProjection,
  (projection) => applyProjection(projection),
  { equalityFn: shallowEqual }
);
// Teardown on unmount().
```

For the React side, nothing changes: `useStore(store, selector)` for
reading, action calls for writing. React components never see the
viewport at all.

### Transient-to-committed commit flow (worked example — landscape paint)

1. User drags the paint brush. Each pointer move fires a store
   action: `paintLandscape({channelIndex, worldX, worldZ, radius,
   strength, falloff})`. The action applies the stroke to the
   current `landscapeDraft` in `viewportStore` (mutating the draft
   splatmap) *without* touching `projectStore`.
2. Viewport subscription fires with the new draft; the viewport's
   `applyProjection` merges the draft splatmap onto the runtime
   landscape mesh. Visible paint appears.
3. On pointer-up, the workspace UI fires a commit action:
   `commitLandscapePaint()`. This reads the current draft, converts
   it into a `PaintLandscapeCommand`, runs it through `applyCommand`
   against the session, calls `projectStore.updateSession(nextSession)`,
   and clears the draft.
4. The viewport's subscription fires again — draft is now null, the
   committed session has the new paint, projection is unchanged
   visually but canonicalized.

No imperative method was called on the viewport at any point. Same
shape applies to transform drafts, material previews, selection
highlights, etc.

## Stories

### 33.1 — `viewportStore` + `assetSourceStore` + projection selector

**Outcome:** Two new zustand vanilla stores in
`packages/shell/src/`, both shell-level peers of projectStore /
shellStore / previewStore:

- `packages/shell/src/viewport/` — transient viewport state
  (`landscapeDraft`, `transformDrafts`, `activeToolCursor`) + their
  actions. Selection is *not* duplicated here — the projection
  pulls `shellStore.selection` directly.
- `packages/shell/src/asset-sources/` — the blob-URL map derived
  from `(projectHandle × contentLibrary)`. State:
  `{ sources: Record<string, string>; syncCount: number }`. Actions:
  `start(handle, projectStore)` / `stop()`. On `start`, subscribes
  to the passed projectStore; on session change, diffs the
  relative-asset-path set and regenerates / revokes blob URLs via
  the stable-fingerprint logic currently in `useAssetSources`.

Plus `selectViewportProjection` combining all four stores into a
`ViewportProjection` type, and a `subscribeToProjection` helper that
wires multi-store subscription with shallow-equality debouncing.

**Files touched:**
- `packages/shell/src/viewport/index.ts` — new store + actions.
- `packages/shell/src/asset-sources/index.ts` — new store; the blob
  URL lifecycle code currently in
  `apps/studio/src/asset-sources/useAssetSources.ts` moves here,
  transposed from a React hook into a store-action + internal
  subscription.
- `packages/shell/src/projection/index.ts` — projection selector
  + subscribe helper (new shared module, sibling of the individual
  stores so none of them has to import from another).
- `packages/shell/src/index.ts` — re-export all four stores + the
  projection helpers.
- `apps/studio/src/App.tsx` — on project-active, call
  `assetSourceStore.getState().start(handle, projectStore)`. On
  project-close, call `.stop()`. Remove the
  `useAssetSources(projectHandle, contentLibrary)` hook call.
- `apps/studio/src/asset-sources/` — delete (module moved to
  `packages/shell/src/asset-sources/`).
- `packages/testing/src/viewport-store.test.ts` — round-trip tests
  for each action, projection shape, subscription equality.
- `packages/testing/src/asset-source-store.test.ts` — start/stop
  lifecycle, stable-fingerprint regeneration (the path-set
  fingerprint from the original hook), blob-URL revocation on
  stop and on path removal.

**No viewport changes yet.** This story is pure infrastructure —
the stores exist and are populated, but the viewport is still
driven by `updateFromRegion` imperative calls. Story 33.2 switches
the viewport to subscribe.

### 33.2 — Authoring viewport subscribes directly to projection

**Outcome:** `apps/studio/src/viewport/authoringViewport.ts`'s
`mount()` attaches a `subscribeToProjection` subscription. On every
projection change, `applyProjection(projection)` runs — which
internally does what the current `updateFromRegion` +
`previewLandscape` + `previewTransform` combined do today, but with
full context every time. The existing imperative methods
(`updateFromRegion`, `previewLandscape`, `paintLandscapeAt`,
`previewTransform`) are kept as thin wrappers that dispatch store
actions, so existing callers in App.tsx and workspace views
continue to work unchanged during migration.

**Files touched:**
- `apps/studio/src/viewport/authoringViewport.ts` — add subscription
  in `mount()`, extract `applyProjection`, convert imperative methods
  to store-action dispatchers.
- `packages/testing/src/authoring-viewport-subscription.test.ts` —
  test that a committed session change flows through subscription
  to `applyProjection`; test that a draft change flows the same way;
  test that multiple draft changes in one tick debounce via
  shallow-equality.

**No caller changes.** Imperative methods still work; they just
route through the store now.

### 33.3 — Migrate callers to store actions

**Outcome:** Every caller of `viewport.updateFromRegion`,
`viewport.previewLandscape`, `viewport.paintLandscapeAt`,
`viewport.previewTransform` changes to dispatch a store action
instead. The imperative methods on the viewport interface become
dead code and are removed.

Concretely:
- `App.tsx:1124` useEffect → delete. ProjectStore changes already
  propagate via subscription.
- `LandscapeWorkspaceView` → replace `viewport.previewLandscape(l)`
  with `viewportStore.setLandscapeDraft(l)`;
  `viewport.paintLandscapeAt({…})` with `paintLandscape({…})` action
  that updates the draft splatmap.
- `LayoutWorkspaceView` → replace `viewport.previewTransform(id, …)`
  with `viewportStore.setTransformDraft(id, …)`.

**Files touched:**
- `apps/studio/src/App.tsx` — delete the `updateFromRegion`
  useEffect.
- `packages/workspaces/src/build/landscape/` — landscape workspace
  dispatches draft/commit actions instead of calling viewport
  methods.
- `packages/workspaces/src/build/layout/` — transform drafts.
- `packages/workspaces/src/viewport.ts` — remove the now-unused
  methods from `WorkspaceViewport` interface.
- `apps/studio/src/viewport/authoringViewport.ts` — remove the thin
  wrappers added in 33.2.

### 33.4 — Relocate landscape overlay ownership into the viewport

**Outcome:** `LandscapeWorkspaceView` stops touching the viewport's
scene roots. The landscape brush cursor, hit-test service, input
router, and landscape-mesh attachment all move into viewport-owned
overlay subscribers driven by the projection. The workspace is
reduced to React chrome (channel list, brush settings panel,
Apply button) plus store-action dispatchers.

Three new overlay subscribers get registered in the viewport's
`mount()`:

- `apps/studio/src/viewport/overlays/landscape-paint-cursor.ts` —
  mounts a `THREE.RingGeometry` brush cursor (moved out of
  `landscape-workspace.ts`'s `createBrushCursor()`) under the
  viewport's private overlayRoot. Subscribes to
  `shellStore.activeTool + viewportStore.activeToolCursor +
  viewportStore.brushSettings`. Updates ring radius + world position
  on every projection tick.
- `apps/studio/src/viewport/overlays/landscape-hit-test.ts` —
  installs pointerdown/pointermove/pointerup listeners on the
  viewport's DOM element. On drag, raycasts against the landscape
  mesh and dispatches `viewportStore.paintLandscape({...})`. On
  pointerup, dispatches `commitLandscapePaint()`. Owns no scene
  objects of its own.
- `apps/studio/src/viewport/overlays/landscape-mesh-attachment.ts`
  — thin wrapper that owns the landscape root under the viewport's
  private scene. The existing `createLandscapeSceneController`
  stays — this overlay just gives it a stable, viewport-internal
  parent Group instead of one passed through the workspace.

`viewportStore` grows one action and one slice to back the cursor +
brush settings that previously lived in
`landscape-workspace.ts`'s `toolState`:

```ts
// added to ViewportState
brushSettings: LandscapeBrushSettings | null;

// added to ViewportActions
paintLandscape(stroke: LandscapePaintStroke): void;
commitLandscapePaint(): void;
setBrushSettings(settings: LandscapeBrushSettings): void;
```

The `paintLandscape` action applies the stroke to the current
`landscapeDraft` splatmap without touching projectStore — same
transient-draft flow as the "Transient-to-committed commit flow"
worked example above. `commitLandscapePaint` runs the domain
command and clears the draft.

**Files touched:**
- `apps/studio/src/viewport/overlay-context.ts` — new. The
  `ViewportOverlayContext` interface and `ViewportOverlayFactory`
  type per the "Replacing authoredRoot / overlayRoot / surfaceRoot"
  section. Lands with this story because it's the first consumer;
  all subsequent overlay stories import from here.
- `apps/studio/src/viewport/overlays/landscape-paint-cursor.ts` —
  new.
- `apps/studio/src/viewport/overlays/landscape-hit-test.ts` — new.
- `apps/studio/src/viewport/overlays/landscape-mesh-attachment.ts`
  — new (thin parent-group wrapper).
- `apps/studio/src/viewport/authoringViewport.ts` — accept an
  `overlays: ViewportOverlayFactory[]` constructor option; build
  the overlay context internally on `mount()`; register the three
  overlay subscribers; hold their teardowns for `unmount()`. The
  three `Object3D` accessors remain on the public interface until
  33.8 but are no longer read by any caller outside the overlay
  context.
- `apps/studio/src/App.tsx` — pass the overlay factory list to
  `createAuthoringViewport({ overlays: [...] })`.
- `packages/shell/src/viewport/index.ts` — add `brushSettings` slice
  and paint/commit actions.
- `packages/workspaces/src/build/landscape/landscape-workspace.ts`
  — delete the scene-root-attaching `attach(...)` / `detach()` /
  `hitTestService` / `inputRouter` / `createBrushCursor` surface.
  What remains is a thin command-dispatch helper (if anything — it
  may fold entirely into the React view).
- `packages/workspaces/src/build/landscape/index.tsx` —
  `viewport.authoredRoot`/`overlayRoot`/`surfaceRoot` references
  deleted. The component dispatches `setActiveChannelIndex`,
  `setBrushSettings`, etc. via store actions. No viewport ref.
- `packages/testing/src/landscape-overlay.test.ts` — integration
  test: simulating a paint-stroke action sequence produces the
  correct draft state and a single commit command; cursor slice
  updates propagate to the overlay without rebuilding the mesh.

### 33.5 — Relocate transform gizmo into the viewport

**Outcome:** `LayoutWorkspaceView` stops touching the viewport's
scene roots. The transform-gizmo controller currently instantiated
by `createLayoutWorkspace` moves into a viewport-owned overlay
subscriber. Gizmo interaction dispatches
`viewportStore.setTransformDraft` on drag and
`applyTransformCommand` on drop — the same shape landscape paint
uses.

**Files touched:**
- `apps/studio/src/viewport/overlays/transform-gizmo.ts` — new
  overlay subscriber. Owns the gizmo group under the viewport's
  private overlayRoot. Subscribes to
  `shellStore.selection + viewportStore.transformDrafts +
  projectStore.session` (for the canonical transform when no draft
  is active). Pointer handlers dispatch store actions directly; no
  callbacks into workspace code.
- `apps/studio/src/viewport/authoringViewport.ts` — register the
  new overlay subscriber.
- `packages/workspaces/src/build/layout/LayoutWorkspaceView.tsx`
  — delete `viewport.authoredRoot` / `viewport.overlayRoot` /
  `viewport.previewTransform` call sites. Delete the
  `createLayoutWorkspace` instantiation; what was its
  `onPreviewTransform` / `onCommand` / `getSelectedId` /
  `getRegion` surface either moves into the overlay subscriber
  (preview transforms) or the React view dispatches directly
  (command issuance, selection).
- `packages/workspaces/src/build/layout/createLayoutWorkspace.ts`
  (or equivalent) — deleted if it becomes a pure passthrough after
  the gizmo moves.
- `packages/testing/src/transform-gizmo-overlay.test.ts` —
  simulating a drag sequence produces a sequence of `transformDraft`
  store mutations and a single commit on release.

### 33.6 — Remove pure-query methods from viewport interface

**Outcome:** `viewport.renderLandscapeMask(channelIndex, canvas)`
and `viewport.serializeLandscapePaintPayload()` are not state
mutations — they're pure queries against runtime landscape mesh
state. The pure logic moves to `packages/render-web/src/landscape/
mask.ts` (exports `renderChannelMaskToCanvas(mesh, channelIndex,
canvas)` and `serializeLandscapePaintPayload(mesh)`), and the
landscape workspace consumes those helpers directly.

**Decision: lightweight access layer only. The mesh handle is
never exposed through `viewportStore`.**

The reason: `viewportStore` is a zustand store whose contract is
"every read is a snapshot of declarative state." A live
`LandscapeMesh` reference is a mutable runtime object with GPU
bindings, internal caches, and a lifecycle tied to the render
pipeline — putting it on a store would be the same anti-pattern
the Overlay ownership section rejects for `Object3D` accessors.
Subscribers would also fire spuriously on every mesh-internal
mutation that wasn't actually a store event.

The access layer is a tiny module-scoped registry:

```ts
// apps/studio/src/viewport/landscape-mesh-registry.ts

let current: LandscapeMeshHandle | null = null;

/** Set by the landscape-mesh-attachment overlay on mount. */
export function registerLandscapeMesh(handle: LandscapeMeshHandle): void {
  current = handle;
}

/** Cleared by the overlay on unmount. */
export function unregisterLandscapeMesh(): void {
  current = null;
}

/** Read by workspace UI that needs to run pure queries. Returns
 *  null when no landscape is currently mounted. */
export function getLandscapeMeshHandle(): LandscapeMeshHandle | null {
  return current;
}
```

The landscape-mesh-attachment overlay (Story 33.4) calls
`registerLandscapeMesh` when it mounts its mesh and
`unregisterLandscapeMesh` on teardown. The landscape workspace's
mask-preview and paint-payload readers call `getLandscapeMeshHandle()`
and invoke the pure helpers from `packages/render-web/src/landscape/
mask.ts`. No viewport ref is held by the workspace.

Why this is not a store:
1. The handle is a runtime resource, not declarative state.
2. No subscriber needs to react to its changes — mask queries are
   pull-driven by UI interactions (clicking to refresh the mask
   preview, committing a paint stroke), not push-driven by store
   events.
3. Its lifecycle is bound to the overlay subscriber, which is the
   correct ownership boundary.

Why this is not on the public `WorkspaceViewport` interface:
Story 33.8 is deleting scene-graph exposure from that interface
entirely. The access layer lives inside `apps/studio/src/viewport/`
and is only importable by code in that tree (the overlays that
register into it) and the workspace UI that reads from it. It is
*not* exported from `packages/workspaces/src/viewport.ts`.

**Files touched:**
- `packages/render-web/src/landscape/mask.ts` — new pure helpers:
  `renderChannelMaskToCanvas(mesh, channelIndex, canvas)` and
  `serializeLandscapePaintPayload(mesh)`. Pure: take a mesh handle
  as their first argument, return plain data, no side effects on
  viewport or store state.
- `apps/studio/src/viewport/landscape-mesh-registry.ts` — new.
  The three-function module above. Module-scoped state; no store.
- `apps/studio/src/viewport/overlays/landscape-mesh-attachment.ts`
  — call `registerLandscapeMesh` on mount, `unregisterLandscapeMesh`
  on teardown. (This file already exists from Story 33.4; this
  story adds the registry calls.)
- `packages/workspaces/src/build/landscape/` — call
  `getLandscapeMeshHandle()` and `renderChannelMaskToCanvas(...)`
  / `serializeLandscapePaintPayload(...)` directly. Readers
  handle the `null` return by showing a blank mask preview.
- `packages/workspaces/src/viewport.ts` — remove
  `renderLandscapeMask` and `serializeLandscapePaintPayload` from
  `LandscapeWorkspaceViewport` (and merge what's left with the
  other kind-specific viewports — the interface shrink in 33.8
  completes this merge).
- `packages/testing/src/landscape-mesh-registry.test.ts` — new:
  register/unregister lifecycle, null return when no overlay
  mounted, single-source invariant (registering a second handle
  without unregistering the first is an error in development —
  catches overlay bugs early).

### 33.7 — Introduce `designPreviewStore` and migrate Player / NPC / Item viewports

**Outcome:** Two pieces of work, landed together because the
viewport migration has no real owner until the store exists:

1. **Create `designPreviewStore`** per the "Design-preview state
   ownership" section above. Owns `activeDefinitionId`,
   `activeAnimationSlot`, `isAnimationPlaying`, `cameraFraming` +
   their actions. Lives alongside projectStore / shellStore /
   viewportStore / assetSourceStore in `packages/shell/src/`.
2. **Migrate the three design viewports** to subscribe to per-kind
   projections. Remove `updateFromPlayer` / `updateFromNPC` /
   `updateFromItem` from the viewport interfaces. Remove the
   React-local useState for animation slot / play state / camera
   quaternion from `PlayerWorkspaceView.tsx:87`,
   `NPCWorkspaceView.tsx:124`, and the equivalent in
   `ItemWorkspaceView`; replace with `useStore(designPreviewStore,
   selector)` reads and action dispatches.

The orbit-camera controller currently held in `cameraControllerRef`
(`PlayerWorkspaceView.tsx:92`) becomes a viewport overlay
subscriber following the same pattern as the transform-gizmo
(Story 33.5): the camera controller reads
`designPreviewStore.cameraFraming` for its current pose and
dispatches `setCameraFraming(...)` on user drag. No React ref holds
a mutable controller across renders.

**Files touched:**
- `packages/shell/src/design-preview/index.ts` — new store factory
  + actions.
- `packages/shell/src/design-preview/projection.ts` — new selectors
  `selectPlayerPreviewProjection` / `selectNpcPreviewProjection` /
  `selectItemPreviewProjection`.
- `packages/shell/src/index.ts` — re-export `designPreviewStore`,
  `DesignPreviewState`, `DesignPreviewActions`, the three
  selectors.
- `apps/studio/src/viewport/playerViewport.ts` — subscribe to
  player projection; remove `updateFromPlayer`. Instantiate the
  orbit-camera overlay subscriber in `mount()`.
- `apps/studio/src/viewport/npcViewport.ts` — same, for NPC.
- `apps/studio/src/viewport/itemViewport.ts` — same, for Item.
- `apps/studio/src/viewport/overlays/design-orbit-camera.ts` — new
  overlay subscriber; reads `designPreviewStore.cameraFraming`,
  dispatches `setCameraFraming` on drag.
- `apps/studio/src/App.tsx` — on design-workspace activation, call
  `designPreviewStore.getState().beginPreview(definitionId)`; on
  deactivation, `.endPreview()`.
- `packages/workspaces/src/design/PlayerWorkspaceView.tsx` —
  delete the four useState blocks at lines 87–91. Delete the
  cameraControllerRef, delete the `getViewport()` /
  `getViewportElement()` props (the viewport owns its own DOM
  element lookup via overlay registration). The view becomes a
  React chrome component: animation-slot `Select` bound to
  `designPreviewStore.activeAnimationSlot`, play/pause button
  bound to `.isAnimationPlaying`, and a `<div>` mount-point for
  the viewport.
- `packages/workspaces/src/design/NPCWorkspaceView.tsx` — same.
- `packages/workspaces/src/design/ItemWorkspaceView.tsx` — same.
- `packages/workspaces/src/viewport.ts` — remove `updateFromPlayer`
  / `updateFromNPC` / `updateFromItem` from each kind's interface.
- `packages/testing/src/design-preview-store.test.ts` — new:
  beginPreview/endPreview scoping, slot change, play toggle,
  camera-framing round-trip.
- `packages/testing/src/design-viewport-subscription.test.ts` —
  new: dispatching `setAnimationSlot` flows through subscription
  to the viewport; `beginPreview(newId)` clears slot/play/camera;
  unmount cleans up both the projection subscription and the
  camera overlay.

**Story ordering:** this depends on 33.1 (for the subscribeToProjection
helper) and 33.4/33.5 (for the overlay-subscriber pattern). It does
*not* depend on 33.3/33.6 since it touches a separate set of
viewports and workspaces.

### 33.8 — Shrink `WorkspaceViewport` interface + ADR

**Outcome:** By this point every consumer of the viewport's scene-
graph accessors has been relocated — state consumers to store
actions (33.3), overlay owners to viewport-private subscribers
(33.4, 33.5), query consumers to service modules (33.6), per-kind
viewports to projection subscribers (33.7). The interface shrink
is now the natural consequence rather than an orphan deletion: the
accessors being removed genuinely have no remaining callers.

The four viewport interfaces in
`packages/workspaces/src/viewport.ts` unify to one shape:

```ts
export interface WorkspaceViewport {
  mount(container: HTMLElement): void;
  unmount(): void;
  resize(width: number, height: number): void;
  render(): void;
  subscribeFrame(listener: () => void): () => void;
  setProjectionMode(mode: "perspective" | "orthographic-top"): void;
}
```

Note that even `scene` and `camera` are gone: after 33.4/33.5 no
external consumer needs direct access to them. Overlays that need
a camera for raycasting receive it via the `ViewportOverlayContext`
the viewport passes at registration time — that context is
viewport-internal and not re-exposed on the public interface.

Write ADR 011: "Viewport-as-Subscriber." Document the rule: no
imperative method on a viewport may mutate render state, and no
external caller may reach into a viewport's scene graph. State
flows through a store and is observed; scene-graph ownership stays
inside the viewport. Add a lint rule
(`tooling/check-viewport-imperative.mjs`) that fails CI if the
`WorkspaceViewport` interface grows a method taking a state
payload OR re-exposes an `Object3D`-typed accessor.

**Files touched:**
- `packages/workspaces/src/viewport.ts` — unified interface.
- `docs/adr/011-viewport-as-subscriber.md` — new.
- `docs/adr/README.md` — add entry.
- `tooling/check-viewport-imperative.mjs` — new lint guard.
- `package.json` — add lint script wired into `lint` target.

## Success criteria

- **One update path.** `grep` for "update from" / "preview" / "paint"
  methods on any `WorkspaceViewport` interface in
  `packages/workspaces/src/viewport.ts` returns nothing after 33.8.
- **No workspace imports `THREE.Object3D`.** `grep` for
  `from "three"` in `packages/workspaces/src/build/layout/` and
  `packages/workspaces/src/build/landscape/` returns nothing after
  33.5 — scene-graph ownership lives entirely inside the viewport.
- **Landscape channel material binding no longer has the "flat
  color clobbers real material" bug**, verified by the scenario we
  hit on 2026-04-20: bind Channel 1 to Wordlark Brick, verify the
  brick pattern shows in the editor viewport with no additional
  prods.
- **Transient edits feel instant.** Landscape paint, transform drag,
  material hover-preview all render their draft with < 16ms
  latency from the action dispatch (one frame at 60fps).
- **Projection-selector determinism.** For a fixed
  `(ProjectState, ShellState, ViewportState, AssetSourceState)`
  tuple the projection selector produces byte-for-byte equal
  output regardless of prior imperative calls or subscription
  history. `packages/testing/src/viewport-projection.test.ts`
  asserts this via property-based fuzzing over the store shapes.
- **Pinned regression: landscape channel rebinding (the 2026-04-20
  bug).** Bind Channel 1 to Wordlark Brick, render the editor
  viewport, assert the brick pattern appears. Mutate an unrelated
  session field (e.g. environment override), assert no churn on
  channel texture state.

## Risks and open questions

- **Subscription storm on paint strokes.** Paint strokes fire many
  draft updates per second. If every store mutation triggers the
  full projection selector and a full `applyProjection`, we pay
  re-render cost per stroke. Mitigation: `subscribeWithSelector` +
  shallow equality on the draft slice isolates paint-only changes
  to the landscape apply path; the selector's downstream code can
  diff and do minimum work (only update splatmap textures, not
  rebuild material nodes). This mirrors the signature-guard I added
  to `rebuildMaterialNodes` during 32.12 — generalize it to the
  whole projection.
- **Authoring-level undo integration.** Drafts are transient; they
  don't appear in the undo history. Commits do (via the existing
  command system). Confirm this matches author expectations — if
  users expect to be able to undo individual paint strokes within
  a single drag, we need a "soft checkpoint" mechanism on the
  draft splatmap. Likely a follow-up.
- **Migration order risk.** Changing the viewport interface mid-
  flight could break in-progress work on other branches. Mitigation:
  33.2 keeps the imperative methods as dispatch wrappers until 33.3
  migrates callers. Each story can ship independently; the full
  interface shrink happens last.
- **"Actions fire synchronously but viewport applies asynchronously"
  expectations.** zustand subscriptions fire synchronously on set,
  so this is fine — but writing down the contract in the ADR keeps
  future code from assuming otherwise.

## Builds on

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
  — the "one rendering path for authoring + preview + published"
  principle. Epic 033 extends it from *runtime* to *state flow*.
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
  — the existing `applyCommand(session, command)` pattern is how
  transient drafts commit to canonical truth. Epic 033 introduces
  drafts as a parallel-but-local concern that resolve through
  command commit.
- [Plan 032: Material System and Library Epic](/Users/nikki/projects/sugarmagic/docs/plans/032-material-system-and-library-epic.md)
  — Story 32.10 (AuthoredAssetResolver), 32.11 (standard-pbr graph
  + `texture.dispose()` on image swap), 32.12 (landscape unified
  with shader graph) each shipped with a dedicated symptomatic fix
  for the same underlying "parallel state flow" disease. Epic 033
  treats the disease.
