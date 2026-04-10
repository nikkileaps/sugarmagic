/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/contributions.ts
 *
 * Purpose: Declares the Sugarlang Studio shell contributions.
 *
 * Exports:
 *   - sugarlangShellContributionDefinition
 *
 * Relationships:
 *   - Depends on the plugin shell contribution definition type and the concrete Epic 12 section components.
 *   - Is consumed by manifest.ts as the canonical Sugarlang Studio shell surface.
 *
 * Implements: Proposal 001 §Plugin contribution surface
 *
 * Status: active
 */

import type { PluginShellContributionDefinition } from "../../../../shell";
import { createElement } from "react";
import { ManualRebuildButton } from "./manual-rebuild-button";
import { NpcInspectorRoleDropdown } from "./npc-inspector-role-dropdown";
import { PlacementQuestionBankViewer } from "./placement-question-bank-viewer";
import { QuestNodeEventHint } from "./quest-node-event-hint";
import { SceneDensityHistogram } from "./scene-density-histogram";

const SUGARLANG_SHELL_PLUGIN_ID = "sugarlang";

export const sugarlangShellContributionDefinition: PluginShellContributionDefinition =
  {
    projectSettings: [],
    designWorkspaces: [
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        label: "Sugarlang",
        icon: "🗣️",
        summary: "Placement, compile-status, and language-learning authoring surfaces."
      }
    ],
    designSections: [
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: "npcs",
        sectionId: "sugarlang-role",
        label: "Sugarlang Role",
        summary: "Tags agent NPCs with Sugarlang placement behavior.",
        render: (props) =>
          props.selectedNPC && props.updateNPC
            ? createElement(NpcInspectorRoleDropdown, {
                selectedNPC: props.selectedNPC,
                updateNPC: props.updateNPC
              })
            : null
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: "layout",
        sectionId: "scene-density",
        label: "Scene Density",
        summary: "Shows the active region's authoring-preview CEFR density distribution.",
        render: (props) =>
          createElement(SceneDensityHistogram, {
            gameProject: props.gameProject,
            regions: props.regions,
            activeRegion: props.activeRegion,
            targetLanguage: props.targetLanguage
          })
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: "quests",
        sectionId: "placement-event-hint",
        label: "Placement Event Hint",
        summary: "Suggests the placement completion event when a quest targets a placement NPC.",
        render: (props) =>
          props.selectedQuest &&
          props.selectedQuestNode &&
          props.updateQuest &&
          props.gameProject
            ? createElement(QuestNodeEventHint, {
                selectedQuest: props.selectedQuest,
                selectedQuestNode: props.selectedQuestNode,
                npcDefinitions: props.gameProject.npcDefinitions,
                updateQuest: props.updateQuest
              })
            : null
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "compile-status",
        label: "Compile Status",
        summary: "Shows project-wide Sugarlang compile cache status and allows manual rebuilds.",
        render: (props) =>
          createElement(ManualRebuildButton, {
            gameProjectId: props.gameProjectId,
            gameProject: props.gameProject,
            regions: props.regions,
            targetLanguage: props.targetLanguage
          })
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "placement-question-bank",
        label: "Placement Question Bank",
        summary: "Read-only view of the canonical plugin-shipped placement questionnaire.",
        render: (props) =>
          createElement(PlacementQuestionBankViewer, {
            targetLanguage: props.targetLanguage
          })
      }
    ],
    npcInteractionOptions: []
  };
