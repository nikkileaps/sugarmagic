import type { DocumentIdentity } from "../shared/identity";
import { createScopedId, createUuid } from "../shared/identity";
import type {
  LandscapeSurfaceSlot,
  ShaderReference,
  SurfaceBinding
} from "../surface";
import { createDefaultSurface, createInlineSurfaceBinding } from "../surface";
import type {
  ShaderBindingOverride,
  ShaderParameterOverride
} from "../shader-graph";
import { cloneAssetCollider, type AssetCollider } from "../content-library";

export interface RegionPlacement {
  gridPosition: {
    x: number;
    y: number;
  };
  placementPolicy: "world-grid";
}

export interface RegionSceneFolder {
  folderId: string;
  displayName: string;
  parentFolderId: string | null;
}

/**
 * Per-MATERIAL-slot surface override on one placed instance
 * (Plan 068.1). Keyed by the mesh's material slot name (the same key
 * the definition's `surfaceSlots` use); an entry beats the
 * definition's slot surface for this instance only. Slots without an
 * entry fall through to the definition.
 */
export interface PlacedAssetSurfaceSlotOverride {
  slotName: string;
  surface: SurfaceBinding<"universal">;
}

export interface PlacedAssetInstance {
  instanceId: string;
  assetDefinitionId: string;
  displayName: string;
  parentFolderId: string | null;
  inspectable: RegionInspectableBehavior | null;
  shaderOverrides?: ShaderBindingOverride[];
  /** Plan 068.1 — per-material-slot surface overrides; see the type. */
  surfaceSlotOverrides?: PlacedAssetSurfaceSlotOverride[];
  /**
   * Plan 069.6 — per-instance collider override. Beats the asset
   * definition's collider (069.1) for this placement only: `shape: "none"`
   * marks a walk-on/non-blocking prop; a set `localBounds` resizes/offsets
   * the box. Absent => inherit the definition. Scene-scoped restyles live in
   * `SceneAssetAppearanceOverride.colliderOverride`; resolution precedence is
   * scene > instance > definition (see `resolveEffectiveInstanceCollider`).
   */
  colliderOverride?: AssetCollider;
  /**
   * @deprecated Legacy single-binding field. Normalization upgrades this into
   * shaderOverrides; new code should only use shaderOverrides.
   */
  shaderOverride?: ShaderBindingOverride | null;
  shaderParameterOverrides: ShaderParameterOverride[];
  /**
   * True when the instance was landed by the scatter brush (065.8).
   * The brush's erase mode only removes brushed instances, so a
   * swipe can never delete hand-placed props. Absent/undefined =
   * hand-placed = protected. Deliberately a data flag rather than
   * folder membership: dragging instances between folders must not
   * change their erasability.
   */
  brushed?: boolean;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}

export interface RegionSceneTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface RegionPlayerPresence {
  presenceId: string;
  transform: RegionSceneTransform;
}

export interface RegionNPCPresence {
  presenceId: string;
  npcDefinitionId: string;
  shaderOverrides?: ShaderBindingOverride[];
  /** @deprecated Legacy single-binding field. */
  shaderOverride?: ShaderBindingOverride | null;
  shaderParameterOverrides: ShaderParameterOverride[];
  transform: RegionSceneTransform;
}

export interface RegionItemPresence {
  presenceId: string;
  itemDefinitionId: string;
  quantity: number;
  shaderOverrides?: ShaderBindingOverride[];
  /** @deprecated Legacy single-binding field. */
  shaderOverride?: ShaderBindingOverride | null;
  shaderParameterOverrides: ShaderParameterOverride[];
  transform: RegionSceneTransform;
}

export interface RegionInspectableBehavior {
  behaviorId: string;
  documentDefinitionId: string;
  promptText?: string;
}

export interface RegionEnvironmentBinding {
  defaultEnvironmentId: string | null;
}

export interface RegionLandscapePaintPayload {
  version: 1;
  resolution: number;
  layers: string[];
}

export interface RegionLandscapeState {
  enabled: boolean;
  size: number;
  subdivisions: number;
  surfaceSlots: LandscapeSurfaceSlot[];
  deform: ShaderReference | null;
  effect: ShaderReference | null;
  paintPayload: RegionLandscapePaintPayload | null;
}

export interface RegionMarker {
  markerId: string;
  kind: string;
  position: [number, number, number];
}

export interface RegionGameplayPlacement {
  placementId: string;
  placementKind: "npc" | "trigger" | "pickup" | "inspectable" | "vfx-spawn";
  definitionId: string;
}

export type RegionAudioTrigger =
  | "always"
  | "on-enter"
  | "random-interval"
  | "scripted";

export interface RegionSoundEmitter {
  emitterId: string;
  displayName: string;
  cueDefinitionId: string | null;
  position: [number, number, number];
  radius: number;
  trigger: RegionAudioTrigger;
  enabled: boolean;
}

