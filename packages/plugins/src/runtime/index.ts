import type { PluginConfigurationRecord } from "@sugarmagic/domain";
import type {
  RuntimeBootModel,
  RuntimePluginContribution,
  RuntimePluginInstance,
  RuntimePluginManager
} from "@sugarmagic/runtime-core";
import { createRuntimePluginManager } from "@sugarmagic/runtime-core";
import { getDiscoveredPluginDefinition } from "../builtin";

export interface PluginRuntimeContributionDefinition {
  contributions: RuntimePluginContribution[];
}

export type RuntimePluginEnvironment = Record<string, string | undefined>;

export interface RuntimePluginFactoryContext {
  boot: RuntimeBootModel;
  configuration: PluginConfigurationRecord;
  environment?: RuntimePluginEnvironment;
}

export interface RuntimePluginDefinition {
  createRuntimePlugin?: (
    context: RuntimePluginFactoryContext
  ) => RuntimePluginInstance | null;
  runtimeContributions?: RuntimePluginContribution[];
}

function createStaticRuntimePluginInstance(
  boot: RuntimeBootModel,
  configuration: PluginConfigurationRecord,
  displayName: string,
  contributions: RuntimePluginContribution[]
): RuntimePluginInstance {
  const filtered = contributions.filter((contribution) => {
    if (!contribution.hostKinds || contribution.hostKinds.length === 0) {
      return true;
    }
    return contribution.hostKinds.includes(boot.hostKind);
  });

  return {
    pluginId: configuration.pluginId,
    displayName,
    contributions: filtered,
    serializeState: () => ({ enabled: configuration.enabled })
  };
}

export function createRuntimePluginInstances(
  boot: RuntimeBootModel,
  configurations: PluginConfigurationRecord[],
  resolver: (pluginId: string) => { displayName: string; runtime?: RuntimePluginDefinition } | null,
  environment: RuntimePluginEnvironment = {}
): RuntimePluginInstance[] {
  const instances: RuntimePluginInstance[] = [];

  for (const configuration of configurations) {
    if (!configuration.enabled) continue;
    const installed = resolver(configuration.pluginId);
    if (!installed?.runtime) continue;

    const instance = installed.runtime.createRuntimePlugin?.({
      boot,
      configuration,
      environment
    }) ?? createStaticRuntimePluginInstance(
      boot,
      configuration,
      installed.displayName,
      installed.runtime.runtimeContributions ?? []
    );

    if (instance) {
      instances.push(instance);
    }
  }

  return instances;
}

export function resolveInstalledRuntimePluginInstances(
  boot: RuntimeBootModel,
  installedPluginIds: string[],
  configurations: PluginConfigurationRecord[],
  environment: RuntimePluginEnvironment = {}
): RuntimePluginInstance[] {
  return createRuntimePluginInstances(boot, configurations, (pluginId) => {
    if (!installedPluginIds.includes(pluginId)) return null;
    const plugin = getDiscoveredPluginDefinition(pluginId);
    if (!plugin) return null;
    return {
      displayName: plugin.manifest.displayName,
      runtime: plugin.runtime
    };
  }, environment);
}

export function createResolvedRuntimePluginManager(
  boot: RuntimeBootModel,
  installedPluginIds: string[],
  configurations: PluginConfigurationRecord[],
  environment: RuntimePluginEnvironment = {},
  pluginBootPayloads: Record<string, unknown> = {}
): RuntimePluginManager {
  return createRuntimePluginManager({
    boot,
    pluginBootPayloads,
    plugins: resolveInstalledRuntimePluginInstances(
      boot,
      installedPluginIds,
      configurations,
      environment
    )
  });
}
