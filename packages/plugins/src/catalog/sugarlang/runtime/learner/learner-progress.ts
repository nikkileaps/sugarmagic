/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learner-progress.ts
 *
 * Purpose: Where the learner stands on the curriculum, and the one function
 *   that works it out.
 *
 * LearnerProgress is plain data: competencies met and how often each has
 * recurred, competencies never met, and cards that have decayed past the point
 * where the learner would still recall them. No logic, no ranking, no
 * recommendation. Whether any of it is worth teaching now depends on the scene
 * and the NPCs present, which only the Teacher can see.
 *
 * `deriveLearnerProgress` reads several sources and writes one value. It is a
 * function rather than a class because that is all a derivation is; the class
 * it replaced existed because the thing used to be a service in a dependency
 * graph back when it decided what to teach.
 *
 * Exports:
 *   - MetCompetency
 *   - LearnerProgress
 *   - LearnerProgressInputs
 *   - deriveLearnerProgress
 *
 * Relationships:
 *   - Assembled by the context middleware from the learner profile, the teach
 *     records, the encounter ledger and the competency inventory.
 *   - Read by the teacher middleware and rendered into the prompt.
 *
 * Status: active
 */

import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import type { CEFRBand } from "../cefr";
import type { Competency } from "../contracts/competency-inventory";
import type { LemmaCard } from "../types";
import { DUE_RETRIEVABILITY_FLOOR, getItemProgress } from "./item-progress";
import { daysOverdue } from "./fsrs-adapter";
import { bandIndex } from "../cefr";
import { isExponentCardKey } from "../inventory/card-display-name";

/**
 * How many stranded items the progress event names individually. The total is
 * emitted beside it, so a cap is never mistaken for the whole pile.
 */
const MOST_OVERDUE_CAP = 20;

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
export interface LearnerProgress {
  /** Competencies the learner has been taught, with their encounter counts. */
  met: MetCompetency[];
  /** Competency ids in the inventory the learner has never been taught. */
  unmetCompetencyIds: string[];
  /**
   * Cards the learner would no longer reliably recall.
   *
   * Includes `exponent:` keys -- a competency card that has decayed is as much a
   * fact as a word card that has. Callers needing words only filter at the
   * point of use, where the reason for filtering is visible.
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

/** Everything the derivation reads, gathered by the caller. */
export interface LearnerProgressInputs {
  learner: {
    cefrBand: string;
    /** Every card, words and competencies alike. */
    lemmaCards: Record<string, LemmaCard>;
  };
  curriculum: {
    /** CompetencyIds the learner has been taught, from the teach records. */
    introducedCompetencyIds: Set<string>;
    /** Every competency for this language, in declaration order. */
    availableCompetencies: Competency[];
    /**
     * Distinct encounters recorded against an itemId since it was introduced.
     *
     * A count per item, with no target applied. Comparing a count against a
     * target to decide an item is "owed" is a judgement about what to teach,
     * and the Teacher makes those. Items the ledger has never seen are absent.
     */
    encounterCounts: Map<string, number>;
  };
  scene: {
    sceneId: string | null;
    /**
     * In-game days elapsed. Null when authored quests have not advanced the
     * world day; the encounter ledger degrades diversity to npc x scene then.
     */
    dayIndex: number | null;
  };
  conversationId: string;
}

/**
 * Reads the four places learner facts live and returns one value.
 *
 * Pure: the same inputs produce the same progress.
 */
export function deriveLearnerProgress(
  inputs: LearnerProgressInputs,
  telemetry: TelemetrySink = createNoOpTelemetrySink()
): LearnerProgress {
  const { learner, curriculum, scene, conversationId } = inputs;
  const now = Date.now();

  const isColdStart =
    Object.keys(learner.lemmaCards).length === 0 &&
    curriculum.introducedCompetencyIds.size === 0;

  // Asked through `getItemProgress` rather than compared here. It is the one
  // named answer to where a learner stands on an item, and comparing
  // retrievability directly skipped two things it already knows:
  //
  //   A never-reviewed card is UNSEEN, not due. Seeding gives a card a prior
  //   from the learner's band, and an item two bands up seeds below the due
  //   floor -- so a raw comparison reported every above-band word the learner
  //   had passed as overdue. They have not forgotten it; they never had it.
  //
  //   An item out of reach is out of reach, whatever its card says.
  const dueCards = Object.values(learner.lemmaCards).filter(
    (card) =>
      getItemProgress({
        card,
        itemBand: card.cefrPriorBand,
        learnerBand: learner.cefrBand as CEFRBand
      }) === "due"
  );
  // MOST FORGOTTEN FIRST, not alphabetical. Consumers take the head of this
  // list -- the lore-search bias uses the first three -- so the order is a
  // ranking, not a presentation detail. Sorting by id meant `anden` always beat
  // `queso` no matter which one the learner was actually losing.
  //
  // Ties break on id so the list stays deterministic, which the directive
  // cache and the telemetry both rely on.
  const dueItemIds = dueCards
    .sort(
      (left, right) =>
        left.retrievability - right.retrievability ||
        left.lemmaId.localeCompare(right.lemmaId)
    )
    .map((card) => card.lemmaId);

  // STRANDED ITEMS. Ignoring a due item because the moment does not afford it
  // is correct behaviour, so the pile is tuned in aggregate rather than gated
  // in code -- but tuning needs to know WHICH items are stuck and for how
  // long, and a count can only say the pile is growing.
  const learnerBandIndex = bandIndex(learner.cefrBand as CEFRBand);
  const overdue = dueCards
    .map((card) => ({
      itemId: card.lemmaId,
      daysOverdue: daysOverdue(card, now, DUE_RETRIEVABILITY_FLOOR),
      isCompetency: isExponentCardKey(card.lemmaId)
    }))
    .sort((left, right) => right.daysOverdue - left.daysOverdue);

  const met: MetCompetency[] = [...curriculum.introducedCompetencyIds]
    .map((competencyId) => ({
      competencyId,
      encounterCount: curriculum.encounterCounts.get(competencyId) ?? 0
    }))
    .sort((left, right) => left.competencyId.localeCompare(right.competencyId));

  const unmetCompetencyIds = curriculum.availableCompetencies
    .map((competency) => competency.competencyId)
    .filter((competencyId) => !curriculum.introducedCompetencyIds.has(competencyId))
    .sort();

  void emitTelemetry(
    telemetry,
    createTelemetryEvent("learner.progress-derived", {
      timestamp: now,
      conversationId,
      sceneId: scene.sceneId,
      isColdStart,
      learnerBand: learner.cefrBand,
      metCompetencyCount: met.length,
      unmetCompetencyCount: unmetCompetencyIds.length,
      dueItemCount: dueItemIds.length,
      dueCompetencyCount: overdue.filter((entry) => entry.isCompetency).length,
      dueWordCount: overdue.filter((entry) => !entry.isCompetency).length,
      dueBelowLearnerBandCount:
        learnerBandIndex < 0
          ? 0
          : dueCards.filter((card) => {
              return bandIndex(card.cefrPriorBand) < learnerBandIndex;
            }).length,
      mostOverdue: overdue.slice(0, MOST_OVERDUE_CAP),
      mostOverdueCap: MOST_OVERDUE_CAP,
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
