# Plan 058 — Scenes content model + progress persistence

Status: proposed
Owner: nikki + claude
Date: 2026-07-01, rescoped 2026-07-02 (framing pass 6 — per-Scene environment / audio / transitions + cross-Scene scoping)

Related: Plan 055 (SaveParticipant model — the persistence mechanism this plan uses). Plan 057 (item-presence filter helper — survives 058 with a source swap, not a shape change). Downstream users: quest authoring, dialogue authoring, world/region authoring, content release / gating. Refactor scope: current `region.scene` splits between Region base and Scene overlay depending on the field.

## Framing

The game is structured into **Scenes** — chunks of authored narrative content that unlock and release sequentially over calendar time or by player progress. Authors label scenes per-project according to their game's tone (`"Chapter"` / `"Episode"` / `"Act"` / `"Book"` / whatever fits); the engine only knows they're Scenes.

Terminology aligns with Unity Scene / Bevy Scene conventions. The mechanical model is closer to **Unreal's Data Layers** (single file, tagged actors, active layers composed at runtime) than to Unity's file-level scene splitting.

## Design patterns (load-bearing — every story adheres)

This epic follows three named patterns. Every story in this plan MUST cite which pattern(s) it applies and preserve them. Coherency reviews check story-by-story against these.

### Pattern 1 — Base + Overlay (Layer Composition)

The primary data-model pattern. Also known as Layer Composition. Precedent: Photoshop layers, **UE5 Data Layers**, Kubernetes Kustomize, CSS cascade.

- **Base**: `Region` document — geographic shell + always-visible assets. Shared across all Scenes in a project.
- **Overlay**: `Scene.regionOverlays[regionId]` — per-Scene placements composed onto the base region.
- **Composition rule**: the ACTIVE Scene's overlay for the current region is applied on top of the base. Non-active Scenes' overlays exist in the data but aren't visible to the runtime or the editor context.

The composition is one-Scene-at-a-time in v1. Multi-overlay stacking (two Scenes simultaneously) is NOT in scope; additive extension if we ever need it.

**Placed assets split base vs. overlay per-asset.** See "Placed asset scope" below — this is the load-bearing refinement from framing pass 5.

### Pattern 2 — Ambient Context

Also known as Context Object / Implicit Scope. Precedent: React Context, ambient assemblies in .NET, Studio's own `gameProjectId` flow.

Studio's top-bar Scene selector sets a project-wide "current Scene" that flows implicitly through every Design workspace's data source, so authors don't manually pick `sceneId` per item. Creating a Scene-scoped item (a quest, a presence) while Scene 3 is active silently stamps `sceneId: "scene:3"` on the created record.

For **placed assets**, the ambient context DOESN'T auto-stamp `sceneId` — instead the author picks the asset's scope explicitly at creation (Base vs. current Scene) via a Studio Scope field, mirroring how Unreal's editor asks you to pick a Data Layer when placing an actor.

The current-Scene value is stored in Studio local state, not in project.sgrmagic — it's a per-author preference, not project data.

### Pattern 3 — Filtered Composition at Runtime

Also known as Runtime Feature Filter. Precedent: LaunchDarkly feature flags composed at request time, Kubernetes Kustomize apply, CSS media-query cascades, **UE5 Data Layer toggles**.

At `host.start`, the runtime resolves `unlockedSceneIds` from `campaign.progression.unlockedSceneIds` and evaluates each Scene's unlock condition. Content loading then filters: only Scenes in `unlockedSceneIds` contribute overlays to the composed world. Scene overlays for non-unlocked Scenes ship in the bundle (bake-everything decision, tension #1) but are invisible at runtime.

The filter runs ONCE at boot for the active-Scene decision, then per-region-load for that active Scene's overlay. Never per-tick.

## Placed asset scope — split, following Unreal Data Layer precedent

**This is framing pass 5's load-bearing decision.** Placed assets (`PlacedAssetInstance` — static geometry / props like fountains, walls, market stalls) split into TWO scopes per asset:

- **Base scope**: lives on `Region.placedAssets`. Always visible in every Scene that uses this region. For truly always-there geography and permanent props (fountain, walls, terrain features).
- **Overlay scope**: lives on `Scene.regionOverlays[regionId].placedAssets`. Visible only when this Scene is active. For Scene-specific decoration (market stalls in the "town alive" Scene, boarded windows in the "abandoned" Scene, seasonal decorations).

