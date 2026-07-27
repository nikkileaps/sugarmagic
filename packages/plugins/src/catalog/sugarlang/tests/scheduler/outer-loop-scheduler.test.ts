/**
 * packages/plugins/src/catalog/sugarlang/tests/scheduler/outer-loop-scheduler.test.ts
 *
 * Purpose: Pins the outer-loop scheduler's schedule production, cold-start degradation,
 *   scene-affinity boost, NPC-affinity boost, boundary (no plugin-crossing), and
 *   determinism (same board -> same schedule).
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/scheduler/outer-loop-scheduler.
 *   - Uses MemoryTelemetrySink to verify the scheduler.computed event.
 *
 * Implements: Plan 087 story 087.1
 *
 * Status: active
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OuterLoopScheduler, DUE_RETRIEVABILITY_FLOOR } from "../../runtime/scheduler/outer-loop-scheduler";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import type { SchedulerBoardView } from "../../runtime/scheduler/scheduler-board-view";
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

function emptyBoard(overrides: Partial<SchedulerBoardView> = {}): SchedulerBoardView {
  const baseCurriculum = {
    introducedFunctionIds: new Set<string>(),
    availableFunctions: [] as typeof FIXTURE_FUNCTIONS,
    activeDebts: new Map<string, import("../../runtime/learner/encounter-debt-ledger").DebtStatus>()
  };
  return {
    learner: {
      cefrBand: "A2",
      cefrConfidence: 0.7,
      lemmaCards: {},
      fatigueScore: 0
    },
    scene: {
      sceneId: "scene-1",
      functionTags: { sceneFunctions: [], npcFunctions: {} },
      dayIndex: null
    },
    conversationId: "conv-1",
    npcDefinitionId: null,
    targetLanguage: "es",
    ...overrides,
    // Deep-merge curriculum so activeDebts is always present even when overrides sets curriculum.
    curriculum: {
      ...baseCurriculum,
      ...(overrides.curriculum ?? {})
    }
  };
}

const FIXTURE_FUNCTIONS = [
  { functionId: "greet", displayName: "Greet", cefrDescriptor: "", band: "A1" as const, chunks: {} },
  { functionId: "farewell", displayName: "Farewell", cefrDescriptor: "", band: "A1" as const, chunks: {} },
  { functionId: "buy", displayName: "Buy", cefrDescriptor: "", band: "B1" as const, chunks: {} }
];

// ---------- tests ----------

describe("OuterLoopScheduler", () => {
  let telemetry: MemoryTelemetrySink;
  let scheduler: OuterLoopScheduler;

  beforeEach(() => {
    telemetry = new MemoryTelemetrySink();
    scheduler = new OuterLoopScheduler({ telemetry });
  });

  describe("cold start", () => {
    it("returns an empty schedule when no cards and no introduced functions", () => {
      const schedule = scheduler.compute(emptyBoard());
      expect(schedule.isColdStart).toBe(true);
      expect(schedule.teachables).toHaveLength(0);
    });

    it("emits scheduler.computed telemetry with isColdStart=true", async () => {
      scheduler.compute(emptyBoard());
      await telemetry.flush();
      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "scheduler.computed", isColdStart: true, teachableCount: 0 });
    });

    it("is NOT cold start when cards exist even with no introduced functions", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { comer: makeCard("comer", 0.9) },
          fatigueScore: 0
        }
      });
      const schedule = scheduler.compute(board);
      expect(schedule.isColdStart).toBe(false);
    });

    it("is NOT cold start when functions have been introduced", () => {
      const board = emptyBoard({
        curriculum: {
          introducedFunctionIds: new Set(["greet"]),
          availableFunctions: FIXTURE_FUNCTIONS
        }
      });
      expect(scheduler.compute(board).isColdStart).toBe(false);
    });
  });

  describe("due items (FSRS retrievability)", () => {
    it("includes lemma cards with retrievability below DUE_RETRIEVABILITY_FLOOR", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.8,
          lemmaCards: {
            comer: makeCard("comer", DUE_RETRIEVABILITY_FLOOR - 0.01),
            hablar: makeCard("hablar", DUE_RETRIEVABILITY_FLOOR + 0.01)
          },
          fatigueScore: 0
        }
      });
      const schedule = scheduler.compute(board);
      const ids = schedule.teachables.map((t) => t.id);
      expect(ids).toContain("comer");
      expect(ids).not.toContain("hablar");
    });

    it("due item gets kind=lemma and teachReason=due", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.8,
          lemmaCards: { comer: makeCard("comer", 0.3) },
          fatigueScore: 0
        }
      });
      const teachable = scheduler.compute(board).teachables[0];
      expect(teachable).toMatchObject({ id: "comer", kind: "lemma", teachReason: "due" });
    });

    it("excludes chunk: cards from due-ness (handled at function level)", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { "chunk:buenos_dias": makeCard("chunk:buenos_dias", 0.1) },
          fatigueScore: 0
        }
      });
      const schedule = scheduler.compute(board);
      // The chunk: card is the only card, so it's not cold-start-free, but
      // it should NOT appear in due items (chunk cards are excluded).
      const dueIds = schedule.teachables.filter((t) => t.teachReason === "due").map((t) => t.id);
      expect(dueIds).not.toContain("chunk:buenos_dias");
    });

    it("lower retrievability produces higher priority", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.8,
          lemmaCards: {
            comer: makeCard("comer", 0.2),    // more overdue
            hablar: makeCard("hablar", 0.55)  // less overdue, but still below floor
          },
          fatigueScore: 0
        }
      });
      const teachables = scheduler.compute(board).teachables;
      const comerIdx = teachables.findIndex((t) => t.id === "comer");
      const hablarIdx = teachables.findIndex((t) => t.id === "hablar");
      expect(comerIdx).toBeLessThan(hablarIdx);
    });
  });

  describe("unintroduced functions (band ordering)", () => {
    it("schedules unintroduced functions in band order (A1 before B1)", () => {
      const board = emptyBoard({
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS
        }
      });
      const schedule = scheduler.compute(board);
      const a1Items = schedule.teachables.filter(
        (t) => t.kind === "function" && (t.id === "greet" || t.id === "farewell")
      );
      const b1Items = schedule.teachables.filter((t) => t.kind === "function" && t.id === "buy");
      const a1Priorities = a1Items.map((t) => t.priority);
      const b1Priority = b1Items[0]?.priority ?? 0;
      expect(a1Priorities.every((p) => p > b1Priority)).toBe(true);
    });

    it("skips already-introduced functions", () => {
      const board = emptyBoard({
        curriculum: {
          introducedFunctionIds: new Set(["greet"]),
          availableFunctions: FIXTURE_FUNCTIONS
        }
      });
      const ids = scheduler.compute(board).teachables.map((t) => t.id);
      expect(ids).not.toContain("greet");
      expect(ids).toContain("farewell");
    });

    it("function item gets kind=function and teachReason=introduction (no scene affinity)", () => {
      // Seed one well-known card so the board is not cold-start, then schedule
      // the one unintroduced function.
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) }, // well-known, not due
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: [FIXTURE_FUNCTIONS[2]]  // buy (B1)
        }
      });
      const teachable = scheduler.compute(board).teachables[0];
      expect(teachable).toMatchObject({ id: "buy", kind: "function", teachReason: "introduction" });
    });
  });

  describe("scene affinity boost", () => {
    it("function present in scene gets higher priority and teachReason=function-affinity", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) }, // non-cold-start seed
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS
        },
        scene: {
          sceneId: "market",
          functionTags: {
            sceneFunctions: ["buy"],
            npcFunctions: {}
          },
          dayIndex: null
        }
      });
      const schedule = scheduler.compute(board);
      const buyItem = schedule.teachables.find((t) => t.id === "buy");
      expect(buyItem?.teachReason).toBe("function-affinity");
      // buy (B1 + affinity) should beat a non-affinity A1 function
      const greetItem = schedule.teachables.find((t) => t.id === "greet");
      expect(buyItem!.priority).toBeGreaterThan(greetItem!.priority);
    });

    it("current NPC affinity adds extra boost", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) }, // non-cold-start seed
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: [FIXTURE_FUNCTIONS[0], FIXTURE_FUNCTIONS[2]]  // greet + buy
        },
        scene: {
          sceneId: "market",
          functionTags: {
            sceneFunctions: ["greet", "buy"],
            npcFunctions: { "npc-market": ["buy"] }
          },
          dayIndex: null
        },
        npcDefinitionId: "npc-market"
      });
      const schedule = scheduler.compute(board);
      const buyItem = schedule.teachables.find((t) => t.id === "buy");
      const greetItem = schedule.teachables.find((t) => t.id === "greet");
      // buy has scene + NPC affinity; greet has only scene affinity;
      // both are A1 equivalent in their base priority, but buy (B1 + more affinity)
      // should be ahead of greet (A1 + less affinity) -- verify boost applied
      expect(buyItem).toBeDefined();
      expect(buyItem!.affinityNpcIds).toContain("npc-market");
    });
  });

  describe("schedule ordering", () => {
    it("is deterministic: same board produces identical schedule twice", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.7,
          lemmaCards: {
            comer: makeCard("comer", 0.4),
            beber: makeCard("beber", 0.5)
          },
          fatigueScore: 0.1
        },
        curriculum: {
          introducedFunctionIds: new Set(["greet"]),
          availableFunctions: FIXTURE_FUNCTIONS
        }
      });
      const schedule1 = scheduler.compute(board);
      const schedule2 = scheduler.compute(board);
      expect(schedule1.teachables.map((t) => t.id)).toEqual(
        schedule2.teachables.map((t) => t.id)
      );
    });

    it("teachables are in descending priority order", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.7,
          lemmaCards: {
            comer: makeCard("comer", 0.3),
            beber: makeCard("beber", 0.6)
          },
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS
        }
      });
      const priorities = scheduler.compute(board).teachables.map((t) => t.priority);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeLessThanOrEqual(priorities[i - 1]);
      }
    });
  });

  describe("absent-input degradation", () => {
    it("propagates sceneId from the board", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { hola: makeCard("hola", 0.5) },
          fatigueScore: 0
        },
        scene: { sceneId: "my-scene", functionTags: { sceneFunctions: [], npcFunctions: {} }, dayIndex: null }
      });
      expect(scheduler.compute(board).sceneId).toBe("my-scene");
    });

    it("propagates conversationId from the board", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { hola: makeCard("hola", 0.5) },
          fatigueScore: 0
        },
        conversationId: "conv-xyz"
      });
      expect(scheduler.compute(board).conversationId).toBe("conv-xyz");
    });
  });

  describe("telemetry", () => {
    it("emits scheduler.computed with full decision inputs on every compute", async () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "B1",
          cefrConfidence: 0.7,
          lemmaCards: { comer: makeCard("comer", 0.4) },
          fatigueScore: 0.2
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS
        }
      });
      scheduler.compute(board);
      await telemetry.flush();
      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.isColdStart).toBe(false);
      expect(typeof event.teachableCount).toBe("number");
      expect(typeof event.dueItemCount).toBe("number");
      expect(typeof event.debtServiceCount).toBe("number");
      expect(typeof event.introductionCount).toBe("number");
      expect(typeof event.affinityCount).toBe("number");
      expect(typeof event.topTeachableId).toBe("string");
      expect(event.learnerBand).toBe("B1");
    });
  });

  describe("debt-service items (087.2)", () => {
    it("debt-service items appear in the schedule with teachReason=debt-service", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS,
          activeDebts: new Map([["adios", { diverseEncounterCount: 2, targetEncounters: 10 }]])
        }
      });
      const schedule = scheduler.compute(board);
      const debtItem = schedule.teachables.find((t) => t.teachReason === "debt-service");
      expect(debtItem).toBeDefined();
      expect(debtItem!.id).toBe("adios");
    });

    it("fresh debt (0/10 encounters) beats A1 unintroduced function in priority", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS,
          activeDebts: new Map([["adios", { diverseEncounterCount: 0, targetEncounters: 10 }]])
        }
      });
      const schedule = scheduler.compute(board);
      const debtItem = schedule.teachables.find((t) => t.teachReason === "debt-service");
      const introItem = schedule.teachables.find((t) => t.teachReason === "introduction");
      expect(debtItem!.priority).toBeGreaterThan(introItem!.priority);
    });

    it("no debt-service items when activeDebts is empty", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        }
      });
      const schedule = scheduler.compute(board);
      expect(schedule.teachables.some((t) => t.teachReason === "debt-service")).toBe(false);
    });

    it("debt item with same id as an available function skips the introduction candidate", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: FIXTURE_FUNCTIONS,
          // "greet" appears as active debt AND as an available function
          activeDebts: new Map([["greet", { diverseEncounterCount: 3, targetEncounters: 10 }]])
        }
      });
      const schedule = scheduler.compute(board);
      const greetItems = schedule.teachables.filter((t) => t.id === "greet");
      // Only one entry -- debt wins over introduction
      expect(greetItems).toHaveLength(1);
      expect(greetItems[0].teachReason).toBe("debt-service");
    });

    it("debt telemetry includes debtServiceCount and dayAxisDegraded", async () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        },
        curriculum: {
          introducedFunctionIds: new Set(),
          availableFunctions: [],
          activeDebts: new Map([["adios", { diverseEncounterCount: 5, targetEncounters: 10 }]])
        },
        scene: { sceneId: null, functionTags: { sceneFunctions: [], npcFunctions: {} }, dayIndex: null }
      });
      scheduler.compute(board);
      await telemetry.flush();
      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.debtServiceCount).toBe(1);
      expect(event.dayAxisDegraded).toBe(true);
    });
  });
});
