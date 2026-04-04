import type { PluginConfigurationRecord } from "@sugarmagic/domain";
import type { RuntimePluginDefinition } from "../runtime";
import type { PluginShellContributionDefinition } from "../shell";

export interface PluginManifest {
  pluginId: string;
  displayName: string;
  summary: string;
  capabilityIds: string[];
}

export interface InstalledPluginDefinition {
  manifest: PluginManifest;
  defaultConfig?: Record<string, unknown>;
}

export interface DiscoveredPluginDefinition extends InstalledPluginDefinition {
  runtime?: RuntimePluginDefinition;
  shell?: PluginShellContributionDefinition;
}

export interface PluginResolutionContext {
  configuration: PluginConfigurationRecord;
}