export interface RegionAmbienceZone {
  zoneId: string;
  displayName: string;
  cueDefinitionId: string | null;
  center: [number, number, number];
  size: [number, number, number];
  trigger: "on-enter" | "always";
  enabled: boolean;
}

export interface RegionAudioState {
  emitters: RegionSoundEmitter[];
  ambienceZones: RegionAmbienceZone[];
}

export type RegionAreaKind =
  | "zone"
  | "interior"
  | "exterior"
  | "room"
  | "stall"
  | "platform"
  | "shop";

export interface RegionAreaBounds {
  kind: "box";
  center: [number, number, number];
  size: [number, number, number];
}

export interface RegionAreaDefinition {
  areaId: string;
  displayName: string;
  lorePageId: string | null;
  parentAreaId: string | null;
  kind: RegionAreaKind;
  bounds: RegionAreaBounds;
}

export interface RegionBehaviorQuestBinding {
  questDefinitionId: string | null;
  questStageId: string | null;
  worldFlagEquals: RegionBehaviorWorldFlagCondition | null;
}

export interface RegionBehaviorWorldFlagCondition {
  key: string | null;
  valueType: "boolean" | "number" | "string";
  value: string | null;
}

// ---------------------------------------------------------------------------
// Plan 069.4 — unified drawn Volume. ONE box primitive with attachable
// roles, subsuming RegionAreaDefinition (label role) and RegionAmbienceZone
// (trigger role). Areas/ambience zones remain as `@deprecated` aliases
// derived from volumes (see the migration + derive helpers below). Only
// `label` + `trigger` roles are produced by migration; the physical roles
// (blocker / containment-boundary / nav-bounds / non-walkable) are authored
// in 069.5 / 069.7. Keep `volumeId` identical to the old areaId/zoneId so
// references (targetAreaId, parentAreaId, quest bindings) still resolve.
// ---------------------------------------------------------------------------

export type RegionVolumeRole =
  | "label"
  | "trigger"
  | "blocker"
  | "containment-boundary"
  | "nav-bounds"
  | "non-walkable";

export type RegionVolumeBlockDirection = "in" | "out" | "both";

export type RegionVolumeTriggerTiming = "on-enter" | "always";

/** Flag written when a trigger fires (069.5); null for migrated ambience
 *  triggers (which only played audio). Same shape as the flag condition. */
export interface RegionVolumeFlagAssignment {
  key: string | null;
  valueType: "boolean" | "number" | "string";
  value: string | null;
}

/** What firing a trigger DOES: an audio cue and/or a world-flag set. */
export interface RegionVolumeTriggerAction {
  audioCueId: string | null;
  setWorldFlag: RegionVolumeFlagAssignment | null;
}

export interface RegionVolumeTriggerConfig {
  timing: RegionVolumeTriggerTiming;
  action: RegionVolumeTriggerAction;
}

export interface RegionVolumeDefinition {
  volumeId: string;
  displayName: string;
  parentVolumeId: string | null;
  enabled: boolean;
  bounds: RegionAreaBounds;
  roles: RegionVolumeRole[];
  // --- role config (null / absent unless the corresponding role present) --
  /** `label` role: the semantic kind + lore (from RegionAreaDefinition). */
  labelKind: RegionAreaKind | null;
  lorePageId: string | null;
  /** `blocker` / `containment-boundary` role: which crossing directions
   *  block, and (for containment) the condition under which it opens. */
  blockDirection: RegionVolumeBlockDirection | null;
  condition: RegionBehaviorQuestBinding | null;
  /** `trigger` role (from RegionAmbienceZone). */
  trigger: RegionVolumeTriggerConfig | null;
  /** `non-walkable` / cost role: extra nav path cost. */
  navCost: number | null;
  /** Plan 069.8 QoL — authoring-only viewport tint (hex, e.g. "#f38ba8") so
   *  authors can tell volumes apart in the Spatial overlay. `null` = the
   *  default blue. The runtime ignores it. */
  color: string | null;
}

export interface RegionNPCBehaviorTask {
  taskId: string;
  displayName: string;
  description: string | null;
  targetAreaId: string | null;
  currentActivity: string;
  currentGoal: string;
  activation: RegionBehaviorQuestBinding;
}

export const REGION_NPC_BEHAVIOR_ACTIVITY_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "waiting", label: "Waiting" },
  { value: "walking", label: "Walking" },
  { value: "collecting_delivery", label: "Collecting Delivery" },
  { value: "unpacking_inventory", label: "Unpacking Inventory" },
  { value: "running_shop", label: "Running Shop" },
  { value: "serving_customers", label: "Serving Customers" },
  { value: "helping_player", label: "Helping Player" },
  { value: "searching", label: "Searching" },
  { value: "observing", label: "Observing" }
] as const;

