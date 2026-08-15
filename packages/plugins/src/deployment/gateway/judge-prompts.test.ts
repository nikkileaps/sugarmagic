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
import {
  buildJudgeUserPrompt,
  buildLanguageToolFields,
  enforceLanguageReportingOnly
} from "./core";

// The prompt the writer was given, passed through verbatim (#185). Standing in
// for a real one: identity, core knowledge, and the conversation -- exactly
// the material the judge used to be denied.
const CONTEXT = [
  "Speak as Finnick.",
  "Who you are (persona):",
  "A weather-beaten fisherman, gruff but kind.",
  "What you know (your life and immediate world):",
  "Finnick owns a boat and sells his catch on the quay at Wordlark Hollow.",
  "Recent history:",
  "user: Do you sell fish?"
].join("\n");

const BASE_PARAMS = {
  context: CONTEXT,
  replyText: "Aye, the nets were heavy this morning.",
  externalDirectives: [] as string[]
};

describe("buildJudgeUserPrompt -- no directives (084.2 byte-identical baseline)", () => {
  it("contains world premise, persona summary, rubric, and score_reply tool instruction", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.context,
      BASE_PARAMS.replyText,
      []
    );
    expect(prompt).toContain(CONTEXT);
    expect(prompt).toContain(BASE_PARAMS.replyText);
    expect(prompt).toContain("1. IN-CHARACTER:");
    expect(prompt).toContain("2. WORLD-GROUNDED:");
    expect(prompt).toContain("3. SAFETY:");
    expect(prompt).toContain("Use the score_reply tool.");
  });

  it("empty directives array produces the same prompt as no directives (byte-identical)", () => {
    const withEmpty = buildJudgeUserPrompt(
      BASE_PARAMS.context,
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
      BASE_PARAMS.context,
      BASE_PARAMS.replyText,
      [directive]
    );
    expect(prompt).toContain(
      "Established directives from game systems (in-world by definition; behavior they direct is never an IN-CHARACTER violation):"
    );
    expect(prompt).toContain(directive);
  });

  it("directive block appears between the writer prompt and the reply", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.context,
      BASE_PARAMS.replyText,
      [directive]
    );
    const contextIdx = prompt.indexOf(CONTEXT);
    const directiveIdx = prompt.indexOf("Established directives");
    const replyIdx = prompt.indexOf("NPC reply to score:");
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(directiveIdx).toBeGreaterThan(contextIdx);
    expect(replyIdx).toBeGreaterThan(directiveIdx);
  });

  it("includes the SAFETY-override prohibition in the directive block", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.context,
      BASE_PARAMS.replyText,
      [directive]
    );
    expect(prompt).toContain("Directives never override the SAFETY rule.");
  });

  it("rubric 1 gains the IN-CHARACTER guard sentence", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.context,
      BASE_PARAMS.replyText,
      [directive]
    );
    expect(prompt).toContain(
      "Behavior directed by an established directive above is never an IN-CHARACTER violation."
    );
  });

  it("rubric 1 guard is scoped to IN-CHARACTER only -- SAFETY rubric is unchanged", () => {
    const prompt = buildJudgeUserPrompt(
      BASE_PARAMS.context,
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
      BASE_PARAMS.context,
      BASE_PARAMS.replyText,
      ["First directive.", "Second directive."]
    );
    expect(prompt).toContain("1. First directive.");
    expect(prompt).toContain("2. Second directive.");
  });
});

describe("the language dimension is REPORTING ONLY (sugarmagic-latency-tsg phase 1)", () => {
  const prompt = buildJudgeUserPrompt(
    BASE_PARAMS.context,
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
    BASE_PARAMS.context,
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

describe("mini-review fixes: the language dimension cannot void a real verdict", () => {
  it("THE HOLE: a SAFETY violation that merely MENTIONS language still fails", () => {
    // /language/i over the whole label matched this, stripped it, called it a
    // language-only failure and force-flipped passed to true -- so a genuine
    // safety failure would have shipped. `violations` is an unconstrained
    // string array and the judge writes free text, so this is reachable.
    const result = enforceLanguageReportingOnly(
      false,
      ["SAFETY: crude language about the developer"],
      "Remove it."
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["SAFETY: crude language about the developer"]);
    expect(result.repairHint).toBe("Remove it.");
  });

  it("an IN-CHARACTER violation about formal language still fails", () => {
    const result = enforceLanguageReportingOnly(
      false,
      ["IN-CHARACTER: language too formal for this NPC"],
      null
    );
    expect(result.passed).toBe(false);
  });

  it("still catches the real language labels", () => {
    for (const label of ["LANGUAGE_FIT", "LANGUAGE", "language-fit", "Language appropriateness"]) {
      expect(enforceLanguageReportingOnly(false, [label], null).passed).toBe(true);
    }
  });
});

describe("mini-review fix: no language plugin, no language fields to answer", () => {
  it("THE BOUNDARY: the tool schema omits the language fields without directives", () => {
    // They used to be unconditionally required, so a game with no language
    // plugin had to answer a question its prompt never asked -- and the client
    // gates on languageFit === false, so an invented answer could fail a turn
    // in a game with no notion of language.
    const { properties, required } = buildLanguageToolFields(false);

    expect(properties).toEqual({});
    expect(required).toEqual([]);
  });

  it("and includes them when a language plugin did contribute", () => {
    const { properties, required } = buildLanguageToolFields(true);

    expect(Object.keys(properties).sort()).toEqual(["languageFit", "languageNote"]);
    expect(required).toEqual(["languageFit", "languageNote"]);
  });
});
