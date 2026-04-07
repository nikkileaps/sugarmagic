import { memo } from "react";
import { Badge, Group, Stack, Text, UnstyledButton } from "@mantine/core";

export interface SelectableListItemProps {
  icon: string;
  title: string;
  subtitle: string;
  selected: boolean;
  surface?: "transparent" | "surface";
  badgeLabel?: string | null;
  badgeColor?: string;
  onSelect: () => void;
}

const ROOT_STYLE = {
  display: "flex",
  gap: "var(--sm-space-sm)",
  alignItems: "center",
  padding: "8px 10px",
  borderRadius: "var(--sm-radius-sm)"
} as const;

const CONTENT_STYLE = {
  flex: 1,
  minWidth: 0
} as const;

const ROOT_STYLE_TRANSPARENT = {
  root: {
    ...ROOT_STYLE,
    background: "transparent",
    color: "var(--sm-color-text)"
  }
} as const;

const ROOT_STYLE_SURFACE = {
  root: {
    ...ROOT_STYLE,
    background: "var(--sm-color-surface0)",
    color: "var(--sm-color-text)"
  }
} as const;

const ROOT_STYLE_SELECTED = {
  root: {
    ...ROOT_STYLE,
    background: "var(--sm-active-bg)",
    color: "var(--sm-accent-blue)"
  }
} as const;

function SelectableListItemComponent(props: SelectableListItemProps) {
  const {
    icon,
    title,
    subtitle,
    selected,
    surface = "transparent",
    badgeLabel = null,
    badgeColor = "gray",
    onSelect
  } = props;
  const rootStyles =
    selected
      ? ROOT_STYLE_SELECTED
      : surface === "surface"
        ? ROOT_STYLE_SURFACE
        : ROOT_STYLE_TRANSPARENT;

  return (
    <UnstyledButton onClick={onSelect} styles={rootStyles}>
      <Text size="xs">{icon}</Text>
      <Stack gap={0} style={CONTENT_STYLE}>
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" truncate fw={selected ? 600 : 400} style={CONTENT_STYLE}>
            {title}
          </Text>
          {badgeLabel ? (
            <Badge size="xs" variant="light" color={badgeColor}>
              {badgeLabel}
            </Badge>
          ) : null}
        </Group>
        <Text size="xs" c="var(--sm-color-overlay0)" truncate>
          {subtitle}
        </Text>
      </Stack>
    </UnstyledButton>
  );
}

export const SelectableListItem = memo(SelectableListItemComponent);
