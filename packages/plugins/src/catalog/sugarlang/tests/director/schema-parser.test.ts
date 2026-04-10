/**
 * packages/plugins/src/catalog/sugarlang/tests/director/schema-parser.test.ts
 *
 * Purpose: Verifies strict Director JSON parsing, repair logic, and hard-rule enforcement.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/director/schema-parser with prescription-safe fixtures.
 *   - Protects the no-invention and hard-floor enforcement rules from silent drift.
 *
 * Implements: Epic 9 Story 9.2
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  parseDirective,
  repairDirective
} from "../../runtime/director/schema-parser";
import { createDirectiveFixture, createDirectorContext } from "./test-helpers";

describe("parseDirective", () => {
  it("parses valid JSON into a directive", () => {
    const json = JSON.stringify(createDirectiveFixture());
    const result = parseDirective(json, {
      context: createDirectorContext()
    });

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.glossingStrategy).toBe("inline");
    }
  });

  it("repairs missing required fields from prescription defaults", () => {
    const context = createDirectorContext();
    const partial = {
      supportPosture: "supported",
      targetLanguageRatio: 0.5
    };

    const repaired = repairDirective(partial, context.prescription, context);
    expect(repaired.targetVocab.introduce).toEqual(context.prescription.introduce);
    expect(repaired.targetVocab.reinforce).toEqual(context.prescription.reinforce);
    expect(repaired.glossingStrategy).toBe("parenthetical");
  });

  it("drops invented introduce lemmas during repair", () => {
    const context = createDirectorContext({
      activeQuestEssentialLemmas: []
    });
    const repaired = repairDirective(
      {
        targetVocab: {
          introduce: [
            { lemmaId: "invented", lang: "es" },
            { lemmaId: "queso", lang: "es" }
          ],
          reinforce: [],
          avoid: []
        }
      },
      context.prescription,
      context
    );

    expect(repaired.targetVocab.introduce).toEqual([{ lemmaId: "queso", lang: "es" }]);
  });

  it("returns a structured error for malformed JSON", () => {
    const result = parseDirective("{ invalid json", {
      context: createDirectorContext()
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("invalid_json");
    }
  });

  it("clamps out-of-range targetLanguageRatio during repair", () => {
    const context = createDirectorContext();
    const repaired = repairDirective(
      {
        targetLanguageRatio: 1.5
      },
      context.prescription,
      context
    );

    expect(repaired.targetLanguageRatio).toBe(1);
  });

  it("rejects a directive that ignores the hard floor requirement", () => {
    const context = createDirectorContext({
      probeFloorState: {
        turnsSinceLastProbe: 26,
        totalPendingLemmas: 3,
        softFloorReached: true,
        hardFloorReached: true,
        hardFloorReason: "turns-since-probe"
      }
    });
    const telemetry = {
      emit: vi.fn()
    };

    const result = parseDirective(JSON.stringify(createDirectiveFixture()), {
      context,
      telemetry
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("hard_floor_violated");
    }
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "comprehension.director-hard-floor-violated",
        conversationId: "conversation-1"
      })
    );
  });

  it("rejects weak glossing when quest-essential lemmas are present", () => {
    const context = createDirectorContext();
    const telemetry = {
      emit: vi.fn()
    };

    const result = parseDirective(
      JSON.stringify(
        createDirectiveFixture({
          glossingStrategy: "none"
        })
      ),
      {
        context,
        telemetry
      }
    );

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("quest_essential_glossing_required");
    }
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "quest-essential.director-forced-glossing",
        correctedGlossingStrategy: "parenthetical"
      })
    );
  });
});
