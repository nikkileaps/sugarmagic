import type { WorkspacePanelModel } from "@sugarmagic/ui";

export interface PluginShellContribution {
  pluginId: string;
  panels: WorkspacePanelModel[];
}
