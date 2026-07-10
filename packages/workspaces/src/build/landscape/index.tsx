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
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  LandscapeSurfaceSlot,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RegionDocument,
  RockTypeDefinition,
  ShaderGraphDocument,
  SemanticCommand,
  RegionLandscapeState,
  SurfaceBinding,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import {
  MAX_REGION_LANDSCAPE_CHANNELS,
  createLandscapeSurfaceSlot,
  renderLandscapeMaskToCanvas
} from "@sugarmagic/domain";
import { DEFAULT_SKETCH_SETTINGS, type ViewportStore } from "@sugarmagic/shell";
import {
  PanelSection,
  ToolOptionSlider,
  ToolOptionsBar,
  ToolRail
} from "@sugarmagic/ui";
import { useSurfaceAuthoring } from "../surfaces";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { useVanillaStoreSelector } from "../../use-vanilla-store";
import { LayoutOrientationWidget } from "../layout/LayoutOrientationWidget";
import { SurfaceBindingEditor } from "../surfaces";
import { previewColorForBinding } from "../surfaces/utils";
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
  surfaceDefinitions: SurfaceDefinition[];
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

/** Plan 065 §065.1 — the pencil's ink palette. */
const SKETCH_INK_COLORS = [
  "#1e1e2e",
  "#ffffff",
  "#d20f39",
  "#1e66f5",
  "#df8e1d",
  "#40a02b"
];

