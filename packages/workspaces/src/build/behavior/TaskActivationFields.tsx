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
  const { task, questOptions, questStageOptions, onUpdateTask } = props;

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
    </>
  );
}
