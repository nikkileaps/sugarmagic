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
import type { PedagogicalDirective } from "../../runtime/types";

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
    // All thirteen have been reviewed and have fallen under the floor, so all
    // thirteen are due. The pressure summary reads the derived list rather than
    // re-deciding from retrievability, so the fixture carries it.
    const pressure = summarizeDueListPressure({
      ...base,
      learnerProgress: {
        met: [],
        unmetCompetencyIds: [],
        dueItemIds: Object.keys(cards),
        isColdStart: false,
        sceneId: "scene-station",
        conversationId: "conv-1"
      },
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

describe("which due items the Teacher passed over", () => {
  /**
   * Invokes the real policy with a canned directive and returns the
   * `dueItemsPassedOver` it reported.
   *
   * Through the policy rather than against a helper: the bug this pins was two
   * id spaces that only meet inside it, and a test calling a helper with
   * hand-built keys would have agreed with whichever space it was handed.
   */
  async function passedOver(
    dueItemIds: string[],
    chose: Partial<PedagogicalDirective["targetVocab"]>
  ): Promise<string[]> {
    const { ClaudeTeacherPolicy } = await import(
      "../../runtime/teacher/policies/llm-teacher-policy"
    );
    const { createDirectiveFixture, createTeacherContext } = await import(
      "../teacher/test-helpers"
    );
    const { MemoryTelemetrySink } = await import(
      "../../runtime/telemetry/telemetry"
    );

    const telemetry = new MemoryTelemetrySink();
    const directive = createDirectiveFixture({
      targetVocab: { introduce: [], reinforce: [], avoid: [], ...chose }
    });

    await new ClaudeTeacherPolicy({
      telemetry,
      client: {
        generateStructuredDirective: async () => ({
          text: JSON.stringify(directive)
        })
      }
    }).invoke({
      ...createTeacherContext(),
      learnerProgress: {
        met: [],
        unmetCompetencyIds: [],
        dueItemIds,
        isColdStart: false,
        sceneId: "scene-station",
        conversationId: "conv-1"
      }
    });

    const events = await telemetry.query({});
    const completed = events.find(
      (event) => event.kind === "teacher.invocation-completed"
    );
    return (completed as unknown as {
      dueItemsPassedOver: string[];
    }).dueItemsPassedOver;
  }

  it("THE ONE THAT MATTERS: a chosen competency is not reported as passed over", async () => {
    // A card is keyed by its EXPONENT (`exponent:hola`); the slate names the
    // COMPETENCY (`greet`). The two id spaces are disjoint -- 635 competency
    // ids and 2526 exponent ids share no member -- so building
    // `exponent:greet` and comparing it against card keys is well-formed and
    // matches nothing. Every competency read as passed over even when the
    // Teacher had just chosen it.
    expect(
      await passedOver(["exponent:hola"], {
        introduce: [{ kind: "competency", competencyId: "greet", lang: "es" }]
      })
    ).toEqual([]);
  });

  it("a competency the Teacher did NOT choose is still reported", async () => {
    expect(
      await passedOver(["exponent:hola"], {
        introduce: [{ kind: "competency", competencyId: "thank", lang: "es" }]
      })
    ).toEqual(["exponent:hola"]);
  });

  it("words still work, which is the half that never broke", async () => {
    expect(
      await passedOver(["queso", "anden"], {
        introduce: [{ kind: "vocabulary", lemmaId: "queso", lang: "es" }]
      })
    ).toEqual(["anden"]);
  });
});
