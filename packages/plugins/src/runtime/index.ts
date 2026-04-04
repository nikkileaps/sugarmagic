import type { PluginConfigurationRecord } from "@sugarmagic/domain";
import type {
  RuntimeBootModel,
  RuntimePluginContribution,
  RuntimePluginInstance
} from "@sugarmagic/runtime-core";

export interface PluginRuntimeContributionDefinition {
  contributions: RuntimePluginContribution[];
}

export interface RuntimePluginFactoryContext {
  boot: RuntimeBootModel;
  configuration: PluginConfigurationRecord;
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
  resolver: (pluginId: string) => { displayName: string; runtime?: RuntimePluginDefinition } | null
): RuntimePluginInstance[] {
  const instances: RuntimePluginInstance[] = [];

  for (const configuration of configurations) {
    if (!configuration.enabled) continue;
    const installed = resolver(configuration.pluginId);
    if (!installed?.runtime) continue;

    const instance = installed.runtime.createRuntimePlugin?.({
      boot,
      configuration
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
