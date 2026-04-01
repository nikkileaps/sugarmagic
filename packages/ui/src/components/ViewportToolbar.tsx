/**
 * ViewportToolbar: HUD overlay for switching transform tools.
 *
 * Positioned at top-left of the viewport. Shows move/rotate/scale
 * buttons with Blender-convention keyboard hints (G/R/S).
 */

import { Group, UnstyledButton, Text, Tooltip } from "@mantine/core";

export interface ViewportToolbarItem {
  id: string;
  label: string;
  icon: string;
  shortcut: string;
}

export interface ViewportToolbarProps {
  items: ViewportToolbarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ViewportToolbar({ items, activeId, onSelect }: ViewportToolbarProps) {
  return (
    <Group
      gap={2}
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 10,
        background: "var(--sm-hud-bg)",
        borderRadius: "var(--sm-radius-md)",
        border: "1px solid var(--sm-panel-border)",
        padding: 4
      }}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <Tooltip key={item.id} label={`${item.label} (${item.shortcut})`} position="bottom" openDelay={400}>
            <UnstyledButton
              onClick={() => onSelect(item.id)}
              styles={{
                root: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: "var(--sm-radius-sm)",
                  fontSize: 16,
                  color: isActive ? "var(--sm-accent-mauve)" : "var(--sm-color-overlay2)",
                  background: isActive ? "var(--sm-active-mauve-bg)" : "transparent",
                  transition: "var(--sm-transition-fast)",
                  "&:hover": {
                    background: isActive ? "var(--sm-active-mauve-bg-hover)" : "var(--sm-hover-bg)",
                    color: isActive ? "var(--sm-accent-mauve)" : "var(--sm-color-subtext)"
                  }
                }
              }}
            >
              <Text component="span" size="md">{item.icon}</Text>
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Group>
  );
}
