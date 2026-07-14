/**
 * Mask editor.
 *
 * Edits the authored `Mask` union for one layer using the generic reusable UI
 * primitives from `@sugarmagic/ui`.
 *
 * Plan 065.5 (masking/channel UX rework) was DEFERRED 2026-07-12:
 * field use went smoothly and no concrete gripes existed to build
 * against. If you are here because mask/channel authoring produced
 * real friction, that is the revisit trigger -- scope the fix by the
 * actual complaint (see the deferred story in plan 065 for audit-era
 * candidates, but re-derive from the field first).
 */

import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import type {
  Mask,
  PaintedMaskTargetAddress,
  SurfaceContext
} from "@sugarmagic/domain";
import { LabeledSlider, MaskPreview } from "@sugarmagic/ui";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";
import { useMaskPreviewSampler } from "./maskSampling";

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

export interface MaskEditorProps {
  showHeading?: boolean;
  value: Mask;
  allowedContext: SurfaceContext;
  allowPainted?: boolean;
  paintTarget?: PaintedMaskTargetAddress | null;
  /** Hide the "Paint in Viewport" arming button (Plan 068.10b -- the
   *  Surface Studio paints the selected layer directly, no arm step). */
  hidePaintButton?: boolean;
  onChange: (next: Mask) => void;
  /** Plan 068.4 — commit the mask THROUGH the host's apply path and
   *  enter paint mode. Draft-buffered hosts (LayerMaskPopover) must
   *  persist before arming: arming closes the popover chain, and a
   *  draft dies with it (shipped bug, 2026-07-12). */
  onCommitPainted?: (next: Mask) => void;
}

export function MaskEditor({
  showHeading = true,
  value,
  allowedContext,
  allowPainted = false,
  paintTarget = null,
  hidePaintButton = false,
  onChange,
  onCommitPainted
}: MaskEditorProps) {
  const maskPreviewSample = useMaskPreviewSampler(value);
  const {
    textureDefinitions,
    maskTextureDefinitions,
    onCreateMaskTextureDefinition,
    onImportMaskTextureDefinition,
    activeMaskPaintTarget,
    onSetMaskPaintTarget
  } = useSurfaceAuthoring();
  const options =
    allowedContext === "landscape-only"
      ? MASK_KIND_OPTIONS
      : MASK_KIND_OPTIONS.filter((option) => option.value !== "splatmap-channel");
  const visibleOptions = allowPainted
    ? options
    : options.filter((option) => option.value !== "painted");
  const isPaintTargetActive =
    paintTarget?.scope === "landscape-channel"
      ? activeMaskPaintTarget?.scope === "landscape-channel" &&
        activeMaskPaintTarget.channelKey === paintTarget.channelKey &&
        activeMaskPaintTarget.layerId === paintTarget.layerId
      : paintTarget?.scope === "asset-slot"
        ? activeMaskPaintTarget?.scope === "asset-slot" &&
          activeMaskPaintTarget.assetDefinitionId === paintTarget.assetDefinitionId &&
          activeMaskPaintTarget.slotName === paintTarget.slotName &&
          activeMaskPaintTarget.layerId === paintTarget.layerId
        : paintTarget?.scope === "instance-slot"
          ? activeMaskPaintTarget?.scope === "instance-slot" &&
            activeMaskPaintTarget.instanceId === paintTarget.instanceId &&
            activeMaskPaintTarget.slotName === paintTarget.slotName &&
            activeMaskPaintTarget.layerId === paintTarget.layerId
          : false;

  return (
    <Stack gap="xs">
      {showHeading ? (
        <Text size="xs" fw={600} c="var(--sm-color-subtext)">
          Mask
        </Text>
      ) : null}
      <Stack gap="xs">
        <Select
          size="xs"
          label="Mask Type"
          comboboxProps={{ withinPortal: true }}
          data={visibleOptions}
          value={value.kind}
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
                // First pick = straight into painting (decided
                // 2026-07-12): create the mask texture, COMMIT the
                // mask, then enter paint mode. Commit must precede
                // arming -- arming closes the popover chain, and a
                // draft-buffered mask dies unapplied with it.
                void (async () => {
                  const created = await onCreateMaskTextureDefinition?.();
                  const nextMask: Mask = {
                    kind: "painted",
                    maskTextureId: created?.definitionId ?? null
                  };
                  if (
                    created &&
                    paintTarget &&
                    onSetMaskPaintTarget &&
                    onCommitPainted
                  ) {
                    onCommitPainted(nextMask);
                    onSetMaskPaintTarget(paintTarget);
                    return;
                  }
                  onChange(nextMask);
                })();
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
        />
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <MaskPreview sample={maskPreviewSample} />
          <Stack gap={4} style={{ flex: 1 }}>
            {value.kind === "always" ? (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    Applies everywhere.
                  </Text>
                ) : null}
                {value.kind === "texture" ? (
                  <>
                    <Select
                      size="xs"
                      label="Texture"
                      comboboxProps={{ withinPortal: true }}
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
                      comboboxProps={{ withinPortal: true }}
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
                {value.kind === "painted" ? (
                  <>
                    <Select
                      size="xs"
                      label="Mask Texture"
                      comboboxProps={{ withinPortal: true }}
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
                      {!hidePaintButton &&
                      value.maskTextureId &&
                      paintTarget &&
                      onSetMaskPaintTarget ? (
                        <Button
                          size="compact-xs"
                          variant={
                            isPaintTargetActive
                              ? "filled"
                              : "subtle"
                          }
                          onClick={() =>
                            onSetMaskPaintTarget(
                              isPaintTargetActive
                                ? null
                                : paintTarget
                            )
                          }
                        >
                          {isPaintTargetActive ? "Stop Painting" : "Paint in Viewport"}
                        </Button>
                      ) : null}
                    </Group>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      Painted mask files are stored under `masks/*.png`.
                    </Text>
                  </>
                ) : null}
                {value.kind === "splatmap-channel" ? (
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
                {value.kind === "fresnel" ? (
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
                {value.kind === "vertex-color-channel" ? (
                  <Select
                    size="xs"
                    label="Channel"
                    comboboxProps={{ withinPortal: true }}
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
                {value.kind === "height" ? (
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
                {value.kind === "perlin-noise" ? (
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
                {value.kind === "voronoi" ? (
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
                {value.kind === "world-position-gradient" ? (
                  <>
                <Select
                  size="xs"
                  label="Axis"
                  comboboxProps={{ withinPortal: true }}
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
    </Stack>
  );
}
