# ADR 028: Instanced Rendering of Repeated Placed Assets

Status: **Accepted**

Date: 2026-07-15

Written after a live-scene investigation found the preview at ~30fps (down
from ~60), then hardened by **three rounds** of independent adversarial
code review. Round 1 killed an over-scoped "unify the render loops"
decision and forced a three.js primitive evaluation. Round 2 verified
`BatchedMesh` is a real WebGPU+node primitive but surfaced two integration
risks. Round 3 confirmed convergence and made the case -- accepted here --
to **default to `InstancedMesh` and treat `BatchedMesh` as a deferred
culling optimization**, because InstancedMesh clears the integration risks
at lower cost. Every load-bearing claim is verified against terminal code /
the installed `three@0.183.2` build.

## Context

Verified (code + live scene, re-checked across three reviews):

- The **Scatter Brush** (Plan 065.2) commits one flat `PlacedAssetInstance`
  per stamp; each resolves to one `SceneObject`
  (`runtime-core/src/scene/index.ts:125-131`, `.map`, no grouping) and
  renders as a full GLB clone (`targets/web/src/runtimeHost.ts:1980` loop
  -> `cloneSkinnedObject(gltf.scene)` `:2017`). ~99 x 4-submesh lavender,
  all `castShadow` -> ~396 main + ~396 shadow draws, none instanced.
- **Grass scatter is fine** (GPU compute -> `THREE.InstancedMesh` with a
  node material, `render-web/src/scatter/`); it is the repo's existing,
  battle-tested InstancedMesh-node path.
- `representationKey` (`scene/index.ts:302`) =
  `asset:{assetDefinitionId}:{assetKind}:{sourcePath}:{shaderRepresentationKey}`;
  groups identical placements, excludes `instanceId`, and excludes model
  height (`targetModelHeight: null`, `:293`). It also excludes the painted
  mask: `surfaceStackRepresentation` (`:237-259`) omits `layer.mask`, so two
  instances differing only by painted `maskTextureId` collide to one key
  (Gate 2).
- The two hosts are **not symmetric**: the studio has a mature async
  reconciler (`authoringViewport.ts:394/411/440`); the game **has none** --
  builds placed assets once in `start()`, never reconciles. "Unify the
  loops" is a rewrite, not a dedupe -- OUT of scope.
- Studio picking walks to the `instanceId`-named root
  (`hit-test-service.ts:110-123`) and reads `intersect.object`, never an
  instance index -- so any instancing breaks selection until picking reads
  the per-instance index.

## Evaluation: which primitive (verified against three@0.183.2)

Both extend `Mesh` (`three.core.js:24333`, `:25771`), so the repo's
material-apply traverse (`applyShaderToRenderable.ts:155`,
`if (!(child instanceof THREE.Mesh)) return`) reaches **either** and swaps
its `.material`; a node material then applies the per-instance transform in
its vertex stage (`setupPosition`: `instancedMesh().toStack()`
`three.webgpu.js:21205` / `batch().toStack()` `:21200`).

- **`InstancedMesh`** -- one geometry + one material + N instance matrices;
  a 4-material GLB = 4 InstancedMeshes (~4 material batches). Whole-mesh
  frustum cull (no per-instance culling). Picking -> `intersect.instanceId`
  (`three.core.js:24604`). Edit -> `setMatrixAt`; delete -> compact/rebuild
  the instance buffer. **The repo already ships this node path (grass
  scatter), so the material-apply risk is near-zero.**
- **`BatchedMesh`** -- also one material per batch (so also ~4 batches), but
  adds **per-instance frustum culling** (`perObjectFrustumCulled`,
  `three.core.js:27092`) and built-in `addInstance`/`deleteInstance`.
  Costs: up-front `maxInstanceCount`/`maxVertexCount`; a `_validateGeometry`
  uniform-attribute invariant; ownership of internal GPU textures to
  dispose; picking -> `intersect.batchId`; and the per-instance node path is
  less-trodden.

**Decision: default to `InstancedMesh`-per-submesh; `BatchedMesh` is a
deferred culling optimization.** Both hit the perf goal identically (~4
material batches, state-change collapse). BatchedMesh's *only* net win here
is per-instance culling -- which is (a) already deferred (Decision 6), and
(b) only per-*batch* for a multi-material GLB anyway. Leading with
InstancedMesh clears the material-apply risk via existing precedent and
sidesteps the capacity guess, the attribute invariant, and the GPU-texture
disposal entirely. `BatchedMesh` gets adopted when per-instance culling
becomes the bottleneck (paired with the deferred grass-pipeline unify).

