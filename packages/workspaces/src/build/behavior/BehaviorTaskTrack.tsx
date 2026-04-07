import { memo } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { RegionNPCBehaviorDefinition } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import { SelectableListItem } from "./SelectableListItem";

export interface BehaviorTaskTrackProps {
  behavior: RegionNPCBehaviorDefinition | null;
  selectedTaskId: string | null;
  activityLabelByValue: Map<string, string>;
  goalLabelByValue: Map<string, string>;
  onCreateTask: () => void;
  onSelectTask: (taskId: string) => void;
}

function BehaviorTaskTrackComponent(props: BehaviorTaskTrackProps) {
  const {
    behavior,
    selectedTaskId,
    activityLabelByValue,
    goalLabelByValue,
    onCreateTask,
    onSelectTask
  } = props;

  return (
    <PanelSection title="Tasks" icon="🧭">
      <Stack gap="xs" p="sm">
        {behavior ? (
          <>
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                {behavior.displayName}
              </Text>
              <Button size="xs" variant="light" onClick={onCreateTask}>
                + Task
              </Button>
            </Group>
            <Stack gap={4}>
              {behavior.tasks.map((task) => {
                const isSelected = task.taskId === selectedTaskId;
                return (
                  <SelectableListItem
                    key={task.taskId}
                    icon={isSelected ? "▶" : "•"}
                    title={task.displayName}
                    subtitle={`${activityLabelByValue.get(task.currentActivity) ?? task.currentActivity} · ${
                      goalLabelByValue.get(task.currentGoal) ?? task.currentGoal
                    }`}
                    selected={isSelected}
                    surface="surface"
                    onSelect={() => onSelectTask(task.taskId)}
                  />
                );
              })}
            </Stack>
          </>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select or create a behavior to author its task track.
          </Text>
        )}
      </Stack>
    </PanelSection>
  );
}

export const BehaviorTaskTrack = memo(BehaviorTaskTrackComponent);
