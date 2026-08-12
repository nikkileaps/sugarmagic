/**
 * packages/runtime-core/src/plugins/index.ts
 *
 * Purpose: Defines the runtime plugin contribution surface and plugin manager contract.
 *
 * Exports:
 *   - Runtime plugin contribution kinds and payload types
 *   - Runtime plugin manager and instance contracts
 *   - createRuntimePluginManager
 *   - RuntimePluginSystem
 *
 * Relationships:
 *   - Depends on shared runtime domain contracts only.
 *   - Is the single contribution type source of truth for runtime plugin integration.
 *
 * Status: active
 */

export * from "./pre-new-game-steps";

import type { RuntimeBootModel, RuntimeHostKind } from "../index";
import type { ConversationRuntimeContext } from "../conversation";
import type {
  ConversationMiddleware,
  ConversationProvider,
  ConversationTurnEnvelope,
  QuestFormDefinition,
  ConversationQuestFormResponse,
  ConversationActionProposal
} from "../conversation";
import type { PreNewGameStepPayload } from "./pre-new-game-steps";
import type { RemoteRecordStorageAdapter } from "../sync-engine";
import type { UserIdentityProvider } from "../identity";
import type { UserProfileStore } from "../profile";
import {
  createSerializedSaveStore,
  type GameSaveStore,
  type SerializedSaveStore
} from "../save";
import type { BlackboardFactDefinition, RuntimeBlackboard } from "../state";
import type {
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  CastableInvocation,
  NPCDefinition,
  PlayerDefinition,
  QuestDefinition,
  RegionDocument,
  Scene,
  SpellDefinition
} from "@sugarmagic/domain";
import { System, type Entity, type World } from "../ecs";
import type { CastableExecutionResult, StatCarrier } from "../mechanics";

export type RuntimePluginContributionKind =
  | "conversation.provider"
  | "conversation.middleware"
  | "dialogue.entryDecorator"
  | "quest.assessment"
  | "newGame.preStep"
  | "displayText.resolver"
  | "debug.hudCard"
  | "debug.entityBillboard"
  | "runtime.banner"
  | "design.workspace"
  | "design.section"
  | "project.settings"
  | "mechanics.emitHandler"
  | "identity.provider"
  | "save.store"
  | "profile.store"
  | "accountData.remote";

interface RuntimePluginContributionBase<TKind extends RuntimePluginContributionKind, TPayload> {
  pluginId: string;
  contributionId: string;
  kind: TKind;
  displayName: string;
  priority: number;
  hostKinds?: RuntimeHostKind[];
  payload: TPayload;
}

export type ConversationProviderContribution = RuntimePluginContributionBase<
  "conversation.provider",
  {
    providerId: string;
    summary: string;
    status: "placeholder" | "ready";
    provider: ConversationProvider;
  }
>;

export type ConversationMiddlewareContribution = RuntimePluginContributionBase<
  "conversation.middleware",
  {
    middlewareId: string;
    summary: string;
    stage: "context" | "policy" | "analysis" | "generic";
    status: "placeholder" | "ready";
    middleware: ConversationMiddleware;
  }
>;

export type DesignWorkspaceContribution = RuntimePluginContributionBase<
  "design.workspace",
  {
    workspaceKind: string;
    icon: string;
    summary: string;
  }
>;

export type RuntimeBannerContribution = RuntimePluginContributionBase<
  "runtime.banner",
  {
    message: string;
    placement: "top-center";
    tone: "info" | "success" | "warning";
  }
>;

export type DesignSectionContribution = RuntimePluginContributionBase<
  "design.section",
  {
    workspaceKind: string;
    sectionId: string;
    summary: string;
  }
>;

export type ProjectSettingsContribution = RuntimePluginContributionBase<
  "project.settings",
  {
    settingsId: string;
    summary: string;
  }
>;

export interface MechanicsEmitDispatch {
  emitKind: string;
  payload: Record<string, unknown> | undefined;
  caster: StatCarrier;
  target: StatCarrier | null;
}

