/**
 * Domain IO normalization.
 *
 * Owns canonical load-time upgrades for persisted authored documents. Legacy
 * persisted shapes are normalized here, once, before authoring-session or
 * runtime code consumes them.
 */

import type { ContentLibrarySnapshot } from "../content-library";
import type { ShaderBindingOverride, ShaderSlotKind } from "../shader-graph";
import {
  createDefaultRegionLandscapeChannels,
  createDefaultRegionLandscapeState,
  createPlacedAssetInstance,
  createRegionAreaDefinition,
  createRegionItemPresence,
  createRegionLandscapeChannelDefinition,
  createRegionNPCBehaviorDefinition,
  createRegionNPCBehaviorTask,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  type RegionDocument
} from "../region-authoring";

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
    channels: createDefaultRegionLandscapeChannels(legacyLandscape?.baseColor)
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
      // Run every channel through the factory so older persisted
      // shapes (missing tilingScale, etc.) get defaulted to current
      // canonical shape on load. Cheap and keeps the rest of the
      // runtime from having to handle partial channel objects.
      channels:
        legacyLandscape?.channels && legacyLandscape.channels.length > 0
          ? legacyLandscape.channels.map((channel) =>
              createRegionLandscapeChannelDefinition(channel)
            )
          : defaultLandscape.channels,
      paintPayload: legacyLandscape?.paintPayload ?? null
    })
  };
}
