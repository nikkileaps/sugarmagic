/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/teach-schedule.ts
 *
 * Purpose: Declares the TeachSchedule artifact produced by the outer-loop scheduler.
 *
 * Exports:
 *   - TeachReason
 *   - ScheduledTeachable
 *   - TeachSchedule
 *
 * Relationships:
 *   - Produced by OuterLoopScheduler (outer-loop-scheduler.ts).
 *   - Consumed by: sugar-lang-context-middleware (writes it as an annotation),
 *     sugar-lang-scripted-middleware (087.5 trigger), SugarLangTeacher (087.6 realizer).
 *
 * Implements: Plan 087 story 087.1
 *
 * Status: active
 */

/**
 * Why a teachable is in this schedule -- the primary explainability signal.
 *
 *   due              FSRS retrievability below the due floor (learner is overdue).
 *   debt-service     Introduced item with fewer than TARGET_DEBT_ENCOUNTERS diverse re-encounters.
 *   introduction     Function or lemma not yet formally introduced; band ordering places it here.
 *   function-affinity Unintroduced function present in the current scene's authored content.
 */
export type TeachReason = "due" | "debt-service" | "introduction" | "function-affinity";

export interface ScheduledTeachable {
  /**
   * For lemma items:    atlas lemmaId (e.g. "comer").
   * For function items: functionId from the inventory (e.g. "greet.formal").
   *
   * 087.3 maps function items to their constituent chunk: refs when building the
   * prescription. Do NOT treat function-kind ids as lemmaIds upstream of that
   * expansion -- the prescriptions expect lemmaIds or chunk:{id} refs only.
   */
  id: string;
  /** Whether this item is a lexical lemma or a communicative function. */
  kind: "lemma" | "function";
  /** Normalized priority in [0, 1]; higher = teach sooner. Descending in the schedule. */
  priority: number;
  /** Why this item is scheduled (telemetry / explainability). */
  teachReason: TeachReason;
  /**
   * NPC definitionIds (in the current scene) whose authored dialogue can realize
   * this teachable. Empty for lemma items or functions with no scene affinity.
   */
  affinityNpcIds: string[];
}

export interface TeachSchedule {
  /** Teachables in descending priority order. */
  teachables: ScheduledTeachable[];
  /**
   * True when the scheduler had no learner state (no cards, no introduced functions).
   * Cold start = empty teachables; rendering behaves exactly as it does today.
   */
  isColdStart: boolean;
  /** Scene the schedule was computed for; null = scene-agnostic (no scene loaded). */
  sceneId: string | null;
  /** Conversation this schedule was computed for. */
  conversationId: string;
}
