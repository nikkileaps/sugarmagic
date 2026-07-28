/**
 * packages/plugins/src/catalog/sugaragent/runtime/contributions.test.ts
 *
 * Purpose: Guards the lifecycle contribution contract (Plan 084.1):
 *   - Zero contributions degrades to byte-identical empty state.
 *   - Valid contributions merge in pluginId sort order.
 *   - Malformed entries are dropped (logged, not thrown).
 *   - Boolean flags are OR'd; lexicon maps are unioned per category.
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  SUGARAGENT_CONTRIB_PREFIX,
  collectContributions,
  type MergedContributions
} from "./contributions";

const EMPTY_MERGED: MergedContributions = {
  mergedOverlay: "",
  mergedReminder: "",
  judgeDirectives: [],
  regenDirectives: [],
  preserveActionTags: false,
  interpretLexicon: {},
  retrieveBiasTerms: []
};

describe("collectContributions -- zero contributions", () => {
  it("returns empty merged view when annotations are empty", () => {
    expect(collectContributions({})).toEqual(EMPTY_MERGED);
  });

  it("returns empty merged view when no contrib keys are present", () => {
    const annotations: Record<string, unknown> = {
      "sugarlang.constraint": { targetLanguageRatio: 0.5 },
      "sugaragent.session": { turns: 1 }
    };
    expect(collectContributions(annotations)).toEqual(EMPTY_MERGED);
  });

  it("ignores a key matching the prefix with no pluginId segment", () => {
    const annotations: Record<string, unknown> = {
      [SUGARAGENT_CONTRIB_PREFIX]: { schemaVersion: 1, generateOverlay: "should be ignored" }
    };
    expect(collectContributions(annotations)).toEqual(EMPTY_MERGED);
  });
});

describe("collectContributions -- single valid contribution", () => {
  it("returns the overlay from a single contribution", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/sugarlang": {
        schemaVersion: 1,
        generateOverlay: "Language constraint: 85% Spanish."
      }
    };
    const result = collectContributions(annotations);
    expect(result.mergedOverlay).toBe("Language constraint: 85% Spanish.");
    expect(result.judgeDirectives).toEqual([]);
    expect(result.preserveActionTags).toBe(false);
  });

  it("returns judgeDirectives from a single contribution", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/sugarlang": {
        schemaVersion: 1,
        judgeDirectives: ["Language is directed. Language mixing is never a character violation."]
      }
    };
    const result = collectContributions(annotations);
    expect(result.judgeDirectives).toEqual([
      "Language is directed. Language mixing is never a character violation."
    ]);
  });

  it("returns preserveActionTags when set", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/myplugin": {
        schemaVersion: 1,
        textConventions: { preserveActionTags: true }
      }
    };
    expect(collectContributions(annotations).preserveActionTags).toBe(true);
  });

  it("returns interpretLexicon when set", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/sugarlang": {
        schemaVersion: 1,
        interpretLexicon: { farewell: ["adios", "hasta luego"], greeting: ["hola"] }
      }
    };
    const result = collectContributions(annotations);
    expect(result.interpretLexicon["farewell"]).toEqual(["adios", "hasta luego"]);
    expect(result.interpretLexicon["greeting"]).toEqual(["hola"]);
  });
});

describe("collectContributions -- multiple contributors, merge order", () => {
  it("merges overlays in pluginId sort order (a-plugin before b-plugin)", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/b-plugin": {
        schemaVersion: 1,
        generateOverlay: "B overlay"
      },
      "sugaragent.contrib/a-plugin": {
        schemaVersion: 1,
        generateOverlay: "A overlay"
      }
    };
    const result = collectContributions(annotations);
    // a-plugin sorts before b-plugin
    expect(result.mergedOverlay).toBe("A overlay\n\nB overlay");
  });

  it("concatenates judgeDirectives in pluginId sort order", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/z-plugin": {
        schemaVersion: 1,
        judgeDirectives: ["Z directive"]
      },
      "sugaragent.contrib/a-plugin": {
        schemaVersion: 1,
        judgeDirectives: ["A directive"]
      }
    };
    expect(collectContributions(annotations).judgeDirectives).toEqual([
      "A directive",
      "Z directive"
    ]);
  });

  it("ORs preserveActionTags: true if ANY contributor sets it", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/plugin-a": { schemaVersion: 1 },
      "sugaragent.contrib/plugin-b": {
        schemaVersion: 1,
        textConventions: { preserveActionTags: true }
      }
    };
    expect(collectContributions(annotations).preserveActionTags).toBe(true);
  });

  it("unions interpretLexicon per category across contributors", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/pack-es": {
        schemaVersion: 1,
        interpretLexicon: { farewell: ["adios"] }
      },
      "sugaragent.contrib/pack-fr": {
        schemaVersion: 1,
        interpretLexicon: { farewell: ["au revoir"], greeting: ["bonjour"] }
      }
    };
    const result = collectContributions(annotations);
    expect(result.interpretLexicon["farewell"]).toEqual(["adios", "au revoir"]);
    expect(result.interpretLexicon["greeting"]).toEqual(["bonjour"]);
  });
});

describe("collectContributions -- retrieveBiasTerms (087.6)", () => {
  it("returns retrieveBiasTerms from a single contribution", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/sugarlang": {
        schemaVersion: 1,
        retrieveBiasTerms: ["comer", "hablar"]
      }
    };
    expect(collectContributions(annotations).retrieveBiasTerms).toEqual(["comer", "hablar"]);
  });

  it("concatenates retrieveBiasTerms across contributors in pluginId sort order", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/z-plugin": { schemaVersion: 1, retrieveBiasTerms: ["pan"] },
      "sugaragent.contrib/a-plugin": { schemaVersion: 1, retrieveBiasTerms: ["agua", "leche"] }
    };
    expect(collectContributions(annotations).retrieveBiasTerms).toEqual(["agua", "leche", "pan"]);
  });

  it("returns empty array when no contribution sets retrieveBiasTerms", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/sugarlang": { schemaVersion: 1, generateOverlay: "some overlay" }
    };
    expect(collectContributions(annotations).retrieveBiasTerms).toEqual([]);
  });

  it("drops a contribution where retrieveBiasTerms is not an array", () => {
    const logger = { warn: vi.fn() };
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/bad": { schemaVersion: 1, retrieveBiasTerms: "not-an-array" }
    };
    expect(collectContributions(annotations, logger)).toEqual(EMPTY_MERGED);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("collectContributions -- malformed entries", () => {
  it("drops a contribution missing schemaVersion and logs a warning", () => {
    const logger = { warn: vi.fn() };
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/bad-plugin": { generateOverlay: "no schema version" }
    };
    const result = collectContributions(annotations, logger);
    expect(result).toEqual(EMPTY_MERGED);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("bad-plugin"),
      expect.anything()
    );
  });

  it("drops a contribution with wrong schemaVersion", () => {
    const logger = { warn: vi.fn() };
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/bad-plugin": { schemaVersion: 2, generateOverlay: "future version" }
    };
    expect(collectContributions(annotations, logger)).toEqual(EMPTY_MERGED);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("drops a contribution where judgeDirectives is not an array", () => {
    const logger = { warn: vi.fn() };
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/bad-plugin": {
        schemaVersion: 1,
        judgeDirectives: "should be an array"
      }
    };
    expect(collectContributions(annotations, logger)).toEqual(EMPTY_MERGED);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("drops a null contribution", () => {
    const logger = { warn: vi.fn() };
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/null-plugin": null
    };
    expect(collectContributions(annotations, logger)).toEqual(EMPTY_MERGED);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("keeps valid contributions when a malformed one is present alongside them", () => {
    const logger = { warn: vi.fn() };
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/bad": { generateOverlay: "no schema" },
      "sugaragent.contrib/good": { schemaVersion: 1, generateOverlay: "good overlay" }
    };
    const result = collectContributions(annotations, logger);
    expect(result.mergedOverlay).toBe("good overlay");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("never throws on malformed input", () => {
    const annotations: Record<string, unknown> = {
      "sugaragent.contrib/a": "not an object",
      "sugaragent.contrib/b": 42,
      "sugaragent.contrib/c": { schemaVersion: 1, interpretLexicon: "not an object" }
    };
    expect(() => collectContributions(annotations)).not.toThrow();
  });
});
