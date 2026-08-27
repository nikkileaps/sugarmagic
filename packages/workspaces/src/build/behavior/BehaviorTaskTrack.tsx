import { memo, useMemo } from "react";
import { Badge, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import type {
  QuestDefinition,
  RegionNPCBehaviorDefinition,
  RegionNPCBehaviorTask
} from "@sugarmagic/domain";
import { questScopePath, tasksAreAmbiguous } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import { SelectableListItem } from "./SelectableListItem";

export interface BehaviorTaskTrackProps {
  behavior: RegionNPCBehaviorDefinition | null;
  questDefinitions: QuestDefinition[];
  selectedTaskId: string | null;
  activityLabelByValue: Map<string, string>;
  goalLabelByValue: Map<string, string>;
  onCreateTask: () => void;
  onSelectTask: (taskId: string) => void;
}

interface ScopeGroup {
  key: string;
  /** How far into the quest structure this group sits, for indenting. */
  depth: number;
  heading: string;
  tasks: RegionNPCBehaviorTask[];
}

/**
 * Reads the quest structure a task points at back into words: the quest
 * name, then the stage inside it, then the node inside that.
 */
function scopeHeading(
  path: readonly string[],
  side: "while" | "after",
  questDefinitions: QuestDefinition[]
): string {
  if (path.length === 0) return "Always";
  const [questId, ...rest] = path;
  const quest = questDefinitions.find(
    (definition) => definition.definitionId === questId
  );
  const names = [quest?.displayName ?? questId];
  for (const step of rest) {
    const stage = quest?.stageDefinitions.find(
      (candidate) => candidate.stageId === step
    );
    if (stage) {
      names.push(stage.displayName);
      continue;
    }
    const node = quest?.stageDefinitions
      .flatMap((candidate) => candidate.nodeDefinitions)
      .find((candidate) => candidate.nodeId === step);
    names.push(node?.displayName ?? step);
  }
  const point = names.join(" > ");
  return side === "after" ? `Ever since ${point}` : `While ${point}`;
}

function BehaviorTaskTrackComponent(props: BehaviorTaskTrackProps) {
  const {
    behavior,
    questDefinitions,
    selectedTaskId,
    activityLabelByValue,
    goalLabelByValue,
    onCreateTask,
    onSelectTask
  } = props;

  /**
   * Tasks gathered by the point in the story they name, widest first.
   *
   * The indenting is the override order: a task shown under a narrower
   * heading takes over from the ones above it while it applies, and the
   * NPC drops back to those when it stops.
   */
  const groups = useMemo<ScopeGroup[]>(() => {
    if (!behavior) return [];
    const byKey = new Map<string, ScopeGroup>();
    for (const task of behavior.tasks) {
      const path = questScopePath(task.activation, questDefinitions);
      const side =
        task.activation.storyPointSide === "after" ? "after" : "while";
      // Two sides of one point are two headings, since they never apply at
      // the same time.
      const key = `${side}/${path.join("/")}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.tasks.push(task);
        continue;
      }
      byKey.set(key, {
        key,
        depth: path.length,
        heading: scopeHeading(path, side, questDefinitions),
        tasks: [task]
      });
    }
    return [...byKey.values()].sort(
      (left, right) =>
        left.depth - right.depth || left.heading.localeCompare(right.heading)
    );
  }, [behavior, questDefinitions]);

  /**
   * Tasks that share a moment with another task where neither is the
   * narrower one, so nothing authored says which the NPC should do.
   */
  const ambiguousTaskIds = useMemo(() => {
    const flagged = new Set<string>();
    const tasks = behavior?.tasks ?? [];
    for (let index = 0; index < tasks.length; index += 1) {
      for (let other = index + 1; other < tasks.length; other += 1) {
        const left = tasks[index]!;
        const right = tasks[other]!;
        if (!tasksAreAmbiguous(left, right, questDefinitions)) continue;
        flagged.add(left.taskId);
        flagged.add(right.taskId);
      }
    }
    return flagged;
  }, [behavior, questDefinitions]);

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
              {groups.map((group) => (
                <Stack key={group.key} gap={4} pl={group.depth * 12}>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {group.heading}
                  </Text>
                  {group.tasks.map((task) => {
                    const isSelected = task.taskId === selectedTaskId;
                    return (
                      <Group key={task.taskId} gap={4} wrap="nowrap">
                        <SelectableListItem
                          icon={isSelected ? "▶" : "•"}
                          title={task.displayName}
                          subtitle={`${activityLabelByValue.get(task.currentActivity) ?? task.currentActivity} · ${
                            goalLabelByValue.get(task.currentGoal) ?? task.currentGoal
                          }`}
                          selected={isSelected}
                          surface="surface"
                          onSelect={() => onSelectTask(task.taskId)}
                        />
                        {ambiguousTaskIds.has(task.taskId) ? (
                          <Tooltip
                            multiline
                            w={220}
                            label="Another task can apply at the same time and neither is more specific. Narrow one of them."
                          >
                            <Badge size="xs" variant="light" color="yellow">
                              Unclear
                            </Badge>
                          </Tooltip>
                        ) : null}
                      </Group>
                    );
                  })}
                </Stack>
              ))}
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