export const REGION_NPC_BEHAVIOR_GOAL_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "wait_for_delivery", label: "Wait for Delivery" },
  { value: "collect_delivery", label: "Collect Delivery" },
  { value: "stock_shop", label: "Stock Shop" },
  { value: "serve_customers", label: "Serve Customers" },
  { value: "help_player", label: "Help Player" },
  { value: "search_area", label: "Search Area" },
  { value: "return_to_shop", label: "Return to Shop" },
  { value: "observe_situation", label: "Observe Situation" }
] as const;

export interface RegionNPCBehaviorDefinition {
  behaviorId: string;
  npcDefinitionId: string;
  displayName: string;
  tasks: RegionNPCBehaviorTask[];
}

/**
 * Plan 058 §058.1 — the region is the BASE of the Base + Overlay
 * split. Geography (placement, landscape, areas) plus the
 * always-visible placed assets and the folders that group them.
 * Presences (items, NPCs, player) and Scene-scoped decoration
 * live on `Scene.regionOverlays[regionId]` in the GameProject —
 * a region document no longer carries narrative content.
 *
 * The pre-058 `scene` nest ({folders, placedAssets,
 * playerPresence, npcPresences, itemPresences}) is gone from the
 * type; `normalizeRegionDocumentForLoad` + `migrateToScenes`
 * accept the legacy shape on disk and lift it into this shape +
 * the project's default Scene.
 */
/**
 * Plan 069.8 — a baked navmesh artifact reference on the region. The binary
 * lives at `assetPath` (an `assets/…` file); the doc only points at it. It is
 * NOT a player-save (`GameSavePayload`) slice — it's derived, rebakeable
 * content — but it DOES persist in the authored region document, and
 * `collectFileBackedAssetPaths` deliberately includes `assetPath` so deploy
 * ships the `.bin` and reload restores this pointer (fix 7cc3005). Do NOT strip
 * it on save. Staleness is `inputHash` vs a freshly-derived hash of the
 * collider + nav-volume inputs.
 */
export interface RegionNavMeshArtifact {
  assetPath: string;
  inputHash: string;
  agentRadius: number;
  /** DEFERRED SEAM (069.10): the bake composes ONE Scene's overlay (scene
   *  collider overrides / scene-contained placements), but the artifact is
   *  region-global — playing a different Scene paths against this Scene's
   *  obstacle set. Recorded so a future per-Scene bake (or a runtime
   *  mismatch warning) has the provenance. Null/absent = base-only or
   *  pre-069.10 bake. Revisit trigger: a Scene meaningfully changes
   *  collision geometry (adds/removes walls) and NPCs path wrong there. */
  sceneId?: string | null;
}

export interface RegionDocument {
  identity: DocumentIdentity;
  displayName: string;
  lorePageId?: string | null;
  placement: RegionPlacement;
  /** Base-scope placed assets — always visible in every Scene. */
  placedAssets: PlacedAssetInstance[];
  /** Folder tree grouping the base-scope placed assets. */
  folders: RegionSceneFolder[];
  environmentBinding: RegionEnvironmentBinding;
  /**
   * @deprecated Plan 069.4 — derived alias of the `label`-role volumes.
   * The canonical store is `volumes`; `normalizeRegionDocumentForLoad` and
   * the area command executors re-derive this so legacy readers keep
   * working. New code should read `volumes`.
   */
  areas: RegionAreaDefinition[];
  /** Plan 069.4 — canonical unified drawn volumes (label / trigger /
   *  blocker / containment / nav). Absent in pre-069.4 files; the loader
   *  migrates areas + ambience zones into it. */
  volumes?: RegionVolumeDefinition[];
  behaviors: RegionNPCBehaviorDefinition[];
  landscape: RegionLandscapeState;
  audio?: RegionAudioState;
  markers: RegionMarker[];
  gameplayPlacements: RegionGameplayPlacement[];
  /** Plan 069.8 — the baked navmesh artifact reference. NOT a player-save
   *  (`GameSavePayload`) slice, but it DOES persist in this region document
   *  (so deploy/reload restore it — see `RegionNavMeshArtifact`). Null/absent
   *  = not baked. `inputHash` drives the staleness warning. */
  navMesh?: RegionNavMeshArtifact | null;
  /**
   * Plan 065 §065.1 — Layout Sketch: authoring-only blockout ink
   * drawn on the landscape plane in Studio. The RUNTIME NEVER
   * reads this (preview is the game; planning ink is not content).
   * Lives at region level, NOT inside `landscape`, so sketch
   * commits keep the `landscape` reference stable and skip the
   * render mesh's expensive re-apply path.
   */
  layoutSketch?: RegionLayoutSketchState | null;
}

