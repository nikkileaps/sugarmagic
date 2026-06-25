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
 * The cross-plugin player record. Owned by runtime-core / Studio
 * core, not by individual plugins. Adding a field here is an
 * intentional core-level decision (analogous to adding to
 * `GameProject`); plugin-domain state never lives in this shape.
 *
 * Every field is nullable on purpose: a brand-new save (player
 * has not yet entered any region, accepted any quest, or moved
 * from their spawn) carries `null` everywhere and the runtime
 * hydrates defaults from `boot.json`. A non-null value here always
 * supersedes the authored default.
 */
export interface GameSavePayload {
  /** The region the player was in at the most recent save tick. */
  currentRegionId: string | null;
  /** The quest the player has accepted but not yet completed.
   *  `null` when no quest is active. */
  currentQuestId: string | null;
  /** Player avatar position at the most recent save tick, in world
   *  coordinates. `null` for fresh saves where the runtime should
   *  fall back to the region's spawn point. */
  playerPosition: { x: number; y: number; z: number } | null;
}

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
