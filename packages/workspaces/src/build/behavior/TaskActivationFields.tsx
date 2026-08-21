import { Select } from "@mantine/core";
import type { QuestDefinition, RegionNPCBehaviorTask } from "@sugarmagic/domain";
import { WorldFlagActivationFields } from "./WorldFlagActivationFields";

export interface TaskActivationFieldsProps {
  task: RegionNPCBehaviorTask;
  questDefinitions: QuestDefinition[];
  questOptions: Array<{ value: string; label: string }>;
  questStageOptions: Array<{ value: string; label: string }>;
  onUpdateTask: (task: RegionNPCBehaviorTask) => void;
}

export function TaskActivationFields(props: TaskActivationFieldsProps) {
  const { task, questDefinitions, questOptions, questStageOptions, onUpdateTask } =
    props;

  // One picker for one idea: which quest moment turns this task on. Grouped by
  // quest so the node names read in context. The option value carries both ids
  // because a node id is only unique within its quest.
  const NODE_KEY_SEPARATOR = "::";
  const nodeGroups = questDefinitions.map((definition) => ({
    group: definition.displayName,
    items: definition.stageDefinitions.flatMap((stage) =>
      stage.nodeDefinitions.map((node) => ({
        value: `${definition.definitionId}${NODE_KEY_SEPARATOR}${node.nodeId}`,
        label: `${stage.displayName} — ${node.displayName}`
      }))
    )
  }));
  const selectedNodeKey = task.activation.nodeCompleted
    ? `${task.activation.nodeCompleted.questDefinitionId}${NODE_KEY_SEPARATOR}${task.activation.nodeCompleted.nodeId}`
    : "";

  return (
    <>
      <Select
        label="Quest"
        size="xs"
        data={[{ value: "", label: "Any Quest State" }, ...questOptions]}
        value={task.activation.questDefinitionId ?? ""}
        onChange={(value) =>
          onUpdateTask({
            ...task,
            activation: {
              ...task.activation,
              questDefinitionId: value && value.length > 0 ? value : null,
              questStageId: value && value.length > 0 ? task.activation.questStageId : null
            }
          })
        }
      />
      <Select
        label="Quest Stage"
        size="xs"
        data={questStageOptions}
        value={task.activation.questStageId ?? ""}
        onChange={(value) =>
          onUpdateTask({
            ...task,
            activation: {
              ...task.activation,
              questStageId: value && value.length > 0 ? value : null
            }
          })
        }
      />
      <WorldFlagActivationFields task={task} onUpdateTask={onUpdateTask} />
      <Select
        label="Starts After Node"
        size="xs"
        clearable
        searchable
        placeholder="Any time"
        data={nodeGroups}
        value={selectedNodeKey.length > 0 ? selectedNodeKey : null}
        onChange={(value) => {
          const [questDefinitionId, nodeId] = (value ?? "").split(
            NODE_KEY_SEPARATOR
          );
          onUpdateTask({
            ...task,
            activation: {
              ...task.activation,
              nodeCompleted:
                questDefinitionId && nodeId
                  ? { questDefinitionId, nodeId }
                  : null
            }
          });
        }}
      />
    </>
  );
}
