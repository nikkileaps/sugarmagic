/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/scheduler-board-view.ts
 *
 * Purpose: Declares SchedulerBoardView -- the aggregate of all inputs the outer-loop
 *   scheduler reads in a single turn.
 *
 * "Board" is the strategy doc's metaphor for everything the teacher can see.
 * This type is NOT the runtime-core Blackboard -- it is a superset of it:
 * blackboard facts + bound definitions + plugin-owned learner state.
 * Nothing in this module crosses the plugin boundary; it aggregates only
 * published, readable state.
 *
 * Exports:
 *   - SchedulerLearnerView
 *   - SchedulerCurriculumView
 *   - SchedulerSceneView
 *   - SchedulerBoardView
 *
 * Relationships:
 *   - Assembled by the context middleware (sugar-lang-context-middleware.ts).
 *   - Consumed by OuterLoopScheduler (outer-loop-scheduler.ts).
 *
 * Implements: Plan 087 story 087.1
 *
 * Status: active
 */

import type { LemmaCard } from "../types";
import type { Competency } from "../contracts/competency-inventory";
import type { DebtStatus } from "../learner/encounter-debt-ledger";

export interface SchedulerLearnerView {
  cefrBand: string;
  cefrConfidence: number;
  /** All lemma cards from the learner profile (keyed by lemmaId; includes chunk: cards). */
  lemmaCards: Record<string, LemmaCard>;
  /** 0-1 fatigue signal from session-signals (hoverRate, probeFailRate, latency, turns). */
  fatigueScore: number;
}

export interface SchedulerCurriculumView {
  /** CompetencyIds the learner has formally been taught (from teach-record-store). */
  introducedCompetencyIds: Set<string>;
  /**
   * All available functions for this language in declaration order.
   * The scheduler uses band ordering as its ordering floor.
   * Prerequisite edges are added in 087.3 (no edges in the inventory schema today --
   * contracts/competency-inventory.ts:53-80).
   * Revisit: when authored prerequisite data ships, wire it here.
   */
  availableCompetencies: Competency[];
  /**
   * 087.2: Unpaid encounter debts by itemId (lemmaId or competencyId).
   * Only debts with diverseEncounterCount < targetEncounters are included.
   * Built from EncounterDebtLedger.getActiveDebts() in the context middleware.
   */
  activeDebts: Map<string, DebtStatus>;
}

export interface SchedulerSceneView {
  sceneId: string | null;
  /**
   * 090.2: there is deliberately NO scene-competency field here.
   *
   * The scheduler ranks on LEARNER state -- what is due, introduced, in debt,
   * and fatigue -- which is spaced-repetition bookkeeping and not a judgment.
   * Whether a scene calls for a given competency is scene-content ranking, which
   * is the budgeter's job wearing the scheduler's clothes, and it belongs to the
   * Teacher reading the situation (090.3 composes it, 090.4 decides).
   */
  /**
   * WORLD_DAY_FACT value (in-game days elapsed since start).
   * Null when authored quests have not yet advanced the world day counter.
   * The debt ledger (087.2) degrades day-diversity to NPC x scene when null.
   */
  dayIndex: number | null;
  /**
   * 087.3: LemmaIds of all non-chunk lemmas in the scene lexicon.
   * Used by OuterLoopScheduler to estimate scene comprehension rate.
   * Empty array when the scene lexicon has not been compiled.
   */
  sceneLemmaIds: string[];
}

/**
 * The aggregate of all publicly-readable inputs the outer-loop scheduler uses.
 *
 * Board (NOT the runtime-core Blackboard) -- superset of:
 *   blackboard facts + bound dialogue/NPC definitions + plugin-owned learner state.
 */
export interface SchedulerBoardView {
  learner: SchedulerLearnerView;
  curriculum: SchedulerCurriculumView;
  scene: SchedulerSceneView;
  conversationId: string;
  npcDefinitionId: string | null;
  targetLanguage: string;
}
