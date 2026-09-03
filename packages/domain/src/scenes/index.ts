/**
 * packages/domain/src/scenes/index.ts
 *
 * Purpose: The `Scene` primitive — one place, with the overlays
 * that dress it for this part of the story.
 *
 * A Scene is ORDERED but NOT GATED: its position inside its
 * Episode says what comes next, and nothing holds the player
 * back — finishing one moves them to the next. The gate lives on
 * `Episode` (`episodes/`), which also holds the Scenes and owns
 * their order. A Scene therefore carries no order number and no
 * unlock rule of its own.
 *
 * Pattern: layer composition, two layers. The region is the world
 * at rest -- its dressing AND its residents. A Scene names one
 * region and carries one OVERLAY: a diff that adds, suppresses,
 * and restyles while that Scene is active. Mechanically closest to
 * UE5 Data Layers: everything ships in the bundle, the active
 * Scene decides what is composed on top.
 *
 * Lives in `scenes/` (plural) to avoid colliding with
 * runtime-core's `scene/` module (visual SceneObject concerns).
 *
 * Implements: Plan 058 §058.1
 *
 * Status: active
 */

import { createScopedId } from "../shared/identity";
import {
  createPlacedAssetInstance,
  createRegionItemPresence,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  type PlacedAssetInstance,
  type PlacedAssetSurfaceSlotOverride,
  type RegionItemPresence,
  type RegionNavMeshArtifact,
  type RegionNPCPresence,
  type RegionPlayerPresence,
  type RegionSceneFolder
} from "../region-authoring";
import type { ShaderBindingOverride } from "../shader-graph";
import {
  normalizeQuestDefinition,
  type QuestDefinition
} from "../quest-definition";
import {
  cloneAssetCollider,
  isValidColliderShape,
  type AssetCollider
} from "../content-library";

/**
 * Stable id for the Scene that the 058.1 load-time migration
 * synthesizes from a pre-Scenes project. A LITERAL, not a
 * generated id, because downstream migrations key on it — e.g.
 * `world.presence`'s v1 -> v2 slice upgrade (Plan 058.5) wraps
 * previously-collected presence ids under this Scene id.
 */
export const DEFAULT_SCENE_ID = "scene:default";

export * from "./migrate";

export function createSceneId(): string {
  return createScopedId("scene");
}

/**
 * Per-Scene atmosphere override. When set, the runtime uses this
 * environment for the Scene instead of the region's default
 * (`region.environmentBinding.defaultEnvironmentId`). Null falls
 * through. Scene 3 as twilight fog, Scene 5 as storm at night.
 */
export interface SceneEnvironmentOverride {
  environmentId: string;
}

/**
 * Per-Scene audio override. Null fields fall through to the
 * project-level bindings; a fully-null override is normalized to
 * `null` on the Scene.
 */
export interface SceneAudioOverride {
  backgroundMusicId: string | null;
  ambientSoundId: string | null;
}

/**
 * Player-facing title card rendered when the game advances into
 * something ("CHAPTER 3: THE RECKONING"). Null means hard cut, no
 * card.
 *
 * Shared by both owners: an Episode's chapter card and a Scene's
 * between-Scenes cut are the same shape and differ only in who
 * holds them and when they play. Named for neither.
 */
export interface TransitionConfig {
  titleText: string;
  subtitleText: string | null;
  durationMs: number;
  fadeStyle: "cross" | "black" | "white";
}

/**
 * The OVERLAY side of Plan 058's Base + Overlay split for one
 * region: everything this Scene places into that region.
 * Presences are overlay-only (no "always present" semantic);
 * placed assets + folders here are the Scene-scoped decoration
 * layer (the always-visible ones live on the Region base as
 * `region.placedAssets` / `region.folders`).
 */
/**
 * Plan 068.2 — a Scene's restyle of ONE base placement's appearance
 * (per-material-slot surfaces and/or deform/effect shaders). Applies
 * ON TOP of the instance's own overrides while this Scene is active:
 * scene > instance > definition. Only meaningful for BASE-scope
 * instances — a scene-contained instance's own override fields are
 * already scene-scoped by containment, and the command executor
 * routes scene-scope writes for those to the instance itself.
 */
