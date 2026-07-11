/**
 * Reusable flat list for workspace left panels.
 *
 * Standardizes the common "PanelSection with search, selectable rows, add
 * action, and per-item context actions" UX. When `contextActions` is provided,
 * each row gets a visible kebab (vertical ellipsis) button on the right that
 * opens the action menu — discoverable affordance, not hidden behind
 * right-click (right-click still works for power users).
 *
 * Doesn't own workspace state, command dispatch, tree semantics, drag/drop,
 * or inspector behavior.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import { PanelSection } from "./PanelSection";

export interface PanelSectionListContextAction<TItem> {
  label: string;
  color?: string;
  onSelect: (item: TItem) => void;
}

export interface PanelSectionListProps<TItem> {
  title: string;
  icon?: string;
  items: TItem[];
  selectedId: string | null;
  getId: (item: TItem) => string;
  getLabel: (item: TItem) => string;
  getDescription?: (item: TItem) => ReactNode;
  /** Optional small chip rendered next to the label (e.g. "Built-in"). */
  getBadge?: (item: TItem) => string | null;
  onSelect: (id: string, item: TItem) => void;
  searchPlaceholder: string;
  emptyText?: ReactNode;
  noResultsText?: ReactNode;
  createLabel: string;
  onCreate?: () => void;
  contextActions?: Array<PanelSectionListContextAction<TItem>>;
}

export function PanelSectionList<TItem>({
  title,
  icon,
  items,
  selectedId,
  getId,
  getLabel,
  getDescription,
  getBadge,
  onSelect,
  searchPlaceholder,
  emptyText,
  noResultsText,
  createLabel,
  onCreate,
  contextActions = []
}: PanelSectionListProps<TItem>) {
  const [searchValue, setSearchValue] = useState("");
  const [contextMenuItemId, setContextMenuItemId] = useState<string | null>(
    null
  );
  const filteredItems = useMemo(() => {
    const normalized = searchValue.trim().toLowerCase();
    if (!normalized) {
      return items;
    }
    return items.filter((item) =>
      getLabel(item).toLowerCase().includes(normalized)
    );
  }, [getLabel, items, searchValue]);

  return (
    <PanelSection
      title={title}
      icon={icon}
      actions={
        onCreate ? (
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={createLabel}
            onClick={onCreate}
          >
            +
          </ActionIcon>
        ) : null
      }
    >
      <Stack gap="xs">
        <TextInput
          size="xs"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(event) => setSearchValue(event.currentTarget.value)}
        />
        <Stack gap={4}>
          {filteredItems.map((item) => {
            const id = getId(item);
            const isSelected = id === selectedId;
            const description = getDescription?.(item);
            const hasContextActions = contextActions.length > 0;

            const rowBody = (
              <UnstyledButton
                onClick={() => onSelect(id, item)}
                onContextMenu={(event) => {
                  if (!hasContextActions) return;
                  event.preventDefault();
                  onSelect(id, item);
                  setContextMenuItemId(id);
                }}
                styles={{
                  root: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    padding: "6px 8px",
                    borderRadius: "var(--sm-radius-sm)",
                    background: isSelected
                      ? "var(--sm-active-bg)"
                      : "transparent",
                    color: isSelected
                      ? "var(--sm-accent-blue)"
                      : "var(--sm-color-text)",
                    flex: 1,
                    minWidth: 0
                  }
                }}
              >
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0, maxWidth: "100%" }}>
                  <Text size="xs" fw={isSelected ? 600 : 500} truncate>
                    {getLabel(item)}
                  </Text>
                  {getBadge?.(item) ? (
                    <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                      {getBadge(item)}
                    </Badge>
                  ) : null}
                </Group>
                {description ? (
                  <Text size="xs" c="var(--sm-color-overlay0)" truncate>
                    {description}
                  </Text>
                ) : null}
              </UnstyledButton>
            );

            if (!hasContextActions) {
              return <div key={id}>{rowBody}</div>;
            }

            // Row + kebab side-by-side. Kebab is always visible (no
            // hover-only reveal) so the menu is discoverable; click
            // toggles, right-click on the row body also opens (handled
            // by `rowBody` above). The Menu anchors to the kebab so
            // positioning stays consistent regardless of trigger.
            return (
              <Box
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2
                }}
              >
                {rowBody}
                <Menu
                  opened={contextMenuItemId === id}
                  onChange={(opened) =>
                    setContextMenuItemId(opened ? id : null)
                  }
                  position="bottom-end"
                  withinPortal
                  shadow="md"
                >
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label="Item actions"
                      onClick={(event) => {
                        event.stopPropagation();
                        setContextMenuItemId(
                          contextMenuItemId === id ? null : id
                        );
                      }}
                    >
                      <Text size="sm" lh={1}>
                        {"⋮"}
                      </Text>
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {contextActions.map((action) => (
                      <Menu.Item
                        key={action.label}
                        color={action.color}
                        onClick={() => action.onSelect(item)}
                      >
                        {action.label}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              </Box>
            );
          })}
          {items.length === 0 && emptyText ? (
            <Text size="xs" c="var(--sm-color-overlay0)" ta="center" mt="md">
              {emptyText}
            </Text>
          ) : null}
          {items.length > 0 && filteredItems.length === 0 && noResultsText ? (
            <Text size="xs" c="var(--sm-color-overlay0)" ta="center" mt="md">
              {noResultsText}
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </PanelSection>
  );
}