export interface MechanicsEmitHandlerContext {
  mountRoot: HTMLElement;
  config: Record<string, unknown>;
  dispatchCastable: (
    invocation: CastableInvocation
  ) => CastableExecutionResult;
  claimInput: (lockId: string) => void;
  releaseInput: (lockId: string) => void;
}

export type MechanicsEmitHandlerContribution = RuntimePluginContributionBase<
  "mechanics.emitHandler",
  {
    emitKinds: string[];
    setup: (context: MechanicsEmitHandlerContext) => {
      handle: (dispatch: MechanicsEmitDispatch) => void;
      dispose?: () => void;
    };
  }
>;

export interface TermHoverEvent {
  term: string;
  /** Target language code. May be empty if the panel doesn't know the language;
   *  the plugin handler is responsible for filling it in. */
  lang: string;
  dwellMs: number;
}

/**
 * A request to swap authored display text for something better suited to the
 * player -- today, language-graded prose from sugarlang.
 *
 * Deliberately content-AGNOSTIC: `subjectKind` / `subjectId` / `field` describe
 * any authored string the runtime is about to show, so item views, spell
 * descriptions and future interactables all use one seam. runtime-core does not
 * know what a resolver will do with them.
 */
export interface DisplayTextRequest {
  /** Content family, e.g. "item-view", "spell-view". */
  subjectKind: string;
  /** Definition id of the thing that owns the text. */
  subjectId: string;
  /** Which field of that thing, e.g. "title", "body", "description". */
  field: string;
  /** The AUTHORED text. Always valid to render as-is. */
  text: string;
}

/**
 * Optional hook for replacing authored display text at render time.
 *
 * WHY THIS SHAPE. The request carries the authored text and resolvers return a
 * string, so the worst case is the text going in comes back out. With no plugin
 * registered there is no resolver, nothing is called, and every surface renders
 * exactly the authored English it already had. "Works with the plugin
 * uninstalled" is therefore structural, not a fallback branch someone has to
 * remember to write and test.
 *
 * Resolvers MUST be total: resolve to the authored text rather than throwing or
 * returning empty when they have nothing. A missing translation is not an error.
 */
export type DisplayTextResolverContribution = RuntimePluginContributionBase<
  "displayText.resolver",
  {
    summary: string;
    resolve: (request: DisplayTextRequest) => Promise<string>;
  }
>;

export type DialogueEntryDecoratorContribution = RuntimePluginContributionBase<
  "dialogue.entryDecorator",
  {
    summary: string;
    decorate: (turn: ConversationTurnEnvelope) => ConversationTurnEnvelope;
    onTermHover?: (event: TermHoverEvent) => void;
    /**
     * 090.12: resolve a span the player SELECTED to something worth showing.
     * Returning null means "nothing to say" and the panel shows no card --
     * most misses are expected (support-language words, names, punctuation),
     * so silence is the honest answer rather than an error.
     */
    lookupSelection?: (
      selection: string
    ) => { surface: string; gloss: string } | null;
  }
>;

