/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/outer-loop-scheduler.ts
 *
 * Purpose: Implements the deterministic outer-loop scheduler (087.1 skeleton).
 *   Produces a TeachSchedule from a SchedulerBoardView with every decision logged.
 *
 * The scheduler is a pure function of its inputs: given the same board it produces
 * the same schedule. All scheduling decisions are emitted as telemetry so the
 * question "why did it pick greetings now" has a concrete, queryable answer.
 *
 * 087.1 floor:
 *   1. Due items:   lemma cards with retrievability < DUE_RETRIEVABILITY_FLOOR.
 *   2. Unintroduced functions: ordered by CEFR band (A1 highest priority).
 *   3. Scene affinity boost: unintroduced functions present in the scene get a bump;
 *      the current NPC having authored lines for the function gets an extra bump.
 *
 * 087.2 extends:
 *   Debt-service items: introduced items with fewer than TARGET_DEBT_ENCOUNTERS diverse
 *   re-encounters. Priority band sits between FSRS-due and new introductions so debt
 *   service is preferred over introducing yet another item.
 *   Priority formula: 0.80 * (1 - diverseCount / targetCount) -> [0.08, 0.80].
 *
 * 087.3 extends: ZPDES-shaped packing + per-scene comprehension-rate target.
 * 087.4 extends: strain curve + fluency valley scheduling.
 *
 * Exports:
 *   - DUE_RETRIEVABILITY_FLOOR
 *   - OuterLoopSchedulerOptions
 *   - OuterLoopScheduler
 *
 * Relationships:
 *   - Reads only SchedulerBoardView (no plugin-boundary crossings here).
 *   - Emits "scheduler.computed" telemetry events.
 *   - Consumed by SugarlangRuntimeServices (087.1 wiring) and tests.
 *
 * Implements: Plan 087 story 087.1
 *
 * Status: active
 */

import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import type { SchedulerBoardView } from "./scheduler-board-view";
import type { ScheduledTeachable, TeachReason, TeachSchedule } from "./teach-schedule";

/** Retrievability below this = the learner is overdue on this item. */
export const DUE_RETRIEVABILITY_FLOOR = 0.7;

const CEFR_BAND_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

