# Plan 069 — Collision + Navigation (blocking, triggers, NPC pathfinding)

Status: Locked (epic-review passed 2026-07-16, 2 rounds) — the DESIGN is locked; this is still the summary/sketch stage, so story decomposition is the next step and stories are written to this locked design.
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
- **`RegionAreaDefinition`** (`packages/domain/src/region-authoring/index.ts:181-194`) — authored box volumes (center + size), hierarchical, 8 semantic kinds. Already the "authored spatial volume" primitive.
- **`RegionAmbienceZone`** (`:157-165`) — box **trigger** volumes (on-enter / always). The seed of a general trigger/overlap system.
- **Spatial workspace ALREADY EXISTS** (`packages/workspaces/src/build/spatial/SpatialWorkspaceView.tsx`) — Build > Spatial, with an area list, Select + **Draw-Area** rectangle tools, and viewport overlay. Nikki's imagined UX ("go into Build > Spatial and define areas") is already the shipping pattern.
- **NPC locomotion exists** (`behavior/system.ts`) — has target resolution + stepping + stuck-detection; needs its straight-line step swapped for a pathfollow.
- **Asset bounds are computable** — `packages/render-web/src/asset-surface-bake.ts:74-88` already builds a `THREE.Box3` from an asset's meshes (today only for texture baking, not stored); the cleaner per-asset reuse target is `Box3.setFromObject` in `apps/studio/src/asset-pipeline/origin-correct.ts:68`.

