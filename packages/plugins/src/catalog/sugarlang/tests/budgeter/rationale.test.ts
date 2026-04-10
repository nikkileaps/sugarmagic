/**
 * packages/plugins/src/catalog/sugarlang/tests/budgeter/rationale.test.ts
 *
 * Purpose: Verifies the deterministic lexical rationale builder.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/budgeter/rationale as the implementation under test.
 *   - Covers Epic 8 Story 8.5.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { buildLexicalRationale } from "../../runtime/budgeter/rationale";
import { createBudgeterLearner, createBudgeterSceneLexicon } from "./test-helpers";

describe("budgeter rationale", () => {
  it("captures a complete decision trace and deterministic summary", () => {
    const input = {
      learner: createBudgeterLearner("A1"),
      sceneLexicon: createBudgeterSceneLexicon({
        entries: [{ lemmaId: "hola", band: "A1" }]
      }),
      conversationState: {},
      activeQuestEssentialLemmas: []
    };

    const rationale = buildLexicalRationale(input, {
      candidateSetSize: 12,
      envelopeSurvivorCount: 8,
      levelCap: 1,
      chosenIntroduce: [{ lemmaId: "hola", lang: "es" }],
      chosenReinforce: [{ lemmaId: "adios", lang: "es" }],
      droppedByEnvelope: [{ lemmaId: "ferrocarril", lang: "es" }],
      priorityScores: [
        {
          lemmaId: "hola",
          score: 1.2,
          components: {
            due: 0.4,
            new: 1,
            anchor: 1,
            prodgap: 0.3,
            lapse: 0
          },
          reasons: ["new-item", "scene-anchor"]
        }
      ],
      questEssentialExclusionLemmaIds: ["altar"]
    });

    expect(rationale.priorityScores).toHaveLength(1);
    expect(rationale.levelCap).toBe(1);
    expect(rationale.chosenIntroduce).toEqual([{ lemmaId: "hola", lang: "es" }]);
    expect(rationale.questEssentialExclusionLemmaIds).toEqual(["altar"]);
    expect(rationale.summary).toBe(
      "Scene gate yielded 12 candidate lemmas and 8 survived the envelope. The budgeter chose 1 introduce item(s) and 1 reinforce item(s) with a level cap of 1."
    );
  });
});
