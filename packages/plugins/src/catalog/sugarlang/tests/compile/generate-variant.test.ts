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
import {
  MemoryVariantCache
} from "../../runtime/compile/variant-cache";
import {
  SugarlangAuthoringCompileScheduler
} from "../../runtime/compile/compile-scheduler";
import type { SugarlangLLMClient, SugarlangLLMRequest } from "../../runtime/llm/types";
import type { LexicalAtlasProvider, CEFRBand } from "../../runtime/types";
import type { InventoryChunk } from "../../runtime/contracts/competency-inventory";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";

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

describe("compile-scheduler flushVariants", () => {
  function createSchedulerDeps() {
    const scenes = [createTestSceneAuthoringContext()];
    const atlas = createTestAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" }
    ]);
    const morphology = createTestMorphologyLoader("es", { hola: "hola" });
    const cache = new MemoryCompileCache();
    return { scenes, atlas, morphology, cache };
  }

  it("skips generation when variant cache is warm (cache-hit)", async () => {
    const { scenes, atlas, morphology, cache } = createSchedulerDeps();
    const variantCache = new MemoryVariantCache();
    const generateVariantMock = vi.fn().mockResolvedValue({
      variant: null,
      failure: { message: "should not be called" }
    });

    const dialogue = scenes[0]!.dialogues[0]!;
    const node = dialogue.nodes[0]!;
    const contentHash = [node.nodeId, node.text, JSON.stringify({})].join("|");

    // Pre-populate cache for B1/es
    await variantCache.set({
      key: {
        lang: "es",
        band: "B1",
        contentHash,
        variantPromptVersion: VARIANT_PROMPT_VERSION
      },
      variant: {
        source: {
          kind: "dialogue-node",
          dialogueDefinitionId: dialogue.definitionId,
          nodeId: node.nodeId
        },
        lang: "es",
        band: "B1",
        text: "Hola viajero.",
        verdict: {
          envelopePasses: true,
          ratioPasses: true,
          voiceRetentionScore: 1,
          fidelityPasses: true,
          overallPasses: true
        },
        reviewFlag: false,
        generatedAtMs: 1000,
        generatedByModel: "scripted-variant-bake",
        contentHash,
        promptVersion: VARIANT_PROMPT_VERSION
      }
    });

    const scheduler = new SugarlangAuthoringCompileScheduler({
      getScenes: () => scenes,
      getDialogues: () => scenes.flatMap((s) => s.dialogues),
      atlas,
      morphology,
      cache,
      variantPipeline: {
        cache: variantCache,
        generateVariant: generateVariantMock,
        promptVersion: VARIANT_PROMPT_VERSION,
        bands: ["B1"],
        languages: ["es"]
      }
    });

    // Manually queue the dialogue
    scheduler["pendingVariantDialogueIds"].add(dialogue.definitionId);
    await scheduler.flushVariants();

    // generateVariant was NOT called because cache was warm for B1
    expect(generateVariantMock).not.toHaveBeenCalled();
  });

  it("calls generateVariant for each band/language combo when cache is cold", async () => {
    const { scenes, atlas, morphology, cache } = createSchedulerDeps();
    const variantCache = new MemoryVariantCache();
    const baked: ReturnType<typeof createStubVariant> = createStubVariant(
      scenes[0]!.dialogues[0]!.nodes[0]!.nodeId,
      scenes[0]!.dialogues[0]!.definitionId
    );
    const generateVariantMock = vi.fn().mockResolvedValue({ variant: baked });

    const scheduler = new SugarlangAuthoringCompileScheduler({
      getScenes: () => scenes,
      getDialogues: () => scenes.flatMap((s) => s.dialogues),
      atlas,
      morphology,
      cache,
      variantPipeline: {
        cache: variantCache,
        generateVariant: generateVariantMock,
        promptVersion: VARIANT_PROMPT_VERSION,
        bands: ["B1", "B2"],
        languages: ["es", "fr"]
      }
    });

    const dialogue = scenes[0]!.dialogues[0]!;
    scheduler["pendingVariantDialogueIds"].add(dialogue.definitionId);
    await scheduler.flushVariants();

    // 2 bands x 2 languages = 4 calls
    expect(generateVariantMock).toHaveBeenCalledTimes(4);
  });
});

function createStubVariant(nodeId: string, dialogueDefinitionId: string) {
  return {
    nodeId,
    dialogueDefinitionId,
    lang: "es",
    band: "B1" as CEFRBand,
    text: "Hola viajero.",
    verdict: {
      envelopePasses: true,
      ratioPasses: true,
      voiceRetentionScore: 1,
      fidelityPasses: true,
      overallPasses: true
    },
    reviewFlag: false,
    generatedAtMs: Date.now(),
    generatedByModel: "scripted-variant-bake",
    contentHash: "hash",
    promptVersion: VARIANT_PROMPT_VERSION
  };
}
