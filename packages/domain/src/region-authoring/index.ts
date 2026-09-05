import type { QuestActionDefinition, TimeOfDayBand } from "../quest-definition";
import { TIME_OF_DAY_BAND_OPTIONS, normalizeQuestAction } from "../quest-definition";
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

export type PlacedLightKind = "point" | "spot" | "area";

/** The cone of a `spot` light. Null on every other kind. */
export interface PlacedLightSpotConfig {
  /** Half-angle of the cone, in degrees. */
  angleDeg: number;
  /** How soft the cone's edge is, 0 (hard) to 1 (fully feathered). */
  penumbra: number;
  /** A content-library texture projected through the cone — a window
   *  frame, leaves, a lattice. Null projects nothing. */
  projectedTextureId: string | null;
}

/** The rectangle of an `area` light, in metres. Null on every other kind. */
export interface PlacedLightAreaConfig {
  width: number;
  height: number;
}

export type PlacedLightModulationKind = "steady" | "flame" | "candle" | "pulse";

/**
 * How a placed light varies over time: a closed set of named behaviors
 * sharing one set of numbers, rather than a curve editor or a node graph.
 *
 * The behavior is a pure function of elapsed time and `seed`, so two
 * candles in one room never flicker in step and nothing depends on frame
 * rate. No phase is persisted — a reload restarts the wobble, which is not
 * something a player can see.
 */
export interface PlacedLightModulation {
  kind: PlacedLightModulationKind;
  /** Base rate of the behavior, in cycles per second. */
  speed: number;
  /** How far intensity swings, as a fraction of the light's intensity. */
  amount: number;
  /** How far the color drifts along with the swing, 0 to 1. */
  colorWobble: number;
  /** This light's fixed offset into the behavior, 0 to 1. Two lights with
   *  the same settings and different seeds look independent. */
  seed: number;
}

/**
 * A light the author places in a region the way they place a prop: a
 * lantern, a fire in a hearth, a warm pool of sun through a window.
 *
 * The region's environment still owns the sun. A placed light adds to it
 * and never replaces it.
 *
 * Fields the kind does not use are null. `createPlacedLight` is what makes
 * that true — it is the only constructor, and it clamps every field to the
 * kind, so a point light holding a cone cannot be built.
 */
