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
 *   - sugaragentTelemetry
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
  BindableTelemetryCollector,
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

/**
 * The collector sugaragent emits through. Bound to the host's at plugin init;
 * the provider is built before that, so it holds this instead.
 */
export const sugaragentTelemetry = new BindableTelemetryCollector();

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
 * The stages that came out degraded, with the two fields that say why.
 *
 * Keyed off `status`, never off the presence of a `trigger`: RegenerateStage
 * stamps `judge-fail-regen` on a turn it successfully repaired, so a trigger
 * alone does not mean the turn went badly.
 */
function collectDegradedStages(
  stages: Record<string, TurnStageDiagnostics>
): DegradedStage[] {
  return Object.values(stages)
    .filter((stage) => stage.status === "degraded")
    .map((stage) => ({
      stageId: stage.stageId,
      trigger:
        typeof stage.payload?.trigger === "string" ? stage.payload.trigger : null,
      fallbackReason: stage.fallbackReason ?? null
    }));
}

/**
 * Builds the event for a turn, or returns null when the turn was fine.
 *
 * A turn counts as degraded when a stage says so or when the three-strike
 * close fired. The close is its own condition because it replaces the reply
 * after the stages have run, so on that turn the stages can all read `ok`.
 */
export function buildDegradedTurnEvent(
  facts: DegradedTurnFacts,
  timestamp: number
): TelemetryEvent | null {
  const degradedStages = collectDegradedStages(facts.stages);
  if (degradedStages.length === 0 && !facts.terminalClose) {
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
    stalled: facts.stalled,
    autoClosed: facts.autoClosed,
    terminalClose: facts.terminalClose,
    consecutiveFallbackTurns: facts.consecutiveFallbackTurns,
    turnCount: facts.turnCount,
    llmBackend: facts.llmBackend
  });
}
