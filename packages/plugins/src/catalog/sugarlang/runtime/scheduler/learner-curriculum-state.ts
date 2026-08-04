/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/learner-curriculum-state.ts
 *
 * Purpose: What the learner has done with the curriculum, as facts. Which
 *   competencies they have met, how often introduced items have been
 *   re-encountered, and which cards have decayed below the due floor.
 *
 * Nothing here ranks, scores or recommends. The Teacher reads these facts
 * against the situation and decides what to teach; it is the only thing that
 * can see the situation.
 *
 * Exports:
 *   - MetCompetency
 *   - LearnerCurriculumState
 *
 * Relationships:
 *   - Produced by OuterLoopScheduler.compute from a SchedulerBoardView.
 *   - Read by the teacher middleware and rendered into the prompt's learner
 *     state block.
 *
 * Status: active
 */

/** A competency the learner has been taught, and how often it has recurred. */
export interface MetCompetency {
  competencyId: string;
  /**
   * Distinct (npc, scene, day) encounters since introduction.
   *
   * A count, not a verdict. Whether it is enough for the competency to have
   * stuck is a judgement, and judgements about what to teach belong to the
   * Teacher.
   */
  encounterCount: number;
}

/** The learner's standing on the curriculum. Facts only. */
export interface LearnerCurriculumState {
  /** Competencies the learner has been taught, with their encounter counts. */
  met: MetCompetency[];
  /** Competency ids in the inventory the learner has never been taught. */
  unmetCompetencyIds: string[];
  /**
   * Cards whose retrievability has fallen below the due floor.
   *
   * Includes `chunk:` keys once competency cards stop being excluded; a card is
   * a card. Callers that need lemmas only must filter, and say why.
   */
  dueItemIds: string[];
  /**
   * True when the learner has no cards and no teach records -- they have not
   * started. Reported because "nothing to say" and "nothing known" read the
   * same in a prompt and are different facts.
   */
  isColdStart: boolean;
  sceneId: string | null;
  conversationId: string;
}
