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
import { SPOKEN_WORDS_ONLY_RULES } from "./generate/prompt/template";
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
  annotations?: Record<string, unknown>;
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
      annotations: (overrides.annotations ?? {}) as Record<string, unknown>,
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

  it("tells the rewrite to return only spoken words", async () => {
    // The rewrite prompt is built separately from the first attempt's, and used
    // to omit this rule entirely -- which is how prose narration reached a
    // player. Assert against the shared constant so the two cannot drift again.
    const llmProvider = makeLlmProvider("Hola. Me llamo Bo.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["IN-CHARACTER"],
      repairHint: null
    });
    await stage.execute(input as never, makeContext() as never);

    const call = (llmProvider.generateStructuredTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const rule of SPOKEN_WORDS_ONLY_RULES) {
      expect(call.systemPrompt).toContain(rule);
    }
  });

  it("rejects a rewrite that comes back as narration around quoted speech", async () => {
    const llmProvider = makeLlmProvider(
      'I look up from checking the rope on my pack. "Hola." I nod once, ' +
        'watching you for a moment. "Me llamo Bo. Bo Greyfoot." I settle the ' +
        'strap across my shoulder. "Como estas?"'
    );
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["IN-CHARACTER"],
      repairHint: null
    });
    const result = await stage.execute(input as never, makeContext() as never);

    // The re-lint catches it, so the player gets the deterministic fallback
    // rather than a novel excerpt.
    expect(result.output.text).not.toContain("I nod once");
    expect(result.output.llmBackend).toBe("deterministic");
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

  // Plan 084.3 -- regen keeps the constraint
  it("084.3: regen user prompt contains the constraint overlay when contributions are present", async () => {
    const llmProvider = makeLlmProvider("Buenos dias, amigo.");
    const stage = new RegenerateStage(llmProvider);
    const overlay = "Language constraint: reply must be 85% Spanish. Mix Spanish and English naturally.";
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["NPC mentioned the game developer."],
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          generateOverlay: overlay,
          regenDirectives: ["Language mixing is intentional; preserve the Spanish ratio in the corrected reply."]
        }
      }
    });
    await stage.execute(input as never, makeContext() as never);

    const call = (llmProvider.generateStructuredTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.userPrompt).toContain(overlay);
    expect(call.userPrompt).toContain("Language and style constraints");
  });

  it("084.3: regen user prompt is byte-identical to today when no contributions are present", async () => {
    const llmProvider = makeLlmProvider("Good day to you.");
    const stage = new RegenerateStage(llmProvider);
    const inputWithout = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Off-character."]
    });
    await stage.execute(inputWithout as never, makeContext() as never);

    const call = (llmProvider.generateStructuredTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // No constraint block should appear when there are no contributions.
    expect(call.userPrompt).not.toContain("Language and style constraints");
    expect(call.maxTokens).toBe(200);
  });

  it("084.3: maxTokens is raised to 300 when a constraint block is present", async () => {
    const llmProvider = makeLlmProvider("Hola, como estas.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Broke character."],
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          generateOverlay: "85% Spanish constraint."
        }
      }
    });
    await stage.execute(input as never, makeContext() as never);

    const call = (llmProvider.generateStructuredTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.maxTokens).toBe(300);
  });

  // Plan 084.4 -- regen re-lint respects preserveActionTags
  it("084.4: regen re-lint keeps asterisk-tagged reply when preserveActionTags=true", async () => {
    // LLM produces a reply with action tags. Without preserveActionTags those would
    // trip the re-lint and fall through to deterministic fallback. With the flag,
    // the re-lint skips the asterisk pattern and the reply survives.
    const llmProvider = makeLlmProvider("*sweeps hat* Buenos dias, amigo.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Broke character."],
      annotations: {
        "sugaragent.contrib/test-plugin": {
          schemaVersion: 1,
          textConventions: { preserveActionTags: true }
        }
      }
    });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.text).toContain("*sweeps hat*");
    expect(result.output.llmBackend).not.toBe("deterministic");
  });

  it("084.4: asterisk spans are stripped from regen output when preserveActionTags=false (byte-identical to today)", async () => {
    // Without the flag, normalizeNpcSpeech removes asterisk spans.
    const llmProvider = makeLlmProvider("*sweeps hat* Buenos dias.");
    const stage = new RegenerateStage(llmProvider);
    const input = makeInput({
      auditPassed: true,
      judgePassed: false,
      violations: ["Broke character."]
      // no annotations -> preserveActionTags defaults to false
    });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.text).not.toContain("*sweeps hat*");
    expect(result.output.llmBackend).toBe("anthropic");
  });
});