Both scopes have their own `folders` tree (`RegionSceneFolder`) grouping their own assets. Same shape both sides. Runtime `resolveSceneObjects` composes: Base assets + active Scene overlay assets, feeds all of them to the visual spawn.

Presences (items, NPCs, player) are **overlay-only** — they're inherently Scene-specific and have no "always present" semantic. `playerPresence` remains singular but per-(Scene, Region) instead of per-Region.

Regions themselves stay in the shared library — they're the base shell. NPC definitions, item definitions, spell definitions, mechanics all stay in the shared library (they're referenced by presences and quests; the definitions themselves aren't Scene-scoped).

## Per-Scene environment / audio / transition config

Framing pass 6 addition — three fields every Scene overlay carries that Unity + Unreal treat as first-class:

- **`environmentOverride`**: optional `{ environmentId: string }` on the Scene. When set, runtime uses this environment (lighting, skybox, ambient) for the Scene's atmosphere instead of the region's or project's default. Unreal analog: post-process volumes tagged to a Data Layer. Unity analog: per-Scene lighting settings. Load-bearing for narrative games — Scene 3 as twilight fog, Scene 5 as storm at night.
- **`audioOverride`**: optional `{ soundEventBindingsOverride?, backgroundMusicId?, ambientSoundId? }` on the Scene. When set, runtime applies these audio bindings for the Scene's active period. Melancholy piano in Scene 3, tension strings in Scene 5. Null fields fall through to project-level bindings.
- **`transitionConfig`**: optional `{ titleText?: string, subtitleText?: string, durationMs?: number, fadeStyle?: "cross" | "black" | "white" }` for the player-facing UI when the game advances into this Scene. Runtime renders a title card during the transition tick between `currentSceneId` values. Author-configurable; null = no title card, hard cut.

All three are Scene-level fields (not per-region overlay), because they scope to the Scene's atmosphere as a whole. Runtime reads them at Scene load time and on transition.

## Scene metadata

Framing pass 6 addition — every Scene also carries author-facing metadata:

- `displayName: string` — the Scene's title (rendered in the transitionConfig title card by default, and in Studio's Scene selector)
- `description: string` — one-paragraph author summary
- `notes: string` — free-form author notes (design intent, dependencies, TODOs)

No changelog field for v1 — the git history and Studio's diff view fill that role.

## Cross-Scene reference scoping — hard boundary at authoring time

Framing pass 6 assertion: **Scene-scoped items in one Scene must not appear in dropdowns / pickers when editing a different Scene's items.** A quest authored in Scene 1 cannot be selected as a "prerequisite quest" for something being authored in Scene 3 — Studio's picker won't show it. The runtime enforces this at compile / boot: a Scene-scoped reference across Scene boundaries is a lint error.

Library items (NPC definitions, item definitions, shared dialogues, mechanics, spells) DO appear in every Scene's dropdowns — they're Base, not Scene-scoped.

This is enforced by pattern 2 (Ambient Context) at authoring time — every workspace's picker filters by "is this item in the current Scene's scope OR the shared library?" No workspace exposes cross-Scene picking.

Studio surface: every placed asset's inspector gets a **Scope** dropdown: `"Base — always visible"` or `"Scene <N>: <name>"`. Default on creation is the active Scene's overlay (matching the Ambient Context expectation), but the author can flip to Base immediately. Migration defaults to **Base** for all existing `region.scene.placedAssets` (see 058.1) — safest, preserves current behavior.

## No "Season" concept in the engine

Earlier drafts included Seasons as the level above Scenes, but a "next season" (e.g. Wordlark Hollow → Rackwick City) is a genuinely new project with its own regions, mechanics, and world. Separate Studio project. Player identity carries via SugarProfile (already handles it); any cross-project meta-progression would be a plugin, not engine core. Scenes are the single narrative-partition primitive.

Author-side label mapping is a per-project setting (`scenesUiLabel: string`, default `"Scene"`) that renders "Chapter 3" / "Episode 3" / "Act 3" in the game's UI without changing the engine's `Scene` primitive.

## Goal

After this epic:

