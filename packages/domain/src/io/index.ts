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
  createRegionAudioState,
  createRegionItemPresence,
  createLandscapeSurfaceSlot,
  createRegionNPCBehaviorDefinition,
  createRegionNPCBehaviorTask,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  createRegionLayoutSketchState,
  type RegionDocument
} from "../region-authoring";
import type { RegionSceneOverlay, Scene } from "../scenes";
import {
  createSurface,
  type ShaderReference,
  type SurfaceBinding,
  type SurfaceContext
} from "../surface";

function defaultEnvironmentId(
  contentLibrary: ContentLibrarySnapshot
): string | null {
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

function normalizeShaderReferenceForLoad(
  ownerLabel: string,
  field: "deform" | "effect",
  value: unknown
): ShaderReference | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    kind?: string;
    shaderDefinitionId?: string;
    parameterValues?: Record<string, unknown>;
    textureBindings?: Record<string, string>;
  };
  // Pre-Plan-037 deform/effect slots accepted material refs (when
  // materials were shader wrappers). Post-037, a material ref in a
  // deform/effect slot is meaningless — drop with a load-time error
  // so it surfaces in the project loader's warning channel rather
  // than silently breaking rendering.
  if (candidate.kind === "material") {
    throw new Error(
      `${ownerLabel}.${field} contains a Material reference, which is not a valid ${field} binding (post-Plan-037 Materials are PBR data only). Either delete the field or replace with a Shader reference.`
    );
  }
  if (candidate.kind !== "shader" || !candidate.shaderDefinitionId) {
    throw new Error(
      `${ownerLabel}.${field} must be a shader reference; received "${String(
        candidate.kind ?? "unknown"
      )}".`
    );
  }
  return {
    kind: "shader",
    shaderDefinitionId: candidate.shaderDefinitionId,
    parameterValues: { ...(candidate.parameterValues ?? {}) },
    textureBindings: { ...(candidate.textureBindings ?? {}) }
  };
}

function normalizeSurfaceBindingForLoad<
  C extends SurfaceContext = SurfaceContext
>(
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
  const legacyLandscape = (
    region as RegionDocument & {
      landscape?: Partial<
        ReturnType<typeof createDefaultRegionLandscapeState>
      > & {
        baseColor?: number;
      };
    }
  ).landscape;
  const defaultLandscape = createDefaultRegionLandscapeState({
    surfaceSlots: createDefaultRegionLandscapeSurfaceSlots(
      legacyLandscape?.baseColor
    )
  });
  const normalizedBinding = (
    region as RegionDocument & {
      environmentBinding?: { defaultEnvironmentId?: string | null };
    }
  ).environmentBinding;

  // Plan 058 §058.1 — regions carry base-scope placedAssets +
  // folders at top level. Pre-058 files nest them (with the
  // presences) under `scene`; `migrateToScenes` lifts the
  // presences into the project's default Scene, and THIS
  // normalizer only has the region in hand — so it normalizes
  // whichever assets/folders are visible at top level and leaves
  // the legacy nest untouched for the migration pass to consume.
  const baseAssets = region.placedAssets ?? [];
  const baseFolders = region.folders ?? [];

  return {
    ...region,
    lorePageId:
      typeof region.lorePageId === "string" &&
      region.lorePageId.trim().length > 0
        ? region.lorePageId.trim()
        : null,
    placedAssets: baseAssets.map((asset) =>
      createPlacedAssetInstance({
        ...asset,
        inspectable: asset.inspectable ?? null,
        shaderOverrides: normalizeShaderOverrides(contentLibrary, asset)
      })
    ),
    folders: [...baseFolders],
    environmentBinding: {
      defaultEnvironmentId:
        normalizedBinding?.defaultEnvironmentId ??
        defaultEnvironmentId(contentLibrary)
    },
    areas: (region.areas ?? []).map((area) =>
      createRegionAreaDefinition({
        ...area,
        lorePageId:
          typeof area.lorePageId === "string" &&
          area.lorePageId.trim().length > 0
            ? area.lorePageId.trim()
            : null,
        parentAreaId:
          typeof area.parentAreaId === "string" &&
          area.parentAreaId.trim().length > 0
            ? area.parentAreaId.trim()
            : null
      })
    ),
    behaviors: (region.behaviors ?? []).map((behavior) =>
      createRegionNPCBehaviorDefinition({
        ...behavior,
        displayName:
          typeof behavior.displayName === "string" &&
          behavior.displayName.trim().length > 0
            ? behavior.displayName.trim()
            : undefined,
        tasks: (behavior.tasks ?? []).map((task) =>
          createRegionNPCBehaviorTask({
            ...task,
            displayName:
              typeof task.displayName === "string" &&
              task.displayName.trim().length > 0
                ? task.displayName.trim()
                : undefined,
            description:
              typeof task.description === "string" &&
              task.description.trim().length > 0
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
                        typeof task.activation.worldFlagEquals.value ===
                          "string" &&
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
      deform: normalizeShaderReferenceForLoad(
        `region:${region.identity.id}:landscape`,
        "deform",
        legacyLandscape?.deform ?? null
      ),
      effect: normalizeShaderReferenceForLoad(
        `region:${region.identity.id}:landscape`,
        "effect",
        legacyLandscape?.effect ?? null
      ),
      paintPayload: legacyLandscape?.paintPayload ?? null
    }),
    audio: createRegionAudioState(
      (
        region as RegionDocument & {
          audio?: Parameters<typeof createRegionAudioState>[0];
        }
      ).audio
    ),
    // Plan 065 §065.1 — authoring-only Layout Sketch. Coerced on
    // load so a malformed payload can't leak into the session;
    // absent stays null (the common case).
    layoutSketch:
      region.layoutSketch && typeof region.layoutSketch === "object"
        ? createRegionLayoutSketchState(region.layoutSketch)
        : null
  };
}

/**
 * Plan 058 §058.1 — the contentLibrary-aware half of Scene
 * normalization. `normalizeScenes` (domain/scenes) does shape
 * coercion; this pass resolves shader-binding overrides on every
 * overlay member against the content library, exactly as region
 * placements got before the Base + Overlay split. Runs at load
 * time after `migrateToScenes`.
 */
export function normalizeScenesForLoad(
  scenes: Scene[],
  contentLibrary: ContentLibrarySnapshot
): Scene[] {
  return scenes.map((scene) => {
    const regionOverlays: Record<string, RegionSceneOverlay> = {};
    for (const [regionId, overlay] of Object.entries(scene.regionOverlays)) {
      regionOverlays[regionId] = {
        itemPresences: overlay.itemPresences.map((presence) =>
          createRegionItemPresence({
            ...presence,
            shaderOverrides: normalizeShaderOverrides(contentLibrary, presence)
          })
        ),
        npcPresences: overlay.npcPresences.map((presence) =>
          createRegionNPCPresence({
            ...presence,
            shaderOverrides: normalizeShaderOverrides(contentLibrary, presence)
          })
        ),
        playerPresence: overlay.playerPresence
          ? createRegionPlayerPresence(overlay.playerPresence)
          : null,
        placedAssets: overlay.placedAssets.map((asset) =>
          createPlacedAssetInstance({
            ...asset,
            inspectable: asset.inspectable ?? null,
            shaderOverrides: normalizeShaderOverrides(contentLibrary, asset)
          })
        ),
        folders: [...overlay.folders]
      };
    }
    return { ...scene, regionOverlays };
  });
}
