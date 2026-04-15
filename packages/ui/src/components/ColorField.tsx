/**
 * ColorField
 *
 * Reusable inspector-friendly color control backed by Mantine's color picker.
 * It keeps authored color values in Sugarmagic's canonical numeric RGB form
 * while presenting a familiar swatch + hex input editing affordance.
 */

import { useMemo, useState } from "react";
import {
  ColorPicker,
  ColorSwatch,
  Group,
  Popover,
  Stack,
  Text,
  TextInput
} from "@mantine/core";

function formatHexColor(value: number): string {
  return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, "0")}`;
}

function parseHexColor(value: string): number | null {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[\da-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const next = Number.parseInt(normalized, 16);
  return Number.isFinite(next) ? next : null;
}

export interface ColorFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  description?: string;
  disabled?: boolean;
  swatches?: string[];
}

export function ColorField({
  label,
  value,
  onChange,
  description,
  disabled = false,
  swatches
}: ColorFieldProps) {
  const [popoverOpened, setPopoverOpened] = useState(false);
  const hexValue = useMemo(() => formatHexColor(value), [value]);

  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="var(--sm-color-subtext)">
        {label}
      </Text>
      {description ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          {description}
        </Text>
      ) : null}
      <Group gap="xs" wrap="nowrap" align="center">
        <Popover
          opened={popoverOpened}
          onChange={setPopoverOpened}
          position="bottom-start"
          shadow="md"
          withinPortal={false}
        >
          <Popover.Target>
            <ColorSwatch
              color={hexValue}
              size={22}
              style={{
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
                flexShrink: 0
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (!disabled) {
                  setPopoverOpened(true);
                }
              }}
            />
          </Popover.Target>
          <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
            <ColorPicker
              value={hexValue}
              onChange={(hex) => {
                const next = parseHexColor(hex);
                if (next !== null) {
                  onChange(next);
                }
              }}
              format="hex"
              swatches={swatches}
            />
          </Popover.Dropdown>
        </Popover>
        <TextInput
          size="xs"
          value={hexValue}
          disabled={disabled}
          onChange={(event) => {
            const next = parseHexColor(event.currentTarget.value);
            if (next !== null) {
              onChange(next);
            }
          }}
          styles={{
            input: {
              background: "var(--sm-color-base)",
              borderColor: "var(--sm-panel-border)",
              color: "var(--sm-color-text)"
            }
          }}
        />
      </Group>
    </Stack>
  );
}
