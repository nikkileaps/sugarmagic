/**
 * SpatialWorkspaceView: the React view for Build > Spatial.
 *
 * Owns the authored-area list, inspector, and tool chrome. Spatial visuals,
 * hit testing, and draw interactions live in the Studio viewport overlay layer
 * and are accessed through a narrow registry seam.
 */

import { useEffect, useMemo, useCallback } from "react";
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
  createRegionAreaDefinition,
  createRegionAreaId
} from "@sugarmagic/domain";
import {
  Inspector,
  PanelSection,
  ViewportToolbar,
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

type SpatialTool = "select" | "draw-rect";

const spatialTools: ViewportToolbarItem[] = [
  { id: "select", label: "Select", icon: "↖", shortcut: "V" },
  { id: "draw-rect", label: "Draw Area", icon: "▭", shortcut: "D" }
];

export interface SpatialWorkspaceViewProps {
  isActive: boolean;
  getViewportElement: () => HTMLElement | null;
  viewportStore: ViewportStore;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
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
  const {
    isActive,
    getViewportElement,
    viewportStore,
    selectedIds,
    onSelect,
    region,
    onCommand
  } = props;
  const activeTool = useVanillaStoreSelector(
    viewportStore,
    (state) => state.activeSpatialTool
  );
  const cameraQuaternion = useVanillaStoreSelector(
    viewportStore,
    (state) => state.cameraQuaternion
  );

  const effectiveSelectedAreaId = useMemo(() => {
    if (!region) return null;
    const selectedAreaId = selectedIds[0] ?? null;
    if (selectedAreaId && region.areas.some((area) => area.areaId === selectedAreaId)) {
      return selectedAreaId;
    }
    return region.areas[0]?.areaId ?? null;
  }, [region, selectedIds]);

  useEffect(() => {
    if (!isActive) return;
    getSpatialWorkspaceForViewport(getViewportElement())?.setDrawingEnabled(
      activeTool === "draw-rect"
    );
  }, [activeTool, getViewportElement, isActive]);

  useEffect(() => {
    if (!isActive) return;
    getSpatialWorkspaceForViewport(getViewportElement())?.syncAreas();
  }, [effectiveSelectedAreaId, getViewportElement, isActive, region]);

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
    onSelect([area.areaId]);
  }, [onCommand, onSelect, region]);

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
                    onSelect([area.areaId]);
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
                onSelect([]);
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
          onSelect={(id) =>
            viewportStore.getState().setActiveSpatialTool(id as SpatialTool)
          }
        />
        <LayoutOrientationWidget quaternion={cameraQuaternion} />
      </>
    ) : null
  };
}
