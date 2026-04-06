import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  RegionAreaKind,
  RegionDocument,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  createRegionAreaBounds,
  createRegionAreaDefinition,
  createRegionAreaId
} from "@sugarmagic/domain";
import {
  Inspector,
  PanelSection,
  ViewportToolbar,
  type ViewportToolbarItem
} from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";
import type { WorkspaceViewport } from "../../viewport";
import { LayoutOrientationWidget } from "../layout/LayoutOrientationWidget";
import { createSpatialWorkspace, type SpatialWorkspaceInstance } from "./spatial-workspace";
import { createSpatialCameraController } from "./spatial-camera-controller";
import * as THREE from "three";

const AREA_KIND_OPTIONS: Array<{ value: RegionAreaKind; label: string }> = [
  { value: "zone", label: "Zone" },
  { value: "interior", label: "Interior" },
  { value: "exterior", label: "Exterior" },
  { value: "room", label: "Room" },
  { value: "stall", label: "Stall" },
  { value: "platform", label: "Platform" },
  { value: "shop", label: "Shop" }
];

type SpatialTool = "select" | "draw-rect";

const spatialTools: ViewportToolbarItem[] = [
  { id: "select", label: "Select", icon: "↖", shortcut: "V" },
  { id: "draw-rect", label: "Draw Area", icon: "▭", shortcut: "D" }
];

export interface SpatialWorkspaceViewProps {
  isActive: boolean;
  viewportReadyVersion: number;
  getViewport: () => WorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  region: RegionDocument | null;
  onCommand: (command: SemanticCommand) => void;
}

function nextAreaName(region: RegionDocument): string {
  return `Area ${region.areas.length + 1}`;
}

function toAreaParentOptions(region: RegionDocument, selectedAreaId: string | null) {
  return region.areas
    .filter((area) => area.areaId !== selectedAreaId)
    .map((area) => ({ value: area.areaId, label: area.displayName }));
}