function nextLandscapeChannelName(channels: LandscapeSurfaceSlot[]): string {
  return `Channel ${channels.length}`;
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
  onSelect: () => void;
  onRename: (displayName: string) => void;
  onSurfaceChange: (surface: SurfaceBinding | null) => void;
  onDelete: () => void;
}) {
  const {
    channel,
    channelIndex,
    isActive,
    landscape,
    onSelect,
    onRename,
    onSurfaceChange,
    onDelete
  } = props;
  const { surfaceDefinitions } = useSurfaceAuthoring();

  const isBase = channelIndex === 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(channel.displayName);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handlePointerDown(): void {
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  return (
    <Paper
      p="xs"
      radius="sm"
      withBorder
      onClick={isBase ? undefined : onSelect}
      onContextMenu={(event) => {
        if (isBase) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        setContextMenu({
          x: event.clientX,
          y: event.clientY
        });
      }}
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
                color={previewColorForBinding(channel.surface, surfaceDefinitions)}
                size={18}
                style={{ cursor: "pointer", flexShrink: 0 }}
                onClick={(event) => {
                  event.stopPropagation();
                  setPickerOpen(true);
                }}
              />
            </Popover.Target>
            <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
              <SurfaceBindingEditor
                value={channel.surface}
                allowedContext="landscape-only"
                paintOwner={{
                  scope: "landscape-channel",
                  channelKey: channel.channelId
                }}
                onChange={(next) => {
                  onSurfaceChange(next);
                  setPickerOpen(false);
                }}
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
      {contextMenu ? (
        <Paper
          withBorder
          shadow="md"
          radius="sm"
          p={4}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            minWidth: 140
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Stack gap={2}>
            <UnstyledButton
              onClick={() => {
                onDelete();
                setContextMenu(null);
              }}
              style={{
                padding: "6px 8px",
                borderRadius: "var(--sm-radius-sm)",
                color: "var(--sm-red)",
                cursor: "pointer"
              }}
            >
              <Text size="xs">Delete</Text>
            </UnstyledButton>
          </Stack>
        </Paper>
      ) : null}
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
    surfaceDefinitions,
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
    region,
    onCommand
  } = props;

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
                surface,
                tilingScale: channel.tilingScale
              }
            });
          }}
          onDelete={() => {
            if (!region || channelIndex === 0) return;
            onCommand({
              kind: "DeleteLandscapeChannel",
              target: {
                aggregateKind: "region-document",
                aggregateId: region.identity.id
              },
              subject: {
                subjectKind: "region-landscape",
                subjectId: region.identity.id
              },
              payload: {
                channelId: channel.channelId
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
      surfaceDefinitions,
      textureDefinitions,
      maskTextureDefinitions,
      activeMaskPaintTarget,
      onSetMaskPaintTarget,
      shaderDefinitions,
      grassTypeDefinitions,
      flowerTypeDefinitions,
      rockTypeDefinitions,
      onCreateMaskTextureDefinition,
      onImportMaskTextureDefinition,
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

  const sketchSettings =
    useVanillaStoreSelector(viewportStore, (state) => state.sketchSettings) ??
    DEFAULT_SKETCH_SETTINGS;
  const setSketch = (
    patch: Partial<typeof sketchSettings>
  ) => {
    viewportStore.getState().setSketchSettings({
      ...sketchSettings,
      ...patch
    });
  };
  const layoutSketch = region?.layoutSketch ?? null;
  const commitLayoutSketch = (
    patch: Partial<NonNullable<RegionDocument["layoutSketch"]>>
  ) => {
    if (!region) return;
    onCommand({
      kind: "UpdateRegionLayoutSketch",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-landscape",
        subjectId: region.identity.id
      },
      payload: {
        layoutSketch: {
          ink: layoutSketch?.ink ?? null,
          referenceImage: layoutSketch?.referenceImage ?? null,
          referenceOpacity: layoutSketch?.referenceOpacity ?? 0.4,
          ...patch
        }
      }
    });
  };
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const importReferenceImage = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        commitLayoutSketch({ referenceImage: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };
  // Local echo while dragging; the command commits on release.
  const [referenceOpacityDraft, setReferenceOpacityDraft] = useState<number | null>(null);

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
                              displayName: nextLandscapeChannelName(region.landscape.surfaceSlots)
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
        <Box style={{ pointerEvents: "auto" }}>
          <ToolRail
            tools={[
              { id: "paint", icon: "🖌️", label: "Paint landscape" },
              { id: "erase", icon: "🧽", label: "Erase landscape" },
              { id: "sketch", icon: "✏️", label: "Layout sketch" }
            ]}
            activeToolId={brushSettings.mode}
            onSelect={(toolId) =>
              setBrushMode(toolId as LandscapeBrushSettings["mode"])
            }
          />
          {brushSettings.mode === "sketch" ? (
            <ToolOptionsBar>
              <Text size="xs" fw={700} c="var(--sm-color-subtext)" tt="uppercase">
                Sketch
              </Text>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                {SKETCH_INK_COLORS.map((color) => (
                  <ColorSwatch
                    key={color}
                    color={color}
                    size={16}
                    component="button"
                    onClick={() => setSketch({ color, erase: false })}
                    style={{
                      cursor: "pointer",
                      outline:
                        !sketchSettings.erase && sketchSettings.color === color
                          ? "2px solid var(--sm-color-subtext)"
                          : "none",
                      outlineOffset: 1
                    }}
                  />
                ))}
              </Group>
              <ToolOptionSlider
                label="Size"
                min={0.1}
                max={4}
                step={0.1}
                value={sketchSettings.size}
                format={(value) => `${value.toFixed(1)}m`}
                onChange={(value) => setSketch({ size: value })}
              />
              <ToolOptionSlider
                label="Opacity"
                min={0.05}
                max={1}
                step={0.05}
                value={sketchSettings.opacity}
                onChange={(value) => setSketch({ opacity: value })}
              />
              <ActionIcon
                variant={sketchSettings.erase ? "filled" : "subtle"}
                color={sketchSettings.erase ? "red" : "gray"}
                size="sm"
                title="Erase ink"
                aria-label="Erase ink"
                onClick={() => setSketch({ erase: !sketchSettings.erase })}
              >
                🧽
              </ActionIcon>
              <ActionIcon
                variant={sketchSettings.visible ? "subtle" : "filled"}
                color={sketchSettings.visible ? "gray" : "blue"}
                size="sm"
                title={sketchSettings.visible ? "Hide sketch" : "Show sketch"}
                aria-label="Show or hide sketch"
                onClick={() => setSketch({ visible: !sketchSettings.visible })}
              >
                👁
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                title="Import reference image"
                aria-label="Import reference image"
                onClick={() => referenceFileInputRef.current?.click()}
              >
                🖼
              </ActionIcon>
              <input
                ref={referenceFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  importReferenceImage(event.currentTarget.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
              {layoutSketch?.referenceImage ? (
                <>
                  <ToolOptionSlider
                    label="Ref"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={
                      referenceOpacityDraft ?? layoutSketch.referenceOpacity
                    }
                    onChange={setReferenceOpacityDraft}
                    onChangeEnd={(value) => {
                      setReferenceOpacityDraft(null);
                      commitLayoutSketch({ referenceOpacity: value });
                    }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    title="Remove reference image"
                    aria-label="Remove reference image"
                    onClick={() => commitLayoutSketch({ referenceImage: null })}
                  >
                    🗑
                  </ActionIcon>
                </>
              ) : null}
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                title="Clear all ink"
                aria-label="Clear all ink"
                onClick={() => commitLayoutSketch({ ink: null })}
              >
                🧹
              </ActionIcon>
            </ToolOptionsBar>
          ) : (
            <ToolOptionsBar>
              <Text size="xs" fw={700} c="var(--sm-color-subtext)" tt="uppercase">
                {brushSettings.mode === "paint" ? "Paint" : "Erase"}
              </Text>
              <ToolOptionSlider
                label="Radius"
                min={0.5}
                max={24}
                step={0.5}
                value={brushSettings.radius}
                format={(value) => `${value.toFixed(1)}m`}
                onChange={(value) =>
                  viewportStore.getState().setBrushSettings({
                    ...brushSettings,
                    radius: value
                  })
                }
              />
              <ToolOptionSlider
                label="Strength"
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
              <ToolOptionSlider
                label="Falloff"
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
            </ToolOptionsBar>
          )}
        </Box>
        <Box style={{ position: "absolute", top: 12, right: 12, pointerEvents: "none" }}>
          <LayoutOrientationWidget quaternion={cameraQuaternion} />
        </Box>
      </>
    ) : null
  };
}
