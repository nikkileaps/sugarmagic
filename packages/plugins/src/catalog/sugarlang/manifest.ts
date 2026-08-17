/**
 * packages/plugins/src/catalog/sugarlang/manifest.ts
 *
 * Purpose: Declares the discovered-plugin manifest and runtime middleware ownership for sugarlang.
 *
 * Exports:
 *   - SUGARLANG_PLUGIN_ID
 *   - SUGARLANG_DISPLAY_NAME
 *   - createSugarlangPlugin
 *   - SUGARLANG_MIDDLEWARE_FACTORIES
 *   - pluginDefinition
 *
 * Relationships:
 *   - Depends on ./config, ./runtime/runtime-services, and ./ui/shell/contributions for plugin assembly.
 *   - Is re-exported by ./index as the canonical plugin definition for discovery.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §End-to-End Turn Flow / §File Structure
 *
 * Status: active
 */

import type { DiscoveredPluginDefinition } from "../../sdk";
import { createRegionTeacherWarmer } from "./runtime/teacher/warm-region-teacher";
import { createSugarlangTargetLanguageSaveParticipant } from "./runtime/target-language-save-participant";
import { buildTargetLanguagePreNewGameStep } from "./runtime/target-language-pre-new-game-step";
import type { RuntimePluginFactoryContext } from "../../runtime";
import {
  createDeploymentRequirementId,
  type DeploymentRequirement
} from "@sugarmagic/domain";
import type {
  ConversationMiddlewareContribution,
  DebugHudCardContribution,
  DialogueEntryDecoratorContribution,
  PreNewGameStepContribution,
  QuestAssessmentContribution,
  DisplayTextResolverContribution,
  RuntimePluginInstance
} from "@sugarmagic/runtime-core";
import {
  SUGARLANG_TEACHABLE_LANGUAGES,
  normalizeSugarLangPluginConfig,
  resolveSugarlangProxyBaseUrl
} from "./config";
import { languageDisplayName } from "./runtime/language-names";
import { loadSceneContextsFromArtifact } from "./runtime/compile/artifact-loader";
import { seedShippedVariantCache } from "./runtime/compile/shipped-variant-cache";
import {
  createSugarLangContextMiddleware
} from "./runtime/middlewares/sugar-lang-context-middleware";
import {
  createSugarLangTeacherMiddleware
} from "./runtime/middlewares/sugar-lang-teacher-middleware";
import {
  createSugarLangObserveMiddleware
} from "./runtime/middlewares/sugar-lang-observe-middleware";
import {
  createSugarLangVerifyMiddleware
} from "./runtime/middlewares/sugar-lang-verify-middleware";
import {
  createSugarLangScriptedMiddleware
} from "./runtime/middlewares/sugar-lang-scripted-middleware";
import {
  extractSugarlangPreviewBootLexicons,
  extractSugarlangPreviewBootSceneContexts,
  extractSugarlangStudioWorkspaceId
} from "./runtime/compile/preview-boot";
import {
  seedSugarlangRuntimeCompileCache,
  seedSugarlangRuntimeSceneContext
} from "./runtime/compile/runtime-cache-state";
import {
  SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
} from "./runtime/learner";
import { createDisplayTextResolver } from "./runtime/grading/display-text-resolver";
import { GRADED_TEXT_PROMPT_VERSION } from "./runtime/grading/graded-text-service";
import { createSugarlangLogger } from "./runtime/logger";
import { createSugarlangDialogueContribution } from "./runtime/dialogue-entry-decorator";
import { createSceneContextHudCard } from "./runtime/scene-context-hud-card";
import { createLearnerDebugHudCard } from "./runtime/learner-debug-hud-card";
import { readTurnDebugState } from "./runtime/debug/turn-debug-state";
import { SugarlangRuntimeServices } from "./runtime/runtime-services";
import {
  flushTelemetry,
  resolveSugarlangTelemetrySink
} from "./runtime/telemetry/telemetry";
import {
  sugarlangShellContributionDefinition,
  setSugarlangChunkExtractionEnabled
} from "./ui/shell/contributions";

// Defined in a leaf module so runtime code can namespace its storage with it
// without importing this file. Re-exported so callers see one name.
export { SUGARLANG_PLUGIN_ID } from "./plugin-id";
import { SUGARLANG_PLUGIN_ID } from "./plugin-id";
import { SUGARLANG_LEARNER_MIGRATIONS } from "./runtime/learner/learner-tables";
export const SUGARLANG_DISPLAY_NAME = "Sugarlang";

