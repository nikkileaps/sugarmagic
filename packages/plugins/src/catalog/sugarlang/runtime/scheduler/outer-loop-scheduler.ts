/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/outer-loop-scheduler.ts
 *
 * Purpose: Reads the four places learner facts live -- cards, teach records,
 *   the encounter ledger, and the competency inventory -- and assembles one
 *   LearnerCurriculumState for the Teacher to read.
 *
 * It gathers; it does not decide. Whether a competency is worth teaching now
 * depends on the scene and the NPCs present, which only the Teacher can see, so
 * nothing here ranks, scores, gates or truncates. A fact that arrives with a
 * recommendation attached is a second authority on what to teach.
 *
 * Pure: the same board produces the same state.
 *
 * Exports:
 *   - DUE_RETRIEVABILITY_FLOOR (re-export)
 *   - OuterLoopSchedulerOptions
 *   - OuterLoopScheduler
 *
 * Relationships:
 *   - Reads only SchedulerBoardView.
 *   - Emits "scheduler.computed" telemetry.
 *   - Consumed by SugarlangRuntimeServices and the context middleware.
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
import type { LearnerCurriculumState, MetCompetency } from "./learner-curriculum-state";

/**
 * 090.9: `DUE_RETRIEVABILITY_FLOOR` moved to `../learner/learning-status` -- it
 * answers "is this card due", a learner fact that lived here only because the
 * scheduler needed it first. Re-exported so existing importers keep working.
 */
export { DUE_RETRIEVABILITY_FLOOR } from "../learner";
import { getLearningStatus } from "../learner";
import type { CEFRBand } from "../cefr";

export interface OuterLoopSchedulerOptions {
  telemetry?: TelemetrySink;
}

export class OuterLoopScheduler {
  private readonly telemetry: TelemetrySink;

  constructor(options: OuterLoopSchedulerOptions = {}) {
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
  }

  compute(board: SchedulerBoardView): LearnerCurriculumState {
    const { learner, curriculum, scene, conversationId } = board;
    const now = Date.now();

    const isColdStart =
      Object.keys(learner.lemmaCards).length === 0 &&
      curriculum.introducedCompetencyIds.size === 0;

    // Due-ness is a property of a card, not a recommendation about it. `chunk:`
    // keys are NOT excluded: a competency card that has decayed is as much a
    // fact as a lemma card that has. Consumers needing lemmas only filter at
    // the point of use, where the reason for filtering is visible.
    //
    // Asked through `getLearningStatus` rather than compared here. It is the
    // one named answer to where a learner stands on an item, and comparing
    // retrievability directly skipped two things it already knows:
    //
    //   A never-reviewed card is UNSEEN, not due. Seeding gives a card a prior
    //   from the learner's band, and an item two bands up seeds below the due
    //   floor -- so a raw comparison reported every above-band word the learner
    //   had passed as overdue, which is the opposite of true. They have not
    //   forgotten it; they never had it.
    //
    //   An item out of reach is out of reach, whatever its card says.
    const dueItemIds = Object.values(learner.lemmaCards)
      .filter(
        (card) =>
          getLearningStatus({
            card,
            itemBand: card.cefrPriorBand,
            learnerBand: learner.cefrBand as CEFRBand
          }) === "due"
      )
      .map((card) => card.lemmaId)
      .sort();

    // Encounter counts come from the ledger. The ledger reports every item it
    // is tracking, paid or not -- deciding an item is "owed" means comparing a
    // count against a target, and that target is a policy. Report the count.
    const met: MetCompetency[] = [...curriculum.introducedCompetencyIds]
      .map((competencyId) => ({
        competencyId,
        encounterCount: curriculum.encounterCounts.get(competencyId) ?? 0
      }))
      .sort((a, b) => a.competencyId.localeCompare(b.competencyId));

    const unmetCompetencyIds = curriculum.availableCompetencies
      .map((competency) => competency.competencyId)
      .filter((competencyId) => !curriculum.introducedCompetencyIds.has(competencyId))
      .sort();

    void emitTelemetry(
      this.telemetry,
      createTelemetryEvent("scheduler.computed", {
        timestamp: now,
        conversationId,
        sceneId: scene.sceneId,
        isColdStart,
        learnerBand: learner.cefrBand,
        metCompetencyCount: met.length,
        unmetCompetencyCount: unmetCompetencyIds.length,
        dueItemCount: dueItemIds.length,
        dayAxisDegraded: scene.dayIndex === null
      })
    );

    return {
      met,
      unmetCompetencyIds,
      dueItemIds,
      isColdStart,
      sceneId: scene.sceneId,
      conversationId
    };
  }
}
