/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/card-display-name.ts
 *
 * Purpose: Turns a card key into something a human can read.
 *
 * Cards live in two key spaces: a lemma is its own word, and a competency is
 * stored as `chunk:<chunkId>`. The second one is unreadable -- `chunk:que_tal`
 * says nothing about greeting anyone -- and that unreadability is the stated
 * reason competency cards were kept out of the Teacher prompt in the first
 * place. Anywhere a card is shown, it goes through here.
 *
 * Exports:
 *   - CHUNK_CARD_PREFIX
 *   - isChunkCardKey
 *   - cardDisplayName
 *
 * Relationships:
 *   - Resolves through getCompetencyForChunk, which returns undefined when the
 *     language has no inventory.
 *
 * Status: active
 */

import { getCompetencyForChunk } from "./competency-inventory-loader";

export const CHUNK_CARD_PREFIX = "chunk:";

/** True when a card key belongs to a competency rather than a word. */
export function isChunkCardKey(cardKey: string): boolean {
  return cardKey.startsWith(CHUNK_CARD_PREFIX);
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
  const chunkId = cardKey.slice(CHUNK_CARD_PREFIX.length);
  const competency = getCompetencyForChunk(chunkId, lang);
  if (!competency) return cardKey;

  // Prefer the surface a speaker would say over the normalized id: `buenos
  // dias` reads, `buenos_dias` is a key with a costume on.
  const chunk = (competency.chunks[lang] ?? []).find(
    (candidate) => candidate.chunkId === chunkId
  );
  const exponent = chunk?.surfaceForms[0] ?? chunkId;
  return `${competency.displayName}: ${exponent}`;
}
