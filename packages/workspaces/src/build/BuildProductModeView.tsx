/**
 * BuildProductModeView: the Build-specific host.
 *
 * Owns: Build sub-nav, workspace kind dispatch.
 * Delegates to: LayoutWorkspaceView, EnvironmentWorkspaceView, AssetsWorkspaceView.
 * Does NOT redefine the shell — returns panel contributions.
 */

import { useMemo, useState } from "react";
import { Stack, Text } from "@mantine/core";
import type {
  SemanticCommand,
  AssetDefinition,
  DocumentDefinition,
  EnvironmentDefinition
} from "@sugarmagic/domain";
import {
  getActiveRegion,
  createPlacedAssetInstanceId,
  type AuthoringSession
} from "@sugarmagic/domain";
import {
  BuildSubNav,
  type BuildWorkspaceKindItem,
  type BuildContextSelector
} from "@sugarmagic/ui";
import type { BuildWorkspaceKind } from "@sugarmagic/shell";
import type { WorkspaceViewContribution } from "../workspace-view";
import type { WorkspaceViewport } from "../viewport";
import { applyLightingPresetToEnvironmentDefinition } from "@sugarmagic/runtime-core";
import { useLayoutWorkspaceView } from "./layout/LayoutWorkspaceView";
import { useLandscapeWorkspaceView } from "./landscape";
import { useEnvironmentWorkspaceView } from "./environment";
import { useAssetsWorkspaceView } from "./assets";

const buildWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "layout", label: "Layout", icon: "🏗️" },
  { id: "landscape", label: "Landscape", icon: "⛰️" },
  { id: "environment", label: "Environment", icon: "🌅" },
  { id: "assets", label: "Assets", icon: "📦" }
];

export interface BuildProductModeViewProps {
  activeBuildKind: BuildWorkspaceKind;
  viewportReadyVersion: number;
  activeRegionId: string | null;
  activeEnvironmentId: string | null;
  selectedIds: string[];
  session: AuthoringSession | null;
  assetDefinitions: AssetDefinition[];
  documentDefinitions: DocumentDefinition[];
  environmentDefinitions: EnvironmentDefinition[];
  getViewport: () => WorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  regions: { id: string; displayName: string }[];
  onSelectKind: (kind: BuildWorkspaceKind) => void;
  onSelectRegion: (regionId: string) => void;
  onCreateRegion: () => void;
  onSelectEnvironment: (environmentId: string) => void;
  onCreateEnvironment: () => void;
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onRemoveAssetDefinition: (definitionId: string) => void;
}

export interface BuildProductModeViewResult {
  subHeaderPanel: React.ReactNode;
  leftPanel: React.ReactNode | null;
  rightPanel: React.ReactNode;
  viewportOverlay: React.ReactNode;
  environmentOverrideId: string | null;
}

