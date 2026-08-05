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

  it("THE ONE 222.14 EXISTS FOR: the window EXCLUDES another band's competencies", () => {
    // Could not be written before A2 shipped. With A1 alone, "the learner's
    // band" was every competency that existed, so a filter would have excluded
    // nothing and this test would have passed with no filter implemented.
    //
    // Current band only, not band+1 (nikki, 2026-08-05): band+1 came from when
    // there were ten vocabulary words and getting enough teachables into a turn
    // was the constraint. A1 alone is 172 competencies now.
    const inventory = loadCompetencyInventory("es");
    const a1Only = inventory.competencies
      .filter((c) => c.band === "A1")
      .map((c) => c.competencyId);
    const a2Only = inventory.competencies
      .filter((c) => c.band === "A2")
      .map((c) => c.competencyId);
    expect(a1Only.length).toBeGreaterThan(0);
    expect(a2Only.length).toBeGreaterThan(0);

    const listFor = (band: "A1" | "A2") => {
      const base = createTeacherContext();
      return formatAvailableCompetencies({
        ...base,
        learner: { ...base.learner, estimatedCefrBand: band }
      });
    };

    const shownToA1 = listFor("A1");
    const shownToA2 = listFor("A2");
    const idsIn = (rendered: string) =>
      new Set(
        rendered
          .split("\n")
          .filter((line) => line.startsWith("  "))
          .flatMap((line) => line.trim().split(", "))
          .filter(Boolean)
      );

    // Each learner sees their own band in full...
    expect([...idsIn(shownToA1)].sort()).toEqual([...a1Only].sort());
    expect([...idsIn(shownToA2)].sort()).toEqual([...a2Only].sort());

    // ...and provably not the other one. This is the exclusion.
    for (const id of a2Only) expect(idsIn(shownToA1).has(id)).toBe(false);
    for (const id of a1Only) expect(idsIn(shownToA2).has(id)).toBe(false);
  });

  it("every band sees its own competencies and no other band's", () => {
    // All five bands are authored now, so this is the whole curriculum: 635
    // competencies, and a learner at any band sees only their own slice.
    const inventory = loadCompetencyInventory("es");
    const bands = ["A1", "A2", "B1", "B2", "C1"] as const;

    const idsIn = (rendered: string) =>
      new Set(
        rendered
          .split("\n")
          .filter((line) => line.startsWith("  "))
          .flatMap((line) => line.trim().split(", "))
          .filter(Boolean)
      );

    for (const band of bands) {
      const expected = inventory.competencies
        .filter((c) => c.band === band)
        .map((c) => c.competencyId);
      expect(expected.length, band).toBeGreaterThan(0);

      const base = createTeacherContext();
      const shown = idsIn(
        formatAvailableCompetencies({
          ...base,
          learner: { ...base.learner, estimatedCefrBand: band }
        })
      );

      expect([...shown].sort(), band).toEqual([...expected].sort());
      // ...and nothing from any other band leaked in.
      for (const other of inventory.competencies.filter((c) => c.band !== band)) {
        expect(shown.has(other.competencyId), `${band} saw ${other.band}`).toBe(false);
      }
    }
  });

  it("two learners at DIFFERENT bands get different cached bytes", () => {
    // The cached curriculum block is now keyed by band as well as language --
    // one entry per band, still shared by every player at that band. If these
    // matched, the window would not be reaching the cached half at all.
    const blocksFor = (band: "A1" | "A2") => {
      const base = createTeacherContext();
      return buildTeacherPrompt({
        ...base,
        learner: { ...base.learner, estimatedCefrBand: band }
      }).systemBlocks.map((block) => block.text);
    };
    expect(blocksFor("A1")).not.toEqual(blocksFor("A2"));
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

    // ...and nothing was silently dropped by the grouping, within the band the
    // fixture learner is at.
    const inBand = inventory.competencies.filter(
      (c) => c.band === createTeacherContext().learner.estimatedCefrBand
    );
    expect(new Set(listed).size).toBe(inBand.length);

    // Lesson headings are present and readable, for that band's lessons.
    const bandLessons = new Set(inBand.map((c) => c.lessonId));
    for (const lesson of inventory.lessons.filter((l) => bandLessons.has(l.lessonId))) {
      expect(rendered).toContain(
        `${lesson.band}.${lesson.ordinal} ${lesson.displayName}`
      );
    }
  });

  it("drops the can-do descriptors, which were most of the cost", () => {
    // Pinned to A1 because `greet` is an A1 competency and the band window
    // (222.14) rightly hides it from the A2 fixture learner. This test is
    // about descriptors, not about the window.
    const base = createTeacherContext();
    const rendered = formatAvailableCompetencies({
      ...base,
      learner: { ...base.learner, estimatedCefrBand: "A1" }
    });
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
        // Due-ness comes from `learnerProgress`, which `deriveLearnerProgress`
        // computes through `getItemProgress`. Both cards below have been
        // reviewed and have fallen well under the floor, so both are due -- but
        // the prompt reads the derived list rather than re-deciding from
        // retrievability, so the fixture has to carry it.
        learnerProgress: { ...STATE, dueItemIds: ["exponent:hola", "queso"] },
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

  it("THE ONE THAT MATTERS: a card only ever SHOWN is not reported as due", () => {
    // How the two-definitions bug got in. A card the learner has only been
    // shown is never reviewed, so it keeps the prior it was seeded with --
    // about 0.82 at their own band -- which is under the 0.95 floor forever.
    // `encountered` is the commonest observation there is, so comparing
    // retrievability directly reported most of the passive vocabulary as
    // overdue, and the Teacher was told to remind the learner of words they
    // had never been tested on.
    const base = createTeacherContext();
    const prompt = buildTeacherPrompt({
      ...base,
      // Derived through `getItemProgress`, which calls a never-reviewed card
      // `unseen`. So it is absent here even though its retrievability is low.
      learnerProgress: { ...STATE, dueItemIds: [] },
      learner: {
        ...base.learner,
        lemmaCards: {
          anden: createLemmaCard("anden", "A1", {
            retrievability: 0.82,
            reviewCount: 0,
            lastReviewedAt: null
          })
        }
      }
    }).user;

    expect(prompt).toContain("- top due: (none)");
    expect(prompt).not.toMatch(/- top due:.*anden/);
  });

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
