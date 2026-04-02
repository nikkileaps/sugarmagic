/**
 * ActionStripe: upper-right global action surface.
 *
 * Home for global studio actions like Preview that sit above
 * any individual ProductMode. Not a navigation system.
 */

import { Group, UnstyledButton, Text } from "@mantine/core";

export interface ActionStripeProps {
  isPreviewRunning: boolean;
  onStartPreview: () => void;
  onStopPreview: () => void;
  previewDisabled?: boolean;
}

export function ActionStripe({
  isPreviewRunning,
  onStartPreview,
  onStopPreview,
  previewDisabled
}: ActionStripeProps) {
  return (
    <Group gap="sm" align="center" ml="auto">
      {isPreviewRunning ? (
        <UnstyledButton
          onClick={onStopPreview}
          px="md"
          py={4}
          styles={{
            root: {
              fontSize: "var(--sm-font-size-lg)",
              color: "var(--sm-accent-red)",
              background: "color-mix(in srgb, var(--sm-accent-red) 12%, transparent)",
              borderRadius: "var(--sm-radius-sm)",
              "&:hover": {
                background: "color-mix(in srgb, var(--sm-accent-red) 18%, transparent)"
              }
            }
          }}
        >
          <Text component="span" size="sm" mr={6}>⏹</Text>
          Stop Preview
        </UnstyledButton>
      ) : (
        <UnstyledButton
          onClick={onStartPreview}
          disabled={previewDisabled}
          px="md"
          py={4}
          styles={{
            root: {
              fontSize: "var(--sm-font-size-lg)",
              color: previewDisabled
                ? "var(--sm-color-overlay0)"
                : "var(--sm-accent-green)",
              background: previewDisabled
                ? "transparent"
                : "var(--sm-action-green-bg)",
              borderRadius: "var(--sm-radius-sm)",
              cursor: previewDisabled ? "not-allowed" : "pointer",
              "&:hover": previewDisabled
                ? {}
                : { background: "var(--sm-action-green-bg-hover)" }
            }
          }}
        >
          <Text component="span" size="sm" mr={6}>▶</Text>
          Preview
        </UnstyledButton>
      )}
    </Group>
  );
}