export interface SceneAssetAppearanceOverride {
  surfaceSlotOverrides?: PlacedAssetSurfaceSlotOverride[];
  shaderOverrides?: ShaderBindingOverride[];
  /** Plan 069.6 — a Scene's collider restyle of ONE base placement (a
   *  wall/walk-on prop that differs per Scene). Precedence scene >
   *  instance > definition; see `resolveEffectiveInstanceCollider`. */
  colliderOverride?: AssetCollider;
}

/** Which tier supplied the resolved collider (Plan 069.6). */
export type ColliderOverrideTier = "definition" | "base" | "scene";

export interface ResolvedInstanceCollider {
  collider: AssetCollider | null;
  tier: ColliderOverrideTier;
}

/**
 * THE per-instance collider precedence (Plan 069.6): scene override wins,
 * else the instance's own override, else the asset definition (069.1).
 * An override that only changes the SHAPE (bounds `null`) inherits the
 * definition's baked `localBounds`, so "keep the auto-box, just mark it a
 * blocker" doesn't drop the geometry. Runtime resolution AND the inspector
 * provenance chip consume this — precedence lives here and nowhere else.
 */
export function resolveEffectiveInstanceCollider(
  definitionCollider: AssetCollider | null | undefined,
  instanceOverride: AssetCollider | null | undefined,
  sceneOverride: AssetCollider | null | undefined
): ResolvedInstanceCollider {
  const active = sceneOverride ?? instanceOverride ?? null;
  if (!active) {
    // Clone so a resolved SceneObject never aliases the library definition's
    // live collider (matches the clone discipline every other handoff uses).
    return {
      collider: definitionCollider ? cloneAssetCollider(definitionCollider) : null,
      tier: "definition"
    };
  }
  return {
    collider: {
      shape: active.shape,
      localBounds:
        active.localBounds ?? definitionCollider?.localBounds ?? null
    },
    tier: sceneOverride ? "scene" : "base"
  };
}

/** Which tier supplied a merged appearance entry (Plan 068.3
 *  provenance chips read this; "definition" is the absence of any
 *  entry). */
export type AppearanceOverrideTier = "base" | "scene";

export interface MergedAppearanceOverrides {
  shaderOverrides: (ShaderBindingOverride & { tier: AppearanceOverrideTier })[];
  surfaceSlotOverrides: (PlacedAssetSurfaceSlotOverride & {
    tier: AppearanceOverrideTier;
  })[];
}

/**
 * THE merge of the two override tiers (Plan 068.2/068.3): scene
 * entries win per material-slot name and per shader-slot kind;
 * instance ("base") entries survive for everything the Scene doesn't
 * touch. Runtime resolution AND the inspector's provenance display
 * both consume this -- precedence order lives here and nowhere else.
 */
export function mergeAppearanceOverrideTiers(
  instanceFields: Pick<
    PlacedAssetInstance,
    "shaderOverrides" | "surfaceSlotOverrides"
  >,
  sceneOverride: SceneAssetAppearanceOverride | null | undefined
): MergedAppearanceOverrides {
  const shaderBySlot = new Map(
    (instanceFields.shaderOverrides ?? []).map((entry) => [
      entry.slot,
      { ...entry, tier: "base" as AppearanceOverrideTier }
    ])
  );
  const surfaceBySlotName = new Map(
    (instanceFields.surfaceSlotOverrides ?? []).map((entry) => [
      entry.slotName,
      { ...entry, tier: "base" as AppearanceOverrideTier }
    ])
  );
  for (const entry of sceneOverride?.shaderOverrides ?? []) {
    shaderBySlot.set(entry.slot, { ...entry, tier: "scene" });
  }
  for (const entry of sceneOverride?.surfaceSlotOverrides ?? []) {
    surfaceBySlotName.set(entry.slotName, { ...entry, tier: "scene" });
  }
  return {
    shaderOverrides: [...shaderBySlot.values()],
    surfaceSlotOverrides: [...surfaceBySlotName.values()]
  };
}

