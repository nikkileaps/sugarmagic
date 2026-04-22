/**
 * Surface-slot editor for imported mesh assets.
 *
 * Blender/glTF remains the source of truth for which slots exist. This editor
 * only lets authors choose the Surface content for each authored slot; it does
 * not create or delete slots inside Sugarmagic.
 */

import { useMemo, useState } from "react";
import { ColorSwatch, Group, Popover, Stack, Text } from "@mantine/core";
import type { AssetSurfaceSlot, MaterialDefinition, Surface as DomainSurface } from "@sugarmagic/domain";
import { createColorSurface, createMaterialSurface } from "@sugarmagic/domain";
import { SurfacePicker, type Surface as PickerSurface } from "@sugarmagic/ui";

function looksLikeDefaultBlenderSlotName(slotName: string): boolean {
  return /^Material(?:[ .]\d+)?$/u.test(slotName);
}

function toPickerSurface(surface: DomainSurface | null): PickerSurface | null {
  if (!surface) {
    return null;
  }
  if (surface.kind === "color") {
    return { kind: "color", value: surface.color };
  }
  if (surface.kind === "material") {
    return { kind: "material", materialDefinitionId: surface.materialDefinitionId };
  }
  return null;
}

function fromPickerSurface(surface: PickerSurface | null): DomainSurface | null {
  if (!surface) {
    return null;
  }
  return surface.kind === "color"
    ? createColorSurface(surface.value)
    : surface.materialDefinitionId
      ? createMaterialSurface(surface.materialDefinitionId)
      : null;
}

function describeSurface(
  surface: DomainSurface | null,
  materialDefinitions: MaterialDefinition[]
): string {
  if (!surface) {
    return "No Surface";
  }
  if (surface.kind === "color") {
    return `Color ${`#${surface.color.toString(16).padStart(6, "0")}`}`;
  }
  if (surface.kind === "material") {
    return (
      materialDefinitions.find(
        (material) => material.definitionId === surface.materialDefinitionId
      )?.displayName ?? "Missing Material"
    );
  }
  if (surface.kind === "texture") {
    return "Texture";
  }
  return "Shader";
}

function previewColor(surface: DomainSurface | null): string {
  if (!surface) {
    return "#5c6370";
  }
  if (surface.kind === "color") {
    return `#${surface.color.toString(16).padStart(6, "0")}`;
  }
  if (surface.kind === "material") {
    return "#89b4fa";
  }
  if (surface.kind === "texture") {
    return "#a6e3a1";
  }
  return "#f9e2af";
}

export interface MaterialSlotBindingsEditorProps {
  bindings: AssetSurfaceSlot[];
  materialDefinitions: MaterialDefinition[];
  onChangeBinding: (
    slotName: string,
    slotIndex: number,
    surface: DomainSurface | null
  ) => void;
}

export function MaterialSlotBindingsEditor({
  bindings,
  materialDefinitions,
  onChangeBinding
}: MaterialSlotBindingsEditorProps) {
  const [openSlotKey, setOpenSlotKey] = useState<string | null>(null);
  const materialOptions = useMemo(
    () =>
      materialDefinitions.map((material) => ({
        value: material.definitionId,
        label: material.displayName
      })),
    [materialDefinitions]
  );
  const colorSwatches = [
    "#7f8ea3",
    "#5c8a5a",
    "#6b5b3a",
    "#8b7355",
    "#556b2f",
    "#2e4d2e",
    "#5c4033",
    "#8fbc8f",
    "#d2b48c",
    "#deb887",
    "#a0522d",
    "#696969"
  ];

  if (bindings.length === 0) {
    return (
      <Text size="xs" c="var(--sm-color-overlay0)">
        This asset does not declare any authored material slots in its source mesh.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {bindings.map((binding) => {
        const slotKey = `${binding.slotIndex}:${binding.slotName}`;
        const pickerValue = toPickerSurface(binding.surface);
        const summary = describeSurface(binding.surface, materialDefinitions);
        const colorSwatch = previewColor(binding.surface);
        return (
          <Stack key={slotKey} gap={4}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Popover
                opened={openSlotKey === slotKey}
                onChange={(opened) => setOpenSlotKey(opened ? slotKey : null)}
                position="bottom-start"
                shadow="md"
                withinPortal={false}
              >
                <Popover.Target>
                  <ColorSwatch
                    color={colorSwatch}
                    size={18}
                    style={{ cursor: "pointer", flexShrink: 0 }}
                    aria-label={`Edit ${binding.slotName} surface`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenSlotKey((current) => (current === slotKey ? null : slotKey));
                    }}
                  />
                </Popover.Target>
                <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
                  <SurfacePicker
                    value={pickerValue}
                    materials={materialOptions}
                    colorSwatches={colorSwatches}
                    onApply={(next) => {
                      onChangeBinding(binding.slotName, binding.slotIndex, fromPickerSurface(next));
                      setOpenSlotKey(null);
                    }}
                    title={`${binding.slotName} surface`}
                    emptyMaterialsHint="Create a material in the Material Library to bind it here."
                  />
                </Popover.Dropdown>
              </Popover>
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                  {binding.slotName}
                </Text>
                <Text size="xs" c="var(--sm-color-text)" truncate>
                  {summary}
                </Text>
              </Stack>
            </Group>
            {looksLikeDefaultBlenderSlotName(binding.slotName) ? (
              <Text size="xs" c="yellow">
                This slot still uses Blender's default material naming. Rename it in
                Blender before relying on reimport-stable bindings.
              </Text>
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}
