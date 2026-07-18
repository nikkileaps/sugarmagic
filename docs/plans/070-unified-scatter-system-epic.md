# Plan 070 — One Scatter System (renderable lifecycle + scatter pipeline + render perf)

Status: DRAFT — pending /epic-review (do not build stories until Locked)
Owner: nikki + claude
Date: 2026-07-18

Related:
- Plan 068 (surface authoring; 068.13a shipped the shared InstancedMesh builder + game-runtime instancing; 068.13b/c deferred to here)
- Plan 069 (collision + navigation; its perf probe attributed the frame: update ~0.18ms, render ~27ms)
- Backlog: #350 (reconciler), #349 (scatter groups), #347 (HISM/culling/LOD), #360 (instanced masks), #348 (studio instancing), #345 (preview resync — partial), #344 (material budget — reframed)
- Backlog kept OUTSIDE this epic: #345a PREVIEW_BOOT debounce (standalone quick win), #355 camera left-turn stutter (bug; re-aim after 070.1's measurements)

---

## Why now (measured, not vibes)

The game preview runs ~35-38fps. The 069 frame probe split the frame: `world.update` 0.05ms, `session.update` 0.13ms, `rest(render)` ~27ms — the cost is ENTIRELY render-side. The perf harness (packages/perf-harness/README.md) showed the real scene hits ~30fps at only ~596 draws / 665k tris while a synthetic plain-three load needs ~16k draws to get that slow — the cost is engine machinery, not raw draw/tri count.

Grooming (2026-07-18) re-read the render code and CORRECTED two stale assumptions:

- Model-scatter is NOT CPU-rebuilt per frame. Since 068.13a the game host batches same-representation placements into `THREE.InstancedMesh` with matrices baked once (`packages/render-web/src/instanced-group.ts:123-133`); per-frame cost is zero.
- "Material multiplication" does not exist in the common case. `ShaderRuntime.acquireMaterial` caches by signature and refcounts — N identical brushed plants share ONE material. The per-frame `ensureShaderSetsAppliedToRenderables` loop (targets/web/src/runtimeHost.ts:1608) has a cheap fast path (precomputed `representationKey` string compare).

So the ~27ms is UNATTRIBUTED. Known real problems in the same seam:

1. **Scattered fields cast no shadows** — deliberately disabled because one InstancedMesh has a single field-spanning bounding sphere that survives every CSM cascade cull and re-renders all instances into all cascades (~3-4x shadow-pass geometry). See the in-code note at `targets/web/src/runtimeHost.ts:2076-2085`. Restoring shadows requires spatial chunking (HISM).
2. **No culling/LOD on model-scatter** — every instance always drawn; fine at hundreds, walls at scale. The grass pipeline already does GPU culling + LOD bins per frame (`packages/render-web/src/scatter/compute-pipeline.ts:932-956`, 4 compute dispatches per camera; candidates recompute only on edit).
3. **Two renderable lifecycles** — the studio viewport reconciles incrementally (`apps/studio/src/viewport/authoringViewport.ts`: `computeSceneDelta` + objectMap/pending/generation) while the game host builds `sceneObjectEntries` wholesale per `start()` with no reconcile at all. Every renderable feature lands twice or diverges (069 grew navmesh viz on the studio fork and instanced groups on the game fork). `instanced-group` has ZERO studio references.
4. **Every authoring edit reboots the preview** — `PREVIEW_BOOT` re-posts on every `session` change (apps/studio/src/App.tsx, effect deps include `session`), and `host.start()` is all-or-nothing: full dispose + rebuild (~200-300ms per edit in preview).
5. **Local-space gradient/height masks render flat on instanced assets** — all instances share one geometry, so `positionLocal`-based masks sample identically per instance (`packages/render-web/src/materialize/mask.ts:76-81`); a ShaderRuntime comment already documents `positionWorld` being unreliable on the instanced NodeMaterial path. Per the 068 lesson, instanced attributes must be read via `vertexStage`.
6. **Scatter has no data model** — every brushed plant is a full `PlacedAssetInstance` (`brushed: true`) in `region.placedAssets`; grouping is recomputed at render time by `representationKey` (runtimeHost ~2130). Region JSON grows by hundreds of loose instances per meadow, and there is no authored unit for chunking, group visibility, or group erase. Every region authored before a group model exists is future migration debt (069.4-style).

