/**
 * BuildProductModeView: the Build-specific host.
 *
 * Owns: Build sub-nav, workspace kind dispatch.
 * Delegates to: LayoutWorkspaceView, EnvironmentWorkspaceView, AssetsWorkspaceView.
 * Does NOT redefine the shell — returns panel contributions.
 * Accepts plugin-owned inspector sections so build-side affordances stay plugin-owned.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type {
  SemanticCommand,
  AssetDefinition,
  AudioClipDefinition,
  AudioMixerSettings,
  DocumentDefinition,
  EnvironmentDefinition,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  NPCDefinition,
  QuestDefinition,
  RockTypeDefinition,
  SurfaceDefinition,
  SurfaceBinding,
  ShaderParameterOverride,
  ShaderGraphDocument,
  RuntimeSoundEventKey,
  SoundCueDefinition,
  SoundEventBindingMap,
  TextureDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import {
  createEmptyContentLibrarySnapshot,
  getActiveRegion,
  getActiveRegionContents,
  getActiveScene,
  type AuthoringSession,
  type MusicBindings
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
import { useAudioWorkspaceView } from "./audio";
import { useSurfaceLibraryView } from "./surfaces";

const buildWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "layout", label: "Layout", icon: "🏗️" },
  { id: "landscape", label: "Landscape", icon: "⛰️" },
  { id: "spatial", label: "Spatial", icon: "🗺️" },
  { id: "behavior", label: "Behavior", icon: "🎭" },
  { id: "environment", label: "Environment", icon: "🌅" },
  { id: "audio", label: "Audio", icon: "🔊" },
  { id: "surfaces", label: "Surfaces", icon: "🪴" }
];

export interface BuildProductModeViewProps {
  activeBuildKind: BuildWorkspaceKind;
  activeRegionId: string | null;
  activeEnvironmentId: string | null;
  selectedIds: string[];
  session: AuthoringSession | null;
  assetDefinitions: AssetDefinition[];
  surfaceDefinitions: SurfaceDefinition[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  documentDefinitions: DocumentDefinition[];
  environmentDefinitions: EnvironmentDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  audioClipDefinitions: AudioClipDefinition[];
  soundCueDefinitions: SoundCueDefinition[];
  assetSources: Record<string, string>;
  soundEventBindings: SoundEventBindingMap;
  audioMixer: AudioMixerSettings | null;
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
  /** Plan 058 §058.3 — scope conversion + cross-Scene copy,
   *  wired by Studio to the session-level Scene functions. */
  onConvertAssetScope: (regionId: string, instanceId: string) => void;
  onCopyEntryToScene: (options: {
    toSceneId: string;
    regionId: string;
    kind: "npc" | "item" | "player" | "asset";
    id: string;
  }) => void;
  /** Open Game > Libraries > Assets with this definition selected
   *  (asset definition editing lives in the library modal now). */
  onOpenAssetsLibrary: (definitionId: string) => void;
  onCreateMaterialDefinition: () => MaterialDefinition | null;
  onImportPbrMaterial: () => Promise<MaterialDefinition | null>;
  onImportTextureDefinition: () => Promise<TextureDefinition | null>;
  onCreateMaskTextureDefinition: () => Promise<MaskTextureDefinition | null>;
  onImportMaskTextureDefinition: () => Promise<MaskTextureDefinition | null>;
  onUpdateMaterialDefinition: (
    definitionId: string,
    patch: Partial<MaterialDefinition>
  ) => void;
  onDuplicateMaterialDefinition: (sourceDefinitionId: string) => string | null;
  onRemoveMaterialDefinition: (definitionId: string) => void;
  onCreateSurfaceDefinition: () => SurfaceDefinition | null;
  onUpdateSurfaceDefinition: (
    definitionId: string,
    patch: Partial<SurfaceDefinition>
  ) => void;
  onRemoveSurfaceDefinition: (definitionId: string) => void;
  onCreateSoundCueDefinition: () => SoundCueDefinition | null;
  onUpdateSoundCueDefinition: (
    definitionId: string,
    patch: Partial<SoundCueDefinition>
  ) => void;
  onRemoveSoundCueDefinition: (definitionId: string) => void;
  onSetSoundEventBinding: (
    eventKey: RuntimeSoundEventKey,
    soundCueDefinitionId: string | null
  ) => void;
  onUpdateAudioMixer: (patch: Partial<AudioMixerSettings>) => void;
  /** Plan 059 §059.1 — project music slots (Build > Audio). */
  musicBindings: MusicBindings | null;
  onUpdateMusicBindings: (patch: Partial<MusicBindings>) => void;
  selectedSurfaceDefinitionId: string | null;
  onSelectSurfaceDefinition: (definitionId: string | null) => void;
  activeMaskPaintTarget: PaintedMaskTargetAddress | null;
  onSetMaskPaintTarget: (target: PaintedMaskTargetAddress | null) => void;
  surfaceCenterPanel?: ReactNode;
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
    surfaceDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions,
    materialDefinitions,
    textureDefinitions,
    maskTextureDefinitions,
    documentDefinitions,
    environmentDefinitions,
    shaderDefinitions,
    audioClipDefinitions,
    soundCueDefinitions,
    assetSources,
    soundEventBindings,
    audioMixer,
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
    onCreateMaterialDefinition,
    onImportPbrMaterial,
    onImportTextureDefinition,
    onCreateMaskTextureDefinition,
    onImportMaskTextureDefinition,
    onRemoveMaterialDefinition,
    onCreateSurfaceDefinition,
    onUpdateSurfaceDefinition,
    onRemoveSurfaceDefinition,
    onCreateSoundCueDefinition,
    onUpdateSoundCueDefinition,
    onRemoveSoundCueDefinition,
    onSetSoundEventBinding,
    onUpdateAudioMixer,
    musicBindings,
    onUpdateMusicBindings,
    selectedSurfaceDefinitionId,
    onSelectSurfaceDefinition,
    activeMaskPaintTarget,
    onSetMaskPaintTarget,
    surfaceCenterPanel,
    isMaterialReferenced,
    renderLayoutInspectorSections
  } = props;

  const activeRegion = session ? getActiveRegion(session) : null;

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
    getViewportElement:
      activeBuildKind === "layout" ? getViewportElement : () => null,
    viewportStore,
    selectedIds,
    onSelect,
    onCommand,
    getRegion: () => (session ? getActiveRegion(session) : null),
    getRegionContents: () =>
      session ? getActiveRegionContents(session) : null,
    getActiveScene: () => (session ? getActiveScene(session) : null),
    getAllScenes: () => session?.gameProject.scenes ?? [],
    onConvertAssetScope: props.onConvertAssetScope,
    onCopyEntryToScene: props.onCopyEntryToScene,
    assetDefinitions,
    playerDefinition: session?.gameProject.playerDefinition ?? null,
    itemDefinitions: session?.gameProject.itemDefinitions ?? [],
    documentDefinitions,
    npcDefinitions: session?.gameProject.npcDefinitions ?? [],
    soundCueDefinitions,
    onImportAsset,
    renderInspectorSections: renderLayoutInspectorSections,
    // Assets are library content (2026-07-09); "edit definition"
    // opens the Assets library modal instead of a workspace tab.
    onEditAssetDefinition: (definitionId) =>
      props.onOpenAssetsLibrary(definitionId)
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
    regionContents: session ? getActiveRegionContents(session) : null,
    npcDefinitions,
    questDefinitions,
    onCommand,
    navigationTarget,
    onConsumeNavigationTarget,
    onNavigateToTarget
  });

  const audioView = useAudioWorkspaceView({
    audioClipDefinitions,
    soundCueDefinitions,
    assetSources,
    soundEventBindings,
    audioMixer,
    onCreateSoundCueDefinition,
    onUpdateSoundCueDefinition,
    onRemoveSoundCueDefinition,
    onSetSoundEventBinding,
    onUpdateAudioMixer,
    musicBindings,
    onUpdateMusicBindings
  });

  const surfacesView = useSurfaceLibraryView({
    surfaceDefinitions,
    materialDefinitions,
    textureDefinitions,
    maskTextureDefinitions,
    onCreateMaskTextureDefinition,
    onImportMaskTextureDefinition,
    shaderDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions,
    selectedSurfaceDefinitionId,
    onSelectSurfaceDefinition,
    onCreateSurfaceDefinition,
    onUpdateSurfaceDefinition,
    onRemoveSurfaceDefinition,
    centerPanel: surfaceCenterPanel
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
            : activeBuildKind === "audio"
              ? audioView
              : activeBuildKind === "environment"
                ? environmentView
                : surfacesView;

  const contextSelector: BuildContextSelector | null =
    activeBuildKind === "layout" ||
    activeBuildKind === "landscape" ||
    activeBuildKind === "spatial" ||
    activeBuildKind === "behavior" ||
    activeBuildKind === "audio"
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
      <>
        <Group gap="xs" align="center">
          <BuildSubNav
            workspaceKinds={buildWorkspaceKinds}
            activeKindId={activeBuildKind}
            onSelectKind={(id) => onSelectKind(id as BuildWorkspaceKind)}
            contextSelector={contextSelector}
          />
        </Group>
      </>
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
      ) : (
        (activeView.leftPanel ?? null)
      ),

    rightPanel: activeView.rightPanel,
    centerPanel: activeView.centerPanel,
    viewportOverlay: activeView.viewportOverlay,
    environmentOverrideId:
      activeBuildKind === "environment"
        ? (selectedEnvironment?.definitionId ?? null)
        : null
  };
}