- Studio's top bar has a Scene selector next to the Project title + version chip (`Sugarmagic | 🎮 Wordlark Hollow | v1 | Scene 3: The Reckoning | Design ...`). Switching Scenes scopes what every Design workspace shows via **Ambient Context**.
- `Region` retains geography (landscape + areas) AND Base-scope placed assets + folders. Scene overlays own presences + Overlay-scope placed assets + folders.
- Every placed asset carries an explicit Scope (Base or Scene-N) authored via a Studio dropdown, following the UE5 Data Layer model.
- Runtime knows which Scenes are unlocked and composes accordingly via **Filtered Composition at Runtime**.
- Player progression persists via a new `campaign.progression` SaveParticipant.
- Additive-only content contract: shipping Scene N doesn't break saves from mid-Scene (N-1).

## Stories

Sequencing revised 2026-07-02 after code audit + placed-asset scope refinement.

### 058.1 — Introduce `Scene` type; split `region.scene.*` into Region base vs. Scene overlay

**Pattern applied**: Base + Overlay (Layer Composition).

Single atomic story — no dual-source-of-truth window.

- Define `Scene`, `SceneOverlay`, `RegionSceneOverlay` domain types in `packages/domain/src/scenes/` (plural, avoids collision with existing `packages/runtime-core/src/scene/` for visual SceneObject concerns). Fields on `Scene`:
  - `sceneId: string`, `sceneOrder: number`
  - `displayName: string`, `description: string`, `notes: string`
  - `unlockCondition: SceneUnlockCondition`
  - `environmentOverride: { environmentId: string } | null`
  - `audioOverride: { soundEventBindingsOverride?, backgroundMusicId?, ambientSoundId? } | null`
  - `transitionConfig: { titleText?, subtitleText?, durationMs?, fadeStyle? } | null`
  - `regionOverlays: Record<regionId, RegionSceneOverlay>`
- Add `scenes: Scene[]` to `GameProject`. On existing projects (wordlark), a **load-time migration** (Studio's project-load path, `apps/studio/src/**`) creates a single default Scene and moves every region's `scene.*` fields as follows:
  - `region.scene.placedAssets` → **stays on Region as `region.placedAssets`** (Base scope by default — safest, preserves current visual behavior).
  - `region.scene.folders` → stays on Region as `region.folders` (they group the base-scope assets that just stayed put).
  - `region.scene.itemPresences` → moves into `defaultScene.regionOverlays[region.identity.id].itemPresences`.
  - `region.scene.npcPresences` → moves into `defaultScene.regionOverlays[region.identity.id].npcPresences`.
  - `region.scene.playerPresence` → moves into `defaultScene.regionOverlays[region.identity.id].playerPresence`.
- Migration is idempotent: if `project.scenes` already exists, skip.
- Update `RegionDocument`: remove `scene` field. Add `placedAssets: PlacedAssetInstance[]` and `folders: RegionSceneFolder[]` as top-level fields (moved out of the deleted `scene` nest).
- Update Scene overlay shape: `{ itemPresences, npcPresences, playerPresence, placedAssets, folders }`. Overlay-scope placed assets and their folders live here.
- Update all 16 read sites the audit found. Split read paths by field type:
  - Assets: read from BOTH `region.placedAssets` (base) AND `activeScene.regionOverlays[regionId].placedAssets` (overlay). Compose the union.
  - Presences: read from `activeScene.regionOverlays[regionId]` only.
- Update the 23 mutation commands in `packages/domain/src/commands/executor.ts`:
  - **Presence commands** (Create/Transform/Remove for player, NPC, item) — targeting changes from `{ aggregateKind: "region-document", aggregateId }` to `{ aggregateKind: "scene", aggregateId: sceneId }` with `regionId` in the payload.
  - **Placed asset commands** (PlaceAssetInstance, MovePlacedAsset, DuplicatePlacedAsset, RemovePlacedAsset, MovePlacedAssetToFolder) — command payload gains a `scope: "base" | { sceneId }` field. Base-scope commands target the Region. Overlay-scope commands target the Scene. Executor branches by scope.
  - **Folder commands** (CreateSceneFolder, RenameSceneFolder, DeleteSceneFolder) — same split by scope.
  - Preserve the singular `playerPresence` constraint but enforce per-(scene, region) now.
- Update Plan 057's `iterateActiveItemPresences` — input array shape unchanged (`RegionItemPresence[]`), source becomes `activeScene.regionOverlays[activeRegion.identity.id].itemPresences`.
- Update `PublishedWebRuntimeSnapshot` serialization (`packages/plugins/src/deployment/published-web.ts`) — shrink `RegionDocument` in boot.json, include `project.scenes` in the snapshot.
- Update `packages/domain/src/io/index.ts` normalization layer — strip old `region.scene` field, normalize new `region.placedAssets` + `region.folders` + `project.scenes` shape.
- Update the 4 test files touching `region.scene` to the new access paths.
- Add tests: migration idempotency; default Scene creation on fresh project; presence commands land in the right Scene's overlay; asset scope-toggle round-trips (place a base asset, place an overlay asset in Scene 1, confirm base is always visible and overlay only shows in Scene 1's context).

