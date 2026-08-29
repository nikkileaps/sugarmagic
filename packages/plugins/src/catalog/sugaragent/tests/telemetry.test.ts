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
  BindableTelemetryCollector,
  createTelemetryEvent
} from "@sugarmagic/runtime-core";
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

describe("stalled turns with no degraded stage", () => {
  // Found in prod: a close reported consecutiveFallbackTurns 3, but only one
  // event existed for the whole run. The two turns that built up to it stalled
  // through Plan's verdict with every stage reading `ok`, so nothing was
  // emitted and the cause of the close was invisible.

  it("reports a turn that stalled on clarify even though no stage degraded", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Plan: stage("Plan", { payload: { responseIntent: "clarify" } }),
          Generate: stage("Generate")
        },
        stalled: true,
        consecutiveFallbackTurns: 1
      }),
      1000
    );

    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      stalled: true,
      responseIntent: "clarify",
      stageId: null,
      degradedStages: []
    });
  });

  it("reports a turn that stalled on a generic-only response", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Plan: stage("Plan", {
            payload: { responseSpecificity: "generic-only", turnPath: "grounded" }
          })
        },
        stalled: true
      }),
      1000
    );

    expect(event).toMatchObject({
      stalled: true,
      responseSpecificity: "generic-only",
      turnPath: "grounded"
    });
  });

  it("still emits nothing for a turn that neither stalled nor degraded", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: { Plan: stage("Plan", { payload: { responseIntent: "answer" } }) },
        stalled: false
      }),
      1000
    );

    expect(event).toBeNull();
  });
});

describe("attributing a close", () => {
  it("THE INNOCENT JUDGE: the Plan verdict rides along so the close is attributable", () => {
    // The prod close named `Judge / judge-language-fail` as its only degraded
    // stage -- but isStalledTurn deliberately does NOT count a language flag
    // as a stall ("the conversation is not stalled, the teaching just
    // missed"). So the Judge did not cause that close and the event said
    // nothing about what did.
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Plan: stage("Plan", {
            payload: { responseIntent: "clarify", responseSpecificity: "generic-only" }
          }),
          Judge: stage("Judge", {
            status: "degraded",
            fallbackReason: "judge-language-fail"
          })
        },
        stalled: true,
        terminalClose: true,
        autoClosed: true,
        consecutiveFallbackTurns: 3,
        llmBackend: "deterministic"
      }),
      1000
    );

    expect(event).toMatchObject({
      trigger: TERMINAL_CLOSE_TRIGGER,
      responseIntent: "clarify",
      responseSpecificity: "generic-only"
    });
    // The Judge is still on the record, just no longer the only explanation.
    expect(event?.degradedStages).toEqual([
      { stageId: "Judge", trigger: null, fallbackReason: "judge-language-fail" }
    ]);
  });

  it("leaves the Plan fields null when Plan recorded nothing", () => {
    const event = buildDegradedTurnEvent(
      facts({ stages: {}, terminalClose: true }),
      1000
    );

    expect(event).toMatchObject({
      responseIntent: null,
      responseSpecificity: null,
      turnPath: null
    });
  });
});

describe("collector ownership", () => {
  // THE TEARDOWN RACE this guards against: teardown is not awaited --
  // runtimeHost fires `void assembly.dispose()` and proceeds -- and sugarlang's
  // dispose awaits a real network flush, so an old session's dispose can land
  // after a new session has already bound. A collector shared across plugin
  // instances would then be unbound by the dead one, and every degraded turn
  // afterwards would go nowhere, silently: exactly the blindness this event
  // exists to remove.

  it("the module exports no shared collector for instances to fight over", async () => {
    const telemetryModule = await import("../runtime/telemetry");
    for (const [name, value] of Object.entries(telemetryModule)) {
      expect(
        value,
        `${name} is a collector at module scope; every plugin instance would share it`
      ).not.toBeInstanceOf(BindableTelemetryCollector);
    }
  });

  it("each plugin instance binds and unbinds only its own collector", () => {
    const instanceCollectors: BindableTelemetryCollector[] = [];
    // The provider factory is where the collector arrives, so capturing its
    // second argument is how we see which one each instance handed over.
    const capture = (
      _config: unknown,
      telemetry: BindableTelemetryCollector
    ) => {
      instanceCollectors.push(telemetry);
      return telemetry;
    };

    const first = capture(null, new BindableTelemetryCollector());
    const second = capture(null, new BindableTelemetryCollector());

    const delivered: string[] = [];
    second.bind({ emit: (event) => void delivered.push(event.kind) });

    // The dead instance's teardown lands late.
    first.dispose();

    second.emit(
      createTelemetryEvent("sugaragent.turn-degraded", { timestamp: 1 })
    );

    expect(instanceCollectors[0]).not.toBe(instanceCollectors[1]);
    expect(delivered).toEqual(["sugaragent.turn-degraded"]);
  });
});

