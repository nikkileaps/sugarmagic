import { Group, UnstyledButton, Text } from "@mantine/core";

export interface ModeBarItem {
  id: string;
  label: string;
  icon: string;
}

export interface ModeBarProps {
  items: ModeBarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ModeBar({ items, activeId, onSelect }: ModeBarProps) {
  return (
    <Group gap="xs" px="md" h={40} align="center" wrap="nowrap">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <UnstyledButton
            key={item.id}
            onClick={() => onSelect(item.id)}
            styles={{
              root: {
                display: "flex",
                alignItems: "center",
                gap: "var(--sm-space-xs)",
                padding: "var(--sm-space-xs) var(--sm-space-md)",
                borderRadius: "var(--sm-radius-md)",
                fontSize: "var(--sm-font-size-md)",
                color: isActive
                  ? "var(--sm-accent-blue)"
                  : "var(--sm-color-overlay2)",
                background: isActive
                  ? "var(--sm-active-bg)"
                  : "transparent",
                transition: "var(--sm-transition-fast)",
                borderBottom: isActive
                  ? "2px solid var(--sm-accent-blue)"
                  : "2px solid transparent",
                "&:hover": {
                  background: isActive
                    ? "var(--sm-active-bg-hover)"
                    : "var(--sm-hover-bg)",
                  color: isActive
                    ? "var(--sm-accent-blue)"
                    : "var(--sm-color-subtext)"
                },
                "&:focus-visible": {
                  outline: "2px solid var(--sm-accent-blue)",
                  outlineOffset: "-2px"
                }
              }
            }}
          >
            <Text component="span" size="md">
              {item.icon}
            </Text>
            <Text component="span" fw={isActive ? 600 : 400} inherit>
              {item.label}
            </Text>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
