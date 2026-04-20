/**
 * MaterialSlotBindingsEditor
 *
 * Editor-facing material-slot binding list for imported GLB assets. Blender is
 * the source of truth for which slots exist; this component only binds those
 * authored slots to project materials and surfaces slot-name guidance.
 */

import { Stack, Text } from "@mantine/core";
import type { MaterialDefinition, MaterialSlotBinding } from "@sugarmagic/domain";
import { MaterialDefinitionSelect } from "./MaterialDefinitionSelect";

function looksLikeDefaultBlenderSlotName(slotName: string): boolean {
  return /^Material(?:[ .]\d+)?$/u.test(slotName);
}

export interface MaterialSlotBindingsEditorProps {
  bindings: MaterialSlotBinding[];
  materialDefinitions: MaterialDefinition[];
  onChangeBinding: (
    slotName: string,
    slotIndex: number,
    materialDefinitionId: string | null
  ) => void;
}

export function MaterialSlotBindingsEditor({
  bindings,
  materialDefinitions,
  onChangeBinding
}: MaterialSlotBindingsEditorProps) {
  if (bindings.length === 0) {
    return (
      <Text size="xs" c="var(--sm-color-overlay0)">
        This asset does not declare any authored material slots in its source mesh.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {bindings.map((binding) => (
        <Stack key={`${binding.slotIndex}:${binding.slotName}`} gap={4}>
          <MaterialDefinitionSelect
            label={`${binding.slotName} (slot ${binding.slotIndex + 1})`}
            materials={materialDefinitions}
            value={binding.materialDefinitionId}
            onChange={(materialDefinitionId) =>
              onChangeBinding(binding.slotName, binding.slotIndex, materialDefinitionId)
            }
            description="Matches the material name authored in Blender/glTF."
          />
          {looksLikeDefaultBlenderSlotName(binding.slotName) ? (
            <Text size="xs" c="yellow">
              This slot still uses Blender's default material naming. Rename it in
              Blender before relying on reimport-stable bindings.
            </Text>
          ) : null}
        </Stack>
      ))}
    </Stack>
  );
}
