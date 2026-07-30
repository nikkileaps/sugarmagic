/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/competency-on-the-slate.test.ts
 *
 * Purpose: Pins that a COMPETENCY can be taught -- named by the Teacher, parsed,
 *   survived through repair, and rendered to the NPC.
 *
 * WHY THIS FILE EXISTS
 *   Competency teaching has never had an end-to-end test, and that is exactly
 *   how it kept nearly disappearing. Before 090.4 a competency could only reach
 *   teaching by being flattened into a `chunk:` pseudo-lemma and smuggled
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
import { buildGeneratorPromptOverlay } from "../../runtime/middlewares/generator-prompt-overlay";
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
    learnerCefr: "B1",
    rawPrescription: {
      introduce: [],
      reinforce: [],
      avoid: [],
      budget: { newItemsAllowed: 2 },
      rationale: { summary: "test", candidateSetSize: 0, envelopeSurvivorCount: 0, priorityScores: [], reasons: [] }
    }
  } as unknown as SugarlangConstraint;
}

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
