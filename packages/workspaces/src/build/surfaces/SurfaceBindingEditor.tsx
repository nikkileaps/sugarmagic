/**
 * Surface binding editor.
 *
 * Top-level editor for a slot's `SurfaceBinding`: either an inline layer stack
 * or a reference to a reusable `SurfaceDefinition`.
 */

import { Select, Stack, Switch, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  RockTypeDefinition,
  ShaderGraphDocument,
  SurfaceBinding,
  SurfaceContext,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import { createDefaultSurface, createInlineSurfaceBinding, createReferenceSurfaceBinding } from "@sugarmagic/domain";
import { LayerStackView } from "./LayerStackView";
import { ReferenceLayerOverridePanel } from "./ReferenceLayerOverridePanel";
import {
  cloneLayerOverride,
  createSeededLayerOverride,
  surfaceDefinitionMatchesContext
} from "./utils";

export interface SurfaceBindingEditorProps<C extends SurfaceContext = SurfaceContext> {
  value: SurfaceBinding<C> | null;
  allowedContext: C;
  surfaceDefinitions: SurfaceDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activePaintMaskTextureId?: string | null;
  onSetActivePaintMaskTextureId?: (definitionId: string | null) => void;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  onChange: (next: SurfaceBinding<C> | null) => void;
}

export function SurfaceBindingEditor<C extends SurfaceContext = SurfaceContext>({
  value,
  allowedContext,
  surfaceDefinitions,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  activePaintMaskTextureId,
  onSetActivePaintMaskTextureId,
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
  const [selectedReferenceLayerId, setSelectedReferenceLayerId] = useState<string | null>(
    selectedReferenceSurface?.surface.layers[0]?.layerId ?? null
  );

  useEffect(() => {
    if (!selectedReferenceSurface) {
      setSelectedReferenceLayerId(null);
      return;
    }
    if (
      selectedReferenceLayerId &&
      selectedReferenceSurface.surface.layers.some(
        (layer) => layer.layerId === selectedReferenceLayerId
      )
    ) {
      return;
    }
    setSelectedReferenceLayerId(selectedReferenceSurface.surface.layers[0]?.layerId ?? null);
  }, [selectedReferenceLayerId, selectedReferenceSurface]);

  const selectedReferenceLayer = useMemo(
    () =>
      selectedReferenceSurface?.surface.layers.find(
        (layer) => layer.layerId === selectedReferenceLayerId
      ) ?? null,
    [selectedReferenceLayerId, selectedReferenceSurface]
  );
  const selectedLayerOverride =
    value?.kind === "reference" && selectedReferenceLayerId
      ? value.layerOverrides?.[selectedReferenceLayerId] ?? null
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
            <>
              <Select
                size="xs"
                label="Layer"
                data={selectedReferenceSurface.surface.layers.map((layer) => ({
                  value: layer.layerId,
                  label: layer.displayName
                }))}
                value={selectedReferenceLayerId}
                onChange={(next) => setSelectedReferenceLayerId(next)}
              />
              {selectedReferenceLayer ? (
                <Switch
                  size="xs"
                  label={`Override "${selectedReferenceLayer.displayName}" here`}
                  checked={Boolean(selectedLayerOverride)}
                  onChange={(event) => {
                    if (value.kind !== "reference") {
                      return;
                    }
                    const nextOverrides = { ...(value.layerOverrides ?? {}) };
                    if (event.currentTarget.checked) {
                      nextOverrides[selectedReferenceLayer.layerId] =
                        createSeededLayerOverride(selectedReferenceLayer);
                    } else {
                      delete nextOverrides[selectedReferenceLayer.layerId];
                    }
                    onChange({
                      ...value,
                      layerOverrides: nextOverrides
                    });
                  }}
                />
              ) : null}
              {selectedReferenceLayer && selectedLayerOverride ? (
                <ReferenceLayerOverridePanel
                  layer={selectedReferenceLayer}
                  override={selectedLayerOverride}
                  allowedContext={allowedContext}
                  materialDefinitions={materialDefinitions}
                  textureDefinitions={textureDefinitions}
                  maskTextureDefinitions={maskTextureDefinitions}
                  shaderDefinitions={shaderDefinitions}
                  onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
                  onImportMaskTextureDefinition={onImportMaskTextureDefinition}
                  onChange={(nextOverride) => {
                    if (value.kind !== "reference") {
                      return;
                    }
                    onChange({
                      ...value,
                      layerOverrides: {
                        ...(value.layerOverrides ?? {}),
                        [nextOverride.layerId]: cloneLayerOverride(nextOverride)
                      }
                    });
                  }}
                  onClear={() => {
                    if (value.kind !== "reference") {
                      return;
                    }
                    const nextOverrides = { ...(value.layerOverrides ?? {}) };
                    delete nextOverrides[selectedReferenceLayer.layerId];
                    onChange({
                      ...value,
                      layerOverrides: nextOverrides
                    });
                  }}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {value?.kind === "inline" ? (
        <LayerStackView
          surface={value.surface}
          allowedContext={allowedContext}
          materialDefinitions={materialDefinitions}
          textureDefinitions={textureDefinitions}
          maskTextureDefinitions={maskTextureDefinitions}
          onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
          onImportMaskTextureDefinition={onImportMaskTextureDefinition}
          activePaintMaskTextureId={activePaintMaskTextureId}
          onSetActivePaintMaskTextureId={onSetActivePaintMaskTextureId}
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
