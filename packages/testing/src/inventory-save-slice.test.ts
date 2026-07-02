/**
 * packages/testing/src/inventory-save-slice.test.ts
 *
 * Purpose: Verifies the inventory.player save-participant
 * pipeline — InventoryManager serialize/deserialize round-trip
 * preserves entries + counts, unknown definitionIds drop with a
 * warn, participant factory forwards through the getter and
 * tolerates null.
 *
 * Implements: Plan 055 §055.5 tests
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultItemDefinition } from "@sugarmagic/domain";
import {
  InventoryManager,
  createInventoryPlayerSaveParticipant
} from "@sugarmagic/runtime-core";
import type {
  InventoryPlayerSlice,
  SaveSlice
} from "@sugarmagic/runtime-core";

function makeItem(id: string, name = id) {
  return createDefaultItemDefinition({ definitionId: id, displayName: name });
}

describe("InventoryManager save slice", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("round-trip", () => {
    it("preserves entries + counts through serialize/deserialize", () => {
      const source = new InventoryManager();
      source.registerDefinitions([
        makeItem("item:coin"),
        makeItem("item:key")
      ]);
      source.addItem("item:coin", 5);
      source.addItem("item:coin", 3);
      source.addItem("item:key", 1);

      const slice = source.serializeSaveSlice();

      const restored = new InventoryManager();
      restored.registerDefinitions([
        makeItem("item:coin"),
        makeItem("item:key")
      ]);
      restored.deserializeSaveSlice({ schemaVersion: 1, data: slice });

      expect(restored.getQuantity("item:coin")).toBe(8);
      expect(restored.getQuantity("item:key")).toBe(1);
      expect(restored.serializeSaveSlice().entries.sort(byDefinitionId)).toEqual(
        slice.entries.sort(byDefinitionId)
      );
    });

    it("returns an empty slice for an empty inventory", () => {
      const manager = new InventoryManager();
      expect(manager.serializeSaveSlice()).toEqual({ entries: [] });
    });
  });

  describe("unknown definitionId tolerance", () => {
    it("drops entries whose definitionId isn't in the catalog, with a warn", () => {
      const manager = new InventoryManager();
      manager.registerDefinitions([makeItem("item:coin")]);

      const slice: InventoryPlayerSlice = {
        entries: [
          { definitionId: "item:coin", count: 2 },
          { definitionId: "item:stale", count: 4 }
        ]
      };

      manager.deserializeSaveSlice({ schemaVersion: 1, data: slice });

      expect(manager.getQuantity("item:coin")).toBe(2);
      expect(manager.getQuantity("item:stale")).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
    });

    it("dropping zero / negative counts to keep the map clean", () => {
      const manager = new InventoryManager();
      manager.registerDefinitions([
        makeItem("item:coin"),
        makeItem("item:key")
      ]);

      manager.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          entries: [
            { definitionId: "item:coin", count: 3 },
            { definitionId: "item:key", count: 0 }
          ]
        }
      });

      expect(manager.getQuantity("item:coin")).toBe(3);
      expect(manager.getQuantity("item:key")).toBe(0);
      // A zero-count entry shouldn't get rehydrated as a phantom key
      expect(
        manager
          .serializeSaveSlice()
          .entries.find((e) => e.definitionId === "item:key")
      ).toBeUndefined();
    });
  });

  describe("null / fresh player", () => {
    it("deserialize(null) is a no-op — inventory stays empty", () => {
      const manager = new InventoryManager();
      manager.registerDefinitions([makeItem("item:coin")]);
      manager.deserializeSaveSlice(null);
      expect(manager.serializeSaveSlice()).toEqual({ entries: [] });
    });
  });

  describe("clobber semantics", () => {
    it("replaces existing quantities with the slice's entries", () => {
      const manager = new InventoryManager();
      manager.registerDefinitions([
        makeItem("item:coin"),
        makeItem("item:key")
      ]);
      manager.addItem("item:coin", 10);
      manager.addItem("item:key", 1);

      // Deserialize a slice that only has coins - key should be gone
      manager.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          entries: [{ definitionId: "item:coin", count: 5 }]
        }
      });

      expect(manager.getQuantity("item:coin")).toBe(5);
      expect(manager.getQuantity("item:key")).toBe(0);
    });
  });
});

describe("createInventoryPlayerSaveParticipant", () => {
  it("declares participantId, tier, schemaVersion per the contract", () => {
    const p = createInventoryPlayerSaveParticipant({
      getInventoryManager: () => null
    });
    expect(p.participantId).toBe("inventory.player");
    expect(p.tier).toBe("default");
    expect(p.schemaVersion).toBe(1);
  });

  it("serialize returns an empty slice when the getter yields null", () => {
    const p = createInventoryPlayerSaveParticipant({
      getInventoryManager: () => null
    });
    expect(p.serialize()).toEqual({ entries: [] });
  });

  it("serialize forwards to the manager when available", () => {
    const manager = new InventoryManager();
    manager.registerDefinitions([makeItem("item:coin")]);
    manager.addItem("item:coin", 4);
    const p = createInventoryPlayerSaveParticipant({
      getInventoryManager: () => manager
    });
    expect(p.serialize().entries).toEqual([
      { definitionId: "item:coin", count: 4 }
    ]);
  });

  it("deserialize is a no-op when the getter yields null", () => {
    const p = createInventoryPlayerSaveParticipant({
      getInventoryManager: () => null
    });
    expect(() =>
      p.deserialize({
        schemaVersion: 1,
        data: { entries: [] }
      } as SaveSlice<InventoryPlayerSlice>)
    ).not.toThrow();
  });

  it("deserialize forwards to the manager when available", () => {
    const manager = new InventoryManager();
    manager.registerDefinitions([makeItem("item:coin")]);
    const p = createInventoryPlayerSaveParticipant({
      getInventoryManager: () => manager
    });
    p.deserialize({
      schemaVersion: 1,
      data: { entries: [{ definitionId: "item:coin", count: 7 }] }
    });
    expect(manager.getQuantity("item:coin")).toBe(7);
  });
});

function byDefinitionId(
  a: { definitionId: string },
  b: { definitionId: string }
): number {
  return a.definitionId.localeCompare(b.definitionId);
}