/** Plan 065 §065.1 — persisted Layout Sketch payload. */
export interface RegionLayoutSketchState {
  /** Ink bitmap as a PNG data URL; null when nothing is drawn. */
  ink: string | null;
  /** Optional reference underlay image as a data URL. */
  referenceImage: string | null;
  /** Reference underlay opacity, 0..1. */
  referenceOpacity: number;
}

export function createRegionLayoutSketchState(
  overrides: Partial<RegionLayoutSketchState> = {}
): RegionLayoutSketchState {
  return {
    ink: overrides.ink ?? null,
    referenceImage: overrides.referenceImage ?? null,
    referenceOpacity:
      typeof overrides.referenceOpacity === "number"
        ? Math.max(0, Math.min(1, overrides.referenceOpacity))
        : 0.4
  };
}

export const DEFAULT_REGION_LANDSCAPE_SIZE = 100;
export const DEFAULT_REGION_LANDSCAPE_SUBDIVISIONS = 160;
export const DEFAULT_REGION_LANDSCAPE_RESOLUTION = 512;
/**
 * Editor-wide "neutral clay" tone. Single source for anywhere the
 * authoring tools want a warm neutral placeholder color — unpainted
 * landscape, unshaded fallback meshes, etc. Fiddle with this one value
 * to retune the whole editor's default look.
 */
export const EDITOR_NEUTRAL_CLAY_COLOR = 0xc9c4bd;

export const DEFAULT_REGION_LANDSCAPE_BASE_COLOR = EDITOR_NEUTRAL_CLAY_COLOR;
export const DEFAULT_REGION_LANDSCAPE_GRASS_COLOR = 0x5c8a5a;

export const LANDSCAPE_BASE_CHANNEL_ID = "base";
export const LANDSCAPE_DEFAULT_CHANNEL_ID = "grass";
export const MAX_REGION_LANDSCAPE_CHANNELS = 8;
export const DEFAULT_REGION_AREA_HEIGHT = 12;

export function createRegionAreaId(): string {
  return createScopedId("region-area");
}

export function createRegionNPCBehaviorId(): string {
  return createScopedId("region-behavior");
}

function createPlacedAssetInstanceIdValue(): string {
  return createScopedId("placed-asset");
}

function createSceneFolderIdValue(): string {
  return createScopedId("scene-folder");
}

export function createRegionNPCBehaviorTaskId(): string {
  return createScopedId("region-behavior-task");
}

export function createRegionAreaBounds(
  overrides: Partial<RegionAreaBounds> = {}
): RegionAreaBounds {
  return {
    kind: "box",
    center: overrides.center ?? [0, DEFAULT_REGION_AREA_HEIGHT / 2, 0],
    size: overrides.size ?? [4, DEFAULT_REGION_AREA_HEIGHT, 4]
  };
}

export function createRegionAreaDefinition(
  overrides: Partial<RegionAreaDefinition> = {}
): RegionAreaDefinition {
  return {
    areaId: overrides.areaId ?? createRegionAreaId(),
    displayName: overrides.displayName ?? "Area",
    lorePageId:
      overrides.lorePageId === undefined ? null : overrides.lorePageId,
    parentAreaId:
      overrides.parentAreaId === undefined ? null : overrides.parentAreaId,
    kind: overrides.kind ?? "zone",
    bounds: createRegionAreaBounds(overrides.bounds)
  };
}

// --- Plan 069.4 — unified Volume factory + migration/alias helpers --------

export function createRegionVolumeId(): string {
  return createUuid();
}

export function createRegionVolumeDefinition(
  overrides: Partial<RegionVolumeDefinition> = {}
): RegionVolumeDefinition {
  const roles = overrides.roles ? [...overrides.roles] : [];
  // The interface invariant: role config is null unless the role is present.
  // Enforced HERE (the single volume constructor — UpdateRegionVolume routes
  // through it) so unchecking a role can't leave orphaned config behind.
  const hasLabel = roles.includes("label");
  const blocksAnything =
    roles.includes("blocker") || roles.includes("containment-boundary");
  return {
    volumeId: overrides.volumeId ?? createRegionVolumeId(),
    displayName: overrides.displayName ?? "Volume",
    parentVolumeId:
      overrides.parentVolumeId === undefined ? null : overrides.parentVolumeId,
    enabled: overrides.enabled ?? true,
    bounds: createRegionAreaBounds(overrides.bounds),
    roles,
    labelKind: hasLabel ? overrides.labelKind ?? null : null,
    lorePageId: hasLabel ? overrides.lorePageId ?? null : null,
    blockDirection: blocksAnything ? overrides.blockDirection ?? null : null,
    condition: blocksAnything ? overrides.condition ?? null : null,
    trigger: roles.includes("trigger") ? overrides.trigger ?? null : null,
    navCost: roles.includes("non-walkable") ? overrides.navCost ?? null : null,
    color: overrides.color ?? null
  };
}

