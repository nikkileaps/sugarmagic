# Plan 079 -- Conditional NPC Presence Gating

Status: Locked (epic-review passed 2026-07-24, 2 rounds) -- stories execute as written; deviations need STOP + amendment + re-gate.
Owner: nikki + claude
Date: 2026-07-24

Related:
- Backlog #418 (this epic's origin).
- Plan 069 (Collision + Navigation) -- shipped the `evaluateRegionQuestBinding`
  compound-AND grammar and its two existing consumers (behavior-task selection,
  containment-volume gates). This epic adds a THIRD consumer, reusing the same
  evaluator unchanged.
- Plan 057 (Presence spawn filter helper) -- MERGED (`iterateActiveItemPresences`,
  commit `96e68a2`), the live items-only, load-time filter seam consumed by both item
  spawn paths. Says NPC gating should "extend the same helper pattern." See D5.
- Deferred comment `packages/domain/src/region-authoring/index.ts:101-107` -- the
  077.4 note that pre-describes this exact feature and points at backlog #418.

---

## Why now

Authored content needs NPCs that are physically ABSENT until story conditions
hold -- a character who only appears after the player advances a quest stage or
trips a world flag. Today every authored `RegionNPCPresence` spawns
unconditionally at region load. The only existing tool is behavior-task gating
(Plan 069.5/074.4), which keeps the NPC PRESENT but behaviorally neutral -- it
cannot make an NPC not-there. The compound-AND evaluator that behavior tasks and
containment volumes already share is the exact primitive presence gating needs;
this epic wires it to a third consumer and makes the spawn dynamic.

## Non-goals

- No change to the `evaluateRegionQuestBinding` grammar or the
  `RegionBehaviorQuestBinding` shape (quest def + stage + world flag). This epic
  is a new CONSUMER of the existing evaluator, nothing more.
- No item-presence work. Items have their own (merged, load-time) filter path (Plan 057);
  see D5. This epic is NPC-only.
- No player area-locking work. Conditional lock/unlock of areas for the player is
  ALREADY shipped via conditional containment volumes (069.5) -- verified live in
  code (`collision/index.ts:252-278`, Studio UI `SpatialWorkspaceView.tsx:657`).
  Out of scope here by explicit decision.
- No navmesh re-bake on presence change. NPC presence does not alter walkable
  space; the navmesh stays static. (An absent NPC simply is not a dynamic body.)
- No new "episode" concept. Gating is by the existing quest/stage/flag primitives.

## Current behavior (ground truth, verify at the gate)

- `RegionNPCPresence` (`packages/domain/src/region-authoring/index.ts:93-108`)
  has NO condition field. Fields today: `presenceId`, `npcDefinitionId`,
  `shaderOverrides`, `shaderOverride` (deprecated), `shaderParameterOverrides`,
  `transform`. The 077.4 deferred comment sits inside this interface.
- NPCs spawn through TWO independent paths, both keyed on `presenceId`:
  1. **ECS interactable** -- `registerNpcInteractables()`
     (`packages/runtime-core/src/coordination/gameplay-session.ts:1164-1192`)
     iterates `regionContents.npcPresences` and creates a `Position` +
     `Interactable` entity per presence. Runs ONCE at session/region assembly.
  2. **Visual mesh** -- the web host calls `resolveSceneObjects(region, ...)`
     (`targets/web/src/runtimeHost.ts:2238`) which emits `kind: "npc"` scene
     objects; the renderable loop spawns the three.js group and (at :2337-2364)
     stashes the idle AnimationMixer. Keyed by `entry.object.instanceId` ===
     `presence.presenceId`.
  This is the SAME dual-path structure Plan 057 unified for items -- and the same
  silent-divergence risk (gate one path, forget the other -> a mesh with no E
  prompt, or an interactable with no body).
- The evaluator `evaluateRegionQuestBinding(binding, { activeQuest, hasWorldFlag })`
  (`packages/runtime-core/src/region-conditions/index.ts:84-110`) returns true
  when all populated clauses match; an all-null binding is vacuously true.
