/**
 * LayoutWorkspaceView: the React view for Build > Layout.
 *
 * Owns: scene explorer, inspector, viewport toolbar, and layout-specific
 * context menus. The transform gizmo and camera controller now live inside
 * the Studio viewport overlay layer instead of this React view.
 *
 * Plugs into the shell via WorkspaceViewContribution.
 * Accepts plugin-owned inspector sections so build-side shell contributions can extend the region inspector without duplicating layout state.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode
} from "react";
import {
  ActionIcon,
  Box,
  Button,
  Menu,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  AssetDefinition,
  DocumentDefinition,
  ItemDefinition,
  NPCDefinition,
  PlayerDefinition,
  SemanticCommand,
  RegionDocument,
  SoundCueDefinition
} from "@sugarmagic/domain";
import {
  createInspectableBehaviorId,
  getActiveRegion,
  createItemPresenceId,
  createNPCPresenceId,
  createPlacedAssetInstanceId,
  createPlayerPresenceId,
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
import type { ViewportStore } from "@sugarmagic/shell";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { useVanillaStoreSelector } from "../../use-vanilla-store";
import { LayoutOrientationWidget } from "./LayoutOrientationWidget";
import { LayoutAudioPlacementSection } from "./LayoutAudioPlacementSection";
import type { TransformTool } from "../../interaction/tool-state";
import { getLayoutWorkspaceForViewport } from "./layout-interaction-access";

const transformTools: ViewportToolbarItem[] = [
  { id: "move", label: "Move", icon: "✥", shortcut: "G" },
  { id: "rotate", label: "Rotate", icon: "↻", shortcut: "R" },
  { id: "scale", label: "Scale", icon: "⤢", shortcut: "S" }
];

export interface LayoutWorkspaceViewProps {
  isActive: boolean;
  getViewportElement: () => HTMLElement | null;
  viewportStore: ViewportStore;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
  getRegion: () => ReturnType<typeof getActiveRegion>;
  assetDefinitions: AssetDefinition[];
  playerDefinition: PlayerDefinition | null;
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  soundCueDefinitions: SoundCueDefinition[];
  onEditAssetDefinition: (definitionId: string) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
  renderInspectorSections?: (context: {
    activeRegion: RegionDocument | null;
  }) => ReactNode;
}

const SCENE_ROOT_FOLDER_ID = "__scene_root__";

function buildSceneTree(
  region: RegionDocument,
  assetDefinitions: AssetDefinition[],
  playerDefinition: PlayerDefinition | null,
  itemDefinitions: ItemDefinition[],
  documentDefinitions: DocumentDefinition[],
  npcDefinitions: NPCDefinition[]
): SceneExplorerNode[] {
  const assetKindsByDefinitionId = new Map(
    assetDefinitions.map((definition) => [
      definition.definitionId,
      definition.assetKind
    ])
  );
  const foldersByParent = new Map<
    string | null,
    RegionDocument["scene"]["folders"]
  >();
  const assetsByParent = new Map<
    string | null,
    RegionDocument["scene"]["placedAssets"]
  >();

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

  const buildChildren = (
    parentFolderId: string | null
  ): SceneExplorerNode[] => {
    const childFolders = (foldersByParent.get(parentFolderId) ?? []).map(
      (folder) => ({
        type: "folder" as const,
        folderId: folder.folderId,
        displayName: folder.displayName,
        children: buildChildren(folder.folderId)
      })
    );

    const childAssets = (assetsByParent.get(parentFolderId) ?? []).map(
      (asset) => {
        const documentDefinition = asset.inspectable
          ? (documentDefinitions.find(
              (definition) =>
                definition.definitionId ===
                asset.inspectable?.documentDefinitionId
            ) ?? null)
          : null;

        return {
          type: "entity" as const,
          instanceId: asset.instanceId,
          displayName:
            asset.inspectable && documentDefinition
              ? `${asset.displayName} · ${documentDefinition.displayName}`
              : asset.displayName,
          entityKind: "asset" as const,
          assetKind:
            assetKindsByDefinitionId.get(asset.assetDefinitionId) ?? "asset",
          assetDefinitionId: asset.assetDefinitionId,
          visible: true
        };
      }
    );

    return [...childFolders, ...childAssets];
  };

  const playerNode = region.scene.playerPresence
    ? [
        {
          type: "entity" as const,
          instanceId: region.scene.playerPresence.presenceId,
          displayName: playerDefinition?.displayName ?? "Player",
          entityKind: "player" as const,
          assetKind: "player",
          assetDefinitionId: playerDefinition?.definitionId ?? null,
          visible: true
        }
      ]
    : [];

  const npcNodes = region.scene.npcPresences.map((presence) => ({
    type: "entity" as const,
    instanceId: presence.presenceId,
    displayName:
      npcDefinitions.find(
        (definition) => definition.definitionId === presence.npcDefinitionId
      )?.displayName ?? "NPC",
    entityKind: "npc" as const,
    assetKind: "npc",
    assetDefinitionId: presence.npcDefinitionId,
    visible: true
  }));

  const itemNodes = region.scene.itemPresences.map((presence) => ({
    type: "entity" as const,
    instanceId: presence.presenceId,
    displayName:
      itemDefinitions.find(
        (definition) => definition.definitionId === presence.itemDefinitionId
      )?.displayName ?? "Item",
    entityKind: "item" as const,
    assetKind: "item",
    assetDefinitionId: presence.itemDefinitionId,
    visible: true
  }));

  // Landscape is a singular field on the region document. Surfacing it as
  // the first scene-explorer entry under the region root makes it a visible
  // part of the authored scene rather than an invisible implicit plane
  // hiding in the viewport.
  const landscapeNode = {
    type: "landscape" as const,
    landscapeId: `${region.identity.id}:landscape`,
    displayName: "Landscape",
    enabled: region.landscape?.enabled ?? false
  };

  return [
    {
      type: "folder" as const,
      folderId: SCENE_ROOT_FOLDER_ID,
      displayName: region.displayName,
      isRoot: true,
      children: [
        landscapeNode,
        ...playerNode,
        ...npcNodes,
        ...itemNodes,
        ...buildChildren(null)
      ]
    }
  ];
}

export function useLayoutWorkspaceView(
  props: LayoutWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    getViewportElement,
    viewportStore,
    selectedIds,
    onSelect,
    onCommand,
    getRegion,
    assetDefinitions,
    playerDefinition,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    soundCueDefinitions,
    onEditAssetDefinition,
    onImportAsset,
    renderInspectorSections
  } = props;

  const [selectedFolderState, setSelectedFolderState] = useState<{
    regionId: string | null;
    folderId: string;
  }>({
    regionId: null,
    folderId: SCENE_ROOT_FOLDER_ID
  });
  const [contextMenu, setContextMenu] = useState<{
    instanceId: string;
    x: number;
    y: number;
  } | null>(null);
  const [addNPCOpen, setAddNPCOpen] = useState(false);
  const [npcQuery, setNPCQuery] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState("");

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const getViewportElementRef = useRef(getViewportElement);
  const onSelectRef = useRef(onSelect);
  const activeTool = useVanillaStoreSelector(
    viewportStore,
    (state) => state.activeTransformTool
  );
  const cameraQuaternion = useVanillaStoreSelector(
    viewportStore,
    (state) => state.cameraQuaternion
  );

  useEffect(() => {
    getViewportElementRef.current = getViewportElement;
    onSelectRef.current = onSelect;
  }, [getViewportElement, onSelect]);

  const region = getRegion();

  useEffect(() => {
    if (!isActive) return;
    getLayoutWorkspaceForViewport(
      getViewportElementRef.current()
    )?.syncOverlays();
  }, [isActive, selectedIds, region]);

  useEffect(() => {
    if (!isActive) return;

    const viewportElement = getViewportElementRef.current();
    if (!viewportElement) return;
    const element = viewportElement;

    function handleContextMenu(event: MouseEvent) {
      const layout = getLayoutWorkspaceForViewport(element);
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
  }, [isActive, selectedIds]);

  const selectedFolderId =
    selectedFolderState.regionId === (region?.identity.id ?? null)
      ? selectedFolderState.folderId
      : SCENE_ROOT_FOLDER_ID;

  const explorerRoots: SceneExplorerNode[] = useMemo(
    () =>
      region
        ? buildSceneTree(
            region,
            assetDefinitions,
            playerDefinition,
            itemDefinitions,
            documentDefinitions,
            npcDefinitions
          )
        : [],
    [
      assetDefinitions,
      documentDefinitions,
      itemDefinitions,
      npcDefinitions,
      playerDefinition,
      region
    ]
  );

  const selectedAsset = useMemo(() => {
    if (!region || selectedIds.length !== 1) return null;
    return (
      region.scene.placedAssets.find(
        (asset) => asset.instanceId === selectedIds[0]
      ) ?? null
    );
  }, [region, selectedIds]);

  const selectedPlayerPresence = useMemo(() => {
    if (!region || selectedIds.length !== 1) return null;
    if (region.scene.playerPresence?.presenceId !== selectedIds[0]) return null;
    return region.scene.playerPresence;
  }, [region, selectedIds]);

  const selectedNPCPresence = useMemo(() => {
    if (!region || selectedIds.length !== 1) return null;
    return (
      region.scene.npcPresences.find(
        (presence) => presence.presenceId === selectedIds[0]
      ) ?? null
    );
  }, [region, selectedIds]);

  const selectedNPCDefinition = useMemo(() => {
    if (!selectedNPCPresence) return null;
    return (
      npcDefinitions.find(
        (definition) =>
          definition.definitionId === selectedNPCPresence.npcDefinitionId
      ) ?? null
    );
  }, [npcDefinitions, selectedNPCPresence]);

  const selectedItemPresence = useMemo(() => {
    if (!region || selectedIds.length !== 1) return null;
    return (
      region.scene.itemPresences.find(
        (presence) => presence.presenceId === selectedIds[0]
      ) ?? null
    );
  }, [region, selectedIds]);

  const selectedItemDefinition = useMemo(() => {
    if (!selectedItemPresence) return null;
    return (
      itemDefinitions.find(
        (definition) =>
          definition.definitionId === selectedItemPresence.itemDefinitionId
      ) ?? null
    );
  }, [itemDefinitions, selectedItemPresence]);

  const selectedInspectableDocument = useMemo(() => {
    if (!selectedAsset?.inspectable) return null;
    return (
      documentDefinitions.find(
        (definition) =>
          definition.definitionId ===
          selectedAsset.inspectable?.documentDefinitionId
      ) ?? null
    );
  }, [documentDefinitions, selectedAsset]);

  const selectedSceneLabel =
    (selectedIds.length === 0 && selectedFolderId === SCENE_ROOT_FOLDER_ID
      ? (region?.displayName ?? null)
      : null) ??
    selectedAsset?.displayName ??
    (selectedPlayerPresence
      ? (playerDefinition?.displayName ?? "Player")
      : null) ??
    selectedNPCDefinition?.displayName ??
    selectedItemDefinition?.displayName ??
    null;

  const isRegionRootSelected =
    Boolean(region) &&
    selectedIds.length === 0 &&
    selectedFolderId === SCENE_ROOT_FOLDER_ID;

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
      const playerPresence =
        currentRegion.scene.playerPresence?.presenceId === instanceId
          ? currentRegion.scene.playerPresence
          : null;
      const npcPresence =
        currentRegion.scene.npcPresences.find(
          (candidate) => candidate.presenceId === instanceId
        ) ?? null;
      const itemPresence =
        currentRegion.scene.itemPresences.find(
          (candidate) => candidate.presenceId === instanceId
        ) ?? null;
      const source = asset ?? playerPresence ?? npcPresence ?? itemPresence;
      if (!source) return;

      const nextPosition: [number, number, number] = [
        ...source.transform.position
      ];
      const nextRotation: [number, number, number] = [
        ...source.transform.rotation
      ];
      const nextScale: [number, number, number] = [...source.transform.scale];

      if (transformKind === "position") nextPosition[axis] = value;
      if (transformKind === "rotation") nextRotation[axis] = value;
      if (transformKind === "scale") nextScale[axis] = value;

      if (asset) {
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
        return;
      }

      if (playerPresence) {
        onCommand({
          kind: "TransformPlayerPresence",
          target: {
            aggregateKind: "region-document",
            aggregateId: currentRegion.identity.id
          },
          subject: { subjectKind: "player-presence", subjectId: instanceId },
          payload: {
            presenceId: instanceId,
            position: nextPosition,
            rotation: nextRotation,
            scale: nextScale
          }
        });
        return;
      }

      if (itemPresence) {
        onCommand({
          kind: "TransformItemPresence",
          target: {
            aggregateKind: "region-document",
            aggregateId: currentRegion.identity.id
          },
          subject: { subjectKind: "item-presence", subjectId: instanceId },
          payload: {
            presenceId: instanceId,
            position: nextPosition,
            rotation: nextRotation,
            scale: nextScale
          }
        });
        return;
      }

      onCommand({
        kind: "TransformNPCPresence",
        target: {
          aggregateKind: "region-document",
          aggregateId: currentRegion.identity.id
        },
        subject: { subjectKind: "npc-presence", subjectId: instanceId },
        payload: {
          presenceId: instanceId,
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

  const handleDuplicateAsset = useCallback(
    (instanceId: string) => {
      if (!region) return;
      const asset = region.scene.placedAssets.find(
        (candidate) => candidate.instanceId === instanceId
      );
      if (!asset) return;

      const duplicatedInstanceId = createPlacedAssetInstanceId(
        asset.displayName
      );
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
    },
    [onCommand, onSelect, region]
  );

  const handleDeleteEntityFromScene = useCallback(
    (instanceId: string) => {
      if (!region) return;
      const asset = region.scene.placedAssets.find(
        (candidate) => candidate.instanceId === instanceId
      );
      const playerPresence =
        region.scene.playerPresence?.presenceId === instanceId
          ? region.scene.playerPresence
          : null;
      const npcPresence =
        region.scene.npcPresences.find(
          (candidate) => candidate.presenceId === instanceId
        ) ?? null;
      const itemPresence =
        region.scene.itemPresences.find(
          (candidate) => candidate.presenceId === instanceId
        ) ?? null;

      const label =
        asset?.displayName ??
        (playerPresence ? (playerDefinition?.displayName ?? "Player") : null) ??
        (npcPresence
          ? (npcDefinitions.find(
              (definition) =>
                definition.definitionId === npcPresence.npcDefinitionId
            )?.displayName ?? "NPC")
          : null) ??
        (itemPresence
          ? (itemDefinitions.find(
              (definition) =>
                definition.definitionId === itemPresence.itemDefinitionId
            )?.displayName ?? "Item")
          : null);

      if (!label) return;
      if (!window.confirm(`Remove ${label} from this scene?`)) return;

      if (asset) {
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
      } else if (playerPresence) {
        onCommand({
          kind: "RemovePlayerPresence",
          target: {
            aggregateKind: "region-document",
            aggregateId: region.identity.id
          },
          subject: {
            subjectKind: "player-presence",
            subjectId: playerPresence.presenceId
          },
          payload: {
            presenceId: playerPresence.presenceId
          }
        });
      } else if (npcPresence) {
        onCommand({
          kind: "RemoveNPCPresence",
          target: {
            aggregateKind: "region-document",
            aggregateId: region.identity.id
          },
          subject: {
            subjectKind: "npc-presence",
            subjectId: npcPresence.presenceId
          },
          payload: {
            presenceId: npcPresence.presenceId
          }
        });
      } else if (itemPresence) {
        onCommand({
          kind: "RemoveItemPresence",
          target: {
            aggregateKind: "region-document",
            aggregateId: region.identity.id
          },
          subject: {
            subjectKind: "item-presence",
            subjectId: itemPresence.presenceId
          },
          payload: {
            presenceId: itemPresence.presenceId
          }
        });
      }

      onSelect([]);
    },
    [
      itemDefinitions,
      npcDefinitions,
      onCommand,
      onSelect,
      playerDefinition,
      region
    ]
  );

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      if (!region) return;
      if (
        !window.confirm(
          "Delete this folder? Items inside it will move to the parent folder."
        )
      ) {
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
    },
    [onCommand, onSelect, region, selectedFolderId]
  );

  const handleEditEntityFromExplorer = useCallback(
    (instanceId: string) => {
      if (!region) return;
      const asset = region.scene.placedAssets.find(
        (candidate) => candidate.instanceId === instanceId
      );
      if (!asset) return;
      onEditAssetDefinition(asset.assetDefinitionId);
    },
    [onEditAssetDefinition, region]
  );

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

  const handleAddPlayerToScene = useCallback(() => {
    if (!region || !playerDefinition) return;

    if (region.scene.playerPresence) {
      onSelect([region.scene.playerPresence.presenceId]);
      return;
    }

    const presenceId = createPlayerPresenceId();
    onCommand({
      kind: "CreatePlayerPresence",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "player-presence",
        subjectId: presenceId
      },
      payload: {
        presenceId,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
    onSelect([presenceId]);
  }, [onCommand, onSelect, playerDefinition, region]);

  const handleAddNPCPresence = useCallback(
    (definition: NPCDefinition) => {
      if (!region) return;
      const presenceId = createNPCPresenceId();
      onCommand({
        kind: "CreateNPCPresence",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "npc-presence",
          subjectId: presenceId
        },
        payload: {
          presenceId,
          npcDefinitionId: definition.definitionId,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      });
      onSelect([presenceId]);
      setAddNPCOpen(false);
      setNPCQuery("");
    },
    [onCommand, onSelect, region]
  );

  const handleAddItemPresence = useCallback(
    (definition: ItemDefinition) => {
      if (!region) return;
      const presenceId = createItemPresenceId();
      onCommand({
        kind: "CreateItemPresence",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "item-presence",
          subjectId: presenceId
        },
        payload: {
          presenceId,
          itemDefinitionId: definition.definitionId,
          quantity: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      });
      onSelect([presenceId]);
      setAddItemOpen(false);
      setItemQuery("");
    },
    [onCommand, onSelect, region]
  );

  const handleSnapToOrigin = useCallback(() => {
    if (!region || !contextMenu) return;

    const asset = region.scene.placedAssets.find(
      (entry) => entry.instanceId === contextMenu.instanceId
    );
    const playerPresence =
      region.scene.playerPresence?.presenceId === contextMenu.instanceId
        ? region.scene.playerPresence
        : null;
    const npcPresence =
      region.scene.npcPresences.find(
        (entry) => entry.presenceId === contextMenu.instanceId
      ) ?? null;
    const itemPresence =
      region.scene.itemPresences.find(
        (entry) => entry.presenceId === contextMenu.instanceId
      ) ?? null;
    const source = asset ?? playerPresence ?? npcPresence ?? itemPresence;
    if (!source) return;

    if (asset) {
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
      return;
    }

    onCommand({
      kind: playerPresence
        ? "TransformPlayerPresence"
        : itemPresence
          ? "TransformItemPresence"
          : "TransformNPCPresence",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: playerPresence
          ? "player-presence"
          : itemPresence
            ? "item-presence"
            : "npc-presence",
        subjectId: contextMenu.instanceId
      },
      payload: {
        presenceId: contextMenu.instanceId,
        position: [0, 0, 0],
        rotation: source.transform.rotation,
        scale: source.transform.scale
      }
    });

    setContextMenu(null);
  }, [contextMenu, onCommand, region]);

  const filteredNPCDefinitions = useMemo(() => {
    const query = npcQuery.trim().toLowerCase();
    if (!query) return npcDefinitions;
    return npcDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(query)
    );
  }, [npcDefinitions, npcQuery]);

  const filteredItemDefinitions = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    if (!query) return itemDefinitions;
    return itemDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(query)
    );
  }, [itemDefinitions, itemQuery]);

  return {
    leftPanel: region ? (
      <PanelSection
        title="Scene Explorer"
        icon="🏗️"
        actions={
          <>
            <Menu shadow="md" withinPortal position="bottom-end">
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label="Add scene thing"
                >
                  ＋
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => void handleImportAssetFromExplorer()}>
                  Asset
                </Menu.Item>
                <Menu.Item
                  onClick={handleAddPlayerToScene}
                  disabled={!playerDefinition}
                >
                  Player
                </Menu.Item>
                <Menu.Item
                  onClick={() => {
                    setAddNPCOpen(true);
                    setNPCQuery("");
                  }}
                  disabled={npcDefinitions.length === 0}
                >
                  NPC
                </Menu.Item>
                <Menu.Item
                  onClick={() => {
                    setAddItemOpen(true);
                    setItemQuery("");
                  }}
                  disabled={itemDefinitions.length === 0}
                >
                  Item
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
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
            onDeleteEntity={handleDeleteEntityFromScene}
          />
        </Stack>
        <Modal
          opened={addNPCOpen}
          onClose={() => setAddNPCOpen(false)}
          title="Add NPC"
          centered
        >
          <Stack gap="sm">
            <TextInput
              placeholder="Search NPCs..."
              value={npcQuery}
              onChange={(event) => setNPCQuery(event.currentTarget.value)}
              autoFocus
            />
            {filteredNPCDefinitions.length > 0 ? (
              filteredNPCDefinitions.map((definition) => (
                <Button
                  key={definition.definitionId}
                  variant="light"
                  justify="flex-start"
                  onClick={() => handleAddNPCPresence(definition)}
                >
                  {definition.displayName}
                </Button>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                No NPCs match that search.
              </Text>
            )}
          </Stack>
        </Modal>
        <Modal
          opened={addItemOpen}
          onClose={() => setAddItemOpen(false)}
          title="Add Item"
          centered
        >
          <Stack gap="sm">
            <TextInput
              placeholder="Search items..."
              value={itemQuery}
              onChange={(event) => setItemQuery(event.currentTarget.value)}
              autoFocus
            />
            {filteredItemDefinitions.length > 0 ? (
              filteredItemDefinitions.map((definition) => (
                <Button
                  key={definition.definitionId}
                  variant="light"
                  justify="flex-start"
                  onClick={() => handleAddItemPresence(definition)}
                >
                  {definition.displayName}
                </Button>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                No items match that search.
              </Text>
            )}
          </Stack>
        </Modal>
      </PanelSection>
    ) : null,

    rightPanel: region ? (
      <Inspector selectionLabel={selectedSceneLabel}>
        {isRegionRootSelected ? (
          <Stack gap="md">
            <Text size="sm" fw={600}>
              Region
            </Text>
            <TextInput
              label="Display Name"
              size="xs"
              value={region.displayName}
              onChange={(event) =>
                onCommand({
                  kind: "UpdateRegionMetadata",
                  target: {
                    aggregateKind: "region-document",
                    aggregateId: region.identity.id
                  },
                  subject: {
                    subjectKind: "region-document",
                    subjectId: region.identity.id
                  },
                  payload: {
                    displayName: event.currentTarget.value
                  }
                })
              }
            />
            <TextInput
              label="Lore Page ID"
              size="xs"
              placeholder="root.locations.earendale"
              value={region.lorePageId ?? ""}
              onChange={(event) =>
                onCommand({
                  kind: "UpdateRegionMetadata",
                  target: {
                    aggregateKind: "region-document",
                    aggregateId: region.identity.id
                  },
                  subject: {
                    subjectKind: "region-document",
                    subjectId: region.identity.id
                  },
                  payload: {
                    lorePageId: event.currentTarget.value
                  }
                })
              }
            />
            <NumberInput
              label="Size (m)"
              description="Width and depth of the region's landscape footprint."
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
            <Stack gap={2}>
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Region ID
              </Text>
              <Text size="xs" c="var(--sm-color-overlay0)">
                {region.identity.id}
              </Text>
            </Stack>
            <LayoutAudioPlacementSection
              region={region}
              soundCueDefinitions={soundCueDefinitions}
              onCommand={onCommand}
            />
          </Stack>
        ) : selectedAsset ? (
          <Stack gap="md">
            <TransformInspector
              label="Position"
              value={selectedAsset.transform.position}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedAsset.instanceId,
                  "position",
                  axis,
                  value
                )
              }
            />
            <TransformInspector
              label="Rotation"
              value={selectedAsset.transform.rotation}
              step={0.1}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedAsset.instanceId,
                  "rotation",
                  axis,
                  value
                )
              }
            />
            <TransformInspector
              label="Scale"
              value={selectedAsset.transform.scale}
              step={0.1}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedAsset.instanceId,
                  "scale",
                  axis,
                  value
                )
              }
            />
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Inspectable
              </Text>
              {selectedAsset.inspectable ? (
                <>
                  <Select
                    label="Document"
                    size="xs"
                    searchable
                    data={documentDefinitions.map((definition) => ({
                      value: definition.definitionId,
                      label: definition.displayName
                    }))}
                    value={selectedAsset.inspectable.documentDefinitionId}
                    onChange={(value: string | null) => {
                      if (!region || !value) return;
                      onCommand({
                        kind: "UpdatePlacedAssetInspectable",
                        target: {
                          aggregateKind: "region-document",
                          aggregateId: region.identity.id
                        },
                        subject: {
                          subjectKind: "placed-asset-inspectable",
                          subjectId:
                            selectedAsset.inspectable?.behaviorId ??
                            selectedAsset.instanceId
                        },
                        payload: {
                          instanceId: selectedAsset.instanceId,
                          documentDefinitionId: value
                        }
                      });
                    }}
                  />
                  <TextInput
                    label="Prompt Text"
                    size="xs"
                    placeholder="Inspect"
                    value={selectedAsset.inspectable.promptText ?? ""}
                    onChange={(event) => {
                      if (!region) return;
                      onCommand({
                        kind: "UpdatePlacedAssetInspectable",
                        target: {
                          aggregateKind: "region-document",
                          aggregateId: region.identity.id
                        },
                        subject: {
                          subjectKind: "placed-asset-inspectable",
                          subjectId:
                            selectedAsset.inspectable?.behaviorId ??
                            selectedAsset.instanceId
                        },
                        payload: {
                          instanceId: selectedAsset.instanceId,
                          promptText: event.currentTarget.value
                        }
                      });
                    }}
                  />
                  {selectedInspectableDocument && (
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      Opens: {selectedInspectableDocument.displayName}
                    </Text>
                  )}
                  <Button
                    variant="light"
                    color="red"
                    onClick={() => {
                      if (!region) return;
                      onCommand({
                        kind: "RemovePlacedAssetInspectable",
                        target: {
                          aggregateKind: "region-document",
                          aggregateId: region.identity.id
                        },
                        subject: {
                          subjectKind: "placed-asset-inspectable",
                          subjectId:
                            selectedAsset.inspectable?.behaviorId ??
                            selectedAsset.instanceId
                        },
                        payload: {
                          instanceId: selectedAsset.instanceId
                        }
                      });
                    }}
                  >
                    Remove Inspectable
                  </Button>
                </>
              ) : (
                <>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    Turn this placed asset into an inspectable world object.
                  </Text>
                  <Button
                    variant="light"
                    disabled={documentDefinitions.length === 0}
                    onClick={() => {
                      if (!region || documentDefinitions.length === 0) return;
                      const firstDocument = documentDefinitions[0]!;
                      const behaviorId = createInspectableBehaviorId();
                      onCommand({
                        kind: "AssignPlacedAssetInspectable",
                        target: {
                          aggregateKind: "region-document",
                          aggregateId: region.identity.id
                        },
                        subject: {
                          subjectKind: "placed-asset-inspectable",
                          subjectId: behaviorId
                        },
                        payload: {
                          instanceId: selectedAsset.instanceId,
                          behaviorId,
                          documentDefinitionId: firstDocument.definitionId,
                          promptText: "Inspect"
                        }
                      });
                    }}
                  >
                    Make Inspectable
                  </Button>
                </>
              )}
            </Stack>
          </Stack>
        ) : selectedPlayerPresence ? (
          <Stack gap="md">
            <TransformInspector
              label="Spawn Position"
              value={selectedPlayerPresence.transform.position}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedPlayerPresence.presenceId,
                  "position",
                  axis,
                  value
                )
              }
            />
          </Stack>
        ) : selectedNPCPresence ? (
          <Stack gap="md">
            <Text size="sm" fw={600}>
              {selectedNPCDefinition?.displayName ?? "NPC"}
            </Text>
            <TransformInspector
              label="Spawn Position"
              value={selectedNPCPresence.transform.position}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedNPCPresence.presenceId,
                  "position",
                  axis,
                  value
                )
              }
            />
          </Stack>
        ) : selectedItemPresence ? (
          <Stack gap="md">
            <Text size="sm" fw={600}>
              {selectedItemDefinition?.displayName ?? "Item"}
            </Text>
            <NumberInput
              label="Quantity"
              size="xs"
              min={1}
              value={selectedItemPresence.quantity}
              onChange={(value) => {
                if (!region || typeof value !== "number") return;
                onCommand({
                  kind: "UpdateItemPresence",
                  target: {
                    aggregateKind: "region-document",
                    aggregateId: region.identity.id
                  },
                  subject: {
                    subjectKind: "item-presence",
                    subjectId: selectedItemPresence.presenceId
                  },
                  payload: {
                    presenceId: selectedItemPresence.presenceId,
                    quantity: value
                  }
                });
              }}
            />
            <TransformInspector
              label="Position"
              value={selectedItemPresence.transform.position}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedItemPresence.presenceId,
                  "position",
                  axis,
                  value
                )
              }
            />
            <TransformInspector
              label="Rotation"
              value={selectedItemPresence.transform.rotation}
              step={0.1}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedItemPresence.presenceId,
                  "rotation",
                  axis,
                  value
                )
              }
            />
            <TransformInspector
              label="Scale"
              value={selectedItemPresence.transform.scale}
              step={0.1}
              onChange={(axis, value) =>
                handleTransformChange(
                  selectedItemPresence.presenceId,
                  "scale",
                  axis,
                  value
                )
              }
            />
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a scene thing to inspect and position it.
          </Text>
        )}
        {renderInspectorSections?.({ activeRegion: region }) ?? null}
      </Inspector>
    ) : null,

    viewportOverlay: region ? (
      <>
        <ViewportToolbar
          items={transformTools}
          activeId={activeTool}
          onSelect={(id) => {
            const tool = id as TransformTool;
            viewportStore.getState().setActiveTransformTool(tool);
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
