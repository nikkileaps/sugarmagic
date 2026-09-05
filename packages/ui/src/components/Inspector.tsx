/**
 * Inspector: right-panel container for inspecting the active selection.
 *
 * Shows contextual property editors based on what is selected.
 * Pure presentation — does not own selection or canonical state.
 */

import { Box, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

export interface InspectorProps {
  /** What the header calls the selection. Shown to the author, nothing more. */
  selectionLabel: string | null;
  /**
   * Whether anything is selected.
   *
   * Answer this from the selection itself -- the ids -- never from whether a
   * name came back. A selected thing with a blank name is still selected, and
   * a panel that reads a label to decide shows "Nothing selected" while the
   * gizmo sits on the object.
   *
   * Omitted falls back to "there is a label", which is what every caller meant
   * before this was a separate question.
   */
  hasSelection?: boolean;
  selectionIcon?: string;
  children?: ReactNode;
}

/**
 * Whether the Inspector has something to show.
 *
 * Selection is a list of ids, so a caller that has one answers from its
 * length. A caller that shows one fixed thing has no selection to report and
 * falls back to whether it named something.
 */
export function inspectorShowsSelection(
  hasSelection: boolean | undefined,
  selectionLabel: string | null
): boolean {
  return hasSelection ?? selectionLabel !== null;
}

export function Inspector({
  selectionLabel,
  hasSelection,
  selectionIcon = "📦",
  children
}: InspectorProps) {
  const showing = inspectorShowsSelection(hasSelection, selectionLabel);
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Text
        size="xs"
        fw={600}
        tt="uppercase"
        c="var(--sm-color-subtext)"
        px="md"
        py="sm"
        styles={{
          root: {
            borderBottom: "1px solid var(--sm-panel-border)"
          }
        }}
      >
        Inspector
      </Text>

      {showing ? (
        <Stack gap={0} style={{ minHeight: 0, flex: 1 }}>
          <Text
            size="xs"
            c="var(--sm-accent-blue)"
            fw={500}
            px="md"
            py="xs"
            styles={{
              root: {
                borderBottom: "1px solid var(--sm-panel-border)",
                background: "var(--sm-active-bg)"
              }
            }}
          >
            {selectionIcon} {selectionLabel}
          </Text>
          <Box
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              scrollbarGutter: "stable"
            }}
          >
            <Stack
              gap={0}
              p="md"
              style={{
                paddingRight: "calc(var(--mantine-spacing-md) + 8px)"
              }}
            >
              {children}
            </Stack>
          </Box>
        </Stack>
      ) : (
        <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
          Nothing selected.
        </Text>
      )}
    </Stack>
  );
}
