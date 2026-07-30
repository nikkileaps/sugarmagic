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
import type { SchedulerBoardView, SchedulerCurriculumView } from "../../runtime/scheduler/scheduler-board-view";
import type { LemmaCard } from "../../runtime/types";
import type { Competency } from "../../runtime/contracts/competency-inventory";

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

function emptyBoard(
  overrides: Partial<Omit<SchedulerBoardView, "curriculum">> & {
    curriculum?: Partial<SchedulerCurriculumView>;
  } = {}
): SchedulerBoardView {
  const baseCurriculum: SchedulerCurriculumView = {
    introducedCompetencyIds: new Set<string>(),
    availableCompetencies: [],
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
      dayIndex: null,
      sceneLemmaIds: []
    },
    conversationId: "conv-1",
    npcDefinitionId: null,
    targetLanguage: "es",
    ...overrides,
    // Deep-merge curriculum so activeDebts is always present even when overrides partially sets curriculum.
    curriculum: {
      ...baseCurriculum,
      ...(overrides.curriculum ?? {})
    }
  };
}

const FIXTURE_FUNCTIONS = [
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
          introducedCompetencyIds: new Set(["greet"]),
          availableCompetencies: FIXTURE_FUNCTIONS
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
      expect(teachable).toMatchObject({ id: "comer", kind: "vocabulary", teachReason: "due" });
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
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS
        }
      });
      const schedule = scheduler.compute(board);
      const a1Items = schedule.teachables.filter(
        (t) => t.kind === "competency" && (t.id === "greet" || t.id === "farewell")
      );
      const b1Items = schedule.teachables.filter((t) => t.kind === "competency" && t.id === "buy");
      const a1Priorities = a1Items.map((t) => t.priority);
      const b1Priority = b1Items[0]?.priority ?? 0;
      expect(a1Priorities.every((p) => p > b1Priority)).toBe(true);
    });

    it("skips already-introduced functions", () => {
      const board = emptyBoard({
        curriculum: {
          introducedCompetencyIds: new Set(["greet"]),
          availableCompetencies: FIXTURE_FUNCTIONS
        }
      });
      const ids = scheduler.compute(board).teachables.map((t) => t.id);
      expect(ids).not.toContain("greet");
      expect(ids).toContain("farewell");
    });

    it("function item gets kind=function and teachReason=introduction (no scene affinity)", () => {
      // Seed one well-known card so the board is not cold-start, then schedule
      // an unintroduced function that has no scene affinity.
      // Use an A1 function for an A2 learner -- within band, included without stretch gate.
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) }, // well-known, not due
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [FIXTURE_FUNCTIONS[0]]  // greet (A1) -- within learner band, no scene affinity
        }
      });
      const teachable = scheduler.compute(board).teachables[0];
      expect(teachable).toMatchObject({ id: "greet", kind: "competency", teachReason: "introduction" });
    });
  });

  // 090.2 DELETED the scene-affinity and NPC-affinity boost tests along with the
  // behavior. Both read `SchedulerSceneView.competencyTags`, which was scene-
  // content ranking computed BEFORE the Teacher runs -- the budgeter's shape --
  // and it sourced from a chunk intersection that reported an empty scene almost
  // always, so the boosts were dead in practice as well as wrong in principle.
  // Whether a scene calls for a competency is now the Teacher's call against the
  // situation (090.3 composes it, 090.4 decides).

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
          introducedCompetencyIds: new Set(["greet"]),
          availableCompetencies: FIXTURE_FUNCTIONS
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
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS
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
        scene: { sceneId: "my-scene", dayIndex: null, sceneLemmaIds: [] }
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
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS
        }
      });
      scheduler.compute(board);
      await telemetry.flush();
      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      expect(events).toHaveLength(1);
      const event = events[0] as unknown as Record<string, unknown>;
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
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS,
          activeDebts: new Map([["adios", { itemKind: "vocabulary" as const, diverseEncounterCount: 2, targetEncounters: 10 }]])
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
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS,
          activeDebts: new Map([["adios", { itemKind: "vocabulary" as const, diverseEncounterCount: 0, targetEncounters: 10 }]])
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
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS,
          // "greet" appears as active debt AND as an available function.
          // The observe middleware creates function debts with itemKind
          // "function" (createDebt(fnEntry.competencyId, "competency", ...)).
          activeDebts: new Map([["greet", { itemKind: "competency" as const, diverseEncounterCount: 3, targetEncounters: 10 }]])
        }
      });
      const schedule = scheduler.compute(board);
      const greetItems = schedule.teachables.filter((t) => t.id === "greet");
      // Only one entry -- debt wins over introduction
      expect(greetItems).toHaveLength(1);
      expect(greetItems[0].teachReason).toBe("debt-service");
      // The debt carries its itemKind through: a function debt stays kind
      // "competency" so realizeCompetencyChunksFromSchedule can expand it to chunk
      // refs, and it never reaches lemma-only consumers as a bogus lemmaId.
      expect(greetItems[0].kind).toBe("competency");
    });

    it("debt telemetry includes debtServiceCount, dayAxisDegraded, and new 087.3 fields", async () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A2",
          cefrConfidence: 0.7,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [],
          activeDebts: new Map([["adios", { itemKind: "vocabulary" as const, diverseEncounterCount: 5, targetEncounters: 10 }]])
        },
        scene: { sceneId: null, dayIndex: null, sceneLemmaIds: [] }
      });
      scheduler.compute(board);
      await telemetry.flush();
      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      expect(events).toHaveLength(1);
      const event = events[0] as unknown as Record<string, unknown>;
      expect(event.debtServiceCount).toBe(1);
      expect(event.dayAxisDegraded).toBe(true);
      expect(typeof event.sceneComprehensionRate).toBe("number");
      expect(event.stretchAllowanceActive).toBe(false);
    });
  });

  describe("comprehension rate + stretch allowance (087.3)", () => {
    const A2_FN = {
      competencyId: "order-food",
      displayName: "Order food",
      cefrDescriptor: "",
      band: "A2" as const,
      chunks: {} as Record<string, { chunkId: string }[]>
    } as unknown as Competency;
    const B1_FN = {
      competencyId: "negotiate",
      displayName: "Negotiate price",
      cefrDescriptor: "",
      band: "B1" as const,
      chunks: {} as Record<string, { chunkId: string }[]>
    } as unknown as Competency;

    it("sceneComprehensionRate is 1.0 when sceneLemmaIds is empty", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        }
      });
      const schedule = scheduler.compute(board);
      expect(schedule.sceneComprehensionRate).toBe(1.0);
    });

    it("sceneComprehensionRate reflects the fraction of scene lemmas above the known threshold", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),    // known
            adios: makeCard("adios", 0.30)   // not known
          },
          fatigueScore: 0
        },
        scene: {
          sceneId: "test",
              dayIndex: null,
          sceneLemmaIds: ["hola", "adios", "gracias"] // gracias has no card = 0 retrievability
        }
      });
      const schedule = scheduler.compute(board);
      // Only hola passes the 0.70 threshold; 1 / 3.
      expect(schedule.sceneComprehensionRate).toBeCloseTo(1 / 3);
    });

    it("stretch allowance NOT triggered when comprehensionRate < STRETCH_COMPREHENSION_FLOOR", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [FIXTURE_FUNCTIONS[0], A2_FN]
        },
        scene: {
          sceneId: "test",
          dayIndex: null,
          sceneLemmaIds: ["hola", "adios", "gracias"] // 1/3 known -- below 0.80
        }
      });
      const schedule = scheduler.compute(board);
      expect(schedule.stretchAllowanceActive).toBe(false);
      expect(schedule.teachables.some((t) => t.teachReason === "stretch")).toBe(false);
    });

    it("stretch allowance triggered when comprehensionRate >= 0.80", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),
            adios: makeCard("adios", 0.90),
            gracias: makeCard("gracias", 0.85),
            perdon: makeCard("perdon", 0.88)
          },
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [FIXTURE_FUNCTIONS[0], A2_FN]
        },
        scene: {
          sceneId: "test",
          dayIndex: null,
          sceneLemmaIds: ["hola", "adios", "gracias", "perdon"] // 4/4 = 1.0 >= 0.80
        }
      });
      const schedule = scheduler.compute(board);
      expect(schedule.stretchAllowanceActive).toBe(true);
      const stretchItem = schedule.teachables.find((t) => t.teachReason === "stretch");
      expect(stretchItem).toBeDefined();
      expect(stretchItem!.id).toBe("order-food");
    });

    it("an above-band function IS now offered when the comprehension floor is met", () => {
      // 090.2 REVERSED this case. It previously asserted that `negotiate` was
      // withheld for lacking scene affinity -- but affinity came from a chunk
      // intersection that reported an empty scene almost always, so the real
      // effect was that above-band competencies were withheld unconditionally.
      // The comprehension floor is the honest gate; what a scene calls for is
      // the Teacher's judgment, made later against the situation.
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),
            adios: makeCard("adios", 0.90)
          },
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [FIXTURE_FUNCTIONS[0], B1_FN]
        },
        scene: {
          sceneId: "test",
          dayIndex: null,
          sceneLemmaIds: ["hola", "adios"] // 2/2 = 1.0 >= 0.80
        }
      });
      const schedule = scheduler.compute(board);
      expect(schedule.stretchAllowanceActive).toBe(true);
      expect(schedule.teachables.some((t) => t.id === "negotiate")).toBe(true);
    });

    it("only one stretch item is added even when multiple above-band functions qualify", () => {
      const B1_FN_2 = {
        competencyId: "ask-directions",
        displayName: "Ask directions",
        cefrDescriptor: "",
        band: "B1" as const,
        chunks: {} as Record<string, { chunkId: string }[]>
      } as unknown as Competency;
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { hola: makeCard("hola", 0.95), adios: makeCard("adios", 0.90) },
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [FIXTURE_FUNCTIONS[0], A2_FN, B1_FN_2]
        },
        scene: {
          sceneId: "test",
          dayIndex: null,
          sceneLemmaIds: ["hola", "adios"] // 2/2 = 1.0 >= 0.80
        }
      });
      const schedule = scheduler.compute(board);
      const stretchItems = schedule.teachables.filter((t) => t.teachReason === "stretch");
      expect(stretchItems).toHaveLength(1);
    });

    it("familiarityBoost increases priority when some chunks are already known", () => {
      const fnWithChunks = {
        competencyId: "greet-formal",
        displayName: "Formal greeting",
        cefrDescriptor: "",
        band: "A1" as const,
        chunks: { es: [{ chunkId: "buenos_dias" }, { chunkId: "buenas_tardes" }] }
      } as unknown as Competency;
      const fnNoChunks = {
        competencyId: "farewell-simple",
        displayName: "Simple farewell",
        cefrDescriptor: "",
        band: "A1" as const,
        chunks: {} as Record<string, { chunkId: string }[]>
      } as unknown as Competency;
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.90),
            "chunk:buenos_dias": makeCard("chunk:buenos_dias", 0.90) // 1/2 chunks known
          },
          fatigueScore: 0
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: [fnWithChunks, fnNoChunks]
        },
        targetLanguage: "es"
      });
      const schedule = scheduler.compute(board);
      const formal = schedule.teachables.find((t) => t.id === "greet-formal");
      const simple = schedule.teachables.find((t) => t.id === "farewell-simple");
      // greet-formal gets (1/2) * 0.05 = 0.025 familiarityBoost; beats farewell-simple at same base
      expect(formal!.priority).toBeGreaterThan(simple!.priority);
    });

    it("schedule always contains sceneComprehensionRate and stretchAllowanceActive", () => {
      const schedule = scheduler.compute(emptyBoard());
      expect(schedule).toHaveProperty("sceneComprehensionRate");
      expect(schedule).toHaveProperty("stretchAllowanceActive");
    });
  });

  describe("strain curve + fluency valleys (087.4)", () => {
    function highStrainBoard(fatigueScore: number, overrides: Parameters<typeof emptyBoard>[0] = {}): SchedulerBoardView {
      return emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: { hola: makeCard("hola", 0.95) },
          fatigueScore
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS
        },
        ...overrides
      });
    }

    it("strainSuppressed is false when fatigueScore is below STRAIN_SUPPRESS_THRESHOLD", () => {
      const board = highStrainBoard(0.50);
      const schedule = scheduler.compute(board);
      expect(schedule.strainSuppressed).toBe(false);
    });

    it("strainSuppressed is true when fatigueScore >= STRAIN_SUPPRESS_THRESHOLD", () => {
      const board = highStrainBoard(0.70);
      const schedule = scheduler.compute(board);
      expect(schedule.strainSuppressed).toBe(true);
    });

    it("introductions are suppressed when strain is high", () => {
      const board = highStrainBoard(0.80);
      const schedule = scheduler.compute(board);
      const hasIntro = schedule.teachables.some(
        (t) => t.teachReason === "introduction" || t.teachReason === "function-affinity" || t.teachReason === "stretch"
      );
      expect(hasIntro).toBe(false);
    });

    it("due items still appear in strain-suppressed mode", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),
            adios: makeCard("adios", 0.30) // overdue
          },
          fatigueScore: 0.80
        },
        curriculum: {
          introducedCompetencyIds: new Set(),
          availableCompetencies: FIXTURE_FUNCTIONS
        }
      });
      const schedule = scheduler.compute(board);
      const dueItems = schedule.teachables.filter((t) => t.teachReason === "due");
      expect(dueItems.length).toBeGreaterThan(0);
      expect(dueItems.some((t) => t.id === "adios")).toBe(true);
    });

    it("fluency items appear when strain is suppressed (well-known lemmas recycled)", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),
            gracias: makeCard("gracias", 0.92),
            adios: makeCard("adios", 0.91)
          },
          fatigueScore: 0.75
        }
      });
      const schedule = scheduler.compute(board);
      const fluencyItems = schedule.teachables.filter((t) => t.teachReason === "fluency");
      expect(fluencyItems.length).toBeGreaterThan(0);
      fluencyItems.forEach((f) => {
        expect(f.kind).toBe("vocabulary");
        expect(f.id).not.toMatch(/^chunk:/);
      });
    });

    it("fluency items are capped at 3 per turn", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),
            gracias: makeCard("gracias", 0.94),
            adios: makeCard("adios", 0.93),
            bueno: makeCard("bueno", 0.92),
            vale: makeCard("vale", 0.91)
          },
          fatigueScore: 0.80
        }
      });
      const schedule = scheduler.compute(board);
      const fluencyItems = schedule.teachables.filter((t) => t.teachReason === "fluency");
      expect(fluencyItems.length).toBeLessThanOrEqual(3);
    });

    it("chunk: cards are excluded from fluency recycling", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.95),
            "chunk:buenos_dias": makeCard("chunk:buenos_dias", 0.99)
          },
          fatigueScore: 0.80
        }
      });
      const schedule = scheduler.compute(board);
      const fluencyItems = schedule.teachables.filter((t) => t.teachReason === "fluency");
      expect(fluencyItems.every((f) => !f.id.startsWith("chunk:"))).toBe(true);
    });

    it("no fluency items appear below the FLUENCY_RETRIEVABILITY_FLOOR", () => {
      const board = emptyBoard({
        learner: {
          cefrBand: "A1",
          cefrConfidence: 0.9,
          lemmaCards: {
            hola: makeCard("hola", 0.85) // below 0.90 floor
          },
          fatigueScore: 0.80
        }
      });
      const schedule = scheduler.compute(board);
      const fluencyItems = schedule.teachables.filter((t) => t.teachReason === "fluency");
      expect(fluencyItems).toHaveLength(0);
    });

    it("below-threshold fatigue degrades to 087.3 behavior (no strainSuppressed, no fluency)", () => {
      const board = highStrainBoard(0.30);
      const schedule = scheduler.compute(board);
      expect(schedule.strainSuppressed).toBe(false);
      expect(schedule.teachables.some((t) => t.teachReason === "fluency")).toBe(false);
      // Function candidates should appear normally
      expect(schedule.teachables.some((t) => t.kind === "competency")).toBe(true);
    });

    it("telemetry includes strainSuppressed flag", async () => {
      const board = highStrainBoard(0.80);
      scheduler.compute(board);
      await telemetry.flush();
      const events = await telemetry.query({ eventKinds: ["scheduler.computed"] });
      const event = events[0] as unknown as Record<string, unknown>;
      expect(event.strainSuppressed).toBe(true);
    });

    it("schedule always contains strainSuppressed", () => {
      const schedule = scheduler.compute(emptyBoard());
      expect(schedule).toHaveProperty("strainSuppressed");
    });
  });
});
