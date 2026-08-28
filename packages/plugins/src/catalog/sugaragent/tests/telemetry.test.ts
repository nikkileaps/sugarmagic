/**
 * packages/plugins/src/catalog/sugaragent/tests/telemetry.test.ts
 *
 * Purpose: the degraded-turn event says which stage gave up and why, and
 *   carries no player or NPC text.
 *
 * The turn this was written for: a player kept getting the canned line, and
 * the only way to tell which of the causes it was involved reading a
 * screenshot of a text message. Every field here exists to answer that by
 * query instead.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  buildDegradedTurnEvent,
  SUGARAGENT_TURN_DEGRADED_EVENT_KIND,
  TERMINAL_CLOSE_TRIGGER,
  type DegradedTurnFacts
} from "../runtime/telemetry";
import type { TurnStageDiagnostics } from "../runtime/types";

function stage(
  stageId: string,
  overrides: Partial<TurnStageDiagnostics> = {}
): TurnStageDiagnostics {
  return {
    stageId,
    status: "ok",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    payload: {},
    ...overrides
  };
}

function facts(overrides: Partial<DegradedTurnFacts> = {}): DegradedTurnFacts {
  return {
    turnId: "turn-1",
    sessionId: "session-1",
    npcDefinitionId: "npc-penelope",
    stages: {},
    stalled: false,
    autoClosed: false,
    terminalClose: false,
    consecutiveFallbackTurns: 0,
    turnCount: 1,
    llmBackend: "anthropic",
    ...overrides
  };
}

describe("buildDegradedTurnEvent", () => {
  it("emits nothing for a turn that went fine", () => {
    const event = buildDegradedTurnEvent(
      facts({ stages: { Generate: stage("Generate"), Judge: stage("Judge") } }),
      1000
    );
    expect(event).toBeNull();
  });

  it("names the stage that gave up, its trigger, and its fallback reason", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Regenerate: stage("Regenerate", {
            status: "degraded",
            fallbackReason: "repair-fallback",
            payload: { trigger: "judge-3-strike" }
          })
        }
      }),
      1000
    );

    expect(event).toMatchObject({
      kind: SUGARAGENT_TURN_DEGRADED_EVENT_KIND,
      stageId: "Regenerate",
      trigger: "judge-3-strike",
      fallbackReason: "repair-fallback"
    });
  });

  it("joins to sugarlang's events by carrying the NPC as conversationId", () => {
    // Sugarlang keys its events on the same value under the same name. That
    // is what makes one conversation readable across both producers.
    const event = buildDegradedTurnEvent(
      facts({
        npcDefinitionId: "npc-penelope",
        stages: {
          Generate: stage("Generate", {
            status: "degraded",
            fallbackReason: "llm-retry-exhausted"
          })
        }
      }),
      1000
    );

    expect(event).toMatchObject({
      conversationId: "npc-penelope",
      turnId: "turn-1",
      sessionId: "session-1"
    });
  });

  it("THE MISLABEL TRAP: a successful repair is not a degraded turn", () => {
    // RegenerateStage stamps `judge-fail-regen` on a turn where the LLM
    // repaired the reply successfully -- status `ok`, real text, no fallback
    // reason. Keying off the presence of a trigger would report that as the
    // NPC giving up, which is the opposite of what happened.
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Regenerate: stage("Regenerate", {
            status: "ok",
            payload: { trigger: "judge-fail-regen", regenPassed: true }
          })
        }
      }),
      1000
    );

    expect(event).toBeNull();
  });

  it("reports every degraded stage, not only the deciding one", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Retrieve: stage("Retrieve", {
            status: "degraded",
            fallbackReason: "vector-search-unavailable"
          }),
          Regenerate: stage("Regenerate", {
            status: "degraded",
            fallbackReason: "repair-fallback",
            payload: { trigger: "audit-violations" }
          })
        }
      }),
      1000
    );

    expect(event?.degradedStages).toEqual([
      {
        stageId: "Retrieve",
        trigger: null,
        fallbackReason: "vector-search-unavailable"
      },
      {
        stageId: "Regenerate",
        trigger: "audit-violations",
        fallbackReason: "repair-fallback"
      }
    ]);
  });

  it("THE WORST TURN IS LABELLED: the three-strike close reports itself", () => {
    // This runs after every stage has finished, so on this turn the stages
    // can all read `ok` while the player is shown the door. It used to be the
    // only degraded turn carrying no label at all.
    const event = buildDegradedTurnEvent(
      facts({
        stages: { Generate: stage("Generate") },
        terminalClose: true,
        autoClosed: true,
        stalled: true,
        consecutiveFallbackTurns: 3,
        llmBackend: "deterministic"
      }),
      1000
    );

    expect(event).toMatchObject({
      trigger: TERMINAL_CLOSE_TRIGGER,
      terminalClose: true,
      autoClosed: true,
      stalled: true,
      consecutiveFallbackTurns: 3,
      llmBackend: "deterministic"
    });
  });

  it("lets the terminal close outrank a stage, because it replaced the reply", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Regenerate: stage("Regenerate", {
            status: "degraded",
            fallbackReason: "repair-fallback",
            payload: { trigger: "judge-3-strike" }
          })
        },
        terminalClose: true
      }),
      1000
    );

    expect(event).toMatchObject({
      trigger: TERMINAL_CLOSE_TRIGGER,
      stageId: null
    });
    // The stage that also degraded is still on the record.
    expect(event?.degradedStages).toHaveLength(1);
  });

  it("carries no player text and no NPC text", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Regenerate: stage("Regenerate", {
            status: "degraded",
            fallbackReason: "repair-fallback",
            payload: {
              trigger: "audit-violations",
              // RegenerateStage puts a preview of the canned line in its
              // payload. Only named fields are copied out, so it stays there.
              fallbackTextPreview: "Sorry, I need to get back to my work."
            }
          })
        }
      }),
      1000
    );

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Sorry, I need to get back to my work.");
    expect(event).not.toHaveProperty("text");
    expect(event).not.toHaveProperty("inputText");
    expect(event).not.toHaveProperty("userText");
  });
});
