/**
 * packages/runtime-core/src/save/index.ts
 *
 * Purpose: Public contract for "the current user's cross-plugin
 * game progress." A `GameSaveStore` holds one `GameSave` per user,
 * carrying the player's region, position, and quest state — the
 * stuff that crosses every plugin's domain and answers "where am I
 * in the game?"
 *
 * Sugarmagic ships a default `IndexedDBGameSaveStore` (in
 * `./indexeddb-store`) so a bare game without any plugins persists
 * locally. The SugarProfile plugin (Plan 047) contributes a
 * `SupabaseGameSaveStore` that overrides the default with a Postgres-
 * backed remote store keyed by the same `userId` the active
 * `UserIdentityProvider` hands out.
 *
 * Boundary: this contract holds CROSS-PLUGIN game progress only.
 * Per-plugin per-user state (sugarlang learner blackboard,
 * sugaragent conversation memory) does NOT live here. Each plugin
 * with its own domain data owns its own store, keyed on `userId`
 * from `UserIdentityProvider`. See Plan 047 §"What is NOT in scope"
 * and ADR 020 for the boundary rationale.
 *
 * Implements: Plan 047 §Story 47.1
 *
 * Status: active
 */

// Story 47.10.5 — `GameSavePayload` moved to `@sugarmagic/domain`
// because `GameProject.defaultGameSavePayload` references it.
// Re-exported here so every existing import path
// (`@sugarmagic/runtime-core`) keeps working transparently.
import { type GameSavePayload, pickGameSavePayload } from "@sugarmagic/domain";
export { type GameSavePayload, pickGameSavePayload };

/**
 * Schema compatibility token for `GameSave` writes. Stamped into
 * every write by the active store; read back on load so a future
 * payload-shape change can route through a migration. Bumping this
 * is a deliberate event (every shipped store reads the field, every
 * plugin contributing a custom store reads the field).
 *
 * Story 47.1 ships at version 1.
 */
export const GAME_SAVE_SCHEMA_VERSION = 1;

/**
 * The persisted save record. `userId` is the key the store uses to
 * address this record; `payload` is the cross-plugin player state;
 * `schemaVersion` is what's compared against
 * `GAME_SAVE_SCHEMA_VERSION` at load time to decide whether a
 * migration is needed.
 */
export interface GameSave {
  /** Same value the active `UserIdentityProvider.currentUser()`
   *  returns. */
  userId: string;
  /** ISO timestamp when this save was last written. Stores set this
   *  at write time; callers don't need to. */
  lastPlayed: string;
  /** Pinned to `GAME_SAVE_SCHEMA_VERSION` on write; read back to
   *  decide if a migration is needed at load time. */
  schemaVersion: number;
  /**
   * Build version of the engine that wrote this save (e.g.
   * `v0.1.0`, `v0.1.0-3-gabc1234`, or just a sha for untagged
   * commits). Optional because pre-this-field saves don't carry
   * it; null means "unknown / pre-stamping era". Future
   * migrations can branch on this to know which schema the
   * payload was authored under.
   */
  writtenByVersion?: string | null;
  /** Cross-plugin player state. */
  payload: GameSavePayload;
}

/**
 * Runtime contract for persisting cross-plugin game progress.
 *
 * Implementation contract:
 *   - `load(userId)` returns `null` when the user has no save yet
 *     (first-time player). Returns a `GameSave` otherwise.
 *   - `save(userId, save)` performs an upsert: writing replaces any
 *     prior record. Stores stamp `lastPlayed` and `schemaVersion`
 *     at write time; callers pass `payload`. The store MUST assert
 *     `save.userId === userId` and reject the write if they
 *     disagree (defense-in-depth on top of RLS for remote stores).
 *   - `clear(userId)` deletes the record. Subsequent `load` returns
 *     `null`. Used when transferring a local save to a remote store
 *     after sign-in (see Plan 047 §47.10), and as a developer
 *     escape hatch.
 *   - All operations are async to accommodate IndexedDB (which is
 *     async even though it's local) and remote stores uniformly.
 */
export interface GameSaveStore {
  load(userId: string): Promise<GameSave | null>;
  save(userId: string, save: GameSave): Promise<void>;
  clear(userId: string): Promise<void>;
}

export {
  createIndexedDBGameSaveStore,
  type IndexedDBGameSaveStoreOptions
} from "./indexeddb-store";

export {
  createSerializedSaveStore,
  type SerializedSaveStore
} from "./serialized-store";

/**
 * Story 47.5 — picks the region id the runtime should spawn into.
 * The save's `currentRegionId` wins when a non-null save is present
 * AND it carries a non-null region id; otherwise the authored
 * default from `boot.json` (i.e. the project's published-web
 * snapshot) is used. Returns the same nullish surface the authored
 * default has so callers can pass the result straight to the
 * existing region-lookup path.
 *
 * Used by `targets/web/src/runtimeHost.ts` during `start` to choose
 * between "resume where the player was" and "spawn at the authored
 * starting region."
 */
export function pickActiveRegionId(
  authoredRegionId: string | null | undefined,
  save: GameSave | null
): string | null | undefined {
  if (save && save.payload.currentRegionId) {
    return save.payload.currentRegionId;
  }
  return authoredRegionId;
}
