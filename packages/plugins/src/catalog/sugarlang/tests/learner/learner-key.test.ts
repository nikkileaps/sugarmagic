/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/learner-key.test.ts
 *
 * Purpose: Pins when the learner key moves -- and, more importantly, when it
 *   must NOT.
 *
 * THE KEY IS A RE-PLAN TRIGGER, so both directions cost something. Too still and
 * the Teacher never learns that a word landed; too twitchy and it re-plans every
 * turn, which is the treadmill the situation key was built to end.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/learner/learner-key.
 *
 * Implements: Plan 090 story 090.4
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { learnerKey } from "../../runtime/learner/learner-key";
import { createLearnerProfile, createLemmaCard } from "./test-helpers";

describe("learnerKey -- moves on a real transition", () => {
  it("moves when a word goes from unseen to learning", () => {
    // The loop this closes: the player produced `queso`, observe recorded it,
    // FSRS graded it, and until now nothing downstream noticed.
    const before = createLearnerProfile("A1", { lemmaCards: {} });
    const after = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.8, reviewCount: 1 })
      }
    });

    expect(learnerKey(before)).not.toBe(learnerKey(after));
  });

  it("moves when a known word decays to due", () => {
    // No player action at all -- time passing is a legitimate reason to re-plan.
    const known = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.95, reviewCount: 3 })
      }
    });
    const due = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.5, reviewCount: 3 })
      }
    });

    expect(learnerKey(known)).not.toBe(learnerKey(due));
  });

  it("moves when the learner's band is re-estimated", () => {
    // A band change moves the out-of-reach boundary for everything at once.
    expect(learnerKey(createLearnerProfile("A1", { lemmaCards: {} }))).not.toBe(
      learnerKey(createLearnerProfile("B1", { lemmaCards: {} }))
    );
  });
});

describe("learnerKey -- holds still otherwise", () => {
  it("does NOT move when a card is merely created with no reviews", () => {
    // The subtle one, and it cost an integration test to find. A missing card
    // and a card with no reviews are both `unseen` -- the same state -- so they
    // must digest identically. Otherwise the key moved every time a word was
    // shown to the player, and the Teacher re-planned on every single turn.
    const noCard = createLearnerProfile("A1", { lemmaCards: {} });
    const unseenCard = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.3, reviewCount: 0 })
      }
    });

    expect(learnerKey(noCard)).toBe(learnerKey(unseenCard));
  });

  it("does NOT move on a retrievability wobble inside one status", () => {
    // Retrievability decays continuously. If the key tracked the float rather
    // than the status, it would differ on every turn by construction.
    const a = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.85, reviewCount: 2 })
      }
    });
    const b = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.82, reviewCount: 2 })
      }
    });

    expect(learnerKey(a)).toBe(learnerKey(b));
  });

  it("is order-independent", () => {
    // Record iteration order is not something to hang cache validity on.
    const first = createLearnerProfile("A1", {
      lemmaCards: {
        queso: createLemmaCard("queso", "A1", { retrievability: 0.8, reviewCount: 1 }),
        barca: createLemmaCard("barca", "A1", { retrievability: 0.8, reviewCount: 1 })
      }
    });
    const second = createLearnerProfile("A1", {
      lemmaCards: {
        barca: createLemmaCard("barca", "A1", { retrievability: 0.8, reviewCount: 1 }),
        queso: createLemmaCard("queso", "A1", { retrievability: 0.8, reviewCount: 1 })
      }
    });

    expect(learnerKey(first)).toBe(learnerKey(second));
  });
});
