import type { SemanticCommand } from "@sugarmagic/domain";

export interface PluginManifest {
  pluginId: string;
  displayName: string;
  capabilityIds: string[];
}

export interface PluginCapability {
  capabilityId: string;
  displayName: string;
}

export interface PluginCommandContribution {
  commandId: string;
  commandKind: SemanticCommand["kind"];
}
