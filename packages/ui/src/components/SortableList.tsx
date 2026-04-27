/**
 * SortableList
 *
 * Generic editor list primitive for ordered items that can be selected,
 * toggled, reordered, duplicated, or deleted. It stays domain-agnostic:
 * callers provide ids, enabled state, labels, row rendering, and the
 * reorder policy for their own domain.
 */

import {
  ActionIcon,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton
} from "@mantine/core";
import { useEffect, useState } from "react";
import type { DragEvent, ReactNode } from "react";

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
  onReorder: (activeId: string, overId: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  canReorderItem?: (item: T, index: number) => boolean;
  canDeleteItem?: (item: T, index: number) => boolean;
  canDuplicateItem?: (item: T, index: number) => boolean;
  canToggleItem?: (item: T, index: number) => boolean;
  renderLeading?: (item: T, index: number) => ReactNode;
  renderLabel?: (item: T, index: number) => ReactNode;
  renderItem?: (item: T, index: number) => ReactNode;
}

export function SortableList<T extends SortableListItem>({
  items,
  selectedId,
  onSelect,
  onReorder,
  onDelete,
  onDuplicate,
  onToggle,
  canReorderItem,
  canDeleteItem,
  canDuplicateItem,
  canToggleItem,
  renderLeading,
  renderLabel,
  renderItem
}: SortableListProps<T>) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    itemId: string;
    x: number;
    y: number;
  } | null>(null);

  function handleDragStart(event: DragEvent<HTMLButtonElement>, id: string): void {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggedId(id);
    setDragOverId(null);
  }

  function clearDragState(): void {
    setDraggedId(null);
    setDragOverId(null);
  }

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handlePointerDown(): void {
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  return (
    <Stack gap={6} pos="relative">
      {items.map((item, index) => {
        const isSelected = item.id === selectedId;
        const enabled = item.enabled ?? true;
        const canReorder = canReorderItem?.(item, index) ?? true;
        const isDragged = draggedId === item.id;
        const isDragOver = dragOverId === item.id && draggedId !== item.id;

        return (
          <Paper
            key={item.id}
            p="xs"
            radius="sm"
            withBorder
            onClick={() => onSelect(item.id)}
            onContextMenu={(event) => {
              const hasActions = onToggle || onDuplicate || onDelete;
              if (!hasActions) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onSelect(item.id);
              setContextMenu({
                itemId: item.id,
                x: event.clientX,
                y: event.clientY
              });
            }}
            onDragOver={(event) => {
              if (!draggedId || !canReorder) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverId(item.id);
            }}
            onDragLeave={() => {
              if (dragOverId === item.id) {
                setDragOverId(null);
              }
            }}
            onDrop={(event) => {
              if (!draggedId || !canReorder || draggedId === item.id) {
                clearDragState();
                return;
              }
              event.preventDefault();
              onReorder(draggedId, item.id);
              clearDragState();
            }}
            style={{
              cursor: "pointer",
              borderColor: isSelected
                ? "var(--sm-accent-blue)"
                : isDragOver
                  ? "var(--sm-accent-green, var(--sm-accent-blue))"
                  : "var(--sm-panel-border)",
              background: isSelected
                ? "var(--sm-active-bg)"
                : "var(--sm-color-surface0)",
              opacity: isDragged ? 0.55 : 1
            }}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
                {renderLeading ? renderLeading(item, index) : null}
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  {renderLabel ? (
                    renderLabel(item, index)
                  ) : (
                    <Text
                      size="xs"
                      fw={600}
                      c={enabled ? "var(--sm-color-text)" : "var(--sm-color-overlay0)"}
                      truncate
                    >
                      {item.label}
                    </Text>
                  )}
                  {item.description ? (
                    <Text size="xs" c="var(--sm-color-overlay0)" truncate>
                      {item.description}
                    </Text>
                  ) : null}
                  {renderItem ? renderItem(item, index) : null}
                </Stack>
              </Group>
              <Group gap={4} wrap="nowrap">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  disabled={!canReorder}
                  aria-label="Drag to reorder item"
                  draggable={canReorder}
                  onDragStart={(event) => handleDragStart(event, item.id)}
                  onDragEnd={clearDragState}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    cursor: canReorder ? "grab" : "not-allowed"
                  }}
                >
                  ⋮⋮
                </ActionIcon>
              </Group>
            </Group>
          </Paper>
        );
      })}
      {contextMenu ? (
        (() => {
          const itemIndex = items.findIndex((item) => item.id === contextMenu.itemId);
          const item = itemIndex >= 0 ? items[itemIndex] : null;
          if (!item) {
            return null;
          }
          const enabled = item.enabled ?? true;
          const canDelete = canDeleteItem?.(item, itemIndex) ?? true;
          const canDuplicate = canDuplicateItem?.(item, itemIndex) ?? true;
          const canToggle = canToggleItem?.(item, itemIndex) ?? true;

          return (
            <Paper
              withBorder
              shadow="md"
              radius="sm"
              p={4}
              style={{
                position: "fixed",
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 1000,
                minWidth: 140
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Stack gap={2}>
                {onToggle ? (
                  <UnstyledButton
                    disabled={!canToggle}
                    onClick={() => {
                      if (!canToggle) {
                        return;
                      }
                      onToggle(item.id, !enabled);
                      setContextMenu(null);
                    }}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "var(--sm-radius-sm)",
                      color: canToggle
                        ? "var(--sm-color-text)"
                        : "var(--sm-color-overlay0)",
                      cursor: canToggle ? "pointer" : "not-allowed"
                    }}
                  >
                    <Text size="xs">{enabled ? "Hide" : "Show"}</Text>
                  </UnstyledButton>
                ) : null}
                {onDuplicate ? (
                  <UnstyledButton
                    disabled={!canDuplicate}
                    onClick={() => {
                      if (!canDuplicate) {
                        return;
                      }
                      onDuplicate(item.id);
                      setContextMenu(null);
                    }}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "var(--sm-radius-sm)",
                      color: canDuplicate
                        ? "var(--sm-color-text)"
                        : "var(--sm-color-overlay0)",
                      cursor: canDuplicate ? "pointer" : "not-allowed"
                    }}
                  >
                    <Text size="xs">Copy</Text>
                  </UnstyledButton>
                ) : null}
                {onDelete ? (
                  <UnstyledButton
                    disabled={!canDelete}
                    onClick={() => {
                      if (!canDelete) {
                        return;
                      }
                      onDelete(item.id);
                      setContextMenu(null);
                    }}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "var(--sm-radius-sm)",
                      color: canDelete ? "var(--sm-red)" : "var(--sm-color-overlay0)",
                      cursor: canDelete ? "pointer" : "not-allowed"
                    }}
                  >
                    <Text size="xs">Delete</Text>
                  </UnstyledButton>
                ) : null}
              </Stack>
            </Paper>
          );
        })()
      ) : null}
    </Stack>
  );
}
