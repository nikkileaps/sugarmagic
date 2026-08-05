/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/competency-on-the-slate.test.ts
 *
 * Purpose: Pins that a COMPETENCY can be taught -- named by the Teacher, parsed,
 *   survived through repair, and rendered to the NPC.
 *
 * WHY THIS FILE EXISTS
 *   Competency teaching has never had an end-to-end test, and that is exactly
 *   how it kept nearly disappearing. Before 090.4 a competency could only reach
 *   teaching by being flattened into a `exponent:` pseudo-lemma and smuggled
 *   through the lemma channel; removing the prescription block from the prompt
 *   severed that channel instantly and NOTHING failed.
 *
 *   These assertions are the ones that would have caught it.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises the teachable-ref contract, the directive schema, repair, and
 *     the generator prompt overlay together.
 *
 * Implements: Plan 090 story 090.4
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { parseDirective, repairDirective } from "../../runtime/teacher/schema-parser";
import {
  buildTeacherPrompt,
  formatAvailableCompetencies
} from "../../runtime/teacher/prompt-builder";
import { buildGeneratorPromptOverlay } from "../../runtime/middlewares/generator-prompt-overlay";
import { createCompetencyDescriber } from "../../runtime/inventory/describe-competency";
import { getIntroduceCapForBand } from "../../runtime/teacher/band-envelope";
import {
  competencyRefs,
  vocabularyRefs,
  type TeachableRef
} from "../../runtime/contracts/teachable-ref";
import type { SugarlangConstraint } from "../../runtime/types";
import { createDirectiveFixture, createTeacherContext } from "./test-helpers";

const ASK_WHERE: TeachableRef = {
  kind: "competency",
  competencyId: "ask-where",
  lang: "es"
};
const QUESO: TeachableRef = { kind: "vocabulary", lemmaId: "queso", lang: "es" };

function constraintWith(introduce: TeachableRef[]): SugarlangConstraint {
  return {
    generatorPromptOverlay: "",
    minimalGreetingMode: false,
    targetVocab: { introduce, reinforce: [], avoid: [] },
    supportPosture: "target-dominant",
    targetLanguageRatio: 0.85,
    interactionStyle: "natural_dialogue",
    glossingStrategy: "none",
    sentenceComplexityCap: "free",
    targetLanguage: "es",
    supportLanguage: "en",
    learnerCefr: "B1"
  } as unknown as SugarlangConstraint;
}

describe("the Teacher is told which competencies exist", () => {
  // 090.10: the schema has accepted a competencyId since 090.4a, but the prompt
  // never said which ids are real -- so naming one meant guessing, and in
  // practice competencies arrived by being flattened into
  // `prescription.introduce` instead. That road is what 090.10 deletes, so
  // showing the real ids is the precondition for deleting it safely.
  it("lists real competency ids, in the CACHED half", () => {
    // 222.9 moved the curriculum out of the per-turn half. It is identical on
    // every call for a language, so there it could never be cached -- and it
    // was the largest single thing in the turn.
    const prompt = buildTeacherPrompt(createTeacherContext());

    expect(prompt.system).toContain("COMPETENCIES THIS CURRICULUM CAN TEACH:");
    expect(prompt.system).toContain("ask-where");
    expect(prompt.user).not.toContain("COMPETENCIES THIS CURRICULUM CAN TEACH:");

    const curriculum = prompt.systemBlocks.find((block) =>
      block.text.includes("COMPETENCIES THIS CURRICULUM CAN TEACH:")
    );
    expect(curriculum?.cache).toBe(true);
  });

  it("names them as the only valid ids, so the model does not invent one", () => {
    // Asserted against the prompt STRING. A mock gateway cannot falsify prompt
    // content -- it returns whatever it was told to regardless of what was asked.
    expect(formatAvailableCompetencies(createTeacherContext())).toContain(
      "Never invent one"
    );
  });

  it("carries the descriptor, not just the id", () => {
    // A bare id does not say what the learner would be able to DO. Since 222.7
    // the meaning is carried by the LESSON HEADING the id sits under rather
    // than by a descriptor beside it -- `A1.9 Places and Directions` over
    // `ask-where` says as much as the can-do sentence did, for a fifth of the
    // tokens.
    //
    // Pinned to A1: `ask-where` is A1 and the band window hides it from the A2
    // fixture learner.
    const base = createTeacherContext();
    const section = formatAvailableCompetencies({
      ...base,
      learner: { ...base.learner, estimatedCefrBand: "A1" }
    });
    const askWhere = section
      .split("\n")
      .find((line) => line.includes("ask-where"));

    expect(askWhere).toBeDefined();
    // The heading above it is what carries the meaning now.
    expect(section).toContain("Places and Directions");
  });
});