/** RegionAreaDefinition -> label-role Volume (id preserved). */
export function regionAreaToVolume(
  area: RegionAreaDefinition
): RegionVolumeDefinition {
  return createRegionVolumeDefinition({
    volumeId: area.areaId,
    displayName: area.displayName,
    parentVolumeId: area.parentAreaId,
    bounds: area.bounds,
    roles: ["label"],
    labelKind: area.kind,
    lorePageId: area.lorePageId
  });
}

/** RegionAmbienceZone -> trigger-role Volume (id preserved). */
export function regionAmbienceZoneToVolume(
  zone: RegionAmbienceZone
): RegionVolumeDefinition {
  return createRegionVolumeDefinition({
    volumeId: zone.zoneId,
    displayName: zone.displayName,
    enabled: zone.enabled,
    bounds: { kind: "box", center: zone.center, size: zone.size },
    roles: ["trigger"],
    trigger: {
      timing: zone.trigger,
      action: { audioCueId: zone.cueDefinitionId, setWorldFlag: null }
    }
  });
}

/** Derived `@deprecated` area alias — null unless the volume has the label
 *  role. */
export function volumeToRegionArea(
  volume: RegionVolumeDefinition
): RegionAreaDefinition | null {
  if (!volume.roles.includes("label")) {
    return null;
  }
  return {
    areaId: volume.volumeId,
    displayName: volume.displayName,
    lorePageId: volume.lorePageId,
    parentAreaId: volume.parentVolumeId,
    kind: volume.labelKind ?? "zone",
    bounds: volume.bounds
  };
}

/** Derived `@deprecated` ambience-zone alias — null unless trigger role. */
export function volumeToRegionAmbienceZone(
  volume: RegionVolumeDefinition
): RegionAmbienceZone | null {
  if (!volume.roles.includes("trigger") || !volume.trigger) {
    return null;
  }
  return {
    zoneId: volume.volumeId,
    displayName: volume.displayName,
    cueDefinitionId: volume.trigger.action.audioCueId,
    center: volume.bounds.center,
    size: volume.bounds.size,
    trigger: volume.trigger.timing,
    enabled: volume.enabled
  };
}

export function deriveRegionAreasFromVolumes(
  volumes: readonly RegionVolumeDefinition[]
): RegionAreaDefinition[] {
  return volumes
    .map(volumeToRegionArea)
    .filter((area): area is RegionAreaDefinition => area !== null);
}

export function deriveRegionAmbienceZonesFromVolumes(
  volumes: readonly RegionVolumeDefinition[]
): RegionAmbienceZone[] {
  return volumes
    .map(volumeToRegionAmbienceZone)
    .filter((zone): zone is RegionAmbienceZone => zone !== null);
}

/** Build volumes from the legacy area + ambience-zone stores (pre-069.4). */
export function migrateRegionVolumesFromLegacy(
  areas: readonly RegionAreaDefinition[],
  ambienceZones: readonly RegionAmbienceZone[]
): RegionVolumeDefinition[] {
  return [
    ...areas.map(regionAreaToVolume),
    ...ambienceZones.map(regionAmbienceZoneToVolume)
  ];
}

/** The canonical volume list for a region: the stored `volumes` when
 *  present (post-069.4), else migrated from the legacy area/ambience
 *  stores. */
export function resolveRegionVolumes(
  region: RegionDocument
): RegionVolumeDefinition[] {
  if (Array.isArray(region.volumes)) {
    return region.volumes.map((volume) =>
      createRegionVolumeDefinition(volume)
    );
  }
  return migrateRegionVolumesFromLegacy(
    region.areas ?? [],
    region.audio?.ambienceZones ?? []
  );
}

/** Return a region with canonical `volumes` set and the `@deprecated`
 *  area/ambience aliases re-derived. Plan 069.4 — command executors call
 *  this because commands do NOT re-normalize, and live in-session readers
 *  consume the aliases between saves. */
export function withDerivedRegionAliases(
  region: RegionDocument,
  volumes: RegionVolumeDefinition[]
): RegionDocument {
  const ambienceZones = deriveRegionAmbienceZonesFromVolumes(volumes);
  // Preserve any existing audio (emitters); create it only when a trigger
  // volume needs an ambience alias and there's no audio state yet.
  const audio = region.audio
    ? { ...region.audio, ambienceZones }
    : ambienceZones.length > 0
      ? { emitters: [], ambienceZones }
      : region.audio;
  return {
    ...region,
    volumes,
    areas: deriveRegionAreasFromVolumes(volumes),
    audio
  };
}

