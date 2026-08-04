/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/memory-decay.test.ts
 *
 * Purpose: Pins that a card's retrievability falls with elapsed time, on the
 *   timescale the retention target implies, and that the function doing it
 *   survives the cards it is actually pointed at.
 *
 * The clock is injected throughout. Decay is measured in days and the movement
 * inside a play session is real but far too small to see, so watching one
 * proves nothing either way -- these have to control time.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  decayedRetrievability,
  seedCardFromAtlas
} from "../../runtime/learner/fsrs-adapter";
import {
  DESIRED_RETENTION,
  DUE_RETRIEVABILITY_FLOOR,
  getItemProgress
} from "../../runtime/learner/item-progress";
import type { AtlasLemmaEntry } from "../../runtime/types";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

const atlasEntry = (band: string) =>
  ({ cefrPriorBand: band, cefrPriorSource: "cefrlex" }) as unknown as AtlasLemmaEntry;

/** A card that has been successfully recalled once, at T0. */
function reviewedCard() {
  const seeded = seedCardFromAtlas("queso", "es", atlasEntry("A1"), "A1");
  return applyOutcome(
    seeded,
    {
      receptiveGrade: "Good",
      productiveStrengthDelta: 0,
      provisionalEvidenceDelta: 0
    } as never,
    T0
  );
}

describe("memory fades", () => {
  it("THE POINT: retrievability falls as time passes", () => {
    // It never did. Every graded observation pinned it to 1 and nothing lowered
    // it, so no card ever decayed below the due floor by sitting unused.
    const card = reviewedCard();
    expect(card.retrievability).toBe(1);

    const day1 = decayedRetrievability(card, T0 + DAY);
    const day30 = decayedRetrievability(card, T0 + 30 * DAY);
    expect(day1).toBeLessThan(1);
    expect(day30).toBeLessThan(day1);
  });

  it("does not throw on a card that has never been graded", () => {
    // The old decay function did, on exactly these. It round-tripped through an
    // FSRS card marked as reviewed with no review date, and the engine did a
    // date diff on nothing. Every passively-encountered card is this case.
    const seeded = seedCardFromAtlas("queso", "es", atlasEntry("A1"), "A1");
    expect(seeded.lastReviewedAt).toBeNull();
    expect(() => decayedRetrievability(seeded, T0 + 365 * DAY)).not.toThrow();
  });

  it("leaves a never-graded card's seeded prior alone", () => {
    // Its retrievability is a guess from the learner's band about whether they
    // already know the word. A prior does not decay: there is no remembering
    // for time to erode.
    const seeded = seedCardFromAtlas("queso", "es", atlasEntry("A1"), "A1");
    expect(decayedRetrievability(seeded, T0 + 365 * DAY)).toBe(seeded.retrievability);
  });
});

describe("the timescale is the one the retention target implies", () => {
  it("a card reviewed once is NOT due the next day", () => {
    const card = reviewedCard();
    expect(decayedRetrievability(card, T0 + DAY)).toBeGreaterThan(
      DUE_RETRIEVABILITY_FLOOR
    );
  });

  it("and IS due within a fortnight", () => {
    // At 0.95 a card of this stability comes back in about a week. The old
    // floor of 0.70 put it at 177 days, which is longer than anyone plays.
    const card = reviewedCard();
    expect(decayedRetrievability(card, T0 + 14 * DAY)).toBeLessThan(
      DUE_RETRIEVABILITY_FLOOR
    );
  });

  it("reports as due through the one status function, not a bare comparison", () => {
    const card = reviewedCard();
    const stale = { ...card, retrievability: decayedRetrievability(card, T0 + 14 * DAY) };
    expect(getItemProgress({ card: stale, itemBand: undefined, learnerBand: "A1" })).toBe("due");
  });

  it("a longer-known card lasts longer, because stability grows", () => {
    // The spacing effect: each success stretches the interval. If it did not,
    // review load would never fall and nothing would ever be learned, only
    // maintained.
    let card = reviewedCard();
    for (let i = 1; i <= 3; i += 1) {
      card = applyOutcome(
        card,
        {
          receptiveGrade: "Good",
          productiveStrengthDelta: 0,
          provisionalEvidenceDelta: 0
        } as never,
        T0 + i * 30 * DAY
      );
    }
    const practised = decayedRetrievability(card, card.lastReviewedAt! + 14 * DAY);
    const fresh = decayedRetrievability(reviewedCard(), T0 + 14 * DAY);
    expect(practised).toBeGreaterThan(fresh);
  });
});

describe("a card the learner never had is not a card they forgot", () => {
  it("an above-band item seeds BELOW the due floor and is still not due", () => {
    // Seeding is 0.82 - 0.08 per band above the learner, so a B2 word for an A1
    // learner starts at 0.58 -- under the floor from birth, and nothing ever
    // grades it up. Comparing retrievability directly reported every one of
    // those as overdue. They are not forgotten; they were never had.
    const seeded = seedCardFromAtlas("x", "es", atlasEntry("B2"), "A1");
    expect(seeded.retrievability).toBeLessThan(DUE_RETRIEVABILITY_FLOOR);
    expect(getItemProgress({ card: seeded, itemBand: undefined, learnerBand: "A1" })).not.toBe("due");
  });

  it("reports it as unseen, which is the honest answer", () => {
    const seeded = seedCardFromAtlas("x", "es", atlasEntry("A1"), "A1");
    expect(getItemProgress({ card: seeded, itemBand: undefined, learnerBand: "A1" })).toBe("unseen");
  });

  it("and out-of-reach still wins over any card history", () => {
    const seeded = seedCardFromAtlas("x", "es", atlasEntry("C1"), "A1");
    expect(
      getItemProgress({ card: seeded, itemBand: "C1", learnerBand: "A1" })
    ).toBe("out-of-reach");
  });
});

describe("one retention target", () => {
  it("the due floor is the desired retention", () => {
    expect(DUE_RETRIEVABILITY_FLOOR).toBe(DESIRED_RETENTION);
  });
});
