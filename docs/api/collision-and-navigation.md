# Collision & Navigation (runtime)

Runtime collision, drawn Volumes, and NPC navmesh pathfinding. **Flat-ground
scope:** agents are XZ circles, colliders are world-space XZ AABBs (Y ignored);
the vertical dimension (gravity, ground-follow, slopes, walk-on platforms) is
the deferred terrain epic. Deferred seams are commented in the code with their
revisit triggers.

## Volumes (`@sugarmagic/domain`)

`RegionVolumeDefinition` (`region-authoring/index.ts`) is one drawn box with
attachable **roles**; `region.volumes` is canonical. The legacy
`region.areas` and `region.audio.ambienceZones` are `@deprecated` aliases
derived from the `label`- and `trigger`-role volumes (`normalizeRegionDocumentForLoad`
migrates old files; `withDerivedRegionAliases` keeps the aliases in sync on
edit). Roles:

- `label` — a named region (NPC behavior `targetAreaId`, lore). Kind + lore in
  `labelKind` / `lorePageId`.
- `trigger` — fires an action on player enter. `trigger: { timing, action }`;
  `timing: "on-enter"` is edge-detected, `"always"` is the continuous ambient bed.
- `blocker` — a collision wall. `blockDirection: "in" | "out" | "both"`.
- `containment-boundary` — keeps you IN (`block "out"`), optionally gated by a
  `condition` (`RegionBehaviorQuestBinding`) that OPENS it when satisfied.
- `nav-bounds` — the walkable ground extent for the navmesh bake.
- `non-walkable` — carves a hole out of the navmesh.
- `color` is an authoring-only viewport tint (runtime ignores it).

Author in Studio **Build > Spatial** (`SpatialWorkspaceView`); commands
`CreateRegionVolume` / `UpdateRegionVolume` / `DeleteRegionVolume`.

## Colliders (`@sugarmagic/runtime-core` `collision/`)

Object colliders resolve across three tiers (`resolveEffectiveInstanceCollider`,
`@sugarmagic/domain/scenes`): **scene override > instance override >
definition**. The definition tier (`AssetDefinition.collider`, kind-aware:
foliage `none`, model `auto-box`) is set in the asset detail (Collision section)
and baked to `localBounds` from the GLB (`asset-pipeline/collider-bounds`). The
per-instance override (`PlacedAssetInstance.colliderOverride`) is set in the
Layout inspector (Collision section), base- or scene-scoped like
`surfaceSlotOverrides`.

`buildCollisionWorld(sceneObjects, regionVolumes)` produces a `CollisionWorld`
(uniform-grid broadphase) from prop colliders + `blocker`/`containment` volumes.
`resolveMove(from, delta, world, circleObstacles?)` is the **single collision
enforcer** — pure collide-and-slide (normal-only push-out preserves tangential
motion), circle-vs-box + circle-vs-circle, directional (`block` per collider).
Both callers route through it: the player (`CollisionSystem`, after
`MovementSystem`) and NPCs (`behavior/system.ts commitNpcMove`).

Conditional containment gates re-evaluate per frame:
`applyVolumeColliderGates(world, ctx)` sets each gated collider's `active` from
`evaluateRegionQuestBinding` (the shared quest/flag grammar in
`region-conditions/`, also used by NPC behavior task activation).

## Volume roles at runtime

- **Blockers / containment** join the collision world (above).
- **Triggers** — the spatial area tracker (`spatial/index.ts`
  `createSpatialAreaTracker`) edge-detects player enter/exit of `on-enter`
  trigger volumes; the gameplay session plays/stops the cue and sets the world
  flag (`gameplay-session.ts` `fireTriggerAction`).

## NavMesh (`@sugarmagic/runtime-core` `navmesh/`, recast-navigation 0.43.x)

- **Bake** (Studio side): `buildRegionNavMeshInput(region, …)` derives obstacles
  (prop colliders + `blocker` volumes — NOT containment), `nav-bounds`, and
  `non-walkable` volumes; `bakeNavMesh(input)` converts them to triangle soup
  (ground quad + box triangles), runs `generateSoloNavMesh` eroded by the agent
  radius, and returns the exported bytes. Studio's **Bake NavMesh** button
  (Spatial NavMesh panel) writes the artifact + publishes the in-memory blob to
  the asset-source store (`setSource`, avoiding the FSAccess read-after-write
  flake) and records `region.navMesh` (`assetPath` + `inputHash` + `agentRadius`)
  via `SetRegionNavMesh`.
- **Staleness**: `computeNavMeshInputHash(input)` vs the stored `inputHash` — a
  collider/nav-volume edit that postdates the bake shows the "Stale — rebake"
  warning.
- **Viz**: `loadNavMeshDebugGeometry(bytes)` extracts the walkable triangles for
  the "show navmesh" viewport toggle.
- **Pathfinding**: the host resolves the artifact blob and
  `loadNavMeshPathfinder(bytes)` yields a `NavMeshPathfinder`; NPCs consume it
  via the behavior system's `getPathfinder`. The stepper heads to the current
  navmesh waypoint toward the task target (arrival measured against the FINAL
  point), re-pathing on target move / drift / stuck. No pathfinder (unbaked
  region) → straight-line fallback. `resolveMove` stays the final collision
  clip. `Crowd` was deliberately not used (single movement authority — see the
  069 plan's q9 decision).

Note: the bake composes ONE Scene's overlay (the studio's active Scene at bake
time; recorded as `sceneId` on the artifact), but the artifact is
region-global — a runtime playing a different Scene paths against the baked
Scene's obstacle set. Rebake per Scene as needed; per-Scene artifacts are a
deferred seam.

## Deferred seams

Commented in-code with revisit triggers (grep `DEFERRED SEAM`): vertical/terrain
(`collision/`), CCD for fast movers (`collision/`), bounded collider shapes
(sphere/capsule/convex currently collide as their AABB — `collision/`
`buildCollisionWorld`), Scene-composed bake vs region-global artifact
(`navmesh/` `buildRegionNavMeshInput`), tiled bake + `TileCache` dynamic
obstacles + `Crowd` (`navmesh/`), camera collision (`camera/`). Backlog tasks
track each.
