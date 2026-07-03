# Plan 058 — Scenes content model + progress persistence

Status: proposed
Owner: nikki + claude
Date: 2026-07-01, rescoped 2026-07-02 (framing pass 4 — audited)

Related: Plan 055 (SaveParticipant model — the persistence mechanism this plan uses). Plan 057 (item-presence filter helper — survives 058 with a source swap, not a shape change). Downstream users: quest authoring, dialogue authoring, world/region authoring, content release / gating. Refactor scope: current `region.scene` becomes owned by Scene, not by Region.

## Framing

The game is structured into **Scenes** — chunks of authored narrative content that unlock and release sequentially over calendar time or by player progress. Authors label scenes per-project according to their game's tone (`"Chapter"` / `"Episode"` / `"Act"` / `"Book"` / whatever fits); the engine only knows they're Scenes.

Terminology aligns with Unity Scene / Bevy Scene conventions. Bevy is closer to our model (scenes compose entities atop shared assets); Unity Scenes are heavier (self-contained content roots).

## Design patterns (load-bearing — every story adheres)

This epic follows three named patterns. Every story in this plan MUST cite which pattern(s) it applies and preserve them. Coherency reviews (like the 2026-07-02 audit that produced this pass 4 rewrite) check story-by-story against these:

### Pattern 1 — Base + Overlay (Layer Composition)

The primary data-model pattern. Also known as Layer Composition. Precedent: Photoshop layers, UE5 Data Layers, Kubernetes Kustomize, CSS cascade.

- **Base**: `Region` document — pure geographic shell (identity, landscape, areas, folders that group physical geography). Shared across all Scenes in a project. Zero narrative content.
- **Overlay**: `Scene.regionOverlays[regionId]` — per-Scene placements (items, NPCs, assets, player presence, presence-grouping folders) composed onto the base region.
- **Composition rule**: the ACTIVE Scene's overlay for the current region is applied to the base region shell. Non-active Scenes' overlays for the same region exist in the data but aren't visible to the runtime or the editor context.

The composition is one-Scene-at-a-time. Multi-overlay stacking (Scene A + Scene B both compose onto the same base at once) is NOT in scope for v1 — a single active Scene owns the overlay. If we ever need multi-overlay, it's an additive extension.

### Pattern 2 — Ambient Context

Also known as Context Object / Implicit Scope. Precedent: React Context, ambient assemblies in .NET, Studio's own `gameProjectId` flow.

Studio's top-bar Scene selector sets a project-wide "current Scene" that flows implicitly through every Design workspace's data source, so authors don't manually pick `sceneId` per item. Creating a quest while Scene 3 is active silently stamps `sceneId: "scene:3"` on the created record. Deleting an NPC presence while Scene 3 is active removes from `Scene 3`'s overlay, not from Scene 1's.

The current-Scene value is stored in Studio local state, not in project.sgrmagic — it's a per-author preference, not project data.

### Pattern 3 — Filtered Composition at Runtime

Also known as Runtime Feature Filter. Precedent: LaunchDarkly feature flags composed at request time, Kubernetes Kustomize apply, CSS media-query cascades.

At `host.start`, the runtime resolves `unlockedSceneIds` from `campaign.progression.unlockedSceneIds` and evaluates each Scene's unlock condition. Content loading then filters: only Scenes in `unlockedSceneIds` contribute to the composed world. Scene overlays for non-unlocked Scenes are shipped in the bundle (bake-everything decision, tension #1) but invisible at runtime.

The filter runs ONCE at boot for the active-Scene decision, then per-region-load for that active Scene's overlay. Never per-tick; the filter's cost is amortized over the whole session.

## Where each pattern applies

- **Base + Overlay** — the domain type refactor (058.1), the runtime spawn pipeline (058.1), the mutation command shape (058.3), the `world.presence` schema bump (058.5).
- **Ambient Context** — Studio's Scene selector (058.2), the workspace scoping in Design workspaces (058.2), the implicit `sceneId` stamping on authored items (058.3).
- **Filtered Composition at Runtime** — the unlock condition resolver (058.4), the `campaign.progression` participant (058.4), the runtime scene builder's overlay pick (058.4).