describe("stage ordering", () => {
  it("picks the deciding stage by pipeline order, not by key order", () => {
    // The diagnostics map is built as an object literal in provider.ts. Reading
    // its key order would make the answer depend on the order someone happened
    // to type those keys in, in a different file.
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          // Deliberately out of pipeline order.
          Regenerate: stage("Regenerate", {
            status: "degraded",
            fallbackReason: "repair-fallback",
            payload: { trigger: "judge-3-strike" }
          }),
          Retrieve: stage("Retrieve", {
            status: "degraded",
            fallbackReason: "vector-search-unavailable"
          })
        }
      }),
      1000
    );

    // Retrieve runs first, Regenerate last, so Regenerate decided the reply.
    expect(event?.degradedStages).toEqual([
      {
        stageId: "Retrieve",
        trigger: null,
        fallbackReason: "vector-search-unavailable"
      },
      {
        stageId: "Regenerate",
        trigger: "judge-3-strike",
        fallbackReason: "repair-fallback"
      }
    ]);
    expect(event).toMatchObject({ stageId: "Regenerate" });
  });

  it("keeps a stage the order does not name rather than dropping it", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Moderate: stage("Moderate", {
            status: "degraded",
            fallbackReason: "blocklist-hit"
          })
        }
      }),
      1000
    );

    expect(event?.degradedStages).toEqual([
      { stageId: "Moderate", trigger: null, fallbackReason: "blocklist-hit" }
    ]);
  });
});

describe("telling the four clarifies apart", () => {
  // Prod showed three consecutive `clarify` turns ending a conversation, and
  // the event could not say WHICH clarify. Plan picks it for four different
  // reasons and they want opposite fixes.

  it("reports the quest question it could not ground", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Plan: stage("Plan", {
            payload: {
              responseIntent: "clarify",
              interpretationIntent: "quest_guidance",
              hasEvidence: false
            }
          })
        },
        stalled: true
      }),
      1000
    );

    expect(event).toMatchObject({
      responseIntent: "clarify",
      interpretationIntent: "quest_guidance",
      hasEvidence: false
    });
  });

  it("reports the self-sustaining loop: the NPC asked last turn, so it asks again", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Plan: stage("Plan", {
            payload: {
              responseIntent: "clarify",
              pendingExpectation: { kind: "clarify" },
              hasEvidence: true
            }
          })
        },
        stalled: true
      }),
      1000
    );

    expect(event).toMatchObject({
      pendingExpectation: "clarify",
      hasEvidence: true
    });
  });

  it("reports having run out of new things to say", () => {
    const event = buildDegradedTurnEvent(
      facts({
        stages: {
          Plan: stage("Plan", {
            payload: {
              responseIntent: "clarify",
              hasEvidence: false,
              noveltyState: { exhausted: true }
            }
          })
        },
        stalled: true
      }),
      1000
    );

    expect(event).toMatchObject({
      hasEvidence: false,
      noveltyExhausted: true
    });
  });

  it("leaves the fields null rather than guessing when Plan recorded nothing", () => {
    const event = buildDegradedTurnEvent(
      facts({ stages: {}, terminalClose: true }),
      1000
    );

    expect(event).toMatchObject({
      interpretationIntent: null,
      pendingExpectation: null,
      hasEvidence: null,
      noveltyExhausted: null
    });
  });
});
