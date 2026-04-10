/**
 * packages/plugins/src/catalog/sugarlang/runtime/runtime-services.ts
 *
 * Purpose: Owns the lazy runtime service graph that powers Sugarlang middleware execution.
 *
 * Exports:
 *   - SugarlangLoggerLike
 *   - SugarlangRuntimeServices
 *   - createNoOpTelemetrySink
 *
 * Relationships:
 *   - Depends on runtime-core blackboard and authored content passed through plugin init.
 *   - Is consumed by the plugin manifest and middleware factories as the single runtime service owner.
 *
 * Implements: Epic 10 runtime wiring for middleware pipeline integration
 *
 * Status: active
 */

import type {
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  NPCDefinition,
  PlayerDefinition,
  QuestDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "../../../runtime";
import type { RuntimePluginContext } from "@sugarmagic/runtime-core";
import type {
  ConversationExecutionContext,
  RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import { AnthropicClient, AnthropicLLMProvider } from "../../sugaragent/runtime/clients";
import type { LLMProvider } from "../../sugaragent/runtime/clients";
import type { SugarLangPluginConfig } from "../config";
import { resolveSugarLangTargetLanguage } from "../config";
import { LexicalBudgeter } from "./budgeter/lexical-budgeter";
import { EnvelopeClassifier } from "./classifier/envelope-classifier";
import { MorphologyLoader } from "./classifier/morphology-loader";
import { RuntimeCompileScheduler } from "./compile/compile-scheduler";
import { getSugarlangRuntimeCompileCache } from "./compile/runtime-cache-state";
import { DefaultSugarlangSceneLexiconStore } from "./compile/scene-lexicon-store";
import { createSceneAuthoringContext } from "./compile/scene-traversal";
import { ClaudeDirectorPolicy, createAnthropicDirectorClient } from "./director/claude-director-policy";
import { DirectiveCache } from "./director/directive-cache";
import { FallbackDirectorPolicy } from "./director/fallback-director-policy";
import { SugarLangDirector } from "./director/sugar-lang-director";
import { IndexedDBCardStore, MemoryCardStore, type CardStore } from "./learner/card-store";
import { LearnerStateReducer } from "./learner/learner-state-reducer";
import {
  PlacementQuestionnaireLoader
} from "./placement/placement-questionnaire-loader";
import { PlacementScoreEngine } from "./placement/placement-score-engine";
import { BlackboardLearnerStore } from "./providers/impls/blackboard-learner-store";
import { CefrLexAtlasProvider } from "./providers/impls/cefr-lex-atlas-provider";
import { FsrsLearnerPriorProvider } from "./providers/impls/fsrs-learner-prior-provider";
import type { TelemetrySink } from "./telemetry/telemetry";

export interface SugarlangLoggerLike {
  debug: (message: string, payload?: Record<string, unknown>) => void;
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
}

export interface SugarlangExecutionServices {
  atlas: CefrLexAtlasProvider;
  morphology: MorphologyLoader;
  classifier: EnvelopeClassifier;
  budgeter: LexicalBudgeter;
  placementQuestionnaireLoader: PlacementQuestionnaireLoader;
  placementScoreEngine: PlacementScoreEngine;
  learnerStore: BlackboardLearnerStore;
  learnerStateReducer: LearnerStateReducer;
  sceneLexiconStore: DefaultSugarlangSceneLexiconStore;
  director: SugarLangDirector;
  llmProvider: LLMProvider | null;
}

export interface SugarlangRuntimeServicesOptions {
  config: SugarLangPluginConfig;
  environment?: RuntimePluginEnvironment;
  logger: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

interface LanguageBundle {
  atlas: CefrLexAtlasProvider;
  morphology: MorphologyLoader;
  classifier: EnvelopeClassifier;
  budgeter: LexicalBudgeter;
  placementQuestionnaireLoader: PlacementQuestionnaireLoader;
  placementScoreEngine: PlacementScoreEngine;
  sceneLexiconStore: DefaultSugarlangSceneLexiconStore;
}

interface BoundRuntimeContext {
  blackboard: RuntimeBlackboard;
  activeRegion: RegionDocument | null;
  playerDefinition: PlayerDefinition;
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
}

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export function createNoOpTelemetrySink(): TelemetrySink {
  return NO_OP_TELEMETRY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSelectionLanguages(
  execution: ConversationExecutionContext,
  environment: RuntimePluginEnvironment | undefined
): { targetLanguage: string; supportLanguage: string } | null {
  const targetLanguage =
    execution.selection.targetLanguage?.trim().toLowerCase() ??
    resolveSugarLangTargetLanguage(environment);
  const supportLanguage =
    execution.selection.supportLanguage?.trim().toLowerCase() ?? "en";
  if (!targetLanguage) {
    return null;
  }
  return { targetLanguage, supportLanguage };
}

function buildLearnerId(
  playerEntityId: string,
  targetLanguage: string,
  supportLanguage: string
): string {
  return `${playerEntityId}:${targetLanguage}:${supportLanguage}`;
}

function createCardStore(profileId: string): CardStore {
  if (typeof indexedDB !== "undefined") {
    try {
      return new IndexedDBCardStore({ profileId });
    } catch {
      return new MemoryCardStore();
    }
  }
  return new MemoryCardStore();
}

export class SugarlangRuntimeServices {
  private readonly config: SugarLangPluginConfig;
  private readonly environment: RuntimePluginEnvironment | undefined;
  private readonly logger: SugarlangLoggerLike;
  private readonly telemetry: TelemetrySink;
  private readonly languageBundles = new Map<string, LanguageBundle>();
  private readonly executionServices = new Map<string, SugarlangExecutionServices>();
  private readonly previewLexicons = new Map<string, unknown>();
  private boundContext: BoundRuntimeContext | null = null;
  private readonly llmProvider: LLMProvider | null;
  private readonly directorClientFactory:
    | (() => ClaudeDirectorPolicy | null)
    | null;

  constructor(options: SugarlangRuntimeServicesOptions) {
    this.config = options.config;
    this.environment = options.environment;
    this.logger = options.logger;
    this.telemetry = options.telemetry ?? NO_OP_TELEMETRY;
    const anthropicApiKey = this.environment?.SUGARMAGIC_ANTHROPIC_API_KEY?.trim() ?? "";
    const anthropicModel =
      this.environment?.SUGARMAGIC_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

    if (anthropicApiKey) {
      const client = new AnthropicClient(anthropicApiKey);
      this.llmProvider = new AnthropicLLMProvider(client);
      this.directorClientFactory = () =>
        new ClaudeDirectorPolicy({
          client: createAnthropicDirectorClient(client),
          telemetry: this.telemetry,
          model: anthropicModel
        });
    } else {
      this.llmProvider = null;
      this.directorClientFactory = null;
    }
  }

  bindRuntime(context: RuntimePluginContext): void {
    if (!context.blackboard || !context.playerDefinition) {
      return;
    }
    this.boundContext = {
      blackboard: context.blackboard,
      activeRegion: context.activeRegion ?? null,
      playerDefinition: context.playerDefinition,
      itemDefinitions: context.itemDefinitions ?? [],
      documentDefinitions: context.documentDefinitions ?? [],
      npcDefinitions: context.npcDefinitions ?? [],
      dialogueDefinitions: context.dialogueDefinitions ?? [],
      questDefinitions: context.questDefinitions ?? []
    };
  }

  seedPreviewLexicons(payload: unknown): void {
    if (!isRecord(payload) || !Array.isArray(payload.lexicons)) {
      return;
    }
    for (const lexicon of payload.lexicons) {
      if (
        isRecord(lexicon) &&
        typeof lexicon.sceneId === "string" &&
        typeof lexicon.contentHash === "string"
      ) {
        this.previewLexicons.set(lexicon.sceneId, lexicon);
      }
    }
  }

  isBound(): boolean {
    return this.boundContext !== null;
  }

  getBlackboard(): RuntimeBlackboard | null {
    return this.boundContext?.blackboard ?? null;
  }

  getConfig(): SugarLangPluginConfig {
    return this.config;
  }

  findNpcDefinition(npcDefinitionId: string | undefined): NPCDefinition | null {
    if (!npcDefinitionId || !this.boundContext) {
      return null;
    }

    return (
      this.boundContext.npcDefinitions.find(
        (entry) => entry.definitionId === npcDefinitionId
      ) ?? null
    );
  }

  resolveForExecution(
    execution: ConversationExecutionContext
  ): SugarlangExecutionServices | null {
    if (!this.boundContext) {
      this.logger.warn("Sugarlang runtime services requested before binding.");
      return null;
    }

    const languages = getSelectionLanguages(execution, this.environment);
    if (!languages) {
      return null;
    }

    const key = `${languages.targetLanguage}:${languages.supportLanguage}`;
    const existing = this.executionServices.get(key);
    if (existing) {
      return existing;
    }

    const languageBundle = this.getLanguageBundle(languages.targetLanguage);
    const learnerId = buildLearnerId(
      this.boundContext.playerDefinition.definitionId,
      languages.targetLanguage,
      languages.supportLanguage
    );
    const cardStore = createCardStore(learnerId);
    const learnerPriorProvider = new FsrsLearnerPriorProvider(languageBundle.atlas);
    const learnerStore = new BlackboardLearnerStore({
      blackboard: this.boundContext.blackboard,
      playerEntityId: this.boundContext.playerDefinition.definitionId,
      learnerId: learnerId as never,
      targetLanguage: languages.targetLanguage,
      supportLanguage: languages.supportLanguage,
      cardStore,
      learnerPriorProvider
    });
    const learnerStateReducer = new LearnerStateReducer({
      profileId: learnerId as never,
      playerEntityId: this.boundContext.playerDefinition.definitionId,
      targetLanguage: languages.targetLanguage,
      supportLanguage: languages.supportLanguage,
      blackboard: this.boundContext.blackboard,
      cardStore,
      atlas: languageBundle.atlas,
      learnerPriorProvider,
      telemetry: this.telemetry
    });
    const directiveCache = new DirectiveCache({
      blackboard: this.boundContext.blackboard
    });
    const fallbackPolicy = new FallbackDirectorPolicy();
    const claudePolicy =
      this.directorClientFactory?.() ??
      {
        async invoke() {
          throw new Error("Sugarlang Claude policy is not configured.");
        }
      };
    const director = new SugarLangDirector({
      claudePolicy,
      fallbackPolicy,
      cache: directiveCache,
      telemetry: this.telemetry
    });

    const services: SugarlangExecutionServices = {
      ...languageBundle,
      learnerStore,
      learnerStateReducer,
      director,
      llmProvider: this.llmProvider
    };
    this.executionServices.set(key, services);
    return services;
  }

  private getLanguageBundle(targetLanguage: string): LanguageBundle {
    const existing = this.languageBundles.get(targetLanguage);
    if (existing) {
      return existing;
    }
    if (!this.boundContext) {
      throw new Error("Sugarlang runtime services are not yet bound to runtime context.");
    }

    const atlas = new CefrLexAtlasProvider();
    const morphology = new MorphologyLoader();
    const classifier = new EnvelopeClassifier(atlas, morphology);
    const learnerPriorProvider = new FsrsLearnerPriorProvider(atlas);
    const budgeter = new LexicalBudgeter({
      atlas,
      learnerPriorProvider
    });
    const placementQuestionnaireLoader = new PlacementQuestionnaireLoader();
    const placementScoreEngine = new PlacementScoreEngine(atlas, morphology);
    const compileCache = getSugarlangRuntimeCompileCache();
    const scheduler = new RuntimeCompileScheduler({
      getScene: (sceneId) => {
        if (
          !this.boundContext?.activeRegion ||
          this.boundContext.activeRegion.identity.id !== sceneId
        ) {
          return null;
        }

        return createSceneAuthoringContext({
          targetLanguage,
          region: this.boundContext.activeRegion,
          npcDefinitions: this.boundContext.npcDefinitions,
          dialogueDefinitions: this.boundContext.dialogueDefinitions,
          questDefinitions: this.boundContext.questDefinitions,
          itemDefinitions: this.boundContext.itemDefinitions,
          documentDefinitions: this.boundContext.documentDefinitions
        });
      },
      atlas,
      morphology,
      cache: compileCache,
      profile: "runtime-preview"
    });
    const sceneLexiconStore = new DefaultSugarlangSceneLexiconStore(scheduler);

    const previewLexicons = Array.from(this.previewLexicons.values()).filter(
      (lexicon) =>
        isRecord(lexicon) &&
        lexicon.profile === "runtime-preview" &&
        lexicon.sceneId === this.boundContext?.activeRegion?.identity.id
    );
    if (previewLexicons.length > 0) {
      sceneLexiconStore.seed(previewLexicons as never);
    }

    const bundle: LanguageBundle = {
      atlas,
      morphology,
      classifier,
      budgeter,
      placementQuestionnaireLoader,
      placementScoreEngine,
      sceneLexiconStore
    };
    this.languageBundles.set(targetLanguage, bundle);
    return bundle;
  }
}
