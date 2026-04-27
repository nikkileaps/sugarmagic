/**
 * Domain IO normalization.
 *
 * Owns canonical load-time upgrades for persisted authored documents. Legacy
 * persisted shapes are normalized here, once, before authoring-session or
 * runtime code consumes them. This is also the defensive decoder for authored
 * render traits: malformed deform/effect values fail here instead of leaking
 * impossible states deeper into the runtime.
 */

import type { ContentLibrarySnapshot } from "../content-library";
import type { ShaderBindingOverride, ShaderSlotKind } from "../shader-graph";
import {
  createDefaultRegionLandscapeSurfaceSlots,
  createDefaultRegionLandscapeState,
  createPlacedAssetInstance,
  createRegionAreaDefinition,
  createRegionItemPresence,
  createLandscapeSurfaceSlot,
  createRegionNPCBehaviorDefinition,
  createRegionNPCBehaviorTask,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  type RegionDocument
} from "../region-authoring";
import {
  createSurface,
  isShaderOrMaterialContent,
  type ShaderOrMaterial,
  type SurfaceBinding,
  type SurfaceContext
} from "../surface";

function defaultEnvironmentId(contentLibrary: ContentLibrarySnapshot): string | null {
  return contentLibrary.environmentDefinitions[0]?.definitionId ?? null;
}

function slotForShaderDefinitionId(
  contentLibrary: ContentLibrarySnapshot,
  shaderDefinitionId: string | null | undefined
): ShaderSlotKind | null {
  if (!shaderDefinitionId) {
    return null;
  }

  const definition = contentLibrary.shaderDefinitions.find(
    (entry) => entry.shaderDefinitionId === shaderDefinitionId
  );
  if (definition?.targetKind === "mesh-deform") {
    return "deform";
  }
  if (definition?.targetKind === "mesh-surface") {
    return "surface";
  }
  return null;
}

function normalizeShaderOverrides(
  contentLibrary: ContentLibrarySnapshot,
  overrides: {
    shaderOverrides?: ShaderBindingOverride[];
    shaderOverride?: ShaderBindingOverride | null;
  }
): ShaderBindingOverride[] {
  const nextOverrides = new Map<ShaderSlotKind, ShaderBindingOverride>();

  for (const override of overrides.shaderOverrides ?? []) {
    const slot =
      override.slot ??
      slotForShaderDefinitionId(contentLibrary, override.shaderDefinitionId) ??
      "surface";
    nextOverrides.set(slot, {
      shaderDefinitionId: override.shaderDefinitionId,
      slot
    });
  }

  if (overrides.shaderOverride?.shaderDefinitionId) {
    const slot =
      overrides.shaderOverride.slot ??
      slotForShaderDefinitionId(
        contentLibrary,
        overrides.shaderOverride.shaderDefinitionId
      ) ??
      "surface";
    if (!nextOverrides.has(slot)) {
      nextOverrides.set(slot, {
        shaderDefinitionId: overrides.shaderOverride.shaderDefinitionId,
        slot
      });
    }
  }

  return [...nextOverrides.values()];
}

function normalizeShaderOrMaterialForLoad(
  ownerLabel: string,
  field: "deform" | "effect",
  value: ShaderOrMaterial | null | undefined
): ShaderOrMaterial | null {
  if (!value) {
    return null;
  }
  if (!isShaderOrMaterialContent(value)) {
    throw new Error(
      `${ownerLabel}.${field} must be a shader or material surface; received "${String(
        (value as { kind?: unknown }).kind ?? "unknown"
      )}".`
    );
  }
  if (value.kind === "material") {
    return {
      kind: "material",
      materialDefinitionId: value.materialDefinitionId
    };
  }
  return {
    kind: "shader",
    shaderDefinitionId: value.shaderDefinitionId,
    parameterValues: { ...(value.parameterValues ?? {}) },
    textureBindings: { ...(value.textureBindings ?? {}) }
  };
}

function normalizeSurfaceBindingForLoad<C extends SurfaceContext = SurfaceContext>(
  ownerLabel: string,
  field: string,
  value: SurfaceBinding<C> | null | undefined
): SurfaceBinding<C> | null {
  if (!value) {
    return null;
  }
  if (value.kind === "reference") {
    return {
      kind: "reference",
      surfaceDefinitionId: value.surfaceDefinitionId
    };
  }
  if (value.kind !== "inline") {
    throw new Error(
      `${ownerLabel}.${field} must be an inline or reference surface binding; received "${String(
        (value as { kind?: unknown }).kind ?? "unknown"
      )}".`
    );
  }
  return {
    kind: "inline",
    surface: createSurface(value.surface.layers, value.surface.context)
  } as SurfaceBinding<C>;
}