function bandIndex(band: string): number {
  const idx = (CEFR_BAND_ORDER as readonly string[]).indexOf(band);
  return idx < 0 ? CEFR_BAND_ORDER.length : idx;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface OuterLoopSchedulerOptions {
  telemetry?: TelemetrySink;
}

export class OuterLoopScheduler {
  private readonly telemetry: TelemetrySink;

  constructor(options: OuterLoopSchedulerOptions = {}) {
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
  }

  compute(board: SchedulerBoardView): TeachSchedule {
    const { learner, curriculum, scene, conversationId, npcDefinitionId } = board;
    const now = Date.now();

    // Cold start: no card history AND no introduced functions means the learner
    // has not started yet. Return empty schedule so rendering behavior is unchanged.
    const isColdStart =
      Object.keys(learner.lemmaCards).length === 0 &&
      curriculum.introducedFunctionIds.size === 0;

    const dayAxisDegraded = scene.dayIndex === null;

    if (isColdStart) {
      void emitTelemetry(
        this.telemetry,
        createTelemetryEvent("scheduler.computed", {
          timestamp: now,
          conversationId,
          sceneId: scene.sceneId,
          teachableCount: 0,
          isColdStart: true,
          learnerBand: learner.cefrBand,
          fatigueScore: learner.fatigueScore,
          dueItemCount: 0,
          debtServiceCount: 0,
          introductionCount: 0,
          affinityCount: 0,
          topTeachableId: null,
          topTeachableReason: null,
          dayAxisDegraded
        })
      );
      return {
        teachables: [],
        isColdStart: true,
        sceneId: scene.sceneId,
        conversationId
      };
    }

    const candidates: ScheduledTeachable[] = [];

    // --- 1. Due items from FSRS (retrievability below floor) ---
    // chunk: cards are tracked at function-level; only bare lemmaIds get due-ness here.
    for (const card of Object.values(learner.lemmaCards)) {
      if (card.lemmaId.startsWith("chunk:")) continue;
      if (card.retrievability < DUE_RETRIEVABILITY_FLOOR) {
        candidates.push({
          id: card.lemmaId,
          kind: "lemma",
          priority: clamp01(1.0 - card.retrievability),
          teachReason: "due",
          affinityNpcIds: []
        });
      }
    }

    // --- 2. Debt-service items (087.2) ---
    // Introduced items with fewer than TARGET_DEBT_ENCOUNTERS diverse re-encounters.
    // Priority band: 0.80 (fresh) -> 0.08 (nearly done), sitting above new introductions
    // so the scheduler prefers re-feeding an introduced item over adding yet another.
    for (const [itemId, status] of curriculum.activeDebts) {
      const debtFraction = status.diverseEncounterCount / status.targetEncounters;
      const basePriority = clamp01(0.80 * (1 - debtFraction));
      candidates.push({
        id: itemId,
        kind: "lemma",
        priority: basePriority,
        teachReason: "debt-service",
        affinityNpcIds: []
      });
    }

    // --- 3. Unintroduced functions, band ordering as the floor ---
    // Prerequisite edges are deferred to 087.3; band order is the current floor.
    for (const fn of curriculum.availableFunctions) {
      if (curriculum.introducedFunctionIds.has(fn.functionId)) continue;
      // Skip if this function already appears as a debt-service item
      // (a function could theoretically be in both sets during a race; debt wins).
      if (curriculum.activeDebts.has(fn.functionId)) continue;

      // Band-derived base priority: A1 = 0.50, decreasing to C2 = 0.20.
      const bIdx = bandIndex(fn.band);
      const basePriority = 0.50 - (bIdx / CEFR_BAND_ORDER.length) * 0.30;

      // Scene affinity boost: unintroduced functions present in the current scene
      // get a higher priority since there is an authored moment to realize them.
      let affinityBoost = 0;
      const affinityNpcIds: string[] = [];
      const isInScene = scene.functionTags.sceneFunctions.includes(fn.functionId);

      if (isInScene) {
        affinityBoost += 0.15;

        // Collect all NPCs in this scene with authored lines for the function.
        for (const [npcId, npcFns] of Object.entries(scene.functionTags.npcFunctions)) {
          if (npcFns.includes(fn.functionId)) {
            affinityNpcIds.push(npcId);
          }
        }

        // Extra boost when the current NPC can realize the function directly.
        if (
          npcDefinitionId &&
          scene.functionTags.npcFunctions[npcDefinitionId]?.includes(fn.functionId)
        ) {
          affinityBoost += 0.10;
        }
      }

      const teachReason: TeachReason = isInScene ? "function-affinity" : "introduction";

      candidates.push({
        id: fn.functionId,
        kind: "function",
        priority: clamp01(basePriority + affinityBoost),
        teachReason,
        affinityNpcIds
      });
    }

    // Sort descending by priority; break ties alphabetically by id for determinism.
    candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    const dueCount = candidates.filter((c) => c.teachReason === "due").length;
    const debtServiceCount = candidates.filter((c) => c.teachReason === "debt-service").length;
    const introCount = candidates.filter((c) => c.teachReason === "introduction").length;
    const affinityCount = candidates.filter((c) => c.teachReason === "function-affinity").length;

    void emitTelemetry(
      this.telemetry,
      createTelemetryEvent("scheduler.computed", {
        timestamp: now,
        conversationId,
        sceneId: scene.sceneId,
        teachableCount: candidates.length,
        isColdStart: false,
        learnerBand: learner.cefrBand,
        fatigueScore: learner.fatigueScore,
        dueItemCount: dueCount,
        debtServiceCount,
        introductionCount: introCount,
        affinityCount,
        topTeachableId: candidates[0]?.id ?? null,
        topTeachableReason: candidates[0]?.teachReason ?? null,
        dayAxisDegraded
      })
    );

    return {
      teachables: candidates,
      isColdStart: false,
      sceneId: scene.sceneId,
      conversationId
    };
  }
}
