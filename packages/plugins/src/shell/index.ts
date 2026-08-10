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
  DialogueDefinition,
  DialogueNodeDefinition,
  ItemDefinition,
  GameProject,
  NPCDefinition,
  PluginConfigurationRecord,
  QuestDefinition,
  QuestNodeDefinition,
  RegionDocument,
  Scene,
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

// Story 46.5 — plugins contribute Publish-productmode workspaces
// here, parallel to the Design contributions above. Studio core
// renders one baseline `package` workspace (Story 46.1); these
// contributions stack additional tabs alongside it. SugarDeploy
// contributes three (Provision / Release / Deploy).
export interface PluginPublishWorkspaceContribution {
  pluginId: string;
  workspaceKind: string;
  label: string;
  icon: string;
  summary: string;
  /**
   * Sort order within the Publish productmode sub-nav. The Package
   * tab Studio core ships is rendered first; plugin contributions
   * follow in ascending `order`. Stable-sorted, so equal values
   * fall back to insertion order across plugins.
   */
  order: number;
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
  /** The author's ambient Scene (Plan 058 pattern) — sections that read
   *  region contents must compose Base + this Scene's overlay, never base
   *  alone. Null only when the project has no Scenes. */
  activeScene?: Scene | null;
  targetLanguage: string;
  onCommand: (command: SemanticCommand) => void;
  /**
   * Write bytes into the project's `assets/` folder (Plan 092.2).
   *
   * A plugin that produces a DERIVED ARTIFACT the runtime cannot rebuild --
   * one needing Studio, a network service or paid work (ADR 005 rule 3) --
   * has to put the result somewhere that travels with the game. `assets/` is
   * that place, and the deploy already ships it wholesale.
   *
   * Studio supplies this because writing to disk needs the project directory
   * handle, which only Studio holds; the same reason the mask painter is
   * handed a writer rather than reaching for one. A plugin package never
   * depends on `@sugarmagic/io`.
   *
   * Declaring the written path is a SEPARATE step: put it under
   * `PLUGIN_ASSET_PATHS_CONFIG_KEY` in the plugin's own configuration, or the
   * file will not re-load on project open and will not deploy.
   *
   * Absent when no project is open.
   */
  writeAssetFile?: (relativeAssetPath: string, blob: Blob) => Promise<void>;
  /**
   * Read back a file the plugin previously wrote (Plan 092.2). Null when the
   * project has never produced it.
   *
   * This is what demotes the browser cache to a cache. The artifact on disk is
   * the durable copy, so after clearing browser storage a plugin can restore
   * its own cache from the project rather than re-running the paid work that
   * produced it.
   *
   * Reads the copy already loaded into memory on project open, not the disk:
   * `readBlobFile` intermittently returns null for a file written moments
   * earlier, and the artifact is declared, so it is in memory anyway.
   */
  readAssetFile?: (relativeAssetPath: string) => Promise<Blob | null>;
  /**
   * Save the project (Plan 092.2).
   *
   * Needed because writing an artifact FILE and declaring its path are two
   * different kinds of write: the file goes to disk immediately, the
   * declaration is a command that only marks the session dirty. Without a save
   * a bake leaves files on disk that nothing reloads and nothing ships -- the
   * exact half-state this epic exists to remove.
   *
   * Absent when no project is open.
   */
  requestSave?: () => Promise<unknown>;
  selectedNPC?: NPCDefinition | null;
  updateNPC?: (definition: NPCDefinition) => void;
  selectedQuest?: QuestDefinition | null;
  updateQuest?: (definition: QuestDefinition) => void;
  selectedQuestNode?: QuestNodeDefinition | null;
  selectedDialogue?: DialogueDefinition | null;
  selectedDialogueNode?: DialogueNodeDefinition | null;
  updateDialogueNode?: (node: DialogueNodeDefinition) => void;
  selectedItem?: ItemDefinition | null;
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
  publishWorkspaces: PluginPublishWorkspaceContribution[];
  npcInteractionOptions: PluginNPCInteractionOptionContribution[];
}

export interface PluginShellContributionDefinition {
  projectSettings?: PluginProjectSettingsContribution[];
  designWorkspaces?: PluginDesignWorkspaceContribution[];
  designSections?: PluginDesignSectionContribution[];
  publishWorkspaces?: PluginPublishWorkspaceContribution[];
  npcInteractionOptions?: PluginNPCInteractionOptionContribution[];
}

export function createEmptyPluginShellContributionSet(): PluginShellContributionSet {
  return {
    projectSettings: [],
    designWorkspaces: [],
    designSections: [],
    publishWorkspaces: [],
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
    result.publishWorkspaces.push(...(definition.publishWorkspaces ?? []));
    result.npcInteractionOptions.push(...(definition.npcInteractionOptions ?? []));
  }

  result.projectSettings.sort((left, right) => left.label.localeCompare(right.label));
  result.designWorkspaces.sort((left, right) => left.label.localeCompare(right.label));
  result.designSections.sort((left, right) =>
    left.workspaceKind === right.workspaceKind
      ? left.label.localeCompare(right.label)
      : left.workspaceKind.localeCompare(right.workspaceKind)
  );
  // Story 46.5 — publish workspaces sort by explicit `order` so
  // SugarDeploy's Provision / Release / Deploy stay in cadence order
  // regardless of plugin discovery order. Ties break by label for
  // determinism.
  result.publishWorkspaces.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.label.localeCompare(right.label);
  });
  result.npcInteractionOptions.sort((left, right) =>
    left.label.localeCompare(right.label)
  );

  return result;
}
