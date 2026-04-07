import { memo } from "react";
import { Button, Stack, Text } from "@mantine/core";
import type { NPCDefinition, RegionNPCBehaviorDefinition } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import { SelectableListItem } from "./SelectableListItem";

export interface BehaviorListPanelProps {
  regionSelected: boolean;
  behaviors: RegionNPCBehaviorDefinition[];
  npcDefinitions: NPCDefinition[];
  presentNpcDefinitionIds: Set<string>;
  selectedBehaviorId: string | null;
  onCreateBehavior: () => void;
  onSelectBehavior: (behaviorId: string) => void;
}

function BehaviorListPanelComponent(props: BehaviorListPanelProps) {
  const {
    regionSelected,
    behaviors,
    npcDefinitions,
    presentNpcDefinitionIds,
    selectedBehaviorId,
    onCreateBehavior,
    onSelectBehavior
  } = props;

  return (
    <PanelSection title="Behaviors" icon="🎭">
      <Stack gap="xs">
        <Button size="xs" variant="light" onClick={onCreateBehavior} disabled={!regionSelected}>
          + Add Behavior
        </Button>
        {!regionSelected ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a region to author NPC behavior.
          </Text>
        ) : behaviors.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No NPC behaviors yet. Add one to start wiring movement and task-based activity.
          </Text>
        ) : (
          <Stack gap={4}>
            {behaviors.map((behavior) => {
              const isSelected = behavior.behaviorId === selectedBehaviorId;
              const npcLabel =
                npcDefinitions.find(
                  (definition) => definition.definitionId === behavior.npcDefinitionId
                )?.displayName ?? "NPC";
              const npcPresenceMissing = !presentNpcDefinitionIds.has(
                behavior.npcDefinitionId
              );
              return (
                <SelectableListItem
                  key={behavior.behaviorId}
                  icon="👤"
                  title={behavior.displayName}
                  subtitle={
                    npcPresenceMissing ? `${npcLabel} · Missing from scene` : npcLabel
                  }
                  badgeLabel={npcPresenceMissing ? "Missing" : null}
                  badgeColor={npcPresenceMissing ? "yellow" : "gray"}
                  selected={isSelected}
                  onSelect={() => onSelectBehavior(behavior.behaviorId)}
                />
              );
            })}
          </Stack>
        )}
      </Stack>
    </PanelSection>
  );
}

export const BehaviorListPanel = memo(BehaviorListPanelComponent);