export interface RegionSceneOverlay {
  itemPresences: RegionItemPresence[];
  npcPresences: RegionNPCPresence[];
  playerPresence: RegionPlayerPresence | null;
  placedAssets: PlacedAssetInstance[];
  folders: RegionSceneFolder[];
  /** Plan 068.2 — Scene restyles of base placements, by instanceId. */
  assetAppearanceOverrides: Record<string, SceneAssetAppearanceOverride>;
  /**
   * Epic #226 — region-owned content this Scene hides: placed-asset
   * `instanceId`s and presence `presenceId`s in one list, since both are
   * uuids and a Scene hides a thing without caring which kind it is. Names
   * region content rather than copying it, so there is never a second copy
   * to drift. Ids that match nothing are ignored: an author can delete a
   * region asset a Scene once hid without breaking that Scene.
   */
  suppressedRegionIds: string[];
}

export interface Scene {
  sceneId: string;
  displayName: string;
  description: string;
  /** Free-form author notes (design intent, TODOs). */
  notes: string;
  /**
   * The one region this Scene happens in (epic #226). Not nullable: a
   * Scene that names no place cannot be entered, so the type refuses to
   * express one and Studio requires a region when a Scene is created.
   * This replaces the old pair of `startingRegionId` plus a map of
   * overlays, which were two answers to the same question.
   */
  regionId: string;
  /** What this Scene changes about its region: adds, suppressions, and
   *  restyles. */
  overlay: RegionSceneOverlay;
  /**
   * The quests that happen in this Scene (epic #226). HELD BY VALUE, the
   * way an Episode holds its Scenes: a quest belongs to exactly one Scene
   * by construction, so it cannot be orphaned or owned twice. Code that
   * wants a quest without caring which Scene owns it uses the
   * `getAllQuestDefinitions` / `findQuestDefinitionById` accessors in
   * `episodes/`.
   *
   * Dialogue is NOT contained this way: a quest node references a dialogue
   * by id, and an NPC-bound ambient dialogue belongs to no quest at all.
   */
  questDefinitions: QuestDefinition[];
  environmentOverride: SceneEnvironmentOverride | null;
  audioOverride: SceneAudioOverride | null;
  /**
   * This Scene's own baked navmesh, when its overlay changes what blocks
   * movement -- suppressing a wall, adding a crate.
   *
   * Null means "I do not change collision, use the region's". Absence is
   * inherit, and it is the common case: most Scenes dress a region without
   * touching what an NPC can walk through.
   *
   * REPLACES the region's at runtime rather than adding to it. A navmesh is
   * one connected mesh; two overlaid meshes have no coherent polygon
   * adjacency, so there is nothing sensible to merge.
   */
  navMesh: RegionNavMeshArtifact | null;
  transitionConfig: TransitionConfig | null;
}

export function createRegionSceneOverlay(
  overrides: Partial<RegionSceneOverlay> = {}
): RegionSceneOverlay {
  return {
    itemPresences: [...(overrides.itemPresences ?? [])],
    npcPresences: [...(overrides.npcPresences ?? [])],
    playerPresence: overrides.playerPresence ?? null,
    placedAssets: [...(overrides.placedAssets ?? [])],
    folders: [...(overrides.folders ?? [])],
    suppressedRegionIds: [...(overrides.suppressedRegionIds ?? [])],
    assetAppearanceOverrides: Object.fromEntries(
      Object.entries(overrides.assetAppearanceOverrides ?? {}).map(
        ([instanceId, override]) => [
          instanceId,
          {
            surfaceSlotOverrides: override.surfaceSlotOverrides
              ? override.surfaceSlotOverrides.map((entry) => ({ ...entry }))
              : undefined,
            shaderOverrides: override.shaderOverrides
              ? override.shaderOverrides.map((entry) => ({ ...entry }))
              : undefined,
            colliderOverride: override.colliderOverride
              ? cloneAssetCollider(override.colliderOverride)
              : undefined
          }
        ]
      )
    )
  };
}

