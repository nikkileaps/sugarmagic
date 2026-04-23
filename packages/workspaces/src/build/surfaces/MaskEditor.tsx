/**
 * Mask editor.
 *
 * Edits the authored `Mask` union for one layer using the generic reusable UI
 * primitives from `@sugarmagic/ui`.
 */

import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import type {
  Mask,
  MaskTextureDefinition,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import { samplePerlinNoise2d } from "@sugarmagic/domain";
import { KindTabs, LabeledSlider, MaskPreview } from "@sugarmagic/ui";

const MASK_KIND_OPTIONS = [
  { value: "always", label: "Always" },
  { value: "texture", label: "Texture" },
  { value: "painted", label: "Painted" },
  { value: "splatmap-channel", label: "Splatmap" },
  { value: "fresnel", label: "Fresnel" },
  { value: "vertex-color-channel", label: "Vertex Color" },
  { value: "height", label: "Height" },
  { value: "perlin-noise", label: "Noise" },
  { value: "voronoi", label: "Voronoi" },
  { value: "world-position-gradient", label: "Gradient" }
] as const;

function sampleMask(mask: Mask, u: number, v: number): number {
  switch (mask.kind) {
    case "always":
      return 1;
    case "fresnel": {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return Math.max(
        0,
        Math.min(1, Math.pow(Math.min(1, distance * 2), mask.power) * mask.strength)
      );
    }
    case "height": {
      const height = 1 - v;
      if (height <= mask.min) {
        return 0;
      }
      if (height >= mask.max) {
        return 1;
      }
      return Math.max(
        0,
        Math.min(1, (height - mask.min) / Math.max(mask.fade, 0.001))
      );
    }
    case "vertex-color-channel":
      return mask.channel === "r" ? u : mask.channel === "g" ? v : mask.channel === "b" ? 1 - u : 1;
    case "splatmap-channel":
      return 1;
    case "texture":
    case "painted":
      return 0.75;
    case "perlin-noise": {
      const noise = samplePerlinNoise2d({
        x: (u + mask.offset[0]) * mask.scale,
        y: (v + mask.offset[1]) * mask.scale
      });
      const start = mask.threshold - mask.fade;
      const end = mask.threshold + mask.fade;
      if (noise <= start) return 0;
      if (noise >= end) return 1;
      return (noise - start) / Math.max(end - start, 0.001);
    }
    case "voronoi": {
      const cellX = u / Math.max(mask.cellSize, 0.001);
      const cellY = v / Math.max(mask.cellSize, 0.001);
      const fractX = cellX - Math.floor(cellX);
      const fractY = cellY - Math.floor(cellY);
      const edgeDistance = Math.min(
        Math.min(fractX, 1 - fractX),
        Math.min(fractY, 1 - fractY)
      );
      return 1 - Math.max(0, Math.min(1, edgeDistance / Math.max(mask.borderWidth, 0.001)));
    }
    case "world-position-gradient": {
      const axisValue = mask.axis === "x" ? u : mask.axis === "y" ? 1 - v : v;
      if (axisValue <= mask.min - mask.fade) return 0;
      if (axisValue >= mask.max + mask.fade) return 1;
      return (axisValue - (mask.min - mask.fade)) / Math.max(mask.max - mask.min + mask.fade * 2, 0.001);
    }
  }
}

export interface MaskEditorProps {
  value: Mask;
  allowedContext: SurfaceContext;
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activePaintMaskTextureId?: string | null;
  onSetActivePaintMaskTextureId?: (definitionId: string | null) => void;
  onChange: (next: Mask) => void;
}

export function MaskEditor({
  value,
  allowedContext,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  activePaintMaskTextureId,
  onSetActivePaintMaskTextureId,
  onChange
}: MaskEditorProps) {
  const options =
    allowedContext === "landscape-only"
      ? MASK_KIND_OPTIONS
      : MASK_KIND_OPTIONS.filter((option) => option.value !== "splatmap-channel");

  return (
    <Stack gap="xs">
      <Text size="xs" fw={600} c="var(--sm-color-subtext)">
        Mask
      </Text>
      <KindTabs
        value={value.kind}
        options={options}
        onChange={(kind) => {
          switch (kind) {
            case "always":
              onChange({ kind: "always" });
              break;
            case "texture":
              onChange({
                kind: "texture",
                textureDefinitionId: textureDefinitions[0]?.definitionId ?? "",
                channel: "r"
              });
              break;
            case "painted":
              onChange({
                kind: "painted",
                maskTextureId: null
              });
              break;
            case "splatmap-channel":
              onChange({ kind: "splatmap-channel", channelIndex: 0 });
              break;
            case "fresnel":
              onChange({ kind: "fresnel", power: 2, strength: 1 });
              break;
            case "vertex-color-channel":
              onChange({ kind: "vertex-color-channel", channel: "r" });
              break;
            case "height":
              onChange({ kind: "height", min: 0.2, max: 0.8, fade: 0.2 });
              break;
            case "perlin-noise":
              onChange({
                kind: "perlin-noise",
                scale: 4,
                offset: [0, 0],
                threshold: 0.5,
                fade: 0.15
              });
              break;
            case "voronoi":
              onChange({
                kind: "voronoi",
                cellSize: 0.12,
                borderWidth: 0.06
              });
              break;
            case "world-position-gradient":
              onChange({
                kind: "world-position-gradient",
                axis: "y",
                min: 0.2,
                max: 0.8,
                fade: 0.15
              });
              break;
          }
        }}
        renderPanel={(kind) => (
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <MaskPreview sample={(u, v) => sampleMask(value, u, v)} />
              <Stack gap={4} style={{ flex: 1 }}>
                {kind === "always" ? (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    Applies everywhere.
                  </Text>
                ) : null}
                {kind === "texture" && value.kind === "texture" ? (
                  <>
                    <Select
                      size="xs"
                      label="Texture"
                      data={textureDefinitions.map((texture) => ({
                        value: texture.definitionId,
                        label: texture.displayName
                      }))}
                      value={value.textureDefinitionId}
                      onChange={(next) => {
                        if (next) {
                          onChange({ ...value, textureDefinitionId: next });
                        }
                      }}
                    />
                    <Select
                      size="xs"
                      label="Channel"
                      data={[
                        { value: "r", label: "Red" },
                        { value: "g", label: "Green" },
                        { value: "b", label: "Blue" },
                        { value: "a", label: "Alpha" }
                      ]}
                      value={value.channel}
                      onChange={(next) => {
                        if (next === "r" || next === "g" || next === "b" || next === "a") {
                          onChange({ ...value, channel: next });
                        }
                      }}
                    />
                  </>
                ) : null}
                {kind === "painted" && value.kind === "painted" ? (
                  <>
                    <Select
                      size="xs"
                      label="Mask Texture"
                      data={maskTextureDefinitions.map((definition) => ({
                        value: definition.definitionId,
                        label: definition.displayName
                      }))}
                      value={value.maskTextureId}
                      onChange={(next) =>
                        onChange({
                          ...value,
                          maskTextureId: next ?? null
                        })
                      }
                    />
                    <Group gap="xs">
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={async () => {
                          const created = await onCreateMaskTextureDefinition?.();
                          if (created) {
                            onChange({
                              ...value,
                              maskTextureId: created.definitionId
                            });
                          }
                        }}
                      >
                        New Painted Mask
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={async () => {
                          const imported = await onImportMaskTextureDefinition?.();
                          if (imported) {
                            onChange({
                              ...value,
                              maskTextureId: imported.definitionId
                            });
                          }
                        }}
                      >
                        Import PNG
                      </Button>
                      {value.maskTextureId && onSetActivePaintMaskTextureId ? (
                        <Button
                          size="compact-xs"
                          variant={
                            activePaintMaskTextureId === value.maskTextureId
                              ? "filled"
                              : "subtle"
                          }
                          onClick={() =>
                            onSetActivePaintMaskTextureId(
                              activePaintMaskTextureId === value.maskTextureId
                                ? null
                                : value.maskTextureId
                            )
                          }
                        >
                          {activePaintMaskTextureId === value.maskTextureId
                            ? "Stop Painting"
                            : "Paint in Preview"}
                        </Button>
                      ) : null}
                    </Group>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      Painted mask files are stored under `masks/*.png`.
                    </Text>
                  </>
                ) : null}
                {kind === "splatmap-channel" && value.kind === "splatmap-channel" ? (
                  <NumberInput
                    size="xs"
                    label="Channel Index"
                    min={0}
                    max={7}
                    value={value.channelIndex}
                    onChange={(next) => {
                      if (typeof next === "number" && Number.isFinite(next)) {
                        onChange({ ...value, channelIndex: next });
                      }
                    }}
                  />
                ) : null}
                {kind === "fresnel" && value.kind === "fresnel" ? (
                  <>
                    <LabeledSlider
                      label="Power"
                      min={0.1}
                      max={8}
                      step={0.1}
                      value={value.power}
                      onChange={(next) => onChange({ ...value, power: next })}
                    />
                    <LabeledSlider
                      label="Strength"
                      min={0}
                      max={2}
                      step={0.05}
                      value={value.strength}
                      onChange={(next) => onChange({ ...value, strength: next })}
                    />
                  </>
                ) : null}
                {kind === "vertex-color-channel" && value.kind === "vertex-color-channel" ? (
                  <Select
                    size="xs"
                    label="Channel"
                    data={[
                      { value: "r", label: "Red" },
                      { value: "g", label: "Green" },
                      { value: "b", label: "Blue" },
                      { value: "a", label: "Alpha" }
                    ]}
                    value={value.channel}
                    onChange={(next) => {
                      if (next === "r" || next === "g" || next === "b" || next === "a") {
                        onChange({ ...value, channel: next });
                      }
                    }}
                  />
                ) : null}
                {kind === "height" && value.kind === "height" ? (
                  <>
                    <LabeledSlider
                      label="Min"
                      min={0}
                      max={1}
                      value={value.min}
                      onChange={(next) => onChange({ ...value, min: next })}
                    />
                    <LabeledSlider
                      label="Max"
                      min={0}
                      max={1}
                      value={value.max}
                      onChange={(next) => onChange({ ...value, max: next })}
                    />
                    <LabeledSlider
                      label="Fade"
                      min={0.01}
                      max={1}
                      value={value.fade}
                      onChange={(next) => onChange({ ...value, fade: next })}
                    />
                  </>
                ) : null}
                {kind === "perlin-noise" && value.kind === "perlin-noise" ? (
                  <>
                    <LabeledSlider
                      label="Scale"
                      min={0.25}
                      max={12}
                      value={value.scale}
                      onChange={(next) => onChange({ ...value, scale: next })}
                    />
                    <LabeledSlider
                      label="Threshold"
                      min={0}
                      max={1}
                      value={value.threshold}
                      onChange={(next) => onChange({ ...value, threshold: next })}
                    />
                    <LabeledSlider
                      label="Fade"
                      min={0.01}
                      max={0.5}
                      value={value.fade}
                      onChange={(next) => onChange({ ...value, fade: next })}
                    />
                  </>
                ) : null}
                {kind === "voronoi" && value.kind === "voronoi" ? (
                  <>
                    <LabeledSlider
                      label="Cell Size"
                      min={0.02}
                      max={0.5}
                      value={value.cellSize}
                      onChange={(next) => onChange({ ...value, cellSize: next })}
                    />
                    <LabeledSlider
                      label="Border Width"
                      min={0.005}
                      max={0.25}
                      value={value.borderWidth}
                      onChange={(next) => onChange({ ...value, borderWidth: next })}
                    />
                  </>
                ) : null}
                {kind === "world-position-gradient" &&
                value.kind === "world-position-gradient" ? (
                  <>
                    <Select
                      size="xs"
                      label="Axis"
                      data={[
                        { value: "x", label: "X" },
                        { value: "y", label: "Y" },
                        { value: "z", label: "Z" }
                      ]}
                      value={value.axis}
                      onChange={(next) => {
                        if (next === "x" || next === "y" || next === "z") {
                          onChange({ ...value, axis: next });
                        }
                      }}
                    />
                    <LabeledSlider
                      label="Min"
                      min={-1}
                      max={1}
                      value={value.min}
                      onChange={(next) => onChange({ ...value, min: next })}
                    />
                    <LabeledSlider
                      label="Max"
                      min={-1}
                      max={1}
                      value={value.max}
                      onChange={(next) => onChange({ ...value, max: next })}
                    />
                    <LabeledSlider
                      label="Fade"
                      min={0.01}
                      max={1}
                      value={value.fade}
                      onChange={(next) => onChange({ ...value, fade: next })}
                    />
                  </>
                ) : null}
              </Stack>
            </Group>
          </Stack>
        )}
      />
    </Stack>
  );
}
