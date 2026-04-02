/**
 * Inspector: right-panel container for inspecting the active selection.
 *
 * Shows contextual property editors based on what is selected.
 * Pure presentation — does not own selection or canonical state.
 */

import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

export interface InspectorProps {
  selectionLabel: string | null;
  selectionIcon?: string;
  children?: ReactNode;
}

export function Inspector({
  selectionLabel,
  selectionIcon = "📦",
  children
}: InspectorProps) {
  return (
    <Stack gap={0} h="100%">
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

      {selectionLabel ? (
        <Stack gap={0}>
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
          <Stack gap={0} p="md">
            {children}
          </Stack>
        </Stack>
      ) : (
        <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
          Nothing selected.
        </Text>
      )}
    </Stack>
  );
}
