/**
 * packages/ui/src/components/ToolViewportChrome.tsx
 *
 * Purpose: the Studio-wide tool-viewport paradigm (Blender/
 * Photoshop convention, adopted 2026-07-09): a VERTICAL tool rail
 * on the viewport's left edge (which tool am I holding — icon
 * buttons, mutually exclusive) and a HORIZONTAL options bar
 * across the top starting at the left corner (the active tool's
 * settings — one row, always the same place, contents swap with
 * the tool). Data panels (bones/pieces/animations lists) stay in
 * properties columns OUTSIDE the viewport; playback stays
 * bottom-center. Every interactive editing viewport composes
 * these two so the muscle memory transfers.
 *
 * Both components are absolutely positioned for a
 * `position: relative` viewport container, with shared offsets so
 * surfaces align identically.
 *
 * Status: active
 */

import type { ReactNode } from "react";
import { ActionIcon, Box, Group, Slider, Stack, Text, Tooltip } from "@mantine/core";

/** Shared chrome offsets — rail sits below the options bar. */
export const TOOL_OPTIONS_BAR_INSET = 10;
export const TOOL_RAIL_TOP = 58;

const CHROME_STYLE = {
  padding: 6,
  borderRadius: 8,
  border: "1px solid var(--sm-panel-border)",
  background: "color-mix(in srgb, var(--sm-viewport-bg) 88%, black 12%)"
} as const;

export interface ToolRailItem {
  id: string;
  /** Icon glyph (emoji or node). */
  icon: ReactNode;
  label: string;
  /** Highlight color when active; defaults to blue. */
  color?: string;
}

/** An independent on/off switch rendered below the radio tools. */
export interface ToolRailToggle {
  id: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  color?: string;
  onToggle: () => void;
}

export interface ToolRailProps {
  tools: ToolRailItem[];
  activeToolId: string;
  onSelect: (toolId: string) => void;
  /** Independent toggles (e.g. "show colliders") after a divider. */
  toggles?: ToolRailToggle[];
}

/** Vertical, icon-only tool column: mutually exclusive tools, then any
 *  independent toggles below a divider. */
export function ToolRail({ tools, activeToolId, onSelect, toggles }: ToolRailProps) {
  return (
    <Stack
      gap={4}
      style={{
        position: "absolute",
        top: TOOL_RAIL_TOP,
        left: TOOL_OPTIONS_BAR_INSET,
        zIndex: 10,
        ...CHROME_STYLE
      }}
    >
      {tools.map((tool) => (
        <Tooltip key={tool.id} label={tool.label} position="right">
          <ActionIcon
            variant={activeToolId === tool.id ? "filled" : "subtle"}
            color={activeToolId === tool.id ? (tool.color ?? "blue") : "gray"}
            onClick={() => onSelect(tool.id)}
            aria-label={tool.label}
          >
            {tool.icon}
          </ActionIcon>
        </Tooltip>
      ))}
      {toggles && toggles.length > 0 ? (
        <Box
          style={{
            height: 1,
            alignSelf: "stretch",
            margin: "2px 4px",
            background: "var(--sm-panel-border)"
          }}
        />
      ) : null}
      {(toggles ?? []).map((toggle) => (
        <Tooltip key={toggle.id} label={toggle.label} position="right">
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
    </Stack>
  );
}

export interface ToolOptionsBarProps {
  /** The ACTIVE tool's settings — one horizontal row. */
  children: ReactNode;
}

/** Horizontal options strip, top-left of the viewport. */
export function ToolOptionsBar({ children }: ToolOptionsBarProps) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      align="center"
      style={{
        position: "absolute",
        top: TOOL_OPTIONS_BAR_INSET,
        left: TOOL_OPTIONS_BAR_INSET,
        zIndex: 10,
        maxWidth: "calc(100% - 120px)",
        overflowX: "auto",
        ...CHROME_STYLE,
        paddingLeft: 10,
        paddingRight: 10
      }}
    >
      {children}
    </Group>
  );
}

export interface ToolOptionSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** Fires once when the drag ends — for expensive commits. */
  onChangeEnd?: (value: number) => void;
  /** Formatted readout; defaults to 2 decimals. */
  format?: (value: number) => string;
  /** Slider track width; the option sizes to content around it. */
  width?: number;
}

/** Compact labeled slider sized for the horizontal options bar. */
export function ToolOptionSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onChangeEnd,
  format,
  width = 72
}: ToolOptionSliderProps) {
  // Content-sized: fixed slider track width, everything else sizes
  // to its text — adjacent options can never overlap (the
  // "0.25Falloff" collision, 2026-07-09).
  return (
    <Group gap={6} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
      <Text size="xs" c="var(--sm-color-subtext)" style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
      <Slider
        size="xs"
        style={{ width }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        label={null}
      />
      <Text
        size="xs"
        c="var(--sm-color-overlay0)"
        style={{ whiteSpace: "nowrap", minWidth: 34, textAlign: "right" }}
      >
        {format ? format(value) : value.toFixed(2)}
      </Text>
    </Group>
  );
}
