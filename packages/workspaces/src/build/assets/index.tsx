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
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  SurfaceDefinition,
  SurfaceBinding,
  ShaderGraphDocument,
  ShaderParameterOverride,
  ShaderSlotKind,
  TextureDefinition
} from "@sugarmagic/domain";
import { createEmptyShaderSlotBindingMap } from "@sugarmagic/domain";
import { PanelSection, Inspector } from "@sugarmagic/ui";
import { resolveAssetDefinitionShaderBindings } from "@sugarmagic/runtime-core";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { MaterialSlotBindingsEditor } from "../MaterialSlotBindingsEditor";
import { ShaderSlotEditor } from "../ShaderSlotEditor";

export interface AssetsWorkspaceViewProps {
  assetDefinitions: AssetDefinition[];
  contentLibrary: ContentLibrarySnapshot;
  surfaceDefinitions: SurfaceDefinition[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  selectedAssetDefinitionId: string | null;
  onSelectAssetDefinition: (definitionId: string) => void;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onSetAssetMaterialSlotBinding: (
    definitionId: string,
    slotName: string,
    slotIndex: number,
    surface: SurfaceBinding<"universal"> | null
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
    contentLibrary,
    surfaceDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    materialDefinitions,
    textureDefinitions,
    shaderDefinitions,
    selectedAssetDefinitionId,
    onSelectAssetDefinition,
    onImportAsset,
    onUpdateAssetDefinition,
    onSetAssetMaterialSlotBinding,
    onSetAssetDefaultShader,
    onEditShaderGraph,
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
            surfaceDefinitions={surfaceDefinitions}
            grassTypeDefinitions={grassTypeDefinitions}
            flowerTypeDefinitions={flowerTypeDefinitions}
            materialDefinitions={materialDefinitions}
            textureDefinitions={textureDefinitions}
            shaderDefinitions={shaderDefinitions}
            onUpdateAssetDefinition={onUpdateAssetDefinition}
            onSetAssetMaterialSlotBinding={onSetAssetMaterialSlotBinding}
            onSetAssetDefaultShader={onSetAssetDefaultShader}
            onEditShaderGraph={onEditShaderGraph}
          />
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select an imported asset to inspect and edit it.
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
  surfaceDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  materialDefinitions,
  textureDefinitions,
  shaderDefinitions,
  onUpdateAssetDefinition,
  onSetAssetMaterialSlotBinding,
  onSetAssetDefaultShader,
  onEditShaderGraph
}: {
  assetDefinition: AssetDefinition;
  contentLibrary: ContentLibrarySnapshot;
  surfaceDefinitions: SurfaceDefinition[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onSetAssetMaterialSlotBinding: (
    definitionId: string,
    slotName: string,
    slotIndex: number,
    surface: SurfaceBinding<"universal"> | null
  ) => void;
  onSetAssetDefaultShader: (
    definitionId: string,
    slot: ShaderSlotKind,
    shaderDefinitionId: string | null
  ) => void;
  onEditShaderGraph?: (shaderDefinitionId: string) => void;
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
          Surfaces
        </Text>
        <MaterialSlotBindingsEditor
          bindings={assetDefinition.surfaceSlots}
          surfaceDefinitions={surfaceDefinitions}
          materialDefinitions={materialDefinitions}
          textureDefinitions={textureDefinitions}
          shaderDefinitions={shaderDefinitions}
          grassTypeDefinitions={grassTypeDefinitions}
          flowerTypeDefinitions={flowerTypeDefinitions}
          onChangeBinding={(slotName, slotIndex, surface) =>
            onSetAssetMaterialSlotBinding(
              assetDefinition.definitionId,
              slotName,
              slotIndex,
              surface
            )
          }
        />
      </Stack>
      <ShaderSlotEditor
        bindings={{
          ...createEmptyShaderSlotBindingMap(),
          deform:
            assetDefinition.deform?.kind === "shader"
              ? assetDefinition.deform.shaderDefinitionId
              : null,
          effect:
            assetDefinition.effect?.kind === "shader"
              ? assetDefinition.effect.shaderDefinitionId
              : null
        }}
        shaderDefinitions={
          shaderDefinitions.filter((definition) =>
            assetDefinition.assetKind === "foliage"
              ? definition.targetKind === "mesh-deform" ||
                definition.targetKind === "mesh-effect"
              : definition.targetKind === "mesh-deform" ||
                definition.targetKind === "mesh-effect"
          )
        }
        slots={["deform", "effect"]}
        onChangeBinding={(slot, shaderDefinitionId) =>
          onSetAssetDefaultShader(assetDefinition.definitionId, slot, shaderDefinitionId)
        }
        parameterOverrides={[]}
        diagnostics={shaderResolution.diagnostics}
        onChangeParameterOverride={undefined}
        onClearParameterOverride={undefined}
        onEditShaderGraph={onEditShaderGraph}
      />
    </Stack>
  );
}
