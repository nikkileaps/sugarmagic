/**
 * packages/plugins/src/shell/index.ts
 *
 * Purpose: Defines the Studio-facing plugin shell contribution contract.
 *
 * Exports:
 *   - Plugin shell contribution interfaces
 *   - createEmptyPluginShellContributionSet
 *   - collectPluginShellContributions
 *
 * Relationships:
 *   - Is consumed by discovered plugin definitions and Studio shell assembly.
 *   - Keeps plugin-owned editor surfaces declarative and host-rendered.
 *
 * Implements: Proposal 001 §Plugin contribution surface / Epic 12 generic section rendering seam
 *
 * Status: active
 */

import type {
  GameProject,
  NPCDefinition,
  PluginConfigurationRecord,
  QuestDefinition,
  QuestNodeDefinition,
  RegionDocument,
  SemanticCommand
} from "@sugarmagic/domain";
import type { ReactNode } from "react";

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
  render: (props: PluginDesignSectionRenderProps) => ReactNode;
}

export interface PluginDesignSectionRenderProps {
  workspaceKind: string;
  gameProjectId: string | null;
  gameProject: GameProject | null;
  pluginConfigurations: PluginConfigurationRecord[];
  regions: RegionDocument[];
  activeRegion: RegionDocument | null;
  targetLanguage: string;
  onCommand: (command: SemanticCommand) => void;
  selectedNPC?: NPCDefinition | null;
  updateNPC?: (definition: NPCDefinition) => void;
  selectedQuest?: QuestDefinition | null;
  updateQuest?: (definition: QuestDefinition) => void;
  selectedQuestNode?: QuestNodeDefinition | null;
}

export interface PluginNPCInteractionOptionContribution {
  pluginId?: string;
  interactionMode: string;
  label: string;
  summary?: string;
}

export interface PluginShellContributionSet {
  projectSettings: PluginProjectSettingsContribution[];
  designWorkspaces: PluginDesignWorkspaceContribution[];
  designSections: PluginDesignSectionContribution[];
  npcInteractionOptions: PluginNPCInteractionOptionContribution[];
}

export interface PluginShellContributionDefinition {
  projectSettings?: PluginProjectSettingsContribution[];
  designWorkspaces?: PluginDesignWorkspaceContribution[];
  designSections?: PluginDesignSectionContribution[];
  npcInteractionOptions?: PluginNPCInteractionOptionContribution[];
}

export function createEmptyPluginShellContributionSet(): PluginShellContributionSet {
  return {
    projectSettings: [],
    designWorkspaces: [],
    designSections: [],
    npcInteractionOptions: []
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
    result.npcInteractionOptions.push(...(definition.npcInteractionOptions ?? []));
  }

  result.projectSettings.sort((left, right) => left.label.localeCompare(right.label));
  result.designWorkspaces.sort((left, right) => left.label.localeCompare(right.label));
  result.designSections.sort((left, right) =>
    left.workspaceKind === right.workspaceKind
      ? left.label.localeCompare(right.label)
      : left.workspaceKind.localeCompare(right.workspaceKind)
  );
  result.npcInteractionOptions.sort((left, right) =>
    left.label.localeCompare(right.label)
  );

  return result;
}
