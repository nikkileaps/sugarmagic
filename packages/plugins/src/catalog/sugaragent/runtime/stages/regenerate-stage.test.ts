/**
 * Plan 075.2 -- RegenerateStage unit tests
 *
 * Covers:
 *  - passthrough: both audit + judge pass
 *  - deterministic fallback: audit violation (regardless of judge)
 *  - passthrough: judge error occurred (fail-open)
 *  - passthrough: judge skipped
 *  - deterministic fallback: 3-strike governor active
 *  - deterministic fallback: judge failed, no LLM provider
 *  - regen succeeds: LLM provides clean text, re-lint passes
 *  - deterministic fallback: regen text still fails re-lint
 *  - cost cap: at most one extra LLM call per turn
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { RegenerateStage } from "./RegenerateStage";
import type { LLMProvider } from "../clients";

function makeContext() {
  return {
    turnId: "t1",
    sessionId: "s1",
    pluginId: "sugaragent",
    selection: { conversationKind: "free-form" as const, npcDefinitionId: "npc-1" },
    config: {
      proxyBaseUrl: "https://test-proxy.local",
      gatewayBearerToken: "",
      loreSourceKind: "local" as const,
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      maxLoreResults: 4,
      maxLoreCharsPerItem: 600,
      debugLogging: false,
      tone: "",
      moderationEnabled: false,
      blocklist: ""
    },
    logStageStart() { return undefined; },
    logStageEnd() { return undefined; }
  };
}

type PartialInput = {
  auditPassed?: boolean;
  judgePassed?: boolean;
  judgeErrorOccurred?: boolean;
  judgeSkipped?: boolean;
  consecutiveJudgeFailures?: number;
  generateText?: string;
  violations?: string[];
  repairHint?: string | null;
};

function makeInput(overrides: PartialInput = {}) {
  return {
    execution: {
      selection: {
        conversationKind: "free-form" as const,
        npcDefinitionId: "npc-1",
        npcDisplayName: "Mira",
        interactionMode: "agent" as const
      },
      input: { kind: "free_text" as const, text: "hello" },
      state: {},
      annotations: {} as Record<string, unknown>,
      runtimeContext: {
        here: null,
        playerLocation: null,
        playerPosition: null,
        playerArea: null,
        npcLocation: null,
        npcPosition: null,
        npcArea: null,
        npcPlayerRelation: null,
        npcBehavior: null,
        trackedQuest: null,
        activeQuestStage: null,
        activeQuestObjectives: null
      }
    },
    state: {
      sessionId: "s1",
      turnCount: 1,
      consecutiveFallbackTurns: 0,
      consecutiveJudgeFailures: overrides.consecutiveJudgeFailures ?? 0,
      closeRequested: false,
      history: [],
      lastTurnDiagnostics: {}
    },
    interpret: {
      userText: "hello",
      queryType: "conversation" as const,
      interpretation: {
        intent: "social_chat" as const,
        lane: "social" as const,
        target: "self" as const,
        facet: "identity" as const,
        timeframe: "current" as const,
        socialMove: "greeting" as const,
        contextAnchor: "none" as const,
        declaredIdentityName: null,
        focusText: "",
        confidence: 0.9,
        margin: 0.4,
        ambiguous: false
      },
      turnRouting: { path: "grounded" as const, socialFastPathEligible: false, factualRiskSignals: [] },
      pendingExpectation: { kind: "none" as const },
      searchQuery: "",
      shouldCloseAfterReply: false
    },
    retrieve: {
      loreContext: [],
      loreSearchPerformed: false
    },
    plan: {
      responseIntent: "chat" as const,
      responseGoal: "chat naturally",
      responseSpecificity: "grounded" as const,
      turnPath: "grounded" as const,
      initiativeAction: "player_respond" as const,
      noveltyState: { repeatedUserMessage: false, repeatedAssistantReplyRisk: false, exhausted: false, recentAssistantQuestionCount: 0 },
      claims: [],
      actionProposals: [],
      replyInputMode: "advance" as const,
      replyPlaceholder: ""
    },
    generate: {
      text: overrides.generateText ?? "The sky looks nice today.",
      usedLlm: true,
      llmBackend: "anthropic" as const,
      actionProposals: []
    },
    judge: {
      passed: overrides.judgePassed ?? true,
      violations: overrides.violations ?? [],
      repairHint: overrides.repairHint ?? null,
      skipped: overrides.judgeSkipped ?? false,
      errorOccurred: overrides.judgeErrorOccurred ?? false
    },
    audit: {
      passed: overrides.auditPassed ?? true,
      violations: []
    }
  };
}

function makeLlmProvider(replyText: string): LLMProvider {
  return {
    generateStructuredTurn: vi.fn().mockResolvedValue({
      text: replyText,
      usage: null,
      model: "claude-haiku-4-5"
    })
  };
}

describe("RegenerateStage", () => {
  it("passes through unchanged when both audit and judge pass", async () => {
    const stage = new RegenerateStage(null);
    const input = makeInput({ auditPassed: true, judgePassed: true });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.text).toBe("The sky looks nice today.");
    expect(result.output.repaired).toBe(false);
    expect(result.output.llmBackend).toBe("anthropic");
    expect(result.status).toBe("ok");
  });

  it("deterministic fallback on audit violation regardless of judge", async () => {
    const stage = new RegenerateStage(null);
    const input = makeInput({ auditPassed: false, judgePassed: true });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(true);
    expect(result.output.llmBackend).toBe("deterministic");
    expect(result.diagnostics.payload).toMatchObject({ trigger: "audit-violations" });
    expect(result.status).toBe("degraded");
  });

  it("passes through on judge error (fail-open)", async () => {
    const stage = new RegenerateStage(null);
    const input = makeInput({ auditPassed: true, judgePassed: true, judgeErrorOccurred: true });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(false);
    expect(result.output.llmBackend).toBe("anthropic");
    expect(result.status).toBe("ok");
  });

  it("passes through when judge was skipped", async () => {
    const stage = new RegenerateStage(null);
    const input = makeInput({ auditPassed: true, judgePassed: true, judgeSkipped: true });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(false);
    expect(result.status).toBe("ok");
  });

  it("deterministic fallback when 3-strike governor is active", async () => {
    const stage = new RegenerateStage(makeLlmProvider("Fixed reply."));
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      consecutiveJudgeFailures: 3,
      violations: ["Broke character."]
    });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(true);
    expect(result.output.llmBackend).toBe("deterministic");
    expect(result.diagnostics.payload).toMatchObject({ trigger: "judge-3-strike" });
    expect(result.status).toBe("degraded");
  });

  it("deterministic fallback when judge failed but no LLM provider", async () => {
    const stage = new RegenerateStage(null);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Broke character."]
    });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(true);
    expect(result.output.llmBackend).toBe("deterministic");
    expect(result.diagnostics.payload).toMatchObject({ trigger: "judge-fail-no-provider" });
  });

  it("returns regen text (repaired=true) when LLM regen passes re-lint", async () => {
    const llmProvider = makeLlmProvider("The harvest has been plentiful this season.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["NPC hinted at external meta context."],
      repairHint: "Stay in character and reference only in-world knowledge."
    });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(true);
    expect(result.output.text).toBe("The harvest has been plentiful this season.");
    expect(result.output.llmBackend).toBe("anthropic");
    expect(result.status).toBe("ok");
    expect(llmProvider.generateStructuredTurn).toHaveBeenCalledOnce();
  });

  it("falls back deterministically when regen text still fails re-lint", async () => {
    // Meta-leak text that will fail findMetaLeakViolations
    const llmProvider = makeLlmProvider("As an AI language model, I cannot discuss that.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Contains external references."]
    });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.repaired).toBe(true);
    expect(result.output.llmBackend).toBe("deterministic");
    expect(llmProvider.generateStructuredTurn).toHaveBeenCalledOnce();
  });

  it("never makes more than one extra LLM call per turn (cost cap)", async () => {
    const llmProvider = makeLlmProvider("Good clean reply.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Off-character."]
    });
    await stage.execute(input as never, makeContext() as never);

    // Only one regen call -- no second judge, no recursive regen
    expect(llmProvider.generateStructuredTurn).toHaveBeenCalledTimes(1);
  });
});