export function useSpatialWorkspaceView(
  props: SpatialWorkspaceViewProps
): WorkspaceViewContribution {
  const { isActive, viewportReadyVersion, getViewport, getViewportElement, region, onCommand } = props;
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<SpatialTool>("select");
  const [cameraQuaternion, setCameraQuaternion] = useState<[number, number, number, number]>([0, 0, 0, 1]);
  const workspaceRef = useRef<SpatialWorkspaceInstance | null>(null);
  const cameraControllerRef = useRef(createSpatialCameraController());
  const getViewportRef = useRef(getViewport);
  const getViewportElementRef = useRef(getViewportElement);
  const regionRef = useRef(region);
  const selectedAreaIdRef = useRef<string | null>(null);
  const onCommandRef = useRef(onCommand);
  const drawingEnabledRef = useRef(false);

  useEffect(() => {
    getViewportRef.current = getViewport;
    getViewportElementRef.current = getViewportElement;
  }, [getViewport, getViewportElement]);

  useEffect(() => {
    regionRef.current = region;
    onCommandRef.current = onCommand;
  }, [onCommand, region]);

  useEffect(() => {
    drawingEnabledRef.current = activeTool === "draw-rect";
  }, [activeTool]);

  const effectiveSelectedAreaId = useMemo(() => {
    if (!region) return null;
    if (selectedAreaId && region.areas.some((area) => area.areaId === selectedAreaId)) {
      return selectedAreaId;
    }
    return region.areas[0]?.areaId ?? null;
  }, [region, selectedAreaId]);

  useEffect(() => {
    selectedAreaIdRef.current = effectiveSelectedAreaId;
  }, [effectiveSelectedAreaId]);

  useEffect(() => {
    if (!isActive) return;

    const viewport = getViewportRef.current();
    const viewportElement = getViewportElementRef.current();
    if (!viewport || !viewportElement) return;

    viewport.setProjectionMode("orthographic-top");

    const workspace = createSpatialWorkspace({
      getAreas: () => regionRef.current?.areas ?? [],
      getSelectedAreaId: () => selectedAreaIdRef.current,
      onCreateAreaRectangle: ({ minX, minZ, maxX, maxZ }) => {
        const activeRegion = regionRef.current;
        const activeAreaId = selectedAreaIdRef.current;
        if (!activeRegion || !activeAreaId) return;
        const activeArea = activeRegion.areas.find((area) => area.areaId === activeAreaId);
        if (!activeArea) return;
        const width = maxX - minX;
        const depth = maxZ - minZ;
        const centerX = minX + width / 2;
        const centerZ = minZ + depth / 2;
        onCommandRef.current({
          kind: "UpdateRegionArea",
          target: {
            aggregateKind: "region-document",
            aggregateId: activeRegion.identity.id
          },
          subject: {
            subjectKind: "region-area",
            subjectId: activeAreaId
          },
          payload: {
            areaId: activeAreaId,
            bounds: createRegionAreaBounds({
              center: [centerX, activeArea.bounds.center[1], centerZ],
              size: [width, activeArea.bounds.size[1], depth]
            })
          }
        });
      }
    });

    workspace.attach(
      viewportElement,
      viewport.camera,
      viewport.authoredRoot,
      viewport.overlayRoot,
      viewport.surfaceRoot
    );
    workspace.setDrawingEnabled(drawingEnabledRef.current);
    workspace.syncAreas();
    workspaceRef.current = workspace;

    const cameraController = cameraControllerRef.current;
    cameraController.attach(viewport.camera, viewportElement, viewport.subscribeFrame);

    return () => {
      cameraController.detach();
      workspace.detach();
      viewport.setProjectionMode("perspective");
      workspaceRef.current = null;
    };
  }, [isActive, viewportReadyVersion]);

  useEffect(() => {
    if (!isActive) return;

    const viewport = getViewportRef.current();
    if (!viewport) return;

    const lastQuaternion = new THREE.Quaternion();
    const syncOrientation = () => {
      const current = viewport.camera.quaternion;
      if (lastQuaternion.angleTo(current) < 0.0001) return;
      lastQuaternion.copy(current);
      setCameraQuaternion([current.x, current.y, current.z, current.w]);
    };

    syncOrientation();
    return viewport.subscribeFrame(syncOrientation);
  }, [isActive, viewportReadyVersion]);

  useEffect(() => {
    workspaceRef.current?.setDrawingEnabled(activeTool === "draw-rect");
  }, [activeTool]);

  useEffect(() => {
    workspaceRef.current?.syncAreas();
  }, [effectiveSelectedAreaId, region]);

  const selectedArea = useMemo(() => {
    if (!region || !effectiveSelectedAreaId) return null;
    return region.areas.find((area) => area.areaId === effectiveSelectedAreaId) ?? null;
  }, [effectiveSelectedAreaId, region]);

  const updateArea = useCallback((payload: Omit<Extract<SemanticCommand, { kind: "UpdateRegionArea" }>['payload'], 'areaId'>) => {
    if (!region || !selectedArea) return;
    onCommand({
      kind: "UpdateRegionArea",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-area",
        subjectId: selectedArea.areaId
      },
      payload: {
        areaId: selectedArea.areaId,
        ...payload
      }
    });
  }, [onCommand, region, selectedArea]);

  const createDefaultArea = useCallback(() => {
    if (!region) return;
    const area = createRegionAreaDefinition({
      areaId: createRegionAreaId(),
      displayName: nextAreaName(region)
    });
    onCommand({
      kind: "CreateRegionArea",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-area",
        subjectId: area.areaId
      },
      payload: {
        areaId: area.areaId,
        displayName: area.displayName,
        lorePageId: area.lorePageId,
        parentAreaId: area.parentAreaId,
        kind: area.kind,
        bounds: area.bounds
      }
    });
    setSelectedAreaId(area.areaId);
  }, [onCommand, region]);

  return {
    leftPanel: region ? (
      <PanelSection
        title="Areas"
        icon="🗺️"
        actions={
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Add area"
              onClick={createDefaultArea}
            >
              ＋
            </ActionIcon>
          </Group>
        }
      >
        <Stack gap="xs">
          <Text size="xs" c="var(--sm-color-overlay0)">
            {activeTool === "draw-rect"
              ? selectedArea
                ? "Drag in the viewport to define the selected area's snapped rectangle."
                : "Create or select an area first, then drag in the viewport to define it."
              : "Create or select an area, then use the rectangle tool in the HUD to define it."}
          </Text>
          {region.areas.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)">
              No authored areas yet.
            </Text>
          ) : (
            region.areas.map((area) => {
              const isSelected = area.areaId === effectiveSelectedAreaId;
              return (
                <UnstyledButton
                  key={area.areaId}
                  onClick={() => {
                    setSelectedAreaId(area.areaId);
                  }}
                  style={{
                    border: "1px solid var(--sm-panel-border)",
                    borderRadius: "var(--sm-radius-sm)",
                    padding: "8px 10px",
                    background: isSelected ? "var(--sm-active-bg)" : "var(--sm-color-surface0)",
                    color: isSelected ? "var(--sm-accent-blue)" : "var(--sm-color-text)"
                  }}
                >
                  <Stack gap={2}>
                    <Text size="sm" fw={isSelected ? 600 : 500}>{area.displayName}</Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {area.kind}
                    </Text>
                  </Stack>
                </UnstyledButton>
              );
            })
          )}
        </Stack>
      </PanelSection>
    ) : null,
    rightPanel: region ? (
      <Inspector selectionLabel={selectedArea?.displayName ?? region.displayName}>
        {selectedArea ? (
          <Stack gap="md">
            <Text size="sm" fw={600}>Area</Text>
            <TextInput
              label="Display Name"
              size="xs"
              value={selectedArea.displayName}
              onChange={(event) => updateArea({ displayName: event.currentTarget.value })}
            />
            <Select
              label="Kind"
              size="xs"
              data={AREA_KIND_OPTIONS}
              value={selectedArea.kind}
              onChange={(value) => {
                if (!value) return;
                updateArea({ kind: value as RegionAreaKind });
              }}
            />
            <TextInput
              label="Lore Page ID"
              size="xs"
              placeholder="root.locations.station.exterior"
              value={selectedArea.lorePageId ?? ""}
              onChange={(event) => updateArea({ lorePageId: event.currentTarget.value })}
            />
            <Select
              label="Parent Area"
              size="xs"
              clearable
              data={toAreaParentOptions(region, selectedArea.areaId)}
              value={selectedArea.parentAreaId}
              onChange={(value) => updateArea({ parentAreaId: value ?? null })}
            />
            <Group grow>
              <NumberInput
                label="Center X"
                size="xs"
                step={1}
                value={selectedArea.bounds.center[0]}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateArea({
                    bounds: {
                      ...selectedArea.bounds,
                      center: [value, selectedArea.bounds.center[1], selectedArea.bounds.center[2]]
                    }
                  });
                }}
              />
              <NumberInput
                label="Center Z"
                size="xs"
                step={1}
                value={selectedArea.bounds.center[2]}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateArea({
                    bounds: {
                      ...selectedArea.bounds,
                      center: [selectedArea.bounds.center[0], selectedArea.bounds.center[1], value]
                    }
                  });
                }}
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Width"
                size="xs"
                step={1}
                min={1}
                value={selectedArea.bounds.size[0]}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateArea({
                    bounds: {
                      ...selectedArea.bounds,
                      size: [Math.max(1, value), selectedArea.bounds.size[1], selectedArea.bounds.size[2]]
                    }
                  });
                }}
              />
              <NumberInput
                label="Depth"
                size="xs"
                step={1}
                min={1}
                value={selectedArea.bounds.size[2]}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateArea({
                    bounds: {
                      ...selectedArea.bounds,
                      size: [selectedArea.bounds.size[0], selectedArea.bounds.size[1], Math.max(1, value)]
                    }
                  });
                }}
              />
            </Group>
            <Text size="xs" c="var(--sm-color-overlay0)">
              Vertical extent is generated automatically behind the scenes for runtime spatial resolution.
            </Text>
            <Button
              color="red"
              variant="light"
              onClick={() => {
                onCommand({
                  kind: "DeleteRegionArea",
                  target: {
                    aggregateKind: "region-document",
                    aggregateId: region.identity.id
                  },
                  subject: {
                    subjectKind: "region-area",
                    subjectId: selectedArea.areaId
                  },
                  payload: {
                    areaId: selectedArea.areaId
                  }
                });
                setSelectedAreaId(null);
              }}
            >
              Delete Area
            </Button>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select an authored area or draw a new rectangle in the viewport.
          </Text>
        )}
      </Inspector>
    ) : null,
    viewportOverlay: region ? (
      <>
        <ViewportToolbar
          items={spatialTools}
          activeId={activeTool}
          onSelect={(id) => setActiveTool(id as SpatialTool)}
        />
        <LayoutOrientationWidget quaternion={cameraQuaternion} />
      </>
    ) : null
  };
}
