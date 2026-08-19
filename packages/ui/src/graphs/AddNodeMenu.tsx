/**
 * packages/ui/src/graphs/AddNodeMenu.tsx
 *
 * Purpose: the "+" control that opens the Add Node Menu, used by every graph
 * editor. Composes Mantine's Menu so the trigger and styling are decided once;
 * each editor passes its own node kinds in.
 *
 * Status: active
 */

import { ActionIcon, Menu, Text, Tooltip } from "@mantine/core";

export interface AddNodeMenuItem {
  id: string;
  label: string;
  /** Optional second line, for when a label alone is not self-explanatory. */
  description?: string;
}

export interface AddNodeMenuProps {
  items: AddNodeMenuItem[];
  onSelect: (itemId: string) => void;
  disabled?: boolean;
  /** Shown on the trigger; defaults to "Add Node". */
  label?: string;
}

export function AddNodeMenu({
  items,
  onSelect,
  disabled = false,
  label = "Add Node"
}: AddNodeMenuProps) {
  return (
    <Menu withinPortal position="bottom-start" shadow="md" width={240}>
      <Menu.Target>
        <Tooltip label={label} position="right">
          <ActionIcon
            size="lg"
            radius="md"
            variant="filled"
            color="blue"
            disabled={disabled}
            aria-label={label}
          >
            +
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        {items.map((item) => (
          <Menu.Item key={item.id} onClick={() => onSelect(item.id)}>
            {item.label}
            {item.description ? (
              <Text size="xs" c="var(--sm-color-subtext)">
                {item.description}
              </Text>
            ) : null}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
