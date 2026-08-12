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

import { PLUGIN_ASSET_PATHS_CONFIG_KEY } from "@sugarmagic/domain";
import type {
  PluginConfigurationRecord,
  SemanticCommand
} from "@sugarmagic/domain";
import type { PluginShellContributionDefinition } from "../../../../shell";
import { createElement } from "react";
import { resetSugarlangLearnerDatabases } from "../../runtime/learner";
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
import { ItemViewVariantsConnected } from "./item-view-variants-connected";
import {
  collectVariantArtifact,
  resolveStudioCompileWorkspaceId,
  type SugarlangArtifact
} from "./editor-support";
import { SUGARLANG_TEACH_PLAN_CONFIG_KEY } from "../../runtime/compile/teach-plan-state";

const SUGARLANG_SHELL_PLUGIN_ID = "sugarlang";

/**
 * Writes derived artifacts into the project's `assets/` and declares their
 * paths (Plan 092.2).
 *
 * TWO STEPS, BOTH REQUIRED. Writing puts the bytes on disk; declaring is what
 * makes the project reload them on open and the deploy ship them. A written
 * but undeclared file is invisible to both, which is the shape of the bug this
 * epic exists to fix.
 *
 * Studio supplies the writer because it holds the directory handle. Without a
 * configuration record there is nothing to patch, so the file is still written
 * -- it just is not declared until the plugin has a record, which is the same
 * degradation the teach plan already accepts.
 */
async function persistSugarlangArtifacts(
  props: {
    pluginConfigurations: PluginConfigurationRecord[];
    onCommand: (command: SemanticCommand) => void;
    writeAssetFile?: (relativeAssetPath: string, blob: Blob) => Promise<void>;
    requestSave?: () => Promise<unknown>;
  },
  artifacts: SugarlangArtifact[]
): Promise<void> {
  const write = props.writeAssetFile;
  if (!write || artifacts.length === 0) {
    return;
  }
  for (const artifact of artifacts) {
    await write(
      artifact.relativeAssetPath,
      new Blob([JSON.stringify(artifact.json, null, 2)], {
        type: "application/json"
      })
    );
  }

  const configuration = props.pluginConfigurations.find(
    (entry) => entry.pluginId === SUGARLANG_SHELL_PLUGIN_ID
  );
  if (!configuration) {
    return;
  }
  const config = configuration.config as Record<string, unknown> | undefined;
  const already = Array.isArray(config?.[PLUGIN_ASSET_PATHS_CONFIG_KEY])
    ? (config[PLUGIN_ASSET_PATHS_CONFIG_KEY] as unknown[]).filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  const declared = [
    ...new Set([...already, ...artifacts.map((a) => a.relativeAssetPath)])
  ].sort();
  // Paths are stable, so after the first write this is the same list every
  // time. Skipping the no-op keeps a bake off the undo stack entirely.
  if (declared.length === already.length && declared.every((p, i) => p === already[i])) {
    return;
  }
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
          ...(configuration.config ?? {}),
          [PLUGIN_ASSET_PATHS_CONFIG_KEY]: declared
        }
      }
    }
  });

  // SAVE, or the bake is only half durable. The FILES are already on disk --
  // `writeAssetFile` goes straight there -- but the declaration above is a
  // command, and a command only marks the session dirty. Closing the tab here
  // would leave two files that nothing reloads and nothing deploys.
  //
  // Only reached when the declaration actually changed, which is the first
  // bake of a project and never again, because the paths are stable.
  await props.requestSave?.();
}

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
            activeScene: props.activeScene ?? null,
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
      // FIRST on the Sugarlang workspace, deliberately: this is the only way to
      // build anything. Nothing rebuilds on save or on a timer, so content edits
      // are invisible until this runs. Section order here IS render order.
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "compile-status",
        label: "Build",
        summary:
          "Builds Sugarlang's derived artifacts for the whole project -- scene vocabulary, multi-word expressions, line intent and scene concepts -- and shows cache status.",
        render: (props) => {
          const configuration = props.pluginConfigurations.find(
            (entry) => entry.pluginId === SUGARLANG_SHELL_PLUGIN_ID
          );
          const config = configuration?.config as Record<string, unknown> | undefined;

          return createElement(ManualRebuildButton, {
            gameProjectId: props.gameProjectId,
            gameProject: props.gameProject,
            regions: props.regions,
            activeScene: props.activeScene ?? null,
            targetLanguage: props.targetLanguage,
            chunkExtractionEnabled: sugarlangChunkExtractionEnabled,
            storedTeachPlan: config?.[SUGARLANG_TEACH_PLAN_CONFIG_KEY],
            readAssetFile: props.readAssetFile,
            // Plan 092.2 — the bake's derived artifacts go into the project's
            // `assets/`, which is how they reach a deployed game. Studio owns
            // the disk, so it supplies the writer; this plugin never depends
            // on the io package.
            //
            // Declaring the paths is a SEPARATE step and just as necessary:
            // an undeclared file neither re-loads on project open nor ships.
            // The paths are stable, so this write is idempotent and only ever
            // changes the project the first time.
            onArtifacts: props.writeAssetFile
              ? (artifacts) => persistSugarlangArtifacts(props, artifacts)
              : undefined,
            // Written through the same UpdatePluginConfiguration command the
            // Language panel uses. Without a configuration record there is
            // nothing to patch, so the plan stays in memory for this session --
            // the same degradation as before it was persisted at all.
            onPersistTeachPlan: configuration
              ? (document) =>
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
                          ...(configuration.config ?? {}),
                          [SUGARLANG_TEACH_PLAN_CONFIG_KEY]: document
                        }
                      }
                    }
                  })
              : undefined
          });
        }
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: SUGARLANG_SHELL_PLUGIN_ID,
        sectionId: "language-config",
        label: "Learner Debug",
        summary:
          "Band override, debug logging, and resetting learner data. The project's language is set in the Sugarlang settings.",
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
            debugLogging: currentConfig?.debugLogging === true,
            debugBandOverride:
              typeof currentConfig?.debugBandOverride === "string"
                ? currentConfig.debugBandOverride
                : "",
            onChangeDebugLogging: (enabled: boolean) => updateConfig({ debugLogging: enabled }),
            onChangeDebugBandOverride: (band: string) => updateConfig({ debugBandOverride: band }),
            onResetLearner: () => resetSugarlangLearnerData()
          });
        }
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
            workspaceId: resolveStudioCompileWorkspaceId(props.gameProjectId),
            // Plan 092.2 -- a variant that only exists in this browser never
            // reaches a player, and a HAND-EDITED one cannot be regenerated at
            // all. Sweep the cache into the project after either kind changes.
            onVariantsChanged: props.writeAssetFile
              ? async () => {
                  const artifact = await collectVariantArtifact(
                    resolveStudioCompileWorkspaceId(props.gameProjectId)
                  );
                  if (artifact) {
                    await persistSugarlangArtifacts(props, [artifact]);
                  }
                }
              : undefined
          });
        }
      },
      {
        pluginId: SUGARLANG_SHELL_PLUGIN_ID,
        workspaceKind: "items",
        sectionId: "item-view-variants",
        label: "Language Variants",
        summary: "Grade the selected item's Examine text into the target language at each band.",
        render: (props) => {
          if (!props.selectedItem) return null;
          return createElement(ItemViewVariantsConnected, {
            item: props.selectedItem,
            targetLanguage: props.targetLanguage,
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
