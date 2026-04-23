/**
 * Layer stack view.
 *
 * Shows one inline surface's ordered layers and a detail editor for the
 * currently selected layer.
 */

import { ActionIcon, Divider, Menu, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Layer,
  MaterialDefinition,
  MaskTextureDefinition,
  RockTypeDefinition,
  ShaderGraphDocument,
  Surface,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import { SortableList } from "@sugarmagic/ui";
import { LayerDetailPanel } from "./LayerDetailPanel";
import { cloneLayer, createDefaultLayer } from "./utils";

export interface LayerStackViewProps<C extends SurfaceContext = SurfaceContext> {
  surface: Surface<C>;
  allowedContext: C;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activePaintMaskTextureId?: string | null;
  onSetActivePaintMaskTextureId?: (definitionId: string | null) => void;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  onChangeSurface: (surface: Surface<C>) => void;
}

export function LayerStackView<C extends SurfaceContext = SurfaceContext>({
  surface,
  allowedContext,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  activePaintMaskTextureId,
  onSetActivePaintMaskTextureId,
  shaderDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  rockTypeDefinitions,
  onChangeSurface
}: LayerStackViewProps<C>) {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    surface.layers[0]?.layerId ?? null
  );

  useEffect(() => {
    if (!surface.layers.some((layer) => layer.layerId === selectedLayerId)) {
      setSelectedLayerId(surface.layers[0]?.layerId ?? null);
    }
  }, [selectedLayerId, surface.layers]);

  const selectedLayer = useMemo(
    () => surface.layers.find((layer) => layer.layerId === selectedLayerId) ?? null,
    [selectedLayerId, surface.layers]
  );

  function commitLayers(nextLayers: Layer[]): void {
    onChangeSurface({
      ...surface,
      layers: nextLayers
    });
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
            label: layer.displayName,
            enabled: layer.enabled,
            description:
              layer.kind === "appearance"
                ? `Appearance · ${layer.content.kind}`
                : layer.kind === "scatter"
                  ? `Scatter · ${layer.content.kind}`
                  : `Emission · ${layer.content.kind}`
          }))}
          selectedId={selectedLayerId}
          onSelect={setSelectedLayerId}
          onToggle={(id, enabled) => {
            commitLayers(
              surface.layers.map((layer) =>
                layer.layerId === id ? { ...cloneLayer(layer), enabled } : cloneLayer(layer)
              )
            );
          }}
          onMove={(id, direction) => {
            const currentIndex = surface.layers.findIndex((layer) => layer.layerId === id);
            const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
            if (currentIndex < 0 || nextIndex <= 0 || nextIndex >= surface.layers.length) {
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
          }}
        />
      </Stack>
      <Divider />
      {selectedLayer ? (
        <LayerDetailPanel
          layer={selectedLayer}
          isBaseLayer={surface.layers[0]?.layerId === selectedLayer.layerId}
          allowedContext={allowedContext}
          materialDefinitions={materialDefinitions}
          textureDefinitions={textureDefinitions}
          maskTextureDefinitions={maskTextureDefinitions}
          onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
          onImportMaskTextureDefinition={onImportMaskTextureDefinition}
          activePaintMaskTextureId={activePaintMaskTextureId}
          onSetActivePaintMaskTextureId={onSetActivePaintMaskTextureId}
          shaderDefinitions={shaderDefinitions}
          grassTypeDefinitions={grassTypeDefinitions}
          flowerTypeDefinitions={flowerTypeDefinitions}
          rockTypeDefinitions={rockTypeDefinitions}
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
      ) : (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Select a layer to edit it.
        </Text>
      )}
    </Stack>
  );
}
