/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/competency-standing-in-prompt.test.ts
 *
 * Purpose: Pins that the Teacher can tell a competency the learner has met from
 *   one they have not, and can see how often each has recurred -- and that the
 *   prompt says none of it in the language of a recommendation.
 *
 * Relationships:
 *   - Exercises formatLearnerSummary via buildTeacherPrompt.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { buildTeacherPrompt } from "../../runtime/teacher/prompt-builder";
import { createTeacherContext } from "./test-helpers";
import { createLemmaCard } from "../learner/test-helpers";
import type { LearnerProgress } from "../../runtime/learner/learner-progress";

function promptWith(state?: LearnerProgress): string {
  return buildTeacherPrompt(
    createTeacherContext(state ? { learnerProgress: state } : {})
  ).user;
}

const STATE: LearnerProgress = {
  met: [
    { competencyId: "greet", encounterCount: 4 },
    { competencyId: "thank", encounterCount: 0 }
  ],
  unmetCompetencyIds: ["ask-where", "buy"],
  dueItemIds: ["queso"],
  isColdStart: false,
  sceneId: "scene-station",
  conversationId: "conv-1"
};

describe("the Teacher can see where the learner stands on the curriculum", () => {
  it("THE POINT: met and not-yet-met are distinguishable", () => {
    // Before this, the prompt listed every competency the curriculum could
    // teach and nothing at all about which ones this learner had seen.
    const prompt = promptWith(STATE);
    expect(prompt).toContain("- competencies met:");
    expect(prompt).toContain("greet");
    expect(prompt).toContain("- competencies not yet met:");
    expect(prompt).toContain("ask-where");
  });

  it("says the count is SITUATIONS, because that is what is counted", () => {
    // The ledger counts distinct (npc, scene, day) slots, so five encounters
    // with one NPC in one room is 1. Wording it as "seen 4x" would read as
    // four repetitions and overstate a learner who has met it in one place.
    expect(promptWith(STATE)).toContain("greet (met in 4 situations)");
  });

  it("reports a met competency with no recurrences as zero, not as missing", () => {
    // Met-but-never-seen-again is a real state and a useful one. Dropping it
    // would read as never taught.
    expect(promptWith(STATE)).toContain("thank (met in 0 situations)");
  });

  it("does not say 1 situations", () => {
    expect(
      promptWith({ ...STATE, met: [{ competencyId: "greet", encounterCount: 1 }] })
    ).toContain("greet (met in 1 situation)");
  });

  it("says nothing about what to teach", () => {
    // The prompt carries counts. Ranking, priority and "needs N more" are
    // judgements, and the Teacher makes those against the situation.
    const prompt = promptWith(STATE);
    for (const banned of ["priority", "teachReason", "needs ", "recommend"]) {
      expect(prompt).not.toContain(banned);
    }
  });

  it("distinguishes unknown from nothing-met", () => {
    // A caller with no curriculum state has not learned that the learner has
    // met nothing -- it has learned nothing. Those are different claims and
    // collapsing them would tell the Teacher a falsehood about a new player.
    expect(promptWith()).toContain("- competencies met: (unknown)");
    expect(
      promptWith({ ...STATE, met: [], unmetCompetencyIds: ["greet"] })
    ).toContain("- competencies met: (none)");
  });
});

describe("competency cards reach the learner state, by name", () => {
  /** A learner who met a greeting, engaged with it, and then let it fade. */
  function withFadedGreeting() {
    return buildTeacherPrompt(
      createTeacherContext({
        learner: {
          ...createTeacherContext().learner,
          lemmaCards: {
            "exponent:hola": createLemmaCard("exponent:hola", "A1", {
              retrievability: 0.4,
              reviewCount: 2,
              lapseCount: 1,
              lastReviewedAt: 5_000
            }),
            queso: createLemmaCard("queso", "A1", {
              retrievability: 0.3,
              reviewCount: 1,
              lastReviewedAt: 1_000
            })
          }
        }
      })
    ).user;
  }

  it("THE POINT: a competency the learner is forgetting appears in top due", () => {
    // The lists dropped every `exponent:` card, so the Teacher could see that a
    // learner was losing the word for cheese but not that they were losing how
    // to greet someone -- which is the half it can do more about.
    expect(withFadedGreeting()).toMatch(/- top due:.*Greet/);
  });

  it("names it readably, never as a card key", () => {
    const prompt = withFadedGreeting();
    expect(prompt).toContain("Greet: hola");
    expect(prompt).not.toContain("exponent:hola");
  });

  it("shows it in recently active too", () => {
    expect(withFadedGreeting()).toMatch(/- recently active:.*Greet/);
  });

  it("still shows words, which never stopped working", () => {
    expect(withFadedGreeting()).toMatch(/- top due:.*queso/);
  });

  it("counts both kinds, since the line no longer means words only", () => {
    expect(withFadedGreeting()).toContain("- cards: 2");
  });
});