## Regions and standing cast live in the shared library (Base of the pattern)

Under Pattern 1's Base + Overlay split:

- **Base library items** (no `sceneId`, visible everywhere): Region shells (landscape + areas), NPC definitions, item definitions, shared dialogue definitions (dialogues that any Scene's NPCs might reference), spell definitions, mechanics.
- **Overlay items** (owned by a Scene): item / NPC / asset / player presences (inside `Scene.regionOverlays[regionId]`), Scene-specific quests, Scene-specific dialogues that only make narrative sense in that Scene, presence-grouping folders.

The current `region.scene.folders` field groups PRESENCES (items and NPCs placed in the region). Under the refactor, presence-grouping folders MOVE with presences into `Scene.regionOverlays[regionId].folders`. Geographic folders (grouping asset placements or area subdivisions) STAY on the Region shell if we ever have them. Today, all folders group presences, so they all move.

## No "Season" concept in the engine

Earlier drafts included Seasons as the level above Scenes, but a "next season" (e.g. Wordlark Hollow → Rackwick City) is a genuinely new project with its own regions, mechanics, and world. Separate Studio project. Player identity carries via SugarProfile (already handles it); any cross-project meta-progression would be a plugin, not engine core. Scenes are the single narrative-partition primitive.

Author-side label mapping is a per-project setting (`scenesUiLabel: string`, default `"Scene"`) that renders "Chapter 3" / "Episode 3" / "Act 3" in the game's UI without changing the engine's `Scene` primitive.

## Goal

After this epic:

- Studio's top bar has a Scene selector next to the Project title + version chip (`Sugarmagic | 🎮 Wordlark Hollow | v1 | Scene 3: The Reckoning | Design ...`). Switching Scenes scopes what every Design workspace shows via **Ambient Context**.
- `Region` is a pure geographic shell (landscape + areas); every existing `region.scene.*` field has moved into Scene ownership via **Base + Overlay**.
- Every Scene-scoped content type (quests, dialogues, presences) is authored inside the active Scene's context — no manual `sceneId` dropdown needed for the common case.
- Runtime knows which Scenes are currently unlocked for the player and composes accordingly via **Filtered Composition at Runtime**.
- Player progression persists across sessions via a new `campaign.progression` SaveParticipant.
- Additive-only content contract: shipping Scene N doesn't break saves from mid-Scene (N-1).

## Stories

Sequencing revised 2026-07-02 after code audit found the earlier 5-story plan understated the LayoutWorkspaceView rewrite and skipped the command-shape change. Now 5 stories again, but each properly scoped.

### 058.1 — Introduce `Scene` type; atomic migration of `region.scene.*` into `Scene.regionOverlays`

**Pattern applied**: Base + Overlay (Layer Composition).

Single atomic story — no dual-source-of-truth window. Coalesces what earlier drafts split as 058.1 + 058.2.

- Define `Scene`, `SceneOverlay`, `RegionSceneOverlay` domain types in `packages/domain/src/scene/` (note: this collides with runtime-core's existing `scene` folder for `SceneObject` visual concerns; may need renaming that folder OR putting the new type in `packages/domain/src/scenes/` — small naming decision to resolve at story start).
- Add `scenes: Scene[]` to `GameProject`. On existing projects (wordlark), a **load-time migration** creates a single default Scene (`sceneId: "scene:default"`, displayName from a `scenesUiLabel + 1` template) and moves every region's `scene.*` fields into `defaultScene.regionOverlays[region.identity.id]`.
- Migration runs in Studio's project-load path (`apps/studio/src/**`) as a pure JSON transform. Idempotent: if `project.scenes` already exists, skip. This gates the "author opens an old project" flow gracefully.
- Update `RegionDocument`: remove the `scene` field (or mark it deprecated on the type with a runtime warning if read, then delete in a later cleanup story).
- Update all 16 read sites the audit found (`resolveSceneObjects` in `packages/runtime-core/src/scene/index.ts`, `gameplay-session.ts` NPC + item + asset loops, `runtimeHost.ts` presence lookups, `LayoutWorkspaceView.tsx` scene explorer tree, `useBehaviorCommands.ts`, `packages/domain/src/io/index.ts` normalization).
- Update **all 23 mutation commands** in `packages/domain/src/commands/executor.ts`: CreatePlayerPresence / CreateNPCPresence / CreateItemPresence / PlaceAssetInstance / etc. Command TARGETING changes from `{ aggregateKind: "region-document", aggregateId }` to `{ aggregateKind: "scene", aggregateId: sceneId }` with `regionId` in the payload. Studio's dispatch layer + any command-history persistence updates accordingly. Preserve the singular `playerPresence` constraint but now enforce it per-(scene, region) instead of per-region.
- Update Plan 057's `iterateActiveItemPresences` — same shape, different source (`activeScene.regionOverlays[activeRegion.identity.id].itemPresences`).
- Update `PublishedWebRuntimeSnapshot` serialization (`packages/plugins/src/deployment/published-web.ts`) to strip `region.scene` and include `project.scenes` in the boot.json output.
- Update the 4 test files that touch `region.scene` (`scene-presence.test.ts`, `authored-loop.test.ts`, `asset-management.test.ts`, `scene-traversal.test.ts`) to use the new access path.
- Add tests: migration idempotency, default-Scene creation for a fresh project, presence commands landing in the right Scene's overlay.

**Wordlark's current content lands as `"scene:default"` overlays for each of its regions** post-migration. No user-visible change (single Scene, same content). Author can rename `scene:default` displayName via a Studio inspector later.

This is genuinely the biggest story — probably 1-2 days of work.

### 058.2 — Studio Scene selector + LayoutWorkspaceView rewrite

**Pattern applied**: Ambient Context.

Everything after 058.1 assumes the data model is in place. Now the UX catches up.

- Top-bar Scene selector next to Project button + version chip (`Sugarmagic | 🎮 Wordlark Hollow | v1 | [Scene 3: The Reckoning ▾] | Design ...`).
- Selector reads `project.scenes` for options, tracks current Scene in Studio local state (per-project, per-author).
- **Rewrite `LayoutWorkspaceView.tsx`** (the biggest single-file surface, ~40 read sites): source scene-explorer tree from `activeScene.regionOverlays[currentRegionId]` instead of `region.scene`. Every presence-selection, folder-navigation, and inspector view repoints its data source.
- Add "All Scenes" mode as an escape hatch for cross-Scene overview + rename-lint work. When active, LayoutWorkspaceView shows presences from every Scene's overlay, flattened, with a Scene badge per row.
- Design workspace tabs (Quests, Dialogues, NPCs, Items) filter by active Scene where the content is Scene-scoped. Library items (NPC defs, item defs) show regardless — they're Base, not Overlay.
- `scenesUiLabel` project field wired to the selector's label ("Chapter 3" vs "Scene 3").
- Add tests: switching Scenes changes what LayoutWorkspaceView shows; "All Scenes" mode shows every Scene's presences; library items are always visible.

### 058.3 — Author multiple Scenes; presence-command targeting

**Pattern applied**: Base + Overlay (multi-Scene authoring).

058.1 + 058.2 handle single-Scene projects. This story enables authoring multiple Scenes in one project.

- Studio surface for creating / renaming / deleting / reordering Scenes (probably a small panel in the Design workspace or nested in the selector dropdown — "Manage Scenes" button).
- Adding a Scene to a project seeds an empty `regionOverlays: {}` — the new Scene starts with NO presences in any region. Author picks a region to view, places NPCs / items, and each command lands in the current Scene's overlay for that region.
- Presence commands (per 058.1) already target `{ aggregateKind: "scene", aggregateId }` with `regionId` in the payload. This story just exercises multi-Scene authoring for real and irons out any UX quirks that only appear at N > 1 Scenes.
- Cross-Scene copy: "duplicate this presence into another Scene" as a right-click action. Handles the common "same NPC placed in same spot across Scenes 1-3, with new content in Scene 5" pattern.
- Add tests: creating a second Scene; placing a presence in it; deleting it; switching between Scenes shows different presences; the same region can have different presences per Scene.

### 058.4 — `campaign.progression` participant + unlock filtering at boot

**Pattern applied**: Filtered Composition at Runtime.

Now Scenes actually gate content at runtime, not just in the editor.

- Domain type for scene unlock condition: `"always"` | `{kind: "manual"}` | `{kind: "questComplete", questId}` | `{kind: "wallClock", unlockAt}`.
- `campaign.progression` SaveParticipant (per Plan 055 pattern) — carries `currentSceneId`, `unlockedSceneIds`, `completedSceneIds`. Tier: `default`. Deserialize + serialize follow the same nullable-getter pattern as `quest.manager` / `inventory.player` / `caster.stats` / `npc.behavior`. Save the memory rule refresh — this participant is the fifth to follow the same recipe so [[save-participant-for-new-state]] applies unchanged.
- Runtime at boot: after Phase 2 deserialize, resolve `unlockedSceneIds` by evaluating each `scene.unlockCondition` against the current save state (quest.manager's `completedQuestIds`, wall clock via `Date.now()` — this is a runtime read, NOT a persisted value, so [[no-wallclock-in-slice]] doesn't apply).
- `currentSceneId` restoration determines which Scene's overlay the runtime composes. On first boot with an authored default, currentSceneId falls through to `scene:default` (or whatever the first Scene is by `sceneOrder`).
- Update `activeScene` resolution in `runtimeHost.ts` — currently spawn picks `activeRegionId`; now spawn also picks `activeSceneId` from `campaign.progression`.
- Content loading gates by `unlockedSceneIds` — bake-everything model per tension #1. All Scene overlays are shipped in boot.json; the runtime just doesn't compose non-unlocked Scenes' overlays into the active view.
- Add tests: unlock condition round-trips; `campaign.progression` slice serialize/deserialize; runtime skips overlays for non-unlocked Scenes.

### 058.5 — Scene transitions + `world.presence` per-Scene migration

**Pattern applied**: Base + Overlay (for the world.presence schema bump), Filtered Composition at Runtime (for transitions).

Final story — ties off the remaining Plan 055 dependency and end-to-end verifies.

- Scene transition first-class hook: quest-complete-triggers-next-scene as the primary path. Author-side: a quest action of type `"advanceToNextScene"` or `"unlockScene"` with `sceneId` targetId. Runtime dispatcher (`packages/runtime-core/src/coordination/gameplay-session.ts` around line 1547) handles the action, mutates `campaign.progression`'s state, and either sets `currentSceneId` for advance or adds to `unlockedSceneIds` for unlock.
- Migrate Plan 055's `world.presence` slice from `Record<regionId, string[]>` to `Record<regionId, Record<sceneId, string[]>>`. Bump `world.presence` `schemaVersion` from 1 to 2. Deserialize handles the v1 → v2 upgrade by wrapping the existing string[] in `{"scene:default": [...]}` — a safe default that says "everything previously collected was collected during Scene 1", which is correct for wordlark (single Scene today).
- Update `WorldPresenceTracker.shouldSkip(regionId, presenceId)` to `shouldSkip(regionId, sceneId, presenceId)`. Callers in `runtimeHost.ts` visual-mesh path and `gameplay-session.ts` ECS-Interactable path get the current sceneId from `activeScene.sceneId`.
- End-to-end verify in prod: author 2 Scenes in wordlark, advance from Scene 1 to Scene 2 via a quest completion, autosave, hard-refresh, Continue → land in Scene 2 with Scene 2's presences active.
- Update the memory rule if any new anti-pattern surfaces (nothing predicted; this is coverage).

## Central design tensions

### 1. Unlock / release mechanics — bake-everything for v1

- **Bake-everything, gate at runtime.** All Scene content ships in the deployed bundle; the runtime composes only unlocked Scenes' overlays. Simpler distribution and rollback. Risk: leakage — savvy players can edit local state to peek at unreleased content, but that's a boundary the current engine already accepts.
- **Load-per-Scene.** Only unlocked Scenes are fetched. Cleaner but complicates content addressing. Overkill for v1.

**Decision: bake-everything.** Filtered Composition at Runtime is the pattern; we filter, not fetch.

### 2. Save safety across content deploys

Additive-only content contract: existing content definition IDs cannot be renamed or deleted, only added to. Renames become deprecations with content-layer aliases. Rule for both engine internals and Studio's authoring UX (should refuse destructive edits on shipped content).

### 3. Cross-Scene presence state (link to Plan 055)

`world.presence` slice moves from `Record<regionId, string[]>` to `Record<regionId, Record<sceneId, string[]>>` in 058.5. v1 saves migrate cleanly (everything wraps under `"scene:default"`).

### 4. Command-shape change

Presence mutation commands change their targeting from Region-scoped to Scene-scoped. The Studio dispatch layer + executor + any command replay/history need to update in lockstep during 058.1.

## Not yet decided

- **Where does the `Scene` type live in the domain package?** `packages/domain/src/scene/` collides with `packages/runtime-core/src/scene/` (existing SceneObject visual concern). Options: put new type in `packages/domain/src/scenes/` (plural), OR rename runtime-core's `scene/` to `scene-objects/`, OR live with the collision (they're in different packages). Small decision to resolve at 058.1 kickoff.
- **Cross-Scene authoring views** beyond the "All Scenes" selector mode — should there be a dedicated Lint / Overview workspace? Defer until we feel the pain.
- **`scenesUiLabel` scope** — project-level only for v1; per-Scene override defers.
- **Region composition when Scenes want to add NEW areas to a shared region.** Areas are on the Region base today. If a Scene wants a new market-stall area inside Town Square, it currently can't. Options: allow Scene overlays to extend `regionAreas`, or refuse (author adds the area to the base Region and just doesn't use it in earlier Scenes). Leaning toward the latter; areas are geographic and belong on the shell.
- **Command replay / audit history** — if commands change targeting from Region to Scene, does any recorded history exist that would break? Investigate during 058.1.

