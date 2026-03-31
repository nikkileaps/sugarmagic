import type { DocumentIdentity } from "../shared/identity";

export interface PluginConfigurationRecord {
  identity: DocumentIdentity;
  pluginId: string;
  enabled: boolean;
}
