/**
 * Layer stack view.
 *
 * Shows one inline surface's ordered layers and a detail editor for the
 * currently selected layer.
 */

import { ActionIcon, Group, Menu, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Layer,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RockTypeDefinition,
  ShaderGraphDocument,
  Surface,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import { SortableList } from "@sugarmagic/ui";
import { LayerMaskPopover } from "./LayerMaskPopover";
import { LayerSettingsPopover } from "./LayerSettingsPopover";
import { cloneLayer, createDefaultLayer } from "./utils";

export interface LayerStackViewProps<C extends SurfaceContext = SurfaceContext> {
  surface: Surface<C>;
  allowedContext: C;
  allowPainted: boolean;
  paintOwner:
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "landscape-channel" }>, "layerId">
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "asset-slot" }>, "layerId">
    | null;
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
  onChangeSurface: (surface: Surface<C>) => void;
}

export function LayerStackView<C extends SurfaceContext = SurfaceContext>({
  surface,
  allowedContext,
  allowPainted,
  paintOwner,
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
  onChangeSurface
}: LayerStackViewProps<C>) {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    surface.layers[0]?.layerId ?? null
  );
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const effectiveSelectedLayerId =
    selectedLayerId &&
    surface.layers.some((layer) => layer.layerId === selectedLayerId)
      ? selectedLayerId
      : surface.layers[0]?.layerId ?? null;

  function commitLayers(nextLayers: Layer[]): void {
    onChangeSurface({
      ...surface,
      layers: nextLayers
    });
  }

  function commitRename(layerId: string): void {
    const nextValue = editValue.trim();
    const existing = surface.layers.find((layer) => layer.layerId === layerId);
    setEditingLayerId(null);
    if (!existing || !nextValue || nextValue === existing.displayName) {
      if (existing) {
        setEditValue(existing.displayName);
      }
      return;
    }
    commitLayers(
      surface.layers.map((layer) =>
        layer.layerId === layerId
          ? {
              ...cloneLayer(layer),
              displayName: nextValue
            }
          : cloneLayer(layer)
      )
    );
  }

  return (
    <Stack gap="sm">
      <Stack gap={6}>
        <Menu shadow="md" withinPortal position="bottom-start">
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" aria-label="Add surface layer">
              ＋
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => {
                const layer = createDefaultLayer(
                  "appearance",
                  grassTypeDefinitions,
                  flowerTypeDefinitions,
                  rockTypeDefinitions
                );
                commitLayers([...surface.layers.map(cloneLayer), layer]);
                setSelectedLayerId(layer.layerId);
              }}
            >
              Add Appearance Layer
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                const layer = createDefaultLayer(
                  "scatter",
                  grassTypeDefinitions,
                  flowerTypeDefinitions,
                  rockTypeDefinitions
                );
                commitLayers([...surface.layers.map(cloneLayer), layer]);
                setSelectedLayerId(layer.layerId);
              }}
            >
              Add Scatter Layer
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                const layer = createDefaultLayer(
                  "emission",
                  grassTypeDefinitions,
                  flowerTypeDefinitions,
                  rockTypeDefinitions
                );
                commitLayers([...surface.layers.map(cloneLayer), layer]);
                setSelectedLayerId(layer.layerId);
              }}
            >
              Add Emission Layer
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <SortableList
          items={surface.layers.map((layer) => ({
            id: layer.layerId,
            layer,
            label: layer.displayName,
            enabled: layer.enabled,
            description:
              layer.kind === "appearance"
                ? `Appearance · ${layer.content.kind}`
                : layer.kind === "scatter"
                  ? `Scatter · ${layer.content.kind}`
                  : `Emission · ${layer.content.kind}`
          }))}
          selectedId={effectiveSelectedLayerId}
          onSelect={setSelectedLayerId}
          renderLabel={(item) =>
            editingLayerId === item.id ? (
              <TextInput
                size="xs"
                value={editValue}
                onChange={(event) => setEditValue(event.currentTarget.value)}
                onBlur={() => commitRename(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setEditingLayerId(null);
                    setEditValue(item.layer.displayName);
                  }
                }}
                onClick={(event) => event.stopPropagation()}
                autoFocus
                styles={{ input: { padding: "0 4px", height: 22 } }}
              />
            ) : (
              <Text
                size="xs"
                fw={600}
                c={item.enabled ? "var(--sm-color-text)" : "var(--sm-color-overlay0)"}
                truncate
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedLayerId(item.id);
                  setEditingLayerId(item.id);
                  setEditValue(item.layer.displayName);
                }}
                style={{ cursor: "text" }}
              >
                {item.label}
              </Text>
            )
          }
          renderLeading={(item) => (
            <Group gap="xs" wrap="nowrap">
              <LayerMaskPopover
                value={item.layer.mask}
                allowedContext={allowedContext}
                allowPainted={allowPainted}
                paintOwner={paintOwner}
                layerId={item.layer.layerId}
                textureDefinitions={textureDefinitions}
                maskTextureDefinitions={maskTextureDefinitions}
                onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
                onImportMaskTextureDefinition={onImportMaskTextureDefinition}
                activeMaskPaintTarget={activeMaskPaintTarget}
                onSetMaskPaintTarget={onSetMaskPaintTarget}
                onActivate={() => setSelectedLayerId(item.id)}
                onApply={(nextMask) =>
                  commitLayers(
                    surface.layers.map((layer) =>
                      layer.layerId === item.id
                        ? {
                            ...cloneLayer(layer),
                            mask: nextMask
                          }
                        : cloneLayer(layer)
                    )
                  )
                }
              />
              <LayerSettingsPopover
                layer={item.layer}
                isBaseLayer={surface.layers[0]?.layerId === item.id}
                allowedContext={allowedContext}
                materialDefinitions={materialDefinitions}
                textureDefinitions={textureDefinitions}
                maskTextureDefinitions={maskTextureDefinitions}
                onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
                onImportMaskTextureDefinition={onImportMaskTextureDefinition}
                shaderDefinitions={shaderDefinitions}
                grassTypeDefinitions={grassTypeDefinitions}
                flowerTypeDefinitions={flowerTypeDefinitions}
                rockTypeDefinitions={rockTypeDefinitions}
                onActivate={() => setSelectedLayerId(item.id)}
                onChange={(nextLayer) =>
                  commitLayers(
                    surface.layers.map((layer) =>
                      layer.layerId === nextLayer.layerId
                        ? cloneLayer(nextLayer)
                        : cloneLayer(layer)
                    )
                  )
                }
              />
            </Group>
          )}
          canReorderItem={(_, index) => index > 0}
          canDeleteItem={(_, index) => index > 0 && surface.layers.length > 1}
          onToggle={(id, enabled) => {
            commitLayers(
              surface.layers.map((layer) =>
                layer.layerId === id ? { ...cloneLayer(layer), enabled } : cloneLayer(layer)
              )
            );
          }}
          onReorder={(activeId, overId) => {
            const currentIndex = surface.layers.findIndex(
              (layer) => layer.layerId === activeId
            );
            const nextIndex = surface.layers.findIndex(
              (layer) => layer.layerId === overId
            );
            if (
              currentIndex <= 0 ||
              nextIndex <= 0 ||
              currentIndex === nextIndex
            ) {
              return;
            }
            const layers = surface.layers.map(cloneLayer);
            const [moved] = layers.splice(currentIndex, 1);
            layers.splice(nextIndex, 0, moved!);
            commitLayers(layers);
          }}
          onDuplicate={(id) => {
            const existing = surface.layers.find((layer) => layer.layerId === id);
            if (!existing) {
              return;
            }
            const duplicate = createDefaultLayer(
              existing.kind,
              grassTypeDefinitions,
              flowerTypeDefinitions,
              rockTypeDefinitions
            );
            const copied = {
              ...cloneLayer(existing),
              layerId: duplicate.layerId,
              displayName: `${existing.displayName} Copy`
            };
            commitLayers([...surface.layers.map(cloneLayer), copied]);
            setSelectedLayerId(copied.layerId);
          }}
          onDelete={(id) => {
            if (surface.layers[0]?.layerId === id || surface.layers.length === 1) {
              return;
            }
            const nextLayers = surface.layers
              .filter((layer) => layer.layerId !== id)
              .map(cloneLayer);
            commitLayers(nextLayers);
            if (effectiveSelectedLayerId === id) {
              setSelectedLayerId(nextLayers[0]?.layerId ?? null);
            }
          }}
        />
      </Stack>
    </Stack>
  );
}