/** Reconcile the canonical volumes so their `label`-role set matches
 *  `nextAreas` (add / update / drop), preserving every non-label volume
 *  and any extra roles on a label volume. Plan 069.4 — the area command
 *  executors compute their intended `areas` list and route it through
 *  here so `volumes` stays the source of truth. */
export function reconcileRegionVolumesFromAreas(
  region: RegionDocument,
  nextAreas: readonly RegionAreaDefinition[]
): RegionDocument {
  const canonical = resolveRegionVolumes(region);
  const nextById = new Map(nextAreas.map((area) => [area.areaId, area]));
  const seen = new Set<string>();
  const volumes: RegionVolumeDefinition[] = [];
  for (const volume of canonical) {
    if (!volume.roles.includes("label")) {
      volumes.push(volume);
      continue;
    }
    const area = nextById.get(volume.volumeId);
    if (!area) {
      // Area deleted: drop the label role (+ its config); keep the volume
      // only if other roles remain.
      const remaining = volume.roles.filter((role) => role !== "label");
      if (remaining.length > 0) {
        volumes.push({
          ...volume,
          roles: remaining,
          labelKind: null,
          lorePageId: null
        });
      }
      continue;
    }
    seen.add(area.areaId);
    volumes.push({
      ...volume,
      displayName: area.displayName,
      parentVolumeId: area.parentAreaId,
      bounds: area.bounds,
      labelKind: area.kind,
      lorePageId: area.lorePageId
    });
  }
  for (const area of nextAreas) {
    if (!seen.has(area.areaId)) {
      volumes.push(regionAreaToVolume(area));
    }
  }
  return withDerivedRegionAliases(region, volumes);
}

/** As `reconcileRegionVolumesFromAreas`, but for the `trigger`-role set
 *  driven by the ambience-zone command executors. */
export function reconcileRegionVolumesFromAmbienceZones(
  region: RegionDocument,
  nextZones: readonly RegionAmbienceZone[]
): RegionDocument {
  const canonical = resolveRegionVolumes(region);
  const nextById = new Map(nextZones.map((zone) => [zone.zoneId, zone]));
  const seen = new Set<string>();
  const volumes: RegionVolumeDefinition[] = [];
  for (const volume of canonical) {
    if (!volume.roles.includes("trigger")) {
      volumes.push(volume);
      continue;
    }
    const zone = nextById.get(volume.volumeId);
    if (!zone) {
      const remaining = volume.roles.filter((role) => role !== "trigger");
      if (remaining.length > 0) {
        volumes.push({ ...volume, roles: remaining, trigger: null });
      }
      continue;
    }
    seen.add(zone.zoneId);
    volumes.push({
      ...volume,
      displayName: zone.displayName,
      enabled: zone.enabled,
      bounds: { kind: "box", center: zone.center, size: zone.size },
      trigger: {
        timing: zone.trigger,
        action: {
          audioCueId: zone.cueDefinitionId,
          setWorldFlag: volume.trigger?.action.setWorldFlag ?? null
        }
      }
    });
  }
  for (const zone of nextZones) {
    if (!seen.has(zone.zoneId)) {
      volumes.push(regionAmbienceZoneToVolume(zone));
    }
  }
  return withDerivedRegionAliases(region, volumes);
}

export function createRegionBehaviorQuestBinding(
  overrides: Partial<RegionBehaviorQuestBinding> = {}
): RegionBehaviorQuestBinding {
  return {
    questDefinitionId:
      typeof overrides.questDefinitionId === "string" &&
      overrides.questDefinitionId.trim().length > 0
        ? overrides.questDefinitionId.trim()
        : null,
    questStageId:
      typeof overrides.questStageId === "string" &&
      overrides.questStageId.trim().length > 0
        ? overrides.questStageId.trim()
        : null,
    worldFlagEquals:
      typeof overrides.worldFlagEquals?.key === "string" &&
      overrides.worldFlagEquals.key.trim().length > 0
        ? {
            key: overrides.worldFlagEquals.key.trim(),
            valueType: overrides.worldFlagEquals.valueType ?? "boolean",
            value:
              typeof overrides.worldFlagEquals.value === "string" &&
              overrides.worldFlagEquals.value.trim().length > 0
                ? overrides.worldFlagEquals.value.trim()
                : null
          }
        : null
  };
}

