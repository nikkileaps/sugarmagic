/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/scheduler-board-view.ts
 *
 * Purpose: Declares SchedulerBoardView -- the aggregate of learner facts read
 *   in a single turn, from the four places they live.
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
 * Status: active
 */

import type { LemmaCard } from "../types";
import type { Competency } from "../contracts/competency-inventory";

export interface SchedulerLearnerView {
  cefrBand: string;
  /** All lemma cards from the learner profile (keyed by lemmaId; includes chunk: cards). */
  lemmaCards: Record<string, LemmaCard>;
}

export interface SchedulerCurriculumView {
  /** CompetencyIds the learner has been taught (from teach-record-store). */
  introducedCompetencyIds: Set<string>;
  /** Every competency for this language, in declaration order. */
  availableCompetencies: Competency[];
  /**
   * Distinct encounters recorded against an itemId since it was introduced.
   *
   * A count per item, with no target applied. Comparing a count against a
   * target to decide an item is "owed" is a judgement about what to teach, and
   * the Teacher makes those. Items the ledger has never seen are simply absent.
   */
  encounterCounts: Map<string, number>;
}

export interface SchedulerSceneView {
  sceneId: string | null;
  /**
   * 090.2: there is deliberately NO scene-competency field here. Whether a
   * scene calls for a competency is the Teacher's call against the situation,
   * not a precondition applied before it runs.
   */
  /**
   * WORLD_DAY_FACT value (in-game days elapsed since start).
   * Null when authored quests have not yet advanced the world day counter.
   * The debt ledger degrades day-diversity to NPC x scene when null.
   */
  dayIndex: number | null;
}

/**
 * The aggregate of learner facts the scheduler reads.
 *
 * Board (NOT the runtime-core Blackboard) -- superset of:
 *   blackboard facts + bound dialogue/NPC definitions + plugin-owned learner state.
 */
export interface SchedulerBoardView {
  learner: SchedulerLearnerView;
  curriculum: SchedulerCurriculumView;
  scene: SchedulerSceneView;
  conversationId: string;
}
