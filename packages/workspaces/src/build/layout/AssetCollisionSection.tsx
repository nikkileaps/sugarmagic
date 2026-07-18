/**
 * Collision section for the Layout inspector (Plan 069.6).
 *
 * Per-instance collider override on the SELECTED placed asset, edited where
 * the author can see the object. Mirrors the Appearance section's tiering:
 *
 *   scene override  >  instance override  >  definition default (069.1)
 *
 * Shape picker (incl. "none" = walk-through / non-blocking) + a box
 * size/offset nudge, with a provenance chip and a Base/Scene scope control.
 * "none" is how an author marks a walk-on prop (dock/floor) non-blocking on
 * flat ground; standing ON it at height is the deferred terrain epic.
 */

import { useMemo, useState } from "react";
import { Button, Group, Select, Stack, Text } from "@mantine/core";
import {
  resolveEffectiveInstanceCollider,
  type AssetCollider,
  type AssetColliderShape,
  type AssetDefinition,
  type PlacedAssetInstance,
  type Scene,
  type SceneAssetAppearanceOverride,
  type SemanticCommand
} from "@sugarmagic/domain";
import { ScopeChip } from "@sugarmagic/ui";
import { TransformInspector } from "@sugarmagic/ui";
import { ScopeBadge } from "../ScopeBadge";

export interface AssetCollisionSectionProps {
  instance: PlacedAssetInstance;
  assetDefinition: AssetDefinition | null;
  regionId: string;
  activeScene: Scene | null;
  /** True when the instance lives in the active Scene's overlay. */
  isSceneContained: boolean;
  onCommand: (command: SemanticCommand) => void;
}

type EditScope = "base" | "scene";

const SHAPE_OPTIONS: { value: AssetColliderShape; label: string }[] = [
  { value: "auto-box", label: "Auto Box" },
  { value: "sphere", label: "Sphere" },
  { value: "capsule", label: "Capsule" },
  { value: "convex", label: "Convex" },
  { value: "none", label: "None (walk through)" }
];

type Vec3 = [number, number, number];

function boundsToCenterSize(collider: AssetCollider | null): {
  center: Vec3;
  size: Vec3;
} | null {
  const b = collider?.localBounds;
  if (!b) {
    return null;
  }
  return {
    center: [
      (b.min[0] + b.max[0]) / 2,
      (b.min[1] + b.max[1]) / 2,
      (b.min[2] + b.max[2]) / 2
    ],
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  };
}

function centerSizeToBounds(center: Vec3, size: Vec3): AssetCollider["localBounds"] {
  const hx = Math.abs(size[0]) / 2;
  const hy = Math.abs(size[1]) / 2;
  const hz = Math.abs(size[2]) / 2;
  return {
    min: [center[0] - hx, center[1] - hy, center[2] - hz],
    max: [center[0] + hx, center[1] + hy, center[2] + hz]
  };
}

export function AssetCollisionSection({
  instance,
  assetDefinition,
  regionId,
  activeScene,
  isSceneContained,
  onCommand
}: AssetCollisionSectionProps) {
  const [editScope, setEditScope] = useState<EditScope>("base");
  const effectiveScope: EditScope = isSceneContained ? "base" : editScope;

  const sceneRecord: SceneAssetAppearanceOverride | null = useMemo(() => {
    if (isSceneContained) return null;
    return (
      activeScene?.regionOverlays[regionId]?.assetAppearanceOverrides[
        instance.instanceId
      ] ?? null
    );
  }, [activeScene, regionId, instance.instanceId, isSceneContained]);

  // The domain resolver is the single enforcer of collider precedence; this
  // section only renders its result and dispatches edits at the chosen scope.
  const resolved = useMemo(
    () =>
      resolveEffectiveInstanceCollider(
        assetDefinition?.collider,
        instance.colliderOverride,
        sceneRecord?.colliderOverride
      ),
    [assetDefinition, instance.colliderOverride, sceneRecord]
  );

  const shape = resolved.collider?.shape ?? "none";
  const centerSize = boundsToCenterSize(resolved.collider);
  const hasOverrideAtScope =
    effectiveScope === "scene"
      ? Boolean(sceneRecord?.colliderOverride)
      : Boolean(instance.colliderOverride);

  function dispatch(collider: AssetCollider | null) {
    onCommand({
      kind: "SetPlacedAssetColliderOverride",
      target: { aggregateKind: "region-document", aggregateId: regionId },
      subject: { subjectKind: "placed-asset", subjectId: instance.instanceId },
      payload: { instanceId: instance.instanceId, collider, scope: effectiveScope }
    });
  }

  function setShape(nextShape: AssetColliderShape) {
    dispatch({
      shape: nextShape,
      // Keep the current bounds when switching to a bounded shape; "none"
      // needs no bounds.
      localBounds:
        nextShape === "none" ? null : resolved.collider?.localBounds ?? null
    });
  }

  function nudge(kind: "center" | "size", axis: 0 | 1 | 2, value: number) {
    if (!centerSize) return;
    const next = {
      center: [...centerSize.center] as Vec3,
      size: [...centerSize.size] as Vec3
    };
    next[kind][axis] = value;
    dispatch({
      shape,
      localBounds: centerSizeToBounds(next.center, next.size)
    });
  }

  if (!assetDefinition) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Group gap={6} align="center">
          <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
            Collision
          </Text>
          {resolved.tier !== "definition" ? (
            <ScopeBadge tier={resolved.tier} />
          ) : null}
        </Group>
        <ScopeChip
          value={isSceneContained ? "scene" : editScope}
          options={[
            { value: "base", label: "Base" },
            { value: "scene", label: "Scene" }
          ]}
          onChange={(value) => setEditScope(value as EditScope)}
          disabled={isSceneContained || !activeScene}
          disabledReason={
            isSceneContained
              ? `This placement lives only in ${
                  activeScene?.displayName ?? "this Scene"
                }, so its collider edits stay in the Scene.`
              : "Open a Scene to scope edits to it -- only Base is available otherwise."
          }
        />
      </Group>

      <Select
        label="Shape"
        size="xs"
        data={SHAPE_OPTIONS}
        value={shape}
        onChange={(value) => value && setShape(value as AssetColliderShape)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />

      {shape !== "none" && centerSize ? (
        <>
          <TransformInspector
            label="Collider Offset"
            value={centerSize.center}
            step={0.1}
            onChange={(axis, value) => nudge("center", axis, value)}
          />
          <TransformInspector
            label="Collider Size"
            value={centerSize.size}
            step={0.1}
            onChange={(axis, value) => nudge("size", axis, value)}
          />
        </>
      ) : null}

      {shape !== "none" && !centerSize ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          No baked bounds yet — re-import or origin-correct the asset to bake
          its collider box before resizing.
        </Text>
      ) : null}

      {hasOverrideAtScope ? (
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={() => dispatch(null)}
        >
          Reset to definition ({effectiveScope})
        </Button>
      ) : null}
    </Stack>
  );
}
