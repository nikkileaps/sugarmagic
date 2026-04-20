/**
 * MaterialDefinitionSelect
 *
 * Reusable Build-mode field for selecting a project MaterialDefinition by id.
 * Asset slot bindings and landscape channel bindings use the same picker so
 * material-assignment UI stays consistent across authoring surfaces.
 */

import { Select, Stack, Text } from "@mantine/core";
import type { MaterialDefinition } from "@sugarmagic/domain";

export interface MaterialDefinitionSelectProps {
  label: string;
  materials: MaterialDefinition[];
  value: string | null;
  onChange: (materialDefinitionId: string | null) => void;
  description?: string;
  disabled?: boolean;
  noneLabel?: string;
  placeholder?: string;
}

export function MaterialDefinitionSelect({
  label,
  materials,
  value,
  onChange,
  description,
  disabled = false,
  noneLabel = "No Material",
  placeholder = "Select material..."
}: MaterialDefinitionSelectProps) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="var(--sm-color-subtext)">
        {label}
      </Text>
      {description ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          {description}
        </Text>
      ) : null}
      <Select
        size="xs"
        disabled={disabled}
        placeholder={placeholder}
        data={[
          { value: "__none__", label: noneLabel },
          ...materials.map((material) => ({
            value: material.definitionId,
            label: material.displayName
          }))
        ]}
        value={value ?? "__none__"}
        onChange={(next) => onChange(next && next !== "__none__" ? next : null)}
        styles={{
          input: {
            background: "var(--sm-color-base)",
            borderColor: "var(--sm-panel-border)",
            color: "var(--sm-color-text)"
          },
          dropdown: {
            background: "var(--sm-color-surface1)",
            borderColor: "var(--sm-panel-border)"
          },
          option: {
            color: "var(--sm-color-text)"
          }
        }}
      />
    </Stack>
  );
}
