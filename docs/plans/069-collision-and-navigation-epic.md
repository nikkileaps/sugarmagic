# Plan 069 — Collision + Navigation (blocking, triggers, NPC pathfinding)

Status: Locked (epic-review passed 2026-07-16 — design 3 rounds, stories 2 further rounds, 5 total) — design AND story decomposition locked; stories execute as written in the stated EXECUTION ORDER (deviations need STOP + amendment + re-gate). Decision: ONE epic (nikki 2026-07-16), collision stories first, navigation after.
Owner: nikki + claude
Date: 2026-07-16

Related:
- Plan 024 (spatial-language grounding + region-area semantics — the `RegionAreaDefinition` volumes this extends)
- ADR 019 (engine vs game lifecycle split), the runtime ECS in `packages/runtime-core/src/ecs/`
- Deferred sibling epic: **Terrain modeling / gravity / uneven-ground traversal** (the *vertical* dimension — see "Scope boundaries" below). 069 deliberately does NOT depend on it.

---

## Purpose (the problem)

As the world fills with placed assets, two things are missing and both are load-bearing for it to feel like a game:

1. **Nothing blocks the player.** `MovementSystem` (`packages/runtime-core/src/ecs/systems/index.ts:39-76`) applies velocity straight to position on X/Z with no collision — the player walks through statues, walls, docks, everything.
2. **NPCs can't navigate.** `RuntimeNpcBehaviorSystem` (`packages/runtime-core/src/behavior/system.ts:341-667`) walks an NPC in a straight line toward a random point inside a target area, with stuck-detection but **no obstacle awareness** — its own comment (`:485-488`) says richer movement "belong[s] in a later locomotion/pathfinding layer." That layer is this epic.

## Two systems, not one

Nikki's question — "is collision the same as navmesh?" — has a definite answer: **no, they are two distinct systems that both derive from the same scene geometry but serve different consumers.**

