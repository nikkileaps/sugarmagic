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
 *   2. Unintroduced competencies: ordered by CEFR band (A1 highest priority).
 *   3. Scene affinity boost: unintroduced competencies present in the scene get a bump;
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
import { estimateSceneComprehensionRate, STRETCH_COMPREHENSION_FLOOR } from "./comprehension-rate";
import { CEFR_BAND_ORDER } from "../contracts/learner-profile";

/**
 * 090.9: `DUE_RETRIEVABILITY_FLOOR` and `FLUENCY_RETRIEVABILITY_FLOOR` moved to
 * `../learner/learning-status`. They answer "is this card due" and "does the
 * learner know this" -- learner facts that lived here only because the scheduler
 * needed them first. Re-exported so existing importers keep working.
 */
export {
  DUE_RETRIEVABILITY_FLOOR,
  FLUENCY_RETRIEVABILITY_FLOOR
} from "../learner/learning-status";
import {
  DUE_RETRIEVABILITY_FLOOR,
  FLUENCY_RETRIEVABILITY_FLOOR
} from "../learner/learning-status";

/**
 * 087.4: When fatigueScore reaches this threshold, the scheduler enters strain-suppressed
 * mode: introductions, function-affinity, and stretch candidates are dropped and fluency
 * items (well-known lemmas) are surfaced instead. Modeled on L4D's tension-relief curve.
 *
 * At 0.70 the learner needs (e.g.) 35 turns + heavy hovering or 3/4 probes failed.
 * The valley ends naturally as hoverRate drops with familiar material.
 */
export const STRAIN_SUPPRESS_THRESHOLD = 0.70;


/** Max fluency items surfaced per turn in strain-suppressed mode. */
const FLUENCY_ITEM_CAP = 3;

