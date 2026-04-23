/**
 * Surface binding editor.
 *
 * Top-level editor for a slot's `SurfaceBinding`: either an inline layer stack
 * or a reference to a reusable `SurfaceDefinition`.
 */

import { Select, Stack, Text } from "@mantine/core";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  ShaderGraphDocument,
  SurfaceBinding,
  SurfaceContext,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import { createDefaultSurface, createInlineSurfaceBinding, createReferenceSurfaceBinding } from "@sugarmagic/domain";
import { LayerStackView } from "./LayerStackView";
import { surfaceDefinitionMatchesContext } from "./utils";

export interface SurfaceBindingEditorProps<C extends SurfaceContext = SurfaceContext> {
  value: SurfaceBinding<C> | null;
  allowedContext: C;
  surfaceDefinitions: SurfaceDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  onChange: (next: SurfaceBinding<C> | null) => void;
}

export function SurfaceBindingEditor<C extends SurfaceContext = SurfaceContext>({
  value,
  allowedContext,
  surfaceDefinitions,
  materialDefinitions,
  textureDefinitions,
  shaderDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  onChange
}: SurfaceBindingEditorProps<C>) {
  const compatibleSurfaceDefinitions = surfaceDefinitions.filter((definition) =>
    surfaceDefinitionMatchesContext(definition, allowedContext)
  );

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
      ) : null}

      {value?.kind === "inline" ? (
        <LayerStackView
          surface={value.surface}
          allowedContext={allowedContext}
          materialDefinitions={materialDefinitions}
          textureDefinitions={textureDefinitions}
          shaderDefinitions={shaderDefinitions}
          grassTypeDefinitions={grassTypeDefinitions}
          flowerTypeDefinitions={flowerTypeDefinitions}
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