Patterns: **Flyweight**, **scene-description vs render-representation**,
**Strategy** (individual clone / instanced group / GPU scatter).

## Decision

1. **Repeated identical placements render via a shared builder that
   realizes them as `InstancedMesh`-per-submesh (one InstancedMesh per
   submesh material, per-instance world matrix =
   `instanceTransform * submeshLocalMatrix`), never per-instance clones.**

2. **Ship the shared builder as something both hosts CALL, decoupled from
   lifecycle unification.** The game has no reconciler and needs none for
   this fix; merging the two lifecycles is a separate, out-of-scope,
   non-deploy-blocking refactor.

3. **Grouping is DECLARED as the target, inferred (by an extended
   `representationKey`, Gate 2) as the interim.** The realization type
   leaks into picking (`intersect.instanceId`) and edit (`setMatrixAt` /
   instance-buffer compaction) -- honest coupling, rewritten if/when the
   primitive is later upgraded to `BatchedMesh`.

4. **Strategy realization.** Instanced group for static, shared-surface,
   same-mask repeats; individual clone for unique assets, characters/NPCs,
   skinned/animated, and per-instance-surfaced instances; GPU scatter for
   cards.

5. **Instancing and this epic's Surface Brush are mutually exclusive per
   instance -- ENFORCED by Gate 2.** `surfaceStackRepresentation` must be
   extended to include `painted.maskTextureId`, so painting a surface on one
   plant changes its key and splits it from the group. Without Gate 2 they
   would silently share one mask texture and cross-contaminate paint -- so
   it is a prerequisite, not a nicety. (The Surface Brush mints a fresh
   per-instance mask, `surface-brush.ts:185`, so instances are genuinely
   distinguishable once the key includes it.)

6. **Per-instance CULLING is deferred** (it arrives with the `BatchedMesh`
   upgrade and/or the grass-pipeline unify; Plan 068.13 Deferred; trigger:
   next vertical pass post-deploy). Interim instancing uses whole-mesh
   frustum culling.

## Consequences

- **Two things 068.13a must implement (now low-risk, not existential
  gates):** (Gate 1) confirm a node surface material, applied through the
  existing traverse path, renders per-instance correctly on an
  `InstancedMesh` built by the builder -- expected to work since it is the
  grass-scatter node path, but verify with a painted surface (uv1 sampling
  on the shared geometry); (Gate 2) extend `surfaceStackRepresentation` with
  `painted.maskTextureId`. NOTE: this widens the SCENE staleness key
  (`appliedShaderSignature` / `computeSceneDelta`), which is benign --
  `maskTextureId` is stable, only pixels change (via the live registry).
  It does **not** touch the material cache, which already keys on the full
  mask (`ShaderRuntime.ts` `surfaceStackSignature:285-327`) -- the earlier
  "coordinate with ADR 027 material cache" caveat was misdirected.
- Verifies (pinned 99-lavender scene): batched main AND **shadow** pass
  collapse (confirm what `inventory.mjs` counts -- the WebGPU backend loops
  `drawIndexed` per visible instance in one pass with state set once, so the
  real win is state-change collapse, not a literal "~4 calls"); correct
  surface/appearance/position; painting one grouped instance re-surfaces
  only it with its own mask texture (Gate 2), siblings untouched.
- Studio picking/gizmo (068.13b) reads `intersect.instanceId`, edits via
  `setMatrixAt`, deletes via instance-buffer compaction/rebuild.
- Attribute invariant note: all group members share one source GLB, so
  their geometries (incl. the `uv1` paint channel + vertex color) are
  identical -- safe to instance. (This invariant is what `BatchedMesh`
  enforces via `_validateGeometry`; InstancedMesh gets it for free.)
- `BatchedMesh` upgrade (per-instance culling), lifecycle unification, and
  the grass-pipeline unify (LOD) are their own future plans, not here.

## Sources

- [Instanced Static Mesh Component -- Unreal Engine 5.8 Docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/instanced-static-mesh-component-in-unreal-engine)
- [Foliage Mode -- Unreal Engine 5.8 Docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/foliage-mode-in-unreal-engine)
- `three@0.183.2` `InstancedMesh` / `BatchedMesh` API + WebGPU/node support
  verified against the installed build (`three.core.js`, `three.webgpu.js`).
