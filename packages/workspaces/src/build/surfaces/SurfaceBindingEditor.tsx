/**
 * Surface binding editor.
 *
 * Top-level editor for a slot's `SurfaceBinding`: either an inline layer stack
 * or a reference to a reusable `SurfaceDefinition`.
 */

import { Button, Select, Stack, Text } from "@mantine/core";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RockTypeDefinition,
  ShaderGraphDocument,
  SurfaceBinding,
  SurfaceContext,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import {
  cloneSurface,
  createDefaultSurface,
  createInlineSurfaceBinding,
  createReferenceSurfaceBinding
} from "@sugarmagic/domain";
import { LayerStackView } from "./LayerStackView";
import { surfaceDefinitionMatchesContext } from "./utils";

export interface SurfaceBindingEditorProps<C extends SurfaceContext = SurfaceContext> {
  value: SurfaceBinding<C> | null;
  allowedContext: C;
  paintOwner:
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "landscape-channel" }>, "layerId">
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "asset-slot" }>, "layerId">
    | null;
  surfaceDefinitions: SurfaceDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activeMaskPaintTarget?: PaintedMaskTargetAddress | null;
  onSetMaskPaintTarget?: (target: PaintedMaskTargetAddress | null) => void;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  onChange: (next: SurfaceBinding<C> | null) => void;
}

export function SurfaceBindingEditor<C extends SurfaceContext = SurfaceContext>({
  value,
  allowedContext,
  paintOwner,
  surfaceDefinitions,
  materialDefinitions,
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
  onChange
}: SurfaceBindingEditorProps<C>) {
  const compatibleSurfaceDefinitions = surfaceDefinitions.filter((definition) =>
    surfaceDefinitionMatchesContext(definition, allowedContext)
  );
  const selectedReferenceSurface =
    value?.kind === "reference"
      ? compatibleSurfaceDefinitions.find(
          (definition) => definition.definitionId === value.surfaceDefinitionId
        ) ?? null
      : null;

  return (
    <Stack gap="xs" style={{ minWidth: 260 }}>
      <Select
        size="xs"
        label="Binding Mode"
        data={[
          { value: "__none__", label: "No Surface" },
          { value: "inline", label: "Inline Surface" },
          { value: "reference", label: "Surface Library Reference" }
        ]}
        value={value?.kind ?? "__none__"}
        onChange={(next) => {
          if (next === "__none__") {
            onChange(null);
            return;
          }
          if (next === "inline") {
            if (value?.kind === "reference" && selectedReferenceSurface) {
              onChange(
                createInlineSurfaceBinding(
                  cloneSurface(selectedReferenceSurface.surface)
                ) as SurfaceBinding<C>
              );
              return;
            }
            onChange(
              createInlineSurfaceBinding(
                createDefaultSurface()
              ) as SurfaceBinding<C>
            );
            return;
          }
          onChange(
            compatibleSurfaceDefinitions[0]
              ? createReferenceSurfaceBinding(
                  compatibleSurfaceDefinitions[0].definitionId
                ) as SurfaceBinding<C>
              : null
          );
        }}
      />

      {value?.kind === "reference" ? (
        <>
          <Select
            size="xs"
            label="Surface"
            data={compatibleSurfaceDefinitions.map((definition) => ({
              value: definition.definitionId,
              label: definition.displayName
            }))}
            value={value.surfaceDefinitionId}
            onChange={(next) => {
              if (next) {
                onChange(createReferenceSurfaceBinding(next) as SurfaceBinding<C>);
              }
            }}
          />
          {selectedReferenceSurface ? (
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() =>
                onChange(
                  createInlineSurfaceBinding(
                    cloneSurface(selectedReferenceSurface.surface)
                  ) as SurfaceBinding<C>
                )
              }
            >
              Make Local
            </Button>
          ) : null}
        </>
      ) : null}

      {value?.kind === "inline" ? (
        <LayerStackView
          surface={value.surface}
          allowedContext={allowedContext}
          allowPainted={paintOwner !== null}
          paintOwner={paintOwner}
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
          onChangeSurface={(surface) => {
            onChange({
              kind: "inline",
              surface
            });
          }}
        />
      ) : null}

      {!value ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          This slot has no assigned surface yet.
        </Text>
      ) : null}
    </Stack>
  );
}
