# Plan 035: Editor Camera Consolidation Epic

**Status:** Proposed
**Date:** 2026-04-21

## Epic

### Title

Collapse the six near-duplicate `create*CameraController` factories in
`packages/workspaces/src/` into a single `EditorCamera` class,
parameterized by config. Deletes roughly 1000 lines of copy-paste,
leaves one place to fix bugs and add features, and makes it obvious
where new viewports' cameras come from.

### Goal

- **One class, six configs.** Every editor viewport instantiates the
  same `EditorCamera` class with a declarative config (distance
  bounds, mouse bindings, initial pose, polar-angle clamp,
  orthographic support, target-update behavior). No more
  `createPlayerCameraController` / `createNPCCameraController` /
  `createItemCameraController` / `createLayoutCameraController` /
  `createLandscapeCameraController` / `createSpatialCameraController`
  each re-implementing the same `OrbitControls` wrapper.
- **Fix once, fixed everywhere.** The design-preview camera-framing
  sync introduced for Epic 033 is currently a sidecar helper because
  the camera controllers are opaque factories. After 035 it's a
  method on the camera class — `camera.framing()` getter +
  `camera.onFrameChange(listener)` — so every viewport gets it for
  free.
- **Removes the last copy-paste path Epic 033 did not reach.** Epic
  033 eliminated parallel *state* flow paths into the viewport;
  035 eliminates the parallel *camera controller* implementations
  one layer down.

### Why this epic exists

The six camera controllers are 90% identical. Reading the diff:

- `player-camera-controller.ts` vs `npc-camera-controller.ts` vs
  `item-camera-controller.ts` — differ only in initial pose
  constants, mouse-button bindings, distance bounds, and whether
  `maxPolarAngle` is clamped. 200+ lines of otherwise-identical
  code per file.
- `layout-camera-controller.ts` vs `landscape-camera-controller.ts` —
  same story, slightly more input-handling variation.
- `spatial-camera-controller.ts` — the most distinct (top-down ortho,
  pan-only, no rotate) but still an `OrbitControls` wrapper with the
  same attach/detach/save-restore lifecycle.

What every controller does identically:

- Construct `OrbitControls(camera, domElement)` on attach.
- `enableDamping = true`, `dampingFactor = 0.08`.
- Save position + target to module-scoped `Vector3`s on detach;
  restore on next attach.
- Subscribe a frame listener that calls `controls.update()`.
- Add a `contextmenu` handler on the DOM element that prevents the
  default right-click menu.
- Dispose controls + remove listener + clear refs on detach.

What varies across the six:

| Knob | Where it varies |
|---|---|
| Min / max orbit distance | Per-viewport constants |
| Initial camera position + target | Per-viewport `Vector3` literals |
| Mouse button bindings | Player = rotate/dolly/pan; NPC / Item / Landscape = null/rotate/pan; Spatial = null/pan/pan |
| `enableRotate` | `false` on spatial (pan-only top-down) |
| `screenSpacePanning` | `true` on spatial, `false` elsewhere |
| `maxPolarAngle` clamp | NPC / Item clamp to horizon; Player does not |
| Orthographic support | Spatial-only: zoom save/restore, `up` vector, `minZoom` / `maxZoom` |
| `updateTarget(y)` method | Design controllers expose it; build controllers do not |
| Initial `targetY` parameter on attach | Design controllers take it; build controllers do not |

Every one of these is a config value, not a behavioral difference.

### Goal-line test

After 035 lands, a `grep` for `new OrbitControls` across the repo
returns exactly one hit — inside the `EditorCamera` class.

## Scope

### In scope

- **`EditorCamera` class** in
  `packages/workspaces/src/camera/editor-camera.ts`. Single class,
  declarative config, owns the `OrbitControls` instance.
- **Six config constants** exported from the same module (or a
  sibling `presets.ts`): `PLAYER_PREVIEW_CAMERA_CONFIG`,
  `NPC_PREVIEW_CAMERA_CONFIG`, `ITEM_PREVIEW_CAMERA_CONFIG`,
  `LAYOUT_AUTHORING_CAMERA_CONFIG`,
  `LANDSCAPE_AUTHORING_CAMERA_CONFIG`,
  `SPATIAL_AUTHORING_CAMERA_CONFIG`. Each is a `EditorCameraConfig`
  literal capturing exactly what used to be hard-coded in its
  respective controller file.
- **Framing sync folded into the class.** The current
  `apps/studio/src/viewport/design-preview-camera-framing.ts`
  helper becomes an `EditorCamera.framing()` getter plus an
  `onFrameChange` subscription that the design viewports consume.
  Same angular-distance / distance / target-position epsilon
  gating — just on the class instead of in a separate file.
- **Deletion pass** of the six existing controller files and their
  exports from `packages/workspaces/src/{build,design}/index.*`.
- **Call-site migration** in the four overlay / viewport files:
  `authoring-camera.ts`, `playerViewport.ts`, `npcViewport.ts`,
  `itemViewport.ts`.

