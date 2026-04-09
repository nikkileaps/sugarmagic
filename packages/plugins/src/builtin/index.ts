import type { PluginConfigurationRecord } from "@sugarmagic/domain";
import {
  createPluginConfigurationRecord,
  getPluginConfiguration
} from "@sugarmagic/domain";
import type { RuntimeBootModel } from "@sugarmagic/runtime-core";
import type { DiscoveredPluginDefinition } from "../sdk";
export { HELLO_PLUGIN_ID, normalizeHelloPluginConfig } from "../catalog/hello";
export {
  SUGARAGENT_PLUGIN_ID,
  normalizeSugarAgentPluginConfig
} from "../catalog/sugaragent";
export { SUGARDEPLOY_PLUGIN_ID } from "../catalog/sugardeploy";
export {
  SUGARLANG_PLUGIN_ID,
  normalizeSugarLangPluginConfig
} from "../catalog/sugarlang";

interface PluginModule {
  pluginDefinition: DiscoveredPluginDefinition;
}

const discoveredModules = import.meta.glob<PluginModule>(
  "../catalog/*/index.ts",
  { eager: true }
);

const discoveredPlugins = Object.values(discoveredModules)
  .map((module) => module.pluginDefinition)
  .sort((left, right) =>
    left.manifest.displayName.localeCompare(right.manifest.displayName)
  );

export function listDiscoveredPluginDefinitions(): DiscoveredPluginDefinition[] {
  return discoveredPlugins;
}

export function getDiscoveredPluginDefinition(
  pluginId: string
): DiscoveredPluginDefinition | null {
  return (
    discoveredPlugins.find((plugin) => plugin.manifest.pluginId === pluginId) ??
    null
  );
}

export function resolveInstalledPluginDefinitions(
  installedPluginIds: string[]
): DiscoveredPluginDefinition[] {
  const installed = new Set(installedPluginIds);
  return discoveredPlugins.filter((plugin) =>
    installed.has(plugin.manifest.pluginId)
  );
}

export function createPluginConfigurationForDiscoveredPlugin(
  pluginId: string,
  enabled = false
): PluginConfigurationRecord {
  const plugin = getDiscoveredPluginDefinition(pluginId);
  return createPluginConfigurationRecord(pluginId, enabled, plugin?.defaultConfig ?? {});
}

export function ensureDiscoveredPluginConfiguration(
  configurations: PluginConfigurationRecord[],
  pluginId: string,
  enabled: boolean
): PluginConfigurationRecord {
  const existing = getPluginConfiguration(configurations, pluginId);
  if (existing) {
    return {
      ...existing,
      enabled
    };
  }
  return createPluginConfigurationForDiscoveredPlugin(pluginId, enabled);
}

export function listBundledRuntimePluginIds(
  boot: RuntimeBootModel,
  installedPluginIds: string[],
  configurations: PluginConfigurationRecord[]
): string[] {
  const installed = new Set(installedPluginIds);
  return configurations
    .filter((configuration) => configuration.enabled)
    .filter((configuration) => installed.has(configuration.pluginId))
    .filter((configuration) => {
      const definition = getDiscoveredPluginDefinition(configuration.pluginId);
      if (!definition?.runtime) return false;
      if (definition.runtime.createRuntimePlugin) return true;
      const contributions = definition.runtime.runtimeContributions ?? [];
      return contributions.some((contribution) => {
        if (!contribution.hostKinds || contribution.hostKinds.length === 0) {
          return true;
        }
        return contribution.hostKinds.includes(boot.hostKind);
      });
    })
    .map((configuration) => configuration.pluginId)
    .sort((left, right) => left.localeCompare(right));
}
