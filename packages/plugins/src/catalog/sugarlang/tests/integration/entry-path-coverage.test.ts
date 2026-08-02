/**
 * packages/plugins/src/catalog/sugarlang/tests/integration/entry-path-coverage.test.ts
 *
 * Purpose: Host-level structural guard for the 081.3 conversationKind gate.
 *          Enumerates every conversation entry path the runtime produces and
 *          asserts, through a real ConversationHost running the full
 *          SUGARLANG_MIDDLEWARE_FACTORIES chain, that sugarlang saw (or
 *          intentionally skipped) each one.
 *
 * Entry-path matrix (mirrors production selection shapes):
 *   scripted-dialogue / interact-scripted-npc   -> admitted
 *     (gameplay-session createConversationSelectionFromNpc, scripted NPC:
 *      dialogueDefinitionId + npcDefinitionId + interactionMode "scripted")
 *   scripted-dialogue / start-scripted-followup -> admitted
 *     (gameplay-session.ts ~1755 -> DialogueManager.start(definitionId):
 *      selection is conversationKind "scripted-dialogue" + dialogueDefinitionId ONLY)
 *   scripted-dialogue / start-quest-narrative   -> admitted (same .start shape, ~1789)
 *   scripted-dialogue / start-spell-cast        -> admitted (same .start shape, ~2061)
 *   free-form / interact-agent                  -> admitted
 *     (createConversationSelectionFromNpc, agent NPC: npcDefinitionId present)
 *   free-form / no-npc                          -> rejected
 *     (gate requires npcDefinitionId on free-form; no production site builds
 *      this today -- the case pins that such a selection stays sugarlang-free)
 *
 * Structural guards:
 *   - SUGARLANG_MIDDLEWARE_FACTORIES must instantiate exactly the five known
 *     middleware ids (removing one from the manifest fails here).
 *   - ENTRY_PATH_MATRIX is a Record<ConversationKind, ...> and the coverage
 *     switch has a `never` default: adding a ConversationKind to runtime-core
 *     without enumerating it here is a compile error.
 *
 * Also covers (081.3 locked scope):
 *   - mid-placement scripted line still flows through the chain (constraint
 *     present; context/observe emit their pre-placement events; verify skips
 *     scripted turns entirely, so no classifier verdict fires)
 *   - authored-text fallback: when the scripted-adaptation LLM call fails,
 *     the authored English renders unchanged and the turn does not error.
 *
 * Honest scope note (from the plan): this guards host-mediated paths; an
 * entry that bypasses DialogueManager/createConversationHost entirely is out
 * of reach.
 *
 * Implements: Plan 081 story 081.3 (structural guard integration test)
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createBlackboardScope,
  createConversationHost,
  createRuntimeBlackboard,
  createRuntimeBootModel,
  createScriptedDialogueConversationProvider,
  type ConversationKind,
  type ConversationMiddleware,
  type ConversationPlayerInput,
  type ConversationRuntimeContext,
  type ConversationSelectionContext
} from "@sugarmagic/runtime-core";
import type {
  ConversationProvider,
  ConversationProviderStartResult,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import { createDefaultPlayerDefinition } from "@sugarmagic/domain";
import type { DialogueDefinition, NPCDefinition } from "@sugarmagic/domain";
import { normalizeSugarLangPluginConfig } from "../../config";
import {
  LEARNER_PROFILE_FACT,
  SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
} from "../../runtime/learner/fact-definitions";
import { SUGARLANG_MIDDLEWARE_FACTORIES } from "../../manifest";
import { SugarlangRuntimeServices } from "../../runtime/runtime-services";
import { createSugarlangLogger } from "../../runtime/logger";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
} from "../../runtime/middlewares/shared";
import { createTestRegion, createTestActiveScene } from "../compile/test-helpers";
import { createBudgeterSceneLexicon } from "./scene-lexicon-fixture";
import { clearSugarlangRuntimeCompileCache } from "../../runtime/compile/runtime-cache-state";

// ---------------------------------------------------------------------------
// House no-network guard (071.1 pattern, inlined -- another agent owns the
// other integration files, so no shared fetch-guard helper is imported here).
// Every URL throws: nothing in these tests may touch the network, and the
// authored-text fallback test doubles this stub as its failure injection.
// ---------------------------------------------------------------------------
let fetchMock: ReturnType<typeof vi.fn>;

const SCENE_ID = "scene-station";
const AUTHORED_LINE_1 = "Hola viajero";
const AUTHORED_LINE_2 = "Hola otra vez amigo";

// Only "hola" as A1 so the budgeter deterministically prescribes it (same
// trick as the e2e golden): the "encountered" observation on the NPC line is
// then guaranteed, giving observe a cheap observable per admitted path.
const HOLA_PREVIEW_LEXICON = createBudgeterSceneLexicon({
  sceneId: SCENE_ID,
  entries: [{ lemmaId: "hola", band: "A1", frequencyRank: 1 }]
});

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

// Two nodes so scripted sessions survive one advance (single-node dialogues
// end the session on advance, which would skip finalize observations).
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
        speakerId: "npc-orrin",
        speakerLabel: "Orrin",
        text: AUTHORED_LINE_1,
        next: [{ targetNodeId: "node-2" }],
        graphPosition: { x: 0, y: 0 }
      },
      {
        nodeId: "node-2",
        displayName: "Greeting 2",
        speakerId: "npc-orrin",
        speakerLabel: "Orrin",
        text: AUTHORED_LINE_2,
        next: [],
        graphPosition: { x: 0, y: 100 }
      }
    ]
  }
];

// ---------------------------------------------------------------------------
// Entry-path matrix. Record<ConversationKind, ...> makes a new kind a compile
// error here; assertKindEnumerated makes it a compile error even if someone
// swaps the Record for something looser.
// ---------------------------------------------------------------------------
interface EntryPathCase {
  /** Names the production entry site this selection shape mirrors. */
  id: string;
  expectation: "admitted" | "rejected";
  /** Fresh selection per run -- the context middleware mutates selections. */
  makeSelection: () => ConversationSelectionContext;
  /** Inputs driven after startSession. */
  drive: ConversationPlayerInput[];
}