- Runtime state sources: `questManager.getTrackedQuest()` supplies
  `{ questDefinitionId, stageId }`; `questManager.hasFlag(key, value)` supplies
  the flag predicate. Both are already threaded into `gameplay-session.update()`
  for the per-frame containment-gate re-evaluation (`gameplay-session.ts:2099-2112`).
- `npcInteractableEntities` (a `Map<presenceId, {npcDefinitionId, entity}>`) is the
  SINGLE entity authority. Every per-frame NPC consumer derives from it: the behavior
  system's `getNpcEntities` (`gameplay-session.ts:2010`), the collision agents
  (`:2038`, `:2195`), interactable availability, and billboards. It is populated once
  in `registerNpcInteractables` and torn down only in `dispose()` (`:2237-2240`) --
  there is NO per-presence despawn today. So removing a presence from this ONE map
  cascades to behavior, collision, availability, and snapshots for free; but the
  despawn machinery itself is genuinely new (079.2 writes it).
- CAUTION (verified): `behavior/system.ts sync()` (`:747-762`) does NOT own entity
  lifecycle -- it reads the externally supplied `resolveNpcEntities()` list and only
  deletes its INTERNAL bookkeeping Maps (`movementStateByNpcId` etc.) for
  `npcDefinitionId`s no longer active. It creates/destroys no ECS entities. The reuse
  this epic leans on is the `npcInteractableEntities` consumers (above), NOT "behavior
  churn." Also note the keying asymmetry: `npcInteractableEntities` is keyed by
  `presenceId`, behavior state by `npcDefinitionId` (`:712`, `:755`) -- see 079.2's
  shared-definition edge case.
- NPCs spawn through TWO independent paths and (like items) there is NO divergence
  guard between them today. This is the exact structure Plan 057's item helper
  (`iterateActiveItemPresences`, MERGED and live -- see D5) addressed for items.
- Authoring: `handleAddNPCPresence` (`LayoutWorkspaceView.tsx:1144`) issues a
  `CreateNPCPresence` command; executor `applyCreateNPCPresence`
  (`commands/executor.ts:1037`) appends to the overlay. IMPORTANT: `CreateNPCPresence`
  fires at placement with a fixed payload (no condition field), and
  `createNPCPresenceFromCommand` (`executor.ts:623-637`) HAND-BUILDS the presence --
  it does NOT call the `createRegionNPCPresence` factory. There is NO update-condition
  command for presences today (only Create / Transform / Remove / shader setters,
  `commands/index.ts:813-847`). The presence inspector lives in
  `LayoutWorkspaceView.tsx:1895-1916` (Type / Scope / Spawn-Position only). The
  volume condition UI (the field-shape reference) lives separately in
  `SpatialWorkspaceView.tsx:657-718` and edits via a whole-object volume-update
  command. Setting a presence condition therefore needs a NEW command (see 079.1).

## Design decisions (epic-review ratifies)

- **D1 -- Reuse the evaluator, add a third consumer.** Presence gating calls
  `evaluateRegionQuestBinding` with the same `{ activeQuest, hasWorldFlag }`
  context already built for containment gates. No evaluator change, no new
  grammar. This keeps ONE source of truth for "is this quest/stage/flag
  condition satisfied" across behavior tasks, volume gates, and now presence.

- **D2 -- `condition` field on `RegionNPCPresence` + a new set-condition command.**
  Add `condition: RegionBehaviorQuestBinding | null` (mirror the volume field at
  `region-authoring/index.ts:282` -- same type, same null default). Existing presences
  deserialize with `condition: null` (vacuously present); `createRegionNPCPresence`
  normalizes it. The condition is authored AFTER placement (like volumes), NOT at
  `CreateNPCPresence` time -- so this epic adds a new `SetNPCPresenceCondition` command
  (payload + executor + command-union registration + test), the presence analog of the
  volume-update path. Also fix `createNPCPresenceFromCommand` (`executor.ts:623`) to
  set `condition: null` explicitly (it hand-builds the object and bypasses the factory,
  so the field must be added there too, or route it through the factory). No
  SaveParticipant work: presence lives in the region document (authored content), and
  the live active-set is re-derived each frame from quest/flag state (which already
  persists via existing participants) -- no new runtime slice.

