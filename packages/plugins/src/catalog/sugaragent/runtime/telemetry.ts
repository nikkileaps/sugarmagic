/**
 * packages/plugins/src/catalog/sugaragent/runtime/telemetry.ts
 *
 * Purpose: The event sugaragent emits when a turn came out degraded, built
 *   from what the pipeline already decided.
 *
 * Exports:
 *   - SUGARAGENT_TURN_DEGRADED_EVENT_KIND
 *   - TERMINAL_CLOSE_TRIGGER
 *   - buildDegradedTurnEvent
 *
 * WHY THIS EXISTS
 *   An NPC that gives up and reads its canned line decided that in the
 *   browser, and the decision stayed there. In a deployed game the only
 *   evidence was the player's word for it, so "why did the NPC give up?" was
 *   answered by reasoning about what had NOT failed.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 *   Not the player's words and not the NPC's. The player's typing is the PII
 *   the scrubbers exist to remove, and the NPC's line is deterministic from
 *   the trigger, so shipping either would trade the thing this is for against
 *   nothing.
 *
 * Status: active
 */

import {
  createTelemetryEvent,
  type TelemetryEvent
} from "@sugarmagic/runtime-core";
import type { TurnStageDiagnostics } from "./types";

export const SUGARAGENT_TURN_DEGRADED_EVENT_KIND = "sugaragent.turn-degraded";

/**
 * The three-strike close, which runs after every stage has finished and so
 * belongs to no stage. Named here because a `trigger` is otherwise always a
 * stage's own.
 */
export const TERMINAL_CLOSE_TRIGGER = "terminal-close";

export interface DegradedTurnFacts {
  turnId: string;
  sessionId: string;
  /**
   * Which NPC this conversation is with. Sugarlang keys its events on the same
   * value under the name `conversationId`, which is what lets the two
   * producers' events be read together for one conversation.
   */
  npcDefinitionId: string | null;
  stages: Record<string, TurnStageDiagnostics>;
  stalled: boolean;
  autoClosed: boolean;
  terminalClose: boolean;
  consecutiveFallbackTurns: number;
  turnCount: number;
  llmBackend: string;
}

interface DegradedStage {
  stageId: string;
  trigger: string | null;
  fallbackReason: string | null;
}

/**
 * What the Plan stage decided this turn.
 *
 * These three are what `isStalledTurn` actually reads, so without them a
 * conversation that closed cannot be attributed. Observed in prod: a
 * terminal close whose only degraded stage was a Judge language flag --
 * which `isStalledTurn` deliberately does NOT count as a stall. The Judge was
 * innocent and the event named it anyway; the real driver was a `clarify` or
 * `generic-only` verdict that appeared nowhere on the event.
 */
interface PlanVerdict {
  responseIntent: string | null;
  responseSpecificity: string | null;
  turnPath: string | null;
  interpretationIntent: string | null;
  pendingExpectation: string | null;
  hasEvidence: boolean | null;
  noveltyExhausted: boolean | null;
}

/**
 * Reads what Plan recorded. Everything here is already computed -- these are
 * copies, not new work.
 *
 * The last four exist to tell the four routes to `clarify` apart. Plan picks
 * it for a quest question it cannot ground, for input it could not read at
 * all, because the NPC asked a question last turn, or because it has run out
 * of new things to say. Those want opposite fixes, and `responseIntent` alone
 * cannot distinguish them: `responseSpecificity` reads "grounded" for every
 * clarify regardless of evidence, because the generic-only branch only
 * applies to greet, chat and answer.
 */
function readPlanVerdict(
  stages: Record<string, TurnStageDiagnostics>
): PlanVerdict {
  const payload = stages.Plan?.payload;
  const readString = (key: string): string | null =>
    typeof payload?.[key] === "string" ? (payload[key] as string) : null;
  const readBoolean = (key: string): boolean | null =>
    typeof payload?.[key] === "boolean" ? (payload[key] as boolean) : null;
  const novelty = payload?.noveltyState;
  return {
    responseIntent: readString("responseIntent"),
    responseSpecificity: readString("responseSpecificity"),
    turnPath: readString("turnPath"),
    interpretationIntent: readString("interpretationIntent"),
    // Recorded as an object with a `kind`, so read through to the kind.
    pendingExpectation:
      typeof payload?.pendingExpectation === "string"
        ? (payload.pendingExpectation as string)
        : typeof (payload?.pendingExpectation as { kind?: unknown })?.kind ===
            "string"
          ? ((payload!.pendingExpectation as { kind: string }).kind)
          : null,
    hasEvidence: readBoolean("hasEvidence"),
    noveltyExhausted:
      typeof (novelty as { exhausted?: unknown })?.exhausted === "boolean"
        ? ((novelty as { exhausted: boolean }).exhausted)
        : null
  };
}

