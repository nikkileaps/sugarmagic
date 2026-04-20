/**
 * SurfacePicker
 *
 * Two-tab editor for an authored "surface" — either a solid color or
 * a project Material (with optional per-application tiling). The two
 * tabs are mutually exclusive: the committed value is whichever tab
 * the author hit Apply on.
 *
 * Designed for use inside a popover (e.g. triggered by a channel
 * swatch in the landscape workspace), but owns no popover lifecycle
 * itself — it's just the body content. The caller wraps it in a
 * Popover / Modal / inline container as needed.
 *
 * All interaction is staged into local state. Nothing fires to the
 * caller until the author clicks the explicit Apply button. Closing
 * the enclosing popover without Apply discards the draft.
 */

import { useMemo, useState } from "react";
import {
  Button,
  ColorPicker,
  Group,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Text
} from "@mantine/core";

export type Surface =
  | { kind: "color"; value: number }
  | {
      kind: "material";
      materialDefinitionId: string | null;
      tilingScale: [number, number] | null;
    };

export interface SurfaceMaterialOption {
  /** Project MaterialDefinition id. */
  value: string;
  /** Human-facing label (the material's displayName). */
  label: string;
}

export interface SurfacePickerProps {
  value: Surface;
  /** Fired when the author commits via the Apply button. */
  onApply: (next: Surface) => void;
  /** Project materials available to pick from. */
  materials: SurfaceMaterialOption[];
  /** Preset hex strings for the color-tab swatches row. */
  colorSwatches?: string[];
  /** Optional label shown above the tab bar (e.g. "Channel Surface"). */
  title?: string;
  /** Rendered if `materials` is empty — prompts the author to create one. */
  emptyMaterialsHint?: string;
}

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

interface ColorTabState {
  color: number;
}

interface MaterialTabState {
  materialDefinitionId: string | null;
  tilingScale: [number, number] | null;
}

interface DraftState {
  activeTab: "color" | "material";
  color: ColorTabState;
  material: MaterialTabState;
}

function initialDraft(value: Surface): DraftState {
  if (value.kind === "color") {
    return {
      activeTab: "color",
      color: { color: value.value },
      material: { materialDefinitionId: null, tilingScale: null }
    };
  }
  return {
    activeTab: "material",
    // Carry a sensible default into the color tab in case the author
    // flips tabs — they shouldn't lose their prior color when they
    // peek at the Color tab. Using mid-grey is neutral.
    color: { color: 0x808080 },
    material: {
      materialDefinitionId: value.materialDefinitionId,
      tilingScale: value.tilingScale
    }
  };
}

function isNullTiling(tiling: [number, number] | null): boolean {
  if (!tiling) {
    return true;
  }
  return tiling[0] === 1 && tiling[1] === 1;
}