export function createDefaultScene(
  overrides: Partial<Scene> = {}
): Scene {
  return {
    sceneId: overrides.sceneId ?? createSceneId(),
    displayName: overrides.displayName ?? "Scene 1",
    description: overrides.description ?? "",
    notes: overrides.notes ?? "",
    regionId: overrides.regionId ?? "",
    questDefinitions: [...(overrides.questDefinitions ?? [])],
    overlay: overrides.overlay
      ? createRegionSceneOverlay(overrides.overlay)
      : createRegionSceneOverlay(),
    environmentOverride: overrides.environmentOverride ?? null,
    audioOverride: overrides.audioOverride ?? null,
    navMesh: overrides.navMesh ?? null,
    transitionConfig: overrides.transitionConfig ?? null
  };
}

function normalizeEnvironmentOverride(
  input: unknown
): SceneEnvironmentOverride | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.environmentId === "string" &&
    record.environmentId.trim().length > 0
  ) {
    return { environmentId: record.environmentId.trim() };
  }
  return null;
}

function normalizeAudioOverride(input: unknown): SceneAudioOverride | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const backgroundMusicId =
    typeof record.backgroundMusicId === "string" &&
    record.backgroundMusicId.trim().length > 0
      ? record.backgroundMusicId.trim()
      : null;
  const ambientSoundId =
    typeof record.ambientSoundId === "string" &&
    record.ambientSoundId.trim().length > 0
      ? record.ambientSoundId.trim()
      : null;
  if (backgroundMusicId === null && ambientSoundId === null) return null;
  return { backgroundMusicId, ambientSoundId };
}

/**
 * Coerce a title card. Exported because both owners need it —
 * one normalizer, not a copy in each module. `episodes/` imports
 * it from here.
 */
/** A stored artifact reference, or null. Anything missing a path is not a
 *  usable reference, so it reads as absent rather than as a broken one. */
function normalizeNavMeshArtifact(
  record: unknown
): RegionNavMeshArtifact | null {
  if (!record || typeof record !== "object") return null;
  const candidate = record as Partial<RegionNavMeshArtifact>;
  if (typeof candidate.assetPath !== "string" || !candidate.assetPath) {
    return null;
  }
  return {
    assetPath: candidate.assetPath,
    inputHash: typeof candidate.inputHash === "string" ? candidate.inputHash : "",
    agentRadius:
      typeof candidate.agentRadius === "number" ? candidate.agentRadius : 0
  };
}

export function normalizeTransitionConfig(
  input: unknown
): TransitionConfig | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.titleText !== "string" ||
    record.titleText.trim().length === 0
  ) {
    return null;
  }
  const fadeStyle =
    record.fadeStyle === "cross" ||
    record.fadeStyle === "black" ||
    record.fadeStyle === "white"
      ? record.fadeStyle
      : "black";
  const durationMs =
    typeof record.durationMs === "number" &&
    Number.isFinite(record.durationMs) &&
    record.durationMs > 0
      ? Math.floor(record.durationMs)
      : 2500;
  return {
    titleText: record.titleText.trim(),
    subtitleText:
      typeof record.subtitleText === "string" &&
      record.subtitleText.trim().length > 0
        ? record.subtitleText.trim()
        : null,
    durationMs,
    fadeStyle
  };
}

function isValidColliderOverride(
  collider: AssetCollider | undefined
): collider is AssetCollider {
  return Boolean(collider && isValidColliderShape(collider.shape));
}