export interface DebugHudRendererStats {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

export interface DebugHudGameplaySessionSnapshot {
  activeEntityCount: number;
  activeSystemCount: number;
  activeNpcCount: number;
  activeQuestCount: number;
  /** The active region's id. Pre-058 this field was (confusingly)
   *  named `currentSceneId` — it always held the region id. */
  currentRegionId: string | null;
  /** Plan 058 — the active narrative Scene's display name. */
  currentSceneName: string | null;
  currentAreaDisplayName: string | null;
  playerPosition: { x: number; y: number; z: number } | null;
  dialogueActive: boolean;
}

export interface DebugHudCardContext {
  readonly world: World;
  readonly boot: RuntimeBootModel;
  readonly blackboard: RuntimeBlackboard;
  readonly rendererStats: DebugHudRendererStats;
  readonly gameplaySession: DebugHudGameplaySessionSnapshot;
}

export type DebugHudCardContribution = RuntimePluginContributionBase<
  "debug.hudCard",
  {
    cardId: string;
    renderCard: (container: HTMLElement, context: DebugHudCardContext) => void;
    updateCard?: (context: DebugHudCardContext) => void;
    disposeCard?: () => void;
  }
>;

export type DebugEntityBillboardKind = "player" | "npc" | "item";

export interface EntityBillboardContext {
  readonly entityId: Entity;
  readonly entityKind: DebugEntityBillboardKind;
  readonly definitionId: string | null;
  readonly displayName: string;
  readonly sceneId: string | null;
  readonly blackboard: RuntimeBlackboard;
}

export type DebugEntityBillboardContribution = RuntimePluginContributionBase<
  "debug.entityBillboard",
  {
    getLines: (context: EntityBillboardContext) => string[];
  }
>;

// Story 47.2 — plugins that own user-account behaviour contribute a
// UserIdentityProvider here. At most one provider is consumed per
// boot (resolveActiveIdentityProvider picks the highest priority
// when multiple plugins contribute, logging a warn). When no plugin
// contributes, the boot path falls through to the runtime-core
// AnonymousLocalIdentityProvider default.
export type IdentityProviderContribution = RuntimePluginContributionBase<
  "identity.provider",
  {
    providerId: string;
    summary: string;
    status: "placeholder" | "ready";
    provider: UserIdentityProvider;
  }
>;

// Story 47.2 — plugins that own cross-plugin player state persistence
// contribute a GameSaveStore here. Same single-active-implementation
// model as identity.provider; resolveActiveGameSaveStore picks the
// highest-priority contribution and falls through to the runtime-core
// IndexedDBGameSaveStore default when no plugin contributes.
export type GameSaveStoreContribution = RuntimePluginContributionBase<
  "save.store",
  {
    storeId: string;
    summary: string;
    status: "placeholder" | "ready";
    store: GameSaveStore;
  }
>;

// Plan 092.6.3 — plugins that can reach a backend contribute the server
// side of per-account record storage here. Same single-active model as
// profile.store, and the same null-when-absent outcome: with nothing
// contributed, account stores still work, they just never leave the
// device. runtime-core defines the interface and never learns which
// backend a project uses.
export type RemoteRecordStorageAdapterContribution = RuntimePluginContributionBase<
  "accountData.remote",
  {
    remoteId: string;
    summary: string;
    remote: RemoteRecordStorageAdapter;
  }
>;

// Story 47.8 — plugins that own per-user profile data (display
// name, locale, preferences) contribute a UserProfileStore here.
// Unlike identity.provider + save.store, there's no runtime-core
// default — anonymous-local play has no profile concept, so the
// resolver returns null when no plugin contributes and consumers
// fall through to their own defaults (e.g. Sugarlang uses its
// configured supportLanguage when there's no profile-store
// contribution).
export type ProfileStoreContribution = RuntimePluginContributionBase<
  "profile.store",
  {
    storeId: string;
    summary: string;
    status: "placeholder" | "ready";
    store: UserProfileStore;
  }
>;

/**
 * Supplies the form behind an ASSESSMENT quest objective, and takes its answers
 * back.
 *
 * The quest layer knows an objective is an assessment and which NPC it targets.
 * It does not know what a placement questionnaire is, how to score one, or what
 * a CEFR band means -- and must not. It asks whoever owns assessments for a
 * form, renders it, and hands the answers back.
 *
 * This exists because placement used to be a CONVERSATION: the form was built
 * as a dialogue turn by one plugin's generate stage, which meant it could only
 * appear for free-form NPCs, needed a turn counter to decide when, and rendered
 * its intro as dialogue. An assessment is a form, not a chat.
 */
export type QuestAssessmentContribution = RuntimePluginContributionBase<
  "quest.assessment",
  {
    summary: string;
    /**
     * The form for this objective, or null if this plugin does not own it --
     * null means "not mine", not "error".
     */
    getForm: (objective: {
      objectiveNodeId: string;
      targetId: string | null;
    }) => QuestFormDefinition | null;
    /**
     * Score the answers and record whatever completing the assessment means.
     *
     * Returns quest action proposals for the host to apply -- setting flags and
     * notifying events is the QUEST layer's job, and the plugin has no handle
     * on the quest manager. These used to ride on a conversation turn's
     * proposedActions; with no turn they come back here instead.
     */
    submit: (
      response: ConversationQuestFormResponse
    ) => Promise<ConversationActionProposal[]> | ConversationActionProposal[];
  }
>;

/**
 * Asks the player one question between the New Game press and the wipe.
 *
 * The host knows there is an ordered list of questions to put on screen before
 * it destroys the save. It does not know what any of them are for. It renders
 * the definition, keeps the answer under the step's own id, and hands the
 * whole map to the next boot -- see `pre-new-game-steps.ts`.
 */
export type PreNewGameStepContribution = RuntimePluginContributionBase<
  "newGame.preStep",
  PreNewGameStepPayload
>;

export type RuntimePluginContribution =
  | ConversationProviderContribution
  | PreNewGameStepContribution
  | QuestAssessmentContribution
  | ConversationMiddlewareContribution
  | DialogueEntryDecoratorContribution
  | DisplayTextResolverContribution
  | DebugHudCardContribution
  | DebugEntityBillboardContribution
  | RuntimeBannerContribution
  | DesignWorkspaceContribution
  | DesignSectionContribution
  | ProjectSettingsContribution
  | MechanicsEmitHandlerContribution
  | IdentityProviderContribution
  | GameSaveStoreContribution
  | RemoteRecordStorageAdapterContribution
  | ProfileStoreContribution;

export interface RuntimePluginContext {
  /**
   * The runtime context a conversation with this NPC would get right now; pass
   * null when there is no NPC. Absent when the host did not supply one.
   *
   * A plugin that pre-computes anything a later turn will read must build its
   * inputs THROUGH THIS, not by reconstructing them -- two constructions drift,
   * and the drift is silent (sugarmagic-latency-00m).
   */
  buildConversationRuntimeContext?: (
    npcDefinitionId: string | null
  ) => ConversationRuntimeContext;
  boot: RuntimeBootModel;
  pluginBootPayloads?: Record<string, unknown>;
  /**
   * Every file-backed asset path mapped to the URL that serves it (Plan
   * 092.3).
   *
   * A plugin that shipped a DERIVED ARTIFACT (ADR 005 rule 3) declared its
   * path into its own configuration; this is how it turns that path back into
   * something fetchable. Resolve through this rather than hard-coding a URL:
   * the deploy stamps each value with the deployed sha, and `/assets/*` is
   * served `immutable` for a year, so a hand-built path would be cached
   * across deploys and never update.
   */
  assetSources?: Record<string, string>;
  blackboard?: RuntimeBlackboard;
  activeRegion?: RegionDocument | null;
  /** Plan 058 §058.1 — the active narrative Scene whose overlay
   *  composes onto the region base. Plugins that compile from
   *  presences (e.g. sugarlang) read the composed view. */
  activeScene?: Scene | null;
  playerDefinition?: PlayerDefinition;
  spellDefinitions?: SpellDefinition[];
  itemDefinitions?: ItemDefinition[];
  documentDefinitions?: DocumentDefinition[];
  npcDefinitions?: NPCDefinition[];
  dialogueDefinitions?: DialogueDefinition[];
  questDefinitions?: QuestDefinition[];
}

export interface RuntimePluginInstance {
  pluginId: string;
  displayName: string;
  config?: Record<string, unknown>;
  contributions: RuntimePluginContribution[];
  blackboardFactDefinitions?: readonly BlackboardFactDefinition<unknown>[];
  /**
   * Open this plugin's per-account storage. Runs at boot, once the player's
   * account is known and BEFORE the sync loop's first pass.
   *
   * SEPARATE FROM `init` BECAUSE IT HAPPENS MUCH EARLIER. `init` needs the
   * world, the region and the player definition, none of which exist until
   * after the boot screen is done -- so a store opened there has already
   * missed the first sync, and the boot wait it should have been part of.
   * That is how a returning player got put through placement again on a second
   * device: their stores were built on the first conversation turn and read
   * empty, because nothing had ever reconciled them.
   *
   * Storage is all this may do. There is no world yet.
   */
  openAccountStorage?: () => Promise<void> | void;
  init?: (context: RuntimePluginContext) => Promise<void> | void;
  update?: (delta: number) => void;
  dispose?: () => Promise<void> | void;
}

export interface RuntimePluginManagerOptions {
  boot: RuntimeBootModel;
  plugins: RuntimePluginInstance[];
  pluginBootPayloads?: Record<string, unknown>;
}

export interface RuntimePluginManager {
  readonly boot: RuntimeBootModel;
  /** See `RuntimePluginInstance.openAccountStorage`. Call once, at boot,
   *  after the account resolves and before the sync loop starts. */
  openAccountStorage: () => Promise<void>;
  init: (context?: Omit<RuntimePluginContext, "boot">) => Promise<void>;
  update: (delta: number) => void;
  dispose: () => Promise<void>;
  getPlugins: () => readonly RuntimePluginInstance[];
  getEnabledPluginIds: () => string[];
  getContributions: <TKind extends RuntimePluginContributionKind>(
    kind: TKind
  ) => Array<Extract<RuntimePluginContribution, { kind: TKind }>>;
}

function isContributionAllowedOnHost(
  contribution: RuntimePluginContribution,
  hostKind: RuntimeHostKind
): boolean {
  if (!contribution.hostKinds || contribution.hostKinds.length === 0) {
    return true;
  }
  return contribution.hostKinds.includes(hostKind);
}

export function createRuntimePluginManager(
  options: RuntimePluginManagerOptions
): RuntimePluginManager {
  const { boot, plugins, pluginBootPayloads } = options;
  let initialized = false;

  return {
    boot,
    async openAccountStorage() {
      for (const plugin of plugins) {
        // One plugin failing to open its storage must not stop the others, or
        // take the boot down with it. That plugin's data does not follow the
        // player this session; the rest of the game is unaffected.
        try {
          await plugin.openAccountStorage?.();
        } catch (error) {
          console.warn(
            `[runtime-core] ${plugin.pluginId} could not open its per-account storage; ` +
              "its data will not sync this session.",
            error
          );
        }
      }
    },
    async init(context = {}) {
      if (initialized) return;
      for (const plugin of plugins) {
        await plugin.init?.({
          boot,
          pluginBootPayloads,
          ...context
        });
      }
      initialized = true;
    },
    update(delta) {
      for (const plugin of plugins) {
        plugin.update?.(delta);
      }
    },
    async dispose() {
      for (const plugin of [...plugins].reverse()) {
        await plugin.dispose?.();
      }
      initialized = false;
    },
    getPlugins() {
      return plugins;
    },
    getEnabledPluginIds() {
      return plugins.map((plugin) => plugin.pluginId);
    },
    getContributions(kind) {
      return plugins
        .flatMap((plugin) => plugin.contributions)
        .filter(
          (contribution): contribution is Extract<RuntimePluginContribution, { kind: typeof kind }> =>
            contribution.kind === kind &&
            isContributionAllowedOnHost(contribution, boot.hostKind)
        )
        .sort((left, right) => left.priority - right.priority);
    },
  };
}

export class RuntimePluginSystem extends System {
  constructor(private readonly manager: RuntimePluginManager) {
    super();
  }

