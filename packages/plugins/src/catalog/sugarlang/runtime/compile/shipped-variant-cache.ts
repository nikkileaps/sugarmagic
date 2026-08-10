/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/shipped-variant-cache.ts
 *
 * Purpose: The graded line variants a DEPLOYED game plays from.
 *
 * WHY IT EXISTS
 *   Both places that reach for variants asked Studio's workspace database for
 *   them, and a deployed origin has no such database -- so every scripted line
 *   and every item description rendered the authored text at every band, with
 *   the graded version sitting unread in a file the game had already
 *   downloaded. That is the most visible way for a game that teaches to not
 *   teach.
 *
 *   `MemoryVariantCache` already implements the interface both callers want,
 *   so nothing new is written here: it is filled from the shipped file once and
 *   handed to them.
 *
 * SIZED EXPLICITLY, NOT BY DEFAULT -- AND THAT IS A WORKAROUND
 *   The memory cache defaults to 400 entries and drops the least recently used
 *   without saying so. A hundred authored lines across six bands is six
 *   hundred, and silent eviction there would mean a line rendering graded text
 *   one moment and authored English the next, with nothing in the log. So the
 *   ceiling is taken from the shipped set rather than left at a default.
 *
 *   THE CEILING EXISTS BECAUSE THE FILE IS NOT SCOPED. One file carries every
 *   graded line for every episode and is loaded whole, so its size tracks the
 *   whole game rather than what the player is doing. Scoping it per episode
 *   removes the need to pick a number: load the episode, and the episode IS
 *   the ceiling. Tracked with the same problem in the boot payload --
 *   `sugarmagic-boot-scoping-j24`, which names the scene as the unit for both
 *   and says to do them together rather than give two files two answers.
 *
 *   REVISIT WHEN this ceiling has to be raised, or when a line renders
 *   authored English in a game where the graded text exists. Either means the
 *   number stopped being big enough and nothing said so.
 *
 * ONE SET PER GAME, NOT PER CONVERSATION
 *   The file does not change while the game runs and both callers want the same
 *   entries, so it is loaded once and shared. Loading per conversation would
 *   re-fetch and re-parse the whole set on every NPC.
 *
 * Exports:
 *   - seedShippedVariantCache
 *   - getShippedVariantCache
 *   - resetShippedVariantCacheForTests
 *
 * Implements: Plan 092 story 092.4
 *
 * Status: active
 */

import { MemoryVariantCache, type SugarlangVariantCache } from "./variant-cache";
import { loadVariantsFromArtifact } from "./artifact-loader";

/**
 * Headroom over the shipped count. A shipped set is fixed, so this only has to
 * cover the entries themselves -- the margin is there so a set that grows
 * between a bake and a deploy cannot start evicting.
 */
const HEADROOM_ENTRIES = 200;

/** Generous: the whole point is that nothing is dropped. wordlark's set is
 *  ~100KB today, and this bounds a pathological file rather than a real one. */
const MAX_BYTES = 64 * 1024 * 1024;

let shipped: SugarlangVariantCache | null = null;

/**
 * Loads the shipped variants into a cache the runtime can serve from.
 *
 * Called once at plugin init in a deployed game. Returns the number of entries
 * so the caller can log it -- zero is a legal state and has to be visible
 * rather than inferred, because zero is exactly what the broken version looked
 * like.
 */
export async function seedShippedVariantCache(
  assetSources: Record<string, string> | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<number> {
  const entries = await loadVariantsFromArtifact(assetSources, fetchImpl);
  const cache = new MemoryVariantCache({
    maxEntries: entries.length + HEADROOM_ENTRIES,
    maxBytes: MAX_BYTES
  });
  for (const entry of entries) {
    await cache.set(entry);
  }
  shipped = cache;
  return entries.length;
}

/**
 * The shipped variants, or undefined when this game shipped none (or is not a
 * deployed game at all).
 *
 * Undefined rather than an empty cache, so a caller can tell "no variants
 * shipped" from "shipped and none matched" -- the two look identical at a
 * lookup and only one of them is worth reporting.
 */
export function getShippedVariantCache(): SugarlangVariantCache | undefined {
  return shipped ?? undefined;
}

export function resetShippedVariantCacheForTests(): void {
  shipped = null;
}