export function SurfacePicker({
  value,
  onApply,
  materials,
  colorSwatches,
  title,
  emptyMaterialsHint = "Create a material in the Material Library to bind it here."
}: SurfacePickerProps) {
  // Draft is captured once at mount. Re-opening the enclosing popover
  // remounts this component and reinitializes from the new `value`
  // prop, so the next edit session always starts from committed
  // truth. Keeping drafts out of a `useEffect` sync means a parent
  // re-render mid-edit can't wipe in-progress work.
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(value));

  const hexValue = useMemo(
    () => formatHexColor(draft.color.color),
    [draft.color.color]
  );

  const materialOptions = useMemo(
    () => [
      { value: "__none__", label: "No Material" },
      ...materials.map((material) => ({
        value: material.value,
        label: material.label
      }))
    ],
    [materials]
  );

  function handleApply() {
    if (draft.activeTab === "color") {
      onApply({ kind: "color", value: draft.color.color });
      return;
    }
    onApply({
      kind: "material",
      materialDefinitionId: draft.material.materialDefinitionId,
      tilingScale: isNullTiling(draft.material.tilingScale)
        ? null
        : draft.material.tilingScale
    });
  }

  // Fixed footprint: the picker stays the same size regardless of which
  // tab is active. The outer width is pinned, the tab-content area has a
  // min height large enough to hold the Color tab's saturation square +
  // hue slider + swatches, and the Material tab renders inside that
  // same box. Switching tabs never resizes the popover.
  const PICKER_WIDTH = 240;
  const TAB_CONTENT_MIN_HEIGHT = 260;

  return (
    <Stack gap="sm" style={{ width: PICKER_WIDTH }}>
      {title ? (
        <Text size="xs" fw={600} c="var(--sm-color-subtext)">
          {title}
        </Text>
      ) : null}
      <Tabs
        value={draft.activeTab}
        onChange={(nextTab) => {
          if (nextTab !== "color" && nextTab !== "material") {
            return;
          }
          setDraft((prev) => ({ ...prev, activeTab: nextTab }));
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="color">Color</Tabs.Tab>
          <Tabs.Tab value="material">Material</Tabs.Tab>
        </Tabs.List>

        <div style={{ minHeight: TAB_CONTENT_MIN_HEIGHT }}>
          <Tabs.Panel value="color" pt="sm">
            <ColorPicker
              value={hexValue}
              onChange={(hex) => {
                const next = parseHexColor(hex);
                if (next === null) return;
                setDraft((prev) => ({
                  ...prev,
                  color: { color: next }
                }));
              }}
              format="hex"
              swatches={colorSwatches}
              fullWidth
            />
          </Tabs.Panel>

          <Tabs.Panel value="material" pt="sm">
            <Stack gap="xs">
              {materials.length === 0 ? (
                <Text size="xs" c="var(--sm-color-overlay0)">
                  {emptyMaterialsHint}
                </Text>
              ) : null}
              <Select
                size="xs"
                placeholder="Select material..."
                data={materialOptions}
                value={draft.material.materialDefinitionId ?? "__none__"}
                onChange={(next) => {
                  const materialDefinitionId =
                    next && next !== "__none__" ? next : null;
                  setDraft((prev) => ({
                    ...prev,
                    material: {
                      ...prev.material,
                      materialDefinitionId
                    }
                  }));
                }}
                // Keep the dropdown inside the enclosing Popover's DOM
                // tree. With the default portal behavior, clicking an
                // option is treated as a click "outside" the parent
                // Popover and dismisses it before `onChange` fires.
                comboboxProps={{ withinPortal: false }}
                styles={{
                  input: {
                    background: "var(--sm-color-base)",
                    borderColor: "var(--sm-panel-border)",
                    color: "var(--sm-color-text)"
                  },
                  dropdown: {
                    background: "var(--sm-color-surface1)",
                    borderColor: "var(--sm-panel-border)"
                  },
                  option: {
                    color: "var(--sm-color-text)"
                  }
                }}
              />
              <Text size="xs" c="var(--sm-color-subtext)">
                Tiling (this application)
              </Text>
              <Group gap="xs" grow>
                <NumberInput
                  label="X"
                  size="xs"
                  min={0.01}
                  step={0.5}
                  decimalScale={2}
                  value={draft.material.tilingScale?.[0] ?? 1}
                  onChange={(value) => {
                    const nextX =
                      typeof value === "number" && Number.isFinite(value) && value > 0
                        ? value
                        : 1;
                    const nextY = draft.material.tilingScale?.[1] ?? 1;
                    setDraft((prev) => ({
                      ...prev,
                      material: {
                        ...prev.material,
                        tilingScale: [nextX, nextY]
                      }
                    }));
                  }}
                />
                <NumberInput
                  label="Y"
                  size="xs"
                  min={0.01}
                  step={0.5}
                  decimalScale={2}
                  value={draft.material.tilingScale?.[1] ?? 1}
                  onChange={(value) => {
                    const nextX = draft.material.tilingScale?.[0] ?? 1;
                    const nextY =
                      typeof value === "number" && Number.isFinite(value) && value > 0
                        ? value
                        : 1;
                    setDraft((prev) => ({
                      ...prev,
                      material: {
                        ...prev.material,
                        tilingScale: [nextX, nextY]
                      }
                    }));
                  }}
                />
              </Group>
              <Text size="xs" c="var(--sm-color-overlay0)">
                Multiplies the Material's own tiling. Higher = more repeats.
              </Text>
            </Stack>
          </Tabs.Panel>
        </div>
      </Tabs>

      <Group justify="flex-end">
        <Button size="xs" onClick={handleApply}>
          Apply
        </Button>
      </Group>
    </Stack>
  );
}
