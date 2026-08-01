/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/teach-record-store.test.ts
 *
 * Purpose: Unit tests for MemoryTeachRecordStore and the teach-record DB prefix naming contract.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Tests runtime/learner/teach-record-store.ts (MemoryTeachRecordStore) and the
 *     TEACH_RECORD_DB_NAME_PREFIX prefix convention that keeps teach-records under the
 *     reset-enforcer's auto-delete guard.
 *
 * Implements: Plan 085 story 085.5
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  MemoryTeachRecordStore,
  TEACH_RECORD_DB_NAME_PREFIX
} from "../../runtime/learner/teach-record-store";
import { CARD_STORE_DB_NAME_PREFIX } from "../../runtime/learner/card-store";

describe("MemoryTeachRecordStore", () => {
  it("has returns false initially", async () => {
    const store = new MemoryTeachRecordStore();
    expect(await store.has("fn-greeting")).toBe(false);
  });

  it("write persists a record and has returns true afterward", async () => {
    const store = new MemoryTeachRecordStore();
    await store.write({
      competencyId: "fn-greeting",
      taughtAtMs: 1000,
      realizingChunkId: "buenos-dias"
    });
    expect(await store.has("fn-greeting")).toBe(true);
  });

  it("list returns empty array when no records written", async () => {
    const store = new MemoryTeachRecordStore();
    expect(await store.list()).toEqual([]);
  });

  it("list returns all records sorted by competencyId", async () => {
    const store = new MemoryTeachRecordStore();
    await store.write({ competencyId: "fn-farewell", taughtAtMs: 2000, realizingChunkId: "adios" });
    await store.write({ competencyId: "fn-greeting", taughtAtMs: 1000, realizingChunkId: "hola" });
    const records = await store.list();
    expect(records).toHaveLength(2);
    expect(records[0]!.competencyId).toBe("fn-farewell");
    expect(records[1]!.competencyId).toBe("fn-greeting");
  });

  it("write is idempotent: second write for same competencyId is a no-op", async () => {
    const store = new MemoryTeachRecordStore();
    await store.write({
      competencyId: "fn-greeting",
      taughtAtMs: 1000,
      realizingChunkId: "hola"
    });
    await store.write({
      competencyId: "fn-greeting",
      taughtAtMs: 9999,
      realizingChunkId: "buenos-dias"
    });
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.taughtAtMs).toBe(1000);
    expect(records[0]!.realizingChunkId).toBe("hola");
  });

  it("has is independent per competencyId", async () => {
    const store = new MemoryTeachRecordStore();
    await store.write({ competencyId: "fn-greeting", taughtAtMs: 1, realizingChunkId: "hola" });
    expect(await store.has("fn-greeting")).toBe(true);
    expect(await store.has("fn-farewell")).toBe(false);
  });
});

describe("TEACH_RECORD_DB_NAME_PREFIX naming contract", () => {
  it("starts with CARD_STORE_DB_NAME_PREFIX so the reset enforcer auto-covers it", () => {
    // The reset enforcer deletes any IDB whose name starts with CARD_STORE_DB_NAME_PREFIX.
    // Teach-record DBs carry the same prefix, so no explicit filter change is needed.
    expect(TEACH_RECORD_DB_NAME_PREFIX.startsWith(CARD_STORE_DB_NAME_PREFIX)).toBe(true);
  });
});
