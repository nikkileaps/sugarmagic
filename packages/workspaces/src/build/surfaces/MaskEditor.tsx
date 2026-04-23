/**
 * Mask editor.
 *
 * Edits the authored `Mask` union for one layer using the generic reusable UI
 * primitives from `@sugarmagic/ui`.
 */

import { Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import type { Mask, SurfaceContext, TextureDefinition } from "@sugarmagic/domain";
import { KindTabs, LabeledSlider, MaskPreview } from "@sugarmagic/ui";

const MASK_KIND_OPTIONS = [
  { value: "always", label: "Always" },
  { value: "texture", label: "Texture" },
  { value: "splatmap-channel", label: "Splatmap" },
  { value: "fresnel", label: "Fresnel" },
  { value: "vertex-color-channel", label: "Vertex Color" },
  { value: "height", label: "Height" }
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
      return 0.75;
  }
}

export interface MaskEditorProps {
  value: Mask;
  allowedContext: SurfaceContext;
  textureDefinitions: TextureDefinition[];
  onChange: (next: Mask) => void;
}

export function MaskEditor({
  value,
  allowedContext,
  textureDefinitions,
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
              </Stack>
            </Group>
          </Stack>
        )}
      />
    </Stack>
  );
}
