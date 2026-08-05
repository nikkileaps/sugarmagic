/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/stranded-items.test.ts
 *
 * Purpose: Pins the stranded-item measurements 222.13 exists to make
 *   answerable -- how long an item has been due, and that the answer is
 *   derived from the same curve that decides due-ness.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  daysOverdue,
  decayedRetrievability
} from "../../runtime/learner/fsrs-adapter";
import {
  DUE_RETRIEVABILITY_FLOOR,
  getItemProgress
} from "../../runtime/learner/item-progress";
import { createLemmaCard } from "./test-helpers";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/**
 * A card as the runtime actually sees one. `persistence.ts` refreshes stored
 * retrievability with the decayed value on load, so a card whose stored value
 * does not match its own stability and elapsed time never reaches the code
 * under test -- and a fixture that skips that step tests a state that cannot
 * occur.
 */
function cardAged(stability: number, elapsedDays: number) {
  const base = createLemmaCard("hola", "A1", {
    stability,
    lastReviewedAt: NOW - elapsedDays * DAY,
    reviewCount: 3
  });
  return { ...base, retrievability: decayedRetrievability(base, NOW) };
}

describe("how long an item has been due", () => {
  it("THE ONE THAT MATTERS: agrees with whether the item is reported due", () => {
    // The measurement and the verdict must not be able to disagree. If
    // daysOverdue says 4 days past the floor, getItemProgress must say "due";
    // if it says not yet, it must not. A hand-written inverse of the curve
    // would be a second implementation and could drift from this.
    for (const stability of [0.5, 1, 5, 20, 100, 400]) {
      for (const elapsed of [0, 1, 3, 10, 60, 300, 1000]) {
        const card = cardAged(stability, elapsed);
        const overdue = daysOverdue(card, NOW, DUE_RETRIEVABILITY_FLOOR);
        const verdict = getItemProgress({
          card,
          itemBand: "A1",
          learnerBand: "A1"
        });
        const label = `S=${stability} elapsed=${elapsed}`;
        if (verdict === "due") expect(overdue, label).toBeGreaterThan(0);
        if (verdict === "known") expect(overdue, label).toBeLessThan(0);
      }
    }
  });

  it("a never-reviewed card is not reported overdue", () => {
    // A prior is not a memory, so there is no elapsed time to be past.
    const card = createLemmaCard("hola", "A1", {
      lastReviewedAt: null,
      reviewCount: 0
    });
    expect(daysOverdue(card, NOW, DUE_RETRIEVABILITY_FLOOR)).toBe(0);
  });

  it("a stronger memory takes longer to fall due", () => {
    // Same elapsed time, more stability -> less overdue. The relationship the
    // stranded-item report depends on to rank what is most stuck.
    const weak = daysOverdue(cardAged(2, 30), NOW, DUE_RETRIEVABILITY_FLOOR);
    const strong = daysOverdue(cardAged(60, 30), NOW, DUE_RETRIEVABILITY_FLOOR);
    expect(weak).toBeGreaterThan(strong);
  });

  it("asking later never makes an item less overdue", () => {
    const card = cardAged(5, 20);
    expect(daysOverdue(card, NOW + 10 * DAY, DUE_RETRIEVABILITY_FLOOR)).toBeGreaterThan(
      daysOverdue(card, NOW, DUE_RETRIEVABILITY_FLOOR)
    );
  });
});

describe("competencies squeezed out of the shared due list", () => {
  it("counts what the cap cut, not just what it showed", async () => {
    // Words and competencies compete for the same eight slots. A conversation
    // produces far more words, so the pool skews toward them as a learner
    // plays -- and the top 8 of a mostly-word pool is mostly words. This is
    // the measurement that would justify giving competencies their own line.
    const { summarizeDueListPressure } = await import(
      "../../runtime/teacher/prompt-builder"
    );
    const { createTeacherContext } = await import("../teacher/test-helpers");

    const cards: Record<string, ReturnType<typeof createLemmaCard>> = {};
    // Twelve words all slightly faded, and one competency faded further.
    for (let index = 0; index < 12; index += 1) {
      cards[`word-${index}`] = createLemmaCard(`word-${index}`, "A1", {
        retrievability: 0.55,
        reviewCount: 2
      });
    }
    cards["exponent:hola"] = createLemmaCard("exponent:hola", "A1", {
      retrievability: 0.4,
      reviewCount: 2
    });

    const base = createTeacherContext();
    const pressure = summarizeDueListPressure({
      ...base,
      learner: { ...base.learner, lemmaCards: cards }
    });

    expect(pressure.dueCompetencies).toBe(1);
    expect(pressure.dueWords).toBe(12);
    // This one is faded furthest, so it survives the cap. The number that
    // matters over time is `competenciesCut` rising as the word pool grows.
    expect(pressure.competenciesShown).toBe(1);
    expect(pressure.competenciesCut).toBe(0);
  });
});
