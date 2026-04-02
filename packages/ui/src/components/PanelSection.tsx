import { Box, Group, Text, UnstyledButton, Collapse } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { ReactNode } from "react";

export interface PanelSectionProps {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export function PanelSection({
  title,
  icon,
  defaultOpen = true,
  actions,
  children
}: PanelSectionProps) {
  const [opened, { toggle }] = useDisclosure(defaultOpen);

  return (
    <Box>
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sm-space-xs)",
          flexWrap: "nowrap",
          padding: "var(--sm-space-sm) var(--sm-space-md)",
          color: "var(--sm-color-subtext)",
          borderBottom: "1px solid var(--sm-panel-border)",
          transition: "var(--sm-transition-fast)"
        }}
      >
        <UnstyledButton
          onClick={toggle}
          styles={{
            root: {
              display: "flex",
              alignItems: "center",
              gap: "var(--sm-space-xs)",
              flex: 1,
              minWidth: 0,
              overflow: "hidden"
            }
          }}
        >
          <Text
            component="span"
            size="xs"
            styles={{
              root: {
                color: "var(--sm-color-overlay0)",
                transition: "var(--sm-transition-fast)",
                transform: opened ? "rotate(90deg)" : "rotate(0deg)"
              }
            }}
          >
            ▸
          </Text>
          {icon && (
            <Text component="span" size="xs">
              {icon}
            </Text>
          )}
          <Text
            component="span"
            size="xs"
            fw={600}
            tt="uppercase"
            style={{
              color: "var(--sm-color-subtext)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {title}
          </Text>
        </UnstyledButton>
        {actions && (
          <Group gap={4} ml="auto">
            {actions}
          </Group>
        )}
      </Box>
      <Collapse expanded={opened}>
        <Box p="sm">{children}</Box>
      </Collapse>
    </Box>
  );
}
