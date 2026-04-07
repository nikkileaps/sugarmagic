import { useMemo } from "react";
import type {
  NPCDefinition,
  QuestDefinition,
  RegionDocument,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  REGION_NPC_BEHAVIOR_ACTIVITY_OPTIONS,
  REGION_NPC_BEHAVIOR_GOAL_OPTIONS
} from "@sugarmagic/domain";
import type {
  WorkspaceNavigationTarget,
  WorkspaceViewContribution
} from "../../workspace-view";
import { BehaviorInspector } from "./BehaviorInspector";
import { BehaviorListPanel } from "./BehaviorListPanel";
import { BehaviorTaskTrack } from "./BehaviorTaskTrack";
import { useBehaviorCommands } from "./useBehaviorCommands";
import { useBehaviorSelection } from "./useBehaviorSelection";

export interface BehaviorWorkspaceViewProps {
  region: RegionDocument | null;
  npcDefinitions: NPCDefinition[];
  questDefinitions: QuestDefinition[];
  onCommand: (command: SemanticCommand) => void;
  navigationTarget?: WorkspaceNavigationTarget | null;
  onConsumeNavigationTarget?: () => void;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
}

export function useBehaviorWorkspaceView(
  props: BehaviorWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    region,
    npcDefinitions,
    questDefinitions,
    onCommand,
    navigationTarget = null,
    onConsumeNavigationTarget,
    onNavigateToTarget
  } = props;

  const behaviorRecords = useMemo(() => region?.behaviors ?? [], [region]);
  const presentNpcDefinitionIds = useMemo(
    () => new Set(region?.scene.npcPresences.map((presence) => presence.npcDefinitionId) ?? []),
    [region?.scene.npcPresences]
  );
  const npcOptions = useMemo(
    () =>
      npcDefinitions.map((definition) => ({
        value: definition.definitionId,
        label: definition.displayName
      })),
    [npcDefinitions]
  );
  const questOptions = useMemo(
    () =>
      questDefinitions.map((definition) => ({
        value: definition.definitionId,
        label: definition.displayName
      })),
    [questDefinitions]
  );
  const activityLabelByValue = useMemo(
    () =>
      new Map<string, string>(
        REGION_NPC_BEHAVIOR_ACTIVITY_OPTIONS.map((option) => [option.value, option.label])
      ),
    []
  );
  const goalLabelByValue = useMemo(
    () =>
      new Map<string, string>(
        REGION_NPC_BEHAVIOR_GOAL_OPTIONS.map((option) => [option.value, option.label])
      ),
    []
  );

  const {
    selectedBehaviorId,
    setSelectedBehaviorId,
    selectedTaskId,
    setSelectedTaskId,
    selectedBehavior,
    selectedTask
  } = useBehaviorSelection({
    behaviorRecords,
    regionId: region?.identity.id ?? null,
    navigationTarget,
    onConsumeNavigationTarget
  });

  const {
    updateBehavior,
    createBehavior,
    deleteBehavior,
    updateTask,
    createTask,
    deleteTask
  } = useBehaviorCommands({
    region,
    npcDefinitions,
    onCommand,
    selectedBehavior,
    setSelectedBehaviorId,
    setSelectedTaskId
  });

  return {
    leftPanel: (
      <BehaviorListPanel
        regionSelected={Boolean(region)}
        behaviors={behaviorRecords}
        npcDefinitions={npcDefinitions}
        presentNpcDefinitionIds={presentNpcDefinitionIds}
        selectedBehaviorId={selectedBehaviorId}
        onCreateBehavior={createBehavior}
        onSelectBehavior={setSelectedBehaviorId}
      />
    ),
    centerPanel: (
      <BehaviorTaskTrack
        behavior={selectedBehavior}
        selectedTaskId={selectedTaskId}
        activityLabelByValue={activityLabelByValue}
        goalLabelByValue={goalLabelByValue}
        onCreateTask={createTask}
        onSelectTask={setSelectedTaskId}
      />
    ),
    rightPanel: (
      <BehaviorInspector
        region={region}
        behavior={selectedBehavior}
        task={selectedTask}
        npcOptions={npcOptions}
        npcPresenceMissing={
          selectedBehavior
            ? !presentNpcDefinitionIds.has(selectedBehavior.npcDefinitionId)
            : false
        }
        questDefinitions={questDefinitions}
        questOptions={questOptions}
        onUpdateBehavior={updateBehavior}
        onDeleteBehavior={deleteBehavior}
        onUpdateTask={updateTask}
        onDeleteTask={deleteTask}
        onNavigateToTarget={onNavigateToTarget}
      />
    ),
    viewportOverlay: null
  };
}
