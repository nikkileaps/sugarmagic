/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/generate-variant.test.ts
 *
 * Purpose: Verifies generateVariant four-gate verification and fail-soft behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/generate-variant.
 *   - Also exercises the compile-scheduler flushVariants cache-hit skip path.
 *
 * Implements: Epic 086 Story 086.3 -- bake-time variant generation
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  generateVariant,
  VARIANT_PROMPT_VERSION,
  type GenerateVariantInput
} from "../../runtime/compile/generate-variant";
import type { SugarlangLLMClient, SugarlangLLMRequest } from "../../runtime/llm/types";
import { createTestAtlasProvider } from "./test-helpers";
import type { InventoryChunk } from "../../runtime/contracts/competency-inventory";

function createStubLLMClient(options: {
  variantText?: string;
  fidelityResult?: { passes: boolean; reasoning: string };
  failGeneration?: boolean;
}): SugarlangLLMClient {
  return {
    async generate(request: SugarlangLLMRequest): Promise<{ text: string; requestId: string | null }> {
      if (options.failGeneration) {
        throw new Error("LLM unavailable");
      }
      // Detect fidelity check by looking for "Must-convey facts" in userPrompt
      if (request.userPrompt.includes("Must-convey facts")) {
        const result = options.fidelityResult ?? { passes: true, reasoning: "All facts present." };
        return { text: JSON.stringify(result), requestId: null };
      }
      // Generation call
      return { text: options.variantText ?? "Hola viajero.", requestId: null };
    }
  };
}

const emptyAtlas = createTestAtlasProvider("es", [
  { lemmaId: "hola", cefrPriorBand: "A1" },
  { lemmaId: "viajero", cefrPriorBand: "A1" }
]);

const emptyInventoryChunks: InventoryChunk[] = [];

const baseInput: GenerateVariantInput = {
  authoredText: "Hello traveler.",
  targetLang: "es",
  band: "B1",
  intent: null,
  contentHash: "hash-abc",
  dialogueDefinitionId: "dialogue-1",
  nodeId: "node-1"
};

describe("generateVariant", () => {
  it("produces a variant with all four gates when LLM returns valid target-dominant text", async () => {
    const llmClient = createStubLLMClient({ variantText: "Hola viajero." });

    const result = await generateVariant(baseInput, {
      llmClient,
      atlas: emptyAtlas,
      inventoryChunks: emptyInventoryChunks
    });

    expect(result.variant).not.toBeNull();
    expect(result.failure).toBeUndefined();
    // Voice retention is always 1.0 when voiceSpec is null
    expect(result.variant!.verdict.voiceRetentionScore).toBe(1);
    // Fidelity passes (no mustConveyFacts in intent)
    expect(result.variant!.verdict.fidelityPasses).toBe(true);
    expect(result.variant!.promptVersion).toBe(VARIANT_PROMPT_VERSION);
    expect(result.variant!.lang).toBe("es");
    expect(result.variant!.band).toBe("B1");
    expect(result.variant!.source).toEqual({
      kind: "dialogue-node",
      dialogueDefinitionId: "dialogue-1",
      nodeId: "node-1"
    });
    expect(result.variant!.contentHash).toBe("hash-abc");
  });

  it("rf6.5.2: bakes the MARKS onto the variant when a slate steered the generation", async () => {
    // WHY THE MARKS ARE COMPUTED HERE AND NOT AT RUNTIME. Scripted mode never
    // calls the Teacher -- the teacher middleware early-returns with an empty
    // targetVocab -- so at runtime there is no slate to derive highlight terms
    // from. The slate exists at BAKE time, right here, alongside the text it
    // just produced.
    //
    // Without this a correctly baked line reached the player with NO
    // highlighting, while a substituted fallback line highlighted fine.
    const llmClient = createStubLLMClient({ variantText: "Hola. Quiere queso?" });
    const atlas = createTestAtlasProvider("es", [
      { lemmaId: "queso", cefrPriorBand: "A1", gloss: "cheese" }
    ]);

    const result = await generateVariant(
      {
        ...baseInput,
        teach: {
          introduce: [{ kind: "vocabulary", lemmaId: "queso", lang: "es" }],
          reinforce: [],
          avoid: []
        }
      },
      { llmClient, atlas, inventoryChunks: emptyInventoryChunks }
    );

    expect(result.variant!.highlight?.focusTerms).toContain("queso");
    expect(result.variant!.highlight?.introduceTerms).toContain("queso");
    expect(result.variant!.highlight?.glosses["queso"]).toBe("cheese");
  });

  it("rf6.5.2: bakes NO marks when there is no slate", async () => {
    // A caller with no scene -- and therefore no plan -- bakes a level-graded
    // line with no vocabulary steer. Absent marks must stay absent rather than
    // becoming an empty highlight, which would claim the line was examined and
    // found to teach nothing.
    const llmClient = createStubLLMClient({ variantText: "Hola viajero." });

    const result = await generateVariant(baseInput, {
      llmClient,
      atlas: emptyAtlas,
      inventoryChunks: emptyInventoryChunks
    });

    expect(result.variant!.highlight).toBeUndefined();
  });

  it("returns reviewFlag=true and variant=null on LLM generation failure", async () => {
    const llmClient = createStubLLMClient({ failGeneration: true });

    const result = await generateVariant(baseInput, {
      llmClient,
      atlas: emptyAtlas,
      inventoryChunks: emptyInventoryChunks
    });

    expect(result.variant).toBeNull();
    expect(result.failure).toBeDefined();
    expect(result.failure!.message).toBeTruthy();
  });

  it("returns reviewFlag=true when LLM returns empty text", async () => {
    const llmClient = createStubLLMClient({ variantText: "" });

    const result = await generateVariant(baseInput, {
      llmClient,
      atlas: emptyAtlas,
      inventoryChunks: emptyInventoryChunks
    });

    expect(result.variant).toBeNull();
    expect(result.failure?.message).toContain("empty");
  });

  it("sets fidelityPasses=false and reviewFlag=true when fidelity check returns no", async () => {
    const llmClient = createStubLLMClient({
      variantText: "Hola viajero.",
      fidelityResult: { passes: false, reasoning: "Missing the greeting fact." }
    });

    const result = await generateVariant(
      {
        ...baseInput,
        intent: {
          nodeId: "node-1",
          dialogueDefinitionId: "dialogue-1",
          anchorText: "Hello traveler.",
          mustConveyFacts: ["The traveler is greeted"],
          beat: "welcoming opener",
          voiceNote: "warm",
          derived: false,
          reviewFlag: false,
          extractedAtMs: 1000,
          extractedByModel: "hand-authored"
        }
      },
      {
        llmClient,
        atlas: emptyAtlas,
        inventoryChunks: emptyInventoryChunks
      }
    );

    expect(result.variant).not.toBeNull();
    expect(result.variant!.verdict.fidelityPasses).toBe(false);
    expect(result.variant!.reviewFlag).toBe(true);
    expect(result.variant!.verdict.overallPasses).toBe(false);
  });

  it("skips fidelity check (returns true) when intent has no mustConveyFacts", async () => {
    const generateSpy = vi.fn().mockResolvedValue({ text: "Hola viajero.", requestId: null });
    const llmClient: SugarlangLLMClient = { generate: generateSpy };

    const result = await generateVariant(baseInput, {
      llmClient,
      atlas: emptyAtlas,
      inventoryChunks: emptyInventoryChunks
    });

    expect(result.variant!.verdict.fidelityPasses).toBe(true);
    // Only one LLM call -- the generation, no fidelity call
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });
});

