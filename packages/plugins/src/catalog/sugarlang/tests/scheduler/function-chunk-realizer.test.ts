/**
 * packages/plugins/src/catalog/sugarlang/tests/scheduler/function-chunk-realizer.test.ts
 *
 * Purpose: Pins the function-to-chunk realization contract: scheduled function
 *   teachables are expanded to chunk:{id} LemmaRefs, excluding already-known chunks.
 *
 * Implements: Plan 087 story 087.3
 *
 * Status: active
 */

import { describe, it, expect } from "vitest";
import { realizeFunctionChunksFromSchedule } from "../../runtime/scheduler/function-chunk-realizer";
import type { TeachSchedule } from "../../runtime/scheduler/teach-schedule";
import type { FunctionEntry } from "../../runtime/contracts/function-inventory";
import type { LemmaCard } from "../../runtime/types";

function makeCard(lemmaId: string): LemmaCard {
  return {
    lemmaId,
    difficulty: 5,
    stability: 2,
    retrievability: 0.9,
    lastReviewedAt: null,
    reviewCount: 1,
    lapseCount: 0,
    cefrPriorBand: "A1",
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

function makeSchedule(overrides: Partial<TeachSchedule> = {}): TeachSchedule {
  return {
    teachables: [],
    isColdStart: false,
    sceneId: "scene-1",
    conversationId: "conv-1",
    sceneComprehensionRate: 1.0,
    stretchAllowanceActive: false,
    strainSuppressed: false,
    ...overrides
  };
}

const GREET_FN: FunctionEntry = {
  functionId: "greet",
  displayName: "Greet",
  cefrDescriptor: "",
  band: "A1",
  chunks: {
    es: [
      { chunkId: "hola" },
      { chunkId: "buenos_dias" }
    ]
  }
} as unknown as FunctionEntry;

const NO_CHUNK_FN: FunctionEntry = {
  functionId: "farewell",
  displayName: "Farewell",
  cefrDescriptor: "",
  band: "A1",
  chunks: {}
} as unknown as FunctionEntry;

describe("realizeFunctionChunksFromSchedule", () => {
  it("returns empty array when no function teachables in schedule", () => {
    const schedule = makeSchedule({
      teachables: [{ id: "hola", kind: "lemma", priority: 0.8, teachReason: "due", affinityNpcIds: [] }]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "es", {}, [GREET_FN]);
    expect(result).toHaveLength(0);
  });

  it("returns chunk: refs for a scheduled function", () => {
    const schedule = makeSchedule({
      teachables: [{ id: "greet", kind: "function", priority: 0.5, teachReason: "introduction", affinityNpcIds: [] }]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "es", {}, [GREET_FN]);
    expect(result).toEqual([
      { lemmaId: "chunk:hola", lang: "es" },
      { lemmaId: "chunk:buenos_dias", lang: "es" }
    ]);
  });

  it("excludes chunks already in lemmaCards", () => {
    const schedule = makeSchedule({
      teachables: [{ id: "greet", kind: "function", priority: 0.5, teachReason: "introduction", affinityNpcIds: [] }]
    });
    const cards: Record<string, LemmaCard> = {
      "chunk:hola": makeCard("chunk:hola")
    };
    const result = realizeFunctionChunksFromSchedule(schedule, "es", cards, [GREET_FN]);
    // chunk:hola already known; only chunk:buenos_dias remains
    expect(result).toEqual([{ lemmaId: "chunk:buenos_dias", lang: "es" }]);
  });

  it("returns empty when all chunks are already known", () => {
    const schedule = makeSchedule({
      teachables: [{ id: "greet", kind: "function", priority: 0.5, teachReason: "introduction", affinityNpcIds: [] }]
    });
    const cards: Record<string, LemmaCard> = {
      "chunk:hola": makeCard("chunk:hola"),
      "chunk:buenos_dias": makeCard("chunk:buenos_dias")
    };
    const result = realizeFunctionChunksFromSchedule(schedule, "es", cards, [GREET_FN]);
    expect(result).toHaveLength(0);
  });

  it("returns empty when function has no chunks for target language", () => {
    const schedule = makeSchedule({
      teachables: [{ id: "farewell", kind: "function", priority: 0.5, teachReason: "introduction", affinityNpcIds: [] }]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "es", {}, [NO_CHUNK_FN]);
    expect(result).toHaveLength(0);
  });

  it("respects maxFunctions cap (default 2)", () => {
    const FN_A: FunctionEntry = {
      functionId: "fn-a",
      displayName: "Fn A",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_a1" }, { chunkId: "chunk_a2" }] }
    } as unknown as FunctionEntry;
    const FN_B: FunctionEntry = {
      functionId: "fn-b",
      displayName: "Fn B",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_b1" }] }
    } as unknown as FunctionEntry;
    const FN_C: FunctionEntry = {
      functionId: "fn-c",
      displayName: "Fn C",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_c1" }] }
    } as unknown as FunctionEntry;
    const schedule = makeSchedule({
      teachables: [
        { id: "fn-a", kind: "function", priority: 0.9, teachReason: "introduction", affinityNpcIds: [] },
        { id: "fn-b", kind: "function", priority: 0.8, teachReason: "introduction", affinityNpcIds: [] },
        { id: "fn-c", kind: "function", priority: 0.7, teachReason: "introduction", affinityNpcIds: [] }
      ]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "es", {}, [FN_A, FN_B, FN_C]);
    // Only first 2 functions: fn-a (2 chunks) + fn-b (1 chunk) = 3 refs, fn-c excluded
    const ids = result.map((r) => r.lemmaId);
    expect(ids).toContain("chunk:chunk_a1");
    expect(ids).toContain("chunk:chunk_a2");
    expect(ids).toContain("chunk:chunk_b1");
    expect(ids).not.toContain("chunk:chunk_c1");
  });

  it("respects custom maxFunctions override", () => {
    const FN_A: FunctionEntry = {
      functionId: "fn-a",
      displayName: "Fn A",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_a1" }] }
    } as unknown as FunctionEntry;
    const FN_B: FunctionEntry = {
      functionId: "fn-b",
      displayName: "Fn B",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_b1" }] }
    } as unknown as FunctionEntry;
    const schedule = makeSchedule({
      teachables: [
        { id: "fn-a", kind: "function", priority: 0.9, teachReason: "introduction", affinityNpcIds: [] },
        { id: "fn-b", kind: "function", priority: 0.8, teachReason: "introduction", affinityNpcIds: [] }
      ]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "es", {}, [FN_A, FN_B], 1);
    expect(result).toHaveLength(1);
    expect(result[0].lemmaId).toBe("chunk:chunk_a1");
  });

  it("uses schedule priority order (not availableFunctions array order)", () => {
    const FN_A: FunctionEntry = {
      functionId: "fn-a",
      displayName: "Fn A",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_a" }] }
    } as unknown as FunctionEntry;
    const FN_B: FunctionEntry = {
      functionId: "fn-b",
      displayName: "Fn B",
      cefrDescriptor: "",
      band: "A1",
      chunks: { es: [{ chunkId: "chunk_b" }] }
    } as unknown as FunctionEntry;
    // fn-b appears first in availableFunctions but fn-a has higher priority in schedule
    const schedule = makeSchedule({
      teachables: [
        { id: "fn-a", kind: "function", priority: 0.9, teachReason: "introduction", affinityNpcIds: [] },
        { id: "fn-b", kind: "function", priority: 0.5, teachReason: "introduction", affinityNpcIds: [] }
      ]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "es", {}, [FN_B, FN_A], 1);
    // maxFunctions=1: should pick fn-a (first in schedule), not fn-b (first in availableFunctions)
    expect(result).toHaveLength(1);
    expect(result[0].lemmaId).toBe("chunk:chunk_a");
  });

  it("returns LemmaRefs with the correct target language", () => {
    const schedule = makeSchedule({
      teachables: [{ id: "greet", kind: "function", priority: 0.5, teachReason: "introduction", affinityNpcIds: [] }]
    });
    const result = realizeFunctionChunksFromSchedule(schedule, "fr", {}, [
      {
        ...GREET_FN,
        chunks: { fr: [{ chunkId: "bonjour" }] }
      } as unknown as FunctionEntry
    ]);
    expect(result).toEqual([{ lemmaId: "chunk:bonjour", lang: "fr" }]);
  });
});
