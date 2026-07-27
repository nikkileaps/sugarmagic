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
import { resetSugarlangLearnerDatabases } from "../../runtime/learner/reset-learner-data";
import { ComprehensionCheckMonitor } from "./comprehension-check-monitor";
import { LanguageConfigSection } from "./language-config-section";
import { ManualRebuildButton } from "./manual-rebuild-button";
import { PlacementQuestionBankViewer } from "./placement-question-bank-viewer";
import { QuestNodeEventHint } from "./quest-node-event-hint";
import { SceneDensityHistogram } from "./scene-density-histogram";
import { SugarlangTurnInspector } from "./sugarlang-turn-inspector";
import { LearnerCardInspector } from "./learner-card-inspector";
import { LearnerOverrideSection } from "./learner-override-section";
import { VariantReport } from "./variant-report";
import { VariantsPopoverConnected } from "./variant-popover-connected";
import { resolveStudioCompileWorkspaceId } from "./editor-support";

const SUGARLANG_SHELL_PLUGIN_ID = "sugarlang";

/**
 * Deletes sugarlang-owned IndexedDB databases (FSRS card store and telemetry)
 * via the shared reset enforcer. Runs in Studio shell context without a
 * runtime services handle, so it cannot clear in-session blackboard facts or
 * a live Preview's in-memory learner state: reload Preview to start fresh
 * (blackboard facts are session-scoped and clear on reload automatically).
 * If a live Preview holds the database open, the reset reports the block via
 * console.warn instead of silently pretending it worked.
 */
async function resetSugarlangLearnerData(): Promise<void> {
  await resetSugarlangLearnerDatabases();
}

/**
 * Module-level chunk-extraction toggle. Set by the plugin manifest at
 * registration time from `SugarLangPluginConfig.chunkExtraction.enabled`.
 * Default: true (chunk extraction fires on rebuild). Set to false during
 * heavy dev iteration to avoid Claude calls for chunks.
 */
let sugarlangChunkExtractionEnabled = true;

export function setSugarlangChunkExtractionEnabled(enabled: boolean): void {
  sugarlangChunkExtractionEnabled = enabled;
}

export function isSugarlangChunkExtractionEnabled(): boolean {
  return sugarlangChunkExtractionEnabled;
}

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
          props.updateQuest
            ? createElement(QuestNodeEventHint, {
                selectedQuest: props.selectedQuest,
                selectedQuestNode: props.selectedQuestNode,
                updateQuest: props.updateQuest
              })
            : null
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "language-config",
        label: "Language",
        summary: "Target and support language configuration for the learning pipeline.",
        render: (props) => {
          const configuration = props.pluginConfigurations.find(
            (entry) => entry.pluginId === SUGARLANG_SHELL_PLUGIN_ID
          );
          const currentConfig = configuration?.config as Record<string, unknown> | undefined;
          const updateConfig = (patch: Record<string, unknown>) => {
              if (!configuration) return;
              props.onCommand({
                kind: "UpdatePluginConfiguration",
                target: {
                  aggregateKind: "plugin-config",
                  aggregateId: configuration.identity.id
                },
                subject: {
                  subjectKind: "plugin-configuration",
                  subjectId: configuration.identity.id
                },
                payload: {
                  configuration: {
                    ...configuration,
                    enabled: true,
                    config: {
                      ...(currentConfig ?? {}),
                      ...patch
                    }
                  }
                }
              });
            };
          return createElement(LanguageConfigSection, {
            targetLanguage:
              typeof currentConfig?.targetLanguage === "string"
                ? currentConfig.targetLanguage
                : "",
            supportLanguage: "en",
            debugLogging: currentConfig?.debugLogging === true,
            debugBandOverride:
              typeof currentConfig?.debugBandOverride === "string"
                ? currentConfig.debugBandOverride
                : "",
            onChangeTargetLanguage: (lang: string) => updateConfig({ targetLanguage: lang }),
            onChangeDebugLogging: (enabled: boolean) => updateConfig({ debugLogging: enabled }),
            onChangeDebugBandOverride: (band: string) => updateConfig({ debugBandOverride: band }),
            onResetLearner: () => resetSugarlangLearnerData()
          });
        }
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
            targetLanguage: props.targetLanguage,
            chunkExtractionEnabled: sugarlangChunkExtractionEnabled
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
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "turn-inspector",
        label: "Turn Inspector",
        summary: "Inspects per-turn Sugarlang rationale traces from preview telemetry.",
        render: () => createElement(SugarlangTurnInspector)
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "comprehension-check-monitor",
        label: "Comprehension Monitor",
        summary: "Shows probe lifecycle telemetry, outcomes, and session rollups.",
        render: () => createElement(ComprehensionCheckMonitor)
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "learner-card-inspector",
        label: "Learner Cards",
        summary: "Reads chunk cards and teach records directly from IDB. No running game required.",
        render: () => createElement(LearnerCardInspector)
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "learner-override",
        label: "Learner Override",
        summary: "DEV-only: set estimated CEFR band directly and skip the placement flow. Requires a running game session.",
        render: () => createElement(LearnerOverrideSection)
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: "dialogues",
        sectionId: "line-variants",
        label: "Line Variants",
        summary: "Intent fields and language variants for the selected dialogue node. Variants button opens a popover in the node inspector.",
        render: (props) => {
          if (!props.selectedDialogueNode || !props.updateDialogueNode) return null;
          return createElement(VariantsPopoverConnected, {
            node: props.selectedDialogueNode,
            onUpdateNode: props.updateDialogueNode,
            targetLanguage: props.targetLanguage,
            dialogue: props.selectedDialogue ?? null,
            workspaceId: resolveStudioCompileWorkspaceId(props.gameProjectId)
          });
        }
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "variant-report",
        label: "Variant Report",
        summary: "Flagged baked line variants that did not pass verification. Flagged variants do not ship.",
        render: () =>
          createElement(VariantReport, {
            getFlaggedVariants: () => []
          })
      }
    ],
    npcInteractionOptions: []
  };
