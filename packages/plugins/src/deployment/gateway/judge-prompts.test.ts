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
import { buildJudgeUserPrompt, enforceLanguageReportingOnly } from "./core";

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

describe("the language dimension is REPORTING ONLY (sugarmagic-latency-tsg phase 1)", () => {
  const prompt = buildJudgeUserPrompt(
    BASE_PARAMS.worldPremise,
    BASE_PARAMS.personaDigest,
    BASE_PARAMS.responseIntent,
    BASE_PARAMS.worldContext,
    BASE_PARAMS.loreContextLines,
    BASE_PARAMS.replyText,
    ["The player reads Spanish at CEFR A1."]
  );

  it("THE ONE THAT MATTERS: language sits OUTSIDE the numbered rubric", () => {
    // The rubric's preamble says "each must PASS for overall pass". A fourth
    // NUMBERED item would therefore gate the turn -- and phase 1 measures
    // before it trusts. The anti-goal is recreating the every-turn repair
    // with a smarter judge.
    expect(prompt).toContain("FOR REPORTING ONLY");
    expect(prompt).not.toContain("4. LANGUAGE");

    const rubricStart = prompt.indexOf("Rubric (each must PASS");
    const languageStart = prompt.indexOf("LANGUAGE FIT:");
    const safetyStart = prompt.indexOf("3. SAFETY:");
    expect(rubricStart).toBeGreaterThan(-1);
    // After the last numbered item, so it cannot read as part of the list.
    expect(languageStart).toBeGreaterThan(safetyStart);
  });

  it("tells the judge explicitly not to let language change the verdict", () => {
    expect(prompt).toContain("must NOT change 'passed'");
    expect(prompt).toContain("a language problem is NOT a violation");
  });

  it("judges against the player's level, not against fluent-speaker taste", () => {
    expect(prompt).toContain("not against what sounds natural to a fluent speaker");
  });

  it("does not reintroduce language mixing as a fault", () => {
    // The whole design mixes languages on purpose. A judge flagging that would
    // fail essentially every turn.
    expect(prompt).toContain("Mixing the two languages is never itself a language problem");
  });
});

describe("sugaragent stands alone: no language plugin, no language prompt", () => {
  // sugaragent is a general-purpose NPC dialogue system. sugarlang is optional.
  // A game running sugaragent WITHOUT any language plugin must get the plain
  // rubric it has always got -- not a judge quietly assuming a
  // language-learning game and asking about a player level nobody stated.
  const prompt = buildJudgeUserPrompt(
    BASE_PARAMS.worldPremise,
    BASE_PARAMS.personaDigest,
    BASE_PARAMS.responseIntent,
    BASE_PARAMS.worldContext,
    BASE_PARAMS.loreContextLines,
    BASE_PARAMS.replyText,
    []
  );

  it("THE BOUNDARY: no directives means no language section at all", () => {
    expect(prompt).not.toContain("LANGUAGE FIT");
    expect(prompt).not.toContain("FOR REPORTING ONLY");
    expect(prompt).not.toContain("languageFit");
  });

  it("never mentions a player level nobody supplied", () => {
    expect(prompt).not.toContain("player's stated level");
    expect(prompt).not.toContain("the directives above");
  });

  it("still gets the full three-item rubric and the tool instruction", () => {
    expect(prompt).toContain("1. IN-CHARACTER:");
    expect(prompt).toContain("2. WORLD-GROUNDED:");
    expect(prompt).toContain("3. SAFETY:");
    expect(prompt).toContain("Use the score_reply tool.");
  });
});

describe("reporting-only is enforced in code, because the judge ignores the prompt", () => {
  // MEASURED, NOT HYPOTHETICAL. Against the live gateway an all-English reply
  // came back as { passed: false, violations: ["LANGUAGE_FIT"] } despite the
  // prompt saying a language problem is not a violation and the tool schema
  // saying it must not be listed. Every such turn would have gone to
  // Regenerate -- the exact outcome phase 1 exists to avoid.

  it("THE ONE THAT MATTERS: a language-only failure does not fail the turn", () => {
    const result = enforceLanguageReportingOnly(false, ["LANGUAGE_FIT"], "Add some Spanish.");

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.languageOnlyFailure).toBe(true);
  });

  it("drops the repair hint too -- there is nothing to repair", () => {
    // RegenerateStage reads repairHint verbatim; a surviving hint would
    // describe a problem that is not gating.
    const result = enforceLanguageReportingOnly(false, ["LANGUAGE_FIT"], "Add some Spanish.");
    expect(result.repairHint).toBeNull();
  });

  it("a REAL violation still fails, and keeps its hint", () => {
    const result = enforceLanguageReportingOnly(false, ["SAFETY"], "Stop mentioning the developer.");

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["SAFETY"]);
    expect(result.repairHint).toBe("Stop mentioning the developer.");
  });

  it("a real violation ALONGSIDE a language one still fails, language stripped", () => {
    // The dangerous middle case: language must not rescue a genuinely bad reply.
    const result = enforceLanguageReportingOnly(false, ["SAFETY", "LANGUAGE_FIT"], "Fix it.");

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["SAFETY"]);
    expect(result.languageOnlyFailure).toBe(false);
    expect(result.repairHint).toBe("Fix it.");
  });

  it("fails closed when the judge fails a reply but names no violation", () => {
    // No evidence it was about language, so it is not treated as language.
    const result = enforceLanguageReportingOnly(false, [], null);
    expect(result.passed).toBe(false);
  });

  it("catches label variants, not just the exact string", () => {
    // The judge invents its own labels; matching one spelling would leak.
    for (const label of ["LANGUAGE_FIT", "LANGUAGE", "language-fit", "Language Appropriateness"]) {
      expect(enforceLanguageReportingOnly(false, [label], null).passed).toBe(true);
    }
  });

  it("leaves a passing verdict completely alone", () => {
    const result = enforceLanguageReportingOnly(true, [], null);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