  update(_world: World, delta: number): void {
    this.manager.update(delta);
  }
}

interface ResolverLogger {
  warn(message: string, payload?: Record<string, unknown>): void;
}

const defaultResolverLogger: ResolverLogger = {
  warn(message, payload) {
    console.warn(message, payload ?? {});
  }
};

// Story 47.2 — pick the active UserIdentityProvider at boot. Walks
// every `identity.provider` contribution; picks the highest-priority
// one. Falls through to the supplied fallback (typically the
// runtime-core anonymous-local default) when no plugin contributes.
// Logs a warn (not throw) on conflicts so a misconfigured stack
// doesn't fail-fast — the boot path uses whichever provider it
// resolves and surfaces the conflict for the developer to clean up.
export function resolveActiveIdentityProvider(
  manager: RuntimePluginManager,
  fallback: UserIdentityProvider,
  logger: ResolverLogger = defaultResolverLogger
): UserIdentityProvider {
  const contributions = manager.getContributions("identity.provider");
  if (contributions.length === 0) return fallback;
  if (contributions.length > 1) {
    logger.warn(
      `[runtime-core] Multiple plugins contribute identity.provider; picking highest priority.`,
      {
        contributingPluginIds: contributions.map((c) => c.pluginId),
        priorities: contributions.map((c) => ({
          pluginId: c.pluginId,
          priority: c.priority
        }))
      }
    );
  }
  const winner = contributions
    .slice()
    .sort((a, b) => b.priority - a.priority)[0];
  return winner.payload.provider;
}

// Story 47.2 — pick the active GameSaveStore at boot. Wraps the
// result via createSerializedSaveStore so callers always get the
// resetForNewGame guarantee regardless of which plugin (or none)
// contributed the underlying store. Plugins return plain
// GameSaveStore values; wrapping is the platform's job. The wrap
// is idempotent — a contributor that pre-wraps is a no-op here.
export function resolveActiveGameSaveStore(
  manager: RuntimePluginManager,
  fallback: GameSaveStore,
  logger: ResolverLogger = defaultResolverLogger
): SerializedSaveStore {
  const contributions = manager.getContributions("save.store");
  if (contributions.length === 0) return createSerializedSaveStore(fallback);
  if (contributions.length > 1) {
    logger.warn(
      `[runtime-core] Multiple plugins contribute save.store; picking highest priority.`,
      {
        contributingPluginIds: contributions.map((c) => c.pluginId),
        priorities: contributions.map((c) => ({
          pluginId: c.pluginId,
          priority: c.priority
        }))
      }
    );
  }
  const winner = contributions
    .slice()
    .sort((a, b) => b.priority - a.priority)[0];
  return createSerializedSaveStore(winner.payload.store);
}

// Story 47.8 — pick the active UserProfileStore at boot. Returns
// `null` when no plugin contributes (no runtime-core default;
// anonymous-local play has no profile concept). Consumers handle
// the null case explicitly.
export function resolveActiveProfileStore(
  manager: RuntimePluginManager,
  logger: ResolverLogger = defaultResolverLogger
): UserProfileStore | null {
  const contributions = manager.getContributions("profile.store");
  if (contributions.length === 0) return null;
  if (contributions.length > 1) {
    logger.warn(
      `[runtime-core] Multiple plugins contribute profile.store; picking highest priority.`,
      {
        contributingPluginIds: contributions.map((c) => c.pluginId),
        priorities: contributions.map((c) => ({
          pluginId: c.pluginId,
          priority: c.priority
        }))
      }
    );
  }
  const winner = contributions
    .slice()
    .sort((a, b) => b.priority - a.priority)[0];
  return winner.payload.store;
}

/**
 * Plan 092.6.3 — pick the backend that per-account stores sync against.
 *
 * Returns `null` when no plugin contributes one, and that is a working
 * configuration rather than a failure: every account store keeps serving reads
 * and writes locally, and nothing syncs. A project with no accounts is exactly
 * this case.
 */
export function resolveActiveRemoteRecordStorageAdapter(
  manager: RuntimePluginManager,
  logger: ResolverLogger = defaultResolverLogger
): RemoteRecordStorageAdapter | null {
  const contributions = manager.getContributions("accountData.remote");
  if (contributions.length === 0) return null;
  if (contributions.length > 1) {
    logger.warn(
      `[runtime-core] Multiple plugins contribute accountData.remote; picking highest priority.`,
      {
        contributingPluginIds: contributions.map((c) => c.pluginId),
        priorities: contributions.map((c) => ({
          pluginId: c.pluginId,
          priority: c.priority
        }))
      }
    );
  }
  const winner = contributions
    .slice()
    .sort((a, b) => b.priority - a.priority)[0];
  return winner.payload.remote;
}
