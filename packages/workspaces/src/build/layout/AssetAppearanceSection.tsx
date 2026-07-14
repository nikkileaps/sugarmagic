/**
 * Appearance section for the Layout inspector (Plan 068.3).
 *
 * Surface / deform / effect assignment for the SELECTED placed
 * instance, edited where the author can see the object. Reuses the
 * shared slot + shader editors (the landscape channel flow); each
 * value carries a provenance chip (Default / Base / Scene / Broken)
 * and edits land at the chosen scope:
 *
 *   scene override  >  instance override  >  definition default
 *
 * Scope control: Base writes the instance (rides with the region),
 * Scene writes the active Scene's restyle record. Instances that
 * LIVE in a Scene overlay are scene-scoped by containment -- their
 * edits always target the instance and the control is hidden.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Box,
  ColorSwatch,
  Group,
  SegmentedControl,
  Stack,
  Text
} from "@mantine/core";
import type {
  AssetDefinition,
  PlacedAssetInstance,
  Scene,
  SceneAssetAppearanceOverride,
  SurfaceBinding
} from "@sugarmagic/domain";
import { mergeAppearanceOverrideTiers } from "@sugarmagic/domain";
import { ScopeBadge, type AppearanceProvenance } from "../ScopeBadge";
import { useSurfaceAuthoring } from "../surfaces";
import { previewColorForBinding } from "../surfaces/utils";

export interface AssetAppearanceSectionProps {
  instance: PlacedAssetInstance;
  assetDefinition: AssetDefinition | null;
  regionId: string;
  activeScene: Scene | null;
  /** True when the instance lives in the active Scene's overlay. */
  isSceneContained: boolean;
  onEditAssetDefinition?: (definitionId: string) => void;
  /** Plan 068.10 -- open the Surface Studio for this instance slot, at
   *  the chosen scope tier (Base instance vs the active Scene restyle). */
  onOpenSurfaceStudio?: (target: {
    instanceId: string;
    assetDefinitionId: string;
    slotName: string;
    scope: "base" | "scene";
  }) => void;
}

type EditScope = "base" | "scene";

function surfaceBindingIsBroken(
  binding: SurfaceBinding<"universal"> | null,
  knownSurfaceDefinitionIds: Set<string>
): boolean {
  return Boolean(
    binding &&
      binding.kind === "reference" &&
      !knownSurfaceDefinitionIds.has(binding.surfaceDefinitionId)
  );
}

export function AssetAppearanceSection({
  instance,
  assetDefinition,
  regionId,
  activeScene,
  isSceneContained,
  onEditAssetDefinition,
  onOpenSurfaceStudio
}: AssetAppearanceSectionProps) {
  const { surfaceDefinitions } = useSurfaceAuthoring();
  const [editScope, setEditScope] = useState<EditScope>("base");
  // Scene-contained instances are scene-scoped by containment; the
  // executor routes their writes to the instance either way.
  const effectiveScope: EditScope = isSceneContained ? "base" : editScope;

  const sceneRecord: SceneAssetAppearanceOverride | null = useMemo(() => {
    if (isSceneContained) return null;
    return (
      activeScene?.regionOverlays[regionId]?.assetAppearanceOverrides[
        instance.instanceId
      ] ?? null
    );
  }, [activeScene, regionId, instance.instanceId, isSceneContained]);

  const knownSurfaceDefinitionIds = useMemo(
    () => new Set(surfaceDefinitions.map((d) => d.definitionId)),
    [surfaceDefinitions]
  );

  // The domain merge is the single enforcer of override precedence
  // (scene > instance); this section only maps its tiered output
  // onto the definition slots and the provenance chips.
  const merged = useMemo(
    () => mergeAppearanceOverrideTiers(instance, sceneRecord),
    [instance, sceneRecord]
  );

  const slotViews = useMemo(() => {
    return (assetDefinition?.surfaceSlots ?? []).map((slot) => {
      const entry = merged.surfaceSlotOverrides.find(
        (candidate) => candidate.slotName === slot.slotName
      );
      const surface = entry?.surface ?? slot.surface;
      const tier: AppearanceProvenance = surfaceBindingIsBroken(
        surface,
        knownSurfaceDefinitionIds
      )
        ? "broken"
        : entry
          ? isSceneContained
            ? "scene"
            : entry.tier
          : "definition";
      return { ...slot, surface, tier };
    });
  }, [assetDefinition, merged, knownSurfaceDefinitionIds, isSceneContained]);

  const [selectedSlotName, setSelectedSlotName] = useState<string | null>(null);
  const selectedSlot =
    slotViews.find((slot) => slot.slotName === selectedSlotName) ??
    slotViews[0] ??
    null;

  if (!assetDefinition) {
    return (
      <Stack gap={4}>
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Appearance
        </Text>
        <Text size="xs" c="var(--sm-color-red, red)">
          Asset definition not found in the library; appearance cannot be
          edited.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Appearance
        </Text>
        <Group gap="xs">
          {onEditAssetDefinition ? (
            <Anchor
              size="xs"
              onClick={() => onEditAssetDefinition(assetDefinition.definitionId)}
            >
              Edit asset
            </Anchor>
          ) : null}
        </Group>
      </Group>
      {isSceneContained ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Scene-scoped placement: appearance edits stay in{" "}
          {activeScene?.displayName ?? "this Scene"}.
        </Text>
      ) : (
        <SegmentedControl
          size="xs"
          fullWidth
          value={editScope}
          onChange={(value) => setEditScope(value as EditScope)}
          data={[
            { value: "base", label: "Base" },
            { value: "scene", label: "Scene", disabled: !activeScene }
          ]}
        />
      )}
      {/* Master-detail (Plan 068.5, the Blender slot pattern): the
          slot list stays visible; the SELECTED slot's surface editor
          renders below it in the same panel. No popovers. */}
      <Stack gap={4}>
        {slotViews.map((slot) => {
          const isSelected = slot.slotName === selectedSlot?.slotName;
          return (
            <Box
              key={`${slot.slotIndex}:${slot.slotName}`}
              onClick={() => setSelectedSlotName(slot.slotName)}
              style={{
                cursor: "pointer",
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${
                  isSelected
                    ? "var(--sm-accent-blue)"
                    : "var(--sm-panel-border)"
                }`,
                background: isSelected
                  ? "var(--sm-active-bg)"
                  : "var(--sm-color-surface0)"
              }}
            >
              <Group gap="sm" wrap="nowrap">
                <ColorSwatch
                  color={previewColorForBinding(slot.surface, surfaceDefinitions)}
                  size={18}
                  style={{ flexShrink: 0 }}
                />
                <Text
                  size="sm"
                  fw={500}
                  truncate
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {slot.slotName}
                </Text>
                {slot.tier !== "definition" ? (
                  <ScopeBadge tier={slot.tier} />
                ) : null}
                {onOpenSurfaceStudio ? (
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="grape"
                    title="Open in Surface Studio"
                    aria-label="Open in Surface Studio"
                    style={{ flexShrink: 0 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSurfaceStudio({
                        instanceId: instance.instanceId,
                        assetDefinitionId: assetDefinition.definitionId,
                        slotName: slot.slotName,
                        scope: effectiveScope
                      });
                    }}
                  >
                    🖌
                  </ActionIcon>
                ) : null}
              </Group>
            </Box>
          );
        })}
        {slotViews.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            This asset does not declare any authored material slots in its
            source mesh.
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}
