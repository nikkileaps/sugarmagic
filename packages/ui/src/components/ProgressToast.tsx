/**
 * packages/ui/src/components/ProgressToast.tsx
 *
 * A small transient progress toast: a spinner + message pinned to the
 * bottom-center of the viewport while an async operation runs (baking
 * paint UVs, reloading the scene after surface edits, etc.), so the user
 * knows something is happening and isn't left thinking it's a bug.
 *
 * Purely presentational -- the caller owns when it shows/hides (render it
 * only while a message is set). Positioned fixed; drop it anywhere.
 *
 * Status: active
 */

import { Loader, Paper, Text } from "@mantine/core";

export interface ProgressToastProps {
  /** The message to show. Render the toast only while this is set. */
  message: string;
}

export function ProgressToast({ message }: ProgressToastProps) {
  return (
    <Paper
      role="status"
      aria-live="polite"
      shadow="md"
      radius="md"
      style={{
        position: "fixed",
        bottom: 44,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: "var(--sm-color-surface1)",
        border: "1px solid var(--sm-panel-border)",
        pointerEvents: "none"
      }}
    >
      <Loader size="xs" color="grape" />
      <Text size="xs" c="var(--sm-color-text)">
        {message}
      </Text>
    </Paper>
  );
}
