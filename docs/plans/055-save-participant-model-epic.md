# Plan 055 — Save Participant model: per-system progression persistence

Status: proposed
Owner: nikki + claude
Date: 2026-06-30

Related: Plan 047 (SugarProfile, GameSaveStore contract), Plan 051 (SerializedSaveStore + structural reset), Plan 054 (GameStateStore + lifecycle transitions), ADR 020 (per-plugin per-user state boundary).

## Problem

The save infrastructure shipped over 047 / 051 / 054 is structurally correct: the `GameSaveStore` contract handles load/save/clear/resetForNewGame atomically; the SerializedSaveStore wrapper makes the autosave-vs-clear race impossible; Supabase + IndexedDB stores both work end-to-end; boot loads the save and spawns the player in the right region at the right position.

**But the payload itself is bare.** `GameSavePayload` (in `packages/domain/src/save/index.ts`) carries exactly three fields:

```ts
{
  currentRegionId: string | null,
  currentQuestId: string | null,    // just the tracked-quest ID
  playerPosition: { x, y, z } | null
}
```

`getCurrentSavePayload()` in the host (`targets/web/src/runtimeHost.ts:1995`) reads three things from the live runtime: the player's ECS position, the active region's id (stashed at host start), and `questManager.getTrackedQuest()?.questDefinitionId`. That's the whole payload.

What's NOT in there but lives in-memory and resets on reload:

- `QuestManager.activeQuests` — **stage you're on inside the active quest**, objective completion within that stage
- `QuestManager.completedQuestIds` — quest history (what you've finished)
- `QuestManager.runtimeFlags` — quest scripting state
- Inventory contents (`packages/runtime-core/src/inventory/index.ts`)
- World presence state (`sceneObjectEntries` in target-web/runtimeHost) — items deleted via `onItemPresenceCollected` re-spawn on next region load because the region's authored presences are re-applied
- NPC dialogue state, spell/caster persistence, etc. — case-by-case

So a returning player respawns at the right XYZ in the right region with the right "tracked quest" pointer, then finds their inventory empty, their quest progress reset to the first stage, and every previously-collected item back in the world. **Not progression resume in any player-facing sense.**

This plan ships the structural fix for that, picking Option B from the 2026-06-30 design discussion: **per-system save participants** rather than extending the monolithic `GameSavePayload` schema directly.

## Why Option B (participants) over Option A (extend schema)

Option A — keep `GameSavePayload` as a flat record, add `activeQuestState` + `inventoryContents` + `collectedPresenceIds` etc. Easiest to type. But every new persistable system means editing the central schema, every consumer rebuilds against the new shape, and the runtime-core/save module ends up coupled to QuestManager, Inventory, world presence, future Sugarlang vocab tracker, etc. That's a backwards dependency direction (one source of truth for the schema, but every system pulls on that source).

Option B — define a `SaveParticipant` interface; each runtime system that has persistable state implements it and registers with the host. The host orchestrates collect-on-save / dispatch-on-load. Each participant owns its own slice shape and slice schema version. New persistable systems land without touching central save types.

Long-term win: when we add a new persistable system, it's a one-file change (the system itself); the save module doesn't move. Architecturally lines up with the same plugin-participation pattern Plan 054 prototyped for game-session lifecycle (which then got scoped down). MVVM-style: the save store is the View, participants are the Model contributors.

ADR 020 boundary stays: participants are for **runtime-core** systems contributing to the **shared** GameSave. Per-plugin per-user data still lives in plugin-owned stores keyed on userId (sugarlang vocab, sugaragent conversation memory, etc.). The participant kind is NOT a hatch for plugin domain data to ride in GameSave.

## Goal

After this epic:

- The save payload carries enough state that "Continue" actually feels like resume: quest progress restored, completed-quests history intact, inventory restored, collected items still gone from the world.
- Adding a new persistable system (future spell-unlocks, NPC relationship counters, region-explored flags) is one file: implement `SaveParticipant`, register at host.start. No central schema edit.
- Per-slice schema versioning so individual participants can iterate independently.
- Old 3-field saves continue to load (back-compat).

## What's NOT in scope

- **Per-plugin per-user data persistence** (sugarlang vocab, sugaragent memory). Stays in plugin-owned stores per ADR 020. If we later decide a plugin participates in GameSave, that's a separate decision.
- **Mid-save delta optimization.** Every tick serializes every participant's full slice. Cheap given the data volumes; revisit if a participant's slice gets fat.
- **Server-authoritative validation.** Anyone can write any payload via Supabase; RLS gates by userId only. Anti-cheat is a separate concern.
- **Multi-save slots.** Single save per user, mirroring current behavior.
- **Save-file migration UI.** If a slice's schema bumps and an old save can't be upgraded gracefully, the slice resets and the player's progress in that system rolls back. Acceptable for v1.

## Pattern

Two GoF patterns composed:

- **Memento** — each runtime system produces an opaque envelope (a "slice") capturing its internal state and can restore itself from one later. The system owns the envelope shape; nobody outside inspects it. This is why each participant carries its own `schemaVersion` and owns its own upgrade path.
- **Registry + Mediator** — a `SaveParticipantRegistry` tracks the set of participants and orchestrates collect-on-save / dispatch-on-load across all of them without knowing what's in any slice. The host holds one registry for its lifetime.

Naming: this codebase calls the interface `SaveParticipant`. Equally valid names in the wild would be `Persistable` (adjective form), `SaveContributor` (Eclipse plugin-style), or straight `Memento`. Participant sticks because a) it lines up with the MVVM framing (participants are Model contributors to a save View), and b) it emphasizes the composition angle over the state-envelope angle.