export interface PlacedLight {
  instanceId: string;
  kind: PlacedLightKind;
  displayName: string;
  parentFolderId: string | null;
  /**
   * Off is dark in Studio and in the shipped game. One state, not a
   * separate editor-only hide.
   *
   * A quest cannot light or snuff this. When a story beat needs to,
   * `RegionNPCPresence.condition` is the shape to follow, and the cost to
   * solve then is a frame hitch: adding a light to the three.js scene or
   * removing one recompiles every material, while changing its color or
   * intensity is free.
   */
  enabled: boolean;
  /** Hex, the same convention as the environment's `SunLight.color`. */
  color: number;
  /**
   * Point and spot lights are in candela; area lights are in nits. three.js
   * reads a different unit per light class, so one number means two things
   * and the Inspector labels it per kind rather than pretending otherwise.
   */
  intensity: number;
  /** How far the light reaches, in metres. Never zero -- three.js reads a
   *  distance of zero as no limit at all. Null for `area`, which genuinely
   *  has no reach cutoff. */
  radius: number | null;
  spot: PlacedLightSpotConfig | null;
  area: PlacedLightAreaConfig | null;
  modulation: PlacedLightModulation;
  transform: RegionSceneTransform;
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
  /** Plan 079.1 -- null means unconditional (always spawn). */
  condition: RegionBehaviorQuestBinding | null;
  /** Plan 079.6 -- author-supplied label for disambiguation in the quest stage picker.
   *  Null falls back to the NPC definition's displayName. */
  placementLabel: string | null;
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

/**
 * A named point in a region: where a door puts the player down and which
 * way they face, or the exact spot an NPC stands rather than somewhere
 * inside a box.
 *
 * [LAW:one-type-per-behavior] There is no `kind` tag. A marker is a named
 * place; what it MEANS comes from whoever references it, so tagging one
 * "arrival" and another "npc-spot" would be a mode with no behaviour
 * behind it.
 *
 * Carries a full transform rather than a bare position because facing is
 * half the point in both cases -- arriving through a door pointed at a
 * wall, or standing behind a counter looking away from it.
 */
export interface RegionMarker {
  markerId: string;
  displayName: string;
  transform: RegionSceneTransform;
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

export interface RegionAudioState {
  emitters: RegionSoundEmitter[];
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

/**
 * Which side of a story point this binding is on.
 *
 * "while" means the point is happening right now, and stops being true when
 * it finishes. "after" means the point has finished, and stays true from then
 * on -- including once the quest it belongs to is over.
 *
 * The two are back to back: "while the Introduction quest runs" ends at the
 * exact moment "ever since the Introduction quest finished" begins.
 */
export type StoryPointSide = "while" | "after";

/**
 * A point in the story, and which side of it.
 *
 * The point is the deepest of the three ids that is set: a quest, a stage
 * inside it, or a node inside that. Naming a stage or a node means naming the
 * quest as well, so the three read as one place.
 *
 * Evaluated wherever this grammar is: behavior tasks, NPC placements,
 * containment volumes.
 */
export interface RegionBehaviorQuestBinding {
  questDefinitionId: string | null;
  questStageId: string | null;
  /**
   * A node inside the named stage. Optional so a hand-written binding need
   * not carry it; the factory always normalizes it to a value.
   */
  questNodeId?: string | null;
  /**
   * Which side of the point. Ignored when no quest is named, since there is
   * then no point to be on a side of.
   */
  storyPointSide?: StoryPointSide;
  worldFlagEquals: RegionBehaviorWorldFlagCondition | null;
  /**
   * How a node was named before the point gained a side: always "the node has
   * been completed". Read on load and folded into `questNodeId` with
   * `storyPointSide: "after"`, then dropped.
   *
   * @deprecated Author `questNodeId` and `storyPointSide` instead.
   */
  nodeCompleted?: RegionBehaviorNodeCompletedCondition | null;
}

export interface RegionBehaviorNodeCompletedCondition {
  questDefinitionId: string;
  nodeId: string;
}

export interface RegionBehaviorWorldFlagCondition {
  /** References a WorldFlagDefinition; the runtime resolves it to that flag's name. */
  worldFlagId: string | null;
  valueType: "boolean" | "number" | "string";
  value: string | null;
}

// ---------------------------------------------------------------------------
// Plan 069.4 — unified drawn Volume. ONE box primitive with attachable
// roles, subsuming RegionAreaDefinition (label role). Areas remain as a
// `@deprecated` alias
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
  /**
   * What the volume DOES when the player crosses into it and back out.
   * The same action list a quest node runs, so every action gets the
   * editor and the runtime handler it already has.
   *
   * [LAW:one-type-per-behavior] This replaced a private trigger config
   * that could play one cue and set one flag. Two types described one
   * behaviour -- running actions -- and only one of them could reach the
   * pickers or the rest of the action set.
   *
   * An ambient bed is authored as a pair: `playCue` on enter, `stopCue`
   * on exit. Both resolve to one sounding instance because the runtime
   * keys it by the volume, not by the action.
   */
  onEnterActions: QuestActionDefinition[];
  onExitActions: QuestActionDefinition[];
  /** `non-walkable` / cost role: extra nav path cost. */
  navCost: number | null;
  /** Plan 069.8 QoL — authoring-only viewport tint (hex, e.g. "#f38ba8") so
   *  authors can tell volumes apart in the Spatial overlay. `null` = the
   *  default blue. The runtime ignores it. */
  color: string | null;
}

/**
 * Where a task sends the NPC.
 *
 * [LAW:types-are-the-program] One field with two shapes rather than an
 * areaId and a markerId that can both be set and disagree. An area
 * scatters the NPC to a hash-chosen point inside it, which is right for
 * "wander the market"; a marker is the one exact spot, which is right for
 * "stand behind the counter".
 */
export type RegionBehaviorTaskTarget =
  | { kind: "area"; areaId: string }
  | { kind: "marker"; markerId: string };

export interface RegionNPCBehaviorTask {
  taskId: string;
  displayName: string;
  description: string | null;
  target: RegionBehaviorTaskTarget | null;
  currentActivity: string;
  currentGoal: string;
  activation: RegionBehaviorQuestBinding;
  // When set, this task only applies while the current world.time-of-day band
  // is in the array. Null, absent or every band = any time. The window rules a
  // task out; it never lets a task outrank one tied to the story. See
  // `compareTaskSpecificity`.
  timeWindow?: { bands: TimeOfDayBand[] } | null;
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

// Plan 074 §074.4 -- time-of-day bands for task time-window authoring. The
// bands and their labels live beside the TimeOfDayBand type; this alias stays
// because the behavior editors import it by this name.
export const REGION_NPC_BEHAVIOR_TIME_BAND_OPTIONS = TIME_OF_DAY_BAND_OPTIONS;

export interface RegionNPCBehaviorDefinition {
  behaviorId: string;
  npcDefinitionId: string;
  displayName: string;
  tasks: RegionNPCBehaviorTask[];
}

/**
 * The region document is the world at rest: geography (placement,
 * landscape, areas), the placed assets and folders that dress it, how its
 * residents behave (`behaviors`), and — epic #226 — the residents
 * themselves (`npcPresences`, `itemPresences`, `playerPresence`). A Scene
 * overlay is a diff against this document; composing a region with no
 * Scene yields a populated place (ADR 003).
 *
 * The pre-058 `scene` nest ({folders, placedAssets, playerPresence,
 * npcPresences, itemPresences}) is gone from the type;
 * `normalizeRegionDocumentForLoad` + `migrateToScenes` accept the legacy
 * shape on disk and lift its presences into the project's default Scene.
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
/**
 * A baked navmesh and the inputs it was baked from.
 *
 * One artifact per COMPOSITION that actually differs. A region's is baked
 * from its resting state -- no Scene overlay -- and is both the free-roam
 * mesh and the default every Scene inherits. A Scene that changes what
 * blocks movement owns one of its own; a Scene that does not owns none,
 * and absence means "use the region's".
 *
 * There is no `sceneId` here. It used to record which Scene the bake
 * happened to compose, because the artifact was region-global and could
 * silently belong to the wrong Scene. Nothing ever read it. Now the
 * region's is baked with no Scene and a Scene's belongs to the Scene that
 * holds it, so the question the field answered cannot be asked.
 */
export interface RegionNavMeshArtifact {
  assetPath: string;
  inputHash: string;
  agentRadius: number;
}

export interface RegionDocument {
  identity: DocumentIdentity;
  displayName: string;
  lorePageId?: string | null;
  placement: RegionPlacement;
  /** Base-scope placed assets — always visible in every Scene. */
  placedAssets: PlacedAssetInstance[];
  /** Base-scope placed lights — always lit in every Scene. A Scene overlay
   *  adds its own or suppresses these; it never replaces the set. */
  placedLights: PlacedLight[];
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
  /** Epic #226 — the region's residents, composed whenever the region is,
   *  Scene or no Scene. A Scene overlay adds to or suppresses them; it
   *  never replaces the set. */
  npcPresences: RegionNPCPresence[];
  itemPresences: RegionItemPresence[];
  /** Where the player stands when no Scene supplies a player presence. */
  playerPresence: RegionPlayerPresence | null;
  landscape: RegionLandscapeState;
  audio?: RegionAudioState;
  markers: RegionMarker[];
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

function createPlacedLightIdValue(): string {
  return createScopedId("placed-light");
}

/** A fresh placed-light id, for a caller minting one before it has a light --
 *  a duplicate has to name its copy in the command. */
export function createPlacedLightId(): string {
  return createPlacedLightIdValue();
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
    // Through the binding factory like every other gate, so a condition
    // written before the story point had a side is read the same way here.
    condition:
      blocksAnything && overrides.condition
        ? createRegionBehaviorQuestBinding(overrides.condition)
        : null,
    onEnterActions: (overrides.onEnterActions ?? [])
      .map(normalizeQuestAction)
      .filter((action): action is QuestActionDefinition => action !== null),
    onExitActions: (overrides.onExitActions ?? [])
      .map(normalizeQuestAction)
      .filter((action): action is QuestActionDefinition => action !== null),
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

export function deriveRegionAreasFromVolumes(
  volumes: readonly RegionVolumeDefinition[]
): RegionAreaDefinition[] {
  return volumes
    .map(volumeToRegionArea)
    .filter((area): area is RegionAreaDefinition => area !== null);
}

/** Build volumes from the legacy area store (pre-069.4). */
export function migrateRegionVolumesFromLegacy(
  areas: readonly RegionAreaDefinition[]
): RegionVolumeDefinition[] {
  return areas.map(regionAreaToVolume);
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
  return migrateRegionVolumesFromLegacy(region.areas ?? []);
}

/** Return a region with canonical `volumes` set and the `@deprecated`
 *  area/ambience aliases re-derived. Plan 069.4 — command executors call
 *  this because commands do NOT re-normalize, and live in-session readers
 *  consume the aliases between saves. */
export function withDerivedRegionAliases(
  region: RegionDocument,
  volumes: RegionVolumeDefinition[]
): RegionDocument {
  return {
    ...region,
    volumes,
    areas: deriveRegionAreasFromVolumes(volumes)
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

/**
 * The flag a world-flag condition points at. Pre-206 region files hold a flag
 * NAME in `key`; it is read here as if it were an id, and the load-time flag
 * migration turns it into a real reference once it can see the whole project.
 */
export function readWorldFlagReference(
  condition: Partial<RegionBehaviorWorldFlagCondition> | null | undefined
): string | null {
  const raw =
    condition?.worldFlagId ??
    (condition as Record<string, unknown> | null | undefined)?.key;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

export function createRegionBehaviorQuestBinding(
  overrides: Partial<RegionBehaviorQuestBinding> = {}
): RegionBehaviorQuestBinding {
  const worldFlagId = readWorldFlagReference(overrides.worldFlagEquals);
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

  // A file written before the point had a side names its node under
  // `nodeCompleted`, which always meant "the node has been completed". That
  // reads as the node point on the "after" side, and the node carries the
  // quest it belongs to.
  const legacyNode = overrides.nodeCompleted;
  const legacyNodeId = text(legacyNode?.nodeId);
  const legacyNodeQuestId = text(legacyNode?.questDefinitionId);
  const migratingLegacyNode = Boolean(legacyNodeId && legacyNodeQuestId);

  const questNodeId = text(overrides.questNodeId) ?? legacyNodeId;
  const questDefinitionId = migratingLegacyNode
    ? legacyNodeQuestId
    : text(overrides.questDefinitionId);

  return {
    questDefinitionId,
    questStageId: text(overrides.questStageId),
    // A node only means something inside a quest.
    questNodeId: questDefinitionId ? questNodeId : null,
    storyPointSide: migratingLegacyNode
      ? "after"
      : overrides.storyPointSide === "after"
        ? "after"
        : "while",
    worldFlagEquals: worldFlagId
      ? {
          worldFlagId,
          valueType: overrides.worldFlagEquals?.valueType ?? "boolean",
          value:
            typeof overrides.worldFlagEquals?.value === "string" &&
            overrides.worldFlagEquals.value.trim().length > 0
              ? overrides.worldFlagEquals.value.trim()
              : null
        }
      : null
  };
}

export function createRegionNPCBehaviorTask(
  /** `targetAreaId` is the pre-marker spelling of `target`; the factory is
   *  where it is read, so nothing downstream has to know it existed. */
  overrides: Partial<RegionNPCBehaviorTask> & { targetAreaId?: unknown } = {}
): RegionNPCBehaviorTask {
  return {
    taskId: overrides.taskId ?? createRegionNPCBehaviorTaskId(),
    displayName: overrides.displayName ?? "Behavior Task",
    description:
      typeof overrides.description === "string" &&
      overrides.description.trim().length > 0
        ? overrides.description
        : null,
    target: normalizeBehaviorTaskTarget(overrides),
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
    activation: createRegionBehaviorQuestBinding(overrides.activation),
    timeWindow: overrides.timeWindow ?? null
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

/** Warm tungsten, the tone the driving uses want: lanterns, hearths,
 *  candles, low fill. */
export const DEFAULT_PLACED_LIGHT_COLOR = 0xffd9a0;
/** Candela for point and spot, nits for area. Bright enough to read as a
 *  light source in a room without blowing out the sun's exposure. */
export const DEFAULT_PLACED_LIGHT_INTENSITY = 8;
/** Metres. About one room's worth of reach. */
export const DEFAULT_PLACED_LIGHT_RADIUS = 6;
/**
 * The smallest reach a light may carry. three.js reads a distance of zero as
 * NO limit, so a light dialled down to nothing would light the whole world --
 * the opposite of what the number says. Anything at or below this is treated
 * as this.
 */
export const MIN_PLACED_LIGHT_RADIUS = 0.1;
export const DEFAULT_PLACED_LIGHT_SPOT_ANGLE_DEG = 35;
export const DEFAULT_PLACED_LIGHT_SPOT_PENUMBRA = 0.4;
/** Metres, square. */
export const DEFAULT_PLACED_LIGHT_AREA_SIZE = 2;

/**
 * A light's own place in its modulation cycle, derived from its id.
 *
 * Two candles placed from the same defaults, or one duplicated from the
 * other, would otherwise share every number and flicker in lockstep. Their
 * ids differ, so this makes their flicker differ, with no clock and no
 * randomness — the same light seeds the same way on every load.
 */
export function placedLightSeedFromInstanceId(instanceId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < instanceId.length; index += 1) {
    hash ^= instanceId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function createPlacedLightModulation(
  overrides: Partial<PlacedLightModulation> | null | undefined,
  fallbackSeed: number
): PlacedLightModulation {
  return {
    kind: overrides?.kind ?? "steady",
    speed: overrides?.speed ?? 1,
    amount: overrides?.amount ?? 0.2,
    colorWobble: overrides?.colorWobble ?? 0.1,
    seed: overrides?.seed ?? fallbackSeed
  };
}

function createPlacedLightSpotConfig(
  overrides: Partial<PlacedLightSpotConfig> | null | undefined
): PlacedLightSpotConfig {
  return {
    angleDeg: overrides?.angleDeg ?? DEFAULT_PLACED_LIGHT_SPOT_ANGLE_DEG,
    penumbra: overrides?.penumbra ?? DEFAULT_PLACED_LIGHT_SPOT_PENUMBRA,
    projectedTextureId: overrides?.projectedTextureId ?? null
  };
}

function createPlacedLightAreaConfig(
  overrides: Partial<PlacedLightAreaConfig> | null | undefined
): PlacedLightAreaConfig {
  return {
    width: overrides?.width ?? DEFAULT_PLACED_LIGHT_AREA_SIZE,
    height: overrides?.height ?? DEFAULT_PLACED_LIGHT_AREA_SIZE
  };
}

/**
 * The only way to build a placed light. [LAW:single-enforcer] Load paths,
 * commands and tests all come through here, which is what keeps a light's
 * kind and its kind-specific fields agreeing: the kind decides which of
 * `radius`, `spot` and `area` hold a value, and the rest are null no
 * matter what the caller passed. Changing a light's kind through this
 * factory drops the fields the new kind does not use, so nothing stale
 * rides along to the next save.
 */
export function createPlacedLight(
  overrides: Partial<PlacedLight> = {}
): PlacedLight {
  const instanceId = overrides.instanceId ?? createPlacedLightIdValue();
  const kind = overrides.kind ?? "point";
  return {
    instanceId,
    kind,
    displayName: overrides.displayName ?? "Placed Light",
    parentFolderId: overrides.parentFolderId ?? null,
    enabled: overrides.enabled ?? true,
    color: overrides.color ?? DEFAULT_PLACED_LIGHT_COLOR,
    intensity: overrides.intensity ?? DEFAULT_PLACED_LIGHT_INTENSITY,
    radius:
      kind === "area"
        ? null
        : Math.max(
            MIN_PLACED_LIGHT_RADIUS,
            overrides.radius ?? DEFAULT_PLACED_LIGHT_RADIUS
          ),
    spot: kind === "spot" ? createPlacedLightSpotConfig(overrides.spot) : null,
    area: kind === "area" ? createPlacedLightAreaConfig(overrides.area) : null,
    modulation: createPlacedLightModulation(
      overrides.modulation,
      placedLightSeedFromInstanceId(instanceId)
    ),
    transform: {
      position: overrides.transform?.position ?? [0, 0, 0],
      rotation: overrides.transform?.rotation ?? [0, 0, 0],
      scale: overrides.transform?.scale ?? [1, 1, 1]
    }
  };
}

/**
 * Instance ids hidden by folder visibility (Plan 070.3, #349). The Scene
 * Explorer's per-folder eye is EPHEMERAL authoring visibility (like the
 * Spatial volume eye) — it never touches the saved region. Hiding a folder
 * hides its whole subtree, so descendant folders expand first, then everything
 * parented anywhere under a hidden folder is collected.
 *
 * EVERYTHING THAT CARRIES A `parentFolderId` BELONGS HERE. Placed assets and
 * placed lights both do; presences do not, and are unaffected. A kind left out
 * keeps drawing inside a folder the author has hidden. Total by construction:
 * an empty `hiddenFolderIds` returns an empty set.
 *
 * Takes the collections STRUCTURALLY (not a RegionDocument) so the
 * caller passes the SAME set the viewport renders — i.e. the COMPOSED base +
 * active-Scene overlay (`composeRegionContents`), not base alone. A base region
 * satisfies the shape too, so base-only callers/tests are unchanged. This is
 * load-bearing: overlay placements render but live outside base `placedAssets`,
 * so a base-only resolve leaves scene-scoped items in a hidden folder visible.
 */
export function resolveHiddenAssetInstanceIds(
  contents: {
    folders: readonly RegionSceneFolder[];
    placedAssets: readonly PlacedAssetInstance[];
    placedLights?: readonly PlacedLight[];
  },
  hiddenFolderIds: Iterable<string>
): Set<string> {
  const hidden = new Set(hiddenFolderIds);
  if (hidden.size === 0) return new Set();
  // Expand to the full hidden subtree: a hidden folder hides its descendants.
  const childrenByParent = new Map<string, RegionSceneFolder[]>();
  for (const folder of contents.folders ?? []) {
    if (folder.parentFolderId === null) continue;
    const list = childrenByParent.get(folder.parentFolderId);
    if (list) list.push(folder);
    else childrenByParent.set(folder.parentFolderId, [folder]);
  }
  const stack = [...hidden];
  while (stack.length > 0) {
    const folderId = stack.pop()!;
    for (const child of childrenByParent.get(folderId) ?? []) {
      if (!hidden.has(child.folderId)) {
        hidden.add(child.folderId);
        stack.push(child.folderId);
      }
    }
  }
  const instanceIds = new Set<string>();
  for (const light of contents.placedLights ?? []) {
    if (light.parentFolderId && hidden.has(light.parentFolderId)) {
      instanceIds.add(light.instanceId);
    }
  }
  for (const asset of contents.placedAssets ?? []) {
    if (asset.parentFolderId && hidden.has(asset.parentFolderId)) {
      instanceIds.add(asset.instanceId);
    }
  }
  return instanceIds;
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

/**
 * A task's destination, reading a pre-marker file's bare `targetAreaId`
 * as the area shape it always meant.
 */
function normalizeBehaviorTaskTarget(
  source: Partial<RegionNPCBehaviorTask> & { targetAreaId?: unknown }
): RegionBehaviorTaskTarget | null {
  const target = source.target;
  if (target && target.kind === "marker") {
    return target.markerId.trim().length > 0
      ? { kind: "marker", markerId: target.markerId.trim() }
      : null;
  }
  if (target && target.kind === "area") {
    return target.areaId.trim().length > 0
      ? { kind: "area", areaId: target.areaId.trim() }
      : null;
  }
  const legacyAreaId = source.targetAreaId;
  return typeof legacyAreaId === "string" && legacyAreaId.trim().length > 0
    ? { kind: "area", areaId: legacyAreaId.trim() }
    : null;
}

export function createRegionMarkerId(): string {
  return createUuid();
}

export function createRegionMarker(
  overrides: Partial<RegionMarker> = {}
): RegionMarker {
  return {
    markerId: overrides.markerId ?? createRegionMarkerId(),
    displayName: overrides.displayName ?? "Marker",
    transform: createRegionSceneTransform(overrides.transform)
  };
}

export function createRegionSoundEmitterId(): string {
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

export function createRegionAudioState(
  overrides: Partial<RegionAudioState> = {}
): RegionAudioState {
  return {
    emitters: (overrides.emitters ?? []).map((emitter) =>
      createRegionSoundEmitter(emitter)
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
    transform: createRegionSceneTransform(overrides.transform),
    condition: overrides.condition
      ? createRegionBehaviorQuestBinding(overrides.condition)
      : null,
    placementLabel: overrides.placementLabel ?? null
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
    placedLights: [],
    folders: [],
    environmentBinding: {
      defaultEnvironmentId: options.defaultEnvironmentId ?? null
    },
    areas: [],
    volumes: [],
    behaviors: [],
    npcPresences: [],
    itemPresences: [],
    playerPresence: null,
    landscape: createDefaultRegionLandscapeState(),
    audio: createRegionAudioState(),
    markers: [],
    navMesh: null
  };
}
