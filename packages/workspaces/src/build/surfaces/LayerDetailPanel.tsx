/**
 * Layer detail panel.
 *
 * Dispatches one selected layer to its strongly-typed per-kind
 * editor (Appearance / Scatter / Emission) plus the shared
 * opacity control. Catalog data comes from SurfaceAuthoringContext.
 */

import { Stack } from "@mantine/core";
import type { Layer } from "@sugarmagic/domain";
import { LabeledSlider } from "@sugarmagic/ui";
import { AppearanceLayerEditor } from "./AppearanceLayerEditor";
import { EmissionLayerEditor } from "./EmissionLayerEditor";
import { ScatterLayerEditor } from "./ScatterLayerEditor";

export interface LayerDetailPanelProps {
  layer: Layer;
  isBaseLayer: boolean;
  onChange: (next: Layer) => void;
}

export function LayerDetailPanel({
  layer,
  isBaseLayer,
  onChange
}: LayerDetailPanelProps) {
  return (
    <Stack gap="xs">
      <LabeledSlider
        label="Opacity"
        min={0}
        max={1}
        value={layer.opacity}
        onChange={(next) =>
          onChange({
            ...layer,
            opacity: next
          })
        }
      />

      {layer.kind === "appearance" ? (
        <AppearanceLayerEditor
          layer={layer}
          isBaseLayer={isBaseLayer}
          onChange={onChange}
        />
      ) : null}
      {layer.kind === "scatter" ? (
        <ScatterLayerEditor layer={layer} onChange={onChange} />
      ) : null}
      {layer.kind === "emission" ? (
        <EmissionLayerEditor layer={layer} onChange={onChange} />
      ) : null}
    </Stack>
  );
}