### How save/load flows end-to-end

**Save tick (every autosave):**

1. `useAutosave` fires; asks host for `getCurrentSavePayload()`.
2. Host calls `registry.serializeAll()`, which walks every registered participant in registration order, calls `participant.serialize()`, and wraps each return in `{ schemaVersion, data }`.
3. Failures in one participant's serialize log + drop THAT slice from the map; the rest still flow through.
4. The map goes into `GameSavePayload.slices` (added in 055.2) and is written to the active `GameSaveStore`.

**Load / boot (two-phase per `host.start`):**

Deserialize runs in TWO PHASES because some subsystems (QuestManager, InventoryManager, world-presence tracker) don't exist until after `gameplayAssembly` is constructed part-way through `host.start`, but `host.player` needs to have restored its slice BEFORE ECS spawn.

1. `host.start` resolves the save via the store, gets a `GameSavePayload` (or falls through to the project's `defaultGameSavePayload`; null if neither exists).
2. Whichever seed payload is chosen flows through `upgradeLegacyPayload` — pre-055 3-field payloads normalize into the same slice shape post-055 writes produce.
3. **Phase 1 (before spawn):** Host calls `registry.deserializeAll(slices, ["host-owned"])`. Only the `host.player` participant fires; it stashes its slice's data. Host reads the stashed values to resolve spawn region + position, then spawns the world / player entity.
4. **Phase 2 (after gameplayAssembly):** After `gameplayAssembly` is constructed, host registers the remaining participants (`quest.manager` in 055.4, `inventory.player` in 055.5, `world.presence` in 055.6) — they can now reach their subsystems via getter. Host then calls `registry.deserializeAll(slices, ["region-aware", "default"])`. Each participant hydrates its subsystem from its slice.
5. Failures in one participant's deserialize log and leave that participant in partial state; others still restore.

**Adding a new persistable system later:**

1. Implement `SaveParticipant<TSlice>` on the system.
2. In whatever assembly wires that system up, call `host.registerSaveParticipant(instance)`.
3. Done. No central schema edit, no other participants touched. Existing saves without a slice for the new participant get `null` on deserialize and the system restores defaults.

### `SaveParticipant` contract (in runtime-core)

```ts
interface SaveParticipant<TSlice = unknown> {
  /** Stable namespace. Convention: "<system>.<purpose>" e.g.
   *  "quest.manager", "inventory.player", "world.presence". */
  participantId: string;

  /**
   * Current slice schema version. Bumped when the slice shape
   * changes incompatibly. Deserialize handles older versions
   * (or returns null/throws to skip the slice).
   */
  schemaVersion: number;

  /** Read live state, return the slice to persist. Sync,
   *  cheap; called every autosave tick. */
  serialize(): TSlice;

  /** Restore live state from a slice loaded from the store.
   *  Receives `null` when no slice was stored (fresh player or
   *  participant added after this save was written) — restore
   *  defaults. Receives `{ schemaVersion, data }` otherwise. */
  deserialize(slice: { schemaVersion: number; data: TSlice } | null): void;
}
```

### Updated `GameSavePayload` (in domain)

```ts
interface GameSavePayload {
  /** One slice per registered participant, keyed by participantId.
   *  Missing keys = participant not registered when the save was
   *  written, OR added later; deserialize gets null. */
  slices: Record<string, { schemaVersion: number; data: unknown }>;

  // Legacy fields kept for back-compat with pre-055 saves.
  // New saves leave them null; new readers use the slice for
  // these participants. Retired in 055.7 once all prod saves
  // are written in the new shape.
  currentRegionId: string | null;
  currentQuestId: string | null;
  playerPosition: { x: number; y: number; z: number } | null;
}
```

A read-time helper in domain (`upgradeLegacyPayload`) converts pre-055 payloads into the new slice shape so old saves continue to load.

### Host orchestration

```ts
// In runtimeHost
host.registerSaveParticipant(p: SaveParticipant): void;
host.unregisterSaveParticipant(participantId: string): void;
```

- During `host.start`, the host calls `participant.deserialize(savedSlice ?? null)` for each registered participant. Order: host-owned slices first (region, player position — these are needed for ECS spawn), then everything else. Inside a tier, registration order.
- `host.getCurrentSavePayload()` collects every participant's `serialize()` into the slices map. Cheap (in-memory reads).
- Failures in `deserialize` log and continue — that participant resets to defaults; the others still load.
- Failures in `serialize` log and SKIP that slice in the written payload. (Better to write a partial save than to lose every other system's progress because one threw.)

### Existing systems migrated

| Participant id | Owner | Slice |
|---|---|---|
| `host.player` | runtimeHost.ts | `{ position, currentRegionId }` |
| `quest.manager` | QuestManager.ts | `{ activeQuests, completedQuestIds, runtimeFlags, trackedQuestDefinitionId }` |
| `inventory.player` | inventory/index.ts | `{ entries: [{ definitionId, count }] }` |
| `world.presence` | (new module in runtime-core/world/) | `{ collectedPresenceIds: Record<regionId, string[]> }` |

The `world.presence` participant is the only NEW module. The others all exist; we add `SaveParticipant` impl to them.

## Stories

### 055.1 — `SaveParticipant` contract + host registry

- `packages/runtime-core/src/save/participant.ts` (new) — `SaveParticipant` interface, `SaveParticipantRegistry` impl.
- `runtimeHost.ts` constructs a registry at factory time; exposes `host.registerSaveParticipant(p)` / `host.unregisterSaveParticipant(id)`.
- `host.start` calls `deserialize` on each participant after the save loads, BEFORE world/player spawn. (Host-owned slices run first; then domain participants.)
- `getCurrentSavePayload` collects from the registry instead of hand-rolling the 3 fields.
- Tests: register participants, save, load, verify each participant's deserialize is called with its slice; failures isolate per-participant.

### 055.2 — Domain payload shape + legacy upgrade

- `packages/domain/src/save/index.ts` — extend `GameSavePayload` with `slices`. Keep legacy fields.
- `upgradeLegacyPayload(payload)` helper — if no slices but legacy fields present, synthesize a `host.player` slice from `{ position, currentRegionId }` and a `quest.manager` slice with just `trackedQuestDefinitionId`.
- Tests: legacy 3-field payload + a brand-new participant-style payload both round-trip correctly.

### 055.3 — `host.player` participant + cutover

- Move the player-position + currentRegionId capture into a `SaveParticipantImpl` owned by `runtimeHost.ts`.
- Register it via the new registry.
- After this story, `getCurrentSavePayload()` writes slices for `host.player` only; legacy fields are still populated for back-compat.
- Tests: end-to-end save+load via the new path, verify player respawns at the saved XYZ in the saved region.

### 055.4 — `quest.manager` participant

- Add `SaveParticipant` to `QuestManager`. Slice carries `activeQuests` (`Map<questId, ActiveQuestRuntimeState>`), `completedQuestIds`, `runtimeFlags`, `trackedQuestDefinitionId`.
- Deserialize rebuilds the maps + sets, re-tracks the active quest.
- Schema version: 1. Versioning starts here; future quest schema changes bump.
- Tests: quest progress (mid-stage, partial objective completion) round-trips; completed quests history round-trips; legacy saves with only `currentQuestId` deserialize cleanly (just re-track that quest, no historical completion data).

### 055.5 — `inventory.player` participant

- Add `SaveParticipant` to inventory. Slice: `{ entries: Array<{ definitionId, count }> }`.
- Deserialize repopulates the inventory.
- Tests: collected items survive save+load; counts correct; entries with definitionIds no longer present in the project's content library are dropped with a console.warn.

### 055.6 — `world.presence` participant

- New module: `packages/runtime-core/src/world/presence-tracker.ts`. Tracks collected presence IDs per region. Subscribes to `onItemPresenceCollected` events from the gameplay assembly.
- Slice: `{ collectedByRegion: Record<regionId, string[]> }`.
- Deserialize: on region load, the tracker tells the scene-spawn step which presence IDs to skip.
- Tests: items collected in region A stay collected after save+load+enter region A again; items collected in region A reset to collected after a `resetForNewGame` (because the new save has no collected list).

### 055.7 — Retire legacy fields + verify in prod

- Once all writers produce slice-based payloads, mark the legacy `currentRegionId` / `currentQuestId` / `playerPosition` fields as deprecated in `GameSavePayload`. Keep readable for now (old saves still load via `upgradeLegacyPayload`).
- End-to-end verify in prod: pick up a quest in wordlark, advance an objective, collect a couple items, autosave, hard-refresh, confirm everything restored.
- Memory rule update if a new constraint emerges (likely: "new persistable state goes through a SaveParticipant, not by extending GameSavePayload directly").
- A future story (055.8?) actually deletes the legacy fields once we're confident no live save still uses them.

## Open questions

- **Serialize sync vs async.** Cheap = sync. But what if a participant needs to await something (e.g., flushing an in-memory write buffer first)? Lean sync only for v1; if a participant genuinely needs async, handle in 055.x.
- **Cross-region item presence handling.** Are world-presence collected items tracked per-region or globally? Per-region is simpler (a presenceId is unique within a region, not globally). Lean per-region.
- **Schema-bump migrations across slices.** If `quest.manager` bumps from v1 to v2, who writes the v1->v2 upgrader? The participant itself (it's the only one who knows its slice shape). Versioned `migrateFromV1ToV2(slice)` inside the participant, called from `deserialize` when the loaded slice's schemaVersion is lower than the current.
- **Save participant ordering hazards.** `host.player` and the world-presence tracker both inform spawn. World presence has to be deserialized BEFORE the region scene loads (so the scene knows which presences to skip). Worth being explicit about tier ordering in 055.1's host orchestration: "host-owned" tier first, then "region-aware" tier, then everything else.
- **`world.presence` scope when Season/Episode ships (Plan 056).** Current slice is `Record<regionId, string[]>` — episode-agnostic. If a later episode needs to un-collect a presence in a shared region to re-story it, that has to be handled at authoring time or via a runtime override rule. If that pattern gets common we bump `world.presence` schemaVersion to `Record<regionId, Record<episodeId, string[]>>` and migrate. Not blocking 055; revisit when 056 defines the episode content-load contract.

## Defers

- Per-plugin per-user state participants (sugarlang, sugaragent) — separate path per ADR 020.
- Multi-save-slots.
- Server-authoritative validation / anti-cheat.
- Mid-save delta optimization.
- A "save now" UI affordance (autosave is enough for v1).
