import { Box, Text, UnstyledButton, Collapse } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { ReactNode } from "react";

export interface PanelSectionProps {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function PanelSection({
  title,
  icon,
  defaultOpen = true,
  children
}: PanelSectionProps) {
  const [opened, { toggle }] = useDisclosure(defaultOpen);

  return (
    <Box>
      <UnstyledButton
        onClick={toggle}
        w="100%"
        styles={{
          root: {
            display: "flex",
            alignItems: "center",
            gap: "var(--sm-space-xs)",
            padding: "var(--sm-space-xs) var(--sm-space-md)",
            fontSize: "var(--sm-font-size-sm)",
            color: "var(--sm-color-subtext)",
            borderBottom: "1px solid var(--sm-panel-border)",
            transition: "var(--sm-transition-fast)",
            "&:hover": {
              background: "var(--sm-subtle-hover-bg)"
            },
            "&:focus-visible": {
              outline: "2px solid var(--sm-accent-blue)",
              outlineOffset: "-2px"
            }
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
        <Text component="span" size="xs" fw={600} tt="uppercase" inherit>
          {title}
        </Text>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <Box p="sm">{children}</Box>
      </Collapse>
    </Box>
  );
}