Absent (the epic's actual work): runtime collision, a `Collider` ECS component, asset collision metadata, any navmesh/pathfinding, and vertical/ground-height (that last one is the terrain epic).

## Solution sketch

**Pillar A — Collision (player + NPC blocking + triggers).**
- Give each asset an optional **collider** (default: auto-fitted box from its local bounds via `Box3.setFromObject` — the exact math `correctAssetOriginToBottomCenter` uses, `apps/studio/src/asset-pipeline/origin-correct.ts:68`; authorable to sphere/capsule/convex, or "none" for decor). **Instanced repeats (068.13a) share one geometry**, so each instance needs its **own world-space collider** derived from its instance matrix (`packages/render-web/src/instanced-group.ts` already builds those per-instance transforms) — a broadphase reads those, not one shared local box.
- Resolve collision on the **moving bodies**, which today take TWO different paths (a real integration constraint): the **player** is advanced by `MovementSystem` inside `world.update(delta)` (`targets/web/src/runtimeHost.ts:1496`; system registered `:2489`) — a `CollisionSystem` after it is a clean seam. **NPCs** are moved by direct `Position` writes in the behavior system via `gameplaySession.update(delta)` (`runtimeHost.ts:1497`), which **bypasses the ECS system array entirely**. So collision resolution must span both paths (and cover NPC-vs-NPC / NPC-vs-player), not live solely in a post-`MovementSystem` step. A simple broadphase (grid/AABB) over instanced + singleton colliders keeps it cheap.
- **Trigger volumes** (fire quest/dialogue/audio on enter/exit) are **greenfield**, not a generalization: the ambience-zone type has an `on-enter` field but the runtime implements only `"always"` (`packages/runtime-core/src/audio/index.ts:250-251`), so there is no working enter/exit machinery to reuse. Reuse `containsPoint` / `findRegionAreaById` (`packages/runtime-core/src/spatial/index.ts`) for the point-in-box test and build enter/exit edge-detection (a per-frame previous-inside set) fresh.

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

## New domain pieces (to be designed in stories, not here)

- **Object collider** on `AssetDefinition` (auto-box default; per-instance override, base/scene scoped) and agent **capsule** params (radius/height) on player + NPC.
- **Unified `Volume`** primitive with attachable **roles** (label / trigger / blocker / containment-boundary / nav-bounds / non-walkable), a **direction** flag on blocker/boundary roles (block-in / block-out / both), and an optional **condition** binding reusing `RegionBehaviorWorldFlagCondition` + `RegionBehaviorQuestBinding`. Nesting via the existing `parentAreaId`. **Migration:** fold today's `RegionAreaDefinition` (label role) and `RegionAmbienceZone` (trigger role) into this — a non-trivial part of the epic.
- **Collision response model** (block/overlap/ignore, scaled to our needs); **dynamic bodies** — the player AND NPCs are moving colliders (NPC-vs-NPC / NPC-vs-player), not just player-vs-static props; and a runtime **trigger** enter/exit event stream (built fresh — see Pillar A).
- **Baked navmesh artifact** — a binary blob in the asset-source store referenced from the region/scene doc (authored build artifact, NOT a runtime SaveParticipant) + **path / nav-agent** runtime state; the NPC stepper becomes a path-follower (or a recast `Crowd` agent).

## Scope boundaries (and the terrain seam)

069 targets **flat ground** (the current `PlaneGeometry` at Y≈0). On flat ground it delivers real value: the player is blocked by props/walls, triggers fire, and NPCs path around obstacles. What it explicitly does NOT do — and what belongs to the **deferred terrain/gravity epic** — is the *vertical* dimension: ground-height sampling, walking up stairs/slopes, gravity, uneven terrain. The seam: collision resolution and navmesh both currently assume Y is flat; when the terrain epic lands, collision gains ground-follow + gravity and the navmesh bakes over 3D terrain (Recast already handles slopes/steps, so the nav side extends cleanly). 069 should leave those seams clean, not hard-code Y=0 assumptions that the terrain epic must rip out. **Agent shape:** on flat ground an XZ circle/AABB is sufficient; a full **capsule**'s vertical half-height is dead weight until the terrain epic adds gravity/ground-follow — so decide capsule-now vs. XZ-circle-now (open question) rather than assuming capsules.

## Open questions (for /epic-review)

1. One epic or two? Collision (Pillar A) and Navigation (Pillar B) are distinct enough to split into sequential epics — is co-designing them worth keeping them together?
2. Collider default: auto-box-from-bounds for every asset, or opt-in per asset?
3. How faithful to Unreal's channel/response matrix do we go at our scale vs. a simpler blocker/trigger/none?
4. Navmesh bake trigger: manual "Bake" button (like our other bakes) vs. auto-on-save — and where the artifact reference lives (region doc vs. scene overlay), pointing at a blob in the asset-source store (authored build artifact, not runtime save state).
5. How much of the deferred terrain epic must land first for navmesh to be worth it (flat-ground navmesh is real, but modest)?
6. **Migration:** the unified `Volume` model (proposed above) subsumes today's `RegionAreaDefinition` + `RegionAmbienceZone`. Auto-upgrade existing regions on load via the established `normalizeRegionDocumentForLoad` / `@deprecated`-field pattern (`packages/domain/src/io`, `scenes/migrate.ts`), or keep the old types alongside the new roles? This is the biggest correctness risk in the epic — existing authored regions must not break.
7. **Two movement paths:** collision must cover the player (`MovementSystem` in `world.update`) and NPCs (direct `Position` writes in the behavior system, bypassing the ECS array). Resolve in a single shared collision pass, or unify the two movement paths first?
8. **Agent shape:** capsule now vs. flat XZ-circle until the terrain epic (see Scope boundaries).
9. **NPC locomotion:** recast `Crowd` (built-in avoidance + path-following) vs. manual `NavMeshQuery.computePath` + custom stepper.

## Sources

- [UE — Collision Overview](https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine---overview?lang=en-US), [UE — Collision Filtering (channels/responses)](https://www.unrealengine.com/en-US/blog/collision-filtering)
- [UE — Basic Navigation (Recast, NavMeshBoundsVolume, Nav Modifiers)](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine)
- [Mesh vs Primitive Colliders](https://www.sloyd.ai/blog/mesh-colliders-vs-primitive-colliders)
- `recast-navigation` (npm; `@recast-navigation/three` for three.js helpers) — WASM Recast/Detour, the web equivalent of UE's Recast. Verified against npm: latest 0.43.1, browser/ESM, `generateSoloNavMesh` / `generateTiledNavMesh`, `NavMeshQuery.computePath`, `Crowd`, `TileCache` box/cylinder obstacles.

---

**NOTE:** This is the epic *summary/sketch* only, per the request. Stories, technical detail, and data-model specifics come AFTER this passes /epic-review.
