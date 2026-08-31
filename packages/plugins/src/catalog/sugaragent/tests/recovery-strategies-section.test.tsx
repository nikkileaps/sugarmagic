/**
 * packages/plugins/src/catalog/sugaragent/tests/recovery-strategies-section.test.tsx
 *
 * Purpose: Verifies the NPC inspector's Recovery section -- the ordering and
 * add-list rules an author depends on, and that sugaragent actually contributes
 * the section to the NPC workspace.
 *
 * Status: active
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Stand-ins for the chrome, so the assertions are about this component's own
// output rather than Mantine's markup (and so Menu does not demand a provider).
vi.mock("@mantine/core", () => {
  const passthrough = (tag: string) =>
    ({ children }: { children?: ReactNode }) => <div data-el={tag}>{children}</div>;
  const Menu = Object.assign(passthrough("menu"), {
    Target: passthrough("menu-target"),
    Dropdown: passthrough("menu-dropdown"),
    Item: ({ children }: { children?: ReactNode }) => <li>{children}</li>
  });
  return {
    ActionIcon: ({ children, ...rest }: { children?: ReactNode; "aria-label"?: string }) => (
      <button aria-label={rest["aria-label"]}>{children}</button>
    ),
    Button: passthrough("button"),
    Group: passthrough("group"),
    Menu,
    Stack: passthrough("stack"),
    Text: passthrough("text"),
    Textarea: ({ value }: { value?: string }) => <textarea defaultValue={value} />
  };
});
vi.mock("@sugarmagic/ui", () => ({
  SortableList: ({
    items,
    renderActions,
    renderItem
  }: {
    items: Array<{ id: string; label: string }>;
    renderActions?: (item: { id: string }, index: number) => ReactNode;
    renderItem?: (item: { id: string }, index: number) => ReactNode;
  }) => (
    <ul>
      {items.map((item, index) => (
        <li key={item.id}>
          <span>{item.label}</span>
          {renderActions?.(item, index)}
          {renderItem?.(item, index)}
        </li>
      ))}
    </ul>
  )
}));
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

  it("renders the authored strategies for a selected NPC", () => {
    const npc: NPCDefinition = {
      ...createDefaultNPCDefinition({ displayName: "Finnick" }),
      recoveryStrategies: [
        { strategy: "gossip", note: "About Mim." },
        { strategy: "joke", note: "" }
      ]
    };
    // Rendered, not just constructed: a non-null element proves nothing, since
    // createElement never runs the component.
    const html = renderToStaticMarkup(
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
      }) as never
    );
    expect(html).toContain("gossip");
    expect(html).toContain("joke");
    // The one helper line, because order is load-bearing and nothing else says so.
    expect(html).toContain("Tried in order.");
  });
});
