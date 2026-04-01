import { Group, Text } from "@mantine/core";

export interface StatusBarProps {
  message: string;
  severity?: "info" | "warning" | "error";
  trailing?: string;
}

const severityColor: Record<string, string> = {
  info: "var(--sm-color-overlay0)",
  warning: "var(--sm-accent-yellow)",
  error: "var(--sm-accent-red)"
};

export function StatusBar({
  message,
  severity = "info",
  trailing
}: StatusBarProps) {
  return (
    <Group
      px="md"
      h="100%"
      align="center"
      justify="space-between"
      wrap="nowrap"
    >
      <Text
        size="xs"
        styles={{ root: { color: severityColor[severity] } }}
        truncate
      >
        {message}
      </Text>
      {trailing && (
        <Text
          size="xs"
          styles={{ root: { color: "var(--sm-color-overlay0)" } }}
          truncate
        >
          {trailing}
        </Text>
      )}
    </Group>
  );
}
