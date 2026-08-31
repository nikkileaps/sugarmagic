/**
 * packages/plugins/src/catalog/sugaragent/ui/RecoveryStrategiesSection.tsx
 *
 * Purpose: Authors what an NPC does when it cannot understand the player.
 *
 * Exports:
 *   - RecoveryStrategiesSection
 *
 * Relationships:
 *   - Contributed to the NPC inspector through the plugin design-section seam,
 *     so it edits the selected NPC without owning NPC state.
 *   - Writes `NPCDefinition.recoveryStrategies`; the conversation runtime reads
 *     the same list off the selection.
 *
 * Status: active
 */

import { ActionIcon, Button, Group, Menu, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { SortableList } from "@sugarmagic/ui";
import {
  RECOVERY_STRATEGIES,
  type NPCDefinition,
  type NPCRecoveryStrategy,
  type RecoveryStrategy
} from "@sugarmagic/domain";

export interface RecoveryStrategiesSectionProps {
  selectedNPC: NPCDefinition | null;
  updateNPC: (definition: NPCDefinition) => void;
}

/**
 * Move `activeId` to where `overId` sits, keeping every other entry in order.
 * Authored order is what the NPC walks, so this is the whole meaning of a drag.
 */
export function reorderStrategies(
  entries: NPCRecoveryStrategy[],
  activeId: string,
  overId: string
): NPCRecoveryStrategy[] {
  const from = entries.findIndex((entry) => entry.strategy === activeId);
  const to = entries.findIndex((entry) => entry.strategy === overId);
  if (from < 0 || to < 0 || from === to) return entries;

  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The strategies still on offer. Each one appears at most once, so a strategy
 * already authored is not offered again.
 */
export function availableStrategies(
  entries: NPCRecoveryStrategy[]
): RecoveryStrategy[] {
  const chosen = new Set(entries.map((entry) => entry.strategy));
  return RECOVERY_STRATEGIES.filter((strategy) => !chosen.has(strategy));
}

export function RecoveryStrategiesSection({
  selectedNPC,
  updateNPC
}: RecoveryStrategiesSectionProps) {
  const [editingStrategy, setEditingStrategy] = useState<string | null>(null);

  if (!selectedNPC) return null;

  const entries = selectedNPC.recoveryStrategies;
  const available = availableStrategies(entries);

  function commit(next: NPCRecoveryStrategy[]): void {
    updateNPC({ ...selectedNPC!, recoveryStrategies: next });
  }

  return (
    <Stack gap="xs">
      <Text size="xs" fw={600}>
        Recovery
      </Text>

      <SortableList
        items={entries.map((entry) => ({
          id: entry.strategy,
          label: entry.strategy
        }))}
        selectedId={editingStrategy}
        onSelect={(id) => setEditingStrategy(id === editingStrategy ? null : id)}
        onReorder={(activeId, overId) =>
          commit(reorderStrategies(entries, activeId, overId))
        }
        onDelete={(id) =>
          commit(entries.filter((entry) => entry.strategy !== id))
        }
        renderActions={(item) => {
          const entry = entries.find((e) => e.strategy === item.id);
          return (
            <Group gap={2} wrap="nowrap">
              <ActionIcon
                size="sm"
                // Filled reads as "this one has a note", so the list says which
                // rows carry prose without opening any of them.
                variant={entry?.note ? "filled" : "subtle"}
                aria-label={`Edit note for ${item.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingStrategy(
                    item.id === editingStrategy ? null : item.id
                  );
                }}
              >
                ✏️
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`Remove ${item.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  commit(entries.filter((e) => e.strategy !== item.id));
                }}
              >
                🗑
              </ActionIcon>
            </Group>
          );
        }}
        renderItem={(item) =>
          item.id === editingStrategy ? (
            <Textarea
              autosize
              minRows={2}
              size="xs"
              placeholder="Why this suits the character, in their terms."
              value={
                entries.find((entry) => entry.strategy === item.id)?.note ?? ""
              }
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                commit(
                  entries.map((entry) =>
                    entry.strategy === item.id
                      ? { ...entry, note: event.currentTarget.value }
                      : entry
                  )
                )
              }
            />
          ) : null
        }
      />

      <Group justify="space-between" align="center">
        <Text size="xs" c="var(--sm-color-overlay0)">
          Tried in order.
        </Text>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button size="xs" variant="light" disabled={available.length === 0}>
              Add strategy
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {available.map((strategy: RecoveryStrategy) => (
              <Menu.Item
                key={strategy}
                onClick={() => {
                  commit([...entries, { strategy, note: "" }]);
                  setEditingStrategy(strategy);
                }}
              >
                {strategy}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Stack>
  );
}
