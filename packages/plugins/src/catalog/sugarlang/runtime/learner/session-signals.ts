/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/session-signals.ts
 *
 * Purpose: Implements the pure derived session-signal helpers used by learner-state updates.
 *
 * Exports:
 *   - SessionEvent
 *   - SESSION_FATIGUE_TURN_WEIGHT
 *   - SESSION_FATIGUE_HOVER_WEIGHT
 *   - SESSION_FATIGUE_RETRY_WEIGHT
 *   - SESSION_FATIGUE_LATENCY_WEIGHT
 *   - computeFatigueScore
 *   - computeHoverRate
 *   - computeRetryRate
 *
 * Relationships:
 *   - Depends on learner-profile session types.
 *   - Is consumed by LearnerStateReducer when it derives current-session state.
 *
 * Implements: Proposal 001 §Learner State Model / §Implicit Signal Collection
 *
 * Status: active
 */

import type { CurrentSessionSignals } from "../types";

export type SessionEvent =
  | { kind: "turn-completed" }
  | { kind: "lemma-seen"; count?: number }
  | { kind: "lemma-hover"; count?: number }
  | { kind: "verifier-retry"; count?: number }
  | { kind: "response-latency"; latencyMs: number };

export const SESSION_FATIGUE_TURN_WEIGHT = 0.3;
export const SESSION_FATIGUE_HOVER_WEIGHT = 0.25;
export const SESSION_FATIGUE_RETRY_WEIGHT = 0.25;
export const SESSION_FATIGUE_LATENCY_WEIGHT = 0.2;

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function getEventCount(events: SessionEvent[], kind: SessionEvent["kind"]): number {
  return events.reduce((count, event) => {
    if (event.kind !== kind) {
      return count;
    }
    if ("count" in event && typeof event.count === "number") {
      return count + event.count;
    }
    return count + 1;
  }, 0);
}

export function computeHoverRate(sessionEvents: SessionEvent[]): number {
  const lemmasSeen = getEventCount(sessionEvents, "lemma-seen");
  if (lemmasSeen === 0) {
    return 0;
  }
  return getEventCount(sessionEvents, "lemma-hover") / lemmasSeen;
}

export function computeRetryRate(sessionEvents: SessionEvent[]): number {
  const turns = getEventCount(sessionEvents, "turn-completed");
  if (turns === 0) {
    return 0;
  }
  return getEventCount(sessionEvents, "verifier-retry") / turns;
}

/**
 * v1 fatigue model:
 *
 * 0.30 * (turns / 50)
 * + 0.25 * hoverRate
 * + 0.25 * retryRate
 * + 0.20 * (avgResponseLatencyMs / 30000)
 *
 * The weights are kept as named exports for auditability and later tuning.
 */
export function computeFatigueScore(session: CurrentSessionSignals): number {
  if (session.turns <= 0) {
    return 0;
  }

  return clamp01(
    SESSION_FATIGUE_TURN_WEIGHT * (session.turns / 50) +
      SESSION_FATIGUE_HOVER_WEIGHT * session.hoverRate +
      SESSION_FATIGUE_RETRY_WEIGHT * session.retryRate +
      SESSION_FATIGUE_LATENCY_WEIGHT * (session.avgResponseLatencyMs / 30000)
  );
}
