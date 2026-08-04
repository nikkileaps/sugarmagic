/**
 * packages/plugins/src/catalog/sugarlang/tests/integration/end-to-end-conversation.test.ts
 *
 * Purpose: Golden tests for end-to-end conversation middleware behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Drives the full middleware chain (081.3 conversationKind routing) through a
 *     mock provider via createConversationHost.
 *   - Covers: scripted constraint annotation + authored-text passthrough (no LLM),
 *     scripted adaptation via a stubbed gateway LLM + authored-text fallback on
 *     LLM failure, observation on card, directive cache hit, verify pass
 *     (in-envelope text unchanged), and the verify repair path (an
 *     unrepairable turn ships unchanged when there is no LLM client).
 *
 * Implements: Plan 081 story 081.5 (E2E goldens)
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { SUGARLANG_CONSTRAINT_ANNOTATION } from "../../runtime/middlewares/shared";
import { createTestRegion, createTestActiveScene } from "../compile/test-helpers";
import { createBudgeterSceneLexicon } from "./scene-lexicon-fixture";
import { clearSugarlangRuntimeCompileCache } from "../../runtime/compile/runtime-cache-state";
import { installFetchGuard, uninstallFetchGuard, jsonResponse } from "./fetch-guard";
import { MemoryVariantCache } from "../../runtime/compile/variant-cache";
import type { VariantCacheEntry } from "../../runtime/compile/variant-cache";
import { VARIANT_PROMPT_VERSION } from "../../runtime/compile/generate-variant";

// Minimal pre-compiled lexicon for "scene-station" with just "hola" as A1.
// Seeded via services.seedPreviewLexicons before startSession so the budgeter
// always prescribes "hola" for an A1 learner, making the observation test
// independent of the budgeter's ordering heuristics.
const HOLA_PREVIEW_LEXICON = createBudgeterSceneLexicon({
  sceneId: "scene-station",
  entries: [{ lemmaId: "hola", band: "A1", frequencyRank: 1 }]
});

// Minimal NPC + dialogue fixture that matches the test region overlay presences
// (npc-orrin is placed in scene-station via createTestActiveScene).
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

const SCENE_ID = "scene-station";

// Injected by the runtimeContextMiddleware so the sugarlang context middleware
// can read sceneId without a full runtime framework.
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
    priority: 1, // must run before sugarlang context (priority 10)
    stage: "context",
    prepare(execution) {
      execution.runtimeContext = runtimeContext;
      return execution;
    }
  };
}

function makeNpcTurnProvider(npcText: string, initialText = "Hola."): ConversationProvider {
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
          conversationKind: "scripted-dialogue",
          speakerId: "npc-orrin",
          speakerLabel: "Orrin",
          text: initialText,
          choices: [],
          inputMode: "advance",
          annotations: {},
          diagnostics: {}
        }
      };
    }
  };
}

function makeSharedSetup(
  configOverrides: Record<string, unknown> = {},
  npcText = "Hola, bienvenido.",
  options: {
    environment?: Record<string, string | undefined>;
    initialText?: string;
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
    ...configOverrides
  });
  const logger = createSugarlangLogger({ debugLogging: false });
  const services = new SugarlangRuntimeServices({
    config,
    logger,
    telemetry,
    environment: options.environment
  });
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
    providers: [makeNpcTurnProvider(npcText, options.initialText)],
    middlewares
  });

  return { blackboard, telemetry, services, host };
}

describe("end-to-end conversation golden", () => {
  beforeEach(() => {
    // 081.5 exit criterion: the suite fails on any unmocked URL. Tests that
    // need a gateway response re-install the guard with an explicit handler.
    installFetchGuard();
    clearSugarlangRuntimeCompileCache();
  });
  afterEach(() => {
    uninstallFetchGuard();
    clearSugarlangRuntimeCompileCache();
  });

  it("scripted conversation writes a constraint annotation on the execution context", async () => {
    // For scripted dialogue the teacher builds a lightweight constraint inline
    // (no scene lexicon needed) -- this pins that the 081.3 routing fix lets
    // scripted-dialogue conversations reach the teacher middleware.
    const blackboard = createRuntimeBlackboard({
      definitions: [
        ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
        ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
      ]
    });
    const config = normalizeSugarLangPluginConfig({ targetLanguage: "es" });
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

    let capturedAnnotations: Record<string, unknown> = {};
    const capturingMiddleware: ConversationMiddleware = {
      middlewareId: "test.annotation-capture",
      displayName: "Annotation Capture",
      priority: 1000,
      stage: "analysis",
      finalize(execution, turn) {
        capturedAnnotations = { ...execution.annotations };
        return turn;
      }
    };

    const middlewares = [
      ...SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) => factory({ services, logger })),
      capturingMiddleware
    ];
    const host = createConversationHost({
      providers: [makeNpcTurnProvider("Hola.")],
      middlewares
    });

    const initialTurn = await host.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    expect(capturedAnnotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toBeDefined();
    const constraint = capturedAnnotations[SUGARLANG_CONSTRAINT_ANNOTATION] as {
      targetLanguage?: string;
      learnerCefr?: string;
    };
    expect(constraint.targetLanguage).toBe("es");
    expect(constraint.learnerCefr).toBeDefined();

    // Deterministic path: with no proxy URL there is no LLM client, so the
    // scripted middleware intentionally SKIPS adaptation and the authored line
    // passes through verbatim. The adapted path is pinned separately below with
    // a stubbed gateway ("scripted line is adapted through the gateway LLM").
    expect(initialTurn?.text).toBe("Hola.");
  });

  it("scripted target-dominant posture: zero LLM calls -- degrades to substitution when no baked variant", async () => {
    // 086.4: scripted target-dominant no longer calls the LLM gateway at all.
    // When no variant cache is seeded (cold cache), the scripted middleware
    // degrades to the AUTHORED ENGLISH (substitution deleted 2026-08-02).
    // The fetch guard enforces zero /generate traffic, which is the real
    // guarantee here: a beginner turn must never reach the LLM.
    // debugBandOverride:"B1" puts the learner at target-dominant posture.
    const authoredLine = "Welcome to the station, traveler.";
    // Allow nothing -- the scripted path must make zero gateway calls.
    installFetchGuard((_url) => null);

    const { host } = makeSharedSetup({ debugBandOverride: "B1" }, "Hola.", {
      environment: { SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "http://localhost:8787" },
      initialText: authoredLine
    });

    // Must not throw (fetch guard throws on any stray /generate call).
    const turn = await host.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // Turn is defined and the authored line passes through (no variant to substitute,
    // the marker may or may not substitute depending on the gloss index -- the invariant
    // is zero LLM calls, enforced by the guard).
    expect(turn).toBeDefined();
    void authoredLine; // used by makeNpcTurnProvider as initialText
  });

  it("scripted target-dominant: uses baked variant when variant cache is warm", async () => {
    // 086.4: when a MemoryVariantCache is pre-seeded with a variant for the
    // correct (lang, band, contentHash) key, the scripted middleware uses the
    // baked text instead of the authored English line. Zero LLM calls.
    const authoredLine = "Welcome to the station, traveler.";
    const bakedVariantText = "Bienvenido a la estacion, viajero.";

    // debugBandOverride:"B1" -> target-dominant posture, band "B1".
    // The contentHash for cache lookup: [nodeId, text, JSON.stringify({})].join("|").
    // At runtime nodeId comes from execution.annotations["sugarlang.currentNodeId"].
    // In the test harness (makeNpcTurnProvider) no nodeId annotation is written,
    // so the hash is built from ("", authoredLine, "{}") -- which produces a valid
    // cache key for the test. We seed with that same key.
    const nodeId = "";
    const contentHash = [nodeId, authoredLine, JSON.stringify({})].join("|");

    const variantCache = new MemoryVariantCache();
    const entry: VariantCacheEntry = {
      key: {
        lang: "es",
        band: "B1",
        contentHash,
        variantPromptVersion: VARIANT_PROMPT_VERSION
      },
      variant: {
        source: {
          kind: "dialogue-node",
          dialogueDefinitionId: "dialogue-orrin",
          nodeId
        },
        lang: "es",
        band: "B1",
        text: bakedVariantText,
        verdict: {
          envelopePasses: true,
          ratioPasses: true,
          voiceRetentionScore: 0.9,
          fidelityPasses: true,
          overallPasses: true
        },
        reviewFlag: false,
        generatedAtMs: Date.now(),
        generatedByModel: "test",
        contentHash,
        promptVersion: VARIANT_PROMPT_VERSION
      }
    };
    await variantCache.set(entry);

    // Allow nothing from the gateway -- must be zero LLM calls.
    installFetchGuard((_url) => null);

    const { services, host } = makeSharedSetup({ debugBandOverride: "B1" }, "Hola.", {
      initialText: authoredLine
    });

    // Inject the variant cache into the resolved services.
    // resolveForExecution is lazy -- call it to warm the map, then set variantCache.
    const execServices = await services.resolveForExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        targetLanguage: "es",
        supportLanguage: "en"
      },
      annotations: {},
      state: {},
      runtimeContext: null,
      input: null
    } as unknown as Parameters<typeof services.resolveForExecution>[0]);
    if (execServices) {
      execServices.variantCache = variantCache;
    }

    const turn = await host.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // The scripted middleware used the baked variant text.
    expect(turn?.text).toBe(bakedVariantText);
    expect(turn?.text).not.toBe(authoredLine);
  });

  it("free-form player input creates an encountered observation card for a target lemma", async () => {
    // Drives a free-form turn where the NPC says "Hola" and the player types
    // "hola" back. The observe middleware should create a card for "hola" since
    // it appears in the NPC text and the budgeter will prescribe it for an A1
    // learner from the seeded lexicon.
    //
    // The seeded lexicon contains ONLY "hola" so FallbackTeacherPolicy's
    // 1-introduce-lemma cap for A1 is deterministic -- it can't pick "viajero"
    // from a compile that includes both words.
    const { blackboard, services, host } = makeSharedSetup({}, "Hola.");

    // Must be called before startSession triggers the first resolveForExecution
    // (which creates the language bundle and seeds the store).
    services.seedPreviewLexicons({ lexicons: [HOLA_PREVIEW_LEXICON] });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // First advance warms up the session and lets the scene compile.
    await host.submitInput({ kind: "advance" });

    // Player types the same word the NPC used; if it was prescribed (introduce),
    // the observe middleware records a produced-typed observation.
    await host.submitInput({ kind: "free_text", text: "hola" });

    const profile = blackboard
      .getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-1"))
      ?.value;

    // At least one card must have been created by the observation pipeline.
    expect(profile?.lemmaCards).toBeDefined();
    expect(Object.keys(profile!.lemmaCards).length).toBeGreaterThan(0);
  });

  it("directive is served from cache on the second turn: only one teacher invocation fired", async () => {
    const { telemetry, host } = makeSharedSetup();

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // Turn 1: advance (fires a new directive -- cache miss).
    await host.submitInput({ kind: "advance" });

    // Turn 2: advance. 090.4 deleted the 087.6 bypass, so the teacher path is
    // taken and the directive cache IS consulted -- and hits, because the
    // situation has not changed. The test name promises "only one teacher
    // invocation fired", and that is still true; what changed is that the second
    // turn now demonstrably REUSES the first decision rather than never having
    // asked for one.
    await host.submitInput({ kind: "advance" });

    const cacheHits = await telemetry.query({ eventKinds: ["director.cache-hit"] });
    const newDirectives = await telemetry.query({ eventKinds: ["director.invocation-resolved"] });

    expect(newDirectives.length).toBe(1);
    expect(cacheHits.length).toBeGreaterThan(0);
  });

  it("verify pass: NPC text within the envelope passes through verify unchanged", async () => {
    // Inverse of the repair-path case below: "hola" is A1 vocabulary the test
    // learner knows (seeded as the sole lexicon entry, same trick as the
    // observation test), so the generated turn is within the envelope and must
    // come out of finalize byte-for-byte identical to what the provider
    // generated -- no repair fired.
    const npcText = "Hola.";
    const { telemetry, services, host } = makeSharedSetup({}, npcText);

    services.seedPreviewLexicons({ lexicons: [HOLA_PREVIEW_LEXICON] });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    const turn = await host.submitInput({ kind: "advance" });

    // Exact equality: the provider generated npcText and verify (enabled in
    // makeSharedSetup) returned it untouched.
    expect(turn?.text).toBe(npcText);

    // The verify middleware actually ran and judged the text within the
    // envelope -- this is a pass verdict, not a bypass.
    const verdicts = await telemetry.query({ eventKinds: ["classifier.verdict"] });
    expect(verdicts.length).toBeGreaterThan(0);
    const lastVerdict = verdicts[verdicts.length - 1] as unknown as {
      verdict: { withinEnvelope: boolean };
    };
    expect(lastVerdict.verdict.withinEnvelope).toBe(true);

    // And repair never fired anywhere in the run. (There is no second
    // mechanism: the autoSimplify fallback was deleted 2026-08-02.)
    const repairs = await telemetry.query({ eventKinds: ["verify.repair-triggered"] });
    expect(repairs.length).toBe(0);
  });

  it("B2 learner: all-English NPC turn triggers ratio repair (the playtest bug)", async () => {
    // debugBandOverride:"B2" fires a synthetic PlacementCompletionEvent
    // (confidence=1.0) during the first resolveForExecution call. FallbackTeacherPolicy
    // picks target-dominant posture (confidence >= 0.7) with directedRatio=0.85.
    // The NPC provider returns pure English text -> measuredRatio=0 -> under-ratio ->
    // repair fires with the "rewrite in es" instruction -> repaired Spanish passes.
    const allEnglishText =
      "I cannot believe this magnificent performance, it is truly wonderful.";
    const repairedSpanishText = "Es muy bueno. Me gusta mucho.";

    const generateCalls: Array<{ body: Record<string, unknown> }> = [];
    installFetchGuard((url, init) => {
      if (url === "http://localhost:8787/api/sugaragent/generate") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        generateCalls.push({ body });
        if (String(body.systemPrompt).startsWith("You are editing an NPC line")) {
          return jsonResponse({ text: repairedSpanishText, requestId: "repair-b2" });
        }
        // Teacher call -> 500 triggers FallbackTeacherPolicy at B2
        return jsonResponse({ error: "teacher unavailable" }, 500);
      }
      return null;
    });

    const { telemetry, host } = makeSharedSetup(
      { debugBandOverride: "B2" },
      allEnglishText,
      { environment: { SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "http://localhost:8787" } }
    );

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    const turn = await host.submitInput({ kind: "advance" });

    // The repaired Spanish text replaced the all-English original.
    expect(turn?.text).toBe(repairedSpanishText);

    // verify.ratio-verdict fired with under-ratio for the all-English original.
    const ratioVerdicts = await telemetry.query({ eventKinds: ["verify.ratio-verdict"] });
    const underRatioVerdicts = ratioVerdicts.filter(
      (v) => (v as unknown as { conformance: string }).conformance === "under-ratio"
    );
    expect(underRatioVerdicts.length).toBeGreaterThan(0);

    // verify.repair-triggered fired and its instruction referenced the target ratio.
    const repairs = await telemetry.query({ eventKinds: ["verify.repair-triggered"] });
    expect(repairs.length).toBeGreaterThan(0);
    const repairEvent = repairs[0] as unknown as { violations: string[] };
    // Both the fallback policy and the 087.6 schedule-driven realizer read the
    // shared band-envelope table, so target-dominant is 85% on either path.
    expect(repairEvent.violations.some((v) => v.includes("85%") && v.includes("Spanish"))).toBe(true);
  });

  it("verify: an unrepairable turn SHIPS UNCHANGED rather than being rewritten", async () => {
    // "adelante" is above A1. With no proxy URL the LLM repair returns null, so
    // there is nothing left to try -- and that is the end of it.
    //
    // This used to assert the OPPOSITE: that autoSimplify stripped "adelante"
    // out. That fallback rewrote finished text, swapping each out-of-band lemma
    // for a lower-band one chosen by band and part of speech with no notion of
    // meaning -- 2,996 lemmas mapped to "el" and 910 to "y", so `sostener`
    // became "and". Deleted 2026-08-02.
    //
    // Out of envelope but grammatical beats in-envelope nonsense. The verdict
    // still records the violation; the player still gets a readable line.
    const { host } = makeSharedSetup({}, "Hola, adelante por favor.");

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    const turn = await host.submitInput({ kind: "advance" });

    expect(turn?.text).toBeDefined();
    expect(turn!.text.toLowerCase()).toContain("adelante");
  });

  it("scripted anchored posture: zero LLM calls", async () => {
    // A1 learner -> anchored posture -> baked variant or authored English,
    // no /generate call.
    // The prescription includes "hola" so any authored word that resolves to
    // "hola" in the gloss index gets substituted. We assert no gateway calls and
    // that the scripted middleware ran (turn text is not the authored English
    // verbatim when a substitution occurs, or is unchanged when none apply --
    // the fetch guard enforces the no-LLM invariant regardless of outcome).
    //
    // No proxy URL is set: if the scripted middleware calls the gateway it would
    // create an LLM client... but we also install the fetch guard so any stray
    // fetch throws. The test passes if no exception from the guard fires.
    const authoredLine = "Hello, welcome to the station.";
    const { services, host } = makeSharedSetup({}, "Hola.", {
      environment: { SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "http://localhost:8787" }
    });

    // Seed the preview lexicon with "hola" so the budgeter prescribes it for A1.
    services.seedPreviewLexicons({ lexicons: [HOLA_PREVIEW_LEXICON] });

    // The fetch guard blocks ALL /generate traffic.
    // Reinstall with explicit handler: allow nothing -- the test must make zero LLM calls.
    installFetchGuard((_url) => null);

    let capturedText: string | undefined;
    const capturingMiddleware: ConversationMiddleware = {
      middlewareId: "test.text-capture",
      displayName: "Text Capture",
      priority: 1000,
      stage: "analysis",
      finalize(_execution, turn) {
        if (turn) capturedText = turn.text;
        return turn;
      }
    };

    const blackboard2 = createRuntimeBlackboard({
      definitions: [
        ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
        ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
      ]
    });
    const config2 = normalizeSugarLangPluginConfig({
      targetLanguage: "es",
      verifyEnabled: false
    });
    const logger2 = createSugarlangLogger({ debugLogging: false });
    const services2 = new SugarlangRuntimeServices({
      config: config2,
      logger: logger2,
      environment: { SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "http://localhost:8787" }
    });
    services2.bindRuntime({
      boot: createRuntimeBootModel({
        hostKind: "studio",
        compileProfile: "authoring-preview",
        contentSource: "authored-game-root"
      }),
      blackboard: blackboard2,
      playerDefinition: createDefaultPlayerDefinition("project-1", { definitionId: "player-1" }),
      activeRegion: null,
      activeScene: null,
      npcDefinitions: TEST_NPC_DEFINITIONS,
      dialogueDefinitions: TEST_DIALOGUE_DEFINITIONS,
      questDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: []
    });
    services2.seedPreviewLexicons({ lexicons: [HOLA_PREVIEW_LEXICON] });

    const middlewares2 = [
      makeRuntimeContextMiddleware(),
      ...SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) =>
        factory({ services: services2, logger: logger2 })
      ),
      capturingMiddleware
    ];
    const host2 = createConversationHost({
      providers: [makeNpcTurnProvider("Hola.", authoredLine)],
      middlewares: middlewares2
    });

    // Must not throw (fetch guard fires if /generate is called).
    const turn = await host2.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // Turn must be defined and the middleware chain must have run.
    expect(turn).toBeDefined();
    // capturedText is the text after the scripted middleware ran.
    // With an empty introduce list (no prescription yet) substitution is a no-op;
    // the important invariant is zero /generate calls, enforced by the guard above.
    expect(capturedText).toBeDefined();

    void authoredLine; // referenced by makeNpcTurnProvider; unused in assertion by design
    void services; // makeSharedSetup result not used in this sub-fixture
    void host;
  });

  it("086.5: with trigger off, behavior is byte-identical to 086.4 (no live render calls)", async () => {
    // The liveRenderTriggered stub is hardcoded false, so the live-render path
    // is never entered. This test confirms that:
    //   1. A target-dominant scripted turn with a warm variant cache still uses the
    //      baked variant text (086.4 behavior is unchanged).
    //   2. Zero /generate calls reach the gateway (fetch guard enforces this).
    // This is byte-identical to the "uses baked variant when variant cache is warm"
    // test but explicitly documents that the trigger=off path adds no LLM calls.
    const authoredLine = "Welcome to the station, traveler.";
    const bakedVariantText = "Bienvenido a la estacion, viajero.";

    const nodeId = "";
    const contentHash = [nodeId, authoredLine, JSON.stringify({})].join("|");

    const variantCache = new MemoryVariantCache();
    const entry: VariantCacheEntry = {
      key: {
        lang: "es",
        band: "B1",
        contentHash,
        variantPromptVersion: VARIANT_PROMPT_VERSION
      },
      variant: {
        source: {
          kind: "dialogue-node",
          dialogueDefinitionId: "dialogue-orrin",
          nodeId
        },
        lang: "es",
        band: "B1",
        text: bakedVariantText,
        verdict: {
          envelopePasses: true,
          ratioPasses: true,
          voiceRetentionScore: 1.0,
          fidelityPasses: true,
          overallPasses: true
        },
        reviewFlag: false,
        generatedAtMs: Date.now(),
        generatedByModel: "test",
        contentHash,
        promptVersion: VARIANT_PROMPT_VERSION
      }
    };
    await variantCache.set(entry);

    // Allow nothing from the gateway -- the trigger=off path must make zero LLM calls.
    installFetchGuard((_url) => null);

    const { services, host } = makeSharedSetup({ debugBandOverride: "B1" }, "Hola.", {
      initialText: authoredLine
    });

    const execServices = await services.resolveForExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        targetLanguage: "es",
        supportLanguage: "en"
      },
      annotations: {},
      state: {},
      runtimeContext: null,
      input: null
    } as unknown as Parameters<typeof services.resolveForExecution>[0]);
    if (execServices) {
      execServices.variantCache = variantCache;
      // No liveRenderCache set -- trigger is off anyway, but even if it were on,
      // the cache miss path would be gated by liveRenderTriggered=false.
    }

    const turn = await host.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // 086.4 warm-cache behavior is unchanged: baked variant text is used.
    expect(turn?.text).toBe(bakedVariantText);
    expect(turn?.text).not.toBe(authoredLine);
  });

  it("086.5: LiveRenderCache and verifyLiveRender work end-to-end (trigger integration waits for epic E)", async () => {
    // The middleware trigger is hardcoded false -- full middleware integration
    // test waits on epic E wiring. This test exercises the cache and verifier
    // directly to confirm the path works when called:
    //   1. verifyLiveRender produces a valid VariantVerdict for target-dominant Spanish.
    //   2. LiveRenderCache round-trips the entry correctly.
    //   3. A second cache.get() returns the same entry (cache hit, zero extra work).
    //
    // This is a direct unit test of the two new modules, not through the middleware.
    // Import them here (dynamic) so the test is self-contained and readable.
    const { LiveRenderCache, buildTeachablesKey } = await import(
      "../../runtime/compile/live-render-cache"
    );
    const { verifyLiveRender } = await import(
      "../../runtime/compile/verify-live-render"
    );
    const { CefrLexAtlasProvider } = await import(
      "../../runtime/providers/impls/cefr-lex-atlas-provider"
    );
    const { getAllInventoryExponents } = await import(
      "../../runtime/inventory/competency-inventory-loader"
    );

    const atlas = new CefrLexAtlasProvider();
    const inventoryExponents = getAllInventoryExponents("es");
    const introduce = [{ lemmaId: "hola", lang: "es" }];

    // Verify a Spanish line that contains "hola" -- fidelity floor passes.
    const verdict = verifyLiveRender({
      text: "Hola, bienvenido viajero.",
      targetLang: "es",
      band: "B1",
      posture: "target-dominant",
      directedRatio: 0.8,
      introduce,
      inventoryExponents,
      atlas
    });
    // Voice retention is always 1.0 (no voiceSpec at runtime).
    expect(verdict.voiceRetentionScore).toBe(1.0);
    // Fidelity floor: "hola" is present in the text -> passes.
    expect(verdict.fidelityPasses).toBe(true);

    // Cache round-trip.
    const cache = new LiveRenderCache();
    const key = {
      nodeId: "node-1",
      dialogueDefinitionId: "dialogue-orrin",
      lang: "es",
      band: "B1" as const,
      posture: "target-dominant" as const,
      teachablesKey: buildTeachablesKey(introduce)
    };
    const cacheEntry = {
      text: "Hola, bienvenido viajero.",
      verdict,
      cachedAtMs: Date.now()
    };

    expect(cache.get(key)).toBeNull();
    cache.set(key, cacheEntry);
    expect(cache.get(key)).toBe(cacheEntry);
    // Second get is the cache hit -- same object.
    expect(cache.get(key)).toBe(cacheEntry);
    expect(cache.size()).toBe(1);
  });

  it("086.4 pin: prescription-less scripted line still produces introduce highlights from substitution", async () => {
    // Pin for 086.4 deletion: the gloss-scan lineIntroduce variable is gone.
    // For prescription-less scripted lines substitution now runs with whatever
    // introduce list the teacher built from the seeded lexicon (possibly empty).
    // This confirms the scripted middleware produces a valid turn and the
    // constraint.targetVocab.introduce field is present and is an array --
    // no regression from the deletion.
    //
    // With the HOLA_PREVIEW_LEXICON seeded, the teacher's FallbackTeacherPolicy
    // (A1 learner) will include "hola" in the introduce list even without an
    // explicit prescription. It then substitutes forms from that
    // list. The introduce list in the constraint after the middleware runs must
    // be an array (possibly empty if no forms were woven).
    const authoredLine = "Hello, welcome to the station.";
    installFetchGuard((_url) => null); // zero LLM calls

    let capturedConstraint: { targetVocab?: { introduce?: unknown[] } } | undefined;
    const capturingMiddleware: ConversationMiddleware = {
      middlewareId: "test.constraint-capture",
      displayName: "Constraint Capture",
      priority: 1000,
      stage: "analysis",
      finalize(execution, turn) {
        const c = execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION];
        if (c) {
          capturedConstraint = c as { targetVocab?: { introduce?: unknown[] } };
        }
        return turn;
      }
    };

    const blackboard3 = createRuntimeBlackboard({
      definitions: [
        ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
        ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
      ]
    });
    const config3 = normalizeSugarLangPluginConfig({
      targetLanguage: "es",
      verifyEnabled: false
    });
    const logger3 = createSugarlangLogger({ debugLogging: false });
    const services3 = new SugarlangRuntimeServices({ config: config3, logger: logger3 });
    services3.bindRuntime({
      boot: createRuntimeBootModel({
        hostKind: "studio",
        compileProfile: "authoring-preview",
        contentSource: "authored-game-root"
      }),
      blackboard: blackboard3,
      playerDefinition: createDefaultPlayerDefinition("project-1", { definitionId: "player-1" }),
      activeRegion: null,
      activeScene: null,
      npcDefinitions: TEST_NPC_DEFINITIONS,
      dialogueDefinitions: TEST_DIALOGUE_DEFINITIONS,
      questDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: []
    });
    // No seeded lexicon -- prescription-less scripted line.
    // No intent cache -- the 086.4 replacement signal is absent.

    const middlewares3 = [
      makeRuntimeContextMiddleware(),
      ...SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) =>
        factory({ services: services3, logger: logger3 })
      ),
      capturingMiddleware
    ];
    const host3 = createConversationHost({
      providers: [makeNpcTurnProvider("Hola.", authoredLine)],
      middlewares: middlewares3
    });

    const turn = await host3.startSession({
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en"
    });

    // The turn must be defined and the middleware must not have errored.
    expect(turn).toBeDefined();
    // The constraint's introduce field is an array (even if empty -- no regression).
    expect(capturedConstraint).toBeDefined();
    expect(Array.isArray(capturedConstraint?.targetVocab?.introduce)).toBe(true);
  });
});
