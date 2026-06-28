/**
 * packages/domain/src/save/index.ts
 *
 * Purpose: Cross-plugin game-save payload shape. Lives in domain
 * because `GameProject` references it via the
 * `defaultGameSavePayload` field (Plan 047 §47.10.5) — the project-
 * authored starting state a brand-new player gets when no save
 * exists yet. Runtime-core re-exports the type from here so every
 * downstream consumer (target-web, testing) keeps importing from
 * `@sugarmagic/runtime-core` unchanged.
 *
 * Implements: Plan 047 §Story 47.1 (type), §Story 47.10.5
 * (defaultGameSavePayload field)
 *
 * Status: active
 */

/**
 * The cross-plugin player record. Owned by domain because both
 * project authoring (`defaultGameSavePayload`) and runtime save
 * stores read/write this shape. Plugin-domain per-user state
 * never lives here; see ADR 020 for the boundary rationale.
 *
 * Every field is nullable on purpose: a brand-new save (player
 * has not yet entered any region, accepted any quest, or moved
 * from their spawn) carries `null` everywhere and the runtime
 * hydrates defaults from `boot.json` or
 * `GameProject.defaultGameSavePayload`. A non-null value here
 * always supersedes the authored default.
 */
export interface GameSavePayload {
  /** The region the player was in at the most recent save tick. */
  currentRegionId: string | null;
  /** The quest the player has accepted but not yet completed.
   *  `null` when no quest is active. */
  currentQuestId: string | null;
  /** Player avatar position at the most recent save tick, in
   *  world coordinates. `null` for fresh saves where the runtime
   *  should fall back to the region's spawn point. */
  playerPosition: { x: number; y: number; z: number } | null;
}

/**
 * Story 47.10.5 — pick the live spawn payload from the available
 * sources. The save's payload wins when present (a returning
 * player resumes); otherwise the project's authored default
 * (`GameProject.defaultGameSavePayload`) wins; otherwise the
 * implicit boot.json / playerPresence defaults win.
 *
 * Returned `null` means "no save and no authored default" — the
 * caller falls through to the implicit composition.
 *
 * Pure helper so tests can pin the resolution order without
 * standing up a runtime host.
 */
export function pickGameSavePayload(
  savePayload: GameSavePayload | null,
  defaultPayload: GameSavePayload | null
): GameSavePayload | null {
  return savePayload ?? defaultPayload ?? null;
}
