/**
 * Surface-slot editor for imported mesh assets.
 *
 * Blender/glTF remains the source of truth for which slots exist. This editor
 * only lets authors choose the Surface content for each authored slot; it does
 * not create or delete slots inside Sugarmagic.
 */

import { useState } from "react";
import { Box, ColorSwatch, Group, Popover, Stack, Text } from "@mantine/core";
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
        const colorSwatch = previewColorForBinding(binding.surface, surfaceDefinitions);
        const isOpen = openSlotKey === slotKey;
        return (
          <Stack key={slotKey} gap={4}>
            <Popover
              opened={isOpen}
              onChange={(opened) => setOpenSlotKey(opened ? slotKey : null)}
              position="bottom-start"
              shadow="md"
              withinPortal={false}
            >
              <Popover.Target>
                {/* Whole row is the popover trigger — matches the
                    channel-row affordance from the landscape workspace
                    so authors immediately recognize "click to edit
                    binding" without descriptive text. */}
                <Box
                  onClick={() =>
                    setOpenSlotKey((current) => (current === slotKey ? null : slotKey))
                  }
                  style={{
                    cursor: "pointer",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${
                      isOpen ? "var(--sm-accent-blue)" : "var(--sm-panel-border)"
                    }`,
                    background: isOpen
                      ? "var(--sm-active-bg)"
                      : "var(--sm-color-surface0)"
                  }}
                >
                  <Group gap="sm" wrap="nowrap">
                    <ColorSwatch
                      color={colorSwatch}
                      size={18}
                      style={{ flexShrink: 0 }}
                    />
                    <Text size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
                      {binding.slotName}
                    </Text>
                  </Group>
                </Box>
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
