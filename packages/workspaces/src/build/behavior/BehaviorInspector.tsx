import { memo, useMemo } from "react";
import {
  Badge,
  Button,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput
} from "@mantine/core";
import type {
  QuestDefinition,
  RegionDocument,
  RegionNPCBehaviorDefinition,
  RegionNPCBehaviorTask
} from "@sugarmagic/domain";
import {
  REGION_NPC_BEHAVIOR_ACTIVITY_OPTIONS,
  REGION_NPC_BEHAVIOR_GOAL_OPTIONS
} from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceNavigationTarget } from "../../workspace-view";
import { DrivenByPanel } from "./DrivenByPanel";
import { TaskActivationFields } from "./TaskActivationFields";

export interface BehaviorInspectorProps {
  region: RegionDocument | null;
  behavior: RegionNPCBehaviorDefinition | null;
  task: RegionNPCBehaviorTask | null;
  npcOptions: Array<{ value: string; label: string }>;
  npcPresenceMissing: boolean;
  questDefinitions: QuestDefinition[];
  questOptions: Array<{ value: string; label: string }>;
  onUpdateBehavior: (behavior: RegionNPCBehaviorDefinition) => void;
  onDeleteBehavior: (behaviorId: string) => void;
  onUpdateTask: (task: RegionNPCBehaviorTask) => void;
  onDeleteTask: (taskId: string) => void;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
}

function BehaviorInspectorComponent(props: BehaviorInspectorProps) {
  const {
    region,
    behavior,
    task,
    npcOptions,
    npcPresenceMissing,
    questDefinitions,
    questOptions,
    onUpdateBehavior,
    onDeleteBehavior,
    onUpdateTask,
    onDeleteTask,
    onNavigateToTarget
  } = props;

  const selectedQuestDefinition = useMemo(
    () =>
      task?.activation.questDefinitionId
        ? questDefinitions.find(
            (quest) => quest.definitionId === task.activation.questDefinitionId
          ) ?? null
        : null,
    [questDefinitions, task]
  );
  const targetAreaOptions = useMemo(
    () => [
      { value: "", label: "No Movement Target" },
      ...((region?.areas ?? []).map((area) => ({
        value: area.areaId,
        label: area.displayName
      })))
    ],
    [region?.areas]
  );
  const questStageOptions = useMemo(
    () => [
      { value: "", label: "Any Stage" },
      ...((selectedQuestDefinition?.stageDefinitions.map((stage) => ({
        value: stage.stageId,
        label: stage.displayName
      })) ?? []))
    ],
    [selectedQuestDefinition]
  );

  return (
    <Inspector selectionLabel={behavior?.displayName ?? "Behavior"} selectionIcon="🎭">
      {behavior ? (
        <Stack gap="md">
          <TextInput
            label="Behavior Name"
            size="xs"
            value={behavior.displayName}
            onChange={(event) =>
              onUpdateBehavior({
                ...behavior,
                displayName: event.currentTarget.value
              })
            }
          />
          <Select
            label="NPC"
            size="xs"
            data={npcOptions}
            value={behavior.npcDefinitionId}
            onChange={(value) => {
              if (!value) {
                return;
              }
              onUpdateBehavior({
                ...behavior,
                npcDefinitionId: value
              });
            }}
          />
          {npcPresenceMissing ? (
            <Stack gap={4}>
              <Badge size="xs" variant="light" color="yellow" style={{ alignSelf: "flex-start" }}>
                Missing Scene Presence
              </Badge>
              <Text size="xs" c="var(--sm-color-overlay0)">
                This behavior points to an NPC definition that is not currently placed in
                the scene. Add that NPC back to the region layout or reassign this
                behavior.
              </Text>
            </Stack>
          ) : null}
          <Button
            size="xs"
            variant="subtle"
            color="red"
            onClick={() => onDeleteBehavior(behavior.behaviorId)}
          >
            Delete Behavior
          </Button>

          {task ? (
            <>
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Selected Task
              </Text>
              <TextInput
                label="Task Name"
                size="xs"
                value={task.displayName}
                onChange={(event) =>
                  onUpdateTask({
                    ...task,
                    displayName: event.currentTarget.value
                  })
                }
              />
              <Textarea
                label="Task Description"
                size="xs"
                autosize
                minRows={3}
                description="Optional richer context for conversation and debugging."
                value={task.description ?? ""}
                onKeyDownCapture={(event) => event.stopPropagation()}
                onKeyUpCapture={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  onUpdateTask({
                    ...task,
                    description: event.currentTarget.value
                  })
                }
                onBlur={(event) =>
                  onUpdateTask({
                    ...task,
                    description:
                      event.currentTarget.value.trim().length > 0
                        ? event.currentTarget.value
                        : null
                  })
                }
              />
              <Select
                label="Target Area"
                size="xs"
                data={targetAreaOptions}
                value={task.targetAreaId ?? ""}
                onChange={(value) =>
                  onUpdateTask({
                    ...task,
                    targetAreaId: value && value.length > 0 ? value : null
                  })
                }
              />
              <Select
                label="Current Activity"
                size="xs"
                data={REGION_NPC_BEHAVIOR_ACTIVITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label
                }))}
                value={task.currentActivity}
                onChange={(value) =>
                  onUpdateTask({
                    ...task,
                    currentActivity: value ?? "idle"
                  })
                }
              />
              <Select
                label="Current Goal"
                size="xs"
                data={REGION_NPC_BEHAVIOR_GOAL_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label
                }))}
                value={task.currentGoal}
                onChange={(value) =>
                  onUpdateTask({
                    ...task,
                    currentGoal: value ?? "idle"
                  })
                }
              />
              <TaskActivationFields
                task={task}
                questDefinitions={questDefinitions}
                questOptions={questOptions}
                questStageOptions={questStageOptions}
                onUpdateTask={onUpdateTask}
              />
              <DrivenByPanel
                questDefinition={selectedQuestDefinition}
                stageId={task.activation.questStageId}
                onNavigateToTarget={onNavigateToTarget}
              />
              <Button
                size="xs"
                variant="subtle"
                color="red"
                disabled={behavior.tasks.length <= 1}
                onClick={() => onDeleteTask(task.taskId)}
              >
                Delete Task
              </Button>
            </>
          ) : (
            <Text size="xs" c="var(--sm-color-overlay0)">
              Select a task to edit its target area, quest trigger, activity, and goal.
            </Text>
          )}
        </Stack>
      ) : (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Select or create a behavior to author quest-driven NPC movement and tasks.
        </Text>
      )}
    </Inspector>
  );
}

export const BehaviorInspector = memo(BehaviorInspectorComponent);
