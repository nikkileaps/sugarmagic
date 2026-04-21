/**
 * BuildProductModeView: the Build-specific host.
 *
 * Owns: Build sub-nav, workspace kind dispatch.
 * Delegates to: LayoutWorkspaceView, EnvironmentWorkspaceView, AssetsWorkspaceView.
 * Does NOT redefine the shell — returns panel contributions.
 * Accepts plugin-owned inspector sections so build-side affordances stay plugin-owned.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Stack, Text } from "@mantine/core";
import type {
  SemanticCommand,
  AssetDefinition,
  DocumentDefinition,
  EnvironmentDefinition,
  MaterialDefinition,
  NPCDefinition,
  QuestDefinition,
  ShaderParameterOverride,
  ShaderGraphDocument,
  TextureDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import {
  createEmptyContentLibrarySnapshot,
  getActiveRegion,
  createPlacedAssetInstanceId,
  type AuthoringSession
} from "@sugarmagic/domain";
import {
  BuildSubNav,
  type BuildWorkspaceKindItem,
  type BuildContextSelector
} from "@sugarmagic/ui";
import type { BuildWorkspaceKind, ViewportStore } from "@sugarmagic/shell";
import type {
  WorkspaceNavigationTarget,
  WorkspaceViewContribution
} from "../workspace-view";
import { applyLightingPresetTemplate } from "@sugarmagic/runtime-core";
import { useLayoutWorkspaceView } from "./layout/LayoutWorkspaceView";
import { useLandscapeWorkspaceView } from "./landscape";
import { useSpatialWorkspaceView } from "./spatial";
import { useBehaviorWorkspaceView } from "./behavior";
import { useEnvironmentWorkspaceView } from "./environment";
import { useAssetsWorkspaceView } from "./assets";
import { useMaterialsWorkspaceView } from "./materials";

const buildWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "layout", label: "Layout", icon: "🏗️" },
  { id: "landscape", label: "Landscape", icon: "⛰️" },
  { id: "spatial", label: "Spatial", icon: "🗺️" },
  { id: "behavior", label: "Behavior", icon: "🎭" },
  { id: "environment", label: "Environment", icon: "🌅" },
  { id: "materials", label: "Materials", icon: "🧱" },
  { id: "assets", label: "Assets", icon: "📦" }
];

export interface BuildProductModeViewProps {
  activeBuildKind: BuildWorkspaceKind;
  activeRegionId: string | null;
  activeEnvironmentId: string | null;
  selectedIds: string[];
  session: AuthoringSession | null;
  assetDefinitions: AssetDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  documentDefinitions: DocumentDefinition[];
  environmentDefinitions: EnvironmentDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  npcDefinitions: NPCDefinition[];
  questDefinitions: QuestDefinition[];
  getViewportElement: () => HTMLElement | null;
  viewportStore: ViewportStore;
  regions: { id: string; displayName: string }[];
  onSelectKind: (kind: BuildWorkspaceKind) => void;
  onSelectRegion: (regionId: string) => void;
  onCreateRegion: () => void;
  onSelectEnvironment: (environmentId: string) => void;
  onCreateEnvironment: () => void;
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
  navigationTarget?: WorkspaceNavigationTarget | null;
  onConsumeNavigationTarget?: () => void;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onSetAssetMaterialSlotBinding: (
    definitionId: string,
    slotName: string,
    slotIndex: number,
    materialDefinitionId: string | null
  ) => void;
  onSetAssetDefaultShader: (
    definitionId: string,
    slot: "surface" | "deform",
    shaderDefinitionId: string | null
  ) => void;
  onSetAssetDefaultShaderParameterOverride?: (
    definitionId: string,
    slot: "surface" | "deform",
    override: ShaderParameterOverride
  ) => void;
  onClearAssetDefaultShaderParameterOverride?: (
    definitionId: string,
    slot: "surface" | "deform",
    parameterId: string
  ) => void;
  onRemoveAssetDefinition: (definitionId: string) => void;
  onCreateMaterialDefinition: (shaderDefinitionId: string) => MaterialDefinition | null;
  onImportPbrMaterial: () => Promise<MaterialDefinition | null>;
  onImportTextureDefinition: () => Promise<TextureDefinition | null>;
  onUpdateMaterialDefinition: (
    definitionId: string,
    patch: Partial<MaterialDefinition>
  ) => void;
  onRemoveMaterialDefinition: (definitionId: string) => void;
  isMaterialReferenced: (definitionId: string) => boolean;
  renderLayoutInspectorSections?: (context: {
    activeRegion: RegionDocument | null;
  }) => ReactNode;
}

export interface BuildProductModeViewResult {
  subHeaderPanel: React.ReactNode;
  leftPanel: React.ReactNode | null;
  rightPanel: React.ReactNode;
  centerPanel?: React.ReactNode;
  viewportOverlay: React.ReactNode;
  environmentOverrideId: string | null;
}

export function useBuildProductModeView(
  props: BuildProductModeViewProps
): BuildProductModeViewResult {
  const {
    activeBuildKind,
    activeRegionId,
    activeEnvironmentId,
    selectedIds,
    session,
    assetDefinitions,
    materialDefinitions,
    textureDefinitions,
    documentDefinitions,
    environmentDefinitions,
    shaderDefinitions,
    npcDefinitions,
    questDefinitions,
    getViewportElement,
    viewportStore,
    regions,
    onSelectKind,
    onSelectRegion,
    onCreateRegion,
    onSelectEnvironment,
    onCreateEnvironment,
    onSelect,
    onCommand,
    navigationTarget,
    onConsumeNavigationTarget,
    onNavigateToTarget,
    onImportAsset,
    onUpdateAssetDefinition,
    onSetAssetMaterialSlotBinding,
    onSetAssetDefaultShader,
    onSetAssetDefaultShaderParameterOverride,
    onClearAssetDefaultShaderParameterOverride,
    onRemoveAssetDefinition,
    onCreateMaterialDefinition,
    onImportPbrMaterial,
    onImportTextureDefinition,
    onUpdateMaterialDefinition,
    onRemoveMaterialDefinition,
    isMaterialReferenced,
    renderLayoutInspectorSections
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
  const [selectedMaterialDefinitionIdState, setSelectedMaterialDefinitionId] =
    useState<string | null>(materialDefinitions[0]?.definitionId ?? null);
  const selectedMaterialDefinitionId =
    selectedMaterialDefinitionIdState &&
    materialDefinitions.some(
      (definition) => definition.definitionId === selectedMaterialDefinitionIdState
    )
      ? selectedMaterialDefinitionIdState
      : materialDefinitions[0]?.definitionId ?? null;

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
    getViewportElement: activeBuildKind === "layout" ? getViewportElement : () => null,
    viewportStore,
    selectedIds,
    onSelect,
    onCommand,
    getRegion: () => (session ? getActiveRegion(session) : null),
    assetDefinitions,
    playerDefinition: session?.gameProject.playerDefinition ?? null,
    itemDefinitions: session?.gameProject.itemDefinitions ?? [],
    documentDefinitions,
    npcDefinitions: session?.gameProject.npcDefinitions ?? [],
    onImportAsset,
    renderInspectorSections: renderLayoutInspectorSections,
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

  const dispatchEnvironmentDefinition = (definition: EnvironmentDefinition) => {
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
        definition
      }
    });
  };

  const environmentView = useEnvironmentWorkspaceView({
    projectId: session?.gameProject.identity.id ?? "project",
    selectedEnvironment,
    boundRegionNames,
    shaderDefinitions,
    onSelectLightingPreset: (preset) => {
      if (!selectedEnvironment) return;
      dispatchEnvironmentDefinition(
        applyLightingPresetTemplate(
          selectedEnvironment,
          preset,
          session?.gameProject.identity.id ?? "project"
        )
      );
    },
    onUpdateEnvironmentDefinition: (definition) => {
      dispatchEnvironmentDefinition(definition);
    },
    onAddPostProcessShader: (shaderDefinitionId) => {
      if (!selectedEnvironment) return;
      onCommand({
        kind: "AddPostProcessShader",
        target: {
          aggregateKind: "content-definition",
          aggregateId: selectedEnvironment.definitionId
        },
        subject: {
          subjectKind: "environment-definition",
          subjectId: selectedEnvironment.definitionId
        },
        payload: {
          environmentDefinitionId: selectedEnvironment.definitionId,
          binding: {
            shaderDefinitionId,
            order: selectedEnvironment.postProcessShaders.length,
            enabled: true,
            parameterOverrides: []
          }
        }
      });
    },
    onUpdatePostProcessShaderParameter: (shaderDefinitionId, override) => {
      if (!selectedEnvironment) return;
      onCommand({
        kind: "UpdatePostProcessShaderParameter",
        target: {
          aggregateKind: "content-definition",
          aggregateId: selectedEnvironment.definitionId
        },
        subject: {
          subjectKind: "environment-definition",
          subjectId: selectedEnvironment.definitionId
        },
        payload: {
          environmentDefinitionId: selectedEnvironment.definitionId,
          shaderDefinitionId,
          override
        }
      });
    },
    onTogglePostProcessShader: (shaderDefinitionId, enabled) => {
      if (!selectedEnvironment) return;
      onCommand({
        kind: "TogglePostProcessShader",
        target: {
          aggregateKind: "content-definition",
          aggregateId: selectedEnvironment.definitionId
        },
        subject: {
          subjectKind: "environment-definition",
          subjectId: selectedEnvironment.definitionId
        },
        payload: {
          environmentDefinitionId: selectedEnvironment.definitionId,
          shaderDefinitionId,
          enabled
        }
      });
    },
    onRemovePostProcessShader: (shaderDefinitionId) => {
      if (!selectedEnvironment) return;
      onCommand({
        kind: "RemovePostProcessShader",
        target: {
          aggregateKind: "content-definition",
          aggregateId: selectedEnvironment.definitionId
        },
        subject: {
          subjectKind: "environment-definition",
          subjectId: selectedEnvironment.definitionId
        },
        payload: {
          environmentDefinitionId: selectedEnvironment.definitionId,
          shaderDefinitionId
        }
      });
    }
  });

  const landscapeView = useLandscapeWorkspaceView({
    isActive: activeBuildKind === "landscape",
    viewportStore,
    materialDefinitions,
    region: activeRegion,
    onCommand
  });

  const spatialView = useSpatialWorkspaceView({
    isActive: activeBuildKind === "spatial",
    getViewportElement:
      activeBuildKind === "spatial" ? getViewportElement : () => null,
    viewportStore,
    selectedIds,
    onSelect,
    region: activeRegion,
    onCommand
  });

  const behaviorView = useBehaviorWorkspaceView({
    region: activeRegion,
    npcDefinitions,
    questDefinitions,
    onCommand,
    navigationTarget,
    onConsumeNavigationTarget,
    onNavigateToTarget
  });

  const assetsView = useAssetsWorkspaceView({
    assetDefinitions,
    activeRegion,
    contentLibrary:
      session?.contentLibrary ?? createEmptyContentLibrarySnapshot("empty:content-library"),
    materialDefinitions,
    shaderDefinitions,
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
    onSetAssetMaterialSlotBinding,
    onSetAssetDefaultShader,
    onSetAssetDefaultShaderParameterOverride,
    onClearAssetDefaultShaderParameterOverride,
    onEditShaderGraph: (shaderDefinitionId) =>
      onNavigateToTarget?.({ kind: "shader-graph", shaderDefinitionId }),
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

  const materialsView = useMaterialsWorkspaceView({
    materialDefinitions,
    textureDefinitions,
    shaderDefinitions,
    selectedMaterialDefinitionId,
    onSelectMaterialDefinition: setSelectedMaterialDefinitionId,
    onCreateMaterialDefinition,
    onImportPbrMaterial,
    onImportTextureDefinition,
    onUpdateMaterialDefinition,
    onRemoveMaterialDefinition,
    isMaterialReferenced
  });

  const activeView: WorkspaceViewContribution =
    activeBuildKind === "layout"
      ? layoutView
      : activeBuildKind === "landscape"
        ? landscapeView
        : activeBuildKind === "spatial"
          ? spatialView
          : activeBuildKind === "behavior"
          ? behaviorView
          : activeBuildKind === "environment"
            ? environmentView
            : activeBuildKind === "materials"
              ? materialsView
              : assetsView;

  const contextSelector: BuildContextSelector | null =
    activeBuildKind === "layout" ||
    activeBuildKind === "landscape" ||
    activeBuildKind === "spatial" ||
    activeBuildKind === "behavior"
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
    centerPanel: activeView.centerPanel,
    viewportOverlay: activeView.viewportOverlay,
    environmentOverrideId:
      activeBuildKind === "environment"
        ? selectedEnvironment?.definitionId ?? null
        : null
  };
}
