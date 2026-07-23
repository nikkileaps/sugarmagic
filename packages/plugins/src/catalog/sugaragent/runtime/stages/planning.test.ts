/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/planning.test.ts
 *
 * Purpose: Guards resolvePlanDecision grounding signals -- memoryGrounds
 * (Plan 073.3) and questGrounds (Plan 077.1).
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { resolvePlanDecision } from "./planning";
import type { InterpretResult } from "../types";

function baseInterpret(overrides: Partial<InterpretResult> = {}): InterpretResult {
  return {
    userText: "hello",
    queryType: "conversation",
    interpretation: {
      intent: "social_chat",
      lane: "social",
      target: "self",
      facet: "identity",
      timeframe: "current",
      socialMove: "greeting",
      contextAnchor: "none",
      declaredIdentityName: null,
      focusText: "",
      confidence: 0.9,
      margin: 0.4,
      ambiguous: false
    },
    turnRouting: {
      path: "social_fast",
      socialFastPathEligible: true,
      factualRiskSignals: []
    },
    pendingExpectation: { kind: "none" },
    searchQuery: "hello",
    shouldCloseAfterReply: false,
    ...overrides
  };
}

describe("resolvePlanDecision -- questGrounds (077.1)", () => {
  it("routes to grounded specificity when quest world context is present", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret(),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: true,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseSpecificity).toBe("grounded");
  });

  it("stays generic-only when quest is active but no world context was resolved", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret(),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    // social_fast path -> "chat" intent, no evidence, no grounding -> generic-only
    expect(decision.responseSpecificity).toBe("generic-only");
  });

  it("stays generic-only when questWorldContext is absent (undefined)", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret(),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseSpecificity).toBe("generic-only");
  });

  it("is grounded by evidence even without quest world context", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret({ userText: "where is the cheese?", turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] } }),
      hasEvidence: true,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseSpecificity).toBe("grounded");
  });

  it("quest grounding does not override redirect intent for quest_guidance", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret({
        userText: "where do I go?",
        interpretation: {
          intent: "quest_guidance",
          lane: "knowledge",
          target: "world",
          facet: "location",
          timeframe: "current",
          socialMove: "none",
          contextAnchor: "none",
          declaredIdentityName: null,
          focusText: "where do I go",
          confidence: 0.9,
          margin: 0.4,
          ambiguous: false
        },
        turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] }
      }),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: true,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseIntent).toBe("redirect");
    expect(decision.responseSpecificity).toBe("grounded");
  });
});
