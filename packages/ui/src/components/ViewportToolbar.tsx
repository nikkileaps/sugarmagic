/**
 * ViewportToolbar: HUD overlay for switching tools.
 *
 * Positioned at top-left of the viewport. Shows radio-style tool buttons
 * with Blender-convention keyboard hints (G/R/S). Optional `toggles`
 * (Plan 069.6) render after a divider as independent on/off switches —
 * e.g. "show colliders" — highlighted while active.
 */

import { Box, Group, UnstyledButton, Text, Tooltip } from "@mantine/core";

export interface ViewportToolbarItem {
  id: string;
  label: string;
  icon: string;
  shortcut: string;
}

/** An independent on/off switch (not part of the radio tool group). */
export interface ViewportToolbarToggle {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  onToggle: () => void;
}

export interface ViewportToolbarProps {
  items: ViewportToolbarItem[];
  activeId: string;
  onSelect: (id: string) => void;
  toggles?: ViewportToolbarToggle[];
}

const buttonStyles = (isActive: boolean) => ({
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
      background: isActive
        ? "var(--sm-active-mauve-bg-hover)"
        : "var(--sm-hover-bg)",
      color: isActive ? "var(--sm-accent-mauve)" : "var(--sm-color-subtext)"
    }
  }
});

export function ViewportToolbar({
  items,
  activeId,
  onSelect,
  toggles
}: ViewportToolbarProps) {
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
            <UnstyledButton onClick={() => onSelect(item.id)} styles={buttonStyles(isActive)}>
              <Text component="span" size="md">{item.icon}</Text>
            </UnstyledButton>
          </Tooltip>
        );
      })}
      {toggles && toggles.length > 0 ? (
        <Box
          style={{
            width: 1,
            alignSelf: "stretch",
            margin: "2px 2px",
            background: "var(--sm-panel-border)"
          }}
        />
      ) : null}
      {(toggles ?? []).map((toggle) => (
        <Tooltip key={toggle.id} label={toggle.label} position="bottom" openDelay={400}>
          <UnstyledButton onClick={toggle.onToggle} styles={buttonStyles(toggle.active)}>
            <Text component="span" size="md">{toggle.icon}</Text>
          </UnstyledButton>
        </Tooltip>
      ))}
    </Group>
  );
}
