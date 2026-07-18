/**
 * SpatialWorkspaceView: the React view for Build > Spatial.
 *
 * Plan 069.7 — authors unified drawn Volumes (label / trigger / blocker /
 * containment / nav roles), not just areas. The list + draw + inspector all
 * operate on `region.volumes`; the legacy `areas`/`ambience` stores are the
 * derived aliases (069.4). Runtime role behavior lands in 069.5 — this view
 * is authoring only.
 */

import { useEffect, useMemo, useCallback, useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  ColorPicker,
  ColorSwatch,
  Group,
  NumberInput,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  RegionAreaBounds,
  RegionAreaKind,
  RegionDocument,
  RegionVolumeBlockDirection,
  RegionVolumeDefinition,
  RegionVolumeRole,
  RegionVolumeTriggerTiming,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  createRegionVolumeDefinition,
  createRegionVolumeId,
  resolveRegionVolumes
} from "@sugarmagic/domain";
import {
  Inspector,
  PanelSection,
  ViewportToolbar,
  ViewportViewToggleBar,
  type ViewportToolbarItem
} from "@sugarmagic/ui";
import type { ViewportStore } from "@sugarmagic/shell";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { useVanillaStoreSelector } from "../../use-vanilla-store";
import { LayoutOrientationWidget } from "../layout/LayoutOrientationWidget";
import { getSpatialWorkspaceForViewport } from "./spatial-interaction-access";

const AREA_KIND_OPTIONS: Array<{ value: RegionAreaKind; label: string }> = [
  { value: "zone", label: "Zone" },
  { value: "interior", label: "Interior" },
  { value: "exterior", label: "Exterior" },
  { value: "room", label: "Room" },
  { value: "stall", label: "Stall" },
  { value: "platform", label: "Platform" },
  { value: "shop", label: "Shop" }
];

const VOLUME_ROLE_OPTIONS: Array<{ value: RegionVolumeRole; label: string }> = [
  { value: "label", label: "Label (semantic zone)" },
  { value: "trigger", label: "Trigger" },
  { value: "blocker", label: "Blocker (wall)" },
  { value: "containment-boundary", label: "Containment (can't leave until…)" },
  { value: "nav-bounds", label: "Nav bounds (bake navmesh here)" },
  { value: "non-walkable", label: "Non-walkable" }
];

const BLOCK_DIRECTION_OPTIONS: Array<{
  value: RegionVolumeBlockDirection;
  label: string;
}> = [
  { value: "both", label: "Both" },
  { value: "in", label: "Block entry" },
  { value: "out", label: "Block exit" }
];

const TRIGGER_TIMING_OPTIONS: Array<{
  value: RegionVolumeTriggerTiming;
  label: string;
}> = [
  { value: "on-enter", label: "On enter" },
  { value: "always", label: "Always" }
];

type SpatialTool = "select" | "draw-rect";

const spatialTools: ViewportToolbarItem[] = [
  { id: "select", label: "Select", icon: "↖", shortcut: "V" },
  { id: "draw-rect", label: "Draw Volume", icon: "▭", shortcut: "D" }
];

export interface SpatialWorkspaceViewProps {
  isActive: boolean;
  getViewportElement: () => HTMLElement | null;
  viewportStore: ViewportStore;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  region: RegionDocument | null;
  onCommand: (command: SemanticCommand) => void;
  /** Plan 069.8 — bake the region navmesh (studio host action). */
  onBakeNavMesh?: () => void | Promise<void>;
  /** Plan 069.8 — a collider/nav-volume edit postdates the bake. */
  navMeshStale?: boolean;
}

type VolumePatch = Partial<Omit<RegionVolumeDefinition, "volumeId">>;

function volumesOf(region: RegionDocument): RegionVolumeDefinition[] {
  return resolveRegionVolumes(region);
}