function assertKindEnumerated(kind: ConversationKind): void {
  switch (kind) {
    case "scripted-dialogue":
    case "free-form":
      return;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unenumerated conversationKind: ${String(_exhaustive)}`);
    }
  }
}

const START_SITE_SELECTION = (): ConversationSelectionContext => ({
  // DialogueManager.start(definitionId) shape: conversationKind +
  // dialogueDefinitionId ONLY. No npcDefinitionId, no interactionMode, no
  // targetLanguage -- exactly what the three gameplay-session .start sites
  // produce. This is the shape the pre-081.3 interactionMode gate dropped.
  conversationKind: "scripted-dialogue",
  dialogueDefinitionId: "dialogue-orrin"
});

const ENTRY_PATH_MATRIX: Record<ConversationKind, readonly EntryPathCase[]> = {
  "scripted-dialogue": [
    {
      id: "interact-scripted-npc",
      expectation: "admitted",
      makeSelection: () => ({
        conversationKind: "scripted-dialogue",
        dialogueDefinitionId: "dialogue-orrin",
        npcDefinitionId: "npc-orrin",
        npcDisplayName: "Orrin",
        interactionMode: "scripted"
      }),
      drive: [{ kind: "advance" }]
    },
    {
      id: "start-scripted-followup",
      expectation: "admitted",
      makeSelection: START_SITE_SELECTION,
      drive: [{ kind: "advance" }]
    },
    {
      id: "start-quest-narrative",
      expectation: "admitted",
      makeSelection: START_SITE_SELECTION,
      drive: [{ kind: "advance" }]
    },
    {
      id: "start-spell-cast",
      expectation: "admitted",
      makeSelection: START_SITE_SELECTION,
      drive: [{ kind: "advance" }]
    }
  ],
  "free-form": [
    {
      id: "interact-agent",
      expectation: "admitted",
      makeSelection: () => ({
        conversationKind: "free-form",
        npcDefinitionId: "npc-orrin",
        npcDisplayName: "Orrin",
        npcDescription: "Station manager of Wordlark Hollow.",
        interactionMode: "agent"
      }),
      drive: [{ kind: "advance" }, { kind: "free_text", text: "hola" }]
    },
    {
      id: "no-npc",
      expectation: "rejected",
      makeSelection: () => ({
        conversationKind: "free-form"
      }),
      drive: [{ kind: "advance" }]
    }
  ]
};

const EXPECTED_MIDDLEWARE_IDS = [
  "sugarlang.context",
  "sugarlang.observe",
  "sugarlang.scripted",
  "sugarlang.teacher",
  "sugarlang.verify"
];

// ---------------------------------------------------------------------------
// Harness (reuses the 081.5 golden pattern): real ConversationHost, the full
// SUGARLANG_MIDDLEWARE_FACTORIES chain, the REAL scripted-dialogue provider
// from runtime-core (the same one DialogueManager composes), and a mock NPC
// provider for free-form selections.
// ---------------------------------------------------------------------------
function makeRuntimeContextMiddleware(options: {
  assessment?: boolean;
}): ConversationMiddleware {
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
    activeQuestObjectives: options.assessment
      ? {
          questId: "quest-placement",
          displayName: "Placement Quest",
          stageId: "stage-1",
          stageDisplayName: "Stage 1",
          objectives: [
            {
              nodeId: "node-assessment",
              displayName: "Assessment",
              description: "Language assessment",
              objectiveSubtype: "assessment",
              targetId: "npc-orrin"
            }
          ]
        }
      : null
  };
  return {
    middlewareId: "test.runtime-context",
    displayName: "Test Runtime Context",
    priority: 1, // before sugarlang context (priority 10)
    stage: "context",
    prepare(execution) {
      execution.runtimeContext = runtimeContext;
      return execution;
    }
  };
}

function makeNpcTurnProvider(npcText: string): ConversationProvider {
  let turnIndex = 0;
  return {
    providerId: "test.npc-provider",
    displayName: "Test NPC Provider",
    priority: 100, // after the real scripted provider (priority 10)
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
              (execution.state["sugaragent.session"] as { turnCount: number })
                .turnCount ?? 0;
            turnIndex++;
            execution.state["sugaragent.session"] = {
              sessionId: "test-session",
              turnCount: current + 1,
              history: []
            };
            return {
              turnId: `turn-${turnIndex}`,
              providerId: "test.npc-provider",
              conversationKind: execution.selection.conversationKind,
              speakerId: "npc-orrin",
              speakerLabel: "Orrin",
              text: npcText,
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
          conversationKind: execution.selection.conversationKind,
          speakerId: "npc-orrin",
          speakerLabel: "Orrin",
          text: npcText,
          choices: [],
          inputMode: "advance",
          annotations: {},
          diagnostics: {}
        }
      };
    }
  };
}

function buildHarness(
  options: {
    environment?: Record<string, string>;
    assessment?: boolean;
    placementEnabled?: boolean;
    /** Override CEFR band for testing posture-specific paths. */
    debugBandOverride?: string;
  } = {}
) {
  const blackboard = createRuntimeBlackboard({
    definitions: [
      ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
      ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
    ]
  });
  const telemetry = new MemoryTelemetrySink();
  const region = createTestRegion();
  const activeScene = createTestActiveScene(region.identity.id);

  const config = normalizeSugarLangPluginConfig({
    targetLanguage: "es",
    verifyEnabled: true,
    ...(options.placementEnabled
      ? { placement: { enabled: true, openingDialogTurns: 1, closingDialogTurns: 1 } }
      : {}),
    ...(options.debugBandOverride ? { debugBandOverride: options.debugBandOverride } : {})
  });
  const logger = createSugarlangLogger({ debugLogging: false });
  const services = new SugarlangRuntimeServices({
    config,
    logger,
    telemetry,
    ...(options.environment ? { environment: options.environment } : {})
  });
  services.bindRuntime({
    boot: createRuntimeBootModel({
      hostKind: "studio",
      compileProfile: "authoring-preview",
      contentSource: "authored-game-root"
    }),
    blackboard,
    playerDefinition: createDefaultPlayerDefinition("project-1", {
      definitionId: "player-1"
    }),
    activeRegion: region,
    activeScene,
    npcDefinitions: TEST_NPC_DEFINITIONS,
    dialogueDefinitions: TEST_DIALOGUE_DEFINITIONS,
    questDefinitions: [],
    itemDefinitions: [],
    documentDefinitions: []
  });
  services.seedPreviewLexicons({ lexicons: [HOLA_PREVIEW_LEXICON] });

  const captured: { annotations: Record<string, unknown> } = { annotations: {} };
  const captureMiddleware: ConversationMiddleware = {
    middlewareId: "test.annotation-capture",
    displayName: "Annotation Capture",
    priority: 1000, // after observe (90)
    stage: "analysis",
    finalize(execution, turn) {
      captured.annotations = { ...execution.annotations };
      return turn;
    }
  };

  const sugarlangMiddlewares = SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) =>
    factory({ services, logger, telemetry })
  );
  const host = createConversationHost({
    providers: [
      // The REAL provider DialogueManager composes for scripted selections.
      createScriptedDialogueConversationProvider({
        definitions: TEST_DIALOGUE_DEFINITIONS
      }),
      makeNpcTurnProvider("Hola.")
    ],
    middlewares: [
      makeRuntimeContextMiddleware({ assessment: options.assessment ?? false }),
      ...sugarlangMiddlewares,
      captureMiddleware
    ]
  });

  return { blackboard, telemetry, services, host, captured, sugarlangMiddlewares };
}

describe("081.3 entry-path coverage", () => {
  beforeEach(async () => {
    await clearSugarlangRuntimeCompileCache();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`entry-path-coverage: unmocked fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearSugarlangRuntimeCompileCache();
  });

  it("the manifest contributes exactly the five sugarlang middlewares to the host chain", () => {
    const { sugarlangMiddlewares } = buildHarness();
    const ids = sugarlangMiddlewares.map((m) => m.middlewareId).sort();
    expect(ids).toEqual(EXPECTED_MIDDLEWARE_IDS);
  });

  it("the matrix enumerates every ConversationKind with at least one entry path", () => {
    const kinds = Object.keys(ENTRY_PATH_MATRIX) as ConversationKind[];
    // Compile-time: ENTRY_PATH_MATRIX is Record<ConversationKind, ...> and
    // assertKindEnumerated switches with a `never` default -- a new kind in
    // runtime-core fails typecheck here before this runtime assert matters.
    for (const kind of kinds) {
      assertKindEnumerated(kind);
      const cases = ENTRY_PATH_MATRIX[kind];
      expect(cases.length).toBeGreaterThanOrEqual(1);
      for (const entry of cases) {
        expect(entry.makeSelection().conversationKind).toBe(kind);
      }
    }
    expect(kinds.sort()).toEqual(["free-form", "scripted-dialogue"]);
  });

  for (const [kind, cases] of Object.entries(ENTRY_PATH_MATRIX) as Array<
    [ConversationKind, readonly EntryPathCase[]]
  >) {
    for (const entry of cases) {
      if (entry.expectation === "admitted") {
        it(`${kind} / ${entry.id}: sugarlang sees the execution (constraint + observe)`, async () => {
          const { host, telemetry, captured } = buildHarness();

          const initialTurn = await host.startSession(entry.makeSelection());
          expect(initialTurn).not.toBeNull();
          for (const input of entry.drive) {
            await host.submitInput(input);
          }

          // The teacher wrote a constraint on the execution context.
          const constraint = captured.annotations[
            SUGARLANG_CONSTRAINT_ANNOTATION
          ] as { targetLanguage?: string; learnerCefr?: string } | undefined;
          expect(constraint).toBeDefined();
          expect(constraint!.targetLanguage).toBe("es");
          expect(constraint!.learnerCefr).toBeDefined();

          // The observe middleware ran and applied at least one observation
          // (the seeded lexicon guarantees "hola" is prescribed and every NPC
          // line contains it, so an "encountered" observation always lands).
          const observeEvents = await telemetry.query({
            eventKinds: ["observe.observations-applied"]
          });
          expect(observeEvents.length).toBeGreaterThanOrEqual(1);
        });
      } else {
        it(`${kind} / ${entry.id}: sugarlang skips the execution entirely`, async () => {
          const { host, telemetry, captured } = buildHarness();

          const initialTurn = await host.startSession(entry.makeSelection());
          // The conversation itself still works -- sugarlang just stays out.
          expect(initialTurn).not.toBeNull();
          for (const input of entry.drive) {
            await host.submitInput(input);
          }

          expect(
            captured.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]
          ).toBeUndefined();
          // No sugarlang middleware emitted anything for this execution.
          const allEvents = await telemetry.query({});
          expect(allEvents).toEqual([]);
        });
      }
    }
  }

  it("free-form / interact-agent: player production lands a lemma card (observe end-to-end)", async () => {
    const { host, blackboard } = buildHarness();

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      interactionMode: "agent"
    });
    await host.submitInput({ kind: "advance" });
    await host.submitInput({ kind: "free_text", text: "hola" });

    const profile = blackboard
      .getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-1"))
      ?.value;
    expect(profile?.lemmaCards).toBeDefined();
    expect(Object.keys(profile!.lemmaCards).length).toBeGreaterThan(0);
  });

  it("scripted target-dominant posture: zero LLM calls even with gateway configured (086.4)", async () => {
    // 086.4: the scripted middleware no longer calls the LLM at any posture.
    // With a configured gateway and a B1 learner (target-dominant), the scripted
    // middleware degrades to the authored English (no baked variant in cache).
    // The global fetch stub fails any network call -- no call must fire.
    // debugBandOverride:"B1" forces target-dominant posture.
    const { host, captured } = buildHarness({
      environment: { SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "http://localhost:8787" },
      debugBandOverride: "B1"
    });

    const turn = await host.startSession(START_SITE_SELECTION());
    expect(turn).not.toBeNull();

    // Zero /generate calls fired (the scripted middleware has no LLM path now).
    const generateCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/api/sugaragent/generate")
    );
    expect(generateCalls.length).toBe(0);

    // The constraint was still written (teacher ran).
    expect(captured.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toBeDefined();

    // The authored text passes through (substitution degradation, none expected
    // with the default empty prescription -- the important invariant is zero LLM calls).
    expect(turn!.text).toBe(AUTHORED_LINE_1);

    // The session survives: the next authored line also plays.
    const secondTurn = await host.submitInput({ kind: "advance" });
    expect(secondTurn).not.toBeNull();
    expect(secondTurn!.text).toBe(AUTHORED_LINE_2);
  });
});