/**
 * The order the pipeline runs its stages in.
 *
 * Named here because "the deciding stage is the last one to degrade" only
 * means anything against a known order. Reading it off `Object.values` instead
 * would inherit the insertion order of an object literal in provider.ts --
 * true today, silently wrong the day someone reorders that literal, and
 * wrong in a way no test would notice.
 *
 * A stage the pipeline reports but this list does not name still appears; it
 * sorts after the known ones rather than being dropped.
 */
const STAGE_ORDER = [
  "Interpret",
  "Retrieve",
  "Plan",
  "Generate",
  "Judge",
  "Audit",
  "Regenerate"
] as const;

/**
 * The stages that came out degraded, in pipeline order, with the two fields
 * that say why.
 *
 * Keyed off `status`, never off the presence of a `trigger`: RegenerateStage
 * stamps `judge-fail-regen` on a turn it successfully repaired, so a trigger
 * alone does not mean the turn went badly.
 */
function collectDegradedStages(
  stages: Record<string, TurnStageDiagnostics>
): DegradedStage[] {
  const rank = (stageId: string): number => {
    const index = STAGE_ORDER.indexOf(stageId as (typeof STAGE_ORDER)[number]);
    return index === -1 ? STAGE_ORDER.length : index;
  };
  return Object.entries(stages)
    .filter(([, stage]) => stage.status === "degraded")
    .sort(([leftKey], [rightKey]) => rank(leftKey) - rank(rightKey))
    .map(([, stage]) => ({
      stageId: stage.stageId,
      trigger:
        typeof stage.payload?.trigger === "string" ? stage.payload.trigger : null,
      fallbackReason: stage.fallbackReason ?? null
    }));
}

/**
 * Builds the event for a turn, or returns null when the turn was fine.
 *
 * A turn counts as degraded when a stage says so, when the turn STALLED, or
 * when the three-strike close fired.
 *
 * Stalling is its own condition because a turn can stall with every stage
 * reading `ok`: `isStalledTurn` also returns true for a `clarify` intent or a
 * `generic-only` response, neither of which degrades a stage. Those are the
 * turns that accumulate toward the close. Reporting only the close was
 * observed in prod to hide its whole cause -- three consecutive stalls, one
 * event, and nothing saying what the other two turns did.
 *
 * The close is its own condition too, because it replaces the reply after the
 * stages have run.
 */
export function buildDegradedTurnEvent(
  facts: DegradedTurnFacts,
  timestamp: number
): TelemetryEvent | null {
  const degradedStages = collectDegradedStages(facts.stages);
  if (degradedStages.length === 0 && !facts.stalled && !facts.terminalClose) {
    return null;
  }

  // The stage that produced the reply the player saw is the last one to
  // degrade, and the pipeline runs in order. The terminal close outranks it:
  // it is what actually replaced the text.
  const decidingStage = degradedStages.at(-1) ?? null;

  return createTelemetryEvent(SUGARAGENT_TURN_DEGRADED_EVENT_KIND, {
    timestamp,
    turnId: facts.turnId,
    sessionId: facts.sessionId,
    ...(facts.npcDefinitionId ? { conversationId: facts.npcDefinitionId } : {}),
    stageId: facts.terminalClose ? null : (decidingStage?.stageId ?? null),
    trigger: facts.terminalClose
      ? TERMINAL_CLOSE_TRIGGER
      : (decidingStage?.trigger ?? null),
    fallbackReason: facts.terminalClose
      ? null
      : (decidingStage?.fallbackReason ?? null),
    // Every degraded stage, so a turn that failed in more than one place is
    // not reported as though only the last thing went wrong.
    degradedStages,
    // What Plan decided. A stalled turn with no degraded stage is explained by
    // these and nothing else.
    ...readPlanVerdict(facts.stages),
    stalled: facts.stalled,
    autoClosed: facts.autoClosed,
    terminalClose: facts.terminalClose,
    consecutiveFallbackTurns: facts.consecutiveFallbackTurns,
    turnCount: facts.turnCount,
    llmBackend: facts.llmBackend
  });
}
