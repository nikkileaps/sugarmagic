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
import {
  buildTeacherPrompt,
  formatAvailableCompetencies
} from "../../runtime/teacher/prompt-builder";
import { loadCompetencyInventory } from "../../runtime/inventory/competency-inventory-loader";
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

describe("the curriculum half is shared; the learner half is not", () => {
  it("THE ONE THAT MATTERS: EVERY cached block is identical for two different learners", () => {
    // A cache entry is matched by the exact bytes of the prefix. If anything
    // learner-specific reached a cached block, every player would get their own
    // entry -- each a fresh write, costing more than not caching -- and one
    // player's state would sit in bytes another player hits.
    const blocksFor = (progress: LearnerProgress) =>
      buildTeacherPrompt(createTeacherContext({ learnerProgress: progress }))
        .systemBlocks.filter((block) => block.cache)
        .map((block) => block.text);

    expect(
      blocksFor({ ...STATE, met: [{ competencyId: "greet", encounterCount: 9 }] })
    ).toEqual(blocksFor({ ...STATE, met: [], unmetCompetencyIds: [] }));
  });

  it("the curriculum half is identical for two different learners", () => {
    // This half is destined for a cache shared by every player at a language
    // (222.9). Anything learner-specific in it would be wrong for everyone who
    // is not the player it was built for, so the split has to hold BEFORE the
    // caching is wired -- otherwise the first cache hit ships one learner's
    // state to another.
    const a = formatAvailableCompetencies(
      createTeacherContext({
        learnerProgress: {
          ...STATE,
          met: [{ competencyId: "greet", encounterCount: 9 }]
        }
      })
    );
    const b = formatAvailableCompetencies(
      createTeacherContext({
        learnerProgress: { ...STATE, met: [], unmetCompetencyIds: [] }
      })
    );
    expect(a).toBe(b);
  });

  it("groups every competency under its lesson, and invents none", () => {
    const inventory = loadCompetencyInventory("es");
    const rendered = formatAvailableCompetencies(createTeacherContext());
    const known = new Set(inventory.competencies.map((c) => c.competencyId));

    // Every id the Teacher is shown is one it may legally answer with.
    const listed = rendered
      .split("\n")
      .filter((line) => line.startsWith("  "))
      .flatMap((line) => line.trim().split(", "))
      .filter(Boolean);
    expect(listed.filter((id) => !known.has(id))).toEqual([]);

    // ...and nothing was silently dropped by the grouping.
    expect(new Set(listed).size).toBe(known.size);

    // Lesson headings are present and readable.
    for (const lesson of inventory.lessons) {
      expect(rendered).toContain(
        `${lesson.band}.${lesson.ordinal} ${lesson.displayName}`
      );
    }
  });

  it("drops the can-do descriptors, which were most of the cost", () => {
    const rendered = formatAvailableCompetencies(createTeacherContext());
    expect(rendered).toContain("greet");
    expect(rendered).not.toContain("Can greet someone and respond to a greeting");
  });
});

describe("the Teacher can see where the learner stands on the curriculum", () => {
  it("THE POINT: met and not-yet-met are distinguishable", () => {
    // Before this, the prompt listed every competency the curriculum could
    // teach and nothing at all about which ones this learner had seen.
    //
    // The unmet list used to be printed here as well, which restated the whole
    // curriculum twice. Now the learner half names only what was MET, the
    // curriculum half lists everything grouped by lesson, and the Teacher joins
    // the two -- so unmet is "in the curriculum, absent from the met line".
    const whole = buildTeacherPrompt(
      createTeacherContext({ learnerProgress: STATE })
    );
    const prompt = whole.user;
    const metLine = prompt
      .split("\n")
      .find((line) => line.startsWith("- competencies met:"));

    expect(metLine).toBeDefined();
    expect(metLine).toContain("greet");
    expect(metLine).not.toContain("ask-where");
    // ...and it is still offered to the Teacher -- in the cached curriculum
    // half now (222.9), which is why this looks at the whole prompt.
    expect(whole.system).toContain("ask-where");
    expect(prompt).not.toContain("competencies not yet met");
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
    // The learner-state block carries counts. Ranking, priority and "needs N
    // more" are judgements, and the Teacher makes those against the situation.
    //
    // Scoped to that block rather than the whole prompt: the curriculum
    // legitimately contains the English word, in `ask-what-someone-needs`
    // ("Can ask what someone needs"), so searching the whole prompt for
    // "needs " now matches a competency name instead of a verdict.
    const prompt = promptWith(STATE);
    const start = prompt.indexOf("LEARNER STATE:");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = prompt.slice(start + 1);
    const nextBlock = rest.search(/\n[A-Z][A-Z -]+:/);
    const learnerState = nextBlock === -1 ? rest : rest.slice(0, nextBlock);

    for (const banned of ["priority", "teachReason", "needs ", "recommend"]) {
      expect(learnerState, `learner state must not contain "${banned}"`).not.toContain(banned);
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
