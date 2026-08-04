/**
 * packages/plugins/src/catalog/sugarlang/tests/scheduler/outer-loop-scheduler.test.ts
 *
 * Purpose: Pins what the scheduler reports -- met and unmet competencies,
 *   encounter counts, due cards, cold start -- and that it reports nothing
 *   about what to teach.
 *
 * Relationships:
 *   - Exercises ../../runtime/scheduler/outer-loop-scheduler.
 *   - Uses MemoryTelemetrySink to verify the scheduler.computed event.
 *
 * Status: active
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  OuterLoopScheduler,
  DUE_RETRIEVABILITY_FLOOR
} from "../../runtime/scheduler/outer-loop-scheduler";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import type {
  SchedulerBoardView,
  SchedulerCurriculumView
} from "../../runtime/scheduler/scheduler-board-view";
import type { LemmaCard } from "../../runtime/types";

// ---------- fixture builders ----------

function makeCard(lemmaId: string, retrievability: number): LemmaCard {
  return {
    lemmaId,
    difficulty: 5,
    stability: 2,
    retrievability,
    lastReviewedAt: null,
    reviewCount: 1,
    lapseCount: 0,
    cefrPriorBand: "A1",
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

function board(
  overrides: Partial<Omit<SchedulerBoardView, "curriculum">> & {
    curriculum?: Partial<SchedulerCurriculumView>;
  } = {}
): SchedulerBoardView {
  const baseCurriculum: SchedulerCurriculumView = {
    introducedCompetencyIds: new Set<string>(),
    availableCompetencies: [],
    encounterCounts: new Map<string, number>()
  };
  return {
    learner: { cefrBand: "A2", lemmaCards: {} },
    scene: { sceneId: "scene-1", dayIndex: null },
    conversationId: "conv-1",
    ...overrides,
    curriculum: { ...baseCurriculum, ...(overrides.curriculum ?? {}) }
  };
}

const COMPETENCIES = [
  { competencyId: "greet", displayName: "Greet", cefrDescriptor: "", band: "A1" as const, chunks: {} },
  { competencyId: "farewell", displayName: "Farewell", cefrDescriptor: "", band: "A1" as const, chunks: {} },
  { competencyId: "buy", displayName: "Buy", cefrDescriptor: "", band: "B1" as const, chunks: {} }
];

// ---------- tests ----------

describe("OuterLoopScheduler", () => {
  let telemetry: MemoryTelemetrySink;
  let scheduler: OuterLoopScheduler;

  beforeEach(() => {
    telemetry = new MemoryTelemetrySink();
    scheduler = new OuterLoopScheduler({ telemetry });
  });

  describe("it reports facts, never a recommendation", () => {
    it("THE POINT OF THIS FILE: nothing in the output ranks or recommends", () => {
      // A fact that arrives with a recommendation attached is a second
      // authority on what to teach. Whether a competency is worth teaching now
      // depends on the scene and the NPCs present, which only the Teacher sees.
      const state = scheduler.compute(
        board({
          learner: { cefrBand: "A1", lemmaCards: { queso: makeCard("queso", 0.1) } },
          curriculum: {
            availableCompetencies: COMPETENCIES,
            introducedCompetencyIds: new Set(["greet"])
          }
        })
      );

      const serialized = JSON.stringify(state);
      for (const banned of ["priority", "teachReason", "stretch", "teachables"]) {
        expect(serialized).not.toContain(banned);
      }
    });
  });

  describe("competencies the learner has met", () => {
    it("separates met from unmet against the inventory", () => {
      const state = scheduler.compute(
        board({
          curriculum: {
            availableCompetencies: COMPETENCIES,
            introducedCompetencyIds: new Set(["greet", "buy"])
          }
        })
      );

      expect(state.met.map((m) => m.competencyId)).toEqual(["buy", "greet"]);
      expect(state.unmetCompetencyIds).toEqual(["farewell"]);
    });

    it("carries the encounter count, and defaults to zero when the ledger has none", () => {
      const state = scheduler.compute(
        board({
          curriculum: {
            availableCompetencies: COMPETENCIES,
            introducedCompetencyIds: new Set(["greet", "farewell"]),
            encounterCounts: new Map([["greet", 4]])
          }
        })
      );

      expect(state.met).toEqual([
        { competencyId: "farewell", encounterCount: 0 },
        { competencyId: "greet", encounterCount: 4 }
      ]);
    });

    it("reports a count well past any target without calling it paid", () => {
      // The ledger's target is a policy. Whether 40 encounters is enough is a
      // judgement, so the count is passed through unjudged.
      const state = scheduler.compute(
        board({
          curriculum: {
            availableCompetencies: COMPETENCIES,
            introducedCompetencyIds: new Set(["greet"]),
            encounterCounts: new Map([["greet", 40]])
          }
        })
      );

      expect(state.met[0]).toEqual({ competencyId: "greet", encounterCount: 40 });
    });
  });

  describe("due cards", () => {
    it("reports cards below the due floor and omits cards above it", () => {
      const state = scheduler.compute(
        board({
          learner: {
            cefrBand: "A2",
            lemmaCards: {
              faded: makeCard("faded", DUE_RETRIEVABILITY_FLOOR - 0.1),
              fresh: makeCard("fresh", DUE_RETRIEVABILITY_FLOOR + 0.1)
            }
          }
        })
      );

      expect(state.dueItemIds).toEqual(["faded"]);
    });

    it("INCLUDES competency cards, which the ranked scheduler used to skip", () => {
      // A decayed competency card is as much a fact as a decayed lemma card.
      // Consumers that want lemmas only filter at the point of use, where the
      // reason is visible -- the lore-search bias does exactly that.
      const state = scheduler.compute(
        board({
          learner: {
            cefrBand: "A2",
            lemmaCards: {
              "chunk:que_tal": makeCard("chunk:que_tal", 0.2),
              queso: makeCard("queso", 0.2)
            }
          }
        })
      );

      expect(state.dueItemIds).toEqual(["chunk:que_tal", "queso"]);
    });
  });

  describe("cold start", () => {
    it("is cold with no cards and no met competencies", () => {
      expect(scheduler.compute(board()).isColdStart).toBe(true);
    });

    it("is not cold once a card exists", () => {
      const state = scheduler.compute(
        board({ learner: { cefrBand: "A2", lemmaCards: { queso: makeCard("queso", 0.9) } } })
      );
      expect(state.isColdStart).toBe(false);
    });

    it("is not cold once a competency has been met", () => {
      const state = scheduler.compute(
        board({ curriculum: { introducedCompetencyIds: new Set(["greet"]) } })
      );
      expect(state.isColdStart).toBe(false);
    });

    it("still reports the unmet curriculum while cold", () => {
      // Cold start is a fact about the learner, not a reason to say nothing.
      const state = scheduler.compute(
        board({ curriculum: { availableCompetencies: COMPETENCIES } })
      );
      expect(state.isColdStart).toBe(true);
      expect(state.unmetCompetencyIds).toEqual(["buy", "farewell", "greet"]);
    });
  });

  describe("plumbing", () => {
    it("is deterministic: the same board twice produces identical output", () => {
      const input = board({
        learner: { cefrBand: "A1", lemmaCards: { a: makeCard("a", 0.2), b: makeCard("b", 0.3) } },
        curriculum: {
          availableCompetencies: COMPETENCIES,
          introducedCompetencyIds: new Set(["greet"]),
          encounterCounts: new Map([["greet", 2]])
        }
      });
      expect(scheduler.compute(input)).toEqual(scheduler.compute(input));
    });

    it("propagates sceneId and conversationId", () => {
      const state = scheduler.compute(
        board({ scene: { sceneId: "plaza", dayIndex: 3 }, conversationId: "conv-9" })
      );
      expect(state.sceneId).toBe("plaza");
      expect(state.conversationId).toBe("conv-9");
    });

    it("emits scheduler.computed with the counts it reported", async () => {
      scheduler.compute(
        board({
          learner: { cefrBand: "A1", lemmaCards: { queso: makeCard("queso", 0.2) } },
          curriculum: {
            availableCompetencies: COMPETENCIES,
            introducedCompetencyIds: new Set(["greet"])
          }
        })
      );

      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        isColdStart: false,
        learnerBand: "A1",
        metCompetencyCount: 1,
        unmetCompetencyCount: 2,
        dueItemCount: 1
      });
    });
  });
});
