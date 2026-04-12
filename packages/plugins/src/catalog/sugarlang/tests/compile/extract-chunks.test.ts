/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/extract-chunks.test.ts
 *
 * Purpose: Verifies the lexical chunk extractor prompt, parsing, and failure behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/extract-chunks with mocked LLM clients and telemetry.
 *   - Uses stable TextBlob fixtures so reviewers can inspect the exact prompt contract.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness / Epic 14 Story 14.1
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  EXTRACTOR_PROMPT_VERSION,
  buildExtractChunksPrompt,
  extractChunks
} from "../../runtime/compile/extract-chunks";
import type { SugarlangLLMClient } from "../../runtime/llm/types";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import type { TextBlob } from "../../runtime/compile/scene-traversal";
import { createTestAtlasProvider } from "./test-helpers";

function createSceneText(): TextBlob[] {
  return [
    {
      sourceKind: "dialogue",
      sourceId: "dialogue-1:node-1",
      sourceLocation: {
        file: "dialogue:1",
        lineStart: 1,
        lineEnd: 1,
        snippet: "Voy de vez en cuando al mercado."
      },
      text: "Voy de vez en cuando al mercado.",
      weight: 1
    }
  ];
}

function createMockClient(text: string): SugarlangLLMClient {
  return {
    generate: vi.fn(async () => ({
      text,
      requestId: null
    }))
  };
}

describe("extractChunks", () => {
  it("extracts lexical chunks from a valid structured response", async () => {
    const atlas = createTestAtlasProvider("es", [
      { lemmaId: "vez", cefrPriorBand: "B2" },
      { lemmaId: "cuando", cefrPriorBand: "A1" }
    ]);
    const telemetry = new MemoryTelemetrySink();
    const result = await extractChunks({
      sceneId: "scene-1",
      contentHash: "hash-1",
      sceneText: createSceneText(),
      lang: "es",
      atlas,
      telemetry,
      llmClient: createMockClient(
        JSON.stringify({
          chunks: [
            {
              normalizedForm: "de_vez_en_cuando",
              surfaceForms: ["de vez en cuando"],
              cefrBand: "A2",
              constituentLemmas: ["vez", "cuando"],
              rationale: "Common adverbial phrase meaning from time to time."
            }
          ]
        })
      )
    });

    expect(result.failure).toBeUndefined();
    expect(result.chunks).toEqual([
      expect.objectContaining({
        chunkId: "de_vez_en_cuando",
        normalizedForm: "de_vez_en_cuando",
        cefrBand: "A2",
        constituentLemmas: ["vez", "cuando"],
        extractedByModel: "claude-sonnet-4-6",
        extractorPromptVersion: EXTRACTOR_PROMPT_VERSION
      })
    ]);

    const events = await telemetry.query({
      eventKinds: ["chunk.extraction-started", "chunk.extraction-completed"]
    });
    expect(events.map((event) => event.kind)).toEqual([
      "chunk.extraction-started",
      "chunk.extraction-completed"
    ]);
  });

  it("repairs JSON wrapped in markdown fences", async () => {
    const atlas = createTestAtlasProvider("es", []);
    const result = await extractChunks({
      sceneText: createSceneText(),
      lang: "es",
      atlas,
      llmClient: createMockClient(
        [
          "```json",
          JSON.stringify({
            chunks: [
              {
                normalizedForm: "de_vez_en_cuando",
                surfaceForms: ["de vez en cuando"],
                cefrBand: "A2",
                constituentLemmas: ["vez", "cuando"],
                rationale: "Fixed temporal phrase."
              }
            ]
          }),
          "```"
        ].join("\n")
      )
    });

    expect(result.failure).toBeUndefined();
    expect(result.chunks).toHaveLength(1);
  });

  it("returns an empty result and failure metadata when the client throws", async () => {
    const atlas = createTestAtlasProvider("es", []);
    const telemetry = new MemoryTelemetrySink();
    const llmClient: SugarlangLLMClient = {
      generate: vi.fn(async () => {
        throw new Error("rate limited");
      })
    };

    const result = await extractChunks({
      sceneId: "scene-1",
      contentHash: "hash-1",
      sceneText: createSceneText(),
      lang: "es",
      atlas,
      telemetry,
      llmClient
    });

    expect(result.chunks).toEqual([]);
    expect(result.failure).toEqual({
      code: "extractor_request_failed",
      message: "rate limited"
    });

    const events = await telemetry.query({
      eventKinds: ["chunk.extraction-failed"]
    });
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: "chunk.extraction-failed",
        sceneId: "scene-1"
      })
    );
  });

  it("exports a stable prompt template", () => {
    const atlas = createTestAtlasProvider("es", []);
    const prompt = buildExtractChunksPrompt(createSceneText(), "es", atlas);

    expect(EXTRACTOR_PROMPT_VERSION).toBe("1");
    expect(prompt).toMatchInlineSnapshot(`
      {
        "system": "You are annotating scene-authored language-learning metadata.
      Return JSON only.
      Identify multi-word idioms, fixed collocations, and formulaic chunks that appear verbatim in the provided scene text.
      Grade each chunk by CEFR band as a communicative unit, not by the hardest constituent lemma.
      Do not invent chunks that are not present in the text.
      Favor idiomatic or formulaic sequences over arbitrary adjacent words.
      Each chunk needs normalizedForm, surfaceForms observed in the text, cefrBand, constituentLemmas, and a short rationale.",
        "user": "promptVersion: 1
      targetLanguage: es
      atlasVersion: test-atlas-v1
      Output schema:
      {"type":"object","additionalProperties":false,"required":["chunks"],"properties":{"chunks":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["normalizedForm","surfaceForms","cefrBand","constituentLemmas","rationale"],"properties":{"normalizedForm":{"type":"string","minLength":1},"surfaceForms":{"type":"array","items":{"type":"string","minLength":1}},"cefrBand":{"enum":["A1","A2","B1","B2","C1","C2"]},"constituentLemmas":{"type":"array","items":{"type":"string","minLength":1}},"rationale":{"type":"string","minLength":1}}}}}}

      Scene text:
      [dialogue] dialogue-1:node-1
      Voy de vez en cuando al mercado.",
      }
    `);
  });
});
