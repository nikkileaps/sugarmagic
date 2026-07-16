# Plan 069 — Collision + Navigation (blocking, triggers, NPC pathfinding)

Status: proposed (summary/sketch only — NO stories yet; needs /epic-review before decomposition)
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
- **Asset bounds are computable** — `asset-surface-bake.ts:74-88` already builds a `THREE.Box3` from an asset's meshes (today only for texture baking, not stored).

Absent (the epic's actual work): runtime collision, a `Collider` ECS component, asset collision metadata, any navmesh/pathfinding, and vertical/ground-height (that last one is the terrain epic).

## Solution sketch

**Pillar A — Collision (player blocking + triggers).**
- Give each asset an optional **collider** (default: auto-fitted box from its bounds; authorable to sphere/capsule/convex, or "none" for decor). The player/NPC agents are **capsules**. Mirrors Unreal's per-asset collision primitive.
- Add a **collision resolution step** in the movement pipeline: after `MovementSystem` proposes a move, resolve it against nearby colliders (block + slide) before committing position. A simple broadphase (grid/AABB) over instanced + singleton placements keeps it cheap at our scale.
- Generalize the ambience-zone idea into **trigger volumes** with Block/Overlap/Ignore-style responses, so quests/dialogue/audio can fire on enter/exit — the Overlap half of the Unreal model.

**Pillar B — Navigation (NPC pathfinding).**
- Bake a **navmesh** from the region's collision geometry inside authored **nav-bounds volumes**, eroded by agent radius, using **`recast-navigation-js`** — the same Recast/Detour library Unreal ships, compiled to WASM with three.js helpers. Industry-standard, not hand-rolled.
- **Nav modifier areas** (reusing the box-volume authoring) paint non-walkable / higher-cost regions.
- Store the baked navmesh as a per-region/scene artifact (an offline "bake" action, same shape as our paint-UV / origin-correct GLB bakes); the runtime loads it and NPCs **pathfind** across it, replacing the straight-line step in the behavior system.

## Studio UX / authoring model

Two buckets the author holds in their head — the key design decision of this epic:

**Bucket 1 — object colliders (auto, attached to assets).** ~90% of collision. The author never draws a box: placing a prop auto-fits a collision box to its mesh (the bounds math the Auto Correct Origin already uses) and it's solid immediately. Tweak it on the asset via a **Collision** inspector section (shape: auto-box / capsule / sphere / convex / **none** for decor), base-or-scene scoped like 068's overrides. A Spatial "show colliders" toggle eyeballs them all. These are a property of the *object*, not a drawn region.

**Bucket 2 — a unified drawn "Volume" with attachable roles (in Build > Spatial).** PROPOSED design: the author draws one box (the Draw-Area tool already exists) and then checks what it *is* — one volume can wear several roles at once:
- **label** (semantic zone — today's `RegionAreaDefinition`: "the Market", used by NPC/quest/lore)
- **trigger** (fire quest/dialogue/sound on enter/exit — today's `RegionAmbienceZone`, generalized)
- **blocker** (invisible wall / out-of-bounds where no mesh exists), with a **direction** flavor — block-entry / block-exit / both
- **containment boundary** = a blocker with block-exit + a **condition**: "can't leave until X and Y." Reuses the existing condition grammar (`RegionBehaviorWorldFlagCondition`, `RegionBehaviorQuestBinding`) the NPC/quest systems already gate on — no new vocabulary.
- **nav-bounds** ("bake the navmesh inside here")
- **non-walkable** (nav carve-out: NPCs never path across this)

Volumes **nest** for free — `RegionAreaDefinition` already carries `parentAreaId` — so an outer "Ruined Keep" containing an inner gated "Throne Room" is just parent/child.

**Bake + visualize:** a **"Bake NavMesh"** action + viewport toggles to visualize the navmesh and colliders, built on the existing hit-test/overlay infra.

**Rejected alternative — typed volumes.** Keep `RegionAreaDefinition` as a pure label and add separate `CollisionVolume` / `NavBoundsVolume` / `NavModifierVolume` types (extend the status quo). Rejected because overlapping intents force overlapping parallel boxes and the type set sprawls; the unified role model expresses semantic zones, triggers, blockers, gated arenas, and nav data from one drawn primitive. (Cost of unified: migrating today's separate Area + AmbienceZone types into the role model.)

## Architecture & reuse

- **ECS:** new `Collider` component; a `CollisionSystem` inserted into the movement pipeline; a `NavAgent` / path component + a `NavigationSystem` that the NPC behavior system consumes.
- **Domain:** extend `AssetDefinition` with an optional collider (non-breaking, like `deform`/`effect`); add region-level volume types parallel to `RegionAmbienceZone` (collision blocker, nav-bounds, nav-modifier); a baked-navmesh artifact slot on the region/scene.
- **Authoring:** reuse the Spatial workspace, the box-volume + gizmo tooling, and the bake-action pattern (paint-UV / origin-correct) for the navmesh bake.
- **Runtime:** `recast-navigation-js` for bake + query; the existing NPC stepper becomes a path-follower.

## New domain pieces (to be designed in stories, not here)

- **Object collider** on `AssetDefinition` (auto-box default; per-instance override, base/scene scoped) and agent **capsule** params (radius/height) on player + NPC.
- **Unified `Volume`** primitive with attachable **roles** (label / trigger / blocker / containment-boundary / nav-bounds / non-walkable), a **direction** flag on blocker/boundary roles (block-in / block-out / both), and an optional **condition** binding reusing `RegionBehaviorWorldFlagCondition` + `RegionBehaviorQuestBinding`. Nesting via the existing `parentAreaId`. **Migration:** fold today's `RegionAreaDefinition` (label role) and `RegionAmbienceZone` (trigger role) into this — a non-trivial part of the epic.
- **Collision response model** (block/overlap/ignore, scaled to our needs) and a runtime **trigger** enter/exit event stream.
- **Baked navmesh artifact** (per region/scene) + **path / nav-agent** runtime state; the NPC stepper becomes a path-follower.

## Scope boundaries (and the terrain seam)

069 targets **flat ground** (the current `PlaneGeometry` at Y≈0). On flat ground it delivers real value: the player is blocked by props/walls, triggers fire, and NPCs path around obstacles. What it explicitly does NOT do — and what belongs to the **deferred terrain/gravity epic** — is the *vertical* dimension: ground-height sampling, walking up stairs/slopes, gravity, uneven terrain. The seam: collision resolution and navmesh both currently assume Y is flat; when the terrain epic lands, collision gains ground-follow + gravity and the navmesh bakes over 3D terrain (Recast already handles slopes/steps, so the nav side extends cleanly). 069 should leave those seams clean, not hard-code Y=0 assumptions that the terrain epic must rip out.

## Open questions (for /epic-review)

1. One epic or two? Collision (Pillar A) and Navigation (Pillar B) are distinct enough to split into sequential epics — is co-designing them worth keeping them together?
2. Collider default: auto-box-from-bounds for every asset, or opt-in per asset?
3. How faithful to Unreal's channel/response matrix do we go at our scale vs. a simpler blocker/trigger/none?
4. Navmesh bake trigger: manual "Bake" button (like our other bakes) vs. auto-on-save — and where the artifact is stored (region vs. scene overlay).
5. How much of the deferred terrain epic must land first for navmesh to be worth it (flat-ground navmesh is real, but modest)?
6. **Migration:** the unified `Volume` model (proposed above) subsumes today's `RegionAreaDefinition` + `RegionAmbienceZone`. Auto-upgrade existing regions on load (the pattern other legacy schema bumps use), or keep the old types alongside the new roles? This is the biggest correctness risk in the epic — existing authored regions must not break.

## Sources

- [UE — Collision Overview](https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine---overview?lang=en-US), [UE — Collision Filtering (channels/responses)](https://www.unrealengine.com/en-US/blog/collision-filtering)
- [UE — Basic Navigation (Recast, NavMeshBoundsVolume, Nav Modifiers)](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine)
- [Mesh vs Primitive Colliders](https://www.sloyd.ai/blog/mesh-colliders-vs-primitive-colliders)
- `recast-navigation-js` — WASM Recast/Detour with three.js helpers (the web equivalent of UE's Recast).

---

**NOTE:** This is the epic *summary/sketch* only, per the request. Stories, technical detail, and data-model specifics come AFTER this passes /epic-review.