## The epic

ONE epic that makes scatter a first-class system end to end: measure the render frame, unify the renderable lifecycle behind a single reconciler, give scatter a domain data model, chunk instanced fields for culling/LOD/shadows, fix instanced-mask sampling, adopt instancing in the studio viewport, prove the reconciler with live preview resync, and leave a regression alarm.

Design principles (consistent with repo norms):
- Single enforcer: ONE renderable lifecycle both hosts consume; ONE scatter system (grass + model-scatter share the culling/LOD machinery — compose shared primitives, do NOT relocate either host's view).
- Data model before render features that depend on it (chunks key off groups, not heuristics).
- Measure before optimizing: story 1 attributes the 27ms so later stories aim at the real cost.
- Documents: additive, normalized-on-load, aliases preserved (069.4 migration discipline).

## Scope boundaries

- NOT terrain/vertical (#376), not navmesh (069 owns it), not the StudioActions context (#373).
- #345a (debounce PREVIEW_BOOT) ships as a standalone task outside this epic — no dependency.
- #355 (left-turn stutter) stays a bug; 070.1's shadow A/B either folds it into 070.4's shadow work or spawns a targeted CSM fix.
- Grass AUTHORING (densities, brushes, painted masks) unchanged — only the render-side machinery unifies.

## Open questions (answer during epic-review rounds)

1. Chunk keying: spatial grid cells, authored scatter groups, or groups-then-grid-within-group? (Lean: chunk WITHIN a group by grid — groups are the authored unit, grid is the render unit.)
2. Reconciler API shape: does the game host adopt the studio's delta reconcile (computeSceneDelta) directly, or do both adopt a new shared module in render-web/runtime-core? Where does it live so one-way deps hold?
3. Scatter-group migration: are brushed `PlacedAssetInstance`s migrated INTO group documents with derived aliases (069.4 pattern), or do groups reference member instanceIds (lighter, no alias)?
4. Does unification mean model-scatter enters the grass GPU compute path (one pipeline), or a parallel HISM path sharing the culling primitives? (Decide from 070.1 data: if per-frame compute cost is already visible, don't add more dispatches.)
5. LOD for model-scatter: distance-swap to imposter/billboard like grass far-bin, or cull-only in v1?
6. What frame budget do we declare "done"? (Target: 60fps in the current sandbox scene with shadows ON for scattered fields.)

## Stories

**EXECUTION ORDER: 070.1 -> 070.2 -> 070.3 -> 070.4 -> 070.5 -> 070.6 -> 070.7 -> 070.8.**

### 070.1 — Render-frame attribution (measure first)

Extend the 069 frame probe + perf harness to split `rest(render)` into render-CPU (submission) vs GPU wait, and A/B the big suspects: shadows on/off (CSM cascade cost), grass compute on/off, landscape on/off. Also instrument the shadow pass while TURNING the camera (the #355 symptom; the in-code note at runtimeHost.ts:2076-2085 ties cascade re-splits to camera turns). Output: a table in this doc attributing the ~27ms, and a re-weighting of 070.4 if the data disagrees with the HISM thesis.
**Verify:** numbers in hand — each suspect's ms cost named; #355 either explained or explicitly not shadow-related.

### 070.2 — Shared renderable-lifecycle reconciler (#350)

Extract ONE reconciler (desired SceneObjects in -> delta -> load/update/dispose renderables) that both the studio authoring viewport and the game runtime host consume. The studio's incremental machinery (computeSceneDelta + objectMap/pending/generation, authoringViewport.ts) is the seed; the game host's wholesale `start()` build becomes "reconcile from empty". Instanced-group creation becomes a reconciler concern (grouping by representationKey happens inside it), so both hosts get instancing for free later. Respect the 068 lesson: compose shared primitives — each host keeps its own view/scene ownership.
**Verify:** both hosts render identically to before (no visual delta); the game host's start() routes through the reconciler; studio behavior unchanged; tests cover delta add/update/remove incl. instanced groups.

### 070.3 — Declared scatter groups: data model (#349)

`ScatterGroup` domain entity: id, displayName, assetDefinitionId (or member representation), member instances (per open question 3), authoring metadata (brush stroke provenance). Brush strokes create/extend groups; erase operates per-group-membership. Normalized on load; existing `brushed: true` loose instances migrate into groups (069.4 discipline: invisible round-trip, aliases if needed). Studio: groups appear in the scene explorer (visibility eye per group).
**Verify:** brush a stroke -> ONE group with N members in the document; old regions load with brushed plants grouped, byte-identical render; group eye hides the whole stroke; erase respects group membership.

### 070.4 — HISM chunking + culling/LOD + shadows (#347, re-scoped)

Chunk instanced fields spatially (grid within group, per open question 1) so each chunk has a real bounding volume: CSM cascade culling works again -> **re-enable shadows on scattered fields** (delete the enableShadows:undefined workaround at runtimeHost.ts:2076-2085 and its comment). Frustum culling per chunk. LOD per open question 5 (v1 may be cull-only). Aimed by 070.1's numbers — if CSM dominates, shadow-side fixes (cascade count/config) land here too.
**Verify:** scattered lavender casts shadows again; fps in the sandbox >= 070.1 baseline + measurable win (target 60fps per open question 6); walking the field edge shows chunks culling (draw count drops off-screen).

### 070.5 — Instanced mask sampling fix (#360)

Local-space gradient/height masks on instanced assets sample per-instance: inject the instance transform into the TSL mask path (`vertexStage` — instanced attributes read garbage in fragment stage, 068 lesson) so `space:"local"` masks evaluate against each instance's own frame; world-space masks pick up the true per-instance world position. Terminal line today: materialize/mask.ts:76-81 sampling shared `positionLocal`.
**Verify:** two scattered statues with a local gradient mask shade independently (the 2026-07-16 repro); world-space height mask varies across a field on a slope-painted ground; non-instanced assets unchanged.

### 070.6 — Studio viewport adopts instancing (#348)

The studio authoring viewport consumes the reconciler's instanced groups (zero instancing today — every brushed plant is its own Group). Picking/selection/gizmo edit on instanced members: raycast against the InstancedMesh, resolve instanceId, and on edit either patch the instance matrix or demote the member to a singleton while selected (decide in-story). Erase brush keeps working against instanced members.
**Verify:** a 500-plant meadow is smooth in the editor viewport; click one plant -> selects that instance; move it -> only it moves; erase swipes still remove brushed members.

### 070.7 — Preview live-resync (#345b) — the reconciler's acceptance test

The preview host applies session changes through the reconciler instead of full `dispose()`+`start()`: definition/placement edits update renderables in place (collision world + navmesh staleness re-derive as they already do per start — decide in-story what re-derives live vs on next boot). Structural changes (active region/scene switch) still full-boot. This story EXISTS to prove 070.2 on the game host.
**Verify:** with the preview running, move a placed asset in Layout -> it moves in the running game without a reboot (no Syncing overlay, player position preserved); switch regions -> clean full boot as today.

### 070.8 — Epic close: material/render stats + budget alarm (#344, reframed) + docs

Expose `ShaderRuntime.getMaterialStats()` (cache size, refcounts — cache is private today, renderer.info has no material count) + draw/chunk counts from the reconciler. Headless budget test that fails when material count or draw count regresses past a budget for a fixture scene. Perf-harness pass recording the epic's before/after. docs/api update (reconciler, scatter system, groups). Deferred-seam comments + backlog sweep.
**Verify:** budget test red when a hand-broken cache duplicates materials; docs read true against code; 070.1's table updated with the after numbers.

---

**NOTE:** Draft for /epic-review. Reviewer: distrust every file:line above and re-verify — the grooming read is 2026-07-18 and code moves.
