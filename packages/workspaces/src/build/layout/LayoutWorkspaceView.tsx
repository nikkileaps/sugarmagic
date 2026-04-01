/**
 * LayoutWorkspaceView: the React view for Build > Layout.
 *
 * Owns: gizmo lifecycle, input routing, scene explorer, inspector,
 * viewport toolbar. Plugs into the shell via WorkspaceViewContribution.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { SemanticCommand } from "@sugarmagic/domain";
import { getActiveRegion } from "@sugarmagic/domain";
import type { RuntimeViewport } from "@sugarmagic/runtime-web";
import {
  PanelSection,
  SceneExplorer,
  Inspector,
  TransformInspector,
  ViewportToolbar,
  type SceneExplorerNode,
  type ViewportToolbarItem
} from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { createLayoutWorkspace, type LayoutWorkspaceInstance } from "./layout-workspace";
import type { TransformTool } from "../../interaction/tool-state";

const transformTools: ViewportToolbarItem[] = [
  { id: "move", label: "Move", icon: "✥", shortcut: "G" },
  { id: "rotate", label: "Rotate", icon: "↻", shortcut: "R" },
  { id: "scale", label: "Scale", icon: "⤢", shortcut: "S" }
];

export interface LayoutWorkspaceViewProps {
  getViewport: () => RuntimeViewport | null;
  getViewportElement: () => HTMLElement | null;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
  getSelectedId: () => string | null;
  getRegion: () => ReturnType<typeof getActiveRegion>;
}

export function useLayoutWorkspaceView(
  props: LayoutWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    getViewport,
    getViewportElement,
    selectedIds,
    onSelect,
    onCommand,
    getSelectedId,
    getRegion
  } = props;

  const [activeTool, setActiveTool] = useState<TransformTool>("move");
  const layoutRef = useRef<LayoutWorkspaceInstance | null>(null);

  // --- Layout workspace lifecycle ---
  useEffect(() => {
    const viewport = getViewport();
    const viewportElement = getViewportElement();
    if (!viewport || !viewportElement) return;

    const layout = createLayoutWorkspace({
      onCommand,
      onSelect,
      onPreviewTransform: (id, pos, rot, scl) =>
        viewport.previewTransform(id, pos, rot, scl),
      getSelectedId,
      getRegion
    });

    layout.attach(
      viewportElement,
      viewport.camera,
      viewport.authoredRoot,
      viewport.overlayRoot
    );
    layoutRef.current = layout;

    const unsubTool = layout.toolState.subscribe((s) =>
      setActiveTool(s.activeTool)
    );

    return () => {
      unsubTool();
      layout.detach();
      layoutRef.current = null;
    };
  }, [getViewport, getViewportElement]);

  // --- Sync overlays when selection changes ---
  useEffect(() => {
    layoutRef.current?.syncOverlays();
  }, [selectedIds]);

  const region = getRegion();

  const explorerRoots: SceneExplorerNode[] = useMemo(() => {
    if (!region) return [];
    const entities: SceneExplorerNode[] = region.scene.placedAssets.map(
      (a: { instanceId: string; assetDefinitionId: string }) => ({
        type: "entity" as const,
        instanceId: a.instanceId,
        displayName: a.instanceId,
        assetKind: a.assetDefinitionId,
        visible: true
      })
    );
    return [
      {
        type: "folder" as const,
        folderId: "scene-root",
        displayName: "Scene",
        children: entities
      }
    ];
  }, [region]);

  const selectedAsset = useMemo(() => {
    if (!region || selectedIds.length !== 1) return null;
    return (
      region.scene.placedAssets.find(
        (a: { instanceId: string }) => a.instanceId === selectedIds[0]
      ) ?? null
    );
  }, [region, selectedIds]);

  const handleMoveAsset = useCallback(
    (instanceId: string, axis: 0 | 1 | 2, value: number) => {
      const r = getRegion();
      if (!r) return;
      const asset = r.scene.placedAssets.find(
        (a: { instanceId: string }) => a.instanceId === instanceId
      );
      if (!asset) return;
      const newPosition: [number, number, number] = [
        ...asset.transform.position
      ];
      newPosition[axis] = value;
      onCommand({
        kind: "MovePlacedAsset",
        target: {
          aggregateKind: "region-document",
          aggregateId: r.identity.id
        },
        subject: { subjectKind: "placed-asset", subjectId: instanceId },
        payload: { instanceId, position: newPosition }
      });
    },
    [getRegion, onCommand]
  );

  return {
    leftPanel: region ? (
      <PanelSection title="Scene Explorer" icon="🏗️">
        <SceneExplorer
          roots={explorerRoots}
          selectedIds={selectedIds}
          onSelect={(id) => onSelect([id])}
        />
      </PanelSection>
    ) : null,

    rightPanel: region ? (
      <Inspector selectionLabel={selectedAsset?.instanceId ?? null}>
        {selectedAsset && (
          <TransformInspector
            label="Position"
            position={selectedAsset.transform.position}
            onMove={(axis, value) =>
              handleMoveAsset(selectedAsset.instanceId, axis, value)
            }
          />
        )}
      </Inspector>
    ) : null,

    viewportOverlay: region ? (
      <ViewportToolbar
        items={transformTools}
        activeId={activeTool}
        onSelect={(id) => {
          const tool = id as TransformTool;
          setActiveTool(tool);
          layoutRef.current?.toolState.setActiveTool(tool);
        }}
      />
    ) : null
  };
}