function normalizeSceneAssetAppearanceOverrides(
  input: Record<string, SceneAssetAppearanceOverride> | undefined
): Record<string, SceneAssetAppearanceOverride> {
  const normalized: Record<string, SceneAssetAppearanceOverride> = {};
  for (const [instanceId, override] of Object.entries(input ?? {})) {
    if (!instanceId || !override || typeof override !== "object") continue;
    const bySlotName = new Map<string, PlacedAssetSurfaceSlotOverride>();
    for (const entry of override.surfaceSlotOverrides ?? []) {
      if (typeof entry?.slotName !== "string" || !entry.slotName || !entry.surface) {
        continue;
      }
      bySlotName.set(entry.slotName, {
        slotName: entry.slotName,
        surface: entry.surface
      });
    }
    const bySlotKind = new Map<string, ShaderBindingOverride>();
    for (const entry of override.shaderOverrides ?? []) {
      if (!entry?.shaderDefinitionId || !entry.slot) continue;
      bySlotKind.set(entry.slot, {
        shaderDefinitionId: entry.shaderDefinitionId,
        slot: entry.slot
      });
    }
    // Plan 069.6 — a collider-only Scene override is valid on its own.
    const colliderOverride = isValidColliderOverride(override.colliderOverride)
      ? cloneAssetCollider(override.colliderOverride)
      : undefined;
    if (bySlotName.size === 0 && bySlotKind.size === 0 && !colliderOverride) {
      continue;
    }
    normalized[instanceId] = {
      surfaceSlotOverrides:
        bySlotName.size > 0 ? [...bySlotName.values()] : undefined,
      shaderOverrides: bySlotKind.size > 0 ? [...bySlotKind.values()] : undefined,
      colliderOverride
    };
  }
  return normalized;
}

function normalizeRegionSceneOverlay(input: unknown): RegionSceneOverlay {
  if (!input || typeof input !== "object") return createRegionSceneOverlay();
  const record = input as Partial<RegionSceneOverlay>;
  return {
    itemPresences: (record.itemPresences ?? []).map((presence) =>
      createRegionItemPresence(presence)
    ),
    npcPresences: (record.npcPresences ?? []).map((presence) =>
      createRegionNPCPresence(presence)
    ),
    playerPresence: record.playerPresence
      ? createRegionPlayerPresence(record.playerPresence)
      : null,
    placedAssets: (record.placedAssets ?? []).map((asset) =>
      createPlacedAssetInstance(asset)
    ),
    folders: [...(record.folders ?? [])],
    suppressedRegionIds: (record.suppressedRegionIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0
    ),
    assetAppearanceOverrides: normalizeSceneAssetAppearanceOverrides(
      record.assetAppearanceOverrides
    )
  };
}

/**
 * Defensive normalization for load paths. Shape coercion only —
 * content-library-aware concerns (shader override resolution)
 * stay in the io layer, mirroring how region normalization is
 * split today.
 */
/**
 * What a collapse could not carry over, for the author to act on. A Scene
 * used to dress several regions; it now names one, so any other region's
 * overlay content has no home in the new shape. Reported rather than
 * dropped quietly -- the author decides whether to re-home it onto the
 * region itself or into another Scene.
 */
export interface SceneRegionCollapseNote {
  sceneId: string;
  /** The region whose overlay content is stranded. */
  regionId: string;
  npcPresences: number;
  itemPresences: number;
  placedAssets: number;
  hasPlayerPresence: boolean;
}

const sceneCollapseNotes: SceneRegionCollapseNote[] = [];

/**
 * Everything the last load's Scene collapse could not carry over. Read by
 * the load path so it can tell the author once, rather than each
 * normalizer call logging on its own.
 */
export function takeSceneRegionCollapseNotes(): SceneRegionCollapseNote[] {
  return sceneCollapseNotes.splice(0, sceneCollapseNotes.length);
}

/**
 * Collapse a pre-#226 Scene's `regionOverlays` map plus `startingRegionId`
 * into one region and one overlay.
 *
 * Which region survives, in order: the one the author named as the start,
 * then the only one there is. A Scene with neither names no region here --
 * `normalizeScenes` fills those in from the Scene before it, because that
 * needs the Scene's neighbours and this function only has the one.
 */
