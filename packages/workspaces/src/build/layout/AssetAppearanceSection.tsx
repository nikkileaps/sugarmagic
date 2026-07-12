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
import { Anchor, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import type {
  AssetDefinition,
  PlacedAssetInstance,
  Scene,
  SceneAssetAppearanceOverride,
  SemanticCommand,
  ShaderSlotKind,
  SurfaceBinding
} from "@sugarmagic/domain";
import {
  createEmptyShaderSlotBindingMap,
  mergeAppearanceOverrideTiers
} from "@sugarmagic/domain";
import { MaterialSlotBindingsEditor } from "../MaterialSlotBindingsEditor";
import { ShaderSlotEditor } from "../ShaderSlotEditor";
import { ScopeBadge, type AppearanceProvenance } from "../ScopeBadge";
import { useSurfaceAuthoring } from "../surfaces";

export interface AssetAppearanceSectionProps {
  instance: PlacedAssetInstance;
  assetDefinition: AssetDefinition | null;
  regionId: string;
  activeScene: Scene | null;
  /** True when the instance lives in the active Scene's overlay. */
  isSceneContained: boolean;
  onCommand: (command: SemanticCommand) => void;
  onEditAssetDefinition?: (definitionId: string) => void;
  onEditShaderGraph?: (shaderDefinitionId: string) => void;
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
  onCommand,
  onEditAssetDefinition,
  onEditShaderGraph
}: AssetAppearanceSectionProps) {
  const { surfaceDefinitions, shaderDefinitions } = useSurfaceAuthoring();
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

  function shaderTier(slot: ShaderSlotKind): {
    shaderDefinitionId: string | null;
    tier: AppearanceProvenance;
  } {
    const entry = merged.shaderOverrides.find(
      (candidate) => candidate.slot === slot
    );
    if (entry) {
      return {
        shaderDefinitionId: entry.shaderDefinitionId,
        tier: isSceneContained ? "scene" : entry.tier
      };
    }
    const reference =
      slot === "deform" ? assetDefinition?.deform : assetDefinition?.effect;
    return {
      shaderDefinitionId: reference?.shaderDefinitionId ?? null,
      tier: "definition"
    };
  }

  const deform = shaderTier("deform");
  const effect = shaderTier("effect");

  function dispatchSurfaceOverride(
    slotName: string,
    surface: SurfaceBinding<"universal"> | null
  ) {
    onCommand({
      kind: "SetPlacedAssetSurfaceSlotOverride",
      target: { aggregateKind: "region-document", aggregateId: regionId },
      subject: {
        subjectKind: "placed-asset",
        subjectId: instance.instanceId
      },
      payload: {
        instanceId: instance.instanceId,
        slotName,
        surface,
        scope: effectiveScope
      }
    });
  }

  function dispatchShaderOverride(
    slot: ShaderSlotKind,
    shaderDefinitionId: string | null
  ) {
    onCommand({
      kind: "SetPlacedAssetShaderOverride",
      target: { aggregateKind: "region-document", aggregateId: regionId },
      subject: {
        subjectKind: "placed-asset",
        subjectId: instance.instanceId
      },
      payload: {
        instanceId: instance.instanceId,
        slot,
        shaderDefinitionId,
        scope: effectiveScope
      }
    });
  }

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
        {onEditAssetDefinition ? (
          <Anchor
            size="xs"
            onClick={() => onEditAssetDefinition(assetDefinition.definitionId)}
          >
            Edit asset
          </Anchor>
        ) : null}
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
      <MaterialSlotBindingsEditor
        bindings={slotViews}
        assetDefinitionId={assetDefinition.definitionId}
        onChangeBinding={(slotName, _slotIndex, surface) =>
          dispatchSurfaceOverride(slotName, surface)
        }
        renderSlotBadge={(slotName) => {
          const view = slotViews.find((slot) => slot.slotName === slotName);
          // "Default" is the normal state -- a chip only appears when
          // an override (or a broken reference) is in play.
          if (!view || view.tier === "definition") return null;
          return <ScopeBadge tier={view.tier} />;
        }}
      />
      <ShaderSlotEditor
        renderSlotBadge={(slot) => {
          const tier = slot === "deform" ? deform.tier : effect.tier;
          if (tier === "definition") return null;
          return <ScopeBadge tier={tier} />;
        }}
        bindings={{
          ...createEmptyShaderSlotBindingMap(),
          deform: deform.shaderDefinitionId,
          effect: effect.shaderDefinitionId
        }}
        shaderDefinitions={shaderDefinitions.filter(
          (definition) =>
            definition.targetKind === "mesh-deform" ||
            definition.targetKind === "mesh-effect"
        )}
        slots={["deform", "effect"]}
        parameterOverrides={instance.shaderParameterOverrides}
        onChangeBinding={dispatchShaderOverride}
        onChangeParameterOverride={(slot, override) =>
          onCommand({
            kind: "SetPlacedAssetShaderParameterOverride",
            target: { aggregateKind: "region-document", aggregateId: regionId },
            subject: {
              subjectKind: "placed-asset",
              subjectId: instance.instanceId
            },
            payload: { instanceId: instance.instanceId, slot, override }
          })
        }
        onClearParameterOverride={(slot, parameterId) =>
          onCommand({
            kind: "ClearPlacedAssetShaderParameterOverride",
            target: { aggregateKind: "region-document", aggregateId: regionId },
            subject: {
              subjectKind: "placed-asset",
              subjectId: instance.instanceId
            },
            payload: { instanceId: instance.instanceId, slot, parameterId }
          })
        }
        onEditShaderGraph={onEditShaderGraph}
      />
    </Stack>
  );
}
