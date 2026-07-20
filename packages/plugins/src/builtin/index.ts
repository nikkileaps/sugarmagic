import type { PluginConfigurationRecord } from "@sugarmagic/domain";
import {
  createPluginConfigurationRecord,
  getPluginConfiguration
} from "@sugarmagic/domain";
import type { RuntimeBootModel } from "@sugarmagic/runtime-core";
import type { DiscoveredPluginDefinition } from "../sdk";
import { pluginDefinition as firefliesPluginDefinition } from "../catalog/fireflies";
import { pluginDefinition as helloPluginDefinition } from "../catalog/hello";
import { pluginDefinition as sugaragentPluginDefinition } from "../catalog/sugaragent";
import { pluginDefinition as sugardeployPluginDefinition } from "../catalog/sugardeploy";
import { pluginDefinition as sugarlangPluginDefinition } from "../catalog/sugarlang";
import { pluginDefinition as sugarprofilePluginDefinition } from "../catalog/sugarprofile";
export {
  createFirefliesRuntimePlugin,
  FIREFLIES_PLUGIN_ID,
  parseFirefliesPluginConfig
} from "../catalog/fireflies";
export { HELLO_PLUGIN_ID, normalizeHelloPluginConfig } from "../catalog/hello";
export {
  SUGARAGENT_PLUGIN_ID,
  SugarAgentGatewayLLMClient,
  SugarAgentGatewayVectorStoreClient,
  normalizeSugarAgentPluginConfig,
  type BearerTokenGetter
} from "../catalog/sugaragent";
export { SUGARDEPLOY_PLUGIN_ID } from "../catalog/sugardeploy";
export {
  SUGARLANG_PLUGIN_ID,
  normalizeSugarLangPluginConfig,
  resolveSugarLangTargetLanguage
} from "../catalog/sugarlang";
export {
  SUGARPROFILE_PLUGIN_ID,
  normalizeSugarProfilePluginConfig,
  type SugarProfilePluginConfig
} from "../catalog/sugarprofile";
export {
  createSupabaseIdentityProvider,
  type SupabaseIdentityProviderOptions
} from "../catalog/sugarprofile/runtime/identity";
export {
  createCookieSessionStorage,
  type CookieSessionStorage
} from "../catalog/sugarprofile/runtime/cookie-session-storage";
export {
  createSupabaseGameSaveStore,
  type SupabaseGameSaveStoreOptions
} from "../catalog/sugarprofile/runtime/save-store";
export {
  createSupabaseProfileStore,
  type SupabaseProfileStoreOptions
} from "../catalog/sugarprofile/runtime/profile-store";
export { LoginModal, type LoginModalMode, type LoginModalProps } from "../catalog/sugarprofile/ui/LoginModal";

// Plugin registry — single source of truth for every plugin Sugarmagic
// ships. Previously used `import.meta.glob("../catalog/*/index.ts")` for
// automatic discovery, but that's a Vite-specific transform that doesn't
// run during Vite's config-load phase (esbuild bundles vite.config.ts
// without applying Vite's transforms). With explicit imports the
// discovery works in every bundling context — runtime, vitest, and
// config-load — so plugin host-middleware contributions (45.4.6+) can
// reach this list from Studio's vite.config.ts without breakage. New
// plugins land here by adding the import + entry below; the explicit
// list also functions as the audit trail for "what ships in the box."
const discoveredPlugins: DiscoveredPluginDefinition[] = [
  firefliesPluginDefinition,
  helloPluginDefinition,
  sugaragentPluginDefinition,
  sugardeployPluginDefinition,
  sugarlangPluginDefinition,
  sugarprofilePluginDefinition
].sort((left, right) =>
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
