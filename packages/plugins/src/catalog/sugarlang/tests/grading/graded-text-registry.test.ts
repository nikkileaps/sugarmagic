/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/graded-text-registry.test.ts
 *
 * Purpose: Verifies the source-strategy pattern -- that each content kind
 * collects the right units, that the registry aggregates across kinds, and
 * that the dialogue content hash has not drifted.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/grading/graded-text-registry and the strategies
 *     under ../../runtime/grading/sources.
 *
 * Implements: Epic 086 Story 086.3 (generalised 2026-07-28)
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  GradedTextSourceRegistry,
  createDefaultGradedTextSourceRegistry
} from "../../runtime/grading/graded-text-registry";
import {
  buildDialogueNodeContentHash,
  createDialogueNodeSource
} from "../../runtime/grading/sources/dialogue-node-source";
import { createItemViewSource } from "../../runtime/grading/sources/item-view-source";
import { gradedTextSourceKey } from "../../runtime/grading/graded-text-source";
import type { GradedTextCorpus } from "../../runtime/grading/graded-text-source";
import type { DialogueDefinition, ItemDefinition } from "@sugarmagic/domain";

function dialogue(): DialogueDefinition {
  return {
    definitionId: "dialogue-1",
    displayName: "Horace",
    startNodeId: "node-1",
    interactionBinding: { npcDefinitionId: null },
    nodes: [
      {
        nodeId: "node-1",
        text: "Have you seen my luggage?",
        next: [],
        graphPosition: { x: 0, y: 0 }
      },
      {
        nodeId: "node-2",
        text: "   ",
        next: [],
        graphPosition: { x: 0, y: 0 }
      }
    ]
  } as DialogueDefinition;
}

function item(
  kind: ItemDefinition["interactionView"]["kind"],
  overrides: Partial<ItemDefinition["interactionView"]> = {}
): ItemDefinition {
  return {
    definitionId: "item-book",
    displayName: "Old Book",
    description: "A book.",
    interactionView: {
      kind,
      title: "Old Book",
      body: "A leather book, its spine cracked.",
      consumeLabel: "",
      documentDefinitionId: null,
      ...overrides
    }
  } as ItemDefinition;
}

const corpus = (over: Partial<GradedTextCorpus> = {}): GradedTextCorpus => ({
  targetLanguage: "es",
  ...over
});

describe("dialogue node source", () => {
  it("collects one unit per non-empty node", () => {
    const units = createDialogueNodeSource().collect(
      corpus({ dialogues: [dialogue()] })
    );
    expect(units).toHaveLength(1);
    expect(units[0]!.source).toEqual({
      kind: "dialogue-node",
      dialogueDefinitionId: "dialogue-1",
      nodeId: "node-1"
    });
    expect(units[0]!.guidance.register).toBe("dialogue line");
  });

  it("reproduces the legacy content hash exactly", () => {
    // LOAD-BEARING. The runtime lookup and the Studio popover build this seed
    // independently. Drift here does not error -- every lookup just misses and
    // scripted lines quietly fall back to the diglot weave, which reads as
    // "grading broke" rather than "the hash moved".
    expect(buildDialogueNodeContentHash("node-1", "Have you seen my luggage?")).toBe(
      ["node-1", "Have you seen my luggage?", JSON.stringify({})].join("|")
    );
    const units = createDialogueNodeSource().collect(
      corpus({ dialogues: [dialogue()] })
    );
    expect(units[0]!.contentHash).toBe(
      buildDialogueNodeContentHash("node-1", "Have you seen my luggage?")
    );
  });
});

describe("item view source", () => {
  it("collects title and body for an examine item, hashed independently", () => {
    const units = createItemViewSource().collect(corpus({ items: [item("examine")] }));
    expect(units.map((unit) => unit.source)).toEqual([
      { kind: "item-view", itemDefinitionId: "item-book", field: "title" },
      { kind: "item-view", itemDefinitionId: "item-book", field: "body" }
    ]);
    // Independent hashes: editing the body must not orphan the title's entry.
    expect(units[0]!.contentHash).not.toBe(units[1]!.contentHash);
  });

  it("gives title and body different registers", () => {
    const units = createItemViewSource().collect(corpus({ items: [item("examine")] }));
    expect(units[0]!.guidance.register).toBe("item name");
    expect(units[1]!.guidance.register).toBe("item description");
  });

  it("skips view kinds whose title/body are never rendered", () => {
    // `readable` defers to a bound document, so grading its fields would write
    // records nothing reads.
    expect(createItemViewSource().collect(corpus({ items: [item("readable")] }))).toEqual([]);
    expect(createItemViewSource().collect(corpus({ items: [item("none")] }))).toEqual([]);
  });

  it("skips empty fields", () => {
    const units = createItemViewSource().collect(
      corpus({ items: [item("examine", { body: "  " })] })
    );
    expect(units).toHaveLength(1);
    expect(units[0]!.source).toMatchObject({ field: "title" });
  });
});

describe("GradedTextSourceRegistry", () => {
  it("collects across every registered kind", () => {
    const units = createDefaultGradedTextSourceRegistry().collectAll(
      corpus({ dialogues: [dialogue()], items: [item("examine")] })
    );
    expect(new Set(units.map((unit) => unit.source.kind))).toEqual(
      new Set(["dialogue-node", "item-view"])
    );
    expect(units).toHaveLength(3);
  });

  it("degrades to the slices the caller actually has", () => {
    // A caller holding only items must not break the dialogue strategy. This is
    // the property that lets scene-scoped and library-scoped callers share one
    // registry.
    const units = createDefaultGradedTextSourceRegistry().collectAll(
      corpus({ items: [item("examine")] })
    );
    expect(units.every((unit) => unit.source.kind === "item-view")).toBe(true);
  });

  it("returns nothing for an empty corpus rather than throwing", () => {
    expect(createDefaultGradedTextSourceRegistry().collectAll(corpus())).toEqual([]);
  });

  it("is deterministic across runs", () => {
    const input = corpus({ dialogues: [dialogue()], items: [item("examine")] });
    const first = createDefaultGradedTextSourceRegistry().collectAll(input);
    const second = createDefaultGradedTextSourceRegistry().collectAll(input);
    expect(first.map((unit) => unit.contentHash)).toEqual(
      second.map((unit) => unit.contentHash)
    );
  });

  it("rejects double registration instead of silently replacing", () => {
    const registry = new GradedTextSourceRegistry().register(createItemViewSource());
    expect(() => registry.register(createItemViewSource())).toThrow(/already registered/);
  });

  it("exposes registered kinds for Studio surfaces", () => {
    expect(
      createDefaultGradedTextSourceRegistry()
        .list()
        .map((strategy) => strategy.kind)
        .sort()
    ).toEqual(["dialogue-node", "item-view"]);
  });
});

describe("gradedTextSourceKey", () => {
  it("produces a stable key per source kind", () => {
    expect(
      gradedTextSourceKey({
        kind: "dialogue-node",
        dialogueDefinitionId: "d1",
        nodeId: "n1"
      })
    ).toBe("dialogue-node:d1:n1");
    expect(
      gradedTextSourceKey({ kind: "item-view", itemDefinitionId: "i1", field: "body" })
    ).toBe("item-view:i1:body");
    expect(
      gradedTextSourceKey({
        kind: "spell-view",
        spellDefinitionId: "s1",
        field: "description"
      })
    ).toBe("spell-view:s1:description");
  });
});
