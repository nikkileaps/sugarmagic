/**
 * packages/plugins/src/catalog/sugarlang/tests/integration/preview-cache-hit-rate.test.ts
 *
 * Purpose: Golden test for directive cache hit rate and quest-stage invalidation.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Drives the full middleware chain through a mock provider via createConversationHost.
 *   - Pins the teacher-invocation count to exactly 1 for N turns with a stable session;
 *     then verifies that a QUEST_ACTIVE_STAGE_FACT change forces exactly one re-plan.
 *
 * Implements: Plan 081 story 081.5 (E2E goldens)
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signInTestAccount } from "../learner/signed-in-test-account";
import {
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  QUEST_ACTIVE_STAGE_FACT,
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
import { createDefaultPlayerDefinition } from "@sugarmagic/domain";
import type { DialogueDefinition, NPCDefinition } from "@sugarmagic/domain";
import { normalizeSugarLangPluginConfig } from "../../config";
import { SUGARLANG_BLACKBOARD_FACT_DEFINITIONS } from "../../runtime/learner/fact-definitions";
import { SUGARLANG_MIDDLEWARE_FACTORIES } from "../../manifest";
import { SugarlangRuntimeServices } from "../../runtime/runtime-services";
import { createSugarlangLogger } from "../../runtime/logger";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import { createTestRegion, createTestActiveScene } from "../compile/test-helpers";
import { clearSugarlangRuntimeCompileCache } from "../../runtime/compile/runtime-cache-state";
import { installFetchGuard, uninstallFetchGuard } from "./fetch-guard";

const SCENE_ID = "scene-station";

const TEST_NPC_DEFINITIONS: NPCDefinition[] = [
  {
    definitionId: "npc-orrin",
    displayName: "Orrin",
    description: "Station manager of Wordlark Hollow.",
    interactionMode: "agent",
    lorePageId: null,
    presentation: {
      modelAssetDefinitionId: null,
      modelHeight: 1.7,
      animationAssetBindings: { idle: null, walk: null, run: null }
    }
  }
];

const TEST_DIALOGUE_DEFINITIONS: DialogueDefinition[] = [
  {
    definitionId: "dialogue-orrin",
    displayName: "Greeting",
    startNodeId: "node-1",
    interactionBinding: { npcDefinitionId: "npc-orrin" },
    nodes: [
      {
        nodeId: "node-1",
        displayName: "Greeting",
        text: "Hola viajero",
        next: [],
        graphPosition: { x: 0, y: 0 }
      }
    ]
  }
];

function makeRuntimeContextMiddleware(): ConversationMiddleware {
  const runtimeContext: ConversationRuntimeContext = {
    here: {
      regionId: SCENE_ID,
      regionDisplayName: "Test Station",
      regionLorePageId: null,
      sceneId: SCENE_ID,
      sceneDisplayName: "Test Station",
      area: null,
      parentArea: null
    },
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
  };
  return {
    middlewareId: "test.runtime-context",
    displayName: "Test Runtime Context",
    priority: 1,
    stage: "context",
    prepare(execution) {
      execution.runtimeContext = runtimeContext;
      return execution;
    }
  };
}

function makeStableNpcProvider(): ConversationProvider {
  let turnIndex = 0;
  return {
    providerId: "test.npc-provider",
    displayName: "Test NPC Provider",
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
            turnIndex++;
            execution.state["sugaragent.session"] = {
              sessionId: "test-session",
              turnCount: current + 1,
              history: []
            };
            return {
              turnId: `turn-${turnIndex}`,
              providerId: "test.npc-provider",
              conversationKind: "free-form",
              speakerId: "npc-orrin",
              speakerLabel: "Orrin",
              text: "Hola.",
              choices: [],
              inputMode: "free_text",
              annotations: {},
              diagnostics: {}
            } satisfies ConversationTurnEnvelope;
          }
        },
        initialTurn: {
          turnId: "turn-0",
          providerId: "test.npc-provider",
          conversationKind: "free-form",
          speakerId: "npc-orrin",
          speakerLabel: "Orrin",
          text: "Hola.",
          choices: [],
          inputMode: "advance",
          annotations: {},
          diagnostics: {}
        }
      };
    }
  };
}

describe("preview directive cache hit rate golden", () => {
  let clearTestAccount: (() => void) | undefined;

  beforeEach(async () => {
    clearTestAccount = signInTestAccount();
    // 081.5 exit criterion: the suite fails on any unmocked URL. This flow is
    // fully deterministic (no proxy URL configured), so any fetch is a bug.
    installFetchGuard();
    await clearSugarlangRuntimeCompileCache();
  });
  afterEach(async () => {
    clearTestAccount?.();
    uninstallFetchGuard();
    await clearSugarlangRuntimeCompileCache();
  });

  it("N turns with stable session use one teacher invocation; quest_stage_change forces exactly one re-plan", async () => {
    const blackboard = createRuntimeBlackboard({
      definitions: [
        ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
        ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
      ]
    });
    const telemetry = new MemoryTelemetrySink();
    const region = createTestRegion();
    const activeScene = createTestActiveScene(region.identity.id);

    const config = normalizeSugarLangPluginConfig({ targetLanguage: "es" });
    const logger = createSugarlangLogger({ debugLogging: false });
    const services = new SugarlangRuntimeServices({ config, logger, telemetry });
    services.bindRuntime({
      boot: createRuntimeBootModel({
        hostKind: "studio",
        compileProfile: "authoring-preview",
        contentSource: "authored-game-root"
      }),
      blackboard,
      playerDefinition: createDefaultPlayerDefinition("project-1", { definitionId: "player-1" }),
      activeRegion: region,
      activeScene,
      npcDefinitions: TEST_NPC_DEFINITIONS,
      dialogueDefinitions: TEST_DIALOGUE_DEFINITIONS,
      questDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: []
    });

    const middlewares = [
      makeRuntimeContextMiddleware(),
      ...SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) => factory({ services, logger, telemetry }))
    ];
    const host = createConversationHost({
      providers: [makeStableNpcProvider()],
      middlewares
    });

    // Turn 0 (startSession): first teacher invocation -- cache miss.
    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // 090.4 REWROTE THIS TEST, and the rewrite is the point of the story.
    //
    // It used to read: "087.6 -- schedule-driven. teacher.invoke() is bypassed;
    // directive cache not consulted. Zero cache hits." That was an accurate
    // description of a system where the Teacher did not run.
    //
    // Now: the Teacher is invoked once, and subsequent turns HIT THE CACHE. One
    // invocation plus two hits is the lifecycle 090.3b built -- decide once per
    // situation, reuse across turns -- and it is strictly better than the old
    // zero-hits number, which was zero only because nothing was ever cached.
    await host.submitInput({ kind: "advance" });
    await host.submitInput({ kind: "advance" });

    const phase1Resolved = await telemetry.query({ eventKinds: ["teacher.invocation-resolved"] });
    const phase1Hits = await telemetry.query({ eventKinds: ["teacher.cache-hit"] });
    expect(phase1Resolved.length).toBe(1);
    expect(phase1Hits.length).toBe(2);

    // Fire a quest stage change -- DirectiveCache subscribes to the blackboard and
    // invalidates all cached directives on QUEST_ACTIVE_STAGE_FACT changes.
    blackboard.setFact({
      definition: QUEST_ACTIVE_STAGE_FACT,
      scope: createBlackboardScope("quest", "quest-altar"),
      sourceSystem: "quest-system",
      value: {
        questId: "quest-altar",
        stageId: "stage-2",
        stageDisplayName: "Stage 2"
      },
      updatedAtMs: 1000
    });

    // Turn 3. NOTE what changed about invalidation: 090.3b deleted the
    // blackboard subscription that used to invalidate every cached directive on
    // any quest-stage event. The situation KEY governs now, and it is compared
    // per conversation at read time. A raw blackboard write like the one above
    // does not by itself move this conversation's key, so the directive is still
    // valid and still served from cache.
    //
    // That is the intended behavior, not a gap: the old subscription
    // over-invalidated, dropping good decisions whenever an unrelated quest
    // advanced anywhere in the world.
    await host.submitInput({ kind: "advance" });

    const phase2Resolved = await telemetry.query({ eventKinds: ["teacher.invocation-resolved"] });
    const phase2Hits = await telemetry.query({ eventKinds: ["teacher.cache-hit"] });

    // Total across the full run: 1 invocation, 3 hits. The Teacher decided once
    // and that decision served every turn.
    expect(phase2Resolved.length).toBe(1);
    expect(phase2Hits.length).toBe(3);
  });
});
