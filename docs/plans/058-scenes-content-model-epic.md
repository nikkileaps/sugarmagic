# Plan 058 — Scenes content model + progress persistence

Status: proposed
Owner: nikki + claude
Date: 2026-07-01, rescoped 2026-07-02 (framing pass 3 — Scenes)

Related: Plan 055 (SaveParticipant model — the persistence mechanism this plan uses). Downstream users: quest authoring, dialogue authoring, world/region authoring, content release / gating. Refactor scope: current `region.scene` becomes owned by Scene, not by Region.

## Framing

The game is structured into **Scenes** — chunks of authored narrative content that unlock and release sequentially over calendar time or by player progress. Authors label scenes per-project according to their game's tone (`"Chapter"` / `"Episode"` / `"Act"` / `"Book"` / whatever fits); the engine only knows they're Scenes.

Terminology chosen to align with Unity Scene / Bevy Scene conventions. Unity is heavier (Scenes are full content roots that swap in/out); Bevy is closer — scenes compose entities atop shared assets, which matches our model directly.

### Scene is an editor context, not a content bundle

The mental model: switching Scenes changes what the editor shows you. You don't see all Scenes at once with a filter chip — you pick a Scene in Studio's top bar and every workspace scopes to that Scene's content. Quests workspace shows Scene 3's quests. Dialogues shows Scene 3's dialogues. Region view shows Scene 3's cast overlaid on the shared region shells. Feels like switching branches in Git, or opening a different Scene in Unity.

Underneath, the data model is dead simple: **each authored item carries an optional `sceneId` field**. Runtime and editor both filter by "does this item belong to a Scene that's currently in scope?" The complexity we spent time worrying about earlier (composition semantics, bundle boundaries, cross-Scene references) mostly evaporates when Scenes are tags with editor context switching.

### Regions are pure geographic shells; Scenes own the placements

**This is the load-bearing refactor.** Today, `RegionDocument.scene` holds `itemPresences`, `npcPresences`, `placedAssets`, `playerPresence` — the placements for that region. It implicitly assumed one Scene per region, which is why the field is even named "scene" in the current shape (accidental foreshadowing of the right model).

Under this epic:

- **`Region`** shrinks to the geographic shell: `identity`, `displayName`, `placement`, `landscape`, `areas`, `folders`. That's it. Regions are pure library items.
- **`Scene`** (new document type) is the narrative container. It owns:
  - Scene-scoped quests + dialogues + presences (things that only exist in this Scene)
  - `regionOverlays: Record<regionId, RegionSceneOverlay>` — for each region this Scene touches, the placements (item / NPC / asset / player presences) active during this Scene
  - Scene metadata (displayName, unlockCondition, `sceneOrder`)
- **Runtime** loads the active Scene, then for each region the player enters, reads `activeScene.regionOverlays[regionId]` to get presences. Presence iteration, filter helpers (Plan 057), the whole spawn pipeline just changes its input source; the shapes don't.

The renamed access pattern:

```
BEFORE:  activeRegion.scene.itemPresences
AFTER:   activeScene.regionOverlays[activeRegion.identity.id].itemPresences
```

Same shape (still `RegionItemPresence[]`), different owner.

### Regions and standing cast live in the shared library

**Regions are shared across Scenes within a project.** A region (Town Square, Cave, Player House) may appear in Scene 1, Scene 3, and Scene 5 — each Scene brings its own overlay of what's placed there. Regions have no `sceneId`; they're library items. Same for **standing-cast NPC definitions**, **shared item definitions**, and **shared dialogue definitions**.

What DOES carry `sceneId` (either explicit field or implicit via "lives inside a Scene document"):
- Presences (via being inside `scene.regionOverlays[regionId]`)
- Scene-specific quests
- Scene-specific dialogues
- Region composition overrides — implicit, since each Scene's overlay is independent

### No "Season" concept in the engine

Earlier drafts included Seasons as the level above Scenes, but a "next season" (e.g. Wordlark Hollow → Rackwick City) is a genuinely new project with its own regions, mechanics, and world. Separate Studio project. Player identity carries via SugarProfile (already handles it); any cross-project meta-progression would be a plugin, not engine core. Scenes are the single narrative-partition primitive.

Author-side label mapping is a per-project setting (`scenesUiLabel: string`, default `"Scene"`) that renders "Chapter 3" / "Episode 3" / "Act 3" in the game's UI without changing the engine's `Scene` primitive.

## Goal

After this epic:

- Studio's top bar has a Scene selector next to the Project title + version chip (`Sugarmagic | 🎮 Wordlark Hollow | v1 | Scene 3: The Reckoning | Design ...`). Switching Scenes scopes what every Design workspace shows.
- `Region` is a pure geographic shell (landscape + areas); every existing `region.scene.*` field has moved into Scene ownership.
- Every Scene-scoped content type (quests, dialogues, presences) is authored inside the active Scene's context — no manual `sceneId` dropdown needed for the common case.
- Runtime knows which Scenes are currently unlocked for the player and loads content accordingly at scene-build time.
- Player progression (which Scene they're on, which they've completed) persists across sessions via a new `campaign.progression` SaveParticipant.
- Additive-only content contract: shipping Scene N doesn't break saves from mid-Scene (N-1).

## Stories

Rough sequencing — will refine as we start:

### 058.1 — Introduce `Scene` document type; empty shell coexisting with `region.scene`

- Define `Scene` domain type (`packages/domain/src/scene/`), `SceneOverlay` (per-region placement bundle), `SceneDefinition`.
- Add `scenes: SceneDefinition[]` to `GameProject`, with a single default Scene that gets created on project bootstrap.
- No behavior change yet — existing `region.scene.*` still authoritative for spawning. This story just gets the type in place.