const DEFAULT_VOLUME_COLOR = "#74c7ec";
const VOLUME_COLOR_SWATCHES = [
  "#f38ba8",
  "#fab387",
  "#f9e2af",
  "#a6e3a1",
  "#94e2d5",
  "#74c7ec",
  "#89b4fa",
  "#cba6f7",
  "#f5c2e7"
];

/** Plan 069.8 QoL — swatch + popover picker for a volume's viewport tint.
 *  Local draft for smooth dragging; commits on change-end. */
function VolumeColorControl(props: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [draft, setDraft] = useState(props.value ?? DEFAULT_VOLUME_COLOR);
  useEffect(() => {
    setDraft(props.value ?? DEFAULT_VOLUME_COLOR);
  }, [props.value]);
  return (
    <Popover position="bottom-end" withinPortal shadow="md">
      <Popover.Target>
        <ColorSwatch
          component="button"
          color={props.value ?? DEFAULT_VOLUME_COLOR}
          size={16}
          aria-label="Volume color"
          style={{ cursor: "pointer", flexShrink: 0 }}
          onClick={(event) => event.stopPropagation()}
        />
      </Popover.Target>
      <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
        <Stack gap="xs">
          <ColorPicker
            format="hex"
            size="xs"
            value={draft}
            onChange={setDraft}
            onChangeEnd={(color) => props.onChange(color)}
            swatches={VOLUME_COLOR_SWATCHES}
          />
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => props.onChange(null)}
          >
            Default color
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function useSpatialWorkspaceView(
  props: SpatialWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    getViewportElement,
    viewportStore,
    selectedIds,
    onSelect,
    region,
    onCommand,
    onBakeNavMesh,
    navMeshStale
  } = props;
  const activeTool = useVanillaStoreSelector(
    viewportStore,
    (state) => state.activeSpatialTool
  );
  const cameraQuaternion = useVanillaStoreSelector(
    viewportStore,
    (state) => state.cameraQuaternion
  );
  const showColliders = useVanillaStoreSelector(
    viewportStore,
    (state) => state.showColliders
  );
  const showNavMesh = useVanillaStoreSelector(
    viewportStore,
    (state) => state.showNavMesh
  );
  const hiddenVolumeIds = useVanillaStoreSelector(
    viewportStore,
    (state) => state.hiddenVolumeIds
  );
  const [baking, setBaking] = useState(false);

  const volumes = useMemo(
    () => (region ? volumesOf(region) : []),
    [region]
  );

  const effectiveSelectedId = useMemo(() => {
    if (!region) return null;
    const selectedId = selectedIds[0] ?? null;
    if (selectedId && volumes.some((v) => v.volumeId === selectedId)) {
      return selectedId;
    }
    return volumes[0]?.volumeId ?? null;
  }, [region, selectedIds, volumes]);

  useEffect(() => {
    if (!isActive) return;
    getSpatialWorkspaceForViewport(getViewportElement())?.setDrawingEnabled(
      activeTool === "draw-rect"
    );
  }, [activeTool, getViewportElement, isActive]);

  useEffect(() => {
    if (!isActive) return;
    getSpatialWorkspaceForViewport(getViewportElement())?.syncAreas();
  }, [effectiveSelectedId, getViewportElement, isActive, region]);

  const selectedVolume = useMemo(() => {
    if (!effectiveSelectedId) return null;
    return volumes.find((v) => v.volumeId === effectiveSelectedId) ?? null;
  }, [effectiveSelectedId, volumes]);

  const updateVolume = useCallback(
    (patch: VolumePatch) => {
      if (!region || !selectedVolume) return;
      onCommand({
        kind: "UpdateRegionVolume",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "region-volume",
          subjectId: selectedVolume.volumeId
        },
        payload: { volumeId: selectedVolume.volumeId, patch }
      });
    },
    [onCommand, region, selectedVolume]
  );

  // Plan 069.8 QoL — set any volume's authoring tint by id (not just the
  // selected one), so the color swatch works straight from the list row.
  const setVolumeColor = useCallback(
    (volumeId: string, color: string | null) => {
      if (!region) return;
      onCommand({
        kind: "UpdateRegionVolume",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: { subjectKind: "region-volume", subjectId: volumeId },
        payload: { volumeId, patch: { color } }
      });
    },
    [onCommand, region]
  );

  const createVolume = useCallback(() => {
    if (!region) return;
    const volume = createRegionVolumeDefinition({
      volumeId: createRegionVolumeId(),
      displayName: `Volume ${volumesOf(region).length + 1}`,
      roles: ["label"],
      labelKind: "zone"
    });
    onCommand({
      kind: "CreateRegionVolume",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-volume",
        subjectId: volume.volumeId
      },
      payload: { volume }
    });
    onSelect([volume.volumeId]);
  }, [onCommand, onSelect, region]);

  const parentOptions = useMemo(() => {
    if (!selectedVolume) return [];
    return volumes
      .filter((v) => v.volumeId !== selectedVolume.volumeId)
      .map((v) => ({ value: v.volumeId, label: v.displayName }));
  }, [selectedVolume, volumes]);

  const setBoundsAxis = useCallback(
    (
      axis: "centerX" | "centerZ" | "width" | "depth",
      value: number,
      bounds: RegionAreaBounds
    ) => {
      const next: RegionAreaBounds = {
        kind: "box",
        center: [...bounds.center] as [number, number, number],
        size: [...bounds.size] as [number, number, number]
      };
      if (axis === "centerX") next.center[0] = value;
      if (axis === "centerZ") next.center[2] = value;
      if (axis === "width") next.size[0] = Math.max(1, value);
      if (axis === "depth") next.size[2] = Math.max(1, value);
      updateVolume({ bounds: next });
    },
    [updateVolume]
  );

  return {
    leftPanel: region ? (
      <>
      <PanelSection
        title="Volumes"
        icon="🗺️"
        actions={
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label="Add volume"
            onClick={createVolume}
          >
            ＋
          </ActionIcon>
        }
      >
        <Stack gap="xs">
          {volumes.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)">
              No volumes yet.
            </Text>
          ) : (
            volumes.map((volume) => {
              const isSelected = volume.volumeId === effectiveSelectedId;
              const isHidden = hiddenVolumeIds.includes(volume.volumeId);
              return (
                <Group
                  key={volume.volumeId}
                  gap={4}
                  wrap="nowrap"
                  style={{
                    border: "1px solid var(--sm-panel-border)",
                    borderRadius: "var(--sm-radius-sm)",
                    padding: "4px 6px 4px 10px",
                    background: isSelected
                      ? "var(--sm-active-bg)"
                      : "var(--sm-color-surface0)"
                  }}
                >
                  <UnstyledButton
                    onClick={() => onSelect([volume.volumeId])}
                    style={{ flex: 1, minWidth: 0, padding: "4px 0" }}
                  >
                    <Stack gap={2}>
                      <Text
                        size="sm"
                        fw={isSelected ? 600 : 500}
                        c={
                          isSelected
                            ? "var(--sm-accent-blue)"
                            : "var(--sm-color-text)"
                        }
                        truncate
                      >
                        {volume.displayName}
                      </Text>
                      <Text size="xs" c="var(--sm-color-overlay0)" truncate>
                        {volume.roles.length > 0
                          ? volume.roles.join(" · ")
                          : "no roles"}
                      </Text>
                    </Stack>
                  </UnstyledButton>
                  <VolumeColorControl
                    value={volume.color}
                    onChange={(color) => setVolumeColor(volume.volumeId, color)}
                  />
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="gray"
                    aria-label={isHidden ? "Show volume" : "Hide volume"}
                    style={{ flexShrink: 0, opacity: isHidden ? 0.4 : 1 }}
                    onClick={() =>
                      viewportStore.getState().toggleVolumeHidden(volume.volumeId)
                    }
                  >
                    {isHidden ? "🙈" : "👁"}
                  </ActionIcon>
                </Group>
              );
            })
          )}
        </Stack>
      </PanelSection>
      {onBakeNavMesh ? (
        <PanelSection title="NavMesh" icon="🧭">
          <Stack gap="xs">
            <Text
              size="xs"
              c={
                !region.navMesh
                  ? "var(--sm-color-overlay0)"
                  : navMeshStale
                    ? "var(--sm-accent-yellow, #f9e2af)"
                    : "var(--sm-accent-green, #a6e3a1)"
              }
            >
              {!region.navMesh
                ? "Not baked"
                : navMeshStale
                  ? "Stale — edits postdate the bake"
                  : "Baked"}
            </Text>
            <Button
              size="xs"
              variant={navMeshStale ? "filled" : "light"}
              color={navMeshStale ? "yellow" : undefined}
              loading={baking}
              onClick={async () => {
                setBaking(true);
                try {
                  await onBakeNavMesh();
                } finally {
                  setBaking(false);
                }
              }}
            >
              {region.navMesh ? "Rebake NavMesh" : "Bake NavMesh"}
            </Button>
          </Stack>
        </PanelSection>
      ) : null}
      </>
    ) : null,
    rightPanel: region ? (
      <Inspector
        selectionLabel={selectedVolume?.displayName ?? region.displayName}
      >
        {selectedVolume ? (
          <Stack gap="md">
            <TextInput
              label="Display Name"
              size="xs"
              value={selectedVolume.displayName}
              onChange={(event) =>
                updateVolume({ displayName: event.currentTarget.value })
              }
            />

            <Stack gap={4}>
              <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
                Roles
              </Text>
              <Checkbox.Group
                value={selectedVolume.roles}
                onChange={(value) =>
                  updateVolume({ roles: value as RegionVolumeRole[] })
                }
              >
                <Stack gap={4}>
                  {VOLUME_ROLE_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.value}
                      value={option.value}
                      label={option.label}
                      size="xs"
                    />
                  ))}
                </Stack>
              </Checkbox.Group>
            </Stack>

            {selectedVolume.roles.includes("label") && (
              <Stack gap="xs">
                <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                  Label
                </Text>
                <Select
                  label="Kind"
                  size="xs"
                  data={AREA_KIND_OPTIONS}
                  value={selectedVolume.labelKind ?? "zone"}
                  onChange={(value) =>
                    value && updateVolume({ labelKind: value as RegionAreaKind })
                  }
                />
                <TextInput
                  label="Lore Page ID"
                  size="xs"
                  placeholder="root.locations.station.exterior"
                  value={selectedVolume.lorePageId ?? ""}
                  onChange={(event) =>
                    updateVolume({
                      lorePageId: event.currentTarget.value || null
                    })
                  }
                />
              </Stack>
            )}

            {selectedVolume.roles.includes("trigger") && (
              <Stack gap="xs">
                <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                  Trigger
                </Text>
                <Select
                  label="Timing"
                  size="xs"
                  data={TRIGGER_TIMING_OPTIONS}
                  value={selectedVolume.trigger?.timing ?? "on-enter"}
                  onChange={(value) =>
                    value &&
                    updateVolume({
                      trigger: {
                        timing: value as RegionVolumeTriggerTiming,
                        action: selectedVolume.trigger?.action ?? {
                          audioCueId: null,
                          setWorldFlag: null
                        }
                      }
                    })
                  }
                />
                <TextInput
                  label="Audio Cue ID"
                  size="xs"
                  value={selectedVolume.trigger?.action.audioCueId ?? ""}
                  onChange={(event) =>
                    updateVolume({
                      trigger: {
                        timing: selectedVolume.trigger?.timing ?? "on-enter",
                        action: {
                          audioCueId: event.currentTarget.value || null,
                          setWorldFlag:
                            selectedVolume.trigger?.action.setWorldFlag ?? null
                        }
                      }
                    })
                  }
                />
                {/* Flag assignment fires only on the on-enter edge; "always"
                    is the continuous ambient bed and runs no actions — hide
                    the fields so an inert flag can't be authored. */}
                {(selectedVolume.trigger?.timing ?? "on-enter") ===
                  "on-enter" && (
                <Group grow>
                  <TextInput
                    label="Set Flag Key"
                    size="xs"
                    value={
                      selectedVolume.trigger?.action.setWorldFlag?.key ?? ""
                    }
                    onChange={(event) =>
                      updateVolume({
                        trigger: {
                          timing: selectedVolume.trigger?.timing ?? "on-enter",
                          action: {
                            audioCueId:
                              selectedVolume.trigger?.action.audioCueId ?? null,
                            setWorldFlag: event.currentTarget.value
                              ? {
                                  key: event.currentTarget.value,
                                  valueType:
                                    selectedVolume.trigger?.action.setWorldFlag
                                      ?.valueType ?? "boolean",
                                  value:
                                    selectedVolume.trigger?.action.setWorldFlag
                                      ?.value ?? "true"
                                }
                              : null
                          }
                        }
                      })
                    }
                  />
                  <TextInput
                    label="Value"
                    size="xs"
                    value={
                      selectedVolume.trigger?.action.setWorldFlag?.value ?? ""
                    }
                    disabled={!selectedVolume.trigger?.action.setWorldFlag?.key}
                    onChange={(event) =>
                      selectedVolume.trigger?.action.setWorldFlag?.key &&
                      updateVolume({
                        trigger: {
                          timing: selectedVolume.trigger.timing,
                          action: {
                            audioCueId:
                              selectedVolume.trigger.action.audioCueId,
                            setWorldFlag: {
                              key: selectedVolume.trigger.action.setWorldFlag
                                .key,
                              valueType:
                                selectedVolume.trigger.action.setWorldFlag
                                  .valueType,
                              value: event.currentTarget.value
                            }
                          }
                        }
                      })
                    }
                  />
                </Group>
                )}
              </Stack>
            )}

            {(selectedVolume.roles.includes("blocker") ||
              selectedVolume.roles.includes("containment-boundary")) && (
              <Stack gap="xs">
                <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                  Blocking
                </Text>
                <Select
                  label="Direction"
                  size="xs"
                  data={BLOCK_DIRECTION_OPTIONS}
                  // Display fallback MUST match the runtime default for a
                  // null blockDirection (collision addVolumeColliders):
                  // containment retains ("out"), blocker repels ("in").
                  value={
                    selectedVolume.blockDirection ??
                    (selectedVolume.roles.includes("containment-boundary")
                      ? "out"
                      : "in")
                  }
                  onChange={(value) =>
                    value &&
                    updateVolume({
                      blockDirection: value as RegionVolumeBlockDirection
                    })
                  }
                />
                {selectedVolume.roles.includes("containment-boundary") && (
                  <Group grow>
                    <TextInput
                      label="Open when flag"
                      size="xs"
                      placeholder="boss_defeated"
                      value={
                        selectedVolume.condition?.worldFlagEquals?.key ?? ""
                      }
                      onChange={(event) =>
                        updateVolume({
                          condition: {
                            questDefinitionId:
                              selectedVolume.condition?.questDefinitionId ??
                              null,
                            questStageId:
                              selectedVolume.condition?.questStageId ?? null,
                            worldFlagEquals: event.currentTarget.value
                              ? {
                                  key: event.currentTarget.value,
                                  valueType:
                                    selectedVolume.condition?.worldFlagEquals
                                      ?.valueType ?? "boolean",
                                  value:
                                    selectedVolume.condition?.worldFlagEquals
                                      ?.value ?? "true"
                                }
                              : null
                          }
                        })
                      }
                    />
                    <TextInput
                      label="equals"
                      size="xs"
                      value={
                        selectedVolume.condition?.worldFlagEquals?.value ?? ""
                      }
                      disabled={
                        !selectedVolume.condition?.worldFlagEquals?.key
                      }
                      onChange={(event) =>
                        selectedVolume.condition?.worldFlagEquals?.key &&
                        updateVolume({
                          condition: {
                            questDefinitionId:
                              selectedVolume.condition.questDefinitionId,
                            questStageId:
                              selectedVolume.condition.questStageId,
                            worldFlagEquals: {
                              key: selectedVolume.condition.worldFlagEquals.key,
                              valueType:
                                selectedVolume.condition.worldFlagEquals
                                  .valueType,
                              value: event.currentTarget.value
                            }
                          }
                        })
                      }
                    />
                  </Group>
                )}
              </Stack>
            )}

            {selectedVolume.roles.includes("non-walkable") && (
              <NumberInput
                label="Nav Cost"
                size="xs"
                min={0}
                step={1}
                value={selectedVolume.navCost ?? 1}
                onChange={(value) =>
                  typeof value === "number" && updateVolume({ navCost: value })
                }
              />
            )}

            <Select
              label="Parent Volume"
              size="xs"
              clearable
              data={parentOptions}
              value={selectedVolume.parentVolumeId}
              onChange={(value) =>
                updateVolume({ parentVolumeId: value ?? null })
              }
            />

            <Group grow>
              <NumberInput
                label="Center X"
                size="xs"
                step={1}
                value={selectedVolume.bounds.center[0]}
                onChange={(value) =>
                  typeof value === "number" &&
                  setBoundsAxis("centerX", value, selectedVolume.bounds)
                }
              />
              <NumberInput
                label="Center Z"
                size="xs"
                step={1}
                value={selectedVolume.bounds.center[2]}
                onChange={(value) =>
                  typeof value === "number" &&
                  setBoundsAxis("centerZ", value, selectedVolume.bounds)
                }
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Width"
                size="xs"
                step={1}
                min={1}
                value={selectedVolume.bounds.size[0]}
                onChange={(value) =>
                  typeof value === "number" &&
                  setBoundsAxis("width", value, selectedVolume.bounds)
                }
              />
              <NumberInput
                label="Depth"
                size="xs"
                step={1}
                min={1}
                value={selectedVolume.bounds.size[2]}
                onChange={(value) =>
                  typeof value === "number" &&
                  setBoundsAxis("depth", value, selectedVolume.bounds)
                }
              />
            </Group>
            <Text size="xs" c="var(--sm-color-overlay0)">
              Vertical extent is generated automatically behind the scenes for
              runtime spatial resolution.
            </Text>

            <Button
              color="red"
              variant="light"
              onClick={() => {
                onCommand({
                  kind: "DeleteRegionVolume",
                  target: {
                    aggregateKind: "region-document",
                    aggregateId: region.identity.id
                  },
                  subject: {
                    subjectKind: "region-volume",
                    subjectId: selectedVolume.volumeId
                  },
                  payload: { volumeId: selectedVolume.volumeId }
                });
                onSelect([]);
              }}
            >
              Delete Volume
            </Button>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a volume or draw a new rectangle in the viewport.
          </Text>
        )}
      </Inspector>
    ) : null,
    viewportOverlay: region ? (
      <>
        <ViewportToolbar
          items={spatialTools}
          activeId={activeTool}
          onSelect={(id) =>
            viewportStore.getState().setActiveSpatialTool(id as SpatialTool)
          }
        />
        <ViewportViewToggleBar
          toggles={[
            {
              id: "show-colliders",
              label: `${showColliders ? "Hide" : "Show"} colliders`,
              icon: "▨",
              active: showColliders,
              onToggle: () =>
                viewportStore.getState().setShowColliders(!showColliders)
            },
            {
              id: "show-navmesh",
              label: `${showNavMesh ? "Hide" : "Show"} navmesh`,
              icon: "🧭",
              active: showNavMesh,
              onToggle: () =>
                viewportStore.getState().setShowNavMesh(!showNavMesh)
            }
          ]}
        />
        <LayoutOrientationWidget quaternion={cameraQuaternion} />
      </>
    ) : null
  };
}
