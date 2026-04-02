/**
 * LayoutWorkspaceView: the React view for Build > Layout.
 *
 * Owns: gizmo lifecycle, input routing, scene explorer, inspector,
 * viewport toolbar. Plugs into the shell via WorkspaceViewContribution.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { ActionIcon, Box, Stack, Text, UnstyledButton } from "@mantine/core";
import type {
  AssetDefinition,
  SemanticCommand,
  RegionDocument
} from "@sugarmagic/domain";
import {
  getActiveRegion,
  createPlacedAssetInstanceId,
  createSceneFolderId
} from "@sugarmagic/domain";
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
import type { WorkspaceViewport } from "../../viewport";
import {
  createLayoutWorkspace,
  type LayoutWorkspaceInstance
} from "./layout-workspace";
import { createLayoutCameraController } from "./layout-camera-controller";
import { LayoutOrientationWidget } from "./LayoutOrientationWidget";
import type { TransformTool } from "../../interaction/tool-state";

const transformTools: ViewportToolbarItem[] = [
  { id: "move", label: "Move", icon: "✥", shortcut: "G" },
  { id: "rotate", label: "Rotate", icon: "↻", shortcut: "R" },
  { id: "scale", label: "Scale", icon: "⤢", shortcut: "S" }
];

export interface LayoutWorkspaceViewProps {
  isActive: boolean;
  viewportReadyVersion: number;
  getViewport: () => WorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
  getSelectedId: () => string | null;
  getRegion: () => ReturnType<typeof getActiveRegion>;
  onEditAssetDefinition: (definitionId: string) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
}

const SCENE_ROOT_FOLDER_ID = "__scene_root__";

function buildSceneTree(region: RegionDocument): SceneExplorerNode[] {
  const foldersByParent = new Map<string | null, RegionDocument["scene"]["folders"]>();
  const assetsByParent = new Map<string | null, RegionDocument["scene"]["placedAssets"]>();

  for (const folder of region.scene.folders) {
    const siblings = foldersByParent.get(folder.parentFolderId) ?? [];
    siblings.push(folder);
    foldersByParent.set(folder.parentFolderId, siblings);
  }

  for (const asset of region.scene.placedAssets) {
    const siblings = assetsByParent.get(asset.parentFolderId) ?? [];
    siblings.push(asset);
    assetsByParent.set(asset.parentFolderId, siblings);
  }

  const buildChildren = (parentFolderId: string | null): SceneExplorerNode[] => {
    const childFolders = (foldersByParent.get(parentFolderId) ?? []).map((folder) => ({
      type: "folder" as const,
      folderId: folder.folderId,
      displayName: folder.displayName,
      children: buildChildren(folder.folderId)
    }));

    const childAssets = (assetsByParent.get(parentFolderId) ?? []).map((asset) => ({
      type: "entity" as const,
      instanceId: asset.instanceId,
      displayName: asset.displayName,
      assetKind: asset.assetDefinitionId,
      assetDefinitionId: asset.assetDefinitionId,
      visible: true
    }));

    return [...childFolders, ...childAssets];
  };

  return [
    {
      type: "folder" as const,
      folderId: SCENE_ROOT_FOLDER_ID,
      displayName: region.displayName,
      isRoot: true,
      children: buildChildren(null)
    }
  ];
}

export function useLayoutWorkspaceView(
  props: LayoutWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    viewportReadyVersion,
    getViewport,
    getViewportElement,
    selectedIds,
    onSelect,
    onCommand,
    getSelectedId,
    getRegion,
    onEditAssetDefinition,
    onImportAsset
  } = props;

  const [activeTool, setActiveTool] = useState<TransformTool>("move");
  const [selectedFolderState, setSelectedFolderState] = useState<{
    regionId: string | null;
    folderId: string;
  }>({
    regionId: null,
    folderId: SCENE_ROOT_FOLDER_ID
  });
  const [cameraQuaternion, setCameraQuaternion] = useState<[number, number, number, number]>([0, 0, 0, 1]);
  const [contextMenu, setContextMenu] = useState<{
    instanceId: string;
    x: number;
    y: number;
  } | null>(null);

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<LayoutWorkspaceInstance | null>(null);
  const cameraControllerRef = useRef(createLayoutCameraController());
  const getViewportRef = useRef(getViewport);
  const getViewportElementRef = useRef(getViewportElement);
  const onCommandRef = useRef(onCommand);
  const onSelectRef = useRef(onSelect);
  const getSelectedIdRef = useRef(getSelectedId);
  const getRegionRef = useRef(getRegion);

  useEffect(() => {
    getViewportRef.current = getViewport;
    getViewportElementRef.current = getViewportElement;
    onCommandRef.current = onCommand;
    onSelectRef.current = onSelect;
    getSelectedIdRef.current = getSelectedId;
    getRegionRef.current = getRegion;
  }, [
    getViewport,
    getViewportElement,
    onCommand,
    onSelect,
    getSelectedId,
    getRegion
  ]);

  useEffect(() => {
    if (!isActive) return;

    const cameraController = cameraControllerRef.current;
    const viewport = getViewportRef.current();
    const viewportElement = getViewportElementRef.current();
    if (!viewport || !viewportElement) return;

    const layout = createLayoutWorkspace({
      onCommand: (command) => onCommandRef.current(command),
      onSelect: (ids) => onSelectRef.current(ids),
      onPreviewTransform: (id, pos, rot, scl) =>
        viewport.previewTransform(id, pos, rot, scl),
      getSelectedId: () => getSelectedIdRef.current(),
      getRegion: () => getRegionRef.current()
    });

    layout.attach(
      viewportElement,
      viewport.camera,
      viewport.authoredRoot,
      viewport.overlayRoot
    );
    cameraController.attach(
      viewport.camera,
      viewportElement,
      viewport.subscribeFrame
    );
    layout.syncOverlays();
    layoutRef.current = layout;

    const unsubTool = layout.toolState.subscribe((state) => {
      setActiveTool(state.activeTool);
    });

    return () => {
      unsubTool();
      cameraController.detach();
      layout.detach();
      layoutRef.current = null;
    };
  }, [isActive, viewportReadyVersion]);

  const region = getRegion();

  useEffect(() => {
    if (!isActive) return;
    layoutRef.current?.syncOverlays();
  }, [isActive, selectedIds, region]);

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
    if (!isActive) return;

    const viewportElement = getViewportElementRef.current();
    if (!viewportElement) return;
    const element = viewportElement;

    function handleContextMenu(event: MouseEvent) {
      const layout = layoutRef.current;
      if (!layout) return;

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const normalizedY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      const hit = layout.hitTestService.testSelect(normalizedX, normalizedY);

      if (!hit?.objectName) {
        setContextMenu(null);
        return;
      }

      event.preventDefault();

      if (selectedIds[0] !== hit.objectName) {
        onSelectRef.current([hit.objectName]);
      }

      setContextMenu({
        instanceId: hit.objectName,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
    }

    function handleCloseMenu(event: PointerEvent) {
      if (
        contextMenuRef.current &&
        event.target instanceof Node &&
        contextMenuRef.current.contains(event.target)
      ) {
        return;
      }

      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    element.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerdown", handleCloseMenu);
    window.addEventListener("keydown", handleEscape);

    return () => {
      element.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerdown", handleCloseMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isActive, viewportReadyVersion, selectedIds]);

  const selectedFolderId =
    selectedFolderState.regionId === (region?.identity.id ?? null)
      ? selectedFolderState.folderId
      : SCENE_ROOT_FOLDER_ID;

  const explorerRoots: SceneExplorerNode[] = useMemo(
    () => (region ? buildSceneTree(region) : []),
    [region]
  );

  const selectedAsset = useMemo(() => {
    if (!region || selectedIds.length !== 1) return null;
    return (
      region.scene.placedAssets.find(
        (asset) => asset.instanceId === selectedIds[0]
      ) ?? null
    );
  }, [region, selectedIds]);

  const handleTransformChange = useCallback(
    (
      instanceId: string,
      transformKind: "position" | "rotation" | "scale",
      axis: 0 | 1 | 2,
      value: number
    ) => {
      const currentRegion = getRegion();
      if (!currentRegion) return;
      const asset = currentRegion.scene.placedAssets.find(
        (candidate) => candidate.instanceId === instanceId
      );
      if (!asset) return;

      const nextPosition: [number, number, number] = [...asset.transform.position];
      const nextRotation: [number, number, number] = [...asset.transform.rotation];
      const nextScale: [number, number, number] = [...asset.transform.scale];

      if (transformKind === "position") nextPosition[axis] = value;
      if (transformKind === "rotation") nextRotation[axis] = value;
      if (transformKind === "scale") nextScale[axis] = value;

      onCommand({
        kind: "TransformPlacedAsset",
        target: {
          aggregateKind: "region-document",
          aggregateId: currentRegion.identity.id
        },
        subject: { subjectKind: "placed-asset", subjectId: instanceId },
        payload: {
          instanceId,
          position: nextPosition,
          rotation: nextRotation,
          scale: nextScale
        }
      });
    },
    [getRegion, onCommand]
  );

  const handleCreateFolder = useCallback(
    (parentFolderId: string | null) => {
      const currentRegion = getRegion();
      if (!currentRegion) return;
      const displayName = window.prompt("Folder name", "New Folder");
      if (!displayName?.trim()) return;
      const folderId = createSceneFolderId();

      onCommand({
        kind: "CreateSceneFolder",
        target: {
          aggregateKind: "region-document",
          aggregateId: currentRegion.identity.id
        },
        subject: { subjectKind: "scene-folder", subjectId: folderId },
        payload: {
          folderId,
          displayName: displayName.trim(),
          parentFolderId
        }
      });
    },
    [getRegion, onCommand]
  );

  const handleCreateFolderAtSelection = useCallback(() => {
    handleCreateFolder(
      selectedFolderId === SCENE_ROOT_FOLDER_ID ? null : selectedFolderId
    );
  }, [handleCreateFolder, selectedFolderId]);

  const handleRenameFolder = useCallback(
    (folderId: string, displayName: string) => {
      const currentRegion = getRegion();
      if (!currentRegion) return;
      onCommand({
        kind: "RenameSceneFolder",
        target: {
          aggregateKind: "region-document",
          aggregateId: currentRegion.identity.id
        },
        subject: { subjectKind: "scene-folder", subjectId: folderId },
        payload: { folderId, displayName }
      });
    },
    [getRegion, onCommand]
  );

  const handleDuplicateAsset = useCallback((instanceId: string) => {
    if (!region) return;
    const asset = region.scene.placedAssets.find(
      (candidate) => candidate.instanceId === instanceId
    );
    if (!asset) return;

    const duplicatedInstanceId = createPlacedAssetInstanceId(asset.displayName);
    onCommand({
      kind: "DuplicatePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "placed-asset",
        subjectId: duplicatedInstanceId
      },
      payload: {
        sourceInstanceId: asset.instanceId,
        duplicatedInstanceId,
        positionOffset: [1, 0, 1]
      }
    });
    onSelect([duplicatedInstanceId]);
  }, [onCommand, onSelect, region]);

  const handleRemoveAsset = useCallback((instanceId: string) => {
    if (!region) return;
    const asset = region.scene.placedAssets.find(
      (candidate) => candidate.instanceId === instanceId
    );
    if (!asset) return;
    if (!window.confirm(`Remove ${asset.displayName} from this scene?`)) {
      return;
    }

    onCommand({
      kind: "RemovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "placed-asset",
        subjectId: asset.instanceId
      },
      payload: {
        instanceId: asset.instanceId
      }
    });
    onSelect([]);
  }, [onCommand, onSelect, region]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    if (!region) return;
    if (!window.confirm("Delete this folder? Items inside it will move to the parent folder.")) {
      return;
    }

    onCommand({
      kind: "DeleteSceneFolder",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "scene-folder", subjectId: folderId },
      payload: { folderId }
    });

    if (selectedFolderId === folderId) {
      setSelectedFolderState({
        regionId: region.identity.id,
        folderId: SCENE_ROOT_FOLDER_ID
      });
    }
    onSelect([]);
  }, [onCommand, onSelect, region, selectedFolderId]);

  const handleEditEntityFromExplorer = useCallback((instanceId: string) => {
    if (!region) return;
    const asset = region.scene.placedAssets.find(
      (candidate) => candidate.instanceId === instanceId
    );
    if (!asset) return;
    onEditAssetDefinition(asset.assetDefinitionId);
  }, [onEditAssetDefinition, region]);

  const handleImportAssetFromExplorer = useCallback(async () => {
    if (!region) return;

    const importedAsset = await onImportAsset();
    if (!importedAsset) return;

    const instanceId = createPlacedAssetInstanceId(importedAsset.displayName);

    onCommand({
      kind: "PlaceAssetInstance",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "placed-asset",
        subjectId: instanceId
      },
      payload: {
        instanceId,
        assetDefinitionId: importedAsset.definitionId,
        displayName: importedAsset.displayName,
        parentFolderId:
          selectedFolderId === SCENE_ROOT_FOLDER_ID ? null : selectedFolderId,
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
    onSelect([instanceId]);
  }, [onCommand, onImportAsset, onSelect, region, selectedFolderId]);

  const handleSnapToOrigin = useCallback(() => {
    if (!region || !contextMenu) return;

    const asset = region.scene.placedAssets.find(
      (entry) => entry.instanceId === contextMenu.instanceId
    );
    if (!asset) return;

    onCommand({
      kind: "TransformPlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "placed-asset",
        subjectId: asset.instanceId
      },
      payload: {
        instanceId: asset.instanceId,
        position: [0, 0, 0],
        rotation: asset.transform.rotation,
        scale: asset.transform.scale
      }
    });

    setContextMenu(null);
  }, [contextMenu, onCommand, region]);

  return {
    leftPanel: region ? (
      <PanelSection
        title="Scene Explorer"
        icon="🏗️"
        actions={
          <>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Add asset"
              onClick={() => void handleImportAssetFromExplorer()}
            >
              📦
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Add folder"
              onClick={handleCreateFolderAtSelection}
            >
              📁
            </ActionIcon>
          </>
        }
      >
        <Stack gap="xs">
          <SceneExplorer
            roots={explorerRoots}
            selectedIds={selectedIds}
            selectedFolderId={selectedFolderId}
            onSelect={(id) => onSelect([id])}
            onSelectFolder={(folderId) => {
              setSelectedFolderState({
                regionId: region.identity.id,
                folderId
              });
              onSelect([]);
            }}
            onRenameFolder={handleRenameFolder}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
            onDuplicateEntity={handleDuplicateAsset}
            onEditEntity={handleEditEntityFromExplorer}
            onDeleteEntity={handleRemoveAsset}
          />
        </Stack>
      </PanelSection>
    ) : null,

    rightPanel: region ? (
      <Inspector selectionLabel={selectedAsset?.displayName ?? null}>
        {selectedAsset ? (
          <Stack gap="md">
            <TransformInspector
              label="Position"
              value={selectedAsset.transform.position}
              onChange={(axis, value) =>
                handleTransformChange(selectedAsset.instanceId, "position", axis, value)
              }
            />
            <TransformInspector
              label="Rotation"
              value={selectedAsset.transform.rotation}
              step={0.1}
              onChange={(axis, value) =>
                handleTransformChange(selectedAsset.instanceId, "rotation", axis, value)
              }
            />
            <TransformInspector
              label="Scale"
              value={selectedAsset.transform.scale}
              step={0.1}
              onChange={(axis, value) =>
                handleTransformChange(selectedAsset.instanceId, "scale", axis, value)
              }
            />
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a placed asset to inspect and edit it.
          </Text>
        )}
      </Inspector>
    ) : null,

    viewportOverlay: region ? (
      <>
        <ViewportToolbar
          items={transformTools}
          activeId={activeTool}
          onSelect={(id) => {
            const tool = id as TransformTool;
            setActiveTool(tool);
            layoutRef.current?.toolState.setActiveTool(tool);
          }}
        />
        <LayoutOrientationWidget quaternion={cameraQuaternion} />
        {contextMenu && (
          <Box
            ref={contextMenuRef}
            style={{
              position: "absolute",
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 30,
              minWidth: 168,
              background: "var(--sm-color-surface1)",
              border: "1px solid var(--sm-panel-border)",
              borderRadius: "var(--sm-radius-md)",
              boxShadow: "var(--sm-shadow-md)",
              padding: 4
            }}
          >
            <UnstyledButton
              onClick={handleSnapToOrigin}
              styles={{
                root: {
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 10px",
                  borderRadius: "var(--sm-radius-sm)",
                  color: "var(--sm-color-text)",
                  background: "transparent",
                  transition: "var(--sm-transition-fast)",
                  "&:hover": {
                    background: "var(--sm-active-bg)"
                  }
                }
              }}
            >
              <Text size="sm">Snap to Origin</Text>
            </UnstyledButton>
          </Box>
        )}
      </>
    ) : null
  };
}
