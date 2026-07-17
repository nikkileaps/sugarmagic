/**
 * packages/domain/src/scenes/index.ts
 *
 * Purpose: The `Scene` narrative-partition primitive (Plan 058).
 * A Scene is a chunk of authored narrative content that unlocks
 * and releases sequentially — what an author might label a
 * "Chapter", "Episode", or "Act" (per-project `scenesUiLabel`).
 *
 * Pattern (Plan 058 §Design patterns): Base + Overlay (Layer
 * Composition). Regions are the shared geographic BASE; each
 * Scene carries per-region OVERLAYS (`regionOverlays[regionId]`)
 * holding the presences + Scene-scoped placed assets composed
 * onto the base while that Scene is active. Mechanically closest
 * to UE5 Data Layers: everything ships in the bundle, the active
 * Scene decides which overlay is composed.
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
  type RegionNPCPresence,
  type RegionPlayerPresence,
  type RegionSceneFolder
} from "../region-authoring";
import type { ShaderBindingOverride } from "../shader-graph";
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
 * When a Scene becomes playable. Evaluated at runtime boot
 * against the player's save (Plan 058 Pattern 3 — Filtered
 * Composition at Runtime).
 *
 *   - `"always"` — unlocked from the first boot. The default.
 *   - `manual` — only unlocked by an explicit `unlockScene`
 *     quest action (Plan 058.5's transition hook).
 *   - `questComplete` — unlocks when the referenced quest is in
 *     the save's completed set.
 *   - `wallClock` — unlocks at/after an ISO timestamp. Compared
 *     against `Date.now()` at boot; a runtime read, never
 *     persisted (the no-wallclock-in-slice rule applies to save
 *     slices, not authored schedule data).
 */
export type SceneUnlockCondition =
  | "always"
  | { kind: "manual" }
  | { kind: "questComplete"; questDefinitionId: string }
  | { kind: "wallClock"; unlockAtIso: string };

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
 * Player-facing title card rendered when the game advances INTO
 * this Scene ("CHAPTER 3: THE RECKONING"). Null on the Scene
 * means hard cut, no card.
 */
export interface SceneTransitionConfig {
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
}

export interface Scene {
  sceneId: string;
  /** Position in the narrative sequence; drives selector order
   *  and the default "first Scene" pick at fresh boot. */
  sceneOrder: number;
  displayName: string;
  description: string;
  /** Free-form author notes (design intent, TODOs). */
  notes: string;
  unlockCondition: SceneUnlockCondition;
  /** Region the game loads when this Scene is entered on a fresh
   *  boot (no save, no explicit request). Null = first region.
   *  Resolution precedence at runtime: saved region > explicit
   *  request (Studio Preview's edited region) > this > first.
   *  Mid-session region transitions (doors) are a follow-up. */
  startingRegionId: string | null;
  environmentOverride: SceneEnvironmentOverride | null;
  audioOverride: SceneAudioOverride | null;
  transitionConfig: SceneTransitionConfig | null;
  /** Keyed by regionId. A region absent from the record simply
   *  has no overlay in this Scene — base-only. */
  regionOverlays: Record<string, RegionSceneOverlay>;
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
    sceneOrder: overrides.sceneOrder ?? 0,
    displayName: overrides.displayName ?? "Scene 1",
    description: overrides.description ?? "",
    notes: overrides.notes ?? "",
    unlockCondition: overrides.unlockCondition ?? "always",
    startingRegionId: overrides.startingRegionId ?? null,
    environmentOverride: overrides.environmentOverride ?? null,
    audioOverride: overrides.audioOverride ?? null,
    transitionConfig: overrides.transitionConfig ?? null,
    regionOverlays: overrides.regionOverlays ?? {}
  };
}