Wordlark's current content: all placedAssets stay on Region shell (Base). All presences move into `"scene:default"` overlay. No user-visible change (still one Scene, same content). This is genuinely the biggest story — probably 2-3 days of work.

### 058.2 — Studio Scene selector + LayoutWorkspaceView rewrite + Scope dropdown

**Pattern applied**: Ambient Context.

- Top-bar Scene selector next to Project button + version chip (`Sugarmagic | 🎮 Wordlark Hollow | v1 | [Scene 3: The Reckoning ▾] | Design ...`).
- Selector reads `project.scenes` for options, tracks current Scene in Studio local state (per-project, per-author).
- **Rewrite `LayoutWorkspaceView.tsx`** (biggest single-file surface, ~40 read sites): source scene-explorer tree from the union of `region` (Base assets + folders) and `activeScene.regionOverlays[currentRegionId]` (overlay presences + assets + folders). Render both scopes with a visual indicator (e.g., overlay assets get a Scene badge).
- **Scope dropdown** on the placed-asset inspector: `"Base — always visible"` or `"Scene N: <name>"`. Default new placements to the active Scene's overlay. Changing scope on an existing asset dispatches a MOVE command (base → overlay or overlay → different scene). Model this after Unreal's Data Layer picker.
- "All Scenes" mode on the selector as an escape hatch for cross-Scene overview. When active, LayoutWorkspaceView shows presences from every Scene's overlay flattened.
- Design workspace tabs (Quests, Dialogues, NPCs, Items) filter by active Scene where content is Scene-scoped. Library items (NPC defs, item defs) show regardless.
- **Cross-Scene reference scoping** — every workspace's picker / dropdown that references authored content filters by (current Scene's overlay ⋃ shared library). Scene 1's quest is NOT selectable when authoring Scene 3's content. This is a load-bearing invariant of Pattern 2 (Ambient Context).
- **Scene inspector** — a small inspector panel for the currently-active Scene lets the author edit `displayName`, `description`, `notes`, `unlockCondition`, `environmentOverride`, `audioOverride`, `transitionConfig`. Probably nested inside the selector's "Manage Scenes" panel.
- **Preview uses Ambient Context** — Studio's Preview button boots into the currently-active Scene in the editor. No separate "preview which Scene?" picker; the selector's current value drives Preview.
- `scenesUiLabel` project field wired to the selector's label ("Chapter 3" vs "Scene 3").
- Add tests: switching Scenes changes what LayoutWorkspaceView shows; Base assets visible across every Scene context; overlay assets only visible in their own Scene; Scope dropdown moves assets correctly; cross-Scene picker filtering (a quest in Scene 1 doesn't appear in Scene 3's dropdowns).

### 058.3 — Author multiple Scenes; end-to-end multi-Scene UX

**Pattern applied**: Base + Overlay (multi-Scene authoring), Ambient Context.

058.1 + 058.2 handle single-Scene projects. This story enables authoring multiple Scenes for real.