### Out of scope

- **Changing camera UX behavior.** Every config preset must produce
  the same camera behavior as its predecessor controller — same
  initial pose, same bounds, same button bindings. This is a
  refactor, not a redesign.
- **Non-editor cameras.** The gameplay-runtime camera in
  `targets/web/` is orthogonal and unaffected.
- **Input system rewrite.** Still `OrbitControls` under the hood.
  If a future epic wants a custom input layer, that's separate.

## Config shape

```ts
// packages/workspaces/src/camera/editor-camera.ts

export interface EditorCameraConfig {
  /** Initial camera position when no saved pose exists. */
  initialPosition: [number, number, number];
  /** Initial orbit target. */
  initialTarget: [number, number, number];

  /** Orbit bounds (perspective mode). */
  minDistance: number;
  maxDistance: number;

  /** Mouse-button bindings. `null` disables that button. */
  mouseButtons: {
    left: "rotate" | "dolly" | "pan" | null;
    middle: "rotate" | "dolly" | "pan" | null;
    right: "rotate" | "dolly" | "pan" | null;
  };

  /** Disable orbit rotation entirely (pan-only top-down). */
  enableRotate: boolean;
  /** Use screen-space panning instead of world-space. */
  screenSpacePanning: boolean;
  /** Clamp orbit to above-horizon. */
  maxPolarAngle?: number;

  /** Orthographic-camera support + zoom bounds. */
  orthographic?: {
    minZoom: number;
    maxZoom: number;
    initialZoom: number;
    up: [number, number, number];
  };

  /** Whether the caller can shift the orbit target at runtime. */
  supportsTargetUpdate: boolean;
}

export interface EditorCameraFraming {
  quaternion: [number, number, number, number];
  orbitDistance: number;
  target: [number, number, number];
}

export class EditorCamera {
  constructor(config: EditorCameraConfig);

  attach(
    camera: THREE.Camera,
    domElement: HTMLElement,
    subscribeFrame: (listener: () => void) => () => void,
    initialTargetY?: number  // overrides config.initialTarget[1] if given
  ): void;
  detach(): void;

  updateTarget(targetY: number): void;  // no-op if !supportsTargetUpdate

  /** Current pose, read on demand. */
  framing(): EditorCameraFraming | null;

  /**
   * Subscribe to framing changes. Fires only when the pose drifts
   * past the built-in epsilons (angle 0.0001, distance 0.0005,
   * target 0.0005). Allocation-gated: no framing object is built
   * on idle frames.
   */
  onFrameChange(listener: (framing: EditorCameraFraming) => void): () => void;
}
```

