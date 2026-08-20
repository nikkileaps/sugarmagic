/**
 * packages/ui/src/components/WarnToast.tsx
 *
 * A yellow, DISMISSIBLE toast for a request Studio declined, and why -- deleting
 * a node the graph cannot lose, an action not available in the current state.
 *
 * WHY IT IS NOT ErrorToast
 *   Nothing failed. No state is inconsistent and there is nothing to debug: the
 *   editor said no on purpose and is explaining itself. Using the loud red alert
 *   for a routine refusal teaches the author to stop reading red, which is the
 *   one thing ErrorToast cannot afford. So this is quieter, and `role="status"` /
 *   `aria-live="polite"` rather than assertive.
 *
 * WHY IT IS NOT FOR PLAYERS
 *   Studio only, like its siblings.
 *
 * Purely presentational: the caller owns when it shows and what dismiss does
 * (render it only while a message is set).
 *
 * Status: active
 */

import { ActionIcon, Paper, Text } from "@mantine/core";

export interface WarnToastProps {
  /** The message to show. Render the toast only while this is set. */
  message: string;
  /** Optional second line -- what the author can do instead, when there is an answer. */
  detail?: string;
  /** Called when the author dismisses. Omit to render without a dismiss button. */
  onDismiss?: () => void;
}

export function WarnToast({ message, detail, onDismiss }: WarnToastProps) {
  return (
    <Paper
      role="status"
      aria-live="polite"
      shadow="md"
      radius="md"
      style={{
        position: "fixed",
        // Above ErrorToast's 88, which is above ProgressToast's 44, so all three
        // can be on screen at once without covering each other.
        bottom: 132,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 401,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        maxWidth: "min(680px, 90vw)",
        background: "rgba(249, 226, 175, 0.12)",
        border: "1px solid rgba(249, 226, 175, 0.55)"
      }}
    >
      <Text size="xs" c="var(--sm-color-text)" style={{ flex: 1 }}>
        <Text span fw={700} c="rgb(249, 226, 175)">
          {message}
        </Text>
        {detail ? (
          <>
            <br />
            {detail}
          </>
        ) : null}
      </Text>
      {onDismiss ? (
        <ActionIcon
          aria-label="Dismiss warning"
          size="sm"
          variant="subtle"
          color="yellow"
          onClick={onDismiss}
        >
          x
        </ActionIcon>
      ) : null}
    </Paper>
  );
}
