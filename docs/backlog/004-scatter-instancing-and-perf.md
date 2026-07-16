# Backlog: Scatter instancing + perf follow-ups

**Source:** Open items after the Plan 068 instancing / perf arc (2026-07-15).
068.13a shipped (game runtime instances repeated scatter-brushed placed
assets -> preview 30->45fps). These are the undone tasks, banked here
because the session task list is ephemeral. Items also tracked in a plan/ADR
note it; this doc is the single "what's left" snapshot.

## Items

### 1. Shared, clean renderable-lifecycle reconciler (refactor)

**Priority:** High (real structural debt; unblocks #2, eases culling/LOD).

The renderable build+lifecycle is hand-rolled twice: `targets/web/src/
runtimeHost.ts` builds placed assets once with NO reconciler; `apps/studio/
src/viewport/authoringViewport.ts` has a fragile per-`instanceId` async
reconciler (generation counters, `pendingRenderableLoads`, in-flight-load
races, transform-in-place). It is too fragile to safely extend for
instancing -- which is itself the refactor smell (nikki, 2026-07-15).

**Action:** Extract ONE shared, testable reconciler both hosts use, with a
first-class notion that a renderable MAY be a group (`InstancedMesh`), not
just one-object-per-`instanceId`. This is the "lifecycle unification" ADR
028 Decision 2 deferred as out of scope for the perf hotfix. Scope as its
own plan; it should pass `/epic-review`.

### 2. Studio viewport instancing -- Plan 068.13b

**Priority:** Med (studio authoring fps; not deploy-blocking). Blocked by #1.

Route `authoringViewport.ts` through the shared `buildInstancedAssetGroup`
(`packages/render-web/src/instanced-group.ts`) and add instanced
picking/edit. Reading (2026-07-15) found the gizmo + command path need ZERO
change (they work on transform VALUES by `instanceId`, `layout-workspace.ts`
`getTransform`/`onCommit`); picking is small (InstancedMesh hit ->
`hit.instanceId` -> the builder's index->instanceId map on the mesh
userData, `hit-test-service.ts:110-123`). The blocker is the fragile
reconciler (#1): group-aware transform-reflect via `setMatrixAt` + rebuild
on membership change. Also in `docs/plans/068-asset-surface-scoping.md`
(068.13b).

### 3. Declared scatter groups -- Plan 068.13c

**Priority:** Med (polish on 13a's inferred grouping).

Scatter Brush records a `scatterGroupId` on stamped instances (source of
truth); the shared builder keys on the declared group instead of inferring
by `representationKey`; migrate existing scenes (fall back to inference).
Split-on-surface semantics per ADR 028 Gate 2. Also in plan 068 (068.13c).

### 4. Per-instance culling / LOD -- `BatchedMesh` upgrade + grass-pipeline unify

**Priority:** Deferred (next vertical pass, AFTER the sandbox deploys).

Interim instancing (068.13a) uses `InstancedMesh` with whole-mesh frustum
culling. Per-instance culling/LOD comes from upgrading to `BatchedMesh`
(`perObjectFrustumCulled`) and/or unifying model-scatter into the grass GPU
compute pipeline (mark/scan/compact + LOD bins). Sharp edge: multi-submesh
GLB on one visibility set. Also in plan 068 Deferred + ADR 028 Decision 6.

### 5. Preview live-resync (avoid full `host.start` teardown on edits)

**Priority:** Med (real authoring UX papercut).

`preview.tsx` re-invokes `host.start()` on any `PREVIEW_BOOT`, which is not
idempotent -- a genuine authoring edit while a preview runs hard-restarts
the previewed game (loses progress). Deferred from the New-Game restart fix
(commit 046f23c). Split initial-boot from live-resync: push content changes
into the running host without tearing it down.

### 6. Material-count regression budget test (low)

**Priority:** Low / optional.

A headless CI test that asserts N painted-scatter assets stay within a
distinct-material budget. Its original motivation (a material-multiplication
regression) turned out NOT to be the real perf bug, and the perf-harness
live inventory now covers ad-hoc regression detection, so this is optional.
Keep only if a CI alarm for material fragmentation is wanted.
