/**
 * packages/plugins/src/catalog/sugarlang/tests/telemetry/debug-panel-data.test.ts
 *
 * Purpose: Verifies rationale-trace and debug-panel aggregation over telemetry fixtures.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/telemetry/debug-panel-data and ../../runtime/telemetry/rationale-trace.
 *   - Keeps the Epic 13 debug readers aligned with the canonical event stream.
 *
 * Implements: Epic 13 Story 13.4 / Story 13.5
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { MemoryTelemetrySink, createTelemetryEvent } from "../../runtime/telemetry/telemetry";
import { DebugPanelDataSource } from "../../runtime/telemetry/debug-panel-data";

describe("DebugPanelDataSource", () => {
  it("lists conversations, turns, and rationale traces from the same event stream", async () => {
    const sink = new MemoryTelemetrySink();
    sink.emit(
      createTelemetryEvent("budgeter.prescription-generated", {
        conversationId: "conversation-1",
        sessionId: "session-1",
        turnId: "turn-1",
        timestamp: 1,
        sceneId: "scene-1",
        learnerSnapshot: {
          learnerId: "learner-1",
          cefrBand: "A2",
          cefrConfidence: 0.6,
          targetLanguage: "es",
          supportLanguage: "en",
          currentSessionTurns: 1,
          knownLemmaCount: 10
        },
        prescription: {
          introduce: [],
          reinforce: [],
          avoid: [],
          budget: { newItemsAllowed: 0 },
          rationale: {
            candidateSetSize: 0,
            envelopeSurvivorCount: 0,
            priorityScores: [],
            reasons: []
          }
        },
        rationale: {
          candidateSetSize: 0,
          envelopeSurvivorCount: 0,
          priorityScores: [],
          reasons: []
        },
        pendingProvisionalSnapshot: [],
        probeFloorState: {
          turnsSinceLastProbe: 0,
          totalPendingLemmas: 0,
          softFloorReached: false,
          hardFloorReached: false
        },
        questEssentialState: {
          activeQuestEssentialLemmas: []
        }
      })
    );
    sink.emit(
      createTelemetryEvent("director.invocation-completed", {
        conversationId: "conversation-1",
        sessionId: "session-1",
        turnId: "turn-1",
        timestamp: 2,
        sceneId: "scene-1",
        npcId: "npc-1",
        npcDisplayName: "Marisol",
        directive: {
          targetVocab: { introduce: [], reinforce: [], avoid: [] },
          supportPosture: "supported",
          targetLanguageRatio: 0.65,
          interactionStyle: "guided_dialogue",
          glossingStrategy: "inline",
          sentenceComplexityCap: "two-clause",
          comprehensionCheck: {
            trigger: false,
            probeStyle: "none",
            targetLemmas: []
          },
          directiveLifetime: { maxTurns: 3, invalidateOn: [] },
          citedSignals: ["test"],
          rationale: "test",
          confidenceBand: "high",
          isFallbackDirective: false
        },
        cacheHit: false,
        fallback: false,
        latencyMs: 12
      })
    );
    sink.emit(
      createTelemetryEvent("chunk.hit-during-classification", {
        conversationId: "conversation-1",
        sessionId: "session-1",
        turnId: "turn-1",
        timestamp: 3,
        sceneId: "scene-1",
        matchedChunks: [
          {
            chunkId: "de_vez_en_cuando",
            cefrBand: "A2",
            surfaceMatched: "de vez en cuando"
          }
        ]
      })
    );

    const dataSource = new DebugPanelDataSource({
      telemetrySink: sink
    });
    const conversations = await dataSource.listRecentConversations();
    const turns = await dataSource.listTurnsInConversation("conversation-1");
    const trace = await dataSource.getTurnRationale("conversation-1", "turn-1");

    expect(conversations[0]?.conversationId).toBe("conversation-1");
    expect(turns[0]?.turnId).toBe("turn-1");
    expect(trace.turnContext.sceneId).toBe("scene-1");
    expect(trace.directive?.directive.rationale).toBe("test");
    expect(trace.matchedChunks).toEqual([
      {
        chunkId: "de_vez_en_cuando",
        cefrBand: "A2",
        surfaceMatched: "de vez en cuando"
      }
    ]);
  });
});
