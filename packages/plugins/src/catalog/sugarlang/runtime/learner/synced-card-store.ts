/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/synced-card-store.ts
 *
 * Purpose: Keeps a learner's word history in per-account storage, so it
 *   follows them to another machine instead of living and dying in one
 *   browser.
 *
 * WHY AN ADAPTER RATHER THAN A REPLACEMENT
 *   `CardStore` is read from a dozen places and its shape is fine; what was
 *   wrong was where the rows lived. Implementing the same interface over the
 *   shared account store changes the destination and nothing else, so no
 *   caller learns that syncing exists. The in-memory implementation stays for
 *   tests and for a browser with no storage at all.
 *
 * WHAT SYNCING COSTS HERE
 *   Nothing on the hot path. Reads and writes go to the local copy and return;
 *   reconciliation runs on its own schedule elsewhere. A word record is a few
 *   hundred bytes and only the ones that changed are ever sent, so a learner
 *   who knows the entire dictionary still syncs a handful of rows a session.
 *
 * ONE STORE PER LANGUAGE PAIR
 *   Two languages are two vocabularies with colliding lemma ids, so the pair
 *   is part of the store id rather than of every key. The account is not --
 *   the store is already scoped to it.
 *
 * Exports:
 *   - asCardStore
 *   - SUGARLANG_CARD_STORE_SCHEMA_VERSION
 *
 * Implements: Plan 092 story 092.6.4
 *
 * Status: active
 */

import { type SyncedRecordStore } from "@sugarmagic/runtime-core";
import type { LemmaCard } from "../types";
import type { CardStore, CardStorePage } from "./card-store";

/** Bumped when a stored word record changes shape. */
export const SUGARLANG_CARD_STORE_SCHEMA_VERSION = 1;

const DEFAULT_PAGE_SIZE = 250;

/**
 * Presents a word store as a `CardStore`, and does nothing else.
 *
 * IT DOES NOT BUILD ONE. Deciding what to build and when belongs to
 * `initLearnerWords`; this only translates between two shapes. Fused together,
 * the pair needed a `store?` parameter so a test could skip the half it did
 * not want, which is the usual sign that one function was doing two jobs.
 */
export function asCardStore(store: SyncedRecordStore<LemmaCard>): CardStore {
  return {
    async get(lemmaId) {
      return store.get(lemmaId);
    },

    async set(card) {
      await store.put(card.lemmaId, card);
    },

    async bulkGet(lemmaIds) {
      const found = new Map<string, LemmaCard>();
      for (const lemmaId of lemmaIds) {
        const card = await store.get(lemmaId);
        if (card) found.set(lemmaId, card);
      }
      return found;
    },

    async bulkSet(cards) {
      await store.putMany(cards.map((card) => ({ key: card.lemmaId, data: card })));
    },

    async list() {
      return (await store.list()).map((record) => record.data);
    },

    async listPage(cursor, limit = DEFAULT_PAGE_SIZE): Promise<CardStorePage> {
      const page = await store.listPage(cursor ?? null, limit);
      return {
        cards: page.records.map((record) => record.data),
        nextCursor: page.nextCursor
      };
    },

    async count() {
      return store.count();
    },

    async clear() {
      await store.clear();
    },

    async close() {
      await store.close();
    }
  };
}
