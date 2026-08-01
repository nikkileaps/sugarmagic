/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/line-intent-extractor.test.ts
 *
 * Purpose: Pins line-intent extraction -- propositions only, the hand-authored
 *   skip, and every fail-soft path. The prompt-content tests are the load-bearing
 *   ones: they guard the boundary that moved twice.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/line-intent-extractor against a fake
 *     SugarlangLLMClient. No network, no real clock.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import type {
  SugarlangLLMClient,
  SugarlangLLMRequest
} from "../../runtime/llm/types";
import {
  LineIntentExtractor,
  buildLineIntentPrompt
} from "../../runtime/compile/line-intent-extractor";

function makeExtractor(text: string) {
  const calls: SugarlangLLMRequest[] = [];
  let tick = 1000;
  const extractor = new LineIntentExtractor({
    llmClient: {
      generate: vi.fn(async (request: SugarlangLLMRequest) => {
        calls.push(request);
        return { text, requestId: "req-1" };
      })
    } as unknown as SugarlangLLMClient,
    now: () => (tick += 10)
  });
  return { extractor, calls };
}

const REQUEST = {
  nodeId: "node-1",
  dialogueDefinitionId: "dialogue-finnick",
  nodeText: "My cheese shipment never arrived.",
  contentHash: "hash-node-1"
};

describe("LineIntentExtractor", () => {
  it("extracts propositions, a beat and a voice note", async () => {
    const { extractor } = makeExtractor(
      JSON.stringify({
        mustConveyFacts: ["the cheese shipment did not arrive"],
        beat: "complaint",
        voiceNote: "anxious, clipped"
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.failure).toBeUndefined();
    expect(result.artifact.mustConveyFacts).toEqual([
      "the cheese shipment did not arrive"
    ]);
    expect(result.artifact.beat).toBe("complaint");
    expect(result.artifact.voiceNote).toBe("anxious, clipped");
    expect(result.artifact.derived).toBe(true);
  });

  it("skips the LLM entirely when all three fields are hand-authored", async () => {
    const { extractor, calls } = makeExtractor("{}");

    const result = await extractor.extract({
      ...REQUEST,
      authoredIntent: {
        mustConveyFacts: ["the ferry leaves at dawn"],
        beat: "warning",
        voiceNote: "brisk"
      }
    });

    expect(calls).toHaveLength(0);
    expect(result.artifact.derived).toBe(false);
    expect(result.artifact.extractedByModel).toBe("hand-authored");
    expect(result.artifact.reviewFlag).toBe(false);
  });

  it("still calls the LLM when the author filled only some fields", async () => {
    const { extractor, calls } = makeExtractor(
      JSON.stringify({ mustConveyFacts: [], beat: "b", voiceNote: "v" })
    );

    await extractor.extract({ ...REQUEST, authoredIntent: { beat: "warning" } });

    expect(calls).toHaveLength(1);
  });

  it("sends purpose:\"extraction\" like every other compile pass", async () => {
    const { extractor, calls } = makeExtractor(
      JSON.stringify({ mustConveyFacts: [], beat: "b", voiceNote: "v" })
    );

    await extractor.extract(REQUEST);

    expect(calls[0]?.purpose).toBe("extraction");
    expect(calls[0]?.model).toBeUndefined();
  });

  describe("fail-soft", () => {
    it.each([
      ["unparseable text", "sorry, no"],
      ["invalid json", "{ nope"],
      ["schema violation", JSON.stringify({ beat: "b" })]
    ])("keeps authored fields and flags review on %s", async (_label, text) => {
      const { extractor } = makeExtractor(text);

      const result = await extractor.extract({
        ...REQUEST,
        authoredIntent: { beat: "warning" }
      });

      expect(result.failure).toBeDefined();
      // Whatever the author DID write survives the failure.
      expect(result.artifact.beat).toBe("warning");
      expect(result.artifact.reviewFlag).toBe(true);
    });

    it("degrades rather than throwing when the gateway is down", async () => {
      let tick = 0;
      const extractor = new LineIntentExtractor({
        llmClient: {
          generate: vi.fn(async () => {
            throw new Error("502 Bad Gateway");
          })
        } as unknown as SugarlangLLMClient,
        now: () => (tick += 5)
      });

      const result = await extractor.extract(REQUEST);

      expect(result.failure?.code).toBe("intent_extractor_request_failed");
      expect(result.failure?.message).toContain("502");
      expect(result.artifact.reviewFlag).toBe(true);
    });
  });
});

describe("buildLineIntentPrompt", () => {
  it("asks for propositions and explicitly refuses vocabulary", () => {
    // THE regression this file exists for. Until 090.1 the prompt asked for
    // target-language lemmaIds whenever `targetLanguage` was supplied, and
    // production always supplied it -- so `mustConveyFacts` held vocabulary,
    // making this a teachable nominator wearing the name "intent".
    const { system } = buildLineIntentPrompt("some line");

    expect(system).toContain("PROPOSITIONS");
    // Vocabulary and dictionary forms appear only inside the PROHIBITION.
    expect(system).toContain(
      "Do NOT output vocabulary, dictionary forms, or words to teach"
    );
    expect(system).not.toMatch(/identify vocabulary/i);
    expect(system.toLowerCase()).not.toContain("lemmaid");
  });

  it("takes no target language -- intent is language-neutral", () => {
    // A proposition is about meaning, not about any language's words. If this
    // ever needs a target language again, nomination has crept back in.
    expect(Object.keys(REQUEST)).not.toContain("targetLanguage");
    const { system, user } = buildLineIntentPrompt("some line");
    expect(`${system}${user}`).not.toContain("targetLanguage");
  });

  it("carries the prompt version so a contract change invalidates the cache", () => {
    const { user } = buildLineIntentPrompt("some line", "090.1.0");

    expect(user).toContain("promptVersion: 090.1.0");
  });
});