const deploymentRequirements: DeploymentRequirement[] = [
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARLANG_PLUGIN_ID,
      kind: "proxy-route",
      key: "sugarlang-telemetry"
    }),
    ownerId: SUGARLANG_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "proxy-route",
    required: false,
    routeId: "sugarlang-telemetry",
    protocol: "http-json",
    consumer: "browser-runtime",
    pathHint: "/api/sugarlang/telemetry",
    description: "Browser-to-backend telemetry ingestion route for sugarlang teaching analytics."
  }
];

export function createSugarlangPlugin(
  context: RuntimePluginFactoryContext
): RuntimePluginInstance {
  const config = normalizeSugarLangPluginConfig(
    context.configuration.config,
    context.environment
  );

  // Wire the chunk extraction toggle so Studio shell components respect it.
  setSugarlangChunkExtractionEnabled(config.chunkExtraction.enabled);
  const logger = createSugarlangLogger({ debugLogging: config.debugLogging });
  const proxyBaseUrl = resolveSugarlangProxyBaseUrl(context.environment);
  const telemetry = resolveSugarlangTelemetrySink({ proxyBaseUrl });
  const services = new SugarlangRuntimeServices({
    config,
    environment: context.environment,
    logger,
    telemetry
  });
  const dialogueContribution = createSugarlangDialogueContribution();
  const decoratorContribution: DialogueEntryDecoratorContribution = {
    pluginId: context.configuration.pluginId,
    contributionId: "sugarlang.dialogue.entry-decorator",
    kind: "dialogue.entryDecorator",
    displayName: "Sugarlang Focus Term Highlighter",
    priority: 10,
    payload: {
      summary: "Highlights focus vocabulary, celebrates player production, and tracks hover observations.",
      decorate: dialogueContribution.decorate,
      onTermHover: dialogueContribution.onTermHover,
      // 090.12: select-to-translate. The panel calls this on a mouseup inside a
      // turn; null means show nothing.
      lookupSelection: dialogueContribution.lookupSelection
    }
  };

  // Runtime grading seam. Registering this is what lets item views (and later
  // spells, interactables) show band-appropriate text. Its resolver is total --
  // it returns the authored English whenever it has nothing better -- so the
  // only effect of NOT registering it is that surfaces render authored English
  // by a shorter path. That is the whole graceful-degradation story.
  const displayTextContribution: DisplayTextResolverContribution = {
    pluginId: context.configuration.pluginId,
    contributionId: "sugarlang.display-text.resolver",
    kind: "displayText.resolver",
    displayName: "Sugarlang Graded Text",
    priority: 10,
    payload: {
      summary:
        "Swaps authored English for a band-appropriate graded version when one has been generated.",
      resolve: createDisplayTextResolver({
        getVariantCache: () => services.getVariantCache(),
        getTargetLanguage: () => services.getTargetLanguage(),
        getLearnerBand: () => services.getLearnerBand(),
        promptVersion: GRADED_TEXT_PROMPT_VERSION
      })
    }
  };

  // Studio-preview-only readout of what the runtime was seeded with. The first
  // thing that makes scene context visible at all -- everything else about it
  // lives in IndexedDB and memory.
  const sceneContextCardContribution = createSceneContextHudCard({
    pluginId: context.configuration.pluginId,
    getSceneContext: (sceneId) => services.getSceneContext(sceneId)
  });

  // What the teaching system knows about the learner, while playing. Contributed
  // by this plugin, so it simply does not exist when sugarlang is absent or
  // disabled -- the HUD renders whatever cards it is given and knows nothing
  // about any of this. Every piece of sugarlang state reaches it through the
  // getters below rather than through the card context, which is what keeps
  // runtime-core unaware that a learner is a thing.
  const learnerCardContribution = createLearnerDebugHudCard({
    pluginId: context.configuration.pluginId,
    getSnapshot: async () => {
      const debugState = await services.getDebugState();
      if (!debugState) return null;
      return {
        estimatedCefrBand: debugState.estimatedCefrBand,
        assessmentStatus: debugState.assessmentStatus,
        cefrConfidence: debugState.cefrConfidence,
        lemmaCards: debugState.lemmaCards,
        exponentCards: debugState.exponentCards,
        teachRecordCount: debugState.teachRecords.length
      };
    },
    getTurnState: () => readTurnDebugState(),
    getTargetLanguage: () => services.getTargetLanguage()
  });

  /**
   * THE PLACEMENT ASSESSMENT, AS A QUEST FORM.
   *
   * The quest layer knows an objective is an assessment and which NPC it
   * targets. It asks for a form and hands back the answers; it never learns
   * what a placement questionnaire is or what a CEFR band means.
   *
   * Placement used to be a CONVERSATION -- the form was built as a dialogue
   * turn by sugaragent's generate stage, so it only worked for free-form NPCs
   * and needed a turn counter to decide when to appear.
   */
  const assessmentContribution: QuestAssessmentContribution = {
    pluginId: context.configuration.pluginId,
    contributionId: "sugarlang.quest.placement-assessment",
    kind: "quest.assessment",
    displayName: "Sugarlang Placement Assessment",
    priority: 10,
    payload: {
      summary: "Supplies the placement questionnaire for assessment objectives and scores it.",
      getForm: () => services.getPlacementQuestForm(),
      submit: (response) => services.submitPlacementQuestForm(response)
    }
  };

  /**
   * The language question, asked once between the New Game press and the wipe.
   *
   * The game knows there is a question to put on screen before it destroys the
   * save. It does not know this one is about language, and does not read the
   * answer -- it hands the answer back at the next boot and sugarlang decides
   * what it meant.
   */
  const languagePickerContribution: PreNewGameStepContribution = {
    pluginId: context.configuration.pluginId,
    contributionId: "sugarlang.new-game.language-picker",
    kind: "newGame.preStep",
    displayName: "Sugarlang Language Picker",
    priority: 10,
    payload: {
      summary: "Asks which language this game is played in.",
      getStep: () => buildTargetLanguagePreNewGameStep(config)
    }
  };

  const contributions: (
    | ConversationMiddlewareContribution
    | DialogueEntryDecoratorContribution
    | DisplayTextResolverContribution
    | DebugHudCardContribution
    | QuestAssessmentContribution
    | PreNewGameStepContribution
  )[] =
    [decoratorContribution, displayTextContribution, sceneContextCardContribution, learnerCardContribution, assessmentContribution, languagePickerContribution, ...SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) => {
      const middleware = factory({ services, logger, telemetry });
      return {
        pluginId: context.configuration.pluginId,
        contributionId: `sugarlang.middleware.${middleware.middlewareId}`,
        kind: "conversation.middleware",
        displayName: middleware.displayName,
        priority: middleware.priority,
        payload: {
          middlewareId: middleware.middlewareId,
          summary: `Sugarlang ${middleware.stage} middleware`,
          stage: middleware.stage,
          status: "ready",
          middleware
        }
      } as ConversationMiddlewareContribution;
    })];

  // Pre-fills the Teacher's directive slot for the region's NPCs so the FIRST
  // turn of a conversation is a cache hit rather than a ~10s blocking call
  // (sugarmagic-latency-00m). Driven from `update` rather than `init` on
  // purpose: init runs BEFORE the save restore, so a directive planned there
  // would be keyed against default "morning" and a null quest and would never
  // match a real turn. The warmer re-warms when the key moves, so a too-early
  // attempt corrects itself at the cost of one wasted call.
  const regionWarmer = createRegionTeacherWarmer({
    listWarmableNpcIds: () => services.listWarmableNpcIds(),
    buildWarmContext: () => services.buildRegionWarmContext()
  });

  return {
    pluginId: context.configuration.pluginId,
    displayName: SUGARLANG_DISPLAY_NAME,
    contributions,
    blackboardFactDefinitions: SUGARLANG_BLACKBOARD_FACT_DEFINITIONS,
    // This game's target language lives in the game's save, in a slice
    // sugarlang owns. Declared here rather than set up in init: the host
    // registers declared participants before the first deserialize pass, and
    // the runtime reads the language when it binds, which is after that pass.
    saveParticipants: [createSugarlangTargetLanguageSaveParticipant()],
    // Plan 092.6.3 — the learner's word history and level, opened at boot so
    // the first sync pass reconciles them before the player can reach a
    // conversation. Deliberately NOT in `init` below: that needs a world, and
    // by the time there is one the boot wait is over.
    openAccountStorage(context) {
      return services.openAccountStorage(context);
    },
    update(deltaSeconds) {
      // The runtime's frame delta is SECONDS (runtimeHost.ts: (now - lastTime)
      // / 1000). The warmer counts milliseconds, so this converts. Passing
      // seconds straight through would make the 2s check fire after ~33
      // minutes of play -- a feature that looks wired and never runs.
      regionWarmer.tick(deltaSeconds * 1000);
    },
    async init(runtimeContext) {
      services.bindRuntime(runtimeContext);
      const bootPayload = runtimeContext.pluginBootPayloads?.[SUGARLANG_PLUGIN_ID];
      const lexicons = extractSugarlangPreviewBootLexicons(bootPayload);
      await seedSugarlangRuntimeCompileCache(lexicons);
      // The runtime cannot build these -- extraction is a gateway call and a
      // Studio-only pass -- so they have to arrive already made.
      //
      // ONE SOURCE PER HOST, chosen by host rather than by falling back. In
      // Studio the Preview window is same-origin with the editor and gets the
      // models by postMessage, live, so an author sees a rebuild immediately.
      // A published game has no Studio to message it: it reads the artifact
      // file it shipped with. A fallback chain would hide a broken source
      // behind a working one -- exactly how "the Teacher has no scene
      // concepts" stayed invisible in production for months (Plan 092.3).
      const isPublished = runtimeContext.boot.hostKind === "published-web";
      const seededContexts = isPublished
        ? await loadSceneContextsFromArtifact(runtimeContext.assetSources)
        : extractSugarlangPreviewBootSceneContexts(bootPayload);

      // Plan 092.4 — the graded text a scripted line and an item description
      // render. Studio reads the live workspace database instead, so a variant
      // edited in the popover shows in Preview without saving; only a deployed
      // game reads the shipped file.
      if (isPublished) {
        const shippedVariants = await seedShippedVariantCache(
          runtimeContext.assetSources
        );
        console.info(
          `[sugarlang runtime] seeded ${shippedVariants} graded line variant(s)`,
          { source: "shipped artifact" }
        );
      }
      seedSugarlangRuntimeSceneContext(seededContexts);
      console.info(
        `[sugarlang runtime] seeded ${seededContexts.length} scene context model(s)`,
        {
          source: isPublished ? "shipped artifact" : "studio boot payload",
          models: seededContexts.map((model) => ({
            sceneId: model.sceneId,
            concepts: model.concepts.length
          }))
        }
      );
      const studioWorkspaceId = extractSugarlangStudioWorkspaceId(bootPayload);
      if (studioWorkspaceId) {
        services.wireStudioVariantCache(studioWorkspaceId);
      }
      // Dev-only debug handle for automated verification and manual band
      // overrides. Same DEV guard as __sugarmagicDebug (targets/web
      // runtimeHost.ts). Never present in a published artifact.
      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
        (globalThis as { __sugarlangDebug?: unknown }).__sugarlangDebug = {
          setBand: (band: string, pin = false) =>
            services.applyDebugBandOverride(band as never, pin),
          pin: (band: string) =>
            services.applyDebugBandOverride(band as never, true),
          reset: () => services.resetDebugState(),
          getState: () => services.getDebugState()
        };
      }
    },
    // The first conversation of a session is the one the frame-tick warmer
    // cannot help: it fires on a timer that the player can outrun. Warming here
    // means the directive is decided against the world the save just restored,
    // rather than against whatever had loaded when the timer happened to fire.
    async beforeFirstFrame() {
      await regionWarmer.warmNow();
    },
    async dispose() {
      // Stop the warmer FIRST: a ~9s Teacher call in flight would otherwise
      // land and write a directive for a region nobody is in any more. Its own
      // test asserts this guarantee, and until this line existed the guarantee
      // was untested behaviour that production never invoked.
      regionWarmer.dispose();
      // Then the directive itself. Stopping the warmer stops new calls; this
      // drops what is held and refuses a write from a call already running.
      services.disposeTeachers();
      // 081.2: flush buffered telemetry on conversation/plugin teardown so
      // the session tail is not lost, then tear down sink timers/listeners.
      await flushTelemetry(telemetry, logger);
      await telemetry.dispose?.();
    },
  };
}

