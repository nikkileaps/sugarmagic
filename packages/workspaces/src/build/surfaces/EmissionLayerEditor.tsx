/**
 * Emission layer editor.
 *
 * Strongly-typed editor for one EmissionLayer: the emission
 * content union (color / texture / material) plus intensity.
 */

import { Select, Stack } from "@mantine/core";
import type { EmissionLayer } from "@sugarmagic/domain";
import {
  createColorEmissionContent,
  createMaterialEmissionContent,
  createTextureEmissionContent
} from "@sugarmagic/domain";
import { ColorField, KindTabs, LabeledSlider } from "@sugarmagic/ui";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";

export interface EmissionLayerEditorProps {
  layer: EmissionLayer;
  onChange: (next: EmissionLayer) => void;
}

export function EmissionLayerEditor({ layer, onChange }: EmissionLayerEditorProps) {
  const { textureDefinitions, materialDefinitions } = useSurfaceAuthoring();
  return (
    <KindTabs
      value={layer.content.kind}
      options={[
        { value: "color", label: "Color" },
        { value: "texture", label: "Texture" },
        { value: "material", label: "Material" }
      ]}
      onChange={(kind) => {
        if (kind === "color") {
          onChange({
            ...layer,
            content: createColorEmissionContent(0xf6cd7c, 0.2)
          });
        } else if (kind === "texture") {
          onChange({
            ...layer,
            content: createTextureEmissionContent(
              textureDefinitions[0]?.definitionId ?? "",
              0.2,
              [1, 1]
            )
          });
        } else {
          onChange({
            ...layer,
            content: createMaterialEmissionContent(
              materialDefinitions[0]?.definitionId ?? ""
            )
          });
        }
      }}
      renderPanel={(kind) => {
        if (kind === "color" && layer.content.kind === "color") {
          const colorContent = layer.content;
          return (
            <Stack gap="xs">
              <ColorField
                label="Color"
                value={colorContent.color}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    content: createColorEmissionContent(next, colorContent.intensity)
                  })
                }
              />
              <LabeledSlider
                label="Intensity"
                min={0}
                max={2}
                value={colorContent.intensity}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    content: createColorEmissionContent(colorContent.color, next)
                  })
                }
              />
            </Stack>
          );
        }
        if (kind === "texture" && layer.content.kind === "texture") {
          const textureContent = layer.content;
          return (
            <Stack gap="xs">
              <Select
                size="xs"
                label="Texture"
                comboboxProps={{ withinPortal: false }}
                data={textureDefinitions.map((texture) => ({
                  value: texture.definitionId,
                  label: texture.displayName
                }))}
                value={textureContent.textureDefinitionId}
                onChange={(next) => {
                  if (next) {
                    onChange({
                      ...layer,
                      content: createTextureEmissionContent(
                        next,
                        textureContent.intensity,
                        textureContent.tiling
                      )
                    });
                  }
                }}
              />
              <LabeledSlider
                label="Intensity"
                min={0}
                max={2}
                value={textureContent.intensity}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    content: createTextureEmissionContent(
                      textureContent.textureDefinitionId,
                      next,
                      textureContent.tiling
                    )
                  })
                }
              />
            </Stack>
          );
        }
        if (kind === "material" && layer.content.kind === "material") {
          const materialContent = layer.content;
          return (
            <Select
              size="xs"
              label="Material"
              comboboxProps={{ withinPortal: false }}
              data={materialDefinitions.map((material) => ({
                value: material.definitionId,
                label: material.displayName
              }))}
              value={materialContent.materialDefinitionId}
              onChange={(next) => {
                if (next) {
                  onChange({
                    ...layer,
                    content: createMaterialEmissionContent(next)
                  });
                }
              }}
            />
          );
        }
        return null;
      }}
    />
  );
}
