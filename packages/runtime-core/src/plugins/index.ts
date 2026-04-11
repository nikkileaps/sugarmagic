import type { RuntimeBootModel, RuntimeHostKind } from "../index";
import type {
  ConversationMiddleware,
  ConversationProvider,
  ConversationTurnEnvelope
} from "../conversation";
import type { BlackboardFactDefinition, RuntimeBlackboard } from "../state";
import type {
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  NPCDefinition,
  PlayerDefinition,
  QuestDefinition,
  RegionDocument,
  SpellDefinition
} from "@sugarmagic/domain";
import { System, type World } from "../ecs";

export type RuntimePluginContributionKind =
  | "conversation.provider"
  | "conversation.middleware"
  | "dialogue.entryDecorator"
  | "runtime.banner"
  | "design.workspace"
  | "design.section"
  | "project.settings";

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

export type DialogueEntryDecoratorContribution = RuntimePluginContributionBase<
  "dialogue.entryDecorator",
  {
    summary: string;
    decorate: (turn: ConversationTurnEnvelope) => ConversationTurnEnvelope;
  }
>;

export type RuntimePluginContribution =
  | ConversationProviderContribution
  | ConversationMiddlewareContribution
  | DialogueEntryDecoratorContribution
  | RuntimeBannerContribution
  | DesignWorkspaceContribution
  | DesignSectionContribution
  | ProjectSettingsContribution;

export interface RuntimePluginContext {
  boot: RuntimeBootModel;
  pluginBootPayloads?: Record<string, unknown>;
  blackboard?: RuntimeBlackboard;
  activeRegion?: RegionDocument | null;
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
  contributions: RuntimePluginContribution[];
  blackboardFactDefinitions?: readonly BlackboardFactDefinition<unknown>[];
  init?: (context: RuntimePluginContext) => Promise<void> | void;
  update?: (delta: number) => void;
  serializeState?: () => unknown;
  loadState?: (state: unknown) => void;
  dispose?: () => Promise<void> | void;
}

export interface RuntimePluginManagerOptions {
  boot: RuntimeBootModel;
  plugins: RuntimePluginInstance[];
  pluginBootPayloads?: Record<string, unknown>;
}

export interface RuntimePluginManager {
  readonly boot: RuntimeBootModel;
  init: (context?: Omit<RuntimePluginContext, "boot">) => Promise<void>;
  update: (delta: number) => void;
  dispose: () => Promise<void>;
  getPlugins: () => readonly RuntimePluginInstance[];
  getEnabledPluginIds: () => string[];
  getContributions: <TKind extends RuntimePluginContributionKind>(
    kind: TKind
  ) => Array<Extract<RuntimePluginContribution, { kind: TKind }>>;
  serializeState: () => Record<string, unknown>;
  loadState: (stateByPlugin: Record<string, unknown> | null | undefined) => void;
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
    serializeState() {
      const byPlugin: Record<string, unknown> = {};
      for (const plugin of plugins) {
        const state = plugin.serializeState?.();
        if (state !== undefined) {
          byPlugin[plugin.pluginId] = state;
        }
      }
      return byPlugin;
    },
    loadState(stateByPlugin) {
      if (!stateByPlugin) return;
      for (const plugin of plugins) {
        if (!(plugin.pluginId in stateByPlugin)) continue;
        plugin.loadState?.(stateByPlugin[plugin.pluginId]);
      }
    }
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
