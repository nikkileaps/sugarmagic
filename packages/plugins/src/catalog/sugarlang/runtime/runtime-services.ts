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

import { requireSugarlangTargetLanguage } from "./target-language-save-participant";
import { composeRegionContents } from "@sugarmagic/domain";
import type {
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  NPCDefinition,
  NPCInteractionMode,
  PlayerDefinition,
  QuestDefinition,
  RegionDocument,
  Scene
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "../../../runtime";
import { buildPlacementCompletionEvent } from "./placement/placement-flow-orchestrator";
import { emitPlacementCompleted } from "./quest-integration/placement-completion";
import type {
  ConversationActionProposal,
  ConversationQuestFormResponse,
  QuestFormDefinition,
  PluginAccountStorageContext,
  RuntimePluginContext
} from "@sugarmagic/runtime-core";
import type {
  ConversationExecutionContext,
  RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import {
  createSyncedRecordStore,
  getActiveUserId,
  isSyncLoopRunning
} from "@sugarmagic/runtime-core";
import {
  getSugarlangTargetLanguage,
  setSugarlangTargetLanguage
} from "./target-language-save-participant";
import type { SugarLangPluginConfig } from "../config";
import {
  SUGARLANG_TARGET_LANGUAGE_STEP_ID,
  resolveSugarLangTargetLanguage,
  resolveSugarlangProxyBaseUrl
} from "../config";
import { IndexedDBVariantCache, type SugarlangVariantCache } from "./compile/variant-cache";
import { getShippedVariantCache } from "./compile/shipped-variant-cache";
import { LiveRenderCache } from "./compile/live-render-cache";
import { SugarlangGatewayClient } from "./llm/gateway-client";
import type { SugarlangLLMClient } from "./llm/types";
import { EnvelopeClassifier } from "./classifier/envelope-classifier";
import { MorphologyLoader } from "./classifier/morphology-loader";
import { RuntimeCompileScheduler } from "./compile/compile-scheduler";
import { getSugarlangRuntimeCompileCache } from "./compile/runtime-cache-state";
import { DefaultSugarlangSceneLexiconStore } from "./compile/scene-lexicon-store";
import type { SceneContextModel } from "./contracts/scene-context";
import { getSugarlangRuntimeSceneContext } from "./compile/runtime-cache-state";
import { createSceneAuthoringContext } from "./compile/scene-traversal";
import { composeSituation, situationKey } from "./situation";
import {
  ClaudeTeacherPolicy,
  TeacherInvocationError,
  createGatewayTeacherClient
} from "./teacher/policies/llm-teacher-policy";
import { DirectiveCache } from "./teacher/directive-cache";
import { FallbackTeacherPolicy } from "./teacher/policies/fallback-teacher-policy";
import { SugarLangTeacher } from "./teacher/sugar-lang-teacher";
import {
  IndexedDBCardStore,
  LearnerStateReducer,
  MemoryCardStore,
  createEncounterDebtLedger,
  createTeachRecordStore,
  resetSugarlangLearnerDatabases,
  type CardStore,
  type EncounterDebtLedger,
  type SugarlangLearnerDataResetResult,
  type TeachRecordStore
} from "./learner";
import { clearTurnDebugState } from "./debug/turn-debug-state";
import { isExponentCardKey } from "./inventory/card-display-name";
import {
  PlacementQuestionnaireLoader
} from "./placement/placement-questionnaire-loader";
import { PlacementScoreEngine } from "./placement/placement-score-engine";
import { BlackboardLearnerStore } from "./providers/impls/blackboard-learner-store";
import {
  initLearnerStores,
  type LearnerStores
} from "./learner/learner-stores";
import {
  LEARNER_PROFILE_CORE_KEY,
  type LearnerProfileCoreStore,
  type PersistedLearnerProfileCore
} from "./learner/persistence";
import { SUGARLANG_PLUGIN_ID } from "../plugin-id";
import { CefrLexAtlasProvider } from "./providers/impls/cefr-lex-atlas-provider";
import { FsrsLearnerPriorProvider } from "./providers/impls/fsrs-learner-prior-provider";
import {
  createNoOpTelemetrySink,
  type TelemetrySink,
  emitTelemetry,
  createTelemetryEvent
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
  getSugarlangPlacementStatus,
  isInPostPlacementCalibration,
  type PlacementCompletionEvent
} from "./learner";

export interface SugarlangExecutionServices {
  profileId: string;
  playerEntityId: string;
  atlas: CefrLexAtlasProvider;
  morphology: MorphologyLoader;
  classifier: EnvelopeClassifier;
  placementQuestionnaireLoader: PlacementQuestionnaireLoader;
  placementScoreEngine: PlacementScoreEngine;
  learnerStore: BlackboardLearnerStore;
  learnerStateReducer: LearnerStateReducer;
  cardStore: CardStore;
  teachRecordStore: TeachRecordStore;
  /** 087.2: encounter-debt ledger -- tracks diverse re-encounter debt per introduced item. */
  ledgerStore: EncounterDebtLedger;
  sceneLexiconStore: DefaultSugarlangSceneLexiconStore;
  /** 087.5: authored dialogue definitions -- the scripted middleware resolves a
   *  node's hand-authored intent from here so the runtime intent-cache key
   *  matches the bake-time key (key parity). */
  dialogueDefinitions: DialogueDefinition[];
  teacher: SugarLangTeacher;
  llmClient: SugarlangLLMClient | null;
  /** 086.4: optional variant cache injected by callers at bake time. */
  variantCache?: SugarlangVariantCache;
  /** 086.5: optional live-render cache (in-memory only; no persistence needed). */
  liveRenderCache?: LiveRenderCache;
  /** 087.1: outer-loop scheduler -- computes the cross-session teach schedule. */
}

export interface SugarlangDebugState {
  estimatedCefrBand: CEFRBand;
  assessmentStatus: "unassessed" | "estimated" | "evaluated";
  cefrConfidence: number;
  placementStatus: "not-started" | "in-progress" | "completed";
  inCalibration: boolean;
  pinned: boolean;
  pinnedBand: CEFRBand | null;
  /** 085.3: lemma cards in the learner store (excludes chunk cards). */
  lemmaCards: import("./learner").LemmaCard[];
  /** 085.3: exponent cards (see isExponentCardKey) in the learner store. */
  exponentCards: import("./learner").LemmaCard[];
  /** 085.5: teach records written for realized competencies. */
  teachRecords: import("./learner").TeachRecord[];
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
  placementQuestionnaireLoader: PlacementQuestionnaireLoader;
  placementScoreEngine: PlacementScoreEngine;
  sceneLexiconStore: DefaultSugarlangSceneLexiconStore;
}

interface BoundRuntimeContext {
  blackboard: RuntimeBlackboard;
  /** Host-supplied builder for the runtime half of a conversation context.
   *  Anything pre-computing a value a later turn reads must go through it. */
  buildConversationRuntimeContext?: RuntimePluginContext["buildConversationRuntimeContext"];
  activeRegion: RegionDocument | null;
  /** Plan 058 §058.1 — presences compile from the composed
   *  Scene overlay, not the region document. */
  activeScene: Scene | null;
  playerDefinition: PlayerDefinition;
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  /** Resolves an NPC's mode including any quest override. Absent
   *  when the host supplies no override store. */
  getEffectiveNpcInteractionMode?: (
    npcDefinitionId: string
  ) => NPCInteractionMode | null;
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The selection wins when the host set one -- it is the per-conversation
 * override -- and otherwise this falls through to the single resolver rather
 * than reading the environment on its own. It used to skip config entirely, so
 * a project language set in Studio was invisible here.
 */
function getSelectionLanguages(
  execution: ConversationExecutionContext,
  resolveFallbackTargetLanguage: () => string | null
): { targetLanguage: string; supportLanguage: string } | null {
  const targetLanguage =
    execution.selection.targetLanguage?.trim().toLowerCase() ||
    resolveFallbackTargetLanguage();
  const supportLanguage =
    execution.selection.supportLanguage?.trim().toLowerCase() || "en";
  if (!targetLanguage) {
    return null;
  }
  return { targetLanguage, supportLanguage };
}

/**
 * Identifies ONE learner: this account, this player character, this language
 * pair.
 *
 * THE ACCOUNT LEADS, AND IT USED NOT TO BE HERE AT ALL (Plan 092.6.1). Without
 * it every store below is shared by whoever sits at the browser: two accounts
 * on one machine got ONE word history between them, and one account on two
 * machines got two. That is a correctness bug on its own, and it made syncing
 * impossible -- pushing an unattributed history to an account would file one
 * player's words under another's name.
 *
 * `userId` is never blank: `resolveLearnerScope` refuses to build one before
 * identity has settled.
 */
function buildLearnerId(
  userId: string,
  playerEntityId: string,
  targetLanguage: string,
  supportLanguage: string
): string {
  return `${userId}:${playerEntityId}:${targetLanguage}:${supportLanguage}`;
}

/**
 * The signed-in account, or null when identity has not settled yet.
 *
 * Plugin runtimes are constructed BEFORE the host resolves an identity
 * provider, so this is read per call rather than captured -- the same
 * late-binding reason `getActiveUserId` exists at all. Callers DEFER: a
 * learner resolved under a null account would write a history that belongs to
 * nobody, which is the bug this replaced.
 */
function resolveLearnerScope(): string | null {
  const userId = getActiveUserId();
  return userId && userId.length > 0 ? userId : null;
}

export class SugarlangRuntimeServices {
  private readonly config: SugarLangPluginConfig;
  private readonly environment: RuntimePluginEnvironment | undefined;
  private readonly logger: SugarlangLoggerLike;
  private readonly telemetry: TelemetrySink;
  private readonly languageBundles = new Map<string, LanguageBundle>();
  private readonly executionServices = new Map<string, SugarlangExecutionServices>();
  /**
   * The learner's stores, keyed by account and language pair.
   *
   * SEPARATE FROM `executionServices` because they are opened much earlier --
   * at boot, by `openAccountStorage`, so the boot sync pass can reconcile them
   * before the player reaches anything. Execution services need a bound world
   * and cannot exist that early, so caching the stores with them would put
   * them back on the first conversation turn, which is the bug.
   */
  private readonly learnerStores = new Map<
    string,
    LearnerStores
  >();
  private boundContext: BoundRuntimeContext | null = null;
  private readonly gatewayClient: SugarlangLLMClient | null;
  private readonly llmModel: string;
  private _debugPinnedBand: CEFRBand | null = null;
  /**
   * Owns its own loader so the placement form can be produced before any
   * conversation exists. The loader has no dependencies -- it is the shipped
   * questionnaire bank.
   */
  private readonly placementFormLoader = new PlacementQuestionnaireLoader();
  /** WorkspaceId the Studio used when baking variants; wired from boot payload in manifest init. */
  private studioWorkspaceId: string | null = null;
  private _standaloneVariantCache: SugarlangVariantCache | undefined;
  /**
   * 090.3: session-scoped, deliberately not persisted -- a slate is a decision
   * about right now, and restoring one would resurrect a judgment made against a
   * world state that no longer exists.
   */

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
    const proxyBaseUrl = resolveSugarlangProxyBaseUrl(this.environment);
    this.gatewayClient = proxyBaseUrl
      ? new SugarlangGatewayClient(proxyBaseUrl)
      : null;
  }

  /**
   * Decide which language this game is in, once per boot.
   *
   * Precedence, highest first:
   *
   *   - the answer to the new-game picker, which only arrives on a boot that
   *     followed a New Game press. The save row is gone on that boot, so there
   *     is nothing for it to conflict with.
   *   - what the save restored, for every ordinary boot.
   *   - the project's authored language, for a save older than this slice.
   *     Settling it once means the next write persists it, so that game is
   *     pinned to it exactly as a picked one is -- an author changing the
   *     project default later cannot move a game already under way.
   */
  private settleTargetLanguage(context: RuntimePluginContext): void {
    const picked =
      context.preNewGameStepAnswers?.[SUGARLANG_TARGET_LANGUAGE_STEP_ID];
    const stored = getSugarlangTargetLanguage();
    setSugarlangTargetLanguage(picked ?? stored ?? this.config.targetLanguage);
    // The only observable for this in a published build: the debug HUD is
    // Studio-only and the window handles are dev-only.
    console.info(
      `[sugarlang] target language "${this.getTargetLanguage()}" from ` +
        `${picked ? "the picker" : stored ? "the save" : "project config"}.`
    );
  }

  bindRuntime(context: RuntimePluginContext): void {
    // BEFORE the world check below. Which language this game is in does not
    // depend on there being a world -- and a boot that returns early here
    // would otherwise never settle one, so nothing would persist it and the
    // player's pick would be gone by the next boot.
    this.settleTargetLanguage(context);

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
      ...(context.getEffectiveNpcInteractionMode
        ? {
            getEffectiveNpcInteractionMode:
              context.getEffectiveNpcInteractionMode
          }
        : {}),
      dialogueDefinitions: context.dialogueDefinitions ?? [],
      questDefinitions: context.questDefinitions ?? [],
      ...(context.buildConversationRuntimeContext
        ? { buildConversationRuntimeContext: context.buildConversationRuntimeContext }
        : {})
    };

    // Seed the band pin from config HERE, at bind, rather than waiting for a
    // conversation.
    //
    // `_debugPinnedBand` is the single source of truth for "what band is this
    // learner", and `config.debugBandOverride` is one of two things that can
    // set it (the Learner Override panel is the other). Seeding it lazily --
    // which is what `resolveForLanguages` used to do, and still does for the
    // placement event -- meant the pin stayed null until the player talked to
    // somebody. Any surface that asked before then, like an item view, got a
    // null band and silently fell back to English.
    //
    // The matching PlacementCompletionEvent still fires from
    // `resolveForLanguages`, because applying it needs the learner state
    // reducer, which is per-language. Only the pin moves here.
    if (
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV &&
      this.config.debugBandOverride
    ) {
      this._debugPinnedBand = this.config.debugBandOverride as CEFRBand;
    }
  }


  wireStudioVariantCache(workspaceId: string): void {
    if (this.studioWorkspaceId !== workspaceId) {
      this._standaloneVariantCache = undefined;
    }
    this.studioWorkspaceId = workspaceId;
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

  /**
   * The runtime's single answer for "which language are we teaching?".
   *
   * Delegates to `resolveSugarLangTargetLanguage`, which owns the precedence
   * (player -> config). Callers must not re-derive it: reading config directly
   * is what produced four sources resolved in three different orders. There is
   * no env rung -- `SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE` was removed 2026-07-29
   * because one value per deployment cannot express a per-player choice.
   *
   * NULL IS A REAL ANSWER HERE, and it does NOT mean "carry on without one".
   * The resolver is total because Studio legitimately has no language yet; the
   * RUNTIME does not get to be relaxed about it. The conversation context
   * middleware turns a null into a thrown
   * `SugarlangMissingTargetLanguageError`, because a shipped game with sugarlang
   * enabled and no language is misconfigured, not degraded.
   *
   * `player` is threaded from the learner profile once a Settings-menu picker
   * exists; until then it is simply absent and config wins.
   */
  getTargetLanguage(player?: string | null): string | null {
    return resolveSugarLangTargetLanguage({
      // The player rung is this game's settled language, which this plugin's
      // own save slice carries for the life of the game. An explicit argument
      // still wins, for callers that already have a learner's language.
      player: player ?? getSugarlangTargetLanguage(),
      config: this.config.targetLanguage
    });
  }

  private getFirstExecutionServices(): SugarlangExecutionServices | null {
    return this.executionServices.values().next().value ?? null;
  }

  /**
   * Variant cache for graded-text lookups outside a conversation.
   *
   * Built from `studioWorkspaceId` ALONE and memoized. It must NOT hang off
   * execution services: those are created per CONVERSATION, so reading the
   * cache through them meant an item view could only show graded text after
   * the player had already talked to somebody -- open the book first and you
   * got English with no indication why.
   *
   * Undefined only when a project has nothing graded at all. It used to be
   * undefined in every published game -- the comment here said "nothing has
   * been graded anyway", which was false: plenty was graded, it just never
   * left the machine that graded it, so every item description rendered
   * authored English in production (Plan 092.4).
   */
  getVariantCache(): SugarlangVariantCache | undefined {
    if (!this.studioWorkspaceId) return getShippedVariantCache();
    this._standaloneVariantCache ??= new IndexedDBVariantCache({
      workspaceId: this.studioWorkspaceId
    });
    return this._standaloneVariantCache;
  }

  /**
   * The learner's current band, or null when there is no learner yet.
   *
   * A PINNED debug band wins and is answered without execution services --
   * pinning a band then opening an item before any conversation used to return
   * null here, so the override silently did not apply outside dialogue.
   */
  /**
   * What a scene's authored content is ABOUT, if it was built and seeded.
   *
   * NOT the situation. This is the cached, scene-scoped half; 090.3 overlays the
   * live half -- who is ACTUALLY present, met/unmet, quest stage, time of day --
   * to produce what the Teacher reads. Treating this as the situation will
   * describe NPCs who are not standing there, because presence conditions are
   * runtime facts this cannot know.
   *
   * Undefined is a legal, quiet state: the scene was never built, or the author
   * edited it since the last Rebuild so its content hash no longer matches.
   */
  getSceneContext(sceneId: string): SceneContextModel | undefined {
    return getSugarlangRuntimeSceneContext(sceneId);
  }

  /**
   * The slate store, keyed on the situation rather than a conversation.
   *
   * Deliberately reachable from here rather than from execution services: the
   * item path renders with no conversation in scope, and a conversation-keyed
   * lookup cannot serve it. Same reason `getLearnerBand` reads ambient services.
   *
   * Implements: Plan 090 story 090.3
   */

  async getLearnerBand(): Promise<CEFRBand | null> {
    // The pin is the single source of truth for a debug band override. It is
    // seeded from `config.debugBandOverride` at bind and by the Learner
    // Override panel at runtime -- this method deliberately does NOT read the
    // config itself, or the same setting would be consulted in two places and
    // could disagree with itself.
    if (this._debugPinnedBand) return this._debugPinnedBand;

    // Otherwise the real profile -- via AMBIENT services, not execution
    // services, so this answers outside a conversation. Reading it from
    // execution services meant the band was null until the player had talked to
    // somebody, which is exactly the item-view case.
    const services =
      this.getFirstExecutionServices() ?? (await this.getAmbientServices());
    if (!services) return null;
    try {
      return (await services.learnerStore.getCurrentProfile()).estimatedCefrBand;
    } catch {
      return null;
    }
  }

  /**
   * 2026-08-02 DELETED `getMarkerInputs`.
   *
   * It resolved the atlas + band that the A1/A2 item-text SUBSTITUTION drew its
   * pool from. Substitution is gone -- item text reads a baked variant and falls
   * back to authored English, like dialogue -- so the resolver needs nothing
   * beyond the variant cache, the target language and the band.
   *
   * The one thing worth keeping from it: it deliberately used AMBIENT services
   * rather than execution services, because resolving through execution
   * services made item views render English until the player had talked to
   * somebody. Any future item-side lookup has the same constraint.
   */

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
    const [profile, allCards, teachRecords] = await Promise.all([
      services.learnerStore.getCurrentProfile(),
      services.cardStore.list(),
      services.teachRecordStore.list()
    ]);
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
      pinnedBand: this._debugPinnedBand,
      lemmaCards: allCards.filter((c) => !isExponentCardKey(c.lemmaId)),
      exponentCards: allCards.filter((c) => isExponentCardKey(c.lemmaId)),
      teachRecords
    };
  }

  async resetDebugState(): Promise<SugarlangLearnerDataResetResult> {
    // Clear the pin, then RE-SEED it from config below. A reset wipes learner
    // data; it is not a request to abandon an authored band override. Before
    // the pin moved to bindRuntime this happened for free, because the next
    // resolveForLanguages re-applied it -- bind runs once per plugin init and
    // never again, so without this a reset silently unpinned the band and the
    // learner drifted during observation.
    this._debugPinnedBand = null;
    // The debug HUD reads module-level state recorded per turn. Without this
    // it keeps showing the last observation and curriculum facts of the
    // learner that was just deleted, which reads as "the reset did nothing".
    clearTurnDebugState();
    // Close the live card-store connections and delete the sugarlang
    // databases through the single shared enforcer (also used by the Studio
    // shell reset button). A blocked delete is reported, not swallowed.
    const resetResult = await resetSugarlangLearnerDatabases({
      closeables: Array.from(this.executionServices.values()).flatMap((entry) => [
        entry.cardStore,
        entry.teachRecordStore,
        entry.ledgerStore
      ])
    });
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
    // Middlewares may still hold references to the old services, so clear
    // their session accumulators before dropping the cache; the next resolve
    // then builds fresh stores and reducers instead of rehydrating pre-reset
    // state.
    for (const entry of this.executionServices.values()) {
      entry.learnerStateReducer.resetSessionAccumulators();
    }
    this.executionServices.clear();
    // The stores go too: the reset above closed their databases and took them
    // out of the wipe registry, so a cached one would come back as a handle to
    // storage nothing can clear again.
    this.learnerStores.clear();

    // Re-seed the authored band override (same DEV guard as bindRuntime), so a
    // reset returns to the configured band rather than to no band at all.
    if (
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV &&
      this.config.debugBandOverride
    ) {
      this._debugPinnedBand = this.config.debugBandOverride as CEFRBand;
    }
    return resetResult;
  }

  /**
   * Drops every cached teaching directive and refuses later writes, for a
   * plugin tearing down. A Teacher call in flight can land ~10s after the
   * region unloaded, and its result must not survive into whatever loads next.
   */
  disposeTeachers(): void {
    for (const entry of this.executionServices.values()) {
      entry.teacher.dispose();
    }
  }

  getDialogueDefinitions(): import("@sugarmagic/domain").DialogueDefinition[] {
    return this.boundContext?.dialogueDefinitions ?? [];
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

  async resolveForExecution(
    execution: ConversationExecutionContext
  ): Promise<SugarlangExecutionServices | null> {
    const languages = getSelectionLanguages(execution, () =>
      this.getTargetLanguage()
    );
    if (!languages) {
      return null;
    }
    return this.resolveForLanguages(
      languages.targetLanguage,
      languages.supportLanguage
    );
  }

  /**
   * Services for the configured language pair, with NO conversation.
   *
   * Everything below is built from `boundContext` (blackboard, player, content)
   * plus a language pair -- the conversation only ever supplied the languages,
   * and even that fell back to plugin config. So surfaces outside dialogue --
   * item views today, spells and interactables later -- can teach with the same
   * learner, the same cards and the same budgeter, instead of being second-class
   * because they are not a turn.
   *
   * Returns null before `bindRuntime`, or with no target language configured.
   */
  /**
   * The placement questionnaire, as a quest form.
   *
   * SELF-SUFFICIENT ON PURPOSE. This answers a keypress on a COLD game, before
   * any conversation has happened -- so it must not depend on execution
   * services, which only exist once a conversation has resolved. That is
   * exactly the bug this replaced: on a fresh game the form came back null,
   * the quest layer fell through to a conversation, and placement limped back
   * onto the old dialogue path.
   *
   * The questionnaire loader has no dependencies, and the learner id is
   * derivable from the bound player definition plus the configured languages.
   *
   * Returns null for "not mine" -- placement disabled, already completed, or
   * no questionnaire for this language. Null is a fall-through, not an error.
   */
  getPlacementQuestForm(): QuestFormDefinition | null {
    if (!this.config.placement.enabled) return null;
    // The language being PLAYED, not the one the project was authored for.
    // Reading config here offered a player who picked Italian the Spanish
    // questionnaire, keyed to the Spanish learner.
    const targetLanguage = this.getTargetLanguage();
    if (!targetLanguage || !this.boundContext) return null;

    // No account yet means no learner to ask about, so no placement form. A
    // form offered under a null account would record its result against a
    // learner that the next read cannot find.
    const userId = resolveLearnerScope();
    if (!userId) return null;

    const learnerId = buildLearnerId(
      userId,
      this.boundContext.playerDefinition.definitionId,
      targetLanguage,
      this.config.supportLanguage?.trim().toLowerCase() || "en"
    );
    if (
      getSugarlangPlacementStatus(this.boundContext.blackboard, learnerId)
        .status === "completed"
    ) {
      return null;
    }

    const questionnaire = this.placementFormLoader.getQuestionnaire(targetLanguage);
    if (!questionnaire) return null;
    const minAnswersForValid =
      typeof this.config.placement.minAnswersForValid === "number"
        ? this.config.placement.minAnswersForValid
        : questionnaire.minAnswersForValid;
    return {
      ...questionnaire,
      minAnswersForValid,
      formId: `${questionnaire.lang}-placement-v${questionnaire.schemaVersion}`
    } as unknown as QuestFormDefinition;
  }

  /**
   * Scores a submitted placement form and records the result.
   *
   * This is the work the observe middleware used to do off a conversation
   * turn. With placement no longer a conversation there is no turn to hang it
   * on, so it lives here -- one place, whoever opened the form.
   */
  async submitPlacementQuestForm(
    response: ConversationQuestFormResponse
  ): Promise<ConversationActionProposal[]> {
    const services =
      this.getFirstExecutionServices() ?? (await this.getAmbientServices());
    if (!services) {
      this.logger.warn("Placement submitted with no services available.");
      return [];
    }
    // Scored against the questionnaire the player was actually shown. Reading
    // config here scored Italian answers against the Spanish questionnaire.
    const questionnaire = services.placementQuestionnaireLoader.getQuestionnaire(
      this.getTargetLanguage() ?? ""
    );
    const scoreResult = services.placementScoreEngine.scoreResponses(
      response,
      questionnaire
    );
    const learner = await services.learnerStore.getCurrentProfile();
    await services.learnerStateReducer.apply(
      buildPlacementCompletionEvent(scoreResult, learner)
    );

    // Telemetry and the confidence-floor warning came with the scoring when it
    // left the observe middleware -- they describe the PLACEMENT, not the turn
    // it used to arrive on.
    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("placement.completed", {
        timestamp: Date.now(),
        finalBand: scoreResult.cefrBand,
        confidence: scoreResult.confidence,
        questionnaireVersion: scoreResult.questionnaireVersion,
        result: scoreResult
      }),
      this.logger
    );
    const confidenceFloor = this.config.placement.confidenceFloor;
    if (scoreResult.confidence < confidenceFloor) {
      this.logger.warn("Placement completed below configured confidence floor.", {
        confidence: scoreResult.confidence,
        confidenceFloor
      });
    }

    // The quest flags and the completion event, for the host to apply. These
    // used to ride on the conversation turn's proposedActions.
    return emitPlacementCompleted(scoreResult);
  }

  /**
   * The NPCs in the loaded region whose directive slot a conversation would
   * actually read.
   *
   * SCRIPTED-MODE NPCS ARE EXCLUDED. The teacher middleware returns before
   * `teacher.invoke` for scripted dialogue, so their slot is never read and
   * warming one is a call spent on nothing.
   */
  listWarmableNpcIds(): string[] {
    const bound = this.boundContext;
    if (!bound) return [];
    // COMPOSED, not base and not overlay. `composeRegionContents` is the same
    // call the host makes; reading `activeRegion.npcPresences` alone silently
    // drops every Scene-scoped NPC, and reading the overlay alone drops the
    // base ones.
    if (!bound.activeRegion) return [];
    const presences =
      composeRegionContents(bound.activeRegion, bound.activeScene).npcPresences ?? [];
    // EFFECTIVE mode, not the authored one. A quest can flip an NPC
    // to agent mid-session, and warming is exactly what that NPC then
    // needs; reading `npc.interactionMode` here would keep warming the
    // set the project shipped with.
    const agentIds = new Set(
      bound.npcDefinitions
        .filter(
          (npc) =>
            (bound.getEffectiveNpcInteractionMode?.(npc.definitionId) ??
              npc.interactionMode) === "agent"
        )
        .map((npc) => npc.definitionId)
    );
    const present = presences
      .map((presence: { npcDefinitionId: string }) => presence.npcDefinitionId)
      .filter((id: string) => agentIds.has(id));
    return [...new Set(present)];
  }

  /**
   * Warms the Teacher's directive slot for every agent-mode NPC in the loaded
   * region, so the first conversation with any of them starts fast
   * (sugarmagic-latency-00m).
   *
   * Returns null when the world cannot be asked yet -- no bound runtime, no
   * services, no region, or no builder from the host. The caller treats null
   * as "try again next tick" rather than an error, because at boot several of
   * these are legitimately absent for a while.
   */
  async buildRegionWarmContext(): Promise<{
    situationKey: string;
    /** Returns the warm outcome so the caller can retry a failure. */
    warmAll: (npcDefinitionIds: readonly string[]) => Promise<string>;
  } | null> {
    const bound = this.boundContext;
    if (!bound) return null;
    const buildRuntimeContext = bound.buildConversationRuntimeContext;
    if (!buildRuntimeContext) return null;

    const services = await this.getAmbientServices();
    if (!services) return null;

    // NPC-LESS ON PURPOSE. `situation.npc` is not in the situation key, and the
    // Teacher receives only ids and a display name from it today -- so one
    // region-level directive is faithful to what it actually does. Borrowing
    // one NPC's identity for all of them would be a fiction with no upside.
    const runtimeContext = buildRuntimeContext(null);
    const sceneId = runtimeContext.here?.sceneId ?? null;
    if (!sceneId) return null;

    const sceneContext = getSugarlangRuntimeSceneContext(sceneId);
    const situation = composeSituation({
      sceneId,
      sceneContext: sceneContext ?? null,
      runtimeContext
    });

    return {
      // THE KEY IS COMPUTED WITHOUT THE LEARNER, deliberately. The situation
      // key is scene + hash + quest + objectives + time -- no learner axis. The
      // learner profile is loaded only inside warmAll, i.e. only when the key
      // actually moved and a call is really going to happen. Loading it up here
      // paged the whole IndexedDB card store on every 2s tick, forever, for a
      // check that almost always decides to do nothing.
      situationKey: situationKey(situation),
      // ONE call for however many NPCs need it -- the directive does not depend
      // on which NPC it is served through, and the per-conversation cache scope
      // means a per-NPC loop would bill a full Teacher call each time.
      warmAll: async (npcDefinitionIds: readonly string[]) => {
        const learner = await services.learnerStore.getCurrentProfile();
        if (!learner) return "failed" as const;
        return services.teacher.warmRegion({
          // One directive serves every NPC in the region, so there is nothing
          // to address per NPC. This names the call for telemetry only.
          conversationId: npcDefinitionIds[0] ?? "warm",
          learner,
          atlas: services.atlas,
          situation,
          situationKey: situationKey(situation),
          lang: {
            // THE GAME'S LANGUAGE, NOT THE PROFILE'S FIELD. A learner profile
            // already lives under a language-keyed id, so its own
            // `targetLanguage` is a copy of its key -- and a stale copy sends
            // the Teacher to the wrong half of the atlas, which is how an
            // Italian game got slated `estación` and `maleta`.
            targetLanguage: requireSugarlangTargetLanguage(),
            supportLanguage: learner.supportLanguage
          },
          calibrationActive: false
        });
      }
    };
  }

  async getAmbientServices(): Promise<SugarlangExecutionServices | null> {
    // The language being PLAYED. Reading config here warmed teaching
    // directives for a learner the player is not.
    const targetLanguage = this.getTargetLanguage();
    if (!targetLanguage) return null;
    // "en" HERE IS DELIBERATE, AND IT IS NOT THE SAME CHOICE getPlacementQuestForm
    // MAKES. This must match what a TURN resolves, because a turn is who reads
    // anything computed here: getSelectionLanguages (:205) is
    // `selection.supportLanguage || "en"` and never consults config. The pair is
    // part of buildLearnerId, so diverging resolves a different learner profile
    // and card store -- a warmed directive would be planned for one learner and
    // read by another.
    //
    // I changed this to config.supportLanguage earlier in this branch believing
    // the hardcode was a bug. It was not: it is the turn path's fallback, and
    // config was the divergence. Reverted after review.
    //
    // THE REAL GAP, unaddressed here: if a selection DOES carry a support
    // language, a turn gets it and this still says "en". Fixing that needs the
    // ambient path to know the selection, which it structurally does not.
    return this.resolveForLanguages(targetLanguage, "en");
  }

  /**
   * Open the learner's storage for the configured language pair.
   *
   * Called at boot, before the sync loop's first pass, so that pass has
   * something to reconcile and the boot screen's wait covers it. Deliberately
   * needs no world: there is not one yet.
   *
   * Silent when there is no account or no configured language -- neither is a
   * failure, and neither leaves anything to open.
   */
  async openAccountStorage(
    context: PluginAccountStorageContext
  ): Promise<void> {
    // WHICH LANGUAGE'S STORES TO OPEN, WHEN THE LANGUAGE IS NOT SETTLED YET.
    //
    // This runs before the save has even been requested, so the slice holding
    // the language has not been read. Two cases:
    //
    //   - the player just picked one. It is right here in the step answers,
    //     so the right stores open and the boot's first sync covers them.
    //   - any other boot. The best guess available is the project's language.
    //
    // ACCEPTED, AND IT IS A REAL COST: a player who picked a language other
    // than the project's and then quits and continues opens the project
    // language's stores at boot, and their own language's stores open at the
    // first conversation instead -- after the boot sync pass has gone. On a
    // second device that reads empty, which is the "returning player is asked
    // to place again" case.
    //
    // REVISIT IF THAT IS SEEN: open the stores for every language the game
    // could be in (the teachable list) rather than guessing one. It costs an
    // extra store pair in the boot wait per language, which is why it is not
    // the default with two languages and one of them usually right.
    //
    // Not fixed by reordering boot: the save load is triggered by provider
    // resolution, so waiting for it here would put a network round trip in
    // front of the sync loop that is meant to overlap asset preloading.
    const picked =
      context.preNewGameStepAnswers[SUGARLANG_TARGET_LANGUAGE_STEP_ID];
    const targetLanguage = (picked ?? this.config.targetLanguage)
      ?.trim()
      .toLowerCase();
    if (!targetLanguage) return;
    const userId = resolveLearnerScope();
    if (!userId) return;
    // "en" matches the ambient path's support language; a conversation that
    // carries its own pair opens that one on demand instead.
    const supportLanguage = "en";
    const stores = this.getLearnerStores(userId, targetLanguage, supportLanguage);
    const openedAtMs = Date.now();
    const languages = { targetLanguage, supportLanguage };
    const syncLoopRunning = isSyncLoopRunning();

    void emitTelemetry(
      this.telemetry,
      createTelemetryEvent("learner-storage.opened", {
        timestamp: openedAtMs,
        ...languages,
        syncLoopRunning,
        storeIds: [
          ...(stores.cardStore ? ["cards"] : []),
          ...(stores.profileCoreStore ? ["profile"] : [])
        ]
      })
    );

    // NOT AWAITED, and it must not be. The host awaits this method BEFORE it
    // starts the sync loop, so the first pass cannot finish until after we
    // return -- awaiting it here would wait for something this call is
    // blocking. Reported when it lands instead.
    void stores.whenFirstSynced.then(async () => {
      let wordCount = 0;
      let levelPresent = false;
      try {
        wordCount = await stores.cardStore.count();
        levelPresent = Boolean(
          await stores.profileCoreStore?.get(LEARNER_PROFILE_CORE_KEY)
        );
      } catch {
        // Reporting must not be the thing that breaks a boot.
      }
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("learner-storage.first-sync", {
          timestamp: Date.now(),
          ...languages,
          syncLoopRunning,
          waitedMs: Date.now() - openedAtMs,
          wordCount,
          levelPresent
        })
      );
    });
  }

  /**
   * The learner's stores for one account and language pair, opened once.
   *
   * Opening a second set for the same pair would register a second sync handle
   * under the same key and a second connection to the same database -- two
   * caches of the same rows, and a pending flag cleared in one invisible to
   * the other.
   */
  private getLearnerStores(
    userId: string,
    targetLanguage: string,
    supportLanguage: string
  ): LearnerStores {
    const key = `${userId}:${targetLanguage}:${supportLanguage}`;
    const existing = this.learnerStores.get(key);
    if (existing) return existing;
    const created = initLearnerStores(userId, targetLanguage, supportLanguage);
    this.learnerStores.set(key, created);
    return created;
  }

  private async resolveForLanguages(
    targetLanguage: string,
    supportLanguage: string
  ): Promise<SugarlangExecutionServices | null> {
    if (!this.boundContext) {
      this.logger.warn("Sugarlang runtime services requested before binding.");
      return null;
    }

    // DEFER RATHER THAN GUESS. Identity settles during boot, and this can be
    // asked before it has. Returning null degrades the turn -- the caller
    // already handles it -- where inventing a learner would open a word store
    // under no account and quietly strand everything written into it. Nothing
    // is cached before this point, so the next call after sign-in resolves for
    // real.
    //
    // RESOLVED BEFORE THE CACHE IS CONSULTED, because the account is part of
    // the cache key below.
    const userId = resolveLearnerScope();
    if (!userId) {
      this.logger.warn(
        "Sugarlang learner requested before an account resolved; deferring. " +
          "This is expected during boot and should not repeat once signed in."
      );
      return null;
    }

    const languages = { targetLanguage, supportLanguage };
    // KEYED ON THE ACCOUNT TOO. The learner id leads with it, so without it
    // here a second account signing in on the same tab was handed the previous
    // player's stores, reducer and learner -- everything they did would land in
    // someone else's history.
    const key = `${userId}:${languages.targetLanguage}:${languages.supportLanguage}`;
    const existing = this.executionServices.get(key);
    if (existing) {
      return existing;
    }

    const languageBundle = this.getLanguageBundle(languages.targetLanguage);
    const learnerId = buildLearnerId(
      userId,
      this.boundContext.playerDefinition.definitionId,
      languages.targetLanguage,
      languages.supportLanguage
    );
    // Plan 092.6.4 — a learner's words and their level both live in
    // per-account storage now, so they follow the player to another machine
    // instead of ending with the browser they were learned in. Both fall back
    // to a local-only store when nothing can reach an account, which is what
    // a project with no accounts gets.
    const { cardStore, profileCoreStore, whenFirstSynced } = this.getLearnerStores(
      userId,
      languages.targetLanguage,
      languages.supportLanguage
    );
    // ALREADY RECONCILED for the configured pair -- `openAccountStorage` opened
    // it at boot and the boot screen waited for the pass. This await is for the
    // other case: a conversation carrying a language pair that is not the
    // configured one opens its stores here, on the turn, and must not be read
    // before they have been reconciled once.
    //
    // Ends on failure, and immediately when nothing will ever sync these
    // stores, so an offline player or a project with no account plugin waits
    // on nothing.
    await whenFirstSynced;
    const learnerPriorProvider = new FsrsLearnerPriorProvider(languageBundle.atlas);
    const learnerStore = new BlackboardLearnerStore({
      blackboard: this.boundContext.blackboard,
      playerEntityId: this.boundContext.playerDefinition.definitionId,
      learnerId: learnerId as never,
      targetLanguage: languages.targetLanguage,
      supportLanguage: languages.supportLanguage,
      cardStore,
      profileStore: profileCoreStore,
      learnerPriorProvider
    });
    const learnerStateReducer = new LearnerStateReducer({
      profileId: learnerId as never,
      playerEntityId: this.boundContext.playerDefinition.definitionId,
      targetLanguage: languages.targetLanguage,
      supportLanguage: languages.supportLanguage,
      blackboard: this.boundContext.blackboard,
      cardStore,
      profileStore: profileCoreStore,
      atlas: languageBundle.atlas,
      learnerPriorProvider,
      telemetry: this.telemetry,
      debugPinnedBand: () => this._debugPinnedBand
    });
    const directiveCache = new DirectiveCache();
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

    const teachRecordStore = createTeachRecordStore(learnerId);
    const ledgerStore = createEncounterDebtLedger(learnerId);
    // ONE SOURCE PER HOST, never a fallback chain. In Studio the live
    // workspace database wins, so a variant hand-edited in the popover shows
    // in Preview without saving first. Anywhere else it is the shipped file.
    //
    // A chain -- try the database, fall back to the file -- is how "the
    // deployed game has no variants" stayed invisible: the working source
    // covers for the broken one and nothing reports the difference.
    const variantCache: SugarlangVariantCache | undefined = this.studioWorkspaceId
      ? new IndexedDBVariantCache({ workspaceId: this.studioWorkspaceId })
      : getShippedVariantCache();
    const liveRenderCache = new LiveRenderCache();

    const services: SugarlangExecutionServices = {
      ...languageBundle,
      profileId: learnerId,
      playerEntityId: this.boundContext.playerDefinition.definitionId,
      dialogueDefinitions: this.boundContext.dialogueDefinitions,
      learnerStore,
      learnerStateReducer,
      cardStore,
      teachRecordStore,
      ledgerStore,
      teacher,
      llmClient: this.gatewayClient,
      variantCache,
      liveRenderCache
    };
    this.executionServices.set(key, services);

    // Config-driven band override: skip placement and pin the learner at the
    // configured band. Applied once per language pair per session. DEV-gated
    // (same guard as __sugarlangDebug in manifest.ts): a published build
    // ignores a debugBandOverride left set in the plugin config.
    if (
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV &&
      this.config.debugBandOverride
    ) {
      const overrideEvent: PlacementCompletionEvent = {
        type: "placement-completion",
        cefrBand: this.config.debugBandOverride as CEFRBand,
        confidence: 1.0,
        completedAtMs: Date.now(),
        lemmasSeededFromFreeText: []
      };
      await learnerStateReducer.apply(overrideEvent);
      // The pin itself is already set at bind (see bindRuntime) -- only the
      // placement event needs the reducer, which is why it stays here.
    }

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

    const bundle: LanguageBundle = {
      atlas,
      morphology,
      classifier,
      placementQuestionnaireLoader,
      placementScoreEngine,
      sceneLexiconStore
    };
    this.languageBundles.set(targetLanguage, bundle);
    return bundle;
  }
}
