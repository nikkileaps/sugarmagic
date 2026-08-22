import { Select, TextInput } from "@mantine/core";
import { FlagSelect } from "../../flags";
import type {
  RegionBehaviorWorldFlagCondition,
  RegionNPCBehaviorTask
} from "@sugarmagic/domain";

const WORLD_FLAG_VALUE_TYPE_OPTIONS = [
  { value: "boolean", label: "Boolean" },
  { value: "number", label: "Number" },
  { value: "string", label: "String" }
] as const satisfies ReadonlyArray<{
  value: RegionBehaviorWorldFlagCondition["valueType"];
  label: string;
}>;

function isWorldFlagValueType(
  value: string
): value is RegionBehaviorWorldFlagCondition["valueType"] {
  return WORLD_FLAG_VALUE_TYPE_OPTIONS.some((option) => option.value === value);
}

export interface WorldFlagActivationFieldsProps {
  task: RegionNPCBehaviorTask;
  onUpdateTask: (task: RegionNPCBehaviorTask) => void;
}

export function WorldFlagActivationFields(props: WorldFlagActivationFieldsProps) {
  const { task, onUpdateTask } = props;

  return (
    <>
      <FlagSelect
        label="World Flag"
        description="Optional. The task only activates while this flag matches."
        value={task.activation.worldFlagEquals?.flagId ?? null}
        onChange={(flagId) => {
          onUpdateTask({
            ...task,
            activation: {
              ...task.activation,
              worldFlagEquals: flagId
                ? {
                    flagId,
                    valueType:
                      task.activation.worldFlagEquals?.valueType ?? "boolean",
                    value: task.activation.worldFlagEquals?.value ?? null
                  }
                : null
            }
          });
        }}
      />
      {task.activation.worldFlagEquals && (
        <>
          <Select
            label="World Flag Value Type"
            size="xs"
            data={WORLD_FLAG_VALUE_TYPE_OPTIONS.map((option) => ({ ...option }))}
            value={task.activation.worldFlagEquals.valueType}
            onChange={(value) => {
              if (
                !value ||
                !isWorldFlagValueType(value) ||
                !task.activation.worldFlagEquals
              ) {
                return;
              }
              onUpdateTask({
                ...task,
                activation: {
                  ...task.activation,
                  worldFlagEquals: {
                    ...task.activation.worldFlagEquals,
                    valueType: value,
                    value:
                      value === "boolean" &&
                      task.activation.worldFlagEquals.value == null
                        ? "true"
                        : task.activation.worldFlagEquals.value
                  }
                }
              });
            }}
          />
          <TextInput
            label="World Flag Expected Value"
            size="xs"
            description={
              task.activation.worldFlagEquals.valueType === "boolean"
                ? "Use true or false."
                : task.activation.worldFlagEquals.valueType === "number"
                  ? "Use a numeric value."
                  : "Use a string value."
            }
            value={task.activation.worldFlagEquals.value ?? ""}
            onChange={(event) => {
              if (!task.activation.worldFlagEquals) {
                return;
              }
              onUpdateTask({
                ...task,
                activation: {
                  ...task.activation,
                  worldFlagEquals: {
                    ...task.activation.worldFlagEquals,
                    value:
                      event.currentTarget.value.trim().length > 0
                        ? event.currentTarget.value
                        : null
                  }
                }
              });
            }}
          />
        </>
      )}
    </>
  );
}
