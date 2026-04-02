import { Stack, Group, Text, NumberInput, ActionIcon } from "@mantine/core";

export interface TransformInspectorProps {
  label: string;
  value: [number, number, number];
  step?: number;
  onChange: (axis: 0 | 1 | 2, value: number) => void;
}

const AXIS_LABELS = ["X", "Y", "Z"] as const;
const AXIS_COLORS = [
  "var(--sm-accent-red)",
  "var(--sm-accent-green)",
  "var(--sm-accent-blue)"
];
const NUDGE_STEP = 0.5;

export function TransformInspector({
  label,
  value,
  step = NUDGE_STEP,
  onChange
}: TransformInspectorProps) {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
        {label}
      </Text>
      {AXIS_LABELS.map((axisLabel, i) => (
        <Group key={axisLabel} gap="xs" wrap="nowrap" align="center">
          <Text
            size="xs"
            fw={700}
            w={14}
            ta="center"
            c={AXIS_COLORS[i]}
          >
            {axisLabel}
          </Text>
          <ActionIcon
            variant="subtle"
            size="xs"
            onClick={() => onChange(i as 0 | 1 | 2, value[i] - step)}
            styles={{
              root: {
                color: "var(--sm-color-overlay2)",
                "&:hover": { background: "var(--sm-hover-bg)" }
              }
            }}
          >
            −
          </ActionIcon>
          <NumberInput
            value={value[i]}
            onChange={(val) => {
              if (typeof val === "number") onChange(i as 0 | 1 | 2, val);
            }}
            step={step}
            decimalScale={2}
            size="xs"
            w={80}
            styles={{
              input: {
                background: "var(--sm-color-base)",
                borderColor: "var(--sm-panel-border)",
                color: "var(--sm-color-text)",
                fontSize: "var(--sm-font-size-sm)",
                textAlign: "center"
              }
            }}
          />
          <ActionIcon
            variant="subtle"
            size="xs"
            onClick={() => onChange(i as 0 | 1 | 2, value[i] + step)}
            styles={{
              root: {
                color: "var(--sm-color-overlay2)",
                "&:hover": { background: "var(--sm-hover-bg)" }
              }
            }}
          >
            +
          </ActionIcon>
        </Group>
      ))}
    </Stack>
  );
}