export function createRegionNPCBehaviorTask(
  overrides: Partial<RegionNPCBehaviorTask> = {}
): RegionNPCBehaviorTask {
  return {
    taskId: overrides.taskId ?? createRegionNPCBehaviorTaskId(),
    displayName: overrides.displayName ?? "Behavior Task",
    description:
      typeof overrides.description === "string" &&
      overrides.description.trim().length > 0
        ? overrides.description
        : null,
    targetAreaId:
      typeof overrides.targetAreaId === "string" &&
      overrides.targetAreaId.trim().length > 0
        ? overrides.targetAreaId.trim()
        : null,
    currentActivity:
      typeof overrides.currentActivity === "string" &&
      overrides.currentActivity.trim().length > 0
        ? overrides.currentActivity.trim()
        : "idle",
    currentGoal:
      typeof overrides.currentGoal === "string" &&
      overrides.currentGoal.trim().length > 0
        ? overrides.currentGoal.trim()
        : "idle",
    activation: createRegionBehaviorQuestBinding(overrides.activation)
  };
}

export function createRegionNPCBehaviorDefinition(
  overrides: Partial<RegionNPCBehaviorDefinition> &
    Pick<RegionNPCBehaviorDefinition, "npcDefinitionId">
): RegionNPCBehaviorDefinition {
  return {
    behaviorId: overrides.behaviorId ?? createRegionNPCBehaviorId(),
    npcDefinitionId: overrides.npcDefinitionId,
    displayName: overrides.displayName ?? "NPC Behavior",
    tasks: (overrides.tasks ?? []).map((task) =>
      createRegionNPCBehaviorTask(task)
    )
  };
}

export function createLandscapeChannelId(): string {
  return createScopedId("landscape-channel");
}

export function createPlacedAssetInstance(
  overrides: Partial<PlacedAssetInstance> &
    Pick<PlacedAssetInstance, "assetDefinitionId">
): PlacedAssetInstance {
  return {
    instanceId: overrides.instanceId ?? createPlacedAssetInstanceIdValue(),
    assetDefinitionId: overrides.assetDefinitionId,
    displayName: overrides.displayName ?? "Placed Asset",
    parentFolderId: overrides.parentFolderId ?? null,
    inspectable: overrides.inspectable ?? null,
    shaderOverrides: [...(overrides.shaderOverrides ?? [])],
    surfaceSlotOverrides: overrides.surfaceSlotOverrides
      ? overrides.surfaceSlotOverrides.map((slotOverride) => ({ ...slotOverride }))
      : undefined,
    colliderOverride: overrides.colliderOverride
      ? cloneAssetCollider(overrides.colliderOverride)
      : undefined,
    shaderOverride: undefined,
    shaderParameterOverrides: [...(overrides.shaderParameterOverrides ?? [])],
    transform: {
      position: overrides.transform?.position ?? [0, 0, 0],
      rotation: overrides.transform?.rotation ?? [0, 0, 0],
      scale: overrides.transform?.scale ?? [1, 1, 1]
    }
  };
}

export function createRegionSceneTransform(
  overrides: Partial<RegionSceneTransform> = {}
): RegionSceneTransform {
  return {
    position: overrides.position ?? [0, 0, 0],
    rotation: overrides.rotation ?? [0, 0, 0],
    scale: overrides.scale ?? [1, 1, 1]
  };
}

export function createPlayerPresenceId(): string {
  return createUuid();
}

export function createNPCPresenceId(): string {
  return createUuid();
}

export function createItemPresenceId(): string {
  return createUuid();
}

export function createInspectableBehaviorId(): string {
  return createUuid();
}

export function createRegionSoundEmitterId(): string {
  return createUuid();
}

export function createRegionAmbienceZoneId(): string {
  return createUuid();
}

export function createRegionSoundEmitter(
  overrides: Partial<RegionSoundEmitter> = {}
): RegionSoundEmitter {
  return {
    emitterId: overrides.emitterId ?? createRegionSoundEmitterId(),
    displayName: overrides.displayName ?? "Sound Emitter",
    cueDefinitionId: overrides.cueDefinitionId ?? null,
    position: overrides.position ?? [0, 0, 0],
    radius: Math.max(0.1, overrides.radius ?? 8),
    trigger: overrides.trigger ?? "always",
    enabled: overrides.enabled ?? true
  };
}

export function createRegionAmbienceZone(
  overrides: Partial<RegionAmbienceZone> = {}
): RegionAmbienceZone {
  return {
    zoneId: overrides.zoneId ?? createRegionAmbienceZoneId(),
    displayName: overrides.displayName ?? "Ambience Zone",
    cueDefinitionId: overrides.cueDefinitionId ?? null,
    center: overrides.center ?? [0, DEFAULT_REGION_AREA_HEIGHT / 2, 0],
    size: overrides.size ?? [12, DEFAULT_REGION_AREA_HEIGHT, 12],
    trigger: overrides.trigger ?? "on-enter",
    enabled: overrides.enabled ?? true
  };
}

export function createRegionAudioState(
  overrides: Partial<RegionAudioState> = {}
): RegionAudioState {
  return {
    emitters: (overrides.emitters ?? []).map((emitter) =>
      createRegionSoundEmitter(emitter)
    ),
    ambienceZones: (overrides.ambienceZones ?? []).map((zone) =>
      createRegionAmbienceZone(zone)
    )
  };
}

