/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate-stage.test.ts
 *
 * Purpose: Verifies the Sugarlang integration seam inside SugarAgent's Generate stage.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ./GenerateStage for the subject under test.
 *   - Guards the Epic 10 Sugarlang prompt splice and pre-placement bypass.
 *
 * Implements: Epic 10 Story 10.3
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { GenerateStage } from "./GenerateStage";

function createStageInput() {
  return {
    execution: {
      selection: {
        conversationKind: "free-form" as const,
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "agent" as const,
        targetLanguage: "es"
      },
      input: null,
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
      sessionId: "session-1",
      turnCount: 0,
      consecutiveFallbackTurns: 0,
      closeRequested: false,
      history: [],
      topicCoverage: [],
      referents: [],
      lastTurnDiagnostics: {}
    },
    interpret: {
      userText: null,
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
      turnRouting: {
        path: "grounded" as const,
        socialFastPathEligible: false,
        factualRiskSignals: []
      },
      pendingExpectation: {
        kind: "none" as const
      },
      searchQuery: "",
      shouldCloseAfterReply: false
    },
    retrieve: {
      evidencePack: [],
      usedEmbeddings: false,
      vectorSearchPerformed: false,
      semanticQueryFingerprint: null
    },
    plan: {
      responseIntent: "answer" as const,
      responseGoal: "answer naturally",
      responseSpecificity: "grounded" as const,
      turnPath: "grounded" as const,
      initiativeAction: "player_respond" as const,
      noveltyState: {
        repeatedUserMessage: false,
        repeatedAssistantReplyRisk: false,
        exhausted: false,
        recentAssistantQuestionCount: 0
      },
      claims: [],
      actionProposals: [],
      replyInputMode: "advance" as const,
      replyPlaceholder: ""
    }
  };
}

function createStageContext() {
  return {
    turnId: "turn-1",
    sessionId: "session-1",
    pluginId: "sugaragent",
    selection: {
      conversationKind: "free-form" as const,
      npcDefinitionId: "npc-1"
    },
    config: {
      proxyBaseUrl: "",
      loreSourceKind: "local" as const,
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      anthropicApiKey: "",
      anthropicModel: "claude-sonnet-4-6",
      openAiApiKey: "",
      openAiEmbeddingModel: "",
      openAiVectorStoreId: "",
      maxEvidenceResults: 4,
      debugLogging: false
    },
    logStageStart() {
      return undefined;
    },
    logStageEnd() {
      return undefined;
    }
  };
}

describe("GenerateStage", () => {
  it("returns a direct envelope override for pre-placement opening dialog turns", async () => {
    const stage = new GenerateStage(null);
    const input = createStageInput();
    input.execution.annotations["sugarlang.constraint"] = {
      targetVocab: { introduce: [], reinforce: [], avoid: [] },
      supportPosture: "anchored",
      targetLanguageRatio: 0,
      interactionStyle: "listening_first",
      glossingStrategy: "none",
      sentenceComplexityCap: "single-clause",
      targetLanguage: "es",
      learnerCefr: "A1",
      rawPrescription: {
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
      prePlacementOpeningLine: {
        text: "Hello there.",
        lang: "en",
        lineId: "opening:line-1"
      }
    };

    const result = await stage.execute(input as never, createStageContext() as never);

    expect(result.output.envelopeOverride?.text).toBe("Hello there.");
    expect(result.output.usedLlm).toBe(false);
  });

  it("injects the Sugarlang constraint block into the system prompt", async () => {
    const llmProvider = {
      generateStructuredTurn: vi.fn().mockResolvedValue("Respuesta corta.")
    };
    const stage = new GenerateStage(llmProvider);
    const input = createStageInput();
    input.execution.annotations["sugarlang.constraint"] = {
      targetVocab: {
        introduce: [{ lemmaId: "llave", lang: "es" }],
        reinforce: [{ lemmaId: "hola", lang: "es" }],
        avoid: [{ lemmaId: "complicado", lang: "es" }]
      },
      supportPosture: "supported",
      targetLanguageRatio: 0.65,
      interactionStyle: "guided_dialogue",
      glossingStrategy: "inline",
      sentenceComplexityCap: "two-clause",
      targetLanguage: "es",
      learnerCefr: "A2",
      rawPrescription: {
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
      }
    };

    await stage.execute(input as never, createStageContext() as never);

    expect(llmProvider.generateStructuredTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          "Language constraint: Reply primarily in es."
        )
      })
    );
  });

  it("returns the placement questionnaire envelope without using the llm", async () => {
    const stage = new GenerateStage(null);
    const input = createStageInput();
    input.execution.selection.targetLanguage = "es";
    input.execution.annotations["sugarlang.placementFlow"] = {
      phase: "questionnaire",
      minAnswersForValid: 4
    };

    const result = await stage.execute(input as never, createStageContext() as never);

    expect(result.output.usedLlm).toBe(false);
    expect(result.output.envelopeOverride?.inputMode).toBe("placement_questionnaire");
    expect(
      result.output.envelopeOverride?.metadata?.["sugarlang.placementQuestionnaire"]
    ).toMatchObject({
      lang: "es",
      minAnswersForValid: 4
    });
  });
});
