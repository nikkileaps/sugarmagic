/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learner-stores.ts
 *
 * Purpose: Builds the two stores a learner's data lives in -- their words and
 *   their level -- and hands them to the sync loop.
 *
 * WHAT "BUILD" MEANS HERE, EXACTLY
 *   Each init function returns JavaScript objects and touches nothing else. No
 *   database is opened: the IndexedDB layer only computes a name and waits for
 *   a first read or write. No network call is made. So each one is a plain
 *   input-to-output function a test can call and assert on.
 *
 *   `initLearnerStores` is the one that has an effect on the world. It calls
 *   both, adds their handles to the list the sync loop reads, and combines the
 *   two first-sync promises into one. That split is deliberate: everything
 *   testable is in the two inits, and everything that touches shared state is
 *   in the one place above them.
 *
 * TWO STORES, NOT ONE, AND THEY FAIL SEPARATELY
 *   A player has thousands of words and one level. They are different shapes
 *   with different cardinality, they live in different tables, and one being
 *   unavailable says nothing about the other -- so each is built in its own
 *   try and degrades on its own. Wrapping both in one try meant a words
 *   failure silently took the level down with it.
 *
 * Exports:
 *   - initLearnerWords, initLearnerLevel, initLearnerStores
 *   - LearnerStores
 *
 * Implements: Plan 092 story 092.6.3 / 092.6.4
 *
 * Status: active
 */

import {
  createSyncedRecordStore,
  registerSyncedRecordStore,
  type SyncedRecordStoreParts
} from "@sugarmagic/runtime-core";
import { SUGARLANG_PLUGIN_ID } from "../../plugin-id";
import type { LemmaCard } from "../types";
import type { CardStore } from "./card-store";
import { MemoryCardStore } from "./card-store";
import { asCardStore, SUGARLANG_CARD_STORE_SCHEMA_VERSION } from "./synced-card-store";
import { SUGARLANG_LEARNER_TABLE, SUGARLANG_WORD_TABLE } from "./learner-tables";
import type { PersistedLearnerProfileCore } from "./persistence";

/** Bumped when the stored learner core changes shape. */
export const SUGARLANG_LEARNER_PROFILE_SCHEMA_VERSION = 1;

/**
 * Every word this learner has met, with the numbers that schedule it.
 *
 * One store per language pair: two languages are two vocabularies with
 * colliding lemma ids, so the pair is part of the store id rather than of
 * every key. The account is not -- the store is already scoped to it.
 */
export function initLearnerWords(
  userId: string,
  targetLanguage: string,
  supportLanguage: string
): SyncedRecordStoreParts<LemmaCard> {
  return createSyncedRecordStore<LemmaCard>({
    pluginId: SUGARLANG_PLUGIN_ID,
    storeId: `cards:${targetLanguage}:${supportLanguage}`,
    schemaVersion: SUGARLANG_CARD_STORE_SCHEMA_VERSION,
    userId,
    table: SUGARLANG_WORD_TABLE
  });
}

/**
 * This learner's level and placement record: one record, under one fixed key.
 *
 * Everything that is not a word. Before it had a store it lived only on the
 * blackboard, which is memory for the life of the tab, so a returning player
 * arrived with their whole vocabulary and no level attached to it.
 */
export function initLearnerLevel(
  userId: string,
  targetLanguage: string,
  supportLanguage: string
): SyncedRecordStoreParts<PersistedLearnerProfileCore> {
  return createSyncedRecordStore<PersistedLearnerProfileCore>({
    pluginId: SUGARLANG_PLUGIN_ID,
    storeId: `profile:${targetLanguage}:${supportLanguage}`,
    schemaVersion: SUGARLANG_LEARNER_PROFILE_SCHEMA_VERSION,
    userId,
    table: SUGARLANG_LEARNER_TABLE
  });
}

export interface LearnerStores {
  cardStore: CardStore;
  /** Absent when it could not be built; the level then stays on the
   *  blackboard for the session, as it did before it had a store. */
  profileCoreStore?: SyncedRecordStoreParts<PersistedLearnerProfileCore>["store"];
  /** Settles once both have had their first reconcile attempt. */
  whenFirstSynced: Promise<void>;
}

/**
 * Both of this learner's stores, added to the list the sync loop reads.
 *
 * THE ONLY THING HERE THAT TOUCHES SHARED STATE. Registering is what makes a
 * store visible to the sync loop, and the loop only reconciles what it can
 * see when it runs -- so a store registered after the first pass has missed
 * it, which is how a returning player's level was read from an empty store
 * and then pushed over the real one.
 *
 * The account is passed in rather than read from the signed-in session, so the
 * two functions below stay plain input-to-output and one place decides whose
 * data this is.
 */
export function initLearnerStores(
  userId: string,
  targetLanguage: string,
  supportLanguage: string
): LearnerStores {
  const label = `${userId}:${targetLanguage}:${supportLanguage}`;
  const waits: Array<Promise<void>> = [];

  let cardStore: CardStore = new MemoryCardStore();
  try {
    const words = initLearnerWords(userId, targetLanguage, supportLanguage);
    registerSyncedRecordStore(words.handle);
    cardStore = asCardStore(words.store);
    waits.push(words.store.whenFirstSynced());
  } catch (error) {
    console.warn(
      `[sugarlang] could not build word storage for ${label}; ` +
        "this session's words will not be saved.",
      error
    );
  }

  let profileCoreStore: LearnerStores["profileCoreStore"];
  try {
    const level = initLearnerLevel(userId, targetLanguage, supportLanguage);
    registerSyncedRecordStore(level.handle);
    profileCoreStore = level.store;
    waits.push(level.store.whenFirstSynced());
  } catch (error) {
    console.warn(
      `[sugarlang] could not build level storage for ${label}; ` +
        "this session's level will not be saved.",
      error
    );
  }

  return {
    cardStore,
    profileCoreStore,
    whenFirstSynced: Promise.all(waits).then(() => undefined)
  };
}