function normalizeUnlockCondition(input: unknown): SceneUnlockCondition {
  if (input === "always") return "always";
  if (!input || typeof input !== "object") return "always";
  const record = input as Record<string, unknown>;
  if (record.kind === "manual") return { kind: "manual" };
  if (
    record.kind === "questComplete" &&
    typeof record.questDefinitionId === "string" &&
    record.questDefinitionId.trim().length > 0
  ) {
    return {
      kind: "questComplete",
      questDefinitionId: record.questDefinitionId.trim()
    };
  }
  if (
    record.kind === "wallClock" &&
    typeof record.unlockAtIso === "string" &&
    record.unlockAtIso.trim().length > 0
  ) {
    return { kind: "wallClock", unlockAtIso: record.unlockAtIso.trim() };
  }
  return "always";
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

function normalizeTransitionConfig(
  input: unknown
): SceneTransitionConfig | null {
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
export function normalizeScene(input: unknown): Scene | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.sceneId !== "string" ||
    record.sceneId.trim().length === 0
  ) {
    return null;
  }
  const overlaysInput =
    record.regionOverlays && typeof record.regionOverlays === "object"
      ? (record.regionOverlays as Record<string, unknown>)
      : {};
  const regionOverlays: Record<string, RegionSceneOverlay> = {};
  for (const [regionId, overlay] of Object.entries(overlaysInput)) {
    if (regionId.trim().length === 0) continue;
    regionOverlays[regionId] = normalizeRegionSceneOverlay(overlay);
  }
  return {
    sceneId: record.sceneId.trim(),
    sceneOrder:
      typeof record.sceneOrder === "number" &&
      Number.isFinite(record.sceneOrder)
        ? Math.floor(record.sceneOrder)
        : 0,
    displayName:
      typeof record.displayName === "string" &&
      record.displayName.trim().length > 0
        ? record.displayName.trim()
        : "Scene",
    description:
      typeof record.description === "string" ? record.description : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    unlockCondition: normalizeUnlockCondition(record.unlockCondition),
    startingRegionId:
      typeof record.startingRegionId === "string" &&
      record.startingRegionId.trim().length > 0
        ? record.startingRegionId
        : null,
    environmentOverride: normalizeEnvironmentOverride(
      record.environmentOverride
    ),
    audioOverride: normalizeAudioOverride(record.audioOverride),
    transitionConfig: normalizeTransitionConfig(record.transitionConfig),
    regionOverlays
  };
}

/**
 * Plan 058 §058.4 — Pattern 3 (Filtered Composition at Runtime):
 * evaluate every Scene's unlock condition against the player's
 * save state at boot. Pure; the caller supplies `now` (epoch ms)
 * so the wall-clock read stays at the seam, never persisted.
 */
export function resolveUnlockedSceneIds(input: {
  scenes: readonly Scene[];
  /** Scene ids explicitly unlocked by gameplay (the `unlockScene`
   *  quest action, Plan 058.5) — from campaign.progression. */
  manuallyUnlockedSceneIds: readonly string[];
  /** From the quest.manager slice — drives `questComplete`. */
  completedQuestIds: readonly string[];
  now: number;
}): Set<string> {
  const manual = new Set(input.manuallyUnlockedSceneIds);
  const quests = new Set(input.completedQuestIds);
  const unlocked = new Set<string>();
  for (const scene of input.scenes) {
    const condition = scene.unlockCondition;
    if (condition === "always") {
      unlocked.add(scene.sceneId);
    } else if (condition.kind === "manual") {
      if (manual.has(scene.sceneId)) unlocked.add(scene.sceneId);
    } else if (condition.kind === "questComplete") {
      if (
        quests.has(condition.questDefinitionId) ||
        manual.has(scene.sceneId)
      ) {
        unlocked.add(scene.sceneId);
      }
    } else {
      const unlockAt = Date.parse(condition.unlockAtIso);
      if (
        (Number.isFinite(unlockAt) && input.now >= unlockAt) ||
        manual.has(scene.sceneId)
      ) {
        unlocked.add(scene.sceneId);
      }
    }
  }
  return unlocked;
}

/**
 * Plan 058 §058.4 — pick the Scene the runtime boots into.
 * Precedence: the requested Scene (saved `currentSceneId`, or
 * Studio Preview's ambient selection) IF it is unlocked; else the
 * first unlocked Scene by order; else the first Scene outright (a
 * project whose every Scene is locked still has to boot — authors
 * lock Scene 1 by accident, players shouldn't hit a black screen).
 */
export function resolveActiveScene(input: {
  scenes: readonly Scene[];
  unlockedSceneIds: ReadonlySet<string>;
  requestedSceneId: string | null;
}): Scene | null {
  const ordered = [...input.scenes].sort(
    (left, right) => left.sceneOrder - right.sceneOrder
  );
  const requested = ordered.find(
    (scene) =>
      scene.sceneId === input.requestedSceneId &&
      input.unlockedSceneIds.has(scene.sceneId)
  );
  return (
    requested ??
    ordered.find((scene) => input.unlockedSceneIds.has(scene.sceneId)) ??
    ordered[0] ??
    null
  );
}

/**
 * Normalize a project's `scenes` array. Drops malformed entries,
 * dedupes by sceneId (first wins), and sorts by `sceneOrder` so
 * every consumer sees a stable narrative sequence.
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
  return scenes.sort((left, right) => left.sceneOrder - right.sceneOrder);
}
