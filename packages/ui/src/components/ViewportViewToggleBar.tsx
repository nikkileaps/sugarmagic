/**
 * ViewportViewToggleBar (Plan 069.6).
 *
 * A horizontal strip of view affordances at the viewport's TOP-RIGHT, seated
 * just LEFT of the orientation gizmo (Blender's nav-cluster corner). Holds
 * independent on/off view toggles — "show colliders" now, "show navmesh"
 * (069.8) next — distinct from the left tool rail (which picks the active
 * editing tool). Grey when off, filled when on.
 */

import type { ReactNode } from "react";
import { ActionIcon, Group, Tooltip } from "@mantine/core";

export interface ViewportViewToggle {
  id: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  color?: string;
  onToggle: () => void;
}

export interface ViewportViewToggleBarProps {
  toggles: ViewportViewToggle[];
}

// The orientation gizmo is 96px wide at right:12 — sit to its left with an
// 8px gap (12 + 96 + 8).
const GIZMO_CLEARANCE = 116;

export function ViewportViewToggleBar({ toggles }: ViewportViewToggleBarProps) {
  if (toggles.length === 0) {
    return null;
  }
  return (
    <Group
      gap={2}
      style={{
        position: "absolute",
        top: 12,
        right: GIZMO_CLEARANCE,
        zIndex: 10,
        padding: 4,
        borderRadius: "var(--sm-radius-md)",
        border: "1px solid var(--sm-panel-border)",
        background: "var(--sm-hud-bg)"
      }}
    >
      {toggles.map((toggle) => (
        <Tooltip key={toggle.id} label={toggle.label} position="bottom" openDelay={400}>
          <ActionIcon
            variant={toggle.active ? "filled" : "subtle"}
            color={toggle.active ? (toggle.color ?? "blue") : "gray"}
            onClick={toggle.onToggle}
            aria-label={toggle.label}
          >
            {toggle.icon}
          </ActionIcon>
        </Tooltip>
      ))}
    </Group>
  );
}