- **D3 -- Split the two concerns: ECS gate (semantic absence) + visual hide
  (cheap), no resource teardown (THE risk story, de-risked).** A presence flips
  active/inactive when quest stage advances or a flag is set. The naive approach --
  create/destroy the three.js group on each flip -- introduces a bug-prone third
  renderable state ("loaded but detached") with stale-pose-on-return and cache-pool-
  leak hazards. We reject it. Instead:
  - **ECS/interactable side (semantic "absent"):** the runtime reconciler spawns/
    despawns the `Interactable` + `Position` entity in `npcInteractableEntities` on the
    active-set diff. This is where "the NPC is not here" actually lives -- and because
    every per-frame NPC consumer (behavior `getNpcEntities`, collision agents,
    availability, billboards) derives from that one map, removing the entry cascades
    cleanly with no separate teardown. NOTE this is genuinely new machinery:
    `registerNpcInteractables` is a once-only all-presences loop with no despawn
    counterpart (Current behavior). The behavior system does NOT own entity lifecycle
    (it only cleans its own internal Maps) -- do not mistake it for the despawn path.
  - **Visual side (cheap, no teardown):** the three.js group stays LOADED and in the
    scene graph for the region's lifetime. "Absent" = `root.visible = false` + skip
    its mixer tick. An invisible root is a hard skip in three.js (not drawn -- better
    than frustum culling) and skipping the mixer removes the per-frame bone-hierarchy
    cost (the real ongoing expense for a character, ticked ungated today at
    `runtimeHost.ts:1699-1701`). Return is instant: `visible = true`, resume mixer.
    No dispose, no cache pool, no reload, no stale resources -- the visual side only
    ever flips a bool.
  We do NOT re-evaluate by re-creating every frame; compute the active-presence SET
  each frame (cheap: N small evaluator calls) and act only on the DIFF -- ECS
  spawn/despawn on change, visual `visible` flag follows the set. Mirrors how
  `behavior/system.ts` diffs the NPC entity set each sync. Tradeoff: absent NPCs stay
  resident in memory (negligible for a handful; see Deferred for the dispose escape
  hatch at scale).

  **Why hide-in-place is the right long-term default (and when to switch).** There is
  no single "best" presence mechanism -- the correct one is chosen by frequency x
  count x memory pressure. Our conditional NPCs are FEW per region, coarse-grained,
  and toggle INFREQUENTLY on quest/flag changes (an NPC leaves for an act and comes
  back). For that profile, hide-in-place is the right long-term choice, not a shortcut,
  because:
  - It is instant in both directions with no reload hitch -- the exact "Finnick pops
    back the moment the quest advances" behavior we want.
  - It adds NO renderable lifecycle state that can drift. The visual side only ever
    flips a bool, so it stays correct as the surrounding code changes -- the cheapest
    thing to keep working over years.
  - The single-authority design (D4) keeps "how absence is realized" as a POLICY
    behind the authority, not baked into call sites. Swapping strategy later is a
    localized change, so choosing the simple default now costs us no future optionality.

  When we would deliberately switch:
  - **Full dispose (free the mesh on absence)** when a region holds enough conditional
    NPCs that resident character meshes show in a memory profile, OR when an NPC is
    absent for effectively the rest of the playthrough after a one-way story beat
    (never worth keeping resident). Cost accepted at that point: a reload hitch on the
    rare return. Deferred with a trigger below.
  - **Object pooling** ONLY if presence ever becomes high-frequency (many spawns/
    despawns per second). Not anticipated for authored story NPCs; it is the wrong
    tool for once-per-act toggles (a pool manager's bug surface for none of its payoff).

- **D4 -- One active-set authority, both sides consume it (closes the 057
  divergence).** runtime-core owns the authority -- the current active-presence set
  (or `isPresenceActive(presenceId): boolean`) backed by the evaluator + live
  quest/flag state. BOTH sides consult it, neither re-derives the condition:
  - The ECS reconciler (in gameplay-session) spawns/despawns interactables on the diff.
  - The web host reads the same authority to drive `visible` + mixer-skip on the
    matching `kind: "npc"` renderable, in lockstep.
  Sharing the SHAPE of the predicate (not a copy of the check) is what prevents the
  gate-one-side-forget-the-other bug. The exact seam (callback vs. host-polls-the-set
  each frame) is settled in 079.2; the invariant is that neither side re-derives the
  condition independently. Note the asymmetry is deliberate: the ECS side is
  create/destroy (that IS the semantic absence); the visual side is only a visibility
  flag (no lifecycle churn = no teardown bugs).

- **D5 -- Relationship to Plan 057 (MERGED item filter).** 057 is already merged
  and live: `iterateActiveItemPresences` (`packages/runtime-core/src/scene/item-presence-filters.ts`,
  commit `96e68a2`) is consumed today by both item spawn paths --
  `gameplay-session.ts:1234` (ECS) and `runtimeHost.ts:2293` (visual). It is ITEMS-ONLY
  and LOAD-TIME: `registerItemInteractables` runs once at assembly; its `shouldSkip`
  predicate is evaluated once per region load, not per frame. (An earlier draft of this
  plan wrongly called 057 "unmerged" after mis-reading the stale `origin/unify-item-presence-spawn`
  branch, which carries an older pre-069 copy of the commit -- corrected.)
  This epic does NOT reuse 057's helper directly, because presence gating needs
  DYNAMIC reconcile (D3), a strictly larger mechanism than 057's one-shot load-time
  filter. We mirror 057's core LESSON (one predicate shape, both paths) in D4 rather
  than its code. Deferred (not "retire 057" -- nothing to retire): a future
  consolidation that upgrades the item path to the same dynamic reconciler, so items
  can also appear/disappear mid-region on a condition change (which 057's static
  filter cannot do). No action needed on 057 for this epic; it stays as the live item
  seam and is untouched.

- **D6 -- Studio authoring: new editor on the presence inspector, field-shape
  referenced from the volume UI.** The NPC presence inspector to EXTEND lives in
  `LayoutWorkspaceView.tsx:1895-1916` (today Type / Scope / Spawn-Position only).
  The field-shape REFERENCE (a quest-binding condition editor) is the containment-volume
  panel in `SpatialWorkspaceView.tsx:657-718` -- but that panel hand-builds the binding
  inline and exposes ONLY the world-flag clause, so this is net-new UI (quest + stage +
  flag inputs), not a port. The #418 ask is explicitly "stage + world-flag activation,"
  so the presence editor exposes quest + quest-stage + world-flag from the start. It
  writes through the new `SetNPCPresenceCondition` command (D2), the presence analog of
  the volume-update path. (Note the two inspectors are in different workspaces --
  presence authoring is in Layout, volume authoring in Spatial; do not conflate.)

## Stories (EXECUTION ORDER)

### 079.1 Domain: `condition` field + `SetNPCPresenceCondition` command (D1, D2)

Add `condition: RegionBehaviorQuestBinding | null` to `RegionNPCPresence`
(`region-authoring/index.ts`) and normalize it in `createRegionNPCPresence` (default
`null`, reuse `createRegionBehaviorQuestBinding` for a populated value). The condition
is authored AFTER placement (like volumes), so `CreateNPCPresence` is NOT changed;
instead add a new `SetNPCPresenceCondition` command -- command type +
union registration (`commands/index.ts`), payload `{ presenceId, condition }`, and an
`applySetNPCPresenceCondition` executor that maps the overlay presences and replaces
the matching presence's `condition` (mirror `applyTransformNPCPresence`). Also patch
`createNPCPresenceFromCommand` (`executor.ts:623`) to set `condition: null` explicitly
(it hand-builds the presence and bypasses the factory). Handle region
(de)serialization so existing authored regions load with `condition: null`. Exit: unit
tests -- a presence round-trips a populated compound binding (quest+stage+flag) through
create -> `SetNPCPresenceCondition` -> serialize -> deserialize; a legacy presence with
no condition loads as `null`; `SetNPCPresenceCondition` on a missing presenceId is a
no-op; the factory normalizes a partial binding.

### 079.2 Runtime: dynamic presence reconciler (D3, D4) -- THE risk story

Introduce the active-presence authority in runtime-core: each frame (or on quest/flag
change) evaluate every NPC presence's `condition` via `evaluateRegionQuestBinding`
against the live `{ activeQuest, hasWorldFlag }` context already assembled at
`gameplay-session.ts:2098-2111`. Reconcile the `npcInteractableEntities` map against
the diff. This requires refactoring `registerNpcInteractables` (today a once-only
all-presences loop with NO despawn counterpart) into per-presence spawn + a new
despawn: destroy the entity and delete its `presenceId` key from
`npcInteractableEntities`. Because every per-frame NPC consumer (behavior
`getNpcEntities` `:2010`, collision agents `:2038`/`:2195`, availability, billboards)
derives from that one map, the removal cascades with no separate teardown -- the
behavior system's internal-Map self-cleanup (`behavior/system.ts:755`) then drops the
stranded bookkeeping on the next sync. (The behavior system does NOT destroy entities;
this despawn is genuinely new code.) Expose the authority (active set or
`isPresenceActive(presenceId)`) for the web host (079.3). A `condition: null` presence
is always active (no change for existing content).
EDGE CASE (verified, declare scope): behavior movement state is keyed by
`npcDefinitionId` (`system.ts:712`), but presences are keyed by `presenceId`. If two
presences share ONE `npcDefinitionId` and only one is gated out, the definitionId stays
in the active set and behavior bookkeeping is not cleaned. v1 scope: gate presences
independently by `presenceId`; multiple conditional presences sharing a single
`npcDefinitionId` is OUT OF SCOPE (documented, not handled) -- the definitionId-keyed
behavior state is a pre-existing constraint this epic does not refactor. The exit test
asserts the single-presence-per-definition path.
Exit: integration test -- presence gated on flag X is absent at load, appears after
`setFlag(X)` mid-region without a reload, disappears again if the flag clears; a
null-condition presence is present throughout; despawn removes the interactable entity
(assert `npcInteractableEntities` count / entity absence, not just a boolean) so no
ghost E-prompt or collision agent remains.

### 079.3 Web host: visual mesh visibility follows the reconciler in lockstep (D3, D4)

The web host consumes the 079.2 authority to drive `root.visible` + mixer-skip on the
matching `kind: "npc"` renderable -- NO teardown/re-create (D3). When a presence is
inactive: `entry.root.visible = false` and its mixer is skipped in the tick loop
(`runtimeHost.ts:1699-1701`, gate the tick on `entry.root.visible`). When active:
`visible = true`, mixer resumes. The three.js group stays loaded for the region's
lifetime -- the NPC keeps appearing in `resolveSceneObjects` output so the reconciler
never destroys the entry; only the `visible` flag changes. No independent condition
check in the host -- it reads the shared authority only (D4). Exit: a headless/preview
check -- a flag-gated NPC has `visible === false` and a NON-ticking mixer before the
flag, and `visible === true` with a ticking idle after, no reload hitch on transition;
a null-condition NPC renders as today. (Verification via the existing preview/perf
harness where feasible; otherwise a runtime-host unit around the visibility seam.)

### 079.4 Studio: condition authoring on the NPC presence inspector (D6)

Add a condition editor to the NPC presence inspector in `LayoutWorkspaceView.tsx:1895-1916`
(where Type / Scope / Spawn-Position are edited today). Author quest, quest-stage, and
world-flag (the full compound the #418 ask names), referencing the field shape from the
containment-volume condition panel (`SpatialWorkspaceView.tsx:657-718`) -- net-new
inputs, not a port (that panel exposes only the flag clause; see D6). Writing a
condition dispatches the new `SetNPCPresenceCondition` command (079.1); clearing it
writes `condition: null`. Copy is minimal per house norm: label + self-documenting
controls, at most one helper line. Exit: authoring a condition in Studio, saving, and
confirming the region document carries the populated binding; clearing it returns the
presence to always-present.

### 079.5 Wrap: docs + tests + deferred triggers

Update `docs/api` (the region-authoring / NPC presence doc, and
`sugaragent-npcs.md`'s "World Events" authoring-pattern section which today points
authors at behavior-task gating as the only presence tool -- add conditional presence
as the direct option). Document the choice: behavior-task gating (present-but-neutral)
vs. presence gating (physically absent), and when to use each. File the deferred
consolidation (upgrade the merged item filter path to the same dynamic reconciler so
items can also appear/disappear mid-region) and the
NPC-pathfinding-into-a-closed-conditional-gate caveat (from the 069 navmesh research)
as backlog tasks with revisit triggers. Exit: docs updated, `pnpm test` green, deferred
tasks filed.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Author an NPC in Build with a condition "quest stage = X" (or "flag Y = true").
   Save. In preview, before the condition holds: the NPC is absent -- no mesh, no E
   prompt, cannot be talked to. Advance the quest to stage X (or set the flag via a
   trigger/dialogue). WITHOUT reloading the region, the NPC appears -- mesh renders,
   idle animates, E prompt works, conversation opens.
3. Reverse it (clear the flag / regress the stage if possible): the NPC disappears
   cleanly -- no floating mesh, no orphaned prompt.
4. An NPC with NO condition behaves exactly as before this epic (present at load).
5. Confirm behavior-task gating still works independently (an always-present NPC with
   a quest-gated behavior task still goes neutral off-condition) -- presence gating
   and behavior gating compose, they do not collide.

## Epic wrap

docs/api updated (presence condition field, presence-vs-behavior gating guidance).
Deferred sweep: upgrade the merged item filter path to the dynamic reconciler, NPC
pathfinding into closed conditional gates.

## Deferred (with revisit triggers)

- **Upgrade the merged item filter path to the dynamic reconciler.**
  Once NPC dynamic gating ships, item presence (currently static, load-time, via the
  MERGED 057 helper `iterateActiveItemPresences`) can move onto the same reconciler and
  gain mid-region appear/disappear too. Revisit trigger: when an item needs to
  appear/disappear on a condition change WITHOUT a region reload (the exact thing 057's
  static filter can't do), or when touching item spawn for any other reason. This
  extends 057's helper, it does not retire it.
- **NPC pathfinding into a closed conditional gate.** Conditional containment/blocker
  volumes are collision-only; the navmesh is static-baked and does not know a gate is
  shut (069 navmesh research). A present NPC could path toward a closed gate and clip
  against it. Not triggered by this epic (presence gating removes the NPC entirely
  rather than routing it), but adjacent. Revisit trigger: authored content puts a
  path-following NPC on the far side of a conditional gate. Likely needs the tiled
  navmesh / TileCache work (task #377).
- **Dispose absent NPCs at scale (memory escape hatch).** D3 keeps absent NPC meshes
  resident in memory (visible=false) to avoid teardown bugs and reload hitches. Fine
  for a handful per region. Revisit trigger: a region holds enough conditional NPCs
  that resident character meshes show in a memory profile. At that point add an opt-in
  dispose-on-absent path (accepting the reload hitch on return) for the heavy cases,
  keeping visible-toggle as the default. Not now -- the bug surface of teardown is why
  it is deferred, not default.
- **Presence condition on a per-frame hot path.** 079.2 evaluates N presences per
  frame. N is tiny today (a handful per region). Revisit trigger: if a region ever
  holds enough conditional presences that the per-frame evaluate shows in a profile,
  switch from per-frame to event-driven (re-evaluate only on quest-advance / flag-set
  signals). The reconcile-on-diff structure already makes this a localized change.