describe("a competency can be taught", () => {
  it("parses out of a directive naming one", () => {
    // The schema used to accept only LemmaRef, so this JSON was rejected and a
    // competency was literally unsayable by the Teacher.
    const json = JSON.stringify({
      ...createDirectiveFixture(),
      targetVocab: { introduce: [ASK_WHERE], reinforce: [], avoid: [] }
    });

    const result = parseDirective(json, { context: createTeacherContext() });

    expect("directive" in result).toBe(true);
    if (!("directive" in result)) return;
    expect(competencyRefs(result.directive.targetVocab.introduce)).toEqual([ASK_WHERE]);
  });

  it("survives repair rather than being filtered out", () => {
    // Repair is the path a malformed directive takes, and it used to filter
    // targetVocab against the prescription -- which never contained a
    // competency, so repair silently ate it.
    const repaired = repairDirective(
      { targetVocab: { introduce: [ASK_WHERE, QUESO], reinforce: [], avoid: [] } },
      createTeacherContext()
    );

    expect(competencyRefs(repaired.targetVocab.introduce).map((r) => r.competencyId)).toEqual([
      "ask-where"
    ]);
    expect(vocabularyRefs(repaired.targetVocab.introduce).map((r) => r.lemmaId)).toEqual([
      "queso"
    ]);
  });

  it("reaches the NPC's prompt", () => {
    // Rendering is where a competency would vanish most quietly: the overlay
    // used to map every ref through `.lemmaId`, which is undefined on a
    // competency. It would have printed nothing at all.
    const overlay = buildGeneratorPromptOverlay(constraintWith([ASK_WHERE, QUESO]));

    expect(overlay).toContain("queso");
    expect(overlay).toContain("ask-where");
  });

  it("the REAL describer turns an id into something an NPC can perform", () => {
    // Found in play: the overlay's describer parameter was never passed, so a
    // competency reached the generator as `greeting-informal` -- an id it cannot
    // act on. The NPC said "hola" because it would have anyway, and nothing was
    // taught. The seam existed and was unconnected, which is worse than absent
    // because it looked finished.
    //
    // Against the SHIPPED inventory, not a fixture: the claim is about what the
    // real curriculum can describe.
    const describe = createCompetencyDescriber("es");
    const overlay = buildGeneratorPromptOverlay(
      constraintWith([{ kind: "competency", competencyId: "greet", lang: "es" }]),
      describe
    );

    // The descriptor comes from the authored curriculum, which is the only
    // place one is written now -- the inventory is generated from it.
    expect(overlay).toContain("Can greet someone and respond to a greeting");
    expect(overlay).toContain("hola");
    expect(overlay).not.toContain("Introduce vocabulary (try to use naturally this turn, not their English translations): greet.");
  });

  it("caps how much of the slate reaches one NPC turn", () => {
    // The slate is a working set for a whole situation; a single line cannot
    // carry it. Uncapped, the generator receives a list of words to "use
    // naturally" and writes a sentence that is a list.
    //
    // The cap belongs here rather than on what the Teacher may choose -- the
    // Teacher's job is deciding what the situation affords, not rationing it.
    const six: TeachableRef[] = ["queso", "barca", "oficio", "saludo", "maleta", "billete"].map(
      (lemmaId) => ({ kind: "vocabulary" as const, lemmaId, lang: "es" })
    );
    // 090.10: each teachable is now its own `- ` line rather than a comma join,
    // so the section spans lines. Counts the bullets between the Introduce
    // header and the instruction paragraph that closes it.
    function introducedCount(text: string): number {
      const lines = text.split("\n");
      const after = lines.slice(
        lines.findIndex((line) => line.startsWith("Introduce (")) + 1
      );
      const end = after.findIndex((line) => !line.startsWith("- "));
      return after.slice(0, end === -1 ? undefined : end).length;
    }

    // The cap is PER BAND, from a single table (`getIntroduceCapForBand`).
    // Asserting TWO bands deliberately: one assertion passes just as well
    // against a flat constant, which is exactly what this was -- while a
    // different per-band curve lived in the fallback policy and disagreed.
    expect(introducedCount(buildGeneratorPromptOverlay(constraintWith(six)))).toBe(
      getIntroduceCapForBand("B1")
    );
    expect(
      introducedCount(
        buildGeneratorPromptOverlay({
          ...constraintWith(six),
          learnerCefr: "A1"
        })
      )
    ).toBe(getIntroduceCapForBand("A1"));
    expect(getIntroduceCapForBand("A1")).toBeLessThan(getIntroduceCapForBand("B1"));
  });

  it("degrades to the id rather than dropping the competency", () => {
    // A missing inventory must leave an unhelpful id in the prompt, never remove
    // the competency -- those look the same in the output and mean opposite
    // things.
    const describe = createCompetencyDescriber("xx-not-a-language");
    const overlay = buildGeneratorPromptOverlay(constraintWith([ASK_WHERE]), describe);

    expect(overlay).toContain("ask-where");
  });

  it("renders a competency by description when the caller can resolve one", () => {
    // A bare id tells an NPC nothing. The caller owns the inventory, so it
    // supplies the description; absent one the id still appears rather than the
    // competency disappearing.
    const overlay = buildGeneratorPromptOverlay(constraintWith([ASK_WHERE]), (ref) =>
      ref.competencyId === "ask-where" ? "ask where something is (donde esta)" : ref.competencyId
    );

    expect(overlay).toContain("ask where something is (donde esta)");
  });
});
