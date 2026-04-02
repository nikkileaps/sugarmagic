import { Group, Select, UnstyledButton, Text, type ComboboxItem } from "@mantine/core";

export interface BuildWorkspaceKindItem {
  id: string;
  label: string;
  icon: string;
}

export interface BuildContextSelector {
  items: { id: string; displayName: string }[];
  activeId: string | null;
  placeholder: string;
  createLabel: string;
  width?: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export interface BuildSubNavProps {
  workspaceKinds: BuildWorkspaceKindItem[];
  activeKindId: string;
  onSelectKind: (id: string) => void;
  contextSelector?: BuildContextSelector | null;
}

export function BuildSubNav({
  workspaceKinds,
  activeKindId,
  onSelectKind,
  contextSelector
}: BuildSubNavProps) {
  const CREATE_VALUE = "__create_context__";
  const contextData: ComboboxItem[] = contextSelector
    ? [
        ...contextSelector.items.map((item) => ({
          value: item.id,
          label: item.displayName
        })),
        { value: CREATE_VALUE, label: contextSelector.createLabel }
      ]
    : [];

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
      {contextSelector ? (
        <Select
          data={contextData}
          value={contextSelector.activeId}
          onChange={(val) => {
            if (val === CREATE_VALUE) {
              contextSelector.onCreate();
              return;
            }
            if (val) contextSelector.onSelect(val);
          }}
          size="xs"
          w={contextSelector.width ?? 200}
          placeholder={contextSelector.placeholder}
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
              color: "var(--sm-color-text)"
            }
          }}
        />
      ) : null}

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
