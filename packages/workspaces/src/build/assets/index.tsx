/**
 * Build-mode asset library inspector and placement surface.
 *
 * Shows the canonical project asset definitions, including specialized
 * foliage assets, without creating a second asset browser just for trees.
 */

import { useMemo, useState } from "react";
import {
  Stack,
  Text,
  Button,
  UnstyledButton,
  Group,
  TextInput
} from "@mantine/core";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  MaterialDefinition,
  RegionDocument,
  ShaderGraphDocument,
  ShaderParameterOverride,
  ShaderSlotKind
} from "@sugarmagic/domain";
import { createEmptyShaderSlotBindingMap } from "@sugarmagic/domain";
import { PanelSection, Inspector } from "@sugarmagic/ui";
import { resolveAssetDefinitionShaderBindings } from "@sugarmagic/runtime-core";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { MaterialSlotBindingsEditor } from "../MaterialSlotBindingsEditor";
import { ShaderSlotEditor } from "../ShaderSlotEditor";

export interface AssetsWorkspaceViewProps {
  assetDefinitions: AssetDefinition[];
  activeRegion: RegionDocument | null;
  contentLibrary: ContentLibrarySnapshot;
  materialDefinitions: MaterialDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  selectedAssetDefinitionId: string | null;
  onSelectAssetDefinition: (definitionId: string) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onPlaceAsset: (assetDefinition: AssetDefinition) => void;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onSetAssetMaterialSlotBinding: (
    definitionId: string,
    slotName: string,
    slotIndex: number,
    materialDefinitionId: string | null
  ) => void;
  onSetAssetDefaultShader: (
    definitionId: string,
    slot: ShaderSlotKind,
    shaderDefinitionId: string | null
  ) => void;
  onSetAssetDefaultShaderParameterOverride?: (
    definitionId: string,
    slot: ShaderSlotKind,
    override: ShaderParameterOverride
  ) => void;
  onClearAssetDefaultShaderParameterOverride?: (
    definitionId: string,
    slot: ShaderSlotKind,
    parameterId: string
  ) => void;
  onEditShaderGraph?: (shaderDefinitionId: string) => void;
  onRemoveAssetDefinition: (definitionId: string) => void;
  hasSceneReferences: (definitionId: string) => boolean;
}

function getAssetKindIcon(assetDefinition: AssetDefinition): string {
  return assetDefinition.assetKind === "foliage" ? "🌳" : "📦";
}

function getAssetKindLabel(assetDefinition: AssetDefinition): string {
  return assetDefinition.assetKind === "foliage" ? "Foliage" : "Model";
}

