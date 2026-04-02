/**
 * BuildProductModeView: the Build-specific host.
 *
 * Owns: Build sub-nav, workspace kind dispatch.
 * Delegates to: LayoutWorkspaceView, EnvironmentWorkspaceView, AssetsWorkspaceView.
 * Does NOT redefine the shell — returns panel contributions.
 */

import { useState } from "react";
import { Stack, Text } from "@mantine/core";
import type { SemanticCommand, AssetDefinition } from "@sugarmagic/domain";
import {
  getActiveRegion,
  createPlacedAssetInstanceId,
  type AuthoringSession
} from "@sugarmagic/domain";
import {
  BuildSubNav,
  type BuildWorkspaceKindItem
} from "@sugarmagic/ui";
import type { BuildWorkspaceKind } from "@sugarmagic/shell";
import type { WorkspaceViewContribution } from "../workspace-view";
import type { WorkspaceViewport } from "../viewport";
import { useLayoutWorkspaceView } from "./layout/LayoutWorkspaceView";
import { useEnvironmentWorkspaceView } from "./environment";
import { useAssetsWorkspaceView } from "./assets";

const buildWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "layout", label: "Layout", icon: "🏗️" },
  { id: "environment", label: "Environment", icon: "🌅" },
  { id: "assets", label: "Assets", icon: "📦" }
];

export interface BuildProductModeViewProps {
  activeBuildKind: BuildWorkspaceKind;
  activeRegionId: string | null;
  selectedIds: string[];
  session: AuthoringSession | null;
  assetDefinitions: AssetDefinition[];
  getViewport: () => WorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  regions: { id: string; displayName: string }[];
  onSelectKind: (kind: BuildWorkspaceKind) => void;
  onSelectRegion: (regionId: string) => void;
  onCreateRegion: () => void;
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onRemoveAssetDefinition: (definitionId: string) => void;
}

export interface BuildProductModeViewResult {
  subHeaderPanel: React.ReactNode;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  viewportOverlay: React.ReactNode;
}

export function useBuildProductModeView(
  props: BuildProductModeViewProps
): BuildProductModeViewResult {
  const {
    activeBuildKind,
    activeRegionId,
    selectedIds,
    session,
    assetDefinitions,
    getViewport,
    getViewportElement,
    regions,
    onSelectKind,
    onSelectRegion,
    onCreateRegion,
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

  const layoutView = useLayoutWorkspaceView({
    isActive: activeBuildKind === "layout",
    getViewport: activeBuildKind === "layout" ? getViewport : () => null,
    getViewportElement: activeBuildKind === "layout" ? getViewportElement : () => null,
    selectedIds,
    onSelect,
    onCommand,
    getSelectedId: () => selectedIds[0] ?? null,
    getRegion: () => (session ? getActiveRegion(session) : null),
    onImportAsset,
    onEditAssetDefinition: (definitionId) => {
      setSelectedAssetDefinitionId(definitionId);
      onSelectKind("assets");
    }
  });

  const environmentView = useEnvironmentWorkspaceView();
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
      : activeBuildKind === "environment"
        ? environmentView
        : assetsView;

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={buildWorkspaceKinds}
        activeKindId={activeBuildKind}
        onSelectKind={(id) => onSelectKind(id as BuildWorkspaceKind)}
        regions={regions}
        activeRegionId={activeRegionId}
        onSelectRegion={onSelectRegion}
        onCreateRegion={onCreateRegion}
      />
    ),

    leftPanel: (
      <Stack gap={0} h="100%">
        {!activeRegion && activeBuildKind !== "assets" && (
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
    ),

    rightPanel: activeView.rightPanel,
    viewportOverlay: activeView.viewportOverlay
  };
}
