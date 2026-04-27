/**
 * Surface-slot editor for imported mesh assets.
 *
 * Blender/glTF remains the source of truth for which slots exist. This editor
 * only lets authors choose the Surface content for each authored slot; it does
 * not create or delete slots inside Sugarmagic.
 */

import { useState } from "react";
import { ColorSwatch, Group, Popover, Stack, Text } from "@mantine/core";
import type {
  AssetSurfaceSlot,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RockTypeDefinition,
  ShaderGraphDocument,
  SurfaceBinding,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import { SurfaceBindingEditor } from "./surfaces";
import { previewColorForBinding } from "./surfaces/utils";

function looksLikeDefaultBlenderSlotName(slotName: string): boolean {
  return /^Material(?:[ .]\d+)?$/u.test(slotName);
}

function describeSurface(
  surface: SurfaceBinding<"universal"> | null,
  surfaceDefinitions: SurfaceDefinition[],
  materialDefinitions: MaterialDefinition[]
): string {
  if (!surface) {
    return "No Surface";
  }
  if (surface.kind === "reference") {
    return (
      surfaceDefinitions.find(
        (definition) => definition.definitionId === surface.surfaceDefinitionId
      )?.displayName ?? "Missing Surface"
    );
  }
  const layerCount = surface.surface.layers.length;
  const baseLayer = surface.surface.layers[0];
  const baseAppearance =
    layerCount === 1 && baseLayer?.kind === "appearance" ? baseLayer : null;
  if (baseAppearance && baseAppearance.content.kind === "material") {
    const materialDefinitionId = baseAppearance.content.materialDefinitionId;
    return (
      materialDefinitions.find(
        (material) => material.definitionId === materialDefinitionId
      )?.displayName ?? "Missing Material"
    );
  }
  return `${layerCount} layer${layerCount === 1 ? "" : "s"}`;
}

export interface MaterialSlotBindingsEditorProps {
  bindings: AssetSurfaceSlot[];
  assetDefinitionId: string;
  surfaceDefinitions: SurfaceDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activeMaskPaintTarget?: PaintedMaskTargetAddress | null;
  onSetMaskPaintTarget?: (target: PaintedMaskTargetAddress | null) => void;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  onChangeBinding: (
    slotName: string,
    slotIndex: number,
    surface: SurfaceBinding<"universal"> | null
  ) => void;
}

export function MaterialSlotBindingsEditor({
  bindings,
  assetDefinitionId,
  surfaceDefinitions,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  activeMaskPaintTarget,
  onSetMaskPaintTarget,
  shaderDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  rockTypeDefinitions,
  onChangeBinding
}: MaterialSlotBindingsEditorProps) {
  const [openSlotKey, setOpenSlotKey] = useState<string | null>(null);

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
        const summary = describeSurface(
          binding.surface,
          surfaceDefinitions,
          materialDefinitions
        );
        const colorSwatch = previewColorForBinding(binding.surface, surfaceDefinitions);
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
                  <SurfaceBindingEditor
                    value={binding.surface}
                    allowedContext="universal"
                    paintOwner={{
                      scope: "asset-slot",
                      assetDefinitionId,
                      slotName: binding.slotName
                    }}
                    surfaceDefinitions={surfaceDefinitions}
                    materialDefinitions={materialDefinitions}
                    textureDefinitions={textureDefinitions}
                    maskTextureDefinitions={maskTextureDefinitions}
                    onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
                    onImportMaskTextureDefinition={onImportMaskTextureDefinition}
                    activeMaskPaintTarget={activeMaskPaintTarget}
                    onSetMaskPaintTarget={onSetMaskPaintTarget}
                    shaderDefinitions={shaderDefinitions}
                    grassTypeDefinitions={grassTypeDefinitions}
                    flowerTypeDefinitions={flowerTypeDefinitions}
                    rockTypeDefinitions={rockTypeDefinitions}
                    onChange={(next) => {
                      onChangeBinding(binding.slotName, binding.slotIndex, next);
                      setOpenSlotKey(null);
                    }}
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
