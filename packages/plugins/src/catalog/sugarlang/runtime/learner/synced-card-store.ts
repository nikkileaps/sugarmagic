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
 *   - createSyncedCardStore
 *   - SUGARLANG_CARD_STORE_SCHEMA_VERSION
 *
 * Implements: Plan 092 story 092.6.4
 *
 * Status: active
 */

import {
  createSyncedRecordStore,
  type SyncedRecordStore
} from "@sugarmagic/runtime-core";
import type { LemmaCard } from "../types";
import type { CardStore, CardStorePage } from "./card-store";
import { SUGARLANG_PLUGIN_ID } from "../../plugin-id";
import { SUGARLANG_WORD_TABLE } from "./account-tables";

/** Bumped when a stored word record changes shape. */
export const SUGARLANG_CARD_STORE_SCHEMA_VERSION = 1;

const DEFAULT_PAGE_SIZE = 250;

export interface CreateSyncedCardStoreOptions {
  targetLanguage: string;
  supportLanguage: string;
  /** Test seam: use this store instead of constructing one. */
  store?: SyncedRecordStore<LemmaCard>;
  /** Test seam: the account, when there is no signed-in one to read. */
  userId?: string;
}

export function createSyncedCardStore(
  options: CreateSyncedCardStoreOptions
): CardStore {
  const store =
    options.store ??
    createSyncedRecordStore<LemmaCard>({
      pluginId: SUGARLANG_PLUGIN_ID,
      storeId: `cards:${options.targetLanguage}:${options.supportLanguage}`,
      schemaVersion: SUGARLANG_CARD_STORE_SCHEMA_VERSION,
      userId: options.userId,
      table: SUGARLANG_WORD_TABLE
    });

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
