/**
 * Asset definition inspector.
 *
 * The Assets library modal's right-hand panel (Game > Libraries >
 * Assets): rename, source info, per-slot surface bindings, and
 * default deform/effect shaders for one imported asset definition.
 *
 * History: this used to be a whole Build workspace ("Assets" tab)
 * because assets predate the library pattern. The workspace is gone
 * (2026-07-09) — assets are ordinary library content now; only this
 * inspector survived the move.
 */

import { useMemo, useState } from "react";
import { Stack, Text, Button, TextInput } from "@mantine/core";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RockTypeDefinition,
  SurfaceDefinition,
  SurfaceBinding,
  ShaderGraphDocument,
  ShaderSlotKind,
  TextureDefinition
} from "@sugarmagic/domain";
import { createEmptyShaderSlotBindingMap } from "@sugarmagic/domain";
import { resolveAssetDefinitionShaderBindings } from "@sugarmagic/runtime-core";
import { MaterialSlotBindingsEditor } from "../MaterialSlotBindingsEditor";
import { ShaderSlotEditor } from "../ShaderSlotEditor";

function getAssetKindLabel(assetDefinition: AssetDefinition): string {
  return assetDefinition.assetKind === "foliage" ? "Foliage" : "Model";
}

export interface AssetDefinitionInspectorProps {
  assetDefinition: AssetDefinition;
  contentLibrary: ContentLibrarySnapshot;
  surfaceDefinitions: SurfaceDefinition[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  activeMaskPaintTarget?: PaintedMaskTargetAddress | null;
  onSetMaskPaintTarget?: (target: PaintedMaskTargetAddress | null) => void;
  onCreateMaskTextureDefinition?: () =>
    | Promise<MaskTextureDefinition | null>
    | MaskTextureDefinition
    | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
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
}

export function AssetDefinitionInspector({
  assetDefinition,
  contentLibrary,
  surfaceDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  rockTypeDefinitions,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  shaderDefinitions,
  activeMaskPaintTarget,
  onSetMaskPaintTarget,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  onUpdateAssetDefinition,
  onSetAssetMaterialSlotBinding,
  onSetAssetDefaultShader,
  onEditShaderGraph
}: AssetDefinitionInspectorProps) {
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
          assetDefinitionId={assetDefinition.definitionId}
          surfaceDefinitions={surfaceDefinitions}
          materialDefinitions={materialDefinitions}
          textureDefinitions={textureDefinitions}
          maskTextureDefinitions={maskTextureDefinitions}
          onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
          onImportMaskTextureDefinition={onImportMaskTextureDefinition}
          activeMaskPaintTarget={activeMaskPaintTarget}
          onSetMaskPaintTarget={onSetMaskPaintTarget}
          shaderDefinitions={shaderDefinitions}
          grassTypeDefinitions={grassTypeDefinitions}
          flowerTypeDefinitions={flowerTypeDefinitions}
          rockTypeDefinitions={rockTypeDefinitions}
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
        shaderDefinitions={shaderDefinitions.filter(
          (definition) =>
            definition.targetKind === "mesh-deform" ||
            definition.targetKind === "mesh-effect"
        )}
        slots={["deform", "effect"]}
        onChangeBinding={(slot, shaderDefinitionId) =>
          onSetAssetDefaultShader(
            assetDefinition.definitionId,
            slot,
            shaderDefinitionId
          )
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