### 058.2 — Move region placement fields (`itemPresences`, `npcPresences`, `placedAssets`, `playerPresence`) from Region into `Scene.regionOverlays`

- Migrate existing data: for each region, its current `region.scene.*` fields become the default Scene's `regionOverlays[regionId]` overlay.
- Update `RegionDocument`: shrink to geographic shell.
- Update spawn code (`runtimeHost.ts`, `gameplay-session.ts`, `scene/index.ts:resolveSceneObjects`) to read from `activeScene.regionOverlays[regionId]` instead of `activeRegion.scene.*`.
- Update Plan 057's `iterateActiveItemPresences` input — same shape, different source.
- Update authoring: Studio's region editor tab moves placements editing into a Scene-context view. In the single-Scene project (default), no user-visible difference yet.

### 058.3 — Studio Scene selector + workspace scoping

- Top bar Scene selector next to Project + version chip.
- Scene switcher persists in local state (last-viewed Scene per project).
- Design workspace tabs (Quests, Dialogues, NPCs, Items, Regions) filter by active Scene where semantically appropriate — quests / dialogues / presences show only current Scene's; library items (NPC defs, item defs) show regardless.
- "All Scenes" mode as an escape hatch for cross-Scene overview + rename lint work.
- `scenesUiLabel` project field wired to the selector's label ("Chapter 3" vs "Scene 3").

### 058.4 — Scene unlock schedule + `campaign.progression` participant

- Domain type for scene unlock condition (union of `"always"` | `{kind: "manual"}` | `{kind: "questComplete", questId}` | `{kind: "wallClock", unlockAt}`).
- `campaign.progression` SaveParticipant (per Plan 055 pattern) — carries `currentSceneId`, `unlockedSceneIds`, `completedSceneIds`.
- Runtime: at boot, resolve `unlockedSceneIds` by evaluating each Scene's unlock condition against the current save state; if `wallClock` scheduling is used, compare against `Date.now()`.
- Content loading gates by `unlockedSceneIds` — Scenes not in that set have their content filtered out (bake-everything model per tension #1).

### 058.5 — Scene transitions + `world.presence` migration

- Author-side hook: how a Scene ends and the next Scene begins (quest-complete-triggers-next-scene is probably the first-class mechanism; other paths defer).
- Migrate Plan 055's `world.presence` slice from `Record<regionId, string[]>` to `Record<regionId, Record<sceneId, string[]>>` so per-Scene re-storying works cleanly.
- End-to-end verify in prod.

## Central design tensions

### 1. Unlock / release mechanics — bake-everything for v1

- **Bake-everything, gate at runtime.** All Scene content ships in the deployed bundle; the runtime scene builder filters by unlocked Scenes. Simpler distribution and rollback, requires runtime gating to be watertight. Risk: leakage — savvy players can edit local state to peek at unreleased content, but that's a boundary the current engine already accepts (nothing prevents them from editing IndexedDB).
- **Load-per-Scene.** Only unlocked Scenes are loaded/fetched. Cleaner separation but complicates content addressing and save-load-time. Overkill unless Scene content becomes genuinely huge or spoiler-sensitive.

**Decision: bake-everything for v1.** Revisit if we hit a real need.

### 2. Save safety across content deploys

If Scene 3 ships while a player is mid-Scene 2, their save must not break. Implies an **additive-only content contract**: existing content definition IDs cannot be renamed or deleted, only added to. Renames become deprecations with content-layer aliases. This is a rule for both engine internals and content-authoring UX (Studio should refuse destructive edits on shipped content).

### 3. Cross-Scene presence state (link to Plan 055)

Plan 055's `world.presence` slice is currently Scene-agnostic (`Record<regionId, string[]>`). Story 058.5 migrates it to `Record<regionId, Record<sceneId, string[]>>` so a later Scene can re-story items in a shared region (mailbox present in Scene 1, un-collected in Scene 5).

## Not yet decided

- **Scene transition mechanic first-class hook.** Quest-complete-triggers-next-scene is likely the primary; other paths (author-scripted transition, timed transition) can defer.
- **Cross-Scene authoring views** — an "All Scenes" mode on the selector? A dedicated Lint / Overview workspace? Where do "rename this quest across every Scene it appears in" flows live?
- **`scenesUiLabel` — project-level only, or per-Scene override?** Probably project-level for v1; per-Scene override is a future need.
- **Region composition when Scenes want to add NEW areas to a shared region.** If Scene 5 introduces a new area inside Town Square (e.g., a market stall the earlier Scenes didn't have), does that live on the Region document as an addition, or in the Scene's overlay as a Scene-scoped area? Leaning toward the latter — Region areas are the shared library shell; Scene overlays can extend them.

## Prerequisites

- Plan 055 shipped and stable. ✅ Done.
- Plan 056 shipped and stable (caster.stats + npc.behavior participants). ✅ Done (pending merge).
- Plan 057 shipped and stable (presence spawn filter helper — its `iterateActiveItemPresences` shape survives 058's refactor with a source swap, not a shape change). ✅ Done.
- Wordlark's current sandbox becomes "Scene 1" during the 058.2 migration.

## Defers

- Cross-project meta-progression (a "Wordlark Hollow completed unlocks something in Rackwick City" concept). Not engine core; plugin territory if it ever ships.
- Per-Scene achievements / metrics rollup (adjacent to Plan 020 telemetry).
- Content-side i18n / localization scoping by Scene.
- Multi-Scene scheduling / calendar UI (Studio surface for authoring "Scene 2 unlocks 2026-09-15") — comes with the unlock-schedule tension resolution.
- Load-per-Scene distribution model. Bake-everything for v1.
- Per-Scene mechanics overrides (a Scene tweaking spell costs, etc.). Would be an additive story if we ever need it.
