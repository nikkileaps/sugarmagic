/**
 * packages/plugins/src/catalog/sugaragent/tests/recovery-strategies-section.test.tsx
 *
 * Purpose: Verifies the NPC inspector's Recovery section -- the ordering and
 * add-list rules an author depends on, and that sugaragent actually contributes
 * the section to the NPC workspace.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createDefaultNPCDefinition } from "@sugarmagic/domain";
import type { NPCDefinition, NPCRecoveryStrategy } from "@sugarmagic/domain";
import {
  availableStrategies,
  reorderStrategies
} from "../ui/RecoveryStrategiesSection";
import { pluginDefinition } from "../index";

function entries(...strategies: string[]): NPCRecoveryStrategy[] {
  return strategies.map((strategy) => ({
    strategy: strategy as NPCRecoveryStrategy["strategy"],
    note: ""
  }));
}

describe("recovery strategy ordering", () => {
  // Authored order is what the NPC walks, so a drag has to land the strategy
  // exactly where it was dropped and leave the rest alone.
  it("moves a strategy down to the position it was dropped on", () => {
    const result = reorderStrategies(
      entries("curt-exit", "joke", "gossip"),
      "curt-exit",
      "gossip"
    );
    expect(result.map((e) => e.strategy)).toEqual([
      "joke",
      "gossip",
      "curt-exit"
    ]);
  });

  it("moves a strategy up to the position it was dropped on", () => {
    const result = reorderStrategies(
      entries("curt-exit", "joke", "gossip"),
      "gossip",
      "curt-exit"
    );
    expect(result.map((e) => e.strategy)).toEqual([
      "gossip",
      "curt-exit",
      "joke"
    ]);
  });

  it("keeps the notes with their strategies", () => {
    const authored: NPCRecoveryStrategy[] = [
      { strategy: "curt-exit", note: "He has cheese to attend to." },
      { strategy: "joke", note: "Straight-faced." }
    ];
    const result = reorderStrategies(authored, "joke", "curt-exit");
    expect(result).toEqual([
      { strategy: "joke", note: "Straight-faced." },
      { strategy: "curt-exit", note: "He has cheese to attend to." }
    ]);
  });

  it("leaves the list alone when a strategy is dropped on itself", () => {
    const authored = entries("curt-exit", "joke");
    expect(reorderStrategies(authored, "joke", "joke")).toBe(authored);
  });
});

describe("which strategies the add control offers", () => {
  it("offers all six for an NPC with none authored", () => {
    expect(availableStrategies([])).toHaveLength(6);
  });

  it("does not offer a strategy already authored", () => {
    expect(availableStrategies(entries("gossip", "joke"))).toEqual([
      "curt-exit",
      "change-subject",
      "playful-probe",
      "self-disclosure"
    ]);
  });

  it("offers nothing once all six are authored", () => {
    expect(
      availableStrategies(
        entries(
          "curt-exit",
          "change-subject",
          "joke",
          "playful-probe",
          "self-disclosure",
          "gossip"
        )
      )
    ).toEqual([]);
  });
});

describe("the section is contributed to the NPC inspector", () => {
  // Without this the component compiles, renders in isolation, and never
  // appears in Studio.
  const section = pluginDefinition.shell?.designSections?.find(
    (candidate) => candidate.sectionId === "recovery-strategies"
  );

  it("registers against the npcs workspace", () => {
    expect(section).toBeDefined();
    expect(section?.workspaceKind).toBe("npcs");
    expect(section?.label).toBe("Recovery");
  });

  it("renders nothing when no NPC is selected", () => {
    expect(
      section?.render({
        workspaceKind: "npcs",
        gameProjectId: null,
        gameProject: null,
        pluginConfigurations: [],
        regions: [],
        activeRegion: null,
        targetLanguage: "es",
        onCommand: () => {},
        selectedNPC: null,
        updateNPC: () => {}
      })
    ).toBeNull();
  });

  it("renders an element for a selected NPC", () => {
    const npc: NPCDefinition = {
      ...createDefaultNPCDefinition({ displayName: "Finnick" }),
      recoveryStrategies: [{ strategy: "gossip", note: "About Mim." }]
    };
    expect(
      section?.render({
        workspaceKind: "npcs",
        gameProjectId: null,
        gameProject: null,
        pluginConfigurations: [],
        regions: [],
        activeRegion: null,
        targetLanguage: "es",
        onCommand: () => {},
        selectedNPC: npc,
        updateNPC: () => {}
      })
    ).not.toBeNull();
  });
});
