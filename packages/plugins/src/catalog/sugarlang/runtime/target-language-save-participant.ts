/**
 * packages/plugins/src/catalog/sugarlang/runtime/target-language-save-participant.ts
 *
 * The one language a game is being played in, kept in that game's save.
 *
 * Sugarlang owns this end to end. The host knows only that this plugin keeps
 * something in the save and restores it at boot; what a target language is,
 * and that the answer to a pre-new-game step is one, live here.
 *
 * ## Chosen once, then locked
 *
 * A game is played in one language. Graded text, chunk inventories, teacher
 * state and the learner profile are all keyed by it, so moving it mid-game
 * would orphan everything already taught. What is in the save therefore wins
 * over the project's authored default: an author changing that default cannot
 * move a game already under way.
 *
 * The three ways a game gets its language, in precedence order:
 *
 *   - the answer to sugarlang's pre-new-game step, on a boot that followed a
 *     New Game press
 *   - the language stored in this slice, on any other boot
 *   - the project's configured default, written in once for a save that
 *     predates this slice -- which locks that game the same way a pick does
 *
 * ## Why a module-level holder
 *
 * The participant deserializes at boot, before the plugin's runtime binds, and
 * the runtime holds no reference to the host. Reading through a module holder
 * at operation time is the shape `getActivePlaythroughId` and the access-token
 * registry both use.
 */

import type { SaveParticipant, SaveSlice } from "@sugarmagic/runtime-core";

export const SUGARLANG_TARGET_LANGUAGE_PARTICIPANT_ID =
  "sugarlang.targetLanguage";
export const SUGARLANG_TARGET_LANGUAGE_SLICE_SCHEMA_VERSION = 1;

export interface SugarlangTargetLanguageSlice {
  /** Language tag, lowercased ("es", "it"). Null before one is settled. */
  targetLanguage: string | null;
}

let activeTargetLanguage: string | null = null;

/** This game's target language. Null before boot has settled one. */
export function getSugarlangTargetLanguage(): string | null {
  return activeTargetLanguage;
}

/**
 * Settle this game's target language.
 *
 * Ignores an empty or non-string value rather than clearing a settled
 * language: the callers are a boot handshake and this plugin's own configured
 * default, and neither has any business unsetting one.
 */
export function setSugarlangTargetLanguage(value: unknown): void {
  const normalized = normalizeLanguage(value);
  if (!normalized) return;
  activeTargetLanguage = normalized;
}

/**
 * Test-only reset of the module holder. Production never clears the language
 * mid-session (a page reload constructs a fresh module).
 */
export function resetSugarlangTargetLanguageForTests(): void {
  activeTargetLanguage = null;
}

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `host-owned` tier: the runtime reads this language when it binds, and
 * binding happens after the first deserialize pass and before the default
 * tier. A later tier would hand the runtime a null on the boot that matters.
 */
export function createSugarlangTargetLanguageSaveParticipant(): SaveParticipant<SugarlangTargetLanguageSlice> {
  return {
    participantId: SUGARLANG_TARGET_LANGUAGE_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: SUGARLANG_TARGET_LANGUAGE_SLICE_SCHEMA_VERSION,
    serialize(): SugarlangTargetLanguageSlice {
      return { targetLanguage: activeTargetLanguage };
    },
    deserialize(slice: SaveSlice<SugarlangTargetLanguageSlice> | null): void {
      // An absent or unusable stored language leaves the holder alone. Nothing
      // has settled one this early on an ordinary boot, and on a New Game boot
      // the save row is gone, so there is nothing here to restore -- the pick
      // arrives later, at bind, from the step answers.
      const stored = normalizeLanguage(slice?.data?.targetLanguage);
      if (stored) activeTargetLanguage = stored;
    }
  };
}