- **Collision detection** is *runtime physical query*: "can this body move here, or does it hit something?" In Unreal every collidable object has an **object channel** plus a **response table** — Block (a wall stops you, fires a Hit), Overlap (you pass through but a trigger fires), or Ignore. Colliders are cheap **primitives** (box/sphere/**capsule** — the player is a capsule) or exact **mesh** colliders. This is what the *player* (and later physics/projectiles) uses, and it is also how **trigger volumes** work.
- **NavMesh** is a *precomputed walkable-surface graph* used for **AI pathfinding**. Unreal bakes it with **Recast** from the geometry inside an authored **NavMeshBoundsVolume**, eroded by the agent's radius/height; **Nav Modifier Volumes** mark sub-regions non-walkable or higher-cost. NPCs query it to find a route; collision still does the final "don't clip the corner" step.

They are **related** (both spatial, both regenerate when the scene changes) but have **different data structures and different owners** (player/physics vs. NPC AI). Practically we need **collision first** (player + props + triggers) and **navigation second** (NPCs routing around obstacles). This epic treats them as two pillars; /epic-review may choose to split them into two sequential epics given the size — flagged as an open question.

## What we're starting from (grounded)

Reuse anchors already in the tree:
- **`RegionAreaDefinition`** (`packages/domain/src/region-authoring/index.ts:181-194`) — authored box volumes (center + size), hierarchical, 7 semantic kinds. Already the "authored spatial volume" primitive.
- **`RegionAmbienceZone`** (`:157-165`) — box **trigger** volumes (on-enter / always). The seed of a general trigger/overlap system.
- **Spatial workspace ALREADY EXISTS** (`packages/workspaces/src/build/spatial/SpatialWorkspaceView.tsx`) — Build > Spatial, with an area list, Select + **Draw-Area** rectangle tools, and viewport overlay. Nikki's imagined UX ("go into Build > Spatial and define areas") is already the shipping pattern.
- **NPC locomotion exists** (`behavior/system.ts`) — has target resolution + stepping + stuck-detection; needs its straight-line step swapped for a pathfollow.
- **Asset bounds are computable** — `packages/render-web/src/asset-surface-bake.ts:74-88` already builds a `THREE.Box3` from an asset's meshes (today only for texture baking, not stored); the cleaner per-asset reuse target is `Box3.setFromObject` in `apps/studio/src/asset-pipeline/origin-correct.ts:68`.

Absent (the epic's actual work): runtime collision, a `Collider` ECS component, asset collision metadata, any navmesh/pathfinding, and vertical/ground-height (that last one is the terrain epic).

## Solution sketch

**Pillar A — Collision (player + NPC blocking + triggers).**
- Give each asset an optional **collider** (default: auto-fitted box from its local bounds via `Box3.setFromObject` — the exact math `correctAssetOriginToBottomCenter` uses, `apps/studio/src/asset-pipeline/origin-correct.ts:68`; authorable to sphere/capsule/convex, or "none" for decor). **Instanced repeats (068.13a) share one geometry**, so each instance needs its **own world-space collider** derived from its instance matrix (`packages/render-web/src/instanced-group.ts` already builds those per-instance transforms) — a broadphase reads those, not one shared local box.
- Resolve collision on the **moving bodies**, which today take TWO different paths (a real integration constraint): the **player** is advanced by `MovementSystem` inside `world.update(delta)` (`targets/web/src/runtimeHost.ts:1496`; system registered `:2489`) — a `CollisionSystem` after it is a clean seam. **NPCs** are moved by direct `Position` writes in the behavior system via `gameplaySession.update(delta)` (`runtimeHost.ts:1497`), which **bypasses the ECS system array entirely**. So collision resolution must span both paths (and cover NPC-vs-NPC / NPC-vs-player), not live solely in a post-`MovementSystem` step. A simple broadphase (grid/AABB) over instanced + singleton colliders keeps it cheap.
- **Resolution model: collide-and-slide** (the kinematic character-controller pattern every engine uses — PhysX CCT `move`, Godot `move_and_slide`): a blocked move deflects along the obstacle surface instead of dead-stopping, so hitting a wall at a shallow angle glides rather than sticks. This is the single biggest "feel" decision in Pillar A and is the named standard, not an implementation detail. Collision is **discrete** (no swept/CCD): player speed ~5 m/s with delta capped at 0.1s = max ~0.5 m/frame, so tunneling needs blockers/triggers thinner than ~0.5 m — keep authored volumes at >= ~0.5 m thickness (or clamp per-frame step) and defer CCD to a future fast-projectile need.
- **Trigger volumes** (fire quest/dialogue/audio on enter/exit): the runtime **already has a containment enforcer to extend** — `createSpatialAreaTracker` (`packages/runtime-core/src/spatial/index.ts:130`) does per-entity, per-frame area containment with hysteresis (`confirmationFrames`, default 3) and a `changed` edge flag, run by `createRuntimeSpatialResolverSystem` and already feeding quest/dialogue blackboard facts. Per the single-enforcer rule, trigger enter/exit EXTENDS this tracker rather than building a second previous-inside implementation. Real extension work: the tracker resolves ONE current area per entity, while overlapping trigger volumes need per-volume inside sets; and decide whether triggers share the 3-frame hysteresis or fire edge-exact. (The ambience-zone `on-enter` stub, `packages/runtime-core/src/audio/index.ts:250-251`, is dead code today and becomes a consumer of this. `containsPoint` in `spatial/index.ts:19` is module-private — reuse needs an export.)

**Pillar B — Navigation (NPC pathfinding).**
- Bake a **navmesh** from the region's collision geometry inside authored **nav-bounds volumes**, eroded by agent radius, using **`recast-navigation`** (npm package; `@recast-navigation/three` for the three.js helpers) — the same Recast/Detour library Unreal ships, as WASM. Industry-standard, not hand-rolled.
- **Nav modifier areas** (reusing the box-volume authoring) mark non-walkable / higher-cost regions.
- Store the baked navmesh as a per-region/scene **authored build artifact** — a binary blob in the asset-source store, referenced from the region/scene doc, produced by an offline "bake" action (same shape as our paint-UV / origin-correct bakes). It is authored, not player, state, so it does **not** go through a runtime SaveParticipant. At runtime NPCs **pathfind** across it, replacing the straight-line step. Decide explicitly: recast's built-in **`Crowd`** (path-following + agent avoidance) vs. a manual `NavMeshQuery.computePath` + custom stepper.

## Studio UX / authoring model

Two buckets the author holds in their head — the key design decision of this epic:

**Bucket 1 — object colliders (auto, attached to assets).** ~90% of collision. The author never draws a box: placing a prop auto-fits a collision box to its mesh (the bounds math the Auto Correct Origin already uses) and it's solid immediately. Tweak it on the asset via a **Collision** inspector section (shape: auto-box / capsule / sphere / convex / **none** for decor), base-or-scene scoped like 068's overrides. A Spatial "show colliders" toggle eyeballs them all. These are a property of the *object*, not a drawn region.

**Bucket 2 — a unified drawn "Volume" with attachable roles (in Build > Spatial).** PROPOSED design: the author draws one box (the Draw-Area *gesture* already exists in `SpatialWorkspaceView.tsx`, but is hard-bound to `CreateRegionArea` / `RegionAreaDefinition` — the unified Volume needs its own domain type + command, so the tool's dispatch is new work) and then checks what it *is* — one volume can wear several roles at once:
- **label** (semantic zone — today's `RegionAreaDefinition`: "the Market", used by NPC/quest/lore)
- **trigger** (fire quest/dialogue/sound on enter/exit — a *related* type exists (`RegionAmbienceZone`) but its enter/exit is unimplemented, so this role is greenfield; see Pillar A)
- **blocker** (invisible wall / out-of-bounds where no mesh exists), with a **direction** flavor — block-entry / block-exit / both
- **containment boundary** = a blocker with block-exit + a **condition**: "can't leave until X and Y." Reuses the existing condition grammar (`RegionBehaviorWorldFlagCondition`, `RegionBehaviorQuestBinding`) the NPC/quest systems already gate on — no new vocabulary.
- **nav-bounds** ("bake the navmesh inside here")
- **non-walkable** (nav carve-out: NPCs never path across this)

Volumes **nest** for free — `RegionAreaDefinition` already carries `parentAreaId` — so an outer "Ruined Keep" containing an inner gated "Throne Room" is just parent/child.

**Bake + visualize:** a **"Bake NavMesh"** action + viewport toggles to visualize the navmesh and colliders, built on the existing hit-test/overlay infra.

**Rejected alternative — typed volumes.** Keep `RegionAreaDefinition` as a pure label and add separate `CollisionVolume` / `NavBoundsVolume` / `NavModifierVolume` types (extend the status quo). Rejected because overlapping intents force overlapping parallel boxes and the type set sprawls; the unified role model expresses semantic zones, triggers, blockers, gated arenas, and nav data from one drawn primitive. (Cost of unified: migrating today's separate Area + AmbienceZone types into the role model.)

## Architecture & reuse

- **ECS / integration:** a `Collider` component + a collision-resolution pass that spans BOTH movement paths — the player's `MovementSystem` tick inside `world.update` (`runtimeHost.ts:1496`) and the NPC behavior system's direct `Position` writes via `gameplaySession.update` (`:1497`). (Open question: resolve in a shared pass, or unify the two movement paths first.) Plus a `NavAgent` / path component the NPC behavior system consumes.
- **Domain:** extend `AssetDefinition` with an optional collider (non-breaking, like `deform`/`effect`); the unified `Volume` type (below) rather than parallel typed volumes; a baked-navmesh artifact reference on the region/scene doc pointing at the blob store.
- **Authoring:** reuse the Spatial workspace + box-volume/gizmo tooling (new dispatch command for Volumes), `Box3.setFromObject` (`origin-correct.ts:68`) for auto-collider bounds, `containsPoint` / `findRegionAreaById` (`spatial/index.ts`) for containment tests, and the bake-action pattern (`paint-uvs` / `origin-correct`, invoked from `App.tsx`) for the navmesh bake.
- **Runtime:** `recast-navigation` (`@recast-navigation/three`) for bake + query; the NPC stepper becomes a path-follower (or a recast `Crowd` agent).
- **Where the collision world lives (layering):** in **runtime-core**, derived from **baked `AssetDefinition` bounds + `SceneObject` transforms** — the same inputs both hosts already consume. The `render-web` files cited above (`instanced-group.ts` matrices, `Box3.setFromObject`) are *bake-time / authoring-side* anchors, NOT runtime dependencies: runtime-core depends only on domain + three and must never read render-web. Collider bounds are computed once at import/bake and stored on the definition; per-instance world colliders come from `SceneObject.transform`. (No visual-drift hazard: `normalizeModelScale` applies only to player/NPC — `targetModelHeight` is null for placed assets, `runtimeHost.ts:2180` — and those agents collide via their **authored capsules**, which `SceneObject.capsule` already carries, `runtime-core/src/scene/index.ts:34`, not via mesh bounds.)
- **Single-enforcer invariant (locked, not open):** exactly ONE collision-resolution implementation exists, and BOTH movement paths (player `MovementSystem`, NPC behavior stepper) route through it; likewise exactly ONE containment/enter-exit enforcer (the extended `createSpatialAreaTracker`). Open question 7 below is only about *plumbing* (where the shared pass is called from), never about whether a second implementation may exist.

## New domain pieces (to be designed in stories, not here)

- **Object collider** on `AssetDefinition` (auto-box default; per-instance override, base/scene scoped). Agent radius/height need NOT be invented: `SceneObject.capsule` (`runtime-core/src/scene/index.ts:34`) already carries authored capsule specs for player + NPC — the collision layer consumes it.
- **Unified `Volume`** primitive with attachable **roles** (label / trigger / blocker / containment-boundary / nav-bounds / non-walkable), a **direction** flag on blocker/boundary roles (block-in / block-out / both), and an optional **condition** binding reusing `RegionBehaviorWorldFlagCondition` + `RegionBehaviorQuestBinding`. Nesting via the existing `parentAreaId`. **Migration:** fold today's `RegionAreaDefinition` (label role) and `RegionAmbienceZone` (trigger role) into this — a non-trivial part of the epic.
- **Collision response model** (block/overlap/ignore, scaled to our needs); **dynamic bodies** — the player AND NPCs are moving colliders (NPC-vs-NPC / NPC-vs-player), not just player-vs-static props; and a runtime **trigger** enter/exit event stream (extending the spatial-area tracker — see Pillar A).
- **Baked navmesh artifact** — a binary blob in the asset-source store referenced from the region/scene doc (authored build artifact, NOT a runtime SaveParticipant) + **path / nav-agent** runtime state; the NPC stepper becomes a path-follower (or a recast `Crowd` agent).

## Scope boundaries (and the terrain seam)

069 targets **flat ground** (the current `PlaneGeometry` at Y≈0). On flat ground it delivers real value: the player is blocked by props/walls, triggers fire, and NPCs path around obstacles. What it explicitly does NOT do — and what belongs to the **deferred terrain/gravity epic** — is the *vertical* dimension: ground-height sampling, walking up stairs/slopes, gravity, uneven terrain. The seam: collision resolution and navmesh both currently assume Y is flat; when the terrain epic lands, collision gains ground-follow + gravity and the navmesh bakes over 3D terrain (Recast already handles slopes/steps, so the nav side extends cleanly). 069 should leave those seams clean, not hard-code Y=0 assumptions that the terrain epic must rip out. **Agent shape:** on flat ground an XZ circle/AABB is sufficient; a full **capsule**'s vertical half-height is dead weight until the terrain epic adds gravity/ground-follow — so decide capsule-now vs. XZ-circle-now (open question) rather than assuming capsules.

Also explicitly deferred:
- **Camera collision** (camera clipping through walls): out of scope. The camera is a pure-math high-orbit rig (pitch 35-55 deg, distance 15-40), not an over-the-shoulder camera — wall clipping is rare at that framing. Revisit inside the authored-camera epic (task #357), where close shots make it real.
- **Projectiles / spell collision:** `CastableExecutor` is pure stat mutation today (no spatial casting exists); swept/CCD collision for fast movers is deferred until spells become spatial.
- **Navmesh bake staleness:** moving/adding a prop AFTER baking leaves a stale navmesh. 069 ships with a bake-invalidation warn (dirty flag on scene edits that touch colliders) — the authoring analog of the paint-UV bake staleness we already tolerate. RUNTIME dynamic obstacles (recast `TileCache` carving, which requires a **tiled** navmesh — so the solo-vs-tiled bake choice gates this) are deferred until something actually moves at runtime.

## Primary use cases (the epic must serve all of these)

1. The player is **blocked by placed props/walls** and **slides** along them at shallow angles (collide-and-slide).
2. **Invisible out-of-bounds walls** where no mesh exists (drawn blocker volumes, directional).
3. **Triggers** fire quest/dialogue/audio on enter/exit of a drawn volume.
4. **Conditional containment**: "can't leave this volume until X and Y" (block-exit + condition), e.g. a gated arena.
5. **NPCs path around obstacles** to their task areas instead of walking through/into props.
6. Authors **see and adjust** every collider and volume in the studio (auto-colliders on assets; drawn volumes in Build > Spatial; show-colliders/navmesh toggles).
7. **Bake + visualize the navmesh** with a manual action, like the other bakes.

Explicitly served by the existing proximity model, no new work: E-interact prompts and item pickups (both are radius-based, not raycast — colliders must merely not hold the player outside interaction radius, a story-level tuning note).

## Open questions (for /epic-review)

1. One epic or two? Collision (Pillar A) and Navigation (Pillar B) are distinct enough to split into sequential epics — is co-designing them worth keeping them together?
2. Collider default: auto-box-from-bounds for every asset, or opt-in per asset?
3. How faithful to Unreal's channel/response matrix do we go at our scale vs. a simpler blocker/trigger/none?
4. Navmesh bake trigger: manual "Bake" button (like our other bakes) vs. auto-on-save — and where the artifact reference lives (region doc vs. scene overlay), pointing at a blob in the asset-source store (authored build artifact, not runtime save state).
5. How much of the deferred terrain epic must land first for navmesh to be worth it (flat-ground navmesh is real, but modest)?
6. **Migration:** the unified `Volume` model (proposed above) subsumes today's `RegionAreaDefinition` + `RegionAmbienceZone`. Auto-upgrade existing regions on load via the established `normalizeRegionDocumentForLoad` / `@deprecated`-field pattern (`packages/domain/src/io`, `scenes/migrate.ts`), or keep the old types alongside the new roles? This is the biggest correctness risk in the epic — existing authored regions must not break.
7. **Two movement paths (plumbing only — the invariant is locked):** exactly one collision-resolution implementation, both paths route through it (see Architecture & reuse). Open: is the shared pass called from each path, or do we unify the player + NPC movement paths first?
8. **Agent shape:** capsule now vs. flat XZ-circle until the terrain epic (see Scope boundaries). Note `SceneObject.capsule` already carries authored radius/height either way.
9. **NPC locomotion:** recast `Crowd` (built-in avoidance + path-following) vs. manual `NavMeshQuery.computePath` + custom stepper.
10. **Trigger timing:** do trigger volumes share the spatial-area tracker's 3-frame hysteresis (debounced, quest-safe) or fire edge-exact (audio/VFX-safe)? Possibly per-role.

## Stories

Ordering: player-visible collision value first (069.1-069.3), the migration-risk story isolated mid-epic (069.4), then authoring-before-runtime for volume roles, then navigation. Each story ends with a nikki-verify recipe; nothing merges without it.

**EXECUTION ORDER (round-4 amendment): 069.1 -> 069.2 -> 069.3 -> 069.4 -> 069.7 -> 069.5 -> 069.6 -> 069.8 -> 069.9 -> 069.10.** 069.7 (Volume authoring UI) runs BEFORE 069.5 (runtime roles): 069.5's verify recipe requires drawing role-tagged volumes, which only 069.7's UI can author. 069.7's verify is trimmed to authoring-visible checks; the runtime behaviors verify in 069.5.

Story-level answers to the open questions (consistent with the locked design; revisit = STOP + amend):
- q2 collider default -> **auto-box on every asset**, "none" opt-out (locked doc, Bucket 1).
- q3 response fidelity -> **blocker / trigger / none** + per-role direction; no full channel matrix.
- q4 bake trigger -> **manual "Bake NavMesh" button** + dirty-flag staleness warn.
- q8 agent shape -> **XZ circle now**, radius read from the existing `SceneObject.capsule`; vertical half-height activates in the terrain epic.
- q9 NPC locomotion -> decided inside 069.9 (default lean: recast `Crowd` — avoidance comes free); a deviation from Crowd needs only story-level justification, not re-gate.
- q10 trigger timing -> **per-role**: quest/dialogue triggers debounced via the tracker's hysteresis; audio/VFX edge-exact. Decided concretely in 069.5.

### 069.1 — Collider domain: `AssetDefinition.collider` + import-time bounds bake

Auto-box collider metadata on every model asset. Add optional `collider` to `AssetDefinition` (non-breaking, like `deform`): `{ shape: "auto-box" | "sphere" | "capsule" | "convex" | "none", localBounds }`, `localBounds` computed at import via `Box3.setFromObject` (the origin-correct math). **Kind-aware default: `assetKind: "foliage"` defaults to `"none"`, `"model"` to `"auto-box"`** — the scatter brush lands real `PlacedAssetInstance`s, so auto-boxes on brushed foliage would wall off every meadow the moment 069.2 ships. Backfill existing assets via the normalize-on-load pattern with a studio-side lazy bounds bake (bounds need the GLB, so the backfill runs where the file is readable — same seam as the other bakes). **Every GLB-rewriting bake recomputes `localBounds`** — `handleCorrectAssetOrigin` shifts geometry relative to the origin, so import-time bounds go stale after an origin correction (paint-UV bake is geometry-neutral; note it as such at the call site). Surface collider on `SceneObject` (definition tier; the per-instance override tier is 069.6's). Unit tests: import bake, kind defaults, backfill, rebake-after-origin-correct, normalize round-trip.
**Verify:** import a fresh GLB -> its definition carries bounds; open an old project -> existing assets gain bounds without visual change; run Auto Correct Origin on an off-origin asset -> bounds move with it; nothing renders differently.

### 069.2 — Runtime collision world + collide-and-slide (player)

The single collision enforcer, in runtime-core: a collision module holding a grid/AABB broadphase over per-instance world colliders (from `SceneObject.transform` x `localBounds`; instanced + singleton identical here), and a pure `resolveMove(body, proposedDelta) -> resolvedDelta` implementing **collide-and-slide** for an XZ-circle agent (radius from `SceneObject.capsule`). **Population/lifecycle seam:** the broadphase is built once at session/host assembly from the `resolveSceneObjects` output (runtime-core already receives region + scene + content library); rebuild-on-start covers region load, scene switches, and preview live edits (session changes re-boot the preview; only asset-source churn is excluded). The player is excluded from `resolveSceneObjects` at the host (`includePlayerPresence: false`), so the player body's radius comes from `playerDefinition.physicalProfile` — same math the scene module uses. A `CollisionSystem` registered after `MovementSystem` routes the player's proposed move through it. Frame-rate independent (delta-scaled, positional push-out). Unit tests per the packages/testing pattern: head-on block, shallow-angle slide, corner, "none" collider pass-through, determinism across delta splits.
**Verify:** in preview, walk into the statue — blocked; walk at it diagonally — slide along it, no dead-stop, no jitter; walk through scatter-brushed foliage freely (foliage defaults to "none" from 069.1); 60fps holds.

### 069.3 — NPCs route through the same enforcer (dynamic bodies)

The behavior system's `stepToward` routes its proposed step through the SAME `resolveMove` (invariant: one implementation, both movement paths). NPC-vs-static, NPC-vs-NPC, NPC-vs-player as moving circles. Tune the stuck-detector so a collision-deflected NPC doesn't false-trip it (or trips it usefully — sliding along a wall toward the target is progress; pinned-in-a-corner is stuck).
**Verify:** an NPC walking its task path can't pass through props or through you; two NPCs crossing paths don't interpenetrate; no NPC freezes mid-route against a prop edge (watch the stuck warning).

### 069.4 — Unified `Volume` domain + migration (THE risk story)

The unified drawn-volume primitive: `RegionVolumeDefinition` with roles (label / trigger / blocker / containment-boundary / nav-bounds / non-walkable), direction flag on blocker/boundary, optional condition binding (`RegionBehaviorWorldFlagCondition` + `RegionBehaviorQuestBinding`), nesting via parent id. **Trigger action payload defined here** (what firing a trigger DOES): audio cue and/or set-world-flag — the flag path is what makes quests consume triggers, since quest/dialogue code gates on flags, never on areaIds. Migration inside `normalizeRegionDocumentForLoad`: `RegionAreaDefinition` -> Volume(label), `RegionAmbienceZone` -> Volume(trigger + audio payload); all consumers (spatial tracker, NPC task target areas, quest bindings, audio) read Volumes; old types become `@deprecated` normalize-fed aliases. **The WRITE path migrates in the same story:** the existing `Create/Update/DeleteRegionArea` + `Create/Update/DeleteRegionAmbienceZone` command executors are repointed at Volume storage (command names unchanged, so the Spatial workspace and audio placement section keep working untouched) — otherwise an area edit made between 069.4 and 069.7 writes the dead type and diverges from what the runtime reads. **Commands do NOT re-normalize** (the executor result goes straight into `session.regions`, `authoring-session/index.ts:2409-2416`), so the repointed executors must **re-derive the `@deprecated` alias fields in the returned document** — live in-session readers (spatial overlay, sugarlang compile, preview boot) read the aliases between saves; normalize-at-load alone would leave them write-stale. Exhaustive migration tests: every existing authored region loads, round-trips, and behaves identically (NPC tasks still find their areas, ambience still plays); **edit-an-area-after-migration, save, reload** holds; and the sugarlang plugin's `region.areas` reads (`scene-traversal.ts`, `lore-resolution.ts`) stay correct through the aliases.
**Verify:** open the sandbox project — every area still listed in Spatial, NPCs still walk their tasks, ambient audio unchanged; MOVE an existing area and save/reload — the edit sticks; save + reload clean. This story changes ZERO gameplay; its success is invisibility.

### 069.5 — Volume roles at runtime: blockers, triggers, containment

Blocker volumes join the collision world (directional: block-in / block-out / both). Trigger enter/exit extends `createSpatialAreaTracker` to per-volume inside sets (the second enforcer rule: extend, don't fork; export `containsPoint`); emits a trigger event stream consumed by quest/dialogue/audio — the ambience `on-enter` stub becomes a real consumer. Containment boundary = block-exit + condition, evaluated with the same flag/quest grammar the behavior system uses; per-role timing per q10. Unit tests: enter/exit edges, overlapping volumes, hysteresis vs edge-exact, conditional gate opens when flags flip.
**Verify:** draw an out-of-bounds blocker — can't cross it; draw a trigger wired to a sound/flag — fires on enter, again only after exit+re-enter; draw a containment volume conditioned on a flag — walled in until you set the flag (via a quest/dialogue), then walk out.

### 069.6 — Studio: Collision inspector + show-colliders

Layout inspector **Collision** section on the selected placed asset (shape picker incl. "none", size/offset nudge). **This story owns the full per-instance override slice** — the domain field (`PlacedAssetInstance` + scene-overlay tier, base/scene scoped exactly like 068's `surfaceSlotOverrides`), its command/executor, and the plumbing through `SceneObject` into the collision world — 069.1 ships only the definition tier. Second-largest story in the epic; budget accordingly. Spatial workspace "show colliders" viewport toggle rendering every collider (auto + volume blockers) as wireframes.

**Walk-on surfaces (dock/floor/bridge/platform):** on flat ground an auto-box treats the whole footprint as a wall, so the player can't step onto a walkable surface (nikki hit this with a dock, 2026-07-16). The intended handling here is the `"none"` shape — the author marks walk-on assets non-blocking. The real "walk *onto* it at height" behavior is the deferred **terrain epic** (see Scope boundaries), not 069. Open question surfaced by this: whether the auto-box-everything default (q2) should get a flat/thin-footprint heuristic — deferred as its own decision, since a heuristic misfires on low fences/curbs; author control is the safe answer for now.
**Verify:** select the statue — see its auto-box; set a bush to "none" — walk through it in preview; resize a collider on ONE instance — blocking matches the wireframe on that instance only (the other instances unchanged); scene-scope an override — reverts outside that scene; toggle shows all colliders greyed by type.

**Delivered additions (2026-07-17, completing Bucket 1's "collider on the object"):** a **definition-tier Collision control** in the asset detail (Game > Libraries > Assets > select asset) sets the shape every placed/scattered instance inherits — the UE/Unity "collision on the type" model. This is how scattered foliage is made non-blocking: set the asset to `none` once, all instances inherit (nikki hit lavender-with-colliders, 2026-07-17). The per-instance override remains the exception layer. The **show-colliders toggle lives in a top-right view-affordance bar** (`ViewportViewToggleBar`, seated left of the orientation gizmo, Blender-style) in BOTH the Spatial and Layout viewports — the home for future view toggles (069.8 "show navmesh").

### 069.7 — Studio: Volume authoring in Spatial (roles UI)

The Spatial workspace draws unified Volumes: new `CreateRegionVolume` / `UpdateRegionVolume` commands behind the existing draw gesture; inspector = role checkboxes + per-role config (direction, condition picker reusing the quest/flag pickers, audio cue / set-flag action for trigger). Migrated label-Volumes appear exactly where Areas were. Nesting via parent select (existing pattern). **Runs BEFORE 069.5** (see execution order) — this story verifies AUTHORING only; the runtime role behaviors land and verify in 069.5.
**Verify (authoring-only):** draw one volume, check blocker + trigger + label together — roles + per-role config persist through save/reload; the label role behaves as areas always did (NPC tasks target it); old areas fully editable as label-Volumes. (Blocker/trigger/containment runtime behavior is 069.5's verify.)

### 069.8 — NavMesh bake + artifact + staleness

`recast-navigation` integration: bake (solo navmesh now; note tiled gates future TileCache) from the collision world's geometry inside nav-bounds Volumes, eroded by agent radius; non-walkable Volumes carve. **Bake input is triangle soup:** recast consumes positions/indices, so the bake converts each collider box to its 12 triangles and includes the ground plane quad — stated, not assumed. **Artifact round-trip:** the studio-side bake exports the navmesh binary and **publishes the in-memory blob to the asset-source store** (never read-after-write — the known FSAccess flake); the runtime host resolves the blob through the same store and hands bytes to `importNavMesh` in runtime-core. "Bake NavMesh" studio action (bake-action pattern); artifact referenced from the region/scene doc (NOT a SaveParticipant); dirty-flag warn when collider-touching edits postdate the bake. Navmesh viewport visualization toggle.
**Verify:** draw nav-bounds over the ground, bake, toggle the viz — walkable surface hugs the ground minus prop cutouts and carve-outs; move a prop — staleness warning appears; rebake clears it.

### 069.9 — NPC pathfinding (replace the straight-line step)

NPCs consume the baked navmesh: the behavior stepper's straight-line `stepToward` is replaced by recast path-following (default: `Crowd` agents — avoidance included; fall back to `NavMeshQuery.computePath` + manual stepper only with story-level justification). Task target resolution unchanged (same areas/Volumes); only locomotion changes. Collision remains the final clip (069.3 stays active). Stuck-detection re-tuned for path-following.
**Verify:** place a prop wall between an NPC and its task area — it walks AROUND, arrives, idles; no orbiting, no wall-hugging jitter; with no baked navmesh, NPCs fall back to the old straight-line behavior (regions without bakes keep working).

### 069.10 — Epic close: perf pass, docs, deferred triggers

Perf harness pass with collision + nav live (broadphase budget, Crowd tick cost at NPC count); docs/api update (runtime collision + navigation surface, Volume model); code comments at every deferred seam (terrain Y, camera collision, TileCache/tiled bake, CCD) naming their revisit triggers; sweep the deferred list into the backlog.
**Verify:** 60fps holds in the sandbox with everything enabled; docs read true against the code.

- [UE — Collision Overview](https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine---overview?lang=en-US), [UE — Collision Filtering (channels/responses)](https://www.unrealengine.com/en-US/blog/collision-filtering)
- [UE — Basic Navigation (Recast, NavMeshBoundsVolume, Nav Modifiers)](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine)
- [Mesh vs Primitive Colliders](https://www.sloyd.ai/blog/mesh-colliders-vs-primitive-colliders)
- `recast-navigation` (npm; `@recast-navigation/three` for three.js helpers) — WASM Recast/Detour, the web equivalent of UE's Recast. Verified against npm: latest 0.43.1, browser/ESM, `generateSoloNavMesh` / `generateTiledNavMesh`, `NavMeshQuery.computePath`, `Crowd`, `TileCache` box/cylinder obstacles.
- Cross-engine common-denominator check (round 3): [Unity — Building a NavMesh (agent-radius erosion)](https://docs.unity3d.com/2017.1/Documentation/Manual/nav-BuildingNavMesh.html), [Unity — NavMesh Obstacle (carving)](https://docs.unity3d.com/530/Documentation/Manual/class-NavMeshObstacle.html), [Unity — NavMesh Agent (avoidance)](https://docs.unity3d.com/530/Documentation/Manual/class-NavMeshAgent.html), [Godot 4 — NavigationServer](https://godotengine.org/article/navigation-server-godot-4-0/), [Godot — agent avoidance](https://docs.godotengine.org/en/4.0/tutorials/navigation/navigation_using_agent_avoidance.html), [NVIDIA PhysX — Character Controllers (collide-and-slide)](https://nvidia-omniverse.github.io/PhysX/physx/5.3.1/docs/CharacterControllers.html), [Godot — move_and_slide](https://docs.godotengine.org/en/2.1/learning/features/physics/kinematic_character_2d.html), [Unity — Continuous Collision Detection (CCD reserved for fast movers)](https://docs.unity3d.com/2020.1/Documentation/Manual/ContinuousCollisionDetection.html). The design (bake-inside-bounds, radius erosion, modifier areas, agents query nav + collision does final clip, collide-and-slide controller, discrete collision at walking speed) is the shared core of UE, Unity, and Godot — not engine-specific cherry-picking.

---

**NOTE:** This is the epic *summary/sketch* only, per the request. Stories, technical detail, and data-model specifics come AFTER this passes /epic-review.