- Studio surface for creating / renaming / deleting / reordering Scenes ("Manage Scenes" panel or button near the Scene selector).
- New Scene starts with empty `regionOverlays: {}` — no presences, no overlay assets in any region. Base assets are visible from Region shell automatically.
- Cross-Scene copy: "duplicate this presence into another Scene" as a right-click action (the "same NPC placed in same spot across Scenes 1-3" pattern).
- Cross-Scene copy for placed assets: "copy this overlay asset into another Scene's overlay" as a right-click action. Base assets are always shared so no copy needed.
- Convert scope: right-click a base asset → "Convert to Scene N overlay"; right-click an overlay asset → "Promote to Base" (moves from Scene overlay onto Region shell).
- Add tests: creating a second Scene; placing overlay presences and assets in it; switching between Scenes shows different overlays; base assets remain visible in both; convert-scope round-trips.

### 058.4 — `campaign.progression` participant + unlock filtering at boot

**Pattern applied**: Filtered Composition at Runtime.

- Domain type for scene unlock condition: `"always"` | `{kind: "manual"}` | `{kind: "questComplete", questId}` | `{kind: "wallClock", unlockAt}`.
- `campaign.progression` SaveParticipant per Plan 055 pattern — carries `currentSceneId`, `unlockedSceneIds`, `completedSceneIds`. Tier: `default`. Same nullable-getter pattern as `quest.manager` / `inventory.player` / `caster.stats` / `npc.behavior`. The rule [[save-participant-for-new-state]] applies unchanged (fifth participant to use it).
- Runtime at boot: after Phase 2 deserialize, resolve `unlockedSceneIds` by evaluating each `scene.unlockCondition` against the current save state. wallClock reads `Date.now()` — runtime read, NOT a persisted value, so [[no-wallclock-in-slice]] doesn't apply.
- `currentSceneId` restoration picks which Scene's overlay the runtime composes. On first boot, falls through to the first Scene by `sceneOrder`.
- `runtimeHost.ts` — spawn picks `activeSceneId` from `campaign.progression`, then `activeRegionId` per host.player as today, then composes `region.placedAssets ⋃ activeScene.regionOverlays[activeRegionId]` as the effective world contents.
- **Apply `environmentOverride`**: at Scene load, if `activeScene.environmentOverride?.environmentId` is set, the runtime uses it instead of the region's default environment. Falls through to region default when null.
- **Apply `audioOverride`**: same pattern for audio bindings and background music at Scene load. Falls through to project defaults per field when null.
- Content loading gates by `unlockedSceneIds` — Scene overlays not in the set are excluded from composition (bake-everything model per tension #1).
- Add tests: unlock condition round-trips; `campaign.progression` slice serialize/deserialize; runtime skips overlays for non-unlocked Scenes; base assets remain visible regardless of Scene unlock state.

### 058.5 — Scene transitions + `world.presence` per-Scene migration + verify

**Pattern applied**: Base + Overlay (for the world.presence schema bump), Filtered Composition at Runtime (for transitions).

- Scene transition hook: quest-complete-triggers-next-scene as the primary path. Author-side: quest action of type `"advanceToNextScene"` or `"unlockScene"` with `sceneId` targetId. Runtime dispatcher handles the action and mutates `campaign.progression`.
- **Player-facing transition UI**: when `currentSceneId` changes, if the new Scene has a `transitionConfig`, the runtime renders a title card (title + subtitle) over the game with the configured fade style and duration. Blocks player input during the animation. Skips if `transitionConfig` is null (hard cut).
- Migrate Plan 055's `world.presence` slice from `Record<regionId, string[]>` to `Record<regionId, Record<sceneId, string[]>>`. Bump `world.presence` `schemaVersion` from 1 to 2. Deserialize handles v1 → v2 upgrade by wrapping existing `string[]` in `{"scene:default": [...]}`.
- Update `WorldPresenceTracker.shouldSkip(regionId, presenceId)` to `shouldSkip(regionId, sceneId, presenceId)`. Callers in `runtimeHost.ts` visual-mesh path and `gameplay-session.ts` ECS-Interactable path get the current sceneId from `activeScene.sceneId`.
- End-to-end verify in prod: author 2 Scenes in wordlark, advance from Scene 1 to Scene 2 via a quest completion, autosave, hard-refresh, Continue → land in Scene 2 with Scene 2's overlays active.
- Refresh memory rules if any new anti-pattern surfaces.

## Central design tensions

### 1. Unlock / release mechanics — bake-everything for v1

Filtered Composition at Runtime, per Pattern 3. All Scene overlays ship in the bundle; the runtime just doesn't compose non-unlocked Scenes' overlays into the active view. Load-per-Scene defers.

### 2. Save safety across content deploys

Additive-only content contract: existing content definition IDs cannot be renamed or deleted, only added to. Renames become deprecations with content-layer aliases.

**Enforcement is delegated to the Release workspace / versioning system, not to this epic.** Studio's Release system already knows which content shipped in which version tag; extending it to refuse destructive edits on shipped content (deletes / renames of IDs that appear in a shipped version's manifest) is Release-system work, not Scene-model work. This epic just needs to not fight that system.

