import { SegmentedControl, Select, Stack, Text } from "@mantine/core";
import type {
  QuestDefinition,
  RegionNPCBehaviorTask,
  StoryPointSide
} from "@sugarmagic/domain";
import { WorldFlagActivationFields } from "./WorldFlagActivationFields";

export interface TaskActivationFieldsProps {
  task: RegionNPCBehaviorTask;
  questDefinitions: QuestDefinition[];
  questOptions: Array<{ value: string; label: string }>;
  questStageOptions: Array<{ value: string; label: string }>;
  onUpdateTask: (task: RegionNPCBehaviorTask) => void;
}

/**
 * Two things make a story point: which point, and which side of it.
 *
 * The three pickers run widest to narrowest -- the quest, a stage inside it,
 * a node inside that -- and the deepest one filled in is the point. Each
 * picker only offers what fits the ones above it, so the three always name
 * one place in one quest.
 *
 * The side says whether the task applies while that point is running or ever
 * since it finished. The two sides are back to back, so a pair of tasks set
 * to opposite sides of one point hands over with no overlap and no gap.
 */
export function TaskActivationFields(props: TaskActivationFieldsProps) {
  const { task, questDefinitions, questOptions, questStageOptions, onUpdateTask } =
    props;

  const { questDefinitionId, questStageId } = task.activation;
  const questNodeId = task.activation.questNodeId ?? null;
  const side: StoryPointSide =
    task.activation.storyPointSide === "after" ? "after" : "while";

  const selectedQuest = questDefinitions.find(
    (definition) => definition.definitionId === questDefinitionId
  );
  // Only the stages the stage picker has left in play.
  const stagesInPlay = questStageId
    ? selectedQuest?.stageDefinitions.filter(
        (stage) => stage.stageId === questStageId
      ) ?? []
    : selectedQuest?.stageDefinitions ?? [];
  const nodeGroups = stagesInPlay.map((stage) => ({
    group: stage.displayName,
    items: stage.nodeDefinitions.map((node) => ({
      value: node.nodeId,
      label: node.displayName
    }))
  }));
  const nodeStillOffered = nodeGroups.some((group) =>
    group.items.some((item) => item.value === questNodeId)
  );

  const update = (activation: Partial<RegionNPCBehaviorTask["activation"]>) =>
    onUpdateTask({ ...task, activation: { ...task.activation, ...activation } });

  /** The stage a node sits in, for dropping a node put out of reach. */
  const stageHolding = (nodeId: string): string | null =>
    selectedQuest?.stageDefinitions.find((stage) =>
      stage.nodeDefinitions.some((node) => node.nodeId === nodeId)
    )?.stageId ?? null;

  return (
    <>
      <Select
        label="Quest"
        size="xs"
        data={[{ value: "", label: "Any Quest State" }, ...questOptions]}
        value={questDefinitionId ?? ""}
        onChange={(value) => {
          const nextQuestId = value && value.length > 0 ? value : null;
          // A stage and a node only mean something inside their own quest.
          update({
            questDefinitionId: nextQuestId,
            questStageId: null,
            questNodeId: null
          });
        }}
      />
      <Select
        label="Quest Stage"
        size="xs"
        data={questStageOptions}
        value={questStageId ?? ""}
        onChange={(value) => {
          const nextStageId = value && value.length > 0 ? value : null;
          const nodeFits =
            !nextStageId ||
            (questNodeId ? stageHolding(questNodeId) === nextStageId : true);
          update({
            questStageId: nextStageId,
            questNodeId: nodeFits ? questNodeId : null
          });
        }}
      />
      <Select
        label="Quest Node"
        size="xs"
        clearable
        searchable
        placeholder={questDefinitionId ? "Whole stage" : "Pick a quest first"}
        disabled={!questDefinitionId}
        data={nodeGroups}
        value={questNodeId && nodeStillOffered ? questNodeId : null}
        onChange={(value) =>
          update({ questNodeId: value && value.length > 0 ? value : null })
        }
      />
      {questDefinitionId ? (
        <Stack gap={4}>
          <Text size="xs" fw={500}>
            Applies
          </Text>
          <SegmentedControl
            size="xs"
            fullWidth
            data={[
              { value: "while", label: "While it runs" },
              { value: "after", label: "Ever since it finished" }
            ]}
            value={side}
            onChange={(value) =>
              update({ storyPointSide: value as StoryPointSide })
            }
          />
        </Stack>
      ) : null}
      <WorldFlagActivationFields task={task} onUpdateTask={onUpdateTask} />
    </>
  );
}
