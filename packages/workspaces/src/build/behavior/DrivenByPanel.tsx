import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import type { QuestDefinition } from "@sugarmagic/domain";
import type { WorkspaceNavigationTarget } from "../../workspace-view";

export interface DrivenByPanelProps {
  questDefinition: QuestDefinition | null;
  stageId: string | null;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
}

export function DrivenByPanel(props: DrivenByPanelProps) {
  const { questDefinition, stageId, onNavigateToTarget } = props;
  const stageDefinition =
    questDefinition && stageId
      ? questDefinition.stageDefinitions.find((stage) => stage.stageId === stageId) ?? null
      : null;

  if (!questDefinition && !stageDefinition) {
    return null;
  }

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
        Driven By
      </Text>
      <Group gap="xs">
        {questDefinition && (
          <Badge size="xs" variant="light">
            {questDefinition.displayName}
          </Badge>
        )}
        {stageDefinition && (
          <Badge size="xs" variant="light" color="blue">
            {stageDefinition.displayName}
          </Badge>
        )}
      </Group>
      <Button
        size="xs"
        variant="subtle"
        disabled={!questDefinition}
        onClick={() => {
          if (!questDefinition) {
            return;
          }
          onNavigateToTarget?.({
            kind: "quest-stage",
            questDefinitionId: questDefinition.definitionId,
            stageId
          });
        }}
      >
        Open Linked Quest
      </Button>
    </Stack>
  );
}
