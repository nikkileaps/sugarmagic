import type { PluginConfigurationRecord } from "@sugarmagic/domain";

export interface PluginProjectSettingsContribution {
  pluginId: string;
  settingsId: string;
  label: string;
  summary: string;
}

export interface PluginDesignWorkspaceContribution {
  pluginId: string;
  workspaceKind: string;
  label: string;
  icon: string;
  summary: string;
}

export interface PluginDesignSectionContribution {
  pluginId: string;
  workspaceKind: string;
  sectionId: string;
  label: string;
  summary: string;
}

export interface PluginShellContributionSet {
  projectSettings: PluginProjectSettingsContribution[];
  designWorkspaces: PluginDesignWorkspaceContribution[];
  designSections: PluginDesignSectionContribution[];
}

export interface PluginShellContributionDefinition {
  projectSettings?: PluginProjectSettingsContribution[];
  designWorkspaces?: PluginDesignWorkspaceContribution[];
  designSections?: PluginDesignSectionContribution[];
}

export function createEmptyPluginShellContributionSet(): PluginShellContributionSet {
  return {
    projectSettings: [],
    designWorkspaces: [],
    designSections: []
  };
}

export function collectPluginShellContributions(
  configurations: PluginConfigurationRecord[],
  resolver: (pluginId: string) => PluginShellContributionDefinition | null
): PluginShellContributionSet {
  const result = createEmptyPluginShellContributionSet();

  for (const configuration of configurations) {
    if (!configuration.enabled) continue;
    const definition = resolver(configuration.pluginId);
    if (!definition) continue;
    result.projectSettings.push(...(definition.projectSettings ?? []));
    result.designWorkspaces.push(...(definition.designWorkspaces ?? []));
    result.designSections.push(...(definition.designSections ?? []));
  }

  result.projectSettings.sort((left, right) => left.label.localeCompare(right.label));
  result.designWorkspaces.sort((left, right) => left.label.localeCompare(right.label));
  result.designSections.sort((left, right) =>
    left.workspaceKind === right.workspaceKind
      ? left.label.localeCompare(right.label)
      : left.workspaceKind.localeCompare(right.workspaceKind)
  );

  return result;
}