export function useBuildProductModeView(
  props: BuildProductModeViewProps
): BuildProductModeViewResult {
  const {
    activeBuildKind,
    viewportReadyVersion,
    activeRegionId,
    activeEnvironmentId,
    selectedIds,
    session,
    assetDefinitions,
    documentDefinitions,
    environmentDefinitions,
    getViewport,
    getViewportElement,
    regions,
    onSelectKind,
    onSelectRegion,
    onCreateRegion,
    onSelectEnvironment,
    onCreateEnvironment,
    onSelect,
    onCommand,
    onImportAsset,
    onUpdateAssetDefinition,
    onRemoveAssetDefinition
  } = props;

  const activeRegion = session ? getActiveRegion(session) : null;
  const [selectedAssetDefinitionIdState, setSelectedAssetDefinitionId] =
    useState<string | null>(assetDefinitions[0]?.definitionId ?? null);
  const selectedAssetDefinitionId =
    selectedAssetDefinitionIdState &&
    assetDefinitions.some(
      (definition) => definition.definitionId === selectedAssetDefinitionIdState
    )
      ? selectedAssetDefinitionIdState
      : assetDefinitions[0]?.definitionId ?? null;

  const selectedEnvironment = useMemo(() => {
    if (environmentDefinitions.length === 0) return null;
    return (
      environmentDefinitions.find(
        (definition) => definition.definitionId === activeEnvironmentId
      ) ?? environmentDefinitions[0]
    );
  }, [activeEnvironmentId, environmentDefinitions]);

  const layoutView = useLayoutWorkspaceView({
    isActive: activeBuildKind === "layout",
    viewportReadyVersion,
    getViewport: activeBuildKind === "layout" ? getViewport : () => null,
    getViewportElement: activeBuildKind === "layout" ? getViewportElement : () => null,
    selectedIds,
    onSelect,
    onCommand,
    getSelectedId: () => selectedIds[0] ?? null,
    getRegion: () => (session ? getActiveRegion(session) : null),
    playerDefinition: session?.gameProject.playerDefinition ?? null,
    itemDefinitions: session?.gameProject.itemDefinitions ?? [],
    documentDefinitions,
    npcDefinitions: session?.gameProject.npcDefinitions ?? [],
    onImportAsset,
    onEditAssetDefinition: (definitionId) => {
      setSelectedAssetDefinitionId(definitionId);
      onSelectKind("assets");
    }
  });

  const boundRegionNames = useMemo(() => {
    if (!selectedEnvironment || !session) return [];
    return Array.from(session.regions.values())
      .filter(
        (region) =>
          region.environmentBinding.defaultEnvironmentId ===
          selectedEnvironment.definitionId
      )
      .map((region) => region.displayName);
  }, [selectedEnvironment, session]);

  const environmentView = useEnvironmentWorkspaceView({
    selectedEnvironment,
    boundRegionNames,
    onSelectLightingPreset: (preset) => {
      if (!selectedEnvironment) return;
      onCommand({
        kind: "UpdateEnvironmentDefinition",
        target: {
          aggregateKind: "content-definition",
          aggregateId: selectedEnvironment.definitionId
        },
        subject: {
          subjectKind: "environment-definition",
          subjectId: selectedEnvironment.definitionId
        },
        payload: {
          definitionId: selectedEnvironment.definitionId,
          definition: applyLightingPresetToEnvironmentDefinition(
            selectedEnvironment,
            preset
          )
        }
      });
    }
  });

  const landscapeView = useLandscapeWorkspaceView({
    isActive: activeBuildKind === "landscape",
    viewportReadyVersion,
    getViewport: activeBuildKind === "landscape" ? getViewport : () => null,
    getViewportElement:
      activeBuildKind === "landscape" ? getViewportElement : () => null,
    region: activeRegion,
    onCommand
  });

  const assetsView = useAssetsWorkspaceView({
    assetDefinitions,
    activeRegion,
    selectedAssetDefinitionId,
    onSelectAssetDefinition: setSelectedAssetDefinitionId,
    onImportAsset,
    onPlaceAsset: (assetDefinition) => {
      if (!activeRegion) return;
      const instanceId = createPlacedAssetInstanceId(assetDefinition.displayName);
      onCommand({
        kind: "PlaceAssetInstance",
        target: {
          aggregateKind: "region-document",
          aggregateId: activeRegion.identity.id
        },
        subject: {
          subjectKind: "placed-asset",
          subjectId: instanceId
        },
        payload: {
          instanceId,
          assetDefinitionId: assetDefinition.definitionId,
          displayName: assetDefinition.displayName,
          parentFolderId: null,
          position: [0, 0.5, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      });
      onSelectKind("layout");
    },
    onUpdateAssetDefinition,
    onRemoveAssetDefinition,
    hasSceneReferences: (definitionId) =>
      session
        ? Array.from(session.regions.values()).some((region) =>
            region.scene.placedAssets.some(
              (asset) => asset.assetDefinitionId === definitionId
            )
          )
        : false
  });

  const activeView: WorkspaceViewContribution =
    activeBuildKind === "layout"
      ? layoutView
      : activeBuildKind === "landscape"
        ? landscapeView
      : activeBuildKind === "environment"
        ? environmentView
        : assetsView;

  const contextSelector: BuildContextSelector | null =
    activeBuildKind === "layout" || activeBuildKind === "landscape"
      ? {
          items: regions,
          activeId: activeRegionId,
          placeholder: "Select region...",
          createLabel: "+ New Region",
          width: 180,
          onSelect: onSelectRegion,
          onCreate: onCreateRegion
        }
      : activeBuildKind === "environment"
        ? {
            items: environmentDefinitions.map((definition) => ({
              id: definition.definitionId,
              displayName: definition.displayName
            })),
            activeId: selectedEnvironment?.definitionId ?? null,
            placeholder: "Select environment...",
            createLabel: "+ New Environment",
            width: 220,
            onSelect: onSelectEnvironment,
            onCreate: onCreateEnvironment
          }
        : null;

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={buildWorkspaceKinds}
        activeKindId={activeBuildKind}
        onSelectKind={(id) => onSelectKind(id as BuildWorkspaceKind)}
        contextSelector={contextSelector}
      />
    ),
    leftPanel:
      activeBuildKind === "layout" ? (
        <Stack gap={0} h="100%">
          {!activeRegion && (
            <Stack gap="sm" align="center" p="xl" mt="xl">
              <Text size="sm" c="var(--sm-color-overlay0)" ta="center">
                No region selected.
              </Text>
              <Text size="xs" c="var(--sm-color-overlay0)" ta="center">
                Use the region selector above to create or select a region.
              </Text>
            </Stack>
          )}
          {activeView.leftPanel}
        </Stack>
      ) : activeView.leftPanel ?? null,

    rightPanel: activeView.rightPanel,
    viewportOverlay: activeView.viewportOverlay,
    environmentOverrideId:
      activeBuildKind === "environment"
        ? selectedEnvironment?.definitionId ?? null
        : null
  };
}
