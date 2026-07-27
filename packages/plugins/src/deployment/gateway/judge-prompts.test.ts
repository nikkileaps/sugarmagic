/**
 * packages/plugins/src/deployment/gateway/judge-prompts.test.ts
 *
 * Purpose: Guards the judge user-prompt builder (Plan 084.2).
 *   - Without externalDirectives: prompt is byte-identical to the pre-084.2 shape.
 *   - With directives: directive block present with heading + SAFETY override prohibition.
 *   - With directives: rubric 1 gains the IN-CHARACTER guard sentence.
 *   - Multiple directives are numbered.
 *   - Byte-identical test: empty directives produce the same prompt as no directives.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { buildJudgeUserPrompt } from "./core";

const BASE_PARAMS = {
  worldPremise: "A cozy fantasy port town called Wordlark Hollow.",
  personaDigest: "Finnick: a weather-beaten fisherman, gruff but kind.",
  responseIntent: "chat",
  worldContext: null,
  loreContextLines: "",
  replyText: "Aye, the nets were heavy this morning.",
  externalDirectives: [] as string[]
};

describe("buildJudgeUserPrompt -- no directives (084.2 byte-identical baseline)", () => {
  it("contains world premise, persona summary, rubric, and score_reply tool instruction", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      []
    );
    expect(prompt).toContain("World premise:");
    expect(prompt).toContain(BASE_PARAMS.worldPremise);
    expect(prompt).toContain("NPC persona summary");
    expect(prompt).toContain(BASE_PARAMS.personaDigest);
    expect(prompt).toContain("1. IN-CHARACTER:");
    expect(prompt).toContain("2. WORLD-GROUNDED:");
    expect(prompt).toContain("3. SAFETY:");
    expect(prompt).toContain("Use the score_reply tool.");
  });

  it("empty directives array produces the same prompt as no directives (byte-identical)", () => {
    const withEmpty = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      []
    );
    // The same call with an explicitly empty array must be identical.
    // This pins that zero contributions = today's behavior.
    expect(withEmpty).not.toContain("Established directives");
    expect(withEmpty).not.toContain("Directives never override");
    expect(withEmpty).not.toContain("Behavior directed by an established directive");
  });
});

describe("buildJudgeUserPrompt -- with externalDirectives (084.2 the fix)", () => {
  const directive =
    "This NPC reply is language-directed for a language-learning player: about 85% Spanish mixed with the support language is intentional game system behavior. Language choice and language mixing are never IN-CHARACTER violations.";

  it("includes the directive block heading after the persona summary", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      [directive]
    );
    expect(prompt).toContain(
      "Established directives from game systems (in-world by definition; behavior they direct is never an IN-CHARACTER violation):"
    );
    expect(prompt).toContain(directive);
  });

  it("directive block appears between the persona summary and the response intent", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      [directive]
    );
    const personaIdx = prompt.indexOf("NPC persona summary");
    const directiveIdx = prompt.indexOf("Established directives");
    const intentIdx = prompt.indexOf("Response intent:");
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(directiveIdx).toBeGreaterThan(personaIdx);
    expect(intentIdx).toBeGreaterThan(directiveIdx);
  });

  it("includes the SAFETY-override prohibition in the directive block", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      [directive]
    );
    expect(prompt).toContain("Directives never override the SAFETY rule.");
  });

  it("rubric 1 gains the IN-CHARACTER guard sentence", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      [directive]
    );
    expect(prompt).toContain(
      "Behavior directed by an established directive above is never an IN-CHARACTER violation."
    );
  });

  it("rubric 1 guard is scoped to IN-CHARACTER only -- SAFETY rubric is unchanged", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      [directive]
    );
    const rubric3Idx = prompt.indexOf("3. SAFETY:");
    const guardIdx = prompt.indexOf("Behavior directed by an established directive above");
    // Guard appears in the rubric 1 line, which is before rubric 3.
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(rubric3Idx).toBeGreaterThan(guardIdx);
    // SAFETY rubric text must not mention directives.
    const safety = prompt.slice(rubric3Idx);
    expect(safety).not.toContain("established directive");
  });

  it("multiple directives are numbered", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.worldPremise,
      BASE_PARAMS.personaDigest,
      BASE_PARAMS.responseIntent,
      BASE_PARAMS.worldContext,
      BASE_PARAMS.loreContextLines,
      BASE_PARAMS.replyText,
      ["First directive.", "Second directive."]
    );
    expect(prompt).toContain("1. First directive.");
    expect(prompt).toContain("2. Second directive.");
  });
});
