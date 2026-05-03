/**
 * Reusable flat list for workspace left panels.
 *
 * This intentionally small component standardizes the common "PanelSection
 * with search, selectable rows, add action, and optional context actions" UX.
 * It does not own workspace state, command dispatch, tree semantics, drag/drop,
 * or inspector behavior.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
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
            const row = (
              <UnstyledButton
                onClick={() => onSelect(id, item)}
                onContextMenu={(event) => {
                  if (contextActions.length === 0) {
                    return;
                  }
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
                    width: "100%"
                  }
                }}
              >
                <Text size="xs" fw={isSelected ? 600 : 500}>
                  {getLabel(item)}
                </Text>
                {description ? (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {description}
                  </Text>
                ) : null}
              </UnstyledButton>
            );

            if (contextActions.length === 0) {
              return <div key={id}>{row}</div>;
            }

            return (
              <Menu
                key={id}
                opened={contextMenuItemId === id}
                onChange={(opened) => setContextMenuItemId(opened ? id : null)}
                withinPortal
              >
                <Menu.Target>{row}</Menu.Target>
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
