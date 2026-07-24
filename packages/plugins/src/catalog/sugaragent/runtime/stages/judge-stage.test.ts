/**
 * Plan 075.1 -- JudgeStage unit tests
 *
 * Covers:
 *  - skip: deterministic/no-llm text -> skipped, passed=true
 *  - skip: no judgeProvider -> skipped, passed=true
 *  - short-circuit: meta-leak regex violation -> passed=false, no LLM call
 *  - pass: provider returns passed=true
 *  - fail: provider returns passed=false
 *  - fail-open: provider throws -> passed=true, errorOccurred=true
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { JudgeStage } from "./JudgeStage";
import type { JudgeProvider } from "../clients";

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

function makeInput(overrides: {
  usedLlm?: boolean;
  text?: string;
  personaDigest?: string;
}) {
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
      consecutiveJudgeFailures: 0,
      closeRequested: false,
      history: [],
      lastTurnDiagnostics: {},
      persona: overrides.personaDigest !== undefined
        ? { pageId: "lore.npc.mira", loaded: true, fallbackReason: null, personaCard: [], coreKnowledge: [], digest: overrides.personaDigest }
        : undefined
    },
    retrieve: {
      loreContext: [],
      loreSearchPerformed: false
    },
    plan: {
      responseIntent: "answer" as const,
      responseGoal: "answer naturally",
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
      text: overrides.text ?? "The market opens at dawn.",
      usedLlm: overrides.usedLlm ?? true,
      llmBackend: "anthropic" as const,
      actionProposals: []
    }
  };
}

function makeProvider(verdict: { passed: boolean; violations: string[]; repairHint: string | null }): JudgeProvider {
  return {
    judgeReply: vi.fn().mockResolvedValue(verdict)
  };
}

describe("JudgeStage", () => {
  it("skips when generate.usedLlm is false", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({ usedLlm: false }) as never, makeContext() as never);

    expect(result.output.skipped).toBe(true);
    expect(result.output.passed).toBe(true);
    expect(provider.judgeReply).not.toHaveBeenCalled();
  });

  it("skips when no judge provider is given", async () => {
    const stage = new JudgeStage(null);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.skipped).toBe(true);
    expect(result.output.passed).toBe(true);
  });

  it("short-circuits with passed=false on meta-leak regex violation (no LLM call)", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);

    // Text containing a meta-leak pattern caught by findMetaLeakViolations
    const input = makeInput({ text: "As an AI language model, I would say..." });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.passed).toBe(false);
    expect(result.output.skipped).toBe(false);
    expect(result.output.violations.length).toBeGreaterThan(0);
    expect(provider.judgeReply).not.toHaveBeenCalled();
    expect(result.diagnostics.payload).toMatchObject({ shortCircuit: "regex-lint" });
  });

  it("returns passed=true when provider approves the reply", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.passed).toBe(true);
    expect(result.output.skipped).toBe(false);
    expect(result.output.errorOccurred).toBe(false);
    expect(result.status).toBe("ok");
    expect(provider.judgeReply).toHaveBeenCalledOnce();
  });

  it("returns passed=false with violations when provider rejects the reply", async () => {
    const violations = ["NPC broke character by mentioning the real world."];
    const provider = makeProvider({ passed: false, violations, repairHint: "Stay in character." });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.passed).toBe(false);
    expect(result.output.violations).toEqual(violations);
    expect(result.output.repairHint).toBe("Stay in character.");
    expect(result.output.skipped).toBe(false);
    expect(result.output.errorOccurred).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.diagnostics.fallbackReason).toBe("judge-fail");
  });

  it("fails open (passed=true, errorOccurred=true) when provider throws", async () => {
    const provider: JudgeProvider = {
      judgeReply: vi.fn().mockRejectedValue(new Error("network timeout"))
    };
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.passed).toBe(true);
    expect(result.output.errorOccurred).toBe(true);
    expect(result.output.skipped).toBe(false);
    expect(result.diagnostics.fallbackReason).toBe("judge-error");
    // Status is degraded but passed=true so the NPC reply is not suppressed.
    expect(result.status).toBe("degraded");
  });
});
