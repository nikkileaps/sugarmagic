/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/english-collisions.ts
 *
 * Purpose: English spellings that also resolve in the target language's
 *   morphology index, so the instrument stops counting English prose as
 *   target-language evidence.
 *
 * WHY THIS EXISTS
 *   Mixed-posture lines are mostly English by design, and the coverage counter
 *   lemmatizes every token against Spanish morphology. Ordinary English words
 *   are Spanish homograph surfaces -- "too" is a form of `toar`, "he" of
 *   `haber`, "dice" of `decir` -- so English prose produced phantom
 *   out-of-envelope violations and inflated the measured language ratio. On
 *   real turns the resulting repair fired ~100% of the time, essentially
 *   always for a wrong reason (sugarmagic-latency-cex).
 *
 * HOW IT IS APPLIED (coverage.ts)
 *   A token whose lowercase surface is on this list counts as target-language
 *   ONLY when it sits inside a recognized target-language span -- an exponent
 *   surface or scene chunk (matched before the token loop, so those tokens
 *   never reach the guard) or a slated word's form (passed in as
 *   recognized surfaces). Alone in an English frame, it is treated as
 *   unresolved. This deliberately UNDER-counts a bare Spanish "No" -- ratio-
 *   only noise, biased in the safe direction; these words are A1 and can never
 *   be violations.
 *
 * MEMBERSHIP IS MEASURED, NOT GUESSED. Every entry was named by a real
 *   phantom violation (spike + baseline captures). A test pins the exact
 *   membership so growth is a reviewed diff; the list must never absorb
 *   content words.
 *
 * Exports:
 *   - englishCollisionSurfaces
 *
 * Status: active
 */

import esCollisions from "../../data/languages/es/english-collisions.json";

const BY_LANG: Partial<Record<string, Set<string>>> = {
  es: new Set((esCollisions as { surfaces: string[] }).surfaces)
};

/** The collision set for a language, or an empty set (nothing suppressed). */
export function englishCollisionSurfaces(lang: string): Set<string> {
  return BY_LANG[lang] ?? new Set();
}