The framing-sync helpers from
`apps/studio/src/viewport/design-preview-camera-framing.ts`
(introduced in Epic 033's blocker-#1 fix) migrate *into* the class
as the internal implementation of `onFrameChange`. The helper file
is deleted.

## Stories

### 35.1 — `EditorCamera` class + config presets

**Outcome:** New class in
`packages/workspaces/src/camera/editor-camera.ts` implementing the
contract above. Six config constants in
`packages/workspaces/src/camera/presets.ts` reproducing the
hard-coded values of each current controller. `attach` / `detach` /
`updateTarget` / `framing` / `onFrameChange` all working.
Save-pose-across-detach behavior preserved (each instance of
`EditorCamera` keeps a private `savedPosition` / `savedTarget`
between its own attach cycles).

**Files touched:**
- `packages/workspaces/src/camera/editor-camera.ts` — new.
- `packages/workspaces/src/camera/presets.ts` — new.
- `packages/workspaces/src/camera/index.ts` — new barrel.
- `packages/workspaces/src/index.ts` — re-export `EditorCamera`,
  `EditorCameraConfig`, `EditorCameraFraming`, and the six preset
  constants.
- `packages/testing/src/editor-camera.test.ts` — new. Covers:
  constructing with each preset; attach / detach round-trip;
  pose save/restore; `updateTarget` shifts orbit; `onFrameChange`
  fires past epsilon and does not fire below; orthographic zoom
  save/restore; `mouseButtons: null` maps correctly.

### 35.2 — Migrate design viewports to `EditorCamera`

**Outcome:** `apps/studio/src/viewport/playerViewport.ts`,
`npcViewport.ts`, `itemViewport.ts` each instantiate
`new EditorCamera(preset)` instead of the factory controller. Each
registers an `onFrameChange` listener that writes to
`designPreviewStore.setCameraFraming(...)` — no more manual
`syncCameraFraming` closure, no more manual epsilon guards,
because both live inside the class.

**Files touched:**
- `apps/studio/src/viewport/playerViewport.ts` — replace
  `createPlayerCameraController()` with
  `new EditorCamera(PLAYER_PREVIEW_CAMERA_CONFIG)`. Delete the
  inline `syncCameraFraming` closure. Replace with
  `editorCamera.onFrameChange((f) => designPreviewStore.getState().setCameraFraming(f))`.
- `apps/studio/src/viewport/npcViewport.ts` — same.
- `apps/studio/src/viewport/itemViewport.ts` — same.
- `apps/studio/src/viewport/design-preview-camera-framing.ts` —
  **delete**. The epsilon-gated sync is now inside the class.

### 35.3 — Migrate authoring-camera overlay to `EditorCamera`

**Outcome:**
`apps/studio/src/viewport/overlays/authoring-camera.ts` stops
importing `createLayoutCameraController` /
`createLandscapeCameraController` /
`createSpatialCameraController`. Instead it constructs three
`EditorCamera` instances — one per build workspace kind — using
the respective preset. The mode-switch logic (attach whichever
camera matches the active workspace) is unchanged in shape; only
the controller type changes.

**Files touched:**
- `apps/studio/src/viewport/overlays/authoring-camera.ts` — replace
  the three factory calls with `new EditorCamera(...)`. Swap the
  quaternion-write loop to use `onFrameChange` for consistency
  with the design viewports.

### 35.4 — Delete the six obsolete controllers + ADR

**Outcome:** The six controller files are deleted. Their exports
are removed from `packages/workspaces/src/build/{layout,landscape,
spatial}/index.ts` and
`packages/workspaces/src/design/index.tsx`. ADR 012 written:
"Single Editor Camera Class." Lint guard
(`tooling/check-camera-controller-factories.mjs`) fails CI if a
file matching `*camera-controller.ts` appears under
`packages/workspaces/src/` again.

**Files touched:**
- `packages/workspaces/src/build/layout/layout-camera-controller.ts`
  — delete.
- `packages/workspaces/src/build/landscape/landscape-camera-controller.ts`
  — delete.
- `packages/workspaces/src/build/spatial/spatial-camera-controller.ts`
  — delete.
- `packages/workspaces/src/design/player-camera-controller.ts`
  — delete.
- `packages/workspaces/src/design/npc-camera-controller.ts` —
  delete.
- `packages/workspaces/src/design/item-camera-controller.ts` —
  delete.
- `packages/workspaces/src/build/{layout,landscape,spatial}/index.ts`
  — drop re-exports.
- `packages/workspaces/src/design/index.tsx` — drop re-exports.
- `docs/adr/012-single-editor-camera-class.md` — new.
- `docs/adr/README.md` — add entry.
- `tooling/check-camera-controller-factories.mjs` — new lint
  guard.
- `package.json` — wire the guard into `lint`.

## Success criteria

- **One `new OrbitControls` call in the repo.** `grep -r "new OrbitControls"
  packages/ apps/` returns exactly one hit:
  `packages/workspaces/src/camera/editor-camera.ts`.
- **Zero `*camera-controller.ts` files under `packages/workspaces/`.**
  Verified by the new lint guard.
- **Every editor viewport's camera behaves identically to before.**
  Manual regression pass: open each build workspace (layout,
  landscape, spatial) and each design workspace (player, npc,
  item), confirm initial pose, orbit bounds, button bindings, and
  pan behavior match the pre-035 baseline.
- **Design-preview framing sync still works without a sidecar
  helper.** Moving the orbit camera in the Player workspace
  updates `LayoutOrientationWidget` smoothly, without per-frame
  re-renders of the Inspector sidebar (the Epic 033 blocker-#1
  fix is preserved via `onFrameChange` epsilon gating).

## Risks

- **Config drift.** The six preset constants must exactly match the
  current hard-coded values in each controller. Mitigation: a
  small table in Story 35.1's test file asserting each preset's
  values explicitly, so a future edit that unintentionally shifts
  an initial-pose constant shows up as a test failure rather than
  a silent UX regression.
- **Orthographic path correctness.** Only the spatial preset uses
  the orthographic branch. Easy to under-test. Mitigation: a
  dedicated test constructing `EditorCamera` with
  `SPATIAL_AUTHORING_CAMERA_CONFIG` against an
  `OrthographicCamera` stub and asserting zoom save/restore.
- **Pose save/restore semantics.** The current controllers save
  pose to *module-scoped* `Vector3`s, which means two instances
  of the same factory share a pose. With `EditorCamera` as a
  class, pose is per-instance by default. If any current
  behavior depended on the module-scoped sharing (unlikely —
  there's only ever one instance of each factory at a time), it
  would silently change. Mitigation: the test covers attach /
  detach / re-attach on the same instance.

## Builds on

- [Epic 033: Unified Viewport State Subscription](/Users/nikki/projects/sugarmagic/docs/plans/033-unified-viewport-state-subscription-epic.md)
  — specifically the design-preview-camera-framing helper added to
  fix Epic 033's blocker-#1. Epic 035 absorbs that helper into
  `EditorCamera` and deletes the standalone file.
- [ADR 011: Viewport As Subscriber](/Users/nikki/projects/sugarmagic/docs/adr/011-viewport-as-subscriber.md)
  — 035 extends the same "one implementation" principle from
  viewport state flow (011) to camera control.
