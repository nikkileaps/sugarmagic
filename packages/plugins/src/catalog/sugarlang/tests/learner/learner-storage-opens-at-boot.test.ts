/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/learner-storage-opens-at-boot.test.ts
 *
 * Purpose: The learner's storage exists before the boot sync pass runs
 *   (Plan 092.6.3).
 *
 * THE BUG THIS LOCKS OUT
 *   These stores used to be opened on the first conversation turn, because
 *   that is where the code that needed them happened to run. The boot screen
 *   waits for a sync pass, but that pass found nothing registered and
 *   reconciled nothing -- so on a second device the learner's level and word
 *   history were read from an empty store minutes later, the player was put
 *   through placement again, and the empty profile that produced was pushed
 *   over their real one.
 *
 *   The fix is an ordering, and an ordering is invisible in a diff: opening
 *   storage moved to `openAccountStorage`, which the host calls after the
 *   account resolves and before the sync loop starts. What these tests pin is
 *   that it needs NOTHING ELSE -- no world, no region, no player definition --
 *   because the moment it does, it goes back to running too late.
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSyncedRecordStores,
  registerActiveGameId,
  registerActiveIdentityProvider,
  unregisterSyncedRecordStore
} from "@sugarmagic/runtime-core";
import { SugarlangRuntimeServices } from "../../runtime/runtime-services";
import {
  normalizeSugarLangPluginConfig,
  type SugarLangPluginConfig
} from "../../config";

const USER = "user-alice";

function signedIn(userId: string | null) {
  registerActiveIdentityProvider(
    userId
      ? ({
          currentUser: () => ({ userId, isAnonymous: false }),
          onChange: () => () => {}
        } as never)
      : null
  );
}

function services(config?: Partial<SugarLangPluginConfig>) {
  return new SugarlangRuntimeServices({
    config: {
      ...normalizeSugarLangPluginConfig({}),
      targetLanguage: "it",
      ...config
    } as SugarLangPluginConfig,
    logger: { warn: () => {}, info: () => {}, debug: () => {} } as never
  });
}

function sugarlangStoreIds(): string[] {
  return listSyncedRecordStores()
    .filter((handle) => handle.storeKey.pluginId === "sugarlang")
    .map((handle) => handle.storeKey.storeId)
    .sort();
}

beforeEach(() => {
  registerActiveGameId("test-game");
  signedIn(USER);
});

afterEach(() => {
  for (const handle of listSyncedRecordStores()) {
    unregisterSyncedRecordStore(handle.storeKey);
  }
  signedIn(null);
});

describe("092.6.3 - the learner's storage is open before the boot sync pass", () => {
  it("THE ONE THAT MATTERS: opens with no world bound", async () => {
    // `bindRuntime` is never called. If opening storage ever starts needing a
    // blackboard, a region or a player definition, it cannot run at boot any
    // more -- there is no world yet -- and it silently slides back to the
    // first conversation turn, which is the bug.
    const runtime = services();
    await runtime.openAccountStorage();

    expect(sugarlangStoreIds()).toEqual(["cards:it:en", "profile:it:en"]);
  });

  it("registers the stores with the sync loop, so a pass can reconcile them", async () => {
    const runtime = services();
    await runtime.openAccountStorage();

    const keys = listSyncedRecordStores()
      .filter((handle) => handle.storeKey.pluginId === "sugarlang")
      .map((handle) => handle.storeKey.userId);
    expect(keys).toEqual([USER, USER]);
  });

  it("opens nothing when no account has resolved, rather than under a null one", async () => {
    // Storage opened without an account is shared by everyone using the
    // browser, and nothing written into it can be attributed afterwards.
    signedIn(null);
    const runtime = services();
    await runtime.openAccountStorage();

    expect(sugarlangStoreIds()).toEqual([]);
  });

  it("opens nothing when no language is configured", async () => {
    const runtime = services({ targetLanguage: "" });
    await runtime.openAccountStorage();

    expect(sugarlangStoreIds()).toEqual([]);
  });

  it("opening twice reuses the same stores rather than opening a second set", async () => {
    // A second set would register a second handle under the same key and a
    // second connection to the same database -- two caches of the same rows,
    // and a pending flag cleared in one invisible to the other.
    const runtime = services();
    await runtime.openAccountStorage();
    await runtime.openAccountStorage();

    expect(sugarlangStoreIds()).toEqual(["cards:it:en", "profile:it:en"]);
  });
});
