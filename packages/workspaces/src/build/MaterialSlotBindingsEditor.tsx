/**
 * Surface-slot editor for imported mesh assets.
 *
 * Blender/glTF remains the source of truth for which slots exist. This editor
 * only lets authors choose the Surface content for each authored slot; it does
 * not create or delete slots inside Sugarmagic.
 */

import { useState, type ReactNode } from "react";
import { Box, ColorSwatch, Group, Popover, Stack, Text } from "@mantine/core";
import type { AssetSurfaceSlot, SurfaceBinding } from "@sugarmagic/domain";
import { SurfaceBindingEditor, useSurfaceAuthoring } from "./surfaces";
import { previewColorForBinding } from "./surfaces/utils";

function looksLikeDefaultBlenderSlotName(slotName: string): boolean {
  return /^Material(?:[ .]\d+)?$/u.test(slotName);
}

export interface MaterialSlotBindingsEditorProps {
  bindings: AssetSurfaceSlot[];
  assetDefinitionId: string;
  onChangeBinding: (
    slotName: string,
    slotIndex: number,
    surface: SurfaceBinding<"universal"> | null
  ) => void;
  /** Optional chip rendered after the slot name (Plan 068.3: the
   *  Layout inspector shows per-slot provenance). */
  renderSlotBadge?: (slotName: string) => ReactNode;
}

export function MaterialSlotBindingsEditor({
  bindings,
  assetDefinitionId,
  onChangeBinding,
  renderSlotBadge
}: MaterialSlotBindingsEditorProps) {
  const { surfaceDefinitions } = useSurfaceAuthoring();
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
              // Portal: this editor renders inside overflow
              // containers now (Layout inspector aside) -- a
              // non-portal dropdown clips (the options-bar lesson).
              withinPortal
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
                    {renderSlotBadge?.(binding.slotName)}
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