export function useAssetsWorkspaceView(
  props: AssetsWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    assetDefinitions,
    activeRegion,
    contentLibrary,
    materialDefinitions,
    shaderDefinitions,
    selectedAssetDefinitionId,
    onSelectAssetDefinition,
    onImportAsset,
    onPlaceAsset,
    onUpdateAssetDefinition,
    onSetAssetMaterialSlotBinding,
    onSetAssetDefaultShader,
    onSetAssetDefaultShaderParameterOverride,
    onClearAssetDefaultShaderParameterOverride,
    onEditShaderGraph,
    onRemoveAssetDefinition,
    hasSceneReferences
  } = props;

  const selectedAsset = useMemo(
    () =>
      assetDefinitions.find(
        (definition) => definition.definitionId === selectedAssetDefinitionId
      ) ?? null,
    [assetDefinitions, selectedAssetDefinitionId]
  );

  return {
    leftPanel: (
      <>
        <PanelSection title="Asset Library" icon="📦">
          <Stack gap="xs">
            <Button size="xs" variant="light" onClick={async () => {
              const importedAsset = await onImportAsset();
              if (importedAsset) {
                onSelectAssetDefinition(importedAsset.definitionId);
              }
            }}>
              Import Asset
            </Button>
            {assetDefinitions.length === 0 ? (
              <Text size="xs" c="var(--sm-color-overlay0)" p="sm" ta="center">
                No imported assets yet.
              </Text>
            ) : (
              <Stack gap={4}>
                {assetDefinitions.map((definition) => {
                  const isSelected = definition.definitionId === selectedAssetDefinitionId;
                  return (
                    <UnstyledButton
                      key={definition.definitionId}
                      onClick={() => onSelectAssetDefinition(definition.definitionId)}
                      styles={{
                        root: {
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sm-space-sm)",
                          padding: "6px 8px",
                          borderRadius: "var(--sm-radius-sm)",
                          background: isSelected ? "var(--sm-active-bg)" : "transparent",
                          color: isSelected ? "var(--sm-accent-blue)" : "var(--sm-color-text)",
                          transition: "var(--sm-transition-fast)",
                          "&:hover": {
                            background: isSelected ? "var(--sm-active-bg-hover)" : "var(--sm-hover-bg)"
                          }
                        }
                      }}
                    >
                      <Text size="xs">{getAssetKindIcon(definition)}</Text>
                      <Group gap={4} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                        <Text size="xs" truncate fw={isSelected ? 600 : 400}>
                          {definition.displayName}
                        </Text>
                        <Text size="xs" c="var(--sm-color-overlay0)">
                          {getAssetKindLabel(definition)}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </PanelSection>
      </>
    ),
    rightPanel: (
      <Inspector selectionLabel={selectedAsset?.displayName ?? null}>
        {selectedAsset ? (
          <AssetInspectorPanel
            key={selectedAsset.definitionId}
            assetDefinition={selectedAsset}
            contentLibrary={contentLibrary}
            canPlace={Boolean(activeRegion)}
            canRemove={!hasSceneReferences(selectedAsset.definitionId)}
            materialDefinitions={materialDefinitions}
            shaderDefinitions={shaderDefinitions}
            onPlaceAsset={onPlaceAsset}
            onUpdateAssetDefinition={onUpdateAssetDefinition}
            onSetAssetMaterialSlotBinding={onSetAssetMaterialSlotBinding}
            onSetAssetDefaultShader={onSetAssetDefaultShader}
            onSetAssetDefaultShaderParameterOverride={
              onSetAssetDefaultShaderParameterOverride
            }
            onClearAssetDefaultShaderParameterOverride={
              onClearAssetDefaultShaderParameterOverride
            }
            onEditShaderGraph={onEditShaderGraph}
            onRemoveAssetDefinition={onRemoveAssetDefinition}
          />
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select an imported asset to inspect or place it.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: null
  };
}

function AssetInspectorPanel({
  assetDefinition,
  contentLibrary,
  canPlace,
  canRemove,
  materialDefinitions,
  shaderDefinitions,
  onPlaceAsset,
  onUpdateAssetDefinition,
  onSetAssetMaterialSlotBinding,
  onSetAssetDefaultShader,
  onSetAssetDefaultShaderParameterOverride,
  onClearAssetDefaultShaderParameterOverride,
  onEditShaderGraph,
  onRemoveAssetDefinition
}: {
  assetDefinition: AssetDefinition;
  contentLibrary: ContentLibrarySnapshot;
  canPlace: boolean;
  canRemove: boolean;
  materialDefinitions: MaterialDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  onPlaceAsset: (assetDefinition: AssetDefinition) => void;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onSetAssetMaterialSlotBinding: (
    definitionId: string,
    slotName: string,
    slotIndex: number,
    materialDefinitionId: string | null
  ) => void;
  onSetAssetDefaultShader: (
    definitionId: string,
    slot: ShaderSlotKind,
    shaderDefinitionId: string | null
  ) => void;
  onSetAssetDefaultShaderParameterOverride?: (
    definitionId: string,
    slot: ShaderSlotKind,
    override: ShaderParameterOverride
  ) => void;
  onClearAssetDefaultShaderParameterOverride?: (
    definitionId: string,
    slot: ShaderSlotKind,
    parameterId: string
  ) => void;
  onEditShaderGraph?: (shaderDefinitionId: string) => void;
  onRemoveAssetDefinition: (definitionId: string) => void;
}) {
  const [draftDisplayName, setDraftDisplayName] = useState(
    assetDefinition.displayName
  );
  const shaderResolution = useMemo(
    () => resolveAssetDefinitionShaderBindings(assetDefinition, contentLibrary),
    [assetDefinition, contentLibrary]
  );

  return (
    <Stack gap="md">
      <TextInput
        label="Display Name"
        value={draftDisplayName}
        onChange={(event) => setDraftDisplayName(event.currentTarget.value)}
        size="xs"
        styles={{
          label: {
            color: "var(--sm-color-subtext)",
            fontSize: "var(--sm-font-size-sm)",
            marginBottom: 4
          },
          input: {
            background: "var(--sm-color-base)",
            borderColor: "var(--sm-panel-border)",
            color: "var(--sm-color-text)"
          }
        }}
      />
      <Button
        size="xs"
        variant="light"
        disabled={
          !draftDisplayName.trim() ||
          draftDisplayName === assetDefinition.displayName
        }
        onClick={() =>
          onUpdateAssetDefinition(
            assetDefinition.definitionId,
            draftDisplayName.trim()
          )
        }
      >
        Save Asset Definition
      </Button>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Type
        </Text>
        <Text size="xs" c="var(--sm-color-text)">
          {getAssetKindLabel(assetDefinition)}
        </Text>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Source
        </Text>
        <Text size="xs" c="var(--sm-color-text)">
          {assetDefinition.source.fileName}
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)">
          {assetDefinition.source.relativeAssetPath}
        </Text>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Materials
        </Text>
        <MaterialSlotBindingsEditor
          bindings={assetDefinition.materialSlotBindings ?? []}
          materialDefinitions={materialDefinitions}
          onChangeBinding={(slotName, slotIndex, materialDefinitionId) =>
            onSetAssetMaterialSlotBinding(
              assetDefinition.definitionId,
              slotName,
              slotIndex,
              materialDefinitionId
            )
          }
        />
      </Stack>
      <ShaderSlotEditor
        bindings={{
          ...createEmptyShaderSlotBindingMap(),
          ...(assetDefinition.defaultShaderBindings ?? {})
        }}
        shaderDefinitions={
          shaderDefinitions.filter((definition) =>
            assetDefinition.assetKind === "foliage"
              ? definition.targetKind === "mesh-deform" ||
                definition.targetKind === "mesh-surface"
              : definition.targetKind === "mesh-surface"
          )
        }
        onChangeBinding={(slot, shaderDefinitionId) =>
          onSetAssetDefaultShader(assetDefinition.definitionId, slot, shaderDefinitionId)
        }
        parameterOverrides={assetDefinition.defaultShaderParameterOverrides ?? []}
        diagnostics={shaderResolution.diagnostics}
        onChangeParameterOverride={
          onSetAssetDefaultShaderParameterOverride
            ? (slot, override) =>
                onSetAssetDefaultShaderParameterOverride(
                  assetDefinition.definitionId,
                  slot,
                  override
                )
            : undefined
        }
        onClearParameterOverride={
          onClearAssetDefaultShaderParameterOverride
            ? (slot, parameterId) =>
                onClearAssetDefaultShaderParameterOverride(
                  assetDefinition.definitionId,
                  slot,
                  parameterId
                )
            : undefined
        }
        onEditShaderGraph={onEditShaderGraph}
      />
      <Button size="xs" disabled={!canPlace} onClick={() => onPlaceAsset(assetDefinition)}>
        Place In Active Region
      </Button>
      <Button
        size="xs"
        color="red"
        variant="subtle"
        disabled={!canRemove}
        onClick={() => onRemoveAssetDefinition(assetDefinition.definitionId)}
      >
        Remove From Project
      </Button>
      {!canRemove && (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Remove this asset from all scenes before deleting it from the project.
        </Text>
      )}
    </Stack>
  );
}
