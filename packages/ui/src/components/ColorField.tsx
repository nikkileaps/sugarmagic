/**
 * ColorField
 *
 * Reusable inspector-friendly color control backed by Mantine's color picker.
 * It keeps authored color values in Sugarmagic's canonical numeric RGB form
 * while presenting a familiar swatch + hex input editing affordance.
 */

import { useMemo, useState } from "react";
import {
  ColorInput,
  ColorPicker,
  ColorSwatch,
  Group,
  NumberInput,
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

function clampChannel(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function vec3ToHexColor(value: [number, number, number]): string {
  const red = Math.round(clampChannel(value[0]) * 255);
  const green = Math.round(clampChannel(value[1]) * 255);
  const blue = Math.round(clampChannel(value[2]) * 255);
  return formatHexColor((red << 16) | (green << 8) | blue);
}

function hexColorToVec3(value: string): [number, number, number] | null {
  const colorNumber = parseHexColor(value);
  if (colorNumber === null) {
    return null;
  }
  return [
    ((colorNumber >> 16) & 0xff) / 255,
    ((colorNumber >> 8) & 0xff) / 255,
    (colorNumber & 0xff) / 255
  ];
}

export interface ColorFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  description?: string;
  disabled?: boolean;
  swatches?: string[];
}

export interface CssColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  disabled?: boolean;
  swatches?: string[];
  withAlpha?: boolean;
}

export function CssColorField({
  label,
  value,
  onChange,
  description,
  disabled = false,
  swatches,
  withAlpha = true
}: CssColorFieldProps) {
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
      <ColorInput
        size="xs"
        value={value}
        onChange={onChange}
        format={withAlpha ? "rgba" : "rgb"}
        swatches={swatches}
        disabled={disabled}
        styles={{
          input: {
            background: "var(--sm-color-base)",
            borderColor: "var(--sm-panel-border)",
            color: "var(--sm-color-text)"
          }
        }}
      />
    </Stack>
  );
}

export interface HDRColorFieldProps {
  label: string;
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  description?: string;
  disabled?: boolean;
  maxChannel?: number;
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

export function HDRColorField({
  label,
  value,
  onChange,
  description,
  disabled = false,
  maxChannel = 4
}: HDRColorFieldProps) {
  const [popoverOpened, setPopoverOpened] = useState(false);
  const previewHex = useMemo(() => vec3ToHexColor(value), [value]);

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
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Popover
          opened={popoverOpened}
          onChange={setPopoverOpened}
          position="bottom-start"
          shadow="md"
          withinPortal={false}
        >
          <Popover.Target>
            <ColorSwatch
              color={previewHex}
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
              value={previewHex}
              onChange={(hex) => {
                const next = hexColorToVec3(hex);
                if (next) {
                  onChange(next);
                }
              }}
              format="hex"
            />
          </Popover.Dropdown>
        </Popover>
        <Group gap={6} grow wrap="nowrap" style={{ flex: 1 }}>
          {(["R", "G", "B"] as const).map((channel, index) => (
            <NumberInput
              key={channel}
              label={channel}
              size="xs"
              min={0}
              max={maxChannel}
              step={0.05}
              decimalScale={2}
              value={value[index]}
              disabled={disabled}
              onChange={(next) => {
                if (typeof next !== "number" || !Number.isFinite(next)) {
                  return;
                }
                const nextValue = [...value] as [number, number, number];
                nextValue[index] = next;
                onChange(nextValue);
              }}
            />
          ))}
        </Group>
      </Group>
    </Stack>
  );
}
