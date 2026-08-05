/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/card-display-name.ts
 *
 * Purpose: Turns a card key into something a human can read.
 *
 * Cards live in two key spaces: a lemma is its own word, and a competency is
 * stored as `exponent:<exponentId>`. The second one is unreadable --
 * `exponent:que_tal` says nothing about greeting anyone -- so anywhere a card
 * is shown to a person, it goes through here.
 *
 * Exports:
 *   - EXPONENT_CARD_PREFIX
 *   - isChunkCardKey
 *   - competencyIdForCardKey
 *   - cardDisplayName
 *
 * Relationships:
 *   - Resolves through getCompetencyForExponent, which returns undefined when the
 *     language has no inventory.
 *
 * Status: active
 */

import { getCompetencyForExponent } from "./competency-inventory-loader";

export const EXPONENT_CARD_PREFIX = "exponent:";

/** True when a card key belongs to a competency rather than a word. */
export function isChunkCardKey(cardKey: string): boolean {
  return cardKey.startsWith(EXPONENT_CARD_PREFIX);
}

/**
 * The competency a card key belongs to, or null if it is a word.
 *
 * THE JOIN THE TWO KEY SPACES NEED. A card is keyed by its EXPONENT and the
 * slate names the COMPETENCY, and those ids never coincide -- `greet` is a
 * competency, `hola` is one of the exponents that performs it. So a card key
 * can never be compared against a competency id directly; it has to be
 * resolved first.
 *
 * Getting this wrong is silent, which is why it lives in one place: building
 * `exponent:<competencyId>` produces a well-formed string that simply never
 * matches any card, so every comparison just quietly returns false.
 *
 * Null for an unresolvable exponent as well as for a word -- an inventory edit
 * can remove one, and a language may have no inventory at all.
 */
export function competencyIdForCardKey(
  cardKey: string,
  lang: string
): string | null {
  if (!isChunkCardKey(cardKey)) return null;
  const competency = getCompetencyForExponent(
    cardKey.slice(EXPONENT_CARD_PREFIX.length),
    lang
  );
  return competency?.competencyId ?? null;
}

/**
 * A readable name for a card key.
 *
 * A lemma is already readable and comes back unchanged. A competency resolves
 * to its display name AND the exponent the card is actually for -- "Greet:
 * hola", not "Greet".
 *
 * The exponent is not decoration. A competency has one card per chunk, and
 * `greet` alone ships six, so naming a card after its competency renders six
 * different cards identically. That was the first thing the debug HUD showed:
 * two rows both reading "Greet (competency)" with different retrievability,
 * which is the same unreadability as the raw key wearing better clothes.
 *
 * Falls back to the raw key when the chunk cannot be resolved -- an unknown
 * chunk is a real state (an inventory edit that removed it, a language with no
 * inventory) and the key is what you would grep for.
 */
export function cardDisplayName(cardKey: string, lang: string): string {
  if (!isChunkCardKey(cardKey)) return cardKey;
  const exponentId = cardKey.slice(EXPONENT_CARD_PREFIX.length);
  const competency = getCompetencyForExponent(exponentId, lang);
  if (!competency) return cardKey;

  // Prefer the surface a speaker would say over the normalized id: `buenos
  // dias` reads, `buenos_dias` is a key with a costume on.
  const exponent = (competency.exponents[lang] ?? []).find(
    (candidate) => candidate.exponentId === exponentId
  );
  const surface = exponent?.surfaceForms[0] ?? exponentId;
  return `${competency.displayName}: ${surface}`;
}