export const SUGARLANG_MIDDLEWARE_FACTORIES = [
  createSugarLangContextMiddleware,
  createSugarLangTeacherMiddleware,
  createSugarLangVerifyMiddleware,
  createSugarLangScriptedMiddleware,
  createSugarLangObserveMiddleware
] as const;

export const pluginDefinition: DiscoveredPluginDefinition = {
  deploymentRequirements,
  // Plan 092.6.3 — the tables this plugin's synced learner data lands in.
  // Its own schema, its own numbered migration file.
  deployment: {
    supabaseMigrations: SUGARLANG_LEARNER_MIGRATIONS
  },
  manifest: {
    pluginId: SUGARLANG_PLUGIN_ID,
    displayName: SUGARLANG_DISPLAY_NAME,
    summary:
      "Adaptive language-learning middleware pipeline for Sugarmagic conversations.",
    capabilityIds: ["conversation.middleware", "dialogue.entryDecorator", "design.workspace"]
  },
  // Story 46.16 — schema-driven settings panel. Sugarlang ships
  // no apps/studio catalog entry today; with this schema declared,
  // Studio auto-mounts a workspace and renders the panel from the
  // schema. Demonstrates the "third-party plugin gets a working
  // settings panel with zero Studio-side code" exit signal.
  pluginSettingsSchema: [
    {
      configKey: "targetLanguage",
      label: "Target Language",
      type: "select",
      description:
        "Language the player is learning. Sugarlang biases generation + verification toward this language at gateway request time.",
      // Built from the same list the player's picker offers, so a language
      // added in one place cannot go missing from the other. "(unset)" is
      // authoring-only -- a project with no language set is something the
      // author is still working on, not something a player can choose.
      options: [
        { value: "", label: "(unset)" },
        ...SUGARLANG_TEACHABLE_LANGUAGES.map((code) => ({
          value: code,
          label: `${languageDisplayName(code)} (${code})`
        }))
      ],
      default: ""
    },
    {
      configKey: "teacherModel",
      label: "Teacher Model",
      type: "text",
      description:
        "Anthropic model for the Teacher's pedagogical judgment call. Blank uses the gateway default (claude-sonnet-4-6). This is the most reasoning-heavy call sugarlang makes -- it decides what to teach -- so it is deliberately separate from the NPC dialogue model.",
      placeholder: "claude-sonnet-4-6",
      default: ""
    },
    {
      configKey: "extractionModel",
      label: "Extraction Model",
      type: "text",
      description:
        "Anthropic model for the compile-time extraction passes: multi-word expressions, line intent, and scene concepts. Blank uses the gateway default (claude-sonnet-4-6). These run while authoring and are cached by content hash, so the cost is per content change rather than per turn.",
      placeholder: "claude-sonnet-4-6",
      default: ""
    },
    {
      configKey: "debugBandOverride",
      label: "Band Override (dev)",
      type: "select",
      description: "Skip placement and start at this CEFR band. Off = normal placement flow.",
      options: [
        { value: "", label: "(off — use placement)" },
        { value: "A1", label: "A1" },
        { value: "A2", label: "A2" },
        { value: "B1", label: "B1" },
        { value: "B2", label: "B2" },
        { value: "C1", label: "C1" },
        { value: "C2", label: "C2" }
      ],
      default: ""
    }
  ],
  // NOTE (2026-07-29): `targetLanguage` used to be declared here, plumbed to
  // the gateway as SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE. It was removed for two
  // reasons. First, the gateway never read it -- grep core.ts, there is no such
  // lookup -- so it was shipping a variable nothing consumed. Second and more
  // importantly, target language is a PLAYER's choice: two players of the same
  // deployment must be able to pick differently, which one env var per
  // deployment cannot express. It now resolves player -> project config, in
  // resolveSugarLangTargetLanguage and nowhere else.
  gatewayRuntimeConfigKeys: [
    {
      configKey: "teacherModel",
      envVarName: "SUGARMAGIC_SUGARLANG_TEACHER_MODEL",
      description:
        "Anthropic model the gateway uses for sugarlang's Teacher judgment call, resolved server-side from purpose:\"teacher\". Sugarlang owns this key rather than borrowing a SUGARMAGIC_SUGARAGENT_* one, so sugarlang's model choice does not depend on sugaragent's config (AGENTS.md one-way dependencies). Unset => gateway default claude-sonnet-4-6.",
      nonSecretAttestation: "safe-to-expose-publicly"
    },
    {
      configKey: "extractionModel",
      envVarName: "SUGARMAGIC_SUGARLANG_EXTRACTION_MODEL",
      description:
        "Anthropic model the gateway uses for sugarlang's COMPILE-time extraction passes (multi-word expressions, line intent, scene concepts), resolved server-side from purpose:\"extraction\". These run at authoring time and are cached by content hash, so the cost is per content change rather than per turn. Unset => gateway default claude-sonnet-4-6.",
      nonSecretAttestation: "safe-to-expose-publicly"
    }
  ],
  runtime: {
    createRuntimePlugin: createSugarlangPlugin
  },
  shell: sugarlangShellContributionDefinition
};
