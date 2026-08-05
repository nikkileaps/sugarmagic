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
import { INFLECT_SLATED_WORDS_PROMPT } from "../../runtime/teacher/slate-prompt";

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
    inventoryExponents: []
  });
}

describe("GradedTextService", () => {
  it("090.11: an A1 bake is told to write MOSTLY ENGLISH, not mostly Spanish", () => {
    // THE BUG THIS PINS, found in play 2026-07-31: an A1 variant came back
    // 100% Spanish. The prompt said "predominantly or entirely in the target
    // language" for EVERY band, unconditionally, while posture and ratio were
    // passed only to the VERIFIER. The model was told to write full target
    // language and then measured against a rule it had never been shown.
    //
    // The old snapshot tests passed throughout, because they asserted the
    // hardcoded sentence rather than the relationship between band and
    // instruction. Asserting the RELATIONSHIP is what makes this catchable.
    const anchored = buildAdaptationPrompt({
      sourceText: "Thanks! I need to find my suitcase. Do you know where it is?",
      targetLang: "es",
      band: "A1",
      posture: "anchored",
      directedRatio: 0.3
    });

    expect(anchored.system).toContain("mostly in the support language (English)");
    expect(anchored.system).toContain("30%");
    expect(anchored.system).not.toContain("predominantly or entirely");
  });

  it("090.11: the same builder still directs a B1+ bake to the target language", () => {
    // The fix must not flip the other direction. target-dominant still means
    // mostly Spanish -- the bug was that EVERY band was told that.
    const dominant = buildAdaptationPrompt({
      sourceText: "Thanks! I need to find my suitcase.",
      targetLang: "es",
      band: "B1",
      posture: "target-dominant",
      directedRatio: 0.85
    });

    // The DISPLAY name: "Write mostly in es" was a language tag standing in for
    // an instruction to a writer. What this pins is the direction and the
    // ratio, not which spelling of the language name got used.
    expect(dominant.system).toContain("mostly in Spanish");
    expect(dominant.system).toContain("85%");
  });

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

  it("tells the baker a slated word is a dictionary form", () => {
    // Same defect as the agent path and the same fix, in the one module that
    // exists so both paths phrase it once. A baked line that pasted `vender`
    // in would be the same wrong Spanish, cached.
    const prompt = buildAdaptationPrompt({
      sourceText: "I sell the best cheese in town.",
      targetLang: "es",
      band: "A2",
      guidance: { register: "dialogue line" },
      teach: {
        introduce: [{ kind: "vocabulary", lemmaId: "vender", lang: "es" }],
        reinforce: [],
        avoid: []
      }
    });

    expect(prompt.user).toContain("- vender");
    expect(prompt.user).toContain(INFLECT_SLATED_WORDS_PROMPT);
  });

  it("090.11: contributes NOTHING to the prompt when there is no slate", () => {
    // THE SAFETY PROPERTY of adding a slate input. Item text and any caller
    // without a scene has no slate, and those callers' prompts must not move by
    // a single character -- otherwise adding the field silently re-bakes every
    // variant belonging to a caller that never asked to teach anything.
    //
    // A "Teach: (none)" line would look harmless and would break exactly that.
    const withoutField = buildAdaptationPrompt({
      sourceText: "Have you seen my luggage?",
      targetLang: "es",
      band: "A2",
      guidance: { register: "dialogue line" }
    });
    const withEmptySlate = buildAdaptationPrompt({
      sourceText: "Have you seen my luggage?",
      targetLang: "es",
      band: "A2",
      guidance: { register: "dialogue line" },
      teach: { introduce: [], reinforce: [], avoid: [] }
    });

    expect(withEmptySlate).toEqual(withoutField);
    expect(withEmptySlate.user).not.toContain("Teach");
  });

  it("090.11: a slate reaches the prompt as an instruction to the writer", () => {
    // The prerequisite this story turned on. Before this field the bake could
    // consume exactly one directive value -- posture -- which postureForBand
    // already derives for free, so a build-time Teacher call changed nothing.
    const prompt = buildAdaptationPrompt({
      sourceText: "Have you seen my luggage?",
      targetLang: "es",
      band: "A2",
      guidance: { register: "dialogue line" },
      teach: {
        introduce: [{ kind: "vocabulary", lemmaId: "queso", lang: "es" }],
        reinforce: [{ kind: "vocabulary", lemmaId: "hola", lang: "es" }],
        avoid: [{ kind: "vocabulary", lemmaId: "ferrocarril", lang: "es" }]
      }
    });

    expect(prompt.user).toContain("queso");
    expect(prompt.user).toContain("hola");
    expect(prompt.user).toContain("ferrocarril");
    // The authored text still has to survive; a slate steers, it does not
    // replace the line.
    expect(prompt.user).toContain("Have you seen my luggage?");
  });

  it("090.11: respects the SAME per-band introduce cap as the agent path", () => {
    // A baked line and a generated line are the same unit of text facing the
    // same learner. A beginner's line does not get to carry more teachables
    // because it happened to be written at build time -- that is how two caps
    // for one behavior start disagreeing.
    const many = Array.from({ length: 10 }, (_, i) => ({
      kind: "vocabulary" as const,
      lemmaId: `lemma${i}`,
      lang: "es"
    }));

    const a1 = buildAdaptationPrompt({
      sourceText: "Hello there.",
      targetLang: "es",
      band: "A1",
      teach: { introduce: many, reinforce: [], avoid: [] }
    });

    // getIntroduceCapForBand("A1") is 3.
    expect(a1.user).toContain("lemma2");
    expect(a1.user).not.toContain("lemma3");
  });

  it("090.11: renders a competency one-per-line so its exponents cannot absorb the next item", () => {
    // THE BUG THIS PINS, seen verbatim in a live conversation:
    //   Can greet people in a simple way. -- e.g. hola, buenos dias, queso
    // A described competency already ENDS in a comma-separated list, so joining
    // the next teachable with ", " told the NPC that `queso` was a way to greet
    // someone. The bake shares the agent path's renderer precisely so it cannot
    // re-earn this.
    const prompt = buildAdaptationPrompt(
      {
        sourceText: "Hello there.",
        targetLang: "es",
        band: "A1",
        teach: {
          introduce: [
            { kind: "competency", competencyId: "greet", lang: "es" },
            { kind: "vocabulary", lemmaId: "queso", lang: "es" }
          ],
          reinforce: [],
          avoid: []
        }
      },
      () => "Can greet people in a simple way. -- e.g. hola, buenos dias"
    );

    expect(prompt.user).toContain(
      "- Can greet people in a simple way. -- e.g. hola, buenos dias\n- queso"
    );
  });

  it("090.11: a competency with no describer degrades to its id rather than vanishing", () => {
    // Silent omission is how competency teaching disappeared once before. An id
    // in the prompt is poor; an absent item is undetectable.
    const prompt = buildAdaptationPrompt({
      sourceText: "Hello there.",
      targetLang: "es",
      band: "A1",
      teach: {
        introduce: [{ kind: "competency", competencyId: "introduce-self", lang: "es" }],
        reinforce: [],
        avoid: []
      }
    });

    expect(prompt.user).toContain("introduce-self");
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
        "system": "You are a writer for a language-learning game. Adapt the given English item description into es for a elementary (A2) learner. Adapt rather than translate: keep what the text must communicate, but re-express it within reach of a elementary (A2) learner. Write mostly in Spanish -- about 85% -- with brief support-language anchoring only where it aids comprehension. Inside a Spanish phrase, these are always Spanish, never English: yo, tú, usted, mi, tu, me, sí, no. Do NOT drop one into an otherwise English sentence -- write "I sell cheese", never "yo sell cheese". If you want one of these words, write the whole phrase around it in Spanish. When you do write a Spanish phrase, say its subject pronoun out loud rather than dropping it, even where a native speaker would leave it out, so the learner can see who is doing the action. Keep it grammatically natural for the learner level. Preserve the length and shape of the original -- a one-line item description stays one line, a paragraph stays a paragraph. Do not add glosses, translations, or explanations inline. Return only the adapted text, nothing else.",
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
        "system": "You are a writer for a language-learning game. Adapt the given English dialogue line into es for a intermediate (B1) learner. Adapt rather than translate: keep what the text must communicate, but re-express it within reach of a intermediate (B1) learner. Write mostly in Spanish -- about 85% -- with brief support-language anchoring only where it aids comprehension. Inside a Spanish phrase, these are always Spanish, never English: yo, tú, usted, mi, tu, me, sí, no. Do NOT drop one into an otherwise English sentence -- write "I sell cheese", never "yo sell cheese". If you want one of these words, write the whole phrase around it in Spanish. Keep it grammatically natural for the learner level. Preserve the length and shape of the original -- a one-line dialogue line stays one line, a paragraph stays a paragraph. Do not add glosses, translations, or explanations inline. Return only the adapted text, nothing else.",
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
