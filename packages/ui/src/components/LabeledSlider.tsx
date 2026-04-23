/**
 * LabeledSlider
 *
 * Consistent editor slider row with a caption and current numeric value.
 */

import { Group, Slider, Stack, Text } from "@mantine/core";

export interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  onChange: (value: number) => void;
}

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  precision = 2,
  onChange
}: LabeledSliderProps) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="xs" fw={600} c="var(--sm-color-subtext)">
          {label}
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)">
          {value.toFixed(precision)}
        </Text>
      </Group>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    </Stack>
  );
}