// 090.9: was a local copy, one of six. The order lives in contracts now.

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
    const { learner, curriculum, scene, conversationId, npcDefinitionId, targetLanguage } = board;
    const now = Date.now();

    // Cold start: no card history AND no introduced competencies means the learner
    // has not started yet. Return empty schedule so rendering behavior is unchanged.
    const isColdStart =
      Object.keys(learner.lemmaCards).length === 0 &&
      curriculum.introducedCompetencyIds.size === 0;

    const dayAxisDegraded = scene.dayIndex === null;
    const sceneComprehensionRate = estimateSceneComprehensionRate(learner.lemmaCards, scene.sceneLemmaIds);
    const strainSuppressed = learner.fatigueScore >= STRAIN_SUPPRESS_THRESHOLD;

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
          stretchCount: 0,
          topTeachableId: null,
          topTeachableReason: null,
          dayAxisDegraded,
          sceneComprehensionRate,
          stretchAllowanceActive: false,
          strainSuppressed: false
        })
      );
      return {
        teachables: [],
        isColdStart: true,
        sceneId: scene.sceneId,
        conversationId,
        sceneComprehensionRate,
        stretchAllowanceActive: false,
        strainSuppressed: false
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
          kind: "vocabulary",
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
        // Carried from the ledger record: function debts must stay kind
        // "function" so they remain realizable as chunk refs and never reach
        // lemma-only consumers as a bogus lemmaId.
        kind: status.itemKind,
        priority: basePriority,
        teachReason: "debt-service",
        affinityNpcIds: []
      });
    }

    // --- 3. Unintroduced competencies, band ordering as the floor ---
    // Skipped entirely in strain-suppressed mode (087.4). When strain is high the
    // scheduler surfaces fluency items (section 4) instead of new introductions.
    //
    // Above-band (band+1) competencies are gated behind the stretch allowance:
    // only one is included per turn, only when scene comprehension >= STRETCH_COMPREHENSION_FLOOR,
    // and only when the function has scene affinity.
    const learnerBandIdx = bandIndex(learner.cefrBand);
    let stretchCandidateAdded = false;

    if (!strainSuppressed) for (const fn of curriculum.availableCompetencies) {
      if (curriculum.introducedCompetencyIds.has(fn.competencyId)) continue;
      if (curriculum.activeDebts.has(fn.competencyId)) continue;

      const fnBandIdx = bandIndex(fn.band);
      const isAboveBand = fnBandIdx > learnerBandIdx;

      // Stretch gate: above-band functions require a comprehension floor, and
      // only one is allowed per turn.
      //
      // 090.2 removed a third condition here -- scene affinity. It asked whether
      // the scene's compiled chunks intersected the competency's target-language
      // forms, which could only be true if Spanish had leaked into English
      // authored text, so it was gating on a question that answered "no" almost
      // always. Whether a scene calls for a competency is the Teacher's call
      // against the situation, not a precondition applied before it runs.
      if (isAboveBand) {
        if (stretchCandidateAdded) continue;
        if (sceneComprehensionRate < STRETCH_COMPREHENSION_FLOOR) continue;
      }

      // familiarityBoost (087.3): fraction of constituent chunks already in card store × 0.05.
      // Rewards progress toward a function even before formal introduction.
      const chunks = fn.chunks[targetLanguage] ?? [];
      const knownChunkCount = chunks.filter((c) => `chunk:${c.chunkId}` in learner.lemmaCards).length;
      const familiarityBoost = chunks.length > 0 ? (knownChunkCount / chunks.length) * 0.05 : 0;

      // Band-derived base priority: A1 = 0.50, decreasing to C2 = 0.20.
      const basePriority = 0.50 - (fnBandIdx / CEFR_BAND_ORDER.length) * 0.30;

      // 090.2: scene-affinity boosts (+0.15 in-scene, +0.10 for the bound NPC)
      // were removed with the field they read. They were scene-content ranking
      // computed before the Teacher runs -- the budgeter's shape -- and they
      // sourced from a gate that reported an empty scene almost always, so the
      // boosts were dead in practice as well as wrong in principle.
      const teachReason: TeachReason = isAboveBand ? "stretch" : "introduction";

      if (isAboveBand) stretchCandidateAdded = true;

      candidates.push({
        id: fn.competencyId,
        kind: "competency",
        priority: clamp01(basePriority + familiarityBoost),
        teachReason,
        affinityNpcIds: []
      });
    }

    const stretchAllowanceActive = stretchCandidateAdded;

    // --- 4. Fluency recycling (087.4, strain-suppressed mode only) ---
    // Surface well-known lemmas (retrievability >= FLUENCY_RETRIEVABILITY_FLOOR) as positive
    // reinforcement. These are things the learner already knows, included so NPCs use familiar
    // phrases during the valley period. Capped at FLUENCY_ITEM_CAP per turn.
    // Mentor-line delivery timing: deferred to when a mentor NPC ships in authored content.
    // Revisit at this section when a mentor NPC exists (see plan 087 deferred list).
    if (strainSuppressed) {
      let fluencyAdded = 0;
      for (const [lemmaId, card] of Object.entries(learner.lemmaCards)) {
        if (fluencyAdded >= FLUENCY_ITEM_CAP) break;
        if (lemmaId.startsWith("chunk:")) continue;
        if (card.retrievability < FLUENCY_RETRIEVABILITY_FLOOR) continue;
        candidates.push({
          id: lemmaId,
          kind: "vocabulary",
          priority: card.retrievability * 0.20, // low band: below due/debt but present
          teachReason: "fluency",
          affinityNpcIds: []
        });
        fluencyAdded += 1;
      }
    }

    // Sort descending by priority; break ties alphabetically by id for determinism.
    candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    const dueCount = candidates.filter((c) => c.teachReason === "due").length;
    const debtServiceCount = candidates.filter((c) => c.teachReason === "debt-service").length;
    const introCount = candidates.filter((c) => c.teachReason === "introduction").length;
    const affinityCount = candidates.filter((c) => c.teachReason === "function-affinity").length;
    const stretchCount = candidates.filter((c) => c.teachReason === "stretch").length;

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
        stretchCount,
        topTeachableId: candidates[0]?.id ?? null,
        topTeachableReason: candidates[0]?.teachReason ?? null,
        dayAxisDegraded,
        sceneComprehensionRate,
        stretchAllowanceActive,
        strainSuppressed
      })
    );

    return {
      teachables: candidates,
      isColdStart: false,
      sceneId: scene.sceneId,
      conversationId,
      sceneComprehensionRate,
      stretchAllowanceActive,
      strainSuppressed
    };
  }
}
