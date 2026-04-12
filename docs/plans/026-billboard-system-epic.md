# Plan 026: Billboard System Epic

**Status:** Proposed  
**Date:** 2026-04-12

## Epic

### Title

Performant billboard rendering system for the Sugarmagic runtime.

### Goal

Build a general-purpose billboard system that renders camera-facing quads in the 3D scene. Billboards are used for:

- **Debug overlays** — floating labels above entities showing task, area, proximity (Plan 027 depends on this)
- **Foliage** — trees, flowers, plants, grass, shrubs, moss rendered as billboarded sprites at distance or always
- **LOD impostors** — swapping complex 3D models for billboarded sprite captures at distance
- **UI markers** — in-world indicators, nameplates, interaction prompts
- **Particle-adjacent effects** — simple camera-facing quads for dust, sparkles, ambient atmosphere

The system must be browser-performant (WebGPU), support thousands of billboards with instanced rendering, and cleanly separate the semantic description (what to billboard) from the presentation (how to render it).

### Why this epic exists

There is currently no billboard, impostor, LOD, or sprite rendering infrastructure in the codebase. The render pipeline renders full 3D meshes for everything. As scenes grow in complexity — more NPCs, foliage, items, decorative elements — performance will degrade without a billboard/LOD fallback system. Foliage in particular is billboard-heavy in every shipping game engine and Sugarmagic needs this foundation before the landscape system can support vegetation.

Plan 027 (Debug HUD) needs in-world billboards for entity debug labels. Plan 024 (Spatial Grounding) needs spatial debug overlays. Both depend on this system existing.

### Architecture: core vs presentation

The billboard system must respect the existing separation between `runtime-core` (platform-agnostic semantics) and the web target (Three.js/WebGPU presentation).

**In `runtime-core` (semantic, platform-agnostic):**

- `BillboardComponent` — ECS component declaring that an entity has billboard behavior. Holds: billboard kind, size, offset, LOD distance thresholds, visibility flags, content descriptor.
- `BillboardSystem` — ECS system that runs per-frame. Computes which billboards are active based on camera distance, frustum, and LOD thresholds. Writes visibility/LOD state to the component. Does NOT create or manage any rendering objects.
- `BillboardDescriptor` — typed data structure describing what a billboard should display. Discriminated union: `"sprite"` (texture atlas reference), `"text"` (label content), `"impostor"` (pre-rendered capture reference).
- LOD decision logic — given camera distance and configured thresholds, determine: full mesh, billboard, or culled. This is pure math, no rendering dependency.
- `CameraSnapshot` — a platform-agnostic readonly struct that the web host writes once per frame and the `BillboardSystem` reads. Contains: position (`x, y, z`), forward direction (`x, y, z`), frustum planes (6 plane normals + distances), viewport dimensions (`width, height` in pixels), and vertical field-of-view (radians). This is the canonical input boundary for all LOD and culling decisions in runtime-core. The web host creates it by reading the Three.js camera each frame. Future screen-size-based LOD (switching based on projected pixel height rather than world distance alone) uses `CameraSnapshot.viewport` + `CameraSnapshot.fov` to compute screen coverage without importing any rendering API.

**In web target (Three.js/WebGPU presentation):**

