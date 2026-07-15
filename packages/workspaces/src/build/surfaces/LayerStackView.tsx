/**
 * Layer stack view.
 *
 * Shows one inline surface's ordered layers and a detail editor for the
 * currently selected layer.
 */

import {
  ActionIcon,
  Group,
  Menu,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import { useEffect, useState } from "react";
import type {
  Layer,
  Mask,
  PaintedMaskTargetAddress,
  Surface,
  SurfaceContext
} from "@sugarmagic/domain";
import { MaskPreview, SortableList } from "@sugarmagic/ui";
import { LayerDetailPanel } from "./LayerDetailPanel";
import { LayerMaskPopover } from "./LayerMaskPopover";
import { LayerSettingsPopover } from "./LayerSettingsPopover";
import { MaskEditor } from "./MaskEditor";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";
import { useMaskPreviewSampler } from "./maskSampling";
import { createSurfaceRefLayer } from "@sugarmagic/domain";
import { cloneLayer, createDefaultLayer } from "./utils";

/** Hook-per-row wrapper: painted masks preview their real pixels. */
function LayerMaskThumbnail({ mask, size }: { mask: Mask; size: number }) {
  const sample = useMaskPreviewSampler(mask);
  return <MaskPreview size={size} sample={sample} />;
}

export interface LayerStackViewProps<C extends SurfaceContext = SurfaceContext> {
  surface: Surface<C>;
  allowedContext: C;
  allowPainted: boolean;
  paintOwner:
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "landscape-channel" }>, "layerId">
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "asset-slot" }>, "layerId">
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "instance-slot" }>, "layerId">
    | null;
  onChangeSurface: (surface: Surface<C>) => void;
  /** "popover" (default) = the legacy per-row settings/mask popovers.
   *  "inline" = master-detail (Plan 068.5): the SELECTED layer's
   *  settings and mask render below the list, accordion-style; no
   *  popovers, edits commit live. */
  variant?: "popover" | "inline";
  /** Fires when the selected (detail) layer changes (inline variant).
   *  The Surface Studio uses this to keep its always-on brush pointed at
   *  the selected layer's mask (Plan 068.10b). */
  onSelectedLayerChange?: (layerId: string | null) => void;
  /** Hide the mask editor's "Paint in Viewport" arming button. The
   *  Surface Studio paints the selected layer directly, so the arm step
   *  is redundant there; the Layout inspector still shows it. */
  hidePaintInViewport?: boolean;
}