export function createRegionPlayerPresence(
  overrides: Partial<RegionPlayerPresence> = {}
): RegionPlayerPresence {
  return {
    presenceId: overrides.presenceId ?? createPlayerPresenceId(),
    transform: createRegionSceneTransform(overrides.transform)
  };
}

export function createRegionNPCPresence(
  overrides: Partial<RegionNPCPresence> &
    Pick<RegionNPCPresence, "npcDefinitionId">
): RegionNPCPresence {
  return {
    presenceId: overrides.presenceId ?? createNPCPresenceId(),
    npcDefinitionId: overrides.npcDefinitionId,
    shaderOverrides: [...(overrides.shaderOverrides ?? [])],
    shaderOverride: undefined,
    shaderParameterOverrides: [...(overrides.shaderParameterOverrides ?? [])],
    transform: createRegionSceneTransform(overrides.transform)
  };
}

export function createRegionItemPresence(
  overrides: Partial<RegionItemPresence> &
    Pick<RegionItemPresence, "itemDefinitionId">
): RegionItemPresence {
  return {
    presenceId: overrides.presenceId ?? createItemPresenceId(),
    itemDefinitionId: overrides.itemDefinitionId,
    quantity: Math.max(1, Math.floor(overrides.quantity ?? 1)),
    shaderOverrides: [...(overrides.shaderOverrides ?? [])],
    shaderOverride: undefined,
    shaderParameterOverrides: [...(overrides.shaderParameterOverrides ?? [])],
    transform: createRegionSceneTransform(overrides.transform)
  };
}

export function createLandscapeSurfaceSlot(
  overrides: Partial<LandscapeSurfaceSlot> = {}
): LandscapeSurfaceSlot {
  return {
    channelId: overrides.channelId ?? createLandscapeChannelId(),
    displayName: overrides.displayName ?? "Channel",
    slotName: overrides.slotName ?? overrides.displayName ?? "Channel",
    surface:
      overrides.surface ??
      createInlineSurfaceBinding(
        createDefaultSurface(DEFAULT_REGION_LANDSCAPE_GRASS_COLOR)
      ),
    tilingScale:
      overrides.tilingScale === undefined ? null : overrides.tilingScale
  };
}

export function createDefaultRegionLandscapeSurfaceSlots(
  baseColor = DEFAULT_REGION_LANDSCAPE_BASE_COLOR
): LandscapeSurfaceSlot[] {
  // New landscapes start with just the Base channel so the ground reads as
  // a clean clay canvas. Authors add additional channels (grass, sand,
  // etc.) explicitly from the landscape inspector when they need them —
  // the old auto-included "Grass" channel was initializing with a black
  // color swatch on new regions and making the default viewport look
  // broken.
  return [
    {
      channelId: LANDSCAPE_BASE_CHANNEL_ID,
      displayName: "Base",
      slotName: "Base",
      surface: createInlineSurfaceBinding(createDefaultSurface(baseColor)),
      tilingScale: null
    }
  ];
}

export function createDefaultRegionLandscapeState(
  overrides: Partial<RegionLandscapeState> = {}
): RegionLandscapeState {
  const surfaceSlots =
    overrides.surfaceSlots && overrides.surfaceSlots.length > 0
      ? overrides.surfaceSlots.slice(0, MAX_REGION_LANDSCAPE_CHANNELS)
      : createDefaultRegionLandscapeSurfaceSlots();

  return {
    enabled: true,
    size: DEFAULT_REGION_LANDSCAPE_SIZE,
    subdivisions: DEFAULT_REGION_LANDSCAPE_SUBDIVISIONS,
    ...overrides,
    surfaceSlots,
    deform: overrides.deform ?? null,
    effect: overrides.effect ?? null,
    paintPayload: overrides.paintPayload ?? null
  };
}

/**
 * Single factory for producing a blank-but-usable region document.
 *
 * Used by both the project bootstrap path (a new project creates a
 * "Default Region" automatically so every freshly-created project opens
 * into a usable scene) and the in-session "New Region" command. Keeping
 * the shape here means there's one place to change if the region schema's
 * default state evolves — no divergence between the two entry points.
 */
export function createDefaultRegion(options: {
  regionId: string;
  displayName: string;
  defaultEnvironmentId?: string | null;
}): RegionDocument {
  return {
    identity: { id: options.regionId, schema: "RegionDocument", version: 1 },
    displayName: options.displayName,
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: {
      defaultEnvironmentId: options.defaultEnvironmentId ?? null
    },
    areas: [],
    volumes: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState(),
    audio: createRegionAudioState(),
    markers: [],
    gameplayPlacements: [],
    navMesh: null
  };
}
