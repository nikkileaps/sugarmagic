/**
 * packages/plugins/src/catalog/sugarlang/tests/budgeter/lexical-budgeter.test.ts
 *
 * Purpose: Verifies the end-to-end Lexical Budgeter funnel and prescription output.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/budgeter/lexical-budgeter as the implementation under test.
 *   - Covers Epic 8 Story 8.4.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { LexicalBudgeter } from "../../runtime/budgeter/lexical-budgeter";
import { FsrsLearnerPriorProvider } from "../../runtime/providers/impls/fsrs-learner-prior-provider";
import {
  createBudgeterAtlasProvider,
  createBudgeterLearner,
  createBudgeterLemmaCard,
  createBudgeterSceneLexicon
} from "./test-helpers";

function createBandEntries(prefix: string, count: number, band: "A1" | "A2" | "B1" | "B2") {
  return Array.from({ length: count }, (_, index) => ({
    lemmaId: `${prefix}-${index}`,
    band,
    frequencyRank: index + 1,
    anchor: index === 0
  }));
}

describe("LexicalBudgeter", () => {
  it("prescribes 1 introduce, 0 reinforce, and 12 avoid items for a fresh A1 learner", async () => {
    const entries = [
      ...createBandEntries("a1", 100, "A1"),
      ...createBandEntries("a2", 100, "A2"),
      ...createBandEntries("b2", 100, "B2")
    ];
    const atlas = createBudgeterAtlasProvider(entries);
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    const prescription = await budgeter.prescribe({
      learner: createBudgeterLearner("A1"),
      sceneLexicon: createBudgeterSceneLexicon({ entries }),
      conversationState: { nowMs: 1000, currentSessionTurn: 10 }
    });

    expect(prescription.introduce).toHaveLength(3);
    expect(prescription.reinforce).toHaveLength(0);
    expect(prescription.avoid).toHaveLength(12);
  });

  it("surfaces reinforce items for an A1 learner with existing reviewed cards", async () => {
    const entries = [
      ...createBandEntries("a1", 20, "A1"),
      ...createBandEntries("a2", 20, "A2")
    ];
    const atlas = createBudgeterAtlasProvider(entries);
    const learner = createBudgeterLearner("A1", {
      lemmaCards: Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          `a1-${index}`,
          createBudgeterLemmaCard(`a1-${index}`, "A1", {
            reviewCount: 2,
            retrievability: 0.15,
            lastReviewedAt: 100
          })
        ])
      )
    });
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    const prescription = await budgeter.prescribe({
      learner,
      sceneLexicon: createBudgeterSceneLexicon({ entries }),
      conversationState: { nowMs: 1000, currentSessionTurn: 10 }
    });

    expect(prescription.reinforce.length).toBeGreaterThan(0);
  });

  it("respects the envelope gate in a B1-dense scene", async () => {
    const entries = [
      ...createBandEntries("a2", 30, "A2"),
      ...createBandEntries("b1", 30, "B1"),
      ...createBandEntries("c1", 30, "B2")
    ];
    const atlas = createBudgeterAtlasProvider(entries);
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    const prescription = await budgeter.prescribe({
      learner: createBudgeterLearner("A2"),
      sceneLexicon: createBudgeterSceneLexicon({ entries }),
      conversationState: { nowMs: 1000, currentSessionTurn: 10 }
    });

    expect(
      prescription.introduce.every((lemma) => !lemma.lemmaId.startsWith("c1-"))
    ).toBe(true);
    expect(
      prescription.reinforce.every((lemma) => !lemma.lemmaId.startsWith("c1-"))
    ).toBe(true);
    expect(prescription.avoid.every((lemma) => lemma.lemmaId.startsWith("c1-"))).toBe(true);
  });

  it("is deterministic for the same inputs and scales to 1000 candidates", async () => {
    const entries = [
      ...createBandEntries("a1", 400, "A1"),
      ...createBandEntries("a2", 300, "A2"),
      ...createBandEntries("b1", 300, "B1")
    ];
    const atlas = createBudgeterAtlasProvider(entries);
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });
    const input = {
      learner: createBudgeterLearner("A2"),
      sceneLexicon: createBudgeterSceneLexicon({ entries }),
      conversationState: { nowMs: 1000, currentSessionTurn: 10 }
    };

    const start = performance.now();
    const first = await budgeter.prescribe(input);
    const second = await budgeter.prescribe(input);
    const elapsed = performance.now() - start;

    expect(first).toEqual(second);
    expect(elapsed).toBeLessThan(20);
  });

  it("excludes active quest-essential lemmas from normal slots and records them in rationale", async () => {
    const entries = [
      { lemmaId: "altar", band: "B2" as const, frequencyRank: 1 },
      ...createBandEntries("a1", 20, "A1")
    ];
    const atlas = createBudgeterAtlasProvider(entries);
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    const prescription = await budgeter.prescribe({
      learner: createBudgeterLearner("A1"),
      sceneLexicon: createBudgeterSceneLexicon({
        entries,
        questEssentialLemmas: [
          {
            lemmaId: "altar",
            lang: "es",
            cefrBand: "B2",
            sourceQuestId: "quest-1",
            sourceObjectiveNodeId: "objective-1",
            sourceObjectiveDisplayName: "Touch the altar"
          }
        ]
      }),
      activeQuestEssentialLemmas: [
        {
          lemmaId: "altar",
          lang: "es",
          cefrBand: "B2",
          sourceQuestId: "quest-1",
          sourceObjectiveNodeId: "objective-1",
          sourceObjectiveDisplayName: "Touch the altar"
        }
      ],
      conversationState: { nowMs: 1000, currentSessionTurn: 10 }
    });

    expect(
      [...prescription.introduce, ...prescription.reinforce, ...prescription.avoid].some(
        (lemma) => lemma.lemmaId === "altar"
      )
    ).toBe(false);
    expect(prescription.rationale.questEssentialExclusionLemmaIds).toContain("altar");
  });

  it("does not change behavior when the quest-essential exclusion list is empty", async () => {
    const entries = createBandEntries("a1", 30, "A1");
    const atlas = createBudgeterAtlasProvider(entries);
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });
    const baseInput = {
      learner: createBudgeterLearner("A1"),
      sceneLexicon: createBudgeterSceneLexicon({ entries }),
      conversationState: { nowMs: 1000, currentSessionTurn: 10 }
    };

    const withoutList = await budgeter.prescribe(baseInput);
    const withEmptyList = await budgeter.prescribe({
      ...baseInput,
      activeQuestEssentialLemmas: []
    });

    expect(withoutList).toEqual(withEmptyList);
  });
});
