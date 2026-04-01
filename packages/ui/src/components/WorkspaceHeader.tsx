import { Group, Text } from "@mantine/core";

export interface WorkspaceHeaderProps {
  icon: string;
  label: string;
  subtitle?: string;
}

export function WorkspaceHeader({ icon, label, subtitle }: WorkspaceHeaderProps) {
  return (
    <Group
      gap="sm"
      px="md"
      h={32}
      align="center"
      wrap="nowrap"
      styles={{
        root: {
          background: "var(--sm-workspace-header-bg)",
          borderBottom: "1px solid var(--sm-panel-border)"
        }
      }}
    >
      <Text component="span" size="sm">
        {icon}
      </Text>
      <Text
        size="sm"
        fw={500}
        styles={{ root: { color: "var(--sm-color-text)" } }}
        truncate
      >
        {label}
      </Text>
      {subtitle && (
        <Text
          size="xs"
          styles={{ root: { color: "var(--sm-color-overlay0)" } }}
          truncate
        >
          {subtitle}
        </Text>
      )}
    </Group>
  );
}