- `BillboardRenderer` — reads `BillboardComponent` state from the ECS and manages the actual Three.js objects. For sprite billboards: instanced quad meshes with texture atlas UVs. For text billboards: CSS-positioned DOM elements projected from world space (same technique as Drei's Html component, but without React). For impostor billboards: pre-rendered render-to-texture captures stored in an atlas.
- Instanced rendering — sprite and impostor billboards use `THREE.InstancedMesh` with a shared quad geometry and a texture atlas material. One draw call per atlas page, regardless of billboard count.
- CSS text billboards — for text/label billboards, DOM elements are positioned via `camera.project()` each frame. These are separate from instanced sprite billboards and have higher per-element cost, so they're appropriate for dozens of labels (debug overlays, nameplates) but not thousands.

**Asset resolution and ownership:**

The `BillboardDescriptor` references assets by ID (`atlasId`, `frameIndex`, `captureId`), not by texture handle. A `BillboardAssetRegistry` in the web target is the single owner of the ID → GPU resource mapping. It is responsible for:

- **Resolving IDs to textures.** `atlasId` → a `THREE.Texture` (or atlas page). `captureId` → an impostor render-to-texture result. The registry is the only place that performs this lookup.
- **Lifecycle and disposal.** The registry ref-counts texture usage. When the last billboard referencing an atlas page is removed, the registry disposes the texture. The `BillboardRenderer` never creates or disposes textures directly — it asks the registry for a texture handle given an ID.
- **Preview fallback.** In Preview mode, atlas packing may not have run. The registry falls back to loading individual sprite textures by convention path (e.g. `assets/sprites/{atlasId}/{frameIndex}.png`). In published builds, it loads pre-packed atlas pages from the bundle.
- **Impostor capture storage.** Impostor captures (render-to-texture snapshots of 3D models) are produced by a separate capture pipeline (future epic) and stored in the registry keyed by `captureId`. The registry owns the `THREE.RenderTarget` and resulting texture.

The registry lives in the web target, not runtime-core. Runtime-core descriptors reference IDs only — they never hold texture handles, GPU resources, or platform-specific references.

### Performance requirements

- **Sprite/impostor billboards:** must support 5,000+ instances at 60fps on mid-range hardware (M1 MacBook Air, integrated GPU desktop). Instanced rendering is mandatory.
- **Text/label billboards:** must support 50+ simultaneous DOM-positioned labels without dropping below 60fps. World-to-screen projection must be batched (single matrix multiply per billboard, not full unproject pipeline).
- **Frustum culling:** billboards outside the camera frustum must not generate draw calls or DOM updates.
- **Atlas management:** sprite/impostor textures are packed into atlas pages. Atlas packing is a build/compile-time step for published content; runtime can use individual textures during Preview with lazy atlas generation.

### Reference implementations

Best practices drawn from:

- **Unreal Engine** — impostor system captures meshes to billboard cards at build time. Runtime swaps based on screen-space size, not world distance alone. Foliage uses hierarchical instanced static meshes with billboard LOD at distance.
- **Unity** — `BillboardRenderer` component, `BillboardAsset` for pre-baked billboard data. SpeedTree integration uses billboard LOD with crossfade. HDRP uses impostor atlas baking.
- **Three.js community** — `drei`'s `Billboard` component (auto camera-facing via `lookAt`), `Html` component (CSS-positioned DOM from world coordinates), `Instances`/`Merged` for instanced rendering.
- **Open source** — Godot's `Sprite3D` and `Label3D` nodes, Bevy's billboard plugin patterns.

Key takeaway from all engines: billboard orientation (spherical vs cylindrical vs fixed-axis) must be configurable per billboard. Foliage typically uses cylindrical (rotate around Y only, don't tilt with camera pitch). Debug labels use spherical (always face camera). Impostor cards may use fixed orientations captured from multiple angles.

---

## Stories

### Story 26.1 — BillboardComponent and BillboardDescriptor in runtime-core

**Tasks:**

1. Create `packages/runtime-core/src/billboard/index.ts`.
2. Define `BillboardDescriptor` as a discriminated union:
   ```typescript
   type BillboardDescriptor =
     | { kind: "sprite"; atlasId: string; frameIndex: number }
     | { kind: "text"; content: string; style?: BillboardTextStyle }
     | { kind: "impostor"; captureId: string; angles: number }
   ```
3. Define `BillboardComponent` extending `Component`:
   ```typescript
   class BillboardComponent implements Component {
     type = "Billboard";
     descriptor: BillboardDescriptor;
     orientation: "spherical" | "cylindrical" | "fixed";
     displayMode: "overlay" | "world-occluded";  // overlay = always visible, world-occluded = hidden behind geometry
     size: { width: number; height: number };
     offset: { x: number; y: number; z: number };  // offset from entity position
     lodThresholds?: { billboard: number; cull: number };  // distances in world units
     visible: boolean;  // computed by BillboardSystem
     lodState: "full-mesh" | "billboard" | "culled";  // computed by BillboardSystem
   }
   ```
4. Define `BillboardTextStyle` for text billboards: fontSize, color, backgroundColor, padding, maxWidth.

**Acceptance:**

- Component and descriptor types compile and are exported from runtime-core.
- No rendering dependencies in runtime-core.

---

### Story 26.2 — CameraSnapshot and BillboardSystem (LOD and visibility decisions)

**Tasks:**

1. Define `CameraSnapshot` in `packages/runtime-core/src/billboard/`:
   ```typescript
   interface CameraSnapshot {
     readonly position: { x: number; y: number; z: number };
     readonly forward: { x: number; y: number; z: number };
     readonly frustumPlanes: ReadonlyArray<{ nx: number; ny: number; nz: number; d: number }>;  // 6 planes
     readonly viewport: { width: number; height: number };  // pixels
     readonly fov: number;  // vertical FOV in radians
   }
   ```
   This is the canonical, platform-agnostic input boundary for all LOD and culling decisions. No Three.js types.
2. The web host creates a `CameraSnapshot` once per frame by reading the Three.js camera and passes it to `BillboardSystem.update(world, delta, cameraSnapshot)`.
3. Create `BillboardSystem` extending `System`.
4. Each frame, query all entities with `BillboardComponent` and `Position`.
5. For each billboard entity, compute distance to `cameraSnapshot.position`.
6. Apply LOD thresholds: if distance < `billboard` threshold → `lodState: "full-mesh"`, if between `billboard` and `cull` → `lodState: "billboard"`, if beyond `cull` → `lodState: "culled"`.
7. Apply frustum culling using `cameraSnapshot.frustumPlanes`: sphere-frustum check (billboard center + half-diagonal radius), not per-vertex clipping. Set `visible: false` for culled billboards regardless of LOD state.
8. Future-compatible: screen-size LOD can be added later by computing projected pixel height from `cameraSnapshot.viewport`, `cameraSnapshot.fov`, and world-space distance — all available on the snapshot without importing any rendering API.
9. System does NOT create or manage rendering objects — it only writes to component state.

**Acceptance:**

- `CameraSnapshot` is a pure data type with no Three.js or DOM imports.
- LOD state transitions correctly based on distance.
- Frustum-culled billboards are marked invisible.
- System has no Three.js or DOM dependencies.
- Unit tests verify LOD transitions and frustum culling with mock `CameraSnapshot` + position data.

---

### Story 26.3 — BillboardAssetRegistry (web target)

**Tasks:**

1. Create `targets/web/src/billboard/BillboardAssetRegistry.ts`.
2. The registry maps `atlasId` → `THREE.Texture` and `captureId` → `THREE.Texture`.
3. Implement `resolve(descriptor: BillboardDescriptor): { texture: THREE.Texture; uv: UVRect } | null` — returns the GPU-ready texture and UV region for a given descriptor, or null if the asset is not loaded.
4. Implement ref-counting: `acquire(id)` / `release(id)`. When ref count drops to zero, schedule disposal (with a short grace period to avoid thrashing on rapid add/remove cycles).
5. Preview fallback: when an `atlasId` has no pre-packed atlas, load the individual texture from a convention path. Log a warning so authors know atlas packing hasn't run.
6. The `BillboardRenderer` calls `registry.resolve()` to get textures. It never loads or creates textures itself.
7. Disposal: `registry.dispose()` releases all textures. Called when the gameplay session ends.

**Acceptance:**

- Textures are loaded once and shared across all billboard instances referencing the same atlas.
- Ref-count disposal works — textures are freed when no longer referenced.
- Preview fallback loads individual textures without crashing when no atlas exists.
- The renderer has zero texture management code — it only calls the registry.

---

### Story 26.4 — BillboardRenderer for sprite/impostor billboards (web target)

**Tasks:**

1. Create `targets/web/src/billboard/BillboardRenderer.ts`.
2. For each active sprite/impostor billboard (`lodState: "billboard"`, `visible: true`), render an instanced quad.
3. Use `THREE.InstancedMesh` with a shared `PlaneGeometry` and a `MeshBasicNodeMaterial` (or `SpriteNodeMaterial` if available in Three.js WebGPU).
4. Billboard orientation:
   - `"spherical"`: quad always faces camera (set instance matrix from camera quaternion).
   - `"cylindrical"`: quad rotates around world Y axis to face camera, does not tilt.
   - `"fixed"`: quad uses a static orientation (for pre-captured impostor angles).
5. Atlas UV mapping: each instance's UV is set based on `atlasId` + `frameIndex`. For Preview mode without atlas packing, fall back to individual textures with one draw call per texture.
6. Update instance matrices and visibility each frame from `BillboardComponent` state.
7. Pool and reuse `InstancedMesh` instances — do not create/destroy meshes per frame.

**Acceptance:**

- 1,000 sprite billboards render at 60fps on M1 MacBook Air.
- Cylindrical orientation works correctly for foliage (no pitch tilt).
- Spherical orientation works correctly for camera-facing quads.
- Frustum-culled instances produce no draw calls.

---

### Story 26.5 — Text billboard renderer (web target, DOM-positioned)

**Tasks:**

1. Create `targets/web/src/billboard/TextBillboardRenderer.ts`.
2. For each active text billboard, create and manage a DOM element positioned via CSS `transform` based on world-to-screen projection.
3. Projection: `worldPosition.project(camera)` → NDC → pixel coordinates. Apply billboard offset in world space before projecting.
4. Pool DOM elements — reuse elements for billboards that appear/disappear rather than creating/destroying DOM nodes.
5. Hide DOM elements for billboards that are frustum-culled or `visible: false`.
6. Batch the projection math: compute view-projection matrix once per frame, multiply per billboard.
7. Style text billboards using `BillboardTextStyle` — font size, color, background, padding. Default style: small monospace, semi-transparent dark background with rounded corners.
8. Z-ordering: set `z-index` based on projected depth so nearer labels render above farther ones.
9. Occlusion behavior is configurable per billboard via a `displayMode` field on `BillboardComponent`:
   - `"overlay"` (default for debug labels, nameplates): always visible as a screen-space overlay. Not occluded by world geometry. Labels behind walls still show. This is the correct behavior for debug HUD billboards — you need to see NPC state regardless of line-of-sight.
   - `"world-occluded"`: hidden when the entity's world position is behind geometry from the camera's perspective. Requires a depth check — the web host reads the depth buffer at the projected screen position and compares against the billboard's projected depth. This is the correct behavior for gameplay UI markers (e.g. interaction prompts that should disappear when the NPC walks behind a building).
   - For v1, implement `"overlay"` only. `"world-occluded"` is a stretch goal that requires depth buffer readback, which has performance implications on WebGPU. Document the depth-check approach but defer implementation.

**Acceptance:**

- 30 text billboards update at 60fps without measurable overhead.
- Labels track entity positions smoothly as entities and camera move.
- Labels in `"overlay"` mode are visible even when the entity is behind geometry.
- DOM elements are pooled — no DOM thrashing.

---

### Story 26.6 — LOD enforcement: the web host as single authority

The `BillboardSystem` (runtime-core) writes `lodState` to the component. The web host is the **single enforcer** that reads `lodState` and ensures exactly one render path is active at a time. No other layer may hide or show meshes or billboards for LOD purposes.

**Tasks:**

1. In the web host render loop, after `BillboardSystem.update()` runs, iterate all entities with `BillboardComponent`.
2. For each entity, read `lodState` and enforce:
   - `"full-mesh"` → full Three.js mesh visible, billboard instance hidden.
   - `"billboard"` → full Three.js mesh hidden (`mesh.visible = false`), billboard instance visible.
   - `"culled"` → both hidden.
3. The enforcement is a single pass in the web host — not split between `BillboardRenderer` and scene object management. One function, one loop, one authority.
4. The `BillboardRenderer` and `TextBillboardRenderer` do NOT independently decide visibility. They only render instances that the LOD enforcer has marked active.
5. Edge case: if an entity has no `BillboardComponent`, its mesh is always visible (no LOD). If an entity has a `BillboardComponent` but no full mesh (e.g. a pure text label), `lodState` only controls the billboard, not a mesh.
6. Transition: when `lodState` changes between frames, the enforcer applies the new state immediately. Crossfade (alpha blending between mesh and billboard during transition) is a stretch goal for a later story, not required for v1.

**Acceptance:**

- At no point are both the full mesh and the billboard visible simultaneously for the same entity.
- At no point are both hidden when `lodState` is `"full-mesh"` or `"billboard"`.
- The enforcer is a single, auditable function in the web host — not distributed across multiple systems.
- Entities without `BillboardComponent` are unaffected.

---

### Story 26.7 — Integration with gameplay session and render loop

**Tasks:**

1. Instantiate `BillboardSystem` in the ECS world (runtime-core side).
2. Instantiate `BillboardRenderer` and `TextBillboardRenderer` in the web host render loop.
3. Pass camera position and frustum planes to `BillboardSystem.update()` each frame.
4. After `BillboardSystem` updates component state, run the LOD enforcer (Story 26.5), then `BillboardRenderer` and `TextBillboardRenderer` update their visible instances.
5. Expose a `createBillboard(entity, descriptor, options)` API on the gameplay session or scene controller for easy billboard creation.
6. Ensure billboards are disposed when entities are removed or the session ends.

**Acceptance:**

- Billboards appear and track entities in the Preview viewport.
- Billboards are cleaned up on session end.
- The integration does not break existing render pipeline or gameplay systems.

---

### Story 26.8 — Foliage billboard foundation

**Tasks:**

1. Define a `FoliageBillboardAsset` type: texture path, size, tint color, wind sway amplitude.
2. The landscape system can place foliage billboard instances at authored positions.
3. Foliage billboards use cylindrical orientation and have LOD thresholds configured per asset type.
4. Wind sway: vertex shader applies a simple sine-based horizontal offset to the top vertices of each quad, parameterized by time and per-instance random phase. Implemented in the `MeshBasicNodeMaterial` via Three.js TSL nodes.
5. This story provides the foundation — actual foliage placement UI and authoring is a separate epic.

**Acceptance:**

- Foliage billboards render with cylindrical orientation.
- Wind sway animates naturally and does not cause visible popping or synchronization artifacts.
- 2,000 foliage billboards render at 60fps.

---

## QA gates

- [ ] 5,000 sprite billboards at 60fps on M1 MacBook Air.
- [ ] 50 text billboards at 60fps with smooth tracking.
- [ ] LOD transitions are correct and do not cause visual popping (crossfade is a stretch goal, not required for v1).
- [ ] Frustum culling eliminates draw calls for off-screen billboards.
- [ ] Cylindrical orientation works for foliage (no pitch tilt).
- [ ] Spherical orientation works for labels (always faces camera).
- [ ] No runtime-core code imports Three.js or DOM APIs.
- [ ] Billboard disposal is clean — no leaked meshes, DOM nodes, or textures.
- [ ] All existing tests pass — no regressions.

## Relationship to other plans

- **Plan 024 (Spatial Grounding)** — spatial debug overlay requirement is satisfied by combining this billboard system with Plan 027's debug HUD.
- **Plan 027 (Debug HUD)** — Story 27.5 uses text billboards from this epic for entity debug labels.
- **Future foliage/vegetation epic** — will use the foliage billboard foundation from Story 26.6.
- **Future LOD epic** — will use impostor billboard captures for distance-based mesh replacement.
