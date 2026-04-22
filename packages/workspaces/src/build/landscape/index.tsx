/**
 * Build-mode landscape workspace.
 *
 * Owns editor tooling for region landscape painting and channel authoring on
 * top of the shared runtime landscape semantics. Rendering still lives in the
 * shared viewport/render-web path; this module only exposes authoring controls.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  ColorSwatch,
  Group,
  NumberInput,
  Paper,
  Popover,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";
import type {
  LandscapeSurfaceSlot,
  MaterialDefinition,
  RegionDocument,
  SemanticCommand,
  RegionLandscapeState
} from "@sugarmagic/domain";
import {
  MAX_REGION_LANDSCAPE_CHANNELS,
  createColorSurface,
  createMaterialSurface,
  createLandscapeSurfaceSlot,
  renderLandscapeMaskToCanvas
} from "@sugarmagic/domain";
import type { ViewportStore } from "@sugarmagic/shell";
import { PanelSection, SurfacePicker, type Surface as PickerSurface } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { useVanillaStoreSelector } from "../../use-vanilla-store";
import { LayoutOrientationWidget } from "../layout/LayoutOrientationWidget";
import type { LandscapeBrushSettings } from "./landscape-workspace";

export { createLandscapeCameraController, type LandscapeCameraController } from "./landscape-camera-controller";
export {
  createLandscapeWorkspace,
  type LandscapeBrushSettings,
  type LandscapeWorkspaceConfig,
  type LandscapeWorkspaceInstance
} from "./landscape-workspace";

export interface LandscapeWorkspaceViewProps {
  isActive: boolean;
  viewportStore: ViewportStore;
  materialDefinitions: MaterialDefinition[];
  region: RegionDocument | null;
  onCommand: (command: SemanticCommand) => void;
}

const EMPTY_CHANNELS: LandscapeSurfaceSlot[] = [];
const DEFAULT_BRUSH_SETTINGS: LandscapeBrushSettings = {
  radius: 4,
  strength: 0.25,
  falloff: 0.7,
  mode: "paint"
};

function formatHexColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function nextLandscapeChannelName(channels: LandscapeSurfaceSlot[]): string {
  return `Channel ${channels.length}`;
}

function toPickerSurface(surface: LandscapeSurfaceSlot["surface"]): PickerSurface | null {
  if (!surface) {
    return null;
  }
  if (surface.kind === "color") {
    return {
      kind: "color",
      value: surface.color
    };
  }
  if (surface.kind === "material") {
    return {
      kind: "material",
      materialDefinitionId: surface.materialDefinitionId
    };
  }
  return null;
}

function fromPickerSurface(surface: PickerSurface | null) {
  if (!surface) {
    return null;
  }
  return surface.kind === "color"
    ? createColorSurface(surface.value)
    : surface.materialDefinitionId
      ? createMaterialSurface(surface.materialDefinitionId)
      : null;
}

function MaskThumbnail(props: {
  channelIndex: number;
  landscape: RegionLandscapeState | null;
}) {
  const { channelIndex, landscape } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !landscape) return;
    renderLandscapeMaskToCanvas(landscape, channelIndex, canvas);
  }, [channelIndex, landscape]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      style={{
        width: 40,
        height: 40,
        borderRadius: 4,
        border: "1px solid var(--sm-panel-border)",
        background: "var(--sm-color-base)",
        imageRendering: "pixelated",
        flexShrink: 0
      }}
    />
  );
}

function ChannelCard(props: {
  channel: LandscapeSurfaceSlot;
  channelIndex: number;
  isActive: boolean;
  landscape: RegionLandscapeState | null;
  materials: MaterialDefinition[];
  onSelect: () => void;
  onRename: (displayName: string) => void;
  onSurfaceChange: (surface: PickerSurface | null) => void;
}) {
  const {
    channel,
    channelIndex,
    isActive,
    landscape,
    materials,
    onSelect,
    onRename,
    onSurfaceChange
  } = props;

  const isBase = channelIndex === 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(channel.displayName);

  const surfaceValue = toPickerSurface(channel.surface);

  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        value: material.definitionId,
        label: material.displayName
      })),
    [materials]
  );

  return (
    <Paper
      p="xs"
      radius="sm"
      withBorder
      onClick={isBase ? undefined : onSelect}
      style={{
        cursor: isBase ? "default" : "pointer",
        opacity: isBase && !isActive ? 0.75 : 1,
        borderColor: isActive ? "var(--sm-accent-blue)" : "var(--sm-panel-border)",
        background: isActive ? "var(--sm-active-bg)" : "var(--sm-color-surface0)"
      }}
    >
      <Group gap="sm" wrap="nowrap" justify="space-between">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <MaskThumbnail
            channelIndex={channelIndex}
            landscape={landscape}
          />
          <Popover
            opened={pickerOpen}
            onChange={setPickerOpen}
            position="bottom-start"
            shadow="md"
            withinPortal={false}
          >
            <Popover.Target>
              <ColorSwatch
                color={formatHexColor(
                  channel.surface?.kind === "color" ? channel.surface.color : 0x808080
                )}
                size={18}
                style={{ cursor: "pointer", flexShrink: 0 }}
                onClick={(event) => {
                  event.stopPropagation();
                  setPickerOpen(true);
                }}
              />
            </Popover.Target>
            <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
              <SurfacePicker
                value={surfaceValue}
                materials={materialOptions}
                colorSwatches={[
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
                ]}
                onApply={(next) => {
                  onSurfaceChange(next);
                  setPickerOpen(false);
                }}
                title={`${channel.displayName} surface`}
                emptyMaterialsHint="Create a material in the Material Library to bind it here."
              />
            </Popover.Dropdown>
          </Popover>

          {editing && !isBase ? (
            <TextInput
              size="xs"
              value={editValue}
              onChange={(event) => setEditValue(event.currentTarget.value)}
              onBlur={() => {
                setEditing(false);
                const nextValue = editValue.trim();
                if (nextValue && nextValue !== channel.displayName) {
                  onRename(nextValue);
                } else {
                  setEditValue(channel.displayName);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setEditing(false);
                  setEditValue(channel.displayName);
                }
              }}
              onClick={(event) => event.stopPropagation()}
              autoFocus
              styles={{ input: { padding: "0 4px", height: 22 } }}
            />
          ) : (
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Text
                size="sm"
                fw={isActive ? 600 : 500}
                c="var(--sm-color-text)"
                onClick={(event) => {
                  if (isBase) return;
                  event.stopPropagation();
                  setEditing(true);
                  setEditValue(channel.displayName);
                }}
                style={{
                  cursor: isBase ? "default" : "text",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {channel.displayName}
              </Text>
              {isBase && (
                <Text size="xs" c="var(--sm-color-overlay0)">
                  implicit
                </Text>
              )}
            </Group>
          )}
        </Group>

      </Group>
    </Paper>
  );
}

export function useLandscapeWorkspaceView(
  props: LandscapeWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    viewportStore,
    materialDefinitions,
    region,
    onCommand
  } = props;

  const [brushMenuOpen, setBrushMenuOpen] = useState(false);
  const activeChannelIndex = useVanillaStoreSelector(
    viewportStore,
    (state) => state.activeLandscapeChannelIndex
  );
  const brushSettings =
    useVanillaStoreSelector(viewportStore, (state) => state.brushSettings) ??
    DEFAULT_BRUSH_SETTINGS;
  const landscapeDraft = useVanillaStoreSelector(
    viewportStore,
    (state) => state.landscapeDraft
  );
  const cameraQuaternion = useVanillaStoreSelector(
    viewportStore,
    (state) => state.cameraQuaternion
  );
  const displayedLandscape = landscapeDraft ?? region?.landscape ?? null;

  const channels = displayedLandscape?.surfaceSlots ?? EMPTY_CHANNELS;
  const effectiveActiveChannelIndex =
    activeChannelIndex < channels.length
      ? activeChannelIndex
      : Math.min(1, Math.max(0, channels.length - 1));
  const canAddChannel = channels.length < MAX_REGION_LANDSCAPE_CHANNELS;
  const channelCards = useMemo(
    () =>
      channels.map((channel, channelIndex) => (
        <ChannelCard
          key={channel.channelId}
          channel={channel}
          channelIndex={channelIndex}
          isActive={channelIndex === effectiveActiveChannelIndex}
          landscape={displayedLandscape}
          materials={materialDefinitions}
          onSelect={() =>
            viewportStore.getState().setActiveLandscapeChannelIndex(channelIndex)
          }
          onRename={(displayName) => {
            if (!region || channelIndex === 0) return;
            onCommand({
              kind: "UpdateLandscapeChannel",
              target: {
                aggregateKind: "region-document",
                aggregateId: region.identity.id
              },
              subject: {
                subjectKind: "region-landscape",
                subjectId: region.identity.id
              },
              payload: {
                channelId: channel.channelId,
                displayName
              }
            });
          }}
          onSurfaceChange={(surface) => {
            if (!region) return;
            onCommand({
              kind: "UpdateLandscapeChannel",
              target: {
                aggregateKind: "region-document",
                aggregateId: region.identity.id
              },
              subject: {
                subjectKind: "region-landscape",
                subjectId: region.identity.id
              },
              payload: {
                channelId: channel.channelId,
                surface: fromPickerSurface(surface),
                tilingScale: channel.tilingScale
              }
            });
          }}
        />
      )),
    [
      channels,
      effectiveActiveChannelIndex,
      displayedLandscape,
      materialDefinitions,
      onCommand,
      region,
      viewportStore
    ]
  );

  const setBrushMode = (mode: LandscapeBrushSettings["mode"]) => {
    viewportStore.getState().setBrushSettings({
      ...brushSettings,
      mode
    });
  };

  return {
    leftPanel: null,
    rightPanel: (
      <Stack gap={0} h="100%">
        <PanelSection title="Landscape" icon="⛰️">
          {region ? (
            <Stack gap="md">
              <Switch
                label="Enabled"
                checked={region.landscape.enabled}
                onChange={(event) => {
                  onCommand({
                    kind: "ConfigureLandscape",
                    target: {
                      aggregateKind: "region-document",
                      aggregateId: region.identity.id
                    },
                    subject: {
                      subjectKind: "region-landscape",
                      subjectId: region.identity.id
                    },
                    payload: {
                      enabled: event.currentTarget.checked
                    }
                  });
                }}
                size="xs"
              />

              <Group grow>
                <NumberInput
                  label="Size (m)"
                  size="xs"
                  min={10}
                  max={500}
                  value={region.landscape.size}
                  onChange={(value) => {
                    if (typeof value !== "number" || Number.isNaN(value)) return;
                    onCommand({
                      kind: "ConfigureLandscape",
                      target: {
                        aggregateKind: "region-document",
                        aggregateId: region.identity.id
                      },
                      subject: {
                        subjectKind: "region-landscape",
                        subjectId: region.identity.id
                      },
                      payload: {
                        size: value
                      }
                    });
                  }}
                />
                <NumberInput
                  label="Subdivisions"
                  size="xs"
                  min={8}
                  max={256}
                  value={region.landscape.subdivisions}
                  onChange={(value) => {
                    if (typeof value !== "number" || Number.isNaN(value)) return;
                    onCommand({
                      kind: "ConfigureLandscape",
                      target: {
                        aggregateKind: "region-document",
                        aggregateId: region.identity.id
                      },
                      subject: {
                        subjectKind: "region-landscape",
                        subjectId: region.identity.id
                      },
                      payload: {
                        subdivisions: value
                      }
                    });
                  }}
                />
              </Group>

              <Stack gap="xs">
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
                    Channels
                  </Text>
                  {canAddChannel && region ? (
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label="Add channel"
                      onClick={() => {
                        onCommand({
                          kind: "CreateLandscapeChannel",
                          target: {
                            aggregateKind: "region-document",
                            aggregateId: region.identity.id
                          },
                          subject: {
                            subjectKind: "region-landscape",
                            subjectId: region.identity.id
                          },
                          payload: {
                            channel: createLandscapeSurfaceSlot({
                              displayName: nextLandscapeChannelName(region.landscape.surfaceSlots),
                              surface: createColorSurface(0x808080)
                            })
                          }
                        });
                      }}
                    >
                      +
                    </ActionIcon>
                  ) : null}
                </Group>
                <Stack gap="xs">{channelCards}</Stack>
              </Stack>
            </Stack>
          ) : (
            <Text size="xs" c="var(--sm-color-overlay0)">
              Select a region to edit its landscape.
            </Text>
          )}
        </PanelSection>
      </Stack>
    ),
    viewportOverlay: isActive ? (
      <>
        <Box
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            pointerEvents: "auto"
          }}
        >
          <Popover
            opened={brushMenuOpen}
            onChange={setBrushMenuOpen}
            position="bottom-start"
            shadow="md"
            withinPortal={false}
          >
            <Popover.Target>
              <Box
                style={{
                  display: "inline-flex",
                  gap: 8,
                  padding: 8,
                  borderRadius: "var(--sm-radius-md)",
                  border: "1px solid var(--sm-panel-border)",
                  background: "rgba(30, 30, 46, 0.9)"
                }}
              >
                <ActionIcon
                  variant={brushSettings.mode === "paint" ? "filled" : "subtle"}
                  color={brushSettings.mode === "paint" ? "blue" : "gray"}
                  aria-label="Paint landscape"
                  onClick={() => {
                    if (brushSettings.mode === "paint") {
                      setBrushMenuOpen((open) => !open);
                    } else {
                      setBrushMode("paint");
                      setBrushMenuOpen(true);
                    }
                  }}
                >
                  🖌️
                </ActionIcon>
                <ActionIcon
                  variant={brushSettings.mode === "erase" ? "filled" : "subtle"}
                  color={brushSettings.mode === "erase" ? "blue" : "gray"}
                  aria-label="Erase landscape"
                  onClick={() => {
                    if (brushSettings.mode === "erase") {
                      setBrushMenuOpen((open) => !open);
                    } else {
                      setBrushMode("erase");
                      setBrushMenuOpen(true);
                    }
                  }}
                >
                  ⌫
                </ActionIcon>
              </Box>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="sm" style={{ minWidth: 220 }}>
                <Text size="xs" fw={700} c="var(--sm-color-subtext)" tt="uppercase">
                  {brushSettings.mode === "paint" ? "Paint Brush" : "Erase Brush"}
                </Text>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="xs" c="var(--sm-color-text)">
                      Radius
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {brushSettings.radius.toFixed(1)}m
                    </Text>
                  </Group>
                  <Slider
                    min={0.5}
                    max={24}
                    step={0.5}
                    value={brushSettings.radius}
                    onChange={(value) =>
                      viewportStore.getState().setBrushSettings({
                        ...brushSettings,
                        radius: value
                      })
                    }
                  />
                </Stack>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="xs" c="var(--sm-color-text)">
                      Strength
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {brushSettings.strength.toFixed(2)}
                    </Text>
                  </Group>
                  <Slider
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={brushSettings.strength}
                    onChange={(value) =>
                      viewportStore.getState().setBrushSettings({
                        ...brushSettings,
                        strength: value
                      })
                    }
                  />
                </Stack>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="xs" c="var(--sm-color-text)">
                      Falloff
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {brushSettings.falloff.toFixed(2)}
                    </Text>
                  </Group>
                  <Slider
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={brushSettings.falloff}
                    onChange={(value) =>
                      viewportStore.getState().setBrushSettings({
                        ...brushSettings,
                        falloff: value
                      })
                    }
                  />
                </Stack>
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Box>
        <Box style={{ position: "absolute", top: 12, right: 12, pointerEvents: "none" }}>
          <LayoutOrientationWidget quaternion={cameraQuaternion} />
        </Box>
      </>
    ) : null
  };
}