## Prerequisites

- Plan 055 shipped and stable. ✅ Done.
- Plan 056 shipped and stable (caster.stats + npc.behavior participants). ✅ Done (pending merge).
- Plan 057 shipped and stable — its `iterateActiveItemPresences` helper's input array shape (`RegionItemPresence[]`) survives 058 unchanged, only the source changes from `region.scene.itemPresences` to `activeScene.regionOverlays[regionId].itemPresences`. ✅ Done.
- Wordlark's current sandbox becomes `"scene:default"` during the 058.1 migration.

## Defers

- Cross-project meta-progression (a "Wordlark Hollow completed unlocks something in Rackwick City" concept). Not engine core; plugin territory if it ever ships.
- Multi-overlay composition (two Scenes stacking on the same region at once). Additive extension if we ever need it.
- Per-Scene achievements / metrics rollup (adjacent to Plan 020 telemetry).
- Content-side i18n / localization scoping by Scene.
- Multi-Scene scheduling / calendar UI (Studio surface for authoring "Scene 2 unlocks 2026-09-15") — comes with the wallClock unlock-schedule tension resolution.
- Load-per-Scene distribution model. Bake-everything for v1 per pattern 3.
- Per-Scene mechanics overrides. Would be an additive story if we ever need it.
- Deleting the deprecated `region.scene` field entirely (after 058.1 marks it deprecated but keeps it readable for a cleanup window).
