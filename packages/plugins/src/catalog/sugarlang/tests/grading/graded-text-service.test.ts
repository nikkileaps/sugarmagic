/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/graded-text-service.test.ts
 *
 * Purpose: Verifies the content-agnostic grading contract -- that the adapter
 * carries no dialogue assumptions, that the caller's register reaches the
 * prompt, and that the gates behave.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/grading/graded-text-service with a mocked LLM client.
 *   - The prompt snapshots are the contract: they are what a reviewer reads to
 *     see that an item description and a dialogue line are asked for
 *     differently.
 *
 * Implements: Epic 086 Story 086.3 (post-extraction)
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  GRADED_TEXT_PROMPT_VERSION,
  GradedTextService,
  buildAdaptationPrompt
} from "../../runtime/grading/graded-text-service";
import type { SugarlangLLMClient } from "../../runtime/llm/types";
import { createTestAtlasProvider } from "../compile/test-helpers";

function createMockClient(...responses: string[]): SugarlangLLMClient {
  let index = 0;
  return {
    generate: vi.fn(async () => ({
      text: responses[Math.min(index++, responses.length - 1)] ?? "",
      requestId: null
    }))
  };
}

function createService(client: SugarlangLLMClient): GradedTextService {
  return new GradedTextService({
    llmClient: client,
    atlas: createTestAtlasProvider("es", []),
    inventoryChunks: []
  });
}

describe("GradedTextService", () => {
  it("adapts source text and returns a verdict", async () => {
    const result = await createService(
      createMockClient("El jefe de estacion busca su equipaje.")
    ).adapt({
      sourceText: "The stationmaster is looking for his luggage.",
      targetLang: "es",
      band: "B1"
    });

    expect(result.failure).toBeUndefined();
    expect(result.text).toBe("El jefe de estacion busca su equipaje.");
    expect(result.verdict).not.toBeNull();
    expect(result.promptVersion).toBe(GRADED_TEXT_PROMPT_VERSION);
  });

  it("skips the fidelity gate when no must-convey facts are supplied", async () => {
    // The gate has nothing to check, so it must auto-PASS rather than
    // auto-fail. Getting this backwards would fail every item description,
    // since items carry no intent artifact.
    const client = createMockClient("Un libro viejo.");
    const result = await createService(client).adapt({
      sourceText: "An old book.",
      targetLang: "es",
      band: "A2"
    });

    expect(result.verdict?.fidelityPasses).toBe(true);
    // One call: the adaptation. No fidelity judge call.
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it("fails the fidelity gate when the judge says facts are missing", async () => {
    const client = createMockClient(
      "Un libro.",
      JSON.stringify({ passes: false, reasoning: "omits the author" })
    );
    const result = await createService(client).adapt({
      sourceText: "A book by Pennygale.",
      targetLang: "es",
      band: "B1",
      mustConveyFacts: ["the book is by Pennygale"]
    });

    expect(result.verdict?.fidelityPasses).toBe(false);
    expect(result.verdict?.overallPasses).toBe(false);
    expect(client.generate).toHaveBeenCalledTimes(2);
  });

  it("fails the fidelity gate conservatively when the judge errors", async () => {
    let call = 0;
    const client: SugarlangLLMClient = {
      generate: vi.fn(async () => {
        call += 1;
        if (call === 1) return { text: "Un libro.", requestId: null };
        throw new Error("judge unavailable");
      })
    };
    const result = await createService(client).adapt({
      sourceText: "A book by Pennygale.",
      targetLang: "es",
      band: "B1",
      mustConveyFacts: ["the book is by Pennygale"]
    });

    expect(result.verdict?.fidelityPasses).toBe(false);
  });

  it("returns a failure, not a throw, when generation fails", async () => {
    const client: SugarlangLLMClient = {
      generate: vi.fn(async () => {
        throw new Error("rate limited");
      })
    };
    const result = await createService(client).adapt({
      sourceText: "An old book.",
      targetLang: "es",
      band: "A2"
    });

    expect(result.text).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.failure?.message).toBe("rate limited");
  });

  it("treats empty model output as a failure", async () => {
    const result = await createService(createMockClient("   ")).adapt({
      sourceText: "An old book.",
      targetLang: "es",
      band: "A2"
    });

    expect(result.text).toBeNull();
    expect(result.failure?.message).toContain("empty");
  });

  it("carries no dialogue vocabulary when the caller supplies none", () => {
    // The regression this whole extraction exists to prevent: the prompt used
    // to hardcode "dialogue writer" / "dialogue line", which is the wrong
    // register for a paragraph of item prose and cannot be overridden.
    const prompt = buildAdaptationPrompt({
      sourceText: "An old book, its spine cracked.",
      targetLang: "es",
      band: "A2",
      guidance: { register: "item description" }
    });

    expect(prompt.system).not.toContain("dialogue");
    expect(prompt.user).not.toContain("dialogue");
    expect(prompt.system).toContain("item description");
  });

  it("builds a stable prompt for an item description", () => {
    expect(
      buildAdaptationPrompt({
        sourceText: "An old book, its spine cracked.",
        targetLang: "es",
        band: "A2",
        guidance: { register: "item description" }
      })
    ).toMatchInlineSnapshot(`
      {
        "system": "You are a writer for a language-learning game. Adapt the given English item description into es for a elementary (A2) learner. Adapt rather than translate: keep what the text must communicate, but re-express it within reach of a elementary (A2) learner. The output must be predominantly or entirely in es, grammatically natural for the learner level. Preserve the length and shape of the original -- a one-line item description stays one line, a paragraph stays a paragraph. Do not add glosses, translations, or explanations inline. Return only the adapted text, nothing else.",
        "user": "Target language: es
      Learner level: A2 (elementary (A2))

      Original English item description:
      An old book, its spine cracked.",
      }
    `);
  });

  it("builds a stable prompt for a dialogue line with intent context", () => {
    expect(
      buildAdaptationPrompt({
        sourceText: "Have you seen my luggage?",
        targetLang: "es",
        band: "B1",
        mustConveyFacts: ["the luggage is missing"],
        guidance: {
          register: "dialogue line",
          notes: ["Dramatic beat: worried", "Voice note: formal"]
        }
      })
    ).toMatchInlineSnapshot(`
      {
        "system": "You are a writer for a language-learning game. Adapt the given English dialogue line into es for a intermediate (B1) learner. Adapt rather than translate: keep what the text must communicate, but re-express it within reach of a intermediate (B1) learner. The output must be predominantly or entirely in es, grammatically natural for the learner level. Preserve the length and shape of the original -- a one-line dialogue line stays one line, a paragraph stays a paragraph. Do not add glosses, translations, or explanations inline. Return only the adapted text, nothing else.",
        "user": "Target language: es
      Learner level: B1 (intermediate (B1))

      Context:
      Must-convey facts: the luggage is missing
      Dramatic beat: worried
      Voice note: formal

      Original English dialogue line:
      Have you seen my luggage?",
      }
    `);
  });
});
