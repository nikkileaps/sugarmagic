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
import { SugarlangMissingTargetLanguageError } from "../config";

export const SUGARLANG_TARGET_LANGUAGE_PARTICIPANT_ID =
  "sugarlang.targetLanguage";
export const SUGARLANG_TARGET_LANGUAGE_SLICE_SCHEMA_VERSION = 1;

export interface SugarlangTargetLanguageSlice {
  /**
   * Language tag, lowercased ("es", "it").
   *
   * Nullable on the way IN only: a save written before this slice existed has
   * nothing here, and `deserialize` treats that as "not settled" and leaves the
   * backfill to bind. Nothing ever writes null -- see `serialize`.
   */
  targetLanguage: string | null;
}

let activeTargetLanguage: string | null = null;

/**
 * This game's target language. Null before boot has settled one.
 *
 * Callers that cannot proceed without one should use
 * `requireSugarlangTargetLanguage` instead of substituting a default. An empty
 * string is NOT a safe stand-in: it reaches `toLocaleLowerCase(lang)` in
 * lemmatization and throws `RangeError: Incorrect locale information provided`.
 */
export function getSugarlangTargetLanguage(): string | null {
  return activeTargetLanguage;
}

/**
 * This game's target language, or a loud failure.
 *
 * THE ONE PLACE THAT DECIDES WHAT AN UNSETTLED LANGUAGE MEANS. Everything that
 * reads a word, lemmatizes, or plans a lesson needs a real language, and the
 * runtime is already past every layer allowed to be relaxed about it: Studio
 * tolerates a null language because a fresh project has none, and preview
 * refuses to launch. Reaching here without one means a built game shipped
 * misconfigured, which is the same condition the conversation middleware
 * throws on.
 *
 * Compile-time callers have a language in hand and no running game -- they take
 * it as an argument rather than calling this.
 */
export function requireSugarlangTargetLanguage(): string {
  if (!activeTargetLanguage) {
    throw new SugarlangMissingTargetLanguageError();
  }
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
      // NEVER WRITES A NON-LANGUAGE. A slice saying `null` is a lie in the
      // file: the next boot reads it, finds nothing usable, and quietly falls
      // back to the project's authored language -- so a player's choice
      // disappears with no error anywhere. If this plugin is running and has no
      // language, something is wrong upstream and it should be loud.
      //
      // Only reachable while sugarlang is enabled: the participant exists
      // because sugarlang declared it, so a game without the plugin has no
      // slice to write and nothing here to check.
      return { targetLanguage: requireSugarlangTargetLanguage() };
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
