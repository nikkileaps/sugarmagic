/**
 * packages/plugins/src/catalog/sugarlang/runtime/runtime-services.ts
 *
 * Purpose: Owns the lazy runtime service graph that powers Sugarlang middleware execution.
 *
 * Exports:
 *   - SugarlangLoggerLike
 *   - SugarlangRuntimeServices
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
  RegionDocument,
  Scene
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "../../../runtime";
import type { RuntimePluginContext } from "@sugarmagic/runtime-core";
import type {
  ConversationExecutionContext,
  RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type { SugarLangPluginConfig } from "../config";
import { resolveSugarLangTargetLanguage, SUGARLANG_PROXY_BASE_URL_ENV } from "../config";
import { SugarlangGatewayClient } from "./llm/gateway-client";
import type { SugarlangLLMClient } from "./llm/types";
import { LexicalBudgeter } from "./budgeter/lexical-budgeter";
import { EnvelopeClassifier } from "./classifier/envelope-classifier";
import { MorphologyLoader } from "./classifier/morphology-loader";
import { RuntimeCompileScheduler } from "./compile/compile-scheduler";
import { getSugarlangRuntimeCompileCache } from "./compile/runtime-cache-state";
import { DefaultSugarlangSceneLexiconStore } from "./compile/scene-lexicon-store";
import { createSceneAuthoringContext } from "./compile/scene-traversal";
import {
  ClaudeTeacherPolicy,
  TeacherInvocationError,
  createGatewayTeacherClient
} from "./teacher/policies/llm-teacher-policy";
import { DirectiveCache } from "./teacher/directive-cache";
import { FallbackTeacherPolicy } from "./teacher/policies/fallback-teacher-policy";
import { SugarLangTeacher } from "./teacher/sugar-lang-teacher";
import { IndexedDBCardStore, MemoryCardStore, type CardStore } from "./learner/card-store";
import { LearnerStateReducer } from "./learner/learner-state-reducer";
import {
  PlacementQuestionnaireLoader
} from "./placement/placement-questionnaire-loader";
import { PlacementScoreEngine } from "./placement/placement-score-engine";
import { BlackboardLearnerStore } from "./providers/impls/blackboard-learner-store";
import { CefrLexAtlasProvider } from "./providers/impls/cefr-lex-atlas-provider";
import { FsrsLearnerPriorProvider } from "./providers/impls/fsrs-learner-prior-provider";
import {
  createNoOpTelemetrySink,
  type TelemetrySink
} from "./telemetry/telemetry";
import type { SugarlangLoggerLike } from "./logger";
export type { SugarlangLoggerLike } from "./logger";
import type { CEFRBand } from "./types";
import {
  LEARNER_PROFILE_FACT,
  SUGARLANG_LEARNER_STATE_WRITER,
  SUGARLANG_PLACEMENT_STATUS_FACT,
  SUGARLANG_PLACEMENT_WRITER,
  createLearnerProfileFactScope,
  createSugarlangPlacementStatusScope,
  getSugarlangPlacementStatus
} from "./learner/fact-definitions";
import { isInPostPlacementCalibration } from "./learner/calibration-window";
import type { PlacementCompletionEvent } from "./learner/learner-state-reducer";

export interface SugarlangExecutionServices {
  profileId: string;
  playerEntityId: string;
  atlas: CefrLexAtlasProvider;
  morphology: MorphologyLoader;
  classifier: EnvelopeClassifier;
  budgeter: LexicalBudgeter;
  placementQuestionnaireLoader: PlacementQuestionnaireLoader;
  placementScoreEngine: PlacementScoreEngine;
  learnerStore: BlackboardLearnerStore;
  learnerStateReducer: LearnerStateReducer;
  sceneLexiconStore: DefaultSugarlangSceneLexiconStore;
  teacher: SugarLangTeacher;
  llmClient: SugarlangLLMClient | null;
}

export interface SugarlangDebugState {
  estimatedCefrBand: CEFRBand;
  assessmentStatus: "unassessed" | "estimated" | "evaluated";
  cefrConfidence: number;
  placementStatus: "not-started" | "in-progress" | "completed";
  inCalibration: boolean;
  pinned: boolean;
  pinnedBand: CEFRBand | null;
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
  /** Plan 058 §058.1 — presences compile from the composed
   *  Scene overlay, not the region document. */
  activeScene: Scene | null;
  playerDefinition: PlayerDefinition;
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
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
  private readonly gatewayClient: SugarlangLLMClient | null;
  private readonly llmModel: string;
  private _debugPinnedBand: CEFRBand | null = null;

  constructor(options: SugarlangRuntimeServicesOptions) {
    this.config = options.config;
    this.environment = options.environment;
    this.logger = options.logger;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
    this.llmModel =
      this.environment?.SUGARMAGIC_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

    // All sugarlang LLM calls go through the shared SugarDeploy gateway.
    // The /api/sugaragent/generate handler is a generic Claude proxy — not
    // sugaragent-specific — so both plugins share it.
    const proxyBaseUrl =
      this.environment?.[SUGARLANG_PROXY_BASE_URL_ENV]?.trim() ||
      this.environment?.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL?.trim() ||
      "";
    this.gatewayClient = proxyBaseUrl
      ? new SugarlangGatewayClient(proxyBaseUrl)
      : null;
  }

  bindRuntime(context: RuntimePluginContext): void {
    if (!context.blackboard || !context.playerDefinition) {
      return;
    }
    this.boundContext = {
      blackboard: context.blackboard,
      activeRegion: context.activeRegion ?? null,
      activeScene: context.activeScene ?? null,
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

  getTargetLanguage(): string | null {
    return this.config.targetLanguage || null;
  }

  private getFirstExecutionServices(): SugarlangExecutionServices | null {
    return this.executionServices.values().next().value ?? null;
  }

  async applyDebugBandOverride(band: CEFRBand, pin: boolean): Promise<void> {
    this._debugPinnedBand = pin ? band : null;
    const services = this.getFirstExecutionServices();
    if (!services) return;
    const event: PlacementCompletionEvent = {
      type: "placement-completion",
      cefrBand: band,
      confidence: 1.0,
      completedAtMs: Date.now(),
      lemmasSeededFromFreeText: []
    };
    await services.learnerStateReducer.apply(event);
  }

  async getDebugState(): Promise<SugarlangDebugState | null> {
    const services = this.getFirstExecutionServices();
    if (!services || !this.boundContext) return null;
    const profile = await services.learnerStore.getCurrentProfile();
    const placement = getSugarlangPlacementStatus(
      this.boundContext.blackboard,
      services.profileId
    );
    return {
      estimatedCefrBand: profile.estimatedCefrBand,
      assessmentStatus: profile.assessment.status,
      cefrConfidence: profile.assessment.cefrConfidence,
      placementStatus: placement.status,
      inCalibration: isInPostPlacementCalibration(profile),
      pinned: this._debugPinnedBand !== null,
      pinnedBand: this._debugPinnedBand
    };
  }

  async resetDebugState(): Promise<void> {
    this._debugPinnedBand = null;
    const services = this.getFirstExecutionServices();
    const bb = this.boundContext?.blackboard;
    if (bb && services) {
      bb.clearFact({
        definition: LEARNER_PROFILE_FACT,
        scope: createLearnerProfileFactScope(services.playerEntityId),
        sourceSystem: SUGARLANG_LEARNER_STATE_WRITER
      });
      bb.clearFact({
        definition: SUGARLANG_PLACEMENT_STATUS_FACT,
        scope: createSugarlangPlacementStatusScope(services.profileId),
        sourceSystem: SUGARLANG_PLACEMENT_WRITER
      });
    }
    if (typeof indexedDB === "undefined") return;
    const databases = await indexedDB.databases();
    const sugarlangDbs = databases.filter(
      (db) =>
        db.name?.startsWith("sugarlang-card-store") ||
        db.name?.startsWith("sugarlang-telemetry")
    );
    await Promise.all(
      sugarlangDbs.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) { resolve(); return; }
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })
      )
    );
  }

  getPlayerDefinitionId(): string | null {
    return this.boundContext?.playerDefinition.definitionId ?? null;
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
      telemetry: this.telemetry,
      debugPinnedBand: () => this._debugPinnedBand
    });
    const directiveCache = new DirectiveCache({
      blackboard: this.boundContext.blackboard,
      telemetry: this.telemetry
    });
    const fallbackPolicy = new FallbackTeacherPolicy();
    const llmPolicy =
      this.gatewayClient
        ? new ClaudeTeacherPolicy({
            client: createGatewayTeacherClient(this.gatewayClient),
            telemetry: this.telemetry,
            logger: this.logger,
            model: this.llmModel
          })
        : {
            // Gateway not configured — every invoke triggers the fallback policy.
            // This is the "deterministic-only" degraded mode: the teacher always
            // falls back, NPC speech still generates via SugarAgent's own gateway,
            // and the pipeline completes without sugarlang-side LLM calls.
            async invoke() {
              throw new TeacherInvocationError(
                "Sugarlang LLM gateway is not configured. " +
                "Set SUGARMAGIC_SUGARLANG_PROXY_BASE_URL in your environment or " +
                "configure it through the deploy plugin. Running in fallback-only mode."
              );
            }
          };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy,
      cache: directiveCache,
      telemetry: this.telemetry
    });

    const services: SugarlangExecutionServices = {
      ...languageBundle,
      profileId: learnerId,
      playerEntityId: this.boundContext.playerDefinition.definitionId,
      learnerStore,
      learnerStateReducer,
      teacher,
      llmClient: this.gatewayClient
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
    const classifier = new EnvelopeClassifier(atlas, morphology, {
      telemetry: this.telemetry
    });
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
          activeScene: this.boundContext.activeScene,
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