export function normalizeRegionDocumentForLoad(
  region: RegionDocument,
  contentLibrary: ContentLibrarySnapshot
): RegionDocument {
  const legacyLandscape = (region as RegionDocument & {
    landscape?: Partial<ReturnType<typeof createDefaultRegionLandscapeState>> & {
      baseColor?: number;
    };
  }).landscape;
  const defaultLandscape = createDefaultRegionLandscapeState({
    surfaceSlots: createDefaultRegionLandscapeSurfaceSlots(legacyLandscape?.baseColor)
  });
  const normalizedBinding = (region as RegionDocument & {
    environmentBinding?: { defaultEnvironmentId?: string | null };
  }).environmentBinding;

  return {
    ...region,
    lorePageId:
      typeof region.lorePageId === "string" && region.lorePageId.trim().length > 0
        ? region.lorePageId.trim()
        : null,
    scene: {
      folders: region.scene.folders,
      placedAssets: region.scene.placedAssets.map((asset) =>
        createPlacedAssetInstance({
          ...asset,
          inspectable: asset.inspectable ?? null,
          shaderOverrides: normalizeShaderOverrides(contentLibrary, asset)
        })
      ),
      playerPresence: region.scene.playerPresence
        ? createRegionPlayerPresence(region.scene.playerPresence)
        : null,
      npcPresences: region.scene.npcPresences.map((presence) =>
        createRegionNPCPresence({
          ...presence,
          shaderOverrides: normalizeShaderOverrides(contentLibrary, presence)
        })
      ),
      itemPresences: (region.scene.itemPresences ?? []).map((presence) =>
        createRegionItemPresence({
          ...presence,
          shaderOverrides: normalizeShaderOverrides(contentLibrary, presence)
        })
      )
    },
    environmentBinding: {
      defaultEnvironmentId:
        normalizedBinding?.defaultEnvironmentId ?? defaultEnvironmentId(contentLibrary)
    },
    areas: (region.areas ?? []).map((area) =>
      createRegionAreaDefinition({
        ...area,
        lorePageId:
          typeof area.lorePageId === "string" && area.lorePageId.trim().length > 0
            ? area.lorePageId.trim()
            : null,
        parentAreaId:
          typeof area.parentAreaId === "string" && area.parentAreaId.trim().length > 0
            ? area.parentAreaId.trim()
            : null
      })
    ),
    behaviors: (region.behaviors ?? []).map((behavior) =>
      createRegionNPCBehaviorDefinition({
        ...behavior,
        displayName:
          typeof behavior.displayName === "string" && behavior.displayName.trim().length > 0
            ? behavior.displayName.trim()
            : undefined,
        tasks: (behavior.tasks ?? []).map((task) =>
          createRegionNPCBehaviorTask({
            ...task,
            displayName:
              typeof task.displayName === "string" && task.displayName.trim().length > 0
                ? task.displayName.trim()
                : undefined,
            description:
              typeof task.description === "string" && task.description.trim().length > 0
                ? task.description
                : null,
            currentActivity:
              typeof task.currentActivity === "string" &&
              task.currentActivity.trim().length > 0
                ? task.currentActivity.trim()
                : undefined,
            currentGoal:
              typeof task.currentGoal === "string" &&
              task.currentGoal.trim().length > 0
                ? task.currentGoal.trim()
                : undefined,
            targetAreaId:
              typeof task.targetAreaId === "string" &&
              task.targetAreaId.trim().length > 0
                ? task.targetAreaId.trim()
                : null,
            activation: {
              questDefinitionId:
                typeof task.activation?.questDefinitionId === "string" &&
                task.activation.questDefinitionId.trim().length > 0
                  ? task.activation.questDefinitionId.trim()
                  : null,
              questStageId:
                typeof task.activation?.questStageId === "string" &&
                task.activation.questStageId.trim().length > 0
                  ? task.activation.questStageId.trim()
                  : null,
              worldFlagEquals:
                typeof task.activation?.worldFlagEquals?.key === "string" &&
                task.activation.worldFlagEquals.key.trim().length > 0
                  ? {
                      key: task.activation.worldFlagEquals.key.trim(),
                      valueType:
                        task.activation.worldFlagEquals.valueType ?? "boolean",
                      value:
                        typeof task.activation.worldFlagEquals.value === "string" &&
                        task.activation.worldFlagEquals.value.trim().length > 0
                          ? task.activation.worldFlagEquals.value.trim()
                          : null
                    }
                  : null
            }
          })
        )
      })
    ),
    landscape: createDefaultRegionLandscapeState({
      ...defaultLandscape,
      ...(legacyLandscape ?? {}),
      surfaceSlots:
        legacyLandscape?.surfaceSlots && legacyLandscape.surfaceSlots.length > 0
          ? legacyLandscape.surfaceSlots.map((slot) =>
              createLandscapeSurfaceSlot({
                ...slot,
                surface: normalizeSurfaceBindingForLoad(
                  `region:${region.identity.id}:landscape`,
                  `surfaceSlots[${slot.channelId ?? slot.slotName ?? "unknown"}].surface`,
                  slot.surface
                )
              })
            )
          : defaultLandscape.surfaceSlots,
      deform: normalizeShaderOrMaterialForLoad(
        `region:${region.identity.id}:landscape`,
        "deform",
        legacyLandscape?.deform ?? null
      ),
      effect: normalizeShaderOrMaterialForLoad(
        `region:${region.identity.id}:landscape`,
        "effect",
        legacyLandscape?.effect ?? null
      ),
      paintPayload: legacyLandscape?.paintPayload ?? null
    })
  };
}
