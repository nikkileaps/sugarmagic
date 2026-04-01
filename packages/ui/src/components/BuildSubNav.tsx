import { Group, Select, UnstyledButton, Text, type ComboboxItem } from "@mantine/core";

export interface BuildWorkspaceKindItem {
  id: string;
  label: string;
  icon: string;
}

export interface BuildSubNavProps {
  workspaceKinds: BuildWorkspaceKindItem[];
  activeKindId: string;
  onSelectKind: (id: string) => void;
  regions: { id: string; displayName: string }[];
  activeRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onCreateRegion: () => void;
}

export function BuildSubNav({
  workspaceKinds,
  activeKindId,
  onSelectKind,
  regions,
  activeRegionId,
  onSelectRegion,
  onCreateRegion
}: BuildSubNavProps) {
  const CREATE_VALUE = "__create_new_region__";
  const regionData: ComboboxItem[] = [
    ...regions.map((r) => ({ value: r.id, label: r.displayName })),
    { value: CREATE_VALUE, label: "+ New Region" }
  ];

  return (
    <Group
      h={32}
      px="md"
      gap="md"
      align="center"
      wrap="nowrap"
      styles={{
        root: {
          background: "var(--sm-color-surface0)",
          borderBottom: "1px solid var(--sm-panel-border)"
        }
      }}
    >
      <Select
        data={regionData}
        value={activeRegionId}
        onChange={(val) => {
          if (val === CREATE_VALUE) { onCreateRegion(); return; }
          if (val) onSelectRegion(val);
        }}
        size="xs"
        w={180}
        placeholder="Select region..."
        styles={{
          input: {
            background: "var(--sm-color-mantle)",
            borderColor: "var(--sm-panel-border)",
            color: "var(--sm-color-text)",
            fontSize: "var(--sm-font-size-sm)"
          },
          dropdown: {
            background: "var(--sm-color-surface1)",
            borderColor: "var(--sm-panel-border)"
          },
          option: {
            fontSize: "var(--sm-font-size-sm)",
            color: "var(--sm-color-text)",
            "&[data-selected]": {
              background: "var(--sm-active-bg)"
            }
          }
        }}
      />

      <Group gap={4} align="center" wrap="nowrap">
        {workspaceKinds.map((kind) => {
          const isActive = kind.id === activeKindId;
          return (
            <UnstyledButton
              key={kind.id}
              onClick={() => onSelectKind(kind.id)}
              px="sm"
              py={4}
              styles={{
                root: {
                  fontSize: "var(--sm-font-size-sm)",
                  borderRadius: "var(--sm-radius-sm)",
                  color: isActive
                    ? "var(--sm-accent-blue)"
                    : "var(--sm-color-overlay2)",
                  background: isActive
                    ? "var(--sm-active-bg)"
                    : "transparent",
                  transition: "var(--sm-transition-fast)",
                  "&:hover": {
                    background: isActive
                      ? "var(--sm-active-bg-hover)"
                      : "var(--sm-hover-bg)"
                  }
                }
              }}
            >
              <Text component="span" size="xs" mr={4}>
                {kind.icon}
              </Text>
              {kind.label}
            </UnstyledButton>
          );
        })}
      </Group>
    </Group>
  );
}
