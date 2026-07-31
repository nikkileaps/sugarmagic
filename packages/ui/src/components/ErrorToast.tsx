/**
 * packages/ui/src/components/ErrorToast.tsx
 *
 * A loud, red, DISMISSIBLE error toast for operations that failed in a way the
 * author has to know about -- a build that could not reach its gateway, a pass
 * that produced nothing.
 *
 * WHY IT DOES NOT AUTO-DISMISS
 *   ProgressToast next door is transient because missing it costs nothing; the
 *   work either finishes or it does not. An error you miss is different: it
 *   becomes an hour of debugging the wrong layer. So this stays until it is
 *   dismissed, and it is `role="alert"` / `aria-live="assertive"` rather than
 *   polite.
 *
 * WHY IT IS NOT FOR PLAYERS
 *   Studio only. A person playing the game does not see build failures -- they
 *   see an error only if the game cannot continue or data would be lost.
 *
 * Purely presentational: the caller owns when it shows and what dismiss does
 * (render it only while a message is set).
 *
 * Status: active
 */

import { ActionIcon, Paper, Text } from "@mantine/core";

export interface ErrorToastProps {
  /** The message to show. Render the toast only while this is set. */
  message: string;
  /** Optional second line -- what to DO about it, when there is a useful answer. */
  detail?: string;
  /** Called when the author dismisses. Omit to render without a dismiss button. */
  onDismiss?: () => void;
}

export function ErrorToast({ message, detail, onDismiss }: ErrorToastProps) {
  return (
    <Paper
      role="alert"
      aria-live="assertive"
      shadow="md"
      radius="md"
      style={{
        position: "fixed",
        // Above ProgressToast's 44, so a failure that lands while something
        // else is still running does not sit underneath it.
        bottom: 88,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 401,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        maxWidth: "min(680px, 90vw)",
        background: "rgba(243, 139, 168, 0.12)",
        border: "1px solid rgba(243, 139, 168, 0.55)"
      }}
    >
      <Text size="xs" c="var(--sm-color-text)" style={{ flex: 1 }}>
        <Text span fw={700} c="rgb(243, 139, 168)">
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
          aria-label="Dismiss error"
          size="sm"
          variant="subtle"
          color="red"
          onClick={onDismiss}
        >
          x
        </ActionIcon>
      ) : null}
    </Paper>
  );
}
