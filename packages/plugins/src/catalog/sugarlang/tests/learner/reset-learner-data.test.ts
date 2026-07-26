/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/reset-learner-data.test.ts
 *
 * Purpose: Verifies the shared learner-data reset deletes sugarlang databases, releases live connections, and never reports a blocked delete as success.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/learner/reset-learner-data and ../../runtime/learner/card-store as the implementations under test.
 *   - Covers the Epic 081 learner-reset consolidation acceptance criteria.
 *
 * Implements: Epic 081 learner-reset consolidation
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CARD_STORE_DB_NAME_PREFIX,
  IndexedDBCardStore
} from "../../runtime/learner/card-store";
import { resetSugarlangLearnerDatabases } from "../../runtime/learner/reset-learner-data";
import { TELEMETRY_DB_NAME } from "../../runtime/telemetry/telemetry";
import { createLemmaCard } from "./test-helpers";

function openRawDatabase(
  factory: IDBFactory,
  name: string,
  options: { closeOnVersionChange?: boolean } = {}
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("probe")) {
        db.createObjectStore("probe");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (options.closeOnVersionChange) {
        db.onversionchange = () => db.close();
      }
      resolve(db);
    };
  });
}

async function listDatabaseNames(factory: IDBFactory): Promise<string[]> {
  const databases = await factory.databases();
  return databases
    .map((db) => db.name)
    .filter((name): name is string => typeof name === "string");
}

describe("resetSugarlangLearnerDatabases", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes card-store and telemetry databases but leaves others alone", async () => {
    const factory = new IDBFactory();
    const cardDbName = `${CARD_STORE_DB_NAME_PREFIX}:learner-a`;
    (await openRawDatabase(factory, cardDbName)).close();
    (await openRawDatabase(factory, TELEMETRY_DB_NAME)).close();
    (await openRawDatabase(factory, "unrelated-db")).close();

    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory
    });

    expect(result.ok).toBe(true);
    expect(result.deletedDatabases.sort()).toEqual([cardDbName, TELEMETRY_DB_NAME].sort());
    expect(result.blockedDatabases).toEqual([]);
    expect(result.failedDatabases).toEqual([]);
    expect(await listDatabaseNames(factory)).toEqual(["unrelated-db"]);
  });

  it("does not report success when a live connection blocks the delete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const factory = new IDBFactory();
    const cardDbName = `${CARD_STORE_DB_NAME_PREFIX}:learner-blocked`;
    // Simulate the pre-fix failure mode: an open connection with no
    // versionchange handler holds the database open forever.
    const blockingConnection = await openRawDatabase(factory, cardDbName);

    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory,
      blockedTimeoutMs: 50
    });

    expect(result.ok).toBe(false);
    expect(result.blockedDatabases).toEqual([cardDbName]);
    expect(result.deletedDatabases).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("blocked"));

    blockingConnection.close();
  });

  it("closes provided closeables so their databases can be deleted", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "learner-closeable",
      indexedDbFactory: factory
    });
    await store.set(createLemmaCard("casa"));

    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory,
      closeables: [store],
      blockedTimeoutMs: 200
    });

    expect(result.ok).toBe(true);
    expect(result.deletedDatabases).toEqual([
      `${CARD_STORE_DB_NAME_PREFIX}:learner-closeable`
    ]);
    // A closed store must re-open cleanly (against a now-fresh database).
    expect(await store.count()).toBe(0);
  });

  it("succeeds against a live card store via its versionchange handler", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "learner-versionchange",
      indexedDbFactory: factory
    });
    await store.set(createLemmaCard("perro"));

    // No closeables passed: the store's own onversionchange handler must
    // release the cached connection so the delete is not blocked.
    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory,
      blockedTimeoutMs: 200
    });

    expect(result.ok).toBe(true);
    expect(result.deletedDatabases).toEqual([
      `${CARD_STORE_DB_NAME_PREFIX}:learner-versionchange`
    ]);
    expect(await store.get("perro")).toBeUndefined();
  });

  it("returns ok with nothing deleted when IndexedDB is unavailable", async () => {
    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: null
    });

    expect(result.ok).toBe(true);
    expect(result.deletedDatabases).toEqual([]);
  });
});

describe("IndexedDBCardStore.close", () => {
  it("re-opens cleanly after an explicit close", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "learner-reopen",
      indexedDbFactory: factory
    });
    await store.set(createLemmaCard("gato"));

    await store.close();

    const card = await store.get("gato");
    expect(card?.lemmaId).toBe("gato");
  });

  it("is safe to call close before any operation and repeatedly", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "learner-idle-close",
      indexedDbFactory: factory
    });

    await store.close();
    await store.close();
    expect(await store.count()).toBe(0);
  });
});
