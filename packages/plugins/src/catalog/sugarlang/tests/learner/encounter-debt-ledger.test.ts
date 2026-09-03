/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/encounter-debt-ledger.test.ts
 *
 * Purpose: Pins the encounter-debt ledger's debt creation, paydown, diversity counting,
 *   and active-debt surfacing. Also pins the static-day degradation (dayIndex null).
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/learner/encounter-debt-ledger.
 *
 * Implements: Plan 087 story 087.2
 *
 * Status: active
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryEncounterDebtLedger,
  TARGET_DEBT_ENCOUNTERS,
  countDiverseEncounters
} from "../../runtime/learner/encounter-debt-ledger";
import type { EncounterEntry } from "../../runtime/learner/encounter-debt-ledger";

function entry(
  npcDefinitionId: string | null,
  regionId: string | null,
  dayIndex: number | null
): EncounterEntry {
  return { npcDefinitionId, regionId, dayIndex };
}

describe("countDiverseEncounters", () => {
  it("returns 0 for empty list", () => {
    expect(countDiverseEncounters([])).toBe(0);
  });

  it("counts distinct (npc, scene, day) triplets", () => {
    const encounters: EncounterEntry[] = [
      entry("npc-a", "scene-1", 1),
      entry("npc-a", "scene-1", 1), // duplicate -- same slot
      entry("npc-b", "scene-1", 1), // new npc
      entry("npc-a", "scene-2", 1), // new scene
      entry("npc-a", "scene-1", 2)  // new day
    ];
    expect(countDiverseEncounters(encounters)).toBe(4);
  });

  it("treats null dayIndex as its own slot key (static-day degradation)", () => {
    const encounters: EncounterEntry[] = [
      entry("npc-a", "scene-1", null),
      entry("npc-a", "scene-1", null), // same slot
      entry("npc-b", "scene-1", null)  // different npc -> new slot
    ];
    expect(countDiverseEncounters(encounters)).toBe(2);
  });

  it("null npc and null scene each form their own dimension", () => {
    const encounters: EncounterEntry[] = [
      entry(null, null, 1),
      entry(null, "scene-1", 1), // same null-npc, different scene
      entry("npc-a", null, 1)   // different npc, null scene
    ];
    expect(countDiverseEncounters(encounters)).toBe(3);
  });
});

describe("MemoryEncounterDebtLedger", () => {
  let ledger: MemoryEncounterDebtLedger;

  beforeEach(() => {
    ledger = new MemoryEncounterDebtLedger();
  });

  describe("createDebt", () => {
    it("creates a new debt record with no encounters", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      const debt = await ledger.getDebt("hola");
      expect(debt).toBeDefined();
      expect(debt!.itemId).toBe("hola");
      expect(debt!.itemKind).toBe("vocabulary");
      expect(debt!.createdDayIndex).toBe(1);
      expect(debt!.encounters).toHaveLength(0);
      expect(debt!.targetEncounters).toBe(TARGET_DEBT_ENCOUNTERS);
    });

    it("is idempotent -- second createDebt for same itemId is a no-op", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      await ledger.createDebt("hola", "vocabulary", 2); // should not overwrite
      const debt = await ledger.getDebt("hola");
      expect(debt!.createdDayIndex).toBe(1); // original value preserved
    });

    it("accepts null createdDayIndex (static-day degradation)", async () => {
      await ledger.createDebt("fn-greet", "competency", null);
      const debt = await ledger.getDebt("fn-greet");
      expect(debt!.createdDayIndex).toBeNull();
    });
  });

  describe("recordEncounter", () => {
    it("appends an encounter to an existing debt", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      await ledger.recordEncounter("hola", entry("npc-a", "market", 1));
      const debt = await ledger.getDebt("hola");
      expect(debt!.encounters).toHaveLength(1);
    });

    it("is a no-op when no debt exists for itemId", async () => {
      await ledger.recordEncounter("unknown", entry("npc-a", "market", 1));
      expect(await ledger.getDebt("unknown")).toBeUndefined();
    });

    it("accumulates multiple encounters across different diversity slots", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      await ledger.recordEncounter("hola", entry("npc-a", "market", 1));
      await ledger.recordEncounter("hola", entry("npc-b", "market", 1));
      await ledger.recordEncounter("hola", entry("npc-a", "plaza", 1));
      const debt = await ledger.getDebt("hola");
      expect(debt!.encounters).toHaveLength(3);
      expect(countDiverseEncounters(debt!.encounters)).toBe(3);
    });

    it("duplicate encounters (same triplet) increment encounters but not diversity count", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      await ledger.recordEncounter("hola", entry("npc-a", "market", 1));
      await ledger.recordEncounter("hola", entry("npc-a", "market", 1));
      const debt = await ledger.getDebt("hola");
      expect(debt!.encounters).toHaveLength(2);
      expect(countDiverseEncounters(debt!.encounters)).toBe(1);
    });
  });

  describe("getEncounterCounts", () => {
    it("returns empty map when nothing is tracked", async () => {
      expect((await ledger.getEncounterCounts()).size).toBe(0);
    });

    it("reports a newly created item at zero", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      expect((await ledger.getEncounterCounts()).get("hola")).toBe(0);
    });

    it("KEEPS REPORTING an item past its target rather than dropping it", async () => {
      // The old method filtered on diverseEncounterCount < targetEncounters, so
      // a fully-paid item vanished. That comparison is a judgement about
      // whether an item still needs teaching, and judgements about what to
      // teach belong to the Teacher. The ledger reports the count.
      await ledger.createDebt("adios", "vocabulary", 1);
      for (let i = 0; i < TARGET_DEBT_ENCOUNTERS + 2; i++) {
        await ledger.recordEncounter("adios", entry(`npc-${i}`, "scene-1", 1));
      }
      expect((await ledger.getEncounterCounts()).get("adios")).toBe(
        TARGET_DEBT_ENCOUNTERS + 2
      );
    });

    it("counts diverse encounters, not raw ones", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      await ledger.recordEncounter("hola", entry("npc-a", "scene-1", 1));
      await ledger.recordEncounter("hola", entry("npc-b", "scene-1", 1));
      expect((await ledger.getEncounterCounts()).get("hola")).toBe(2);
    });

    it("static-day degradation: diversity is npc x scene when dayIndex is null", async () => {
      await ledger.createDebt("hola", "vocabulary", null);
      await ledger.recordEncounter("hola", entry("npc-a", "market", null));
      await ledger.recordEncounter("hola", entry("npc-a", "market", null));
      expect((await ledger.getEncounterCounts()).get("hola")).toBe(1);
    });
  });

  describe("listDebts", () => {
    it("returns all debts ordered by itemId", async () => {
      await ledger.createDebt("zebra", "vocabulary", 1);
      await ledger.createDebt("apple", "vocabulary", 1);
      await ledger.createDebt("mango", "vocabulary", 1);
      const list = await ledger.listDebts();
      expect(list.map((r) => r.itemId)).toEqual(["apple", "mango", "zebra"]);
    });

    it("returns immutable copies (mutation does not affect stored state)", async () => {
      await ledger.createDebt("hola", "vocabulary", 1);
      const list = await ledger.listDebts();
      list[0].encounters.push(entry("npc-x", "scene-x", 1));
      const list2 = await ledger.listDebts();
      expect(list2[0].encounters).toHaveLength(0);
    });
  });
});

