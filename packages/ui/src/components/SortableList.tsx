/**
 * SortableList
 *
 * Generic editor list primitive for ordered items that can be selected,
 * toggled, moved, duplicated, or deleted. It stays domain-agnostic: callers
 * provide ids, enabled state, labels, and row rendering.
 */

import { ActionIcon, Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

export interface SortableListItem {
  id: string;
  label: string;
  enabled?: boolean;
  description?: string | null;
}

export interface SortableListProps<T extends SortableListItem> {
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  renderItem?: (item: T, index: number) => ReactNode;
}

export function SortableList<T extends SortableListItem>({
  items,
  selectedId,
  onSelect,
  onMove,
  onDelete,
  onDuplicate,
  onToggle,
  renderItem
}: SortableListProps<T>) {
  return (
    <Stack gap={6}>
      {items.map((item, index) => {
        const isSelected = item.id === selectedId;
        const canMoveUp = index > 0;
        const canMoveDown = index < items.length - 1;
        const enabled = item.enabled ?? true;

        return (
          <Paper
            key={item.id}
            p="xs"
            radius="sm"
            withBorder
            onClick={() => onSelect(item.id)}
            style={{
              cursor: "pointer",
              borderColor: isSelected
                ? "var(--sm-accent-blue)"
                : "var(--sm-panel-border)",
              background: isSelected
                ? "var(--sm-active-bg)"
                : "var(--sm-color-surface0)"
            }}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text
                  size="xs"
                  fw={600}
                  c={enabled ? "var(--sm-color-text)" : "var(--sm-color-overlay0)"}
                  truncate
                >
                  {item.label}
                </Text>
                {item.description ? (
                  <Text size="xs" c="var(--sm-color-overlay0)" truncate>
                    {item.description}
                  </Text>
                ) : null}
                {renderItem ? renderItem(item, index) : null}
              </Stack>
              <Group gap={4} wrap="nowrap">
                {onToggle ? (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color={enabled ? "green" : "gray"}
                    aria-label={enabled ? "Disable item" : "Enable item"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(item.id, !enabled);
                    }}
                  >
                    {enabled ? "◉" : "○"}
                  </ActionIcon>
                ) : null}
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  disabled={!canMoveUp}
                  aria-label="Move item up"
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove(item.id, "up");
                  }}
                >
                  ↑
                </ActionIcon>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  disabled={!canMoveDown}
                  aria-label="Move item down"
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove(item.id, "down");
                  }}
                >
                  ↓
                </ActionIcon>
                {onDuplicate ? (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="Duplicate item"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDuplicate(item.id);
                    }}
                  >
                    ⧉
                  </ActionIcon>
                ) : null}
                {onDelete ? (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    aria-label="Delete item"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(item.id);
                    }}
                  >
                    ×
                  </ActionIcon>
                ) : null}
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
