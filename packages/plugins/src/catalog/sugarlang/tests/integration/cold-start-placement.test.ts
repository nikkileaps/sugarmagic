/**
 * packages/plugins/src/catalog/sugarlang/tests/integration/cold-start-placement.test.ts
 *
 * Purpose: Golden test for the cold-start placement flow end to end.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Drives the full middleware chain (081.3 conversationKind routing) through a
 *     mock provider via createConversationHost.
 *   - Pins 081.4 semantics: placement completion seeds the posterior and opens the
 *     post-placement calibration window.
 *
 * Implements: Plan 081 story 081.5 (E2E goldens)
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultPlayerDefinition } from "@sugarmagic/domain";
import {
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createBlackboardScope,
  createConversationHost,
  createRuntimeBlackboard,
  createRuntimeBootModel,
  type ConversationMiddleware,
  type ConversationRuntimeContext
} from "@sugarmagic/runtime-core";
import type {
  ConversationProvider,
  ConversationProviderStartResult,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import { normalizeSugarLangPluginConfig } from "../../config";
import {
  LEARNER_PROFILE_FACT,
  SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
} from "../../runtime/learner/fact-definitions";
import { SUGARLANG_MIDDLEWARE_FACTORIES } from "../../manifest";
import { SugarlangRuntimeServices } from "../../runtime/runtime-services";
import { createSugarlangLogger } from "../../runtime/logger";
import { isInPostPlacementCalibration } from "../../runtime/learner/calibration-window";
import { CEFR_BAND_ORDER } from "../../runtime/learner/cefr-posterior";
import { clearSugarlangRuntimeCompileCache } from "../../runtime/compile/runtime-cache-state";
import { installFetchGuard, uninstallFetchGuard } from "./fetch-guard";

function makeFixedTurn(text: string, turnId: string): ConversationTurnEnvelope {
  return {
    turnId,
    providerId: "test.placement-provider",
    conversationKind: "scripted-dialogue",
    speakerId: "npc-inspector",
    speakerLabel: "Inspector",
    text,
    choices: [],
    inputMode: "advance",
    annotations: {},
    diagnostics: {}
  };
}

// Mock provider that tracks turnCount so the placement-phase engine advances correctly.
function makePlacementMockProvider(): ConversationProvider {
  return {
    providerId: "test.placement-provider",
    displayName: "Placement Mock Provider",
    priority: 100,
    canHandle: () => true,
    startSession({ execution }): ConversationProviderStartResult {
      execution.state["sugaragent.session"] = {
        sessionId: "test-session",
        turnCount: 0,
        history: []
      };
      return {
        session: {
          advance(_, execution) {
            const current =
              (execution.state["sugaragent.session"] as { turnCount: number }).turnCount ?? 0;
            execution.state["sugaragent.session"] = {
              sessionId: "test-session",
              turnCount: current + 1,
              history: []
            };
            return makeFixedTurn("Bienvenido.", `turn-${current + 1}`);
          }
        },
        initialTurn: makeFixedTurn(
          "Buenos dias, viajero. Vamos a ver tu espanol.",
          "turn-0"
        )
      };
    }
  };
}

// Injects runtimeContext with an active assessment quest objective targeting
// npc-inspector so the context middleware activates the placement flow.
function makeAssessmentRuntimeContextMiddleware(npcDefinitionId: string): ConversationMiddleware {
  const runtimeContext: ConversationRuntimeContext = {
    here: { regionId: "region-test", regionDisplayName: "Test", regionLorePageId: null, sceneId: "scene-test", sceneDisplayName: "Test", area: null, parentArea: null },
    playerLocation: null, playerPosition: null, playerArea: null,
    npcLocation: null, npcPosition: null, npcArea: null,
    npcPlayerRelation: null, npcBehavior: null, trackedQuest: null,
    activeQuestStage: null,
    activeQuestObjectives: {
      questId: "quest-placement",
      displayName: "Placement Quest",
      stageId: "stage-1",
      stageDisplayName: "Stage 1",
      objectives: [{
        nodeId: "node-assessment",
        displayName: "Assessment",
        description: "Language assessment",
        objectiveSubtype: "assessment",
        targetId: npcDefinitionId
      }]
    }
  };
  return {
    middlewareId: "test.assessment-runtime-context",
    displayName: "Test Assessment Runtime Context",
    priority: 1,
    stage: "context",
    prepare(execution) {
      execution.runtimeContext = runtimeContext;
      return execution;
    }
  };
}

describe("cold-start placement golden", () => {
  beforeEach(() => {
    // 081.5 exit criterion: the suite fails on any unmocked URL. This flow is
    // fully deterministic (no proxy URL configured), so any fetch is a bug.
    installFetchGuard();
  });
  afterEach(async () => {
    uninstallFetchGuard();
    await clearSugarlangRuntimeCompileCache();
  });

  it("placement questionnaire completion seeds the posterior and opens the calibration window", async () => {
    const blackboard = createRuntimeBlackboard({
      definitions: [
        ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
        ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
      ]
    });

    // openingDialogTurns:1 means one "advance" turn before the questionnaire appears.
    // No proxy URL -> teacher falls back deterministically, no network calls.
    const config = normalizeSugarLangPluginConfig({
      targetLanguage: "es",
      placement: { enabled: true, openingDialogTurns: 1, closingDialogTurns: 1 }
    });
    const logger = createSugarlangLogger({ debugLogging: false });
    const services = new SugarlangRuntimeServices({ config, logger });
    services.bindRuntime({
      boot: createRuntimeBootModel({
        hostKind: "studio",
        compileProfile: "authoring-preview",
        contentSource: "authored-game-root"
      }),
      blackboard,
      playerDefinition: createDefaultPlayerDefinition("project-1", { definitionId: "player-1" }),
      activeRegion: null,
      activeScene: null,
      npcDefinitions: [],
      dialogueDefinitions: [],
      questDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: []
    });

    const middlewares = [
      makeAssessmentRuntimeContextMiddleware("npc-inspector"),
      ...SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) => factory({ services, logger }))
    ];
    const host = createConversationHost({
      providers: [makePlacementMockProvider()],
      middlewares
    });

    // Turn 0: startSession -> opening-dialog phase.
    await host.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-inspector",
      npcDisplayName: "Inspector",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // Turn 1: advance (context middleware reads turnCount=0 -> still opening-dialog).
    await host.submitInput({ kind: "advance" });

    // Turn 2: advance (context middleware reads turnCount=1 -> advances to questionnaire).
    await host.submitInput({ kind: "advance" });

    // Turn 3: submit an empty questionnaire -> A1 with low confidence (< 0.65 threshold).
    // Empty answers produce a low-confidence A1 result, which opens the calibration window.
    await host.submitInput({
      kind: "quest_form",
      response: {
        questionnaireId: "es-placement-v1",
        submittedAtMs: 1000,
        answers: {}
      }
    });

    const profile = blackboard
      .getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-1"))
      ?.value;

    expect(profile).toBeDefined();

    // Placement-completion fired: assessment is now evaluated.
    expect(profile!.assessment.status).toBe("evaluated");

    // Posterior was seeded from the placement verdict (081.4): the placed band
    // has strictly more alpha than every other band.
    const placedBand = profile!.estimatedCefrBand;
    const seededAlpha = profile!.cefrPosterior[placedBand].alpha;
    const otherAlphas = CEFR_BAND_ORDER
      .filter((b) => b !== placedBand)
      .map((b) => profile!.cefrPosterior[b].alpha);
    expect(seededAlpha).toBeGreaterThan(Math.max(...otherAlphas));

    // Calibration window is open: low confidence + turns < backstop.
    expect(isInPostPlacementCalibration(profile!)).toBe(true);
  });
});