### 3. Cross-Scene presence state (link to Plan 055)

`world.presence` slice moves from `Record<regionId, string[]>` to `Record<regionId, Record<sceneId, string[]>>` in 058.5. v1 saves migrate cleanly.

### 4. Command-shape change

Presence + placed asset + folder commands change their targeting. Placed asset / folder commands gain a `scope` field. Studio dispatch + executor + any command replay update in lockstep during 058.1.

### 5. Placed asset scope authoring UX

Studio inspector's Scope dropdown handles the base-vs-overlay choice. Migration defaults everything to Base (safe). Authors flip individual assets to Overlay as they add more Scenes and want per-Scene decoration.

## Not yet decided

- **Runtime-core's `scene/` folder** — currently holds `SceneObject` visual concerns. New Scene domain type goes in `packages/domain/src/scenes/` (plural) to avoid collision. If we want to consolidate later, that's a rename story.
- **Cross-Scene authoring views** beyond "All Scenes" selector mode — dedicated Lint / Overview workspace? Defer until we feel the pain.
- **`scenesUiLabel` scope** — project-level only for v1; per-Scene override defers.
- **Extending regionAreas from a Scene overlay** — currently `regionAreas` lives on Region shell. If Scene 5 wants a new market-stall area that earlier Scenes don't have, can it? Leaning no: areas are geographic base. Author adds it to the Region shell and just doesn't place presences in it during earlier Scenes.
- **Command replay / audit history** — if commands change targeting from Region to Scene, does any recorded history need migration? Investigate during 058.1.
- **Multi-condition unlock DAG** — current unlockCondition is single-value. Scene 5 requiring (Scene 3 AND Scene 4) needs a combinator. Fine for v1 (linear "Scene N unlocks when (N-1) completes" is common); revisit when a real branching story arc needs it.
- **Undo/redo scope on Scene switch** — probably wipe the undo stack when the selector changes Scene (simpler and less confusing). Confirm at 058.2 implementation.

## Prerequisites

- Plan 055 shipped and stable. ✅ Done.
- Plan 056 shipped and stable (caster.stats + npc.behavior participants). ✅ Done (pending merge).
- Plan 057 shipped and stable — its `iterateActiveItemPresences` helper's input array shape (`RegionItemPresence[]`) survives 058 unchanged, only the source swaps to `activeScene.regionOverlays[regionId].itemPresences`. ✅ Done.
- Wordlark's current sandbox becomes `"scene:default"` during the 058.1 migration; all its placed assets default to Base scope on Region shell.

## Defers

- Cross-project meta-progression (a "Wordlark Hollow completed unlocks something in Rackwick City" concept). Not engine core; plugin territory if it ever ships.
- Multi-overlay composition (two Scenes stacking on the same region at once). Additive extension.
- **Scene templates / duplicate-Scene** ("copy Scene 3 as starting point for Scene 4"). UX nicety; add later if authoring the second Scene from scratch feels painful.
- **Scene metadata changelog field** — git history + Studio diff view fill this role.
- Per-Scene achievements / metrics rollup (adjacent to Plan 020 telemetry).
- Content-side i18n / localization scoping by Scene.
- Multi-Scene scheduling / calendar UI (Studio surface for authoring "Scene 2 unlocks 2026-09-15") — comes with the wallClock unlock-schedule tension resolution.
- Load-per-Scene distribution model. Bake-everything for v1 per Pattern 3.
- Per-Scene mechanics overrides. Additive story if we ever need it.
- Extending `regionAreas` from a Scene overlay. Not currently in scope; areas stay on the Region shell.
- Consolidating `runtime-core/src/scene/` and the new `domain/src/scenes/` naming. Rename story if we ever need it.