export function LayerStackView<C extends SurfaceContext = SurfaceContext>({
  surface,
  allowedContext,
  allowPainted,
  paintOwner,
  onChangeSurface,
  variant = "popover",
  onSelectedLayerChange,
  hidePaintInViewport
}: LayerStackViewProps<C>) {
  const {
    surfaceDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions
  } = useSurfaceAuthoring();
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    surface.layers[0]?.layerId ?? null
  );
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  // Searchable surface picker (the raw "list them all" menu doesn't scale).
  const [surfacePickerOpen, setSurfacePickerOpen] = useState(false);
  const [surfaceQuery, setSurfaceQuery] = useState("");
  const effectiveSelectedLayerId =
    selectedLayerId &&
    surface.layers.some((layer) => layer.layerId === selectedLayerId)
      ? selectedLayerId
      : surface.layers[0]?.layerId ?? null;

  useEffect(() => {
    onSelectedLayerChange?.(effectiveSelectedLayerId);
  }, [effectiveSelectedLayerId, onSelectedLayerChange]);

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
            {surfaceDefinitions.length > 0 ? (
              <>
                <Menu.Divider />
                <Menu.Item
                  onClick={() => {
                    setSurfaceQuery("");
                    setSurfacePickerOpen(true);
                  }}
                >
                  Add Surface Layer...
                </Menu.Item>
              </>
            ) : null}
          </Menu.Dropdown>
        </Menu>
        <Modal
          opened={surfacePickerOpen}
          onClose={() => setSurfacePickerOpen(false)}
          title="Add Surface Layer"
          size="sm"
          withinPortal
        >
          <TextInput
            data-autofocus
            placeholder="Search surfaces..."
            value={surfaceQuery}
            onChange={(event) => setSurfaceQuery(event.currentTarget.value)}
            mb="xs"
          />
          <ScrollArea.Autosize mah={340}>
            <Stack gap={2}>
              {surfaceDefinitions
                .filter((definition) =>
                  definition.displayName
                    .toLowerCase()
                    .includes(surfaceQuery.trim().toLowerCase())
                )
                .map((definition) => (
                  <UnstyledButton
                    key={definition.definitionId}
                    onClick={() => {
                      // Plan 068.9 -- a masked layer that IS this library
                      // surface, composited + blended.
                      const layer = createSurfaceRefLayer(
                        definition.definitionId,
                        { displayName: definition.displayName }
                      );
                      commitLayers([...surface.layers.map(cloneLayer), layer]);
                      setSelectedLayerId(layer.layerId);
                      setSurfacePickerOpen(false);
                    }}
                    styles={{
                      root: {
                        padding: "6px 10px",
                        borderRadius: "var(--sm-radius-sm)",
                        "&:hover": { background: "var(--sm-active-bg)" }
                      }
                    }}
                  >
                    <Text size="sm">{definition.displayName}</Text>
                  </UnstyledButton>
                ))}
              {surfaceDefinitions.filter((definition) =>
                definition.displayName
                  .toLowerCase()
                  .includes(surfaceQuery.trim().toLowerCase())
              ).length === 0 ? (
                <Text size="xs" c="var(--sm-color-overlay0)" p="xs">
                  No surfaces match "{surfaceQuery}".
                </Text>
              ) : null}
            </Stack>
          </ScrollArea.Autosize>
        </Modal>
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
          renderLeading={(item) =>
            variant === "inline" ? (
              <LayerMaskThumbnail mask={item.layer.mask} size={24} />
            ) : (
              <Group gap="xs" wrap="nowrap">
                <LayerMaskPopover
                  value={item.layer.mask}
                  allowedContext={allowedContext}
                  allowPainted={allowPainted}
                  paintOwner={paintOwner}
                  layerId={item.layer.layerId}
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
            )
          }
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
      {variant === "inline"
        ? (() => {
            const selectedLayer = surface.layers.find(
              (layer) => layer.layerId === effectiveSelectedLayerId
            );
            if (!selectedLayer) return null;
            const commitMask = (nextMask: Mask) =>
              commitLayers(
                surface.layers.map((layer) =>
                  layer.layerId === selectedLayer.layerId
                    ? { ...cloneLayer(layer), mask: nextMask }
                    : cloneLayer(layer)
                )
              );
            return (
              <Stack
                gap="sm"
                p="xs"
                style={{
                  border: "1px solid var(--sm-panel-border)",
                  borderRadius: 8,
                  background: "var(--sm-color-surface0)"
                }}
              >
                <Text size="xs" fw={600} c="var(--sm-color-subtext)" truncate>
                  {selectedLayer.displayName}
                </Text>
                <LayerDetailPanel
                  layer={selectedLayer}
                  isBaseLayer={
                    surface.layers[0]?.layerId === selectedLayer.layerId
                  }
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
                <MaskEditor
                  value={selectedLayer.mask}
                  allowedContext={allowedContext}
                  allowPainted={allowPainted}
                  hidePaintButton={hidePaintInViewport}
                  paintTarget={
                    paintOwner
                      ? { ...paintOwner, layerId: selectedLayer.layerId }
                      : null
                  }
                  // Live-commit: no draft buffer to lose (the popover
                  // draft died with a shipped bug; see 068.5).
                  onChange={commitMask}
                  onCommitPainted={commitMask}
                />
              </Stack>
            );
          })()
        : null}
    </Stack>
  );
}