function collapseLegacySceneRegion(record: Record<string, unknown>): {
  regionId: string;
  overlay: RegionSceneOverlay;
} {
  // Already collapsed: a file written after this story.
  if (typeof record.regionId === "string" && record.regionId.trim().length > 0) {
    return {
      regionId: record.regionId.trim(),
      overlay: normalizeRegionSceneOverlay(record.overlay)
    };
  }

  const overlaysInput =
    record.regionOverlays && typeof record.regionOverlays === "object"
      ? (record.regionOverlays as Record<string, unknown>)
      : {};
  const overlays = new Map<string, RegionSceneOverlay>();
  for (const [regionId, overlay] of Object.entries(overlaysInput)) {
    if (regionId.trim().length === 0) continue;
    overlays.set(regionId.trim(), normalizeRegionSceneOverlay(overlay));
  }

  const startingRegionId =
    typeof record.startingRegionId === "string" &&
    record.startingRegionId.trim().length > 0
      ? record.startingRegionId.trim()
      : null;
  const keptRegionId =
    startingRegionId ?? (overlays.size === 1 ? [...overlays.keys()][0]! : "");

  const sceneId =
    typeof record.sceneId === "string" ? record.sceneId.trim() : "";
  for (const [regionId, overlay] of overlays) {
    if (regionId === keptRegionId) continue;
    sceneCollapseNotes.push({
      sceneId,
      regionId,
      npcPresences: overlay.npcPresences.length,
      itemPresences: overlay.itemPresences.length,
      placedAssets: overlay.placedAssets.length,
      hasPlayerPresence: overlay.playerPresence !== null
    });
  }

  return {
    regionId: keptRegionId,
    overlay: overlays.get(keptRegionId) ?? createRegionSceneOverlay()
  };
}

export function normalizeScene(input: unknown): Scene | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.sceneId !== "string" ||
    record.sceneId.trim().length === 0
  ) {
    return null;
  }
  const collapsed = collapseLegacySceneRegion(record);
  return {
    sceneId: record.sceneId.trim(),
    displayName:
      typeof record.displayName === "string" &&
      record.displayName.trim().length > 0
        ? record.displayName.trim()
        : "Scene",
    description:
      typeof record.description === "string" ? record.description : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    regionId: collapsed.regionId,
    overlay: collapsed.overlay,
    questDefinitions: Array.isArray(record.questDefinitions)
      ? record.questDefinitions.map((definition) =>
          normalizeQuestDefinition(definition)
        )
      : [],
    environmentOverride: normalizeEnvironmentOverride(
      record.environmentOverride
    ),
    audioOverride: normalizeAudioOverride(record.audioOverride),
    // A file written before Scenes could own one has none, which reads as
    // "inherit the region's" -- what it did then.
    navMesh: normalizeNavMeshArtifact(record.navMesh),
    transitionConfig: normalizeTransitionConfig(record.transitionConfig)
  };
}

/**
 * Normalize a list of Scenes. Drops malformed entries and dedupes
 * by sceneId (first wins).
 *
 * PRESERVES input order — it does not sort. Order is list
 * position now, so a sort here would be the load path quietly
 * rewriting the narrative, and the damage would be permanent
 * rather than merely wrong. `episodes/` owns the resolvers that
 * used to live beside this.
 */
export function normalizeScenes(input: unknown): Scene[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const scenes: Scene[] = [];
  for (const candidate of input) {
    const scene = normalizeScene(candidate);
    if (!scene || seen.has(scene.sceneId)) continue;
    seen.add(scene.sceneId);
    scenes.push(scene);
  }
  // A Scene that named no region continues where the story was: it takes
  // the region of the Scene before it. Reaching for "the project's first
  // region" instead would be a guess about an unrelated list's order,
  // which is how a Scene ends up pointing at a region nobody is using.
  // A leading Scene with no region stays empty and fails validation.
  let previousRegionId = "";
  for (const scene of scenes) {
    if (scene.regionId.length === 0) {
      scene.regionId = previousRegionId;
    }
    if (scene.regionId.length > 0) {
      previousRegionId = scene.regionId;
    }
  }
  return scenes;
}
