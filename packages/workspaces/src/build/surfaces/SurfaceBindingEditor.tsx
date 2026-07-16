/**
 * Surface binding editor.
 *
 * Top-level editor for a slot's `SurfaceBinding`: either an inline layer stack
 * or a reference to a reusable `SurfaceDefinition`.
 */

import { Select, Stack, Text } from "@mantine/core";
import type {
  PaintedMaskTargetAddress,
  SurfaceBinding,
  SurfaceContext
} from "@sugarmagic/domain";
import {
  createDefaultSurface,
  createInlineSurfaceBinding,
  createReferenceSurfaceBinding,
  surfaceDefinitionMatchesContext
} from "@sugarmagic/domain";
import { LayerStackView } from "./LayerStackView";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";
import { makeBindingLocal } from "./utils";

export interface SurfaceBindingEditorProps<C extends SurfaceContext = SurfaceContext> {
  value: SurfaceBinding<C> | null;
  allowedContext: C;
  paintOwner:
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "landscape-channel" }>, "layerId">
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "asset-slot" }>, "layerId">
    | Omit<Extract<PaintedMaskTargetAddress, { scope: "instance-slot" }>, "layerId">
    | null;
  onChange: (next: SurfaceBinding<C> | null) => void;
  /** See LayerStackView.variant (Plan 068.5 master-detail). */
  layerStackVariant?: "popover" | "inline";
}

export function SurfaceBindingEditor<C extends SurfaceContext = SurfaceContext>({
  value,
  allowedContext,
  paintOwner,
  onChange,
  layerStackVariant = "popover"
}: SurfaceBindingEditorProps<C>) {
  const { surfaceDefinitions } = useSurfaceAuthoring();
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
              onChange(makeBindingLocal<C>(selectedReferenceSurface));
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
        </>
      ) : null}

      {value?.kind === "inline" ? (
        <LayerStackView
          surface={value.surface}
          allowedContext={allowedContext}
          allowPainted={paintOwner !== null}
          paintOwner={paintOwner}
          variant={layerStackVariant}
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
