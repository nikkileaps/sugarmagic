/**
 * Authoring session: the canonical owner of in-memory authored documents.
 *
 * This is NOT a zustand store. It is a plain domain-owned container
 * for canonical authored truth, mutation history, and undo/redo.
 * Shell orchestration coordinates access to this session but does
 * not replace it as the source of truth.
 */

import type {
  AudioMixerSettings,
  GameProject,
  MusicBindings,
  RuntimeSoundEventKey
} from "../game-project";
import {
  normalizeAudioMixerSettings,
  normalizeCreditsDefinition,
  normalizeMusicBindings,
  normalizeGameProject
} from "../game-project";
import type { CreditsDefinition } from "../game-project";
import type { DocumentDefinition } from "../document-definition";
import type { PlacedAssetInstance, RegionDocument } from "../region-authoring";
import {
  createItemPresenceId,
  createNPCPresenceId,
  createPlayerPresenceId
} from "../region-authoring";
import { normalizeRegionDocumentForLoad, normalizeScenesForLoad } from "../io";
import {
  composeRegionContents,
  createDefaultScene,
  createRegionSceneOverlay,
  migrateToScenes,
  type ComposedRegionContents,
  type RegionSceneOverlay,
  type Scene
} from "../scenes";
import type { AuthoringHistory } from "../history";
import type {
  SemanticCommand,
  CreateDialogueDefinitionCommand,
  CreateDocumentDefinitionCommand,
  CreateItemDefinitionCommand,
  CreateNPCDefinitionCommand,
  CreateQuestDefinitionCommand,
  CreateSpellDefinitionCommand,
  DeleteItemDefinitionCommand,
  DeleteNPCDefinitionCommand,
  DeleteDialogueDefinitionCommand,
  DeleteDocumentDefinitionCommand,
  DeleteQuestDefinitionCommand,
  DeleteSpellDefinitionCommand,
  UpdateEnvironmentDefinitionCommand,
  UpdateDialogueDefinitionCommand,
  UpdateDocumentDefinitionCommand,
  UpdateItemDefinitionCommand,
  UpdateNPCDefinitionCommand,
  UpdateQuestDefinitionCommand,
  UpdateSpellDefinitionCommand,
  UpdatePlayerDefinitionCommand,
  UpdateMechanicsDefinitionCommand,
  CreateShaderGraphCommand,
  RenameShaderGraphCommand,
  DeleteShaderGraphCommand,
  UpdateShaderNodeCommand,
  RemoveShaderNodeCommand,
  AddShaderEdgeCommand,
  RemoveShaderEdgeCommand,
  UpdateShaderParameterCommand,
  RemoveShaderParameterCommand,
  SetAssetDefaultShaderCommand,
  SetAssetDefaultShaderParameterOverrideCommand,
  ClearAssetDefaultShaderParameterOverrideCommand,
  AddPostProcessShaderCommand,
  UpdatePostProcessShaderOrderCommand,
  UpdatePostProcessShaderParameterCommand,
  TogglePostProcessShaderCommand,
  RemovePostProcessShaderCommand,
  UpdatePluginConfigurationCommand,
  DeletePluginConfigurationCommand,
  BumpMajorVersionCommand,
  CreateMenuDefinitionCommand,
  UpdateMenuDefinitionCommand,
  DeleteMenuDefinitionCommand,
  AddMenuNodeCommand,
  UpdateMenuNodeCommand,
  RemoveMenuNodeCommand,
  UpdateHUDDefinitionCommand,
  AddHUDNodeCommand,
  UpdateHUDNodeCommand,
  RemoveHUDNodeCommand,
  UpdateUIThemeCommand,
  SetPlacedAssetShaderOverrideCommand,
  SetNPCPresenceShaderOverrideCommand,
  SetItemPresenceShaderOverrideCommand,
  SetPlacedAssetShaderParameterOverrideCommand,
  ClearPlacedAssetShaderParameterOverrideCommand,
  SetNPCPresenceShaderParameterOverrideCommand,
  ClearNPCPresenceShaderParameterOverrideCommand,
  SetItemPresenceShaderParameterOverrideCommand,
  ClearItemPresenceShaderParameterOverrideCommand
} from "../commands";
import type {
  AssetDefinition,
  AudioClipDefinition,
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  SoundCueDefinition,
  TextureDefinition
} from "../content-library";
import {
  normalizeNPCDefinitionForWrite,
  type NPCDefinition
} from "../npc-definition";
import type { ItemDefinition } from "../item-definition";
import type { DialogueDefinition } from "../dialogue-definition";
import type { QuestDefinition } from "../quest-definition";
import type { SpellDefinition } from "../spell-definition";
import {
  normalizeHUDDefinition,
  normalizeMenuDefinition,
  normalizeUITheme,
  normalizeUINode,
  type HUDDefinition,
  type MenuDefinition,
  type UITheme,
  type UINode
} from "../ui-definition";
import {
  assertReusableSurfaceHasNoPaintedMasks,
  cloneSurface,
  type SurfaceDefinition
} from "../surface";
import {
  removePluginConfiguration,
  upsertPluginConfiguration,
  type PluginConfigurationRecord
} from "../plugins";
import type { TimestampIso } from "../shared";
import {
  createBuiltInCloudShadowsShaderId,
  createBuiltInFogTintShaderId,
  createEmptyContentLibrarySnapshot,
  DEFAULT_CLOUD_SHADOW_SETTINGS,
  listAudioClipDefinitions as listAudioClipDefinitionsFromLibrary,
  listCharacterModelDefinitions as listCharacterModelDefinitionsFromLibrary,
  listCharacterAnimationDefinitions as listCharacterAnimationDefinitionsFromLibrary,
  listAssetDefinitions as listAssetDefinitionsFromLibrary,
  listEnvironmentDefinitions as listEnvironmentDefinitionsFromLibrary,
  listMaterialDefinitions as listMaterialDefinitionsFromLibrary,
  listMaskTextureDefinitions as listMaskTextureDefinitionsFromLibrary,
  listSurfaceDefinitions as listSurfaceDefinitionsFromLibrary,
  listShaderDefinitions as listShaderDefinitionsFromLibrary,
  listSoundCueDefinitions as listSoundCueDefinitionsFromLibrary,
  listTextureDefinitions as listTextureDefinitionsFromLibrary,
  normalizeContentLibrarySnapshot,
  synchronizeEnvironmentDefinition
} from "../content-library";
import type {
  ShaderGraphDocument,
  ShaderParameterOverride
} from "../shader-graph";
import {
  createEmptyShaderSlotBindingMap,
  validateShaderGraphDocument
} from "../shader-graph";
import { createScopedId, createUuid } from "../shared";
import { executeCommand, pushTransaction } from "../commands/executor";
import { createEmptyHistory } from "../commands/executor";

interface SessionCheckpoint {
  gameProject: GameProject;
  contentLibrary: ContentLibrarySnapshot;
  regions: Map<string, RegionDocument>;
  activeRegionId: string | null;
  activeSceneId: string | null;
}

export interface AuthoringSession {
  gameProject: GameProject;
  contentLibrary: ContentLibrarySnapshot;
  regions: Map<string, RegionDocument>;
  activeRegionId: string | null;
  /**
   * Plan 058 §058.1 — the author's current Scene (Ambient
   * Context pattern). Presence + overlay-scoped commands land in
   * this Scene; Design workspaces scope their views to it.
   * Scenes ride inside `gameProject.scenes`; this is just the
   * selection pointer.
   */
  activeSceneId: string | null;
  undoStack: SessionCheckpoint[];
  redoStack: SessionCheckpoint[];
  history: AuthoringHistory;
  isDirty: boolean;
}

function createTransactionForCommand(
  command: SemanticCommand,
  affectedAggregateIds: string[]
) {
  return {
    transactionId: `tx-${createScopedId("authoring")}`,
    command,
    affectedAggregateIds,
    committedAt: new Date().toISOString() as TimestampIso
  };
}

function checkpointSession(session: AuthoringSession): SessionCheckpoint {
  return {
    gameProject: session.gameProject,
    contentLibrary: session.contentLibrary,
    regions: new Map(session.regions),
    activeRegionId: session.activeRegionId,
    activeSceneId: session.activeSceneId
  };
}

function restoreCheckpoint(
  session: AuthoringSession,
  checkpoint: SessionCheckpoint,
  nextUndoStack: SessionCheckpoint[],
  nextRedoStack: SessionCheckpoint[],
  nextHistory: AuthoringHistory
): AuthoringSession {
  return {
    ...session,
    gameProject: checkpoint.gameProject,
    contentLibrary: checkpoint.contentLibrary,
    regions: new Map(checkpoint.regions),
    activeRegionId: checkpoint.activeRegionId,
    activeSceneId: checkpoint.activeSceneId,
    undoStack: nextUndoStack,
    redoStack: nextRedoStack,
    history: nextHistory,
    isDirty: true
  };
}

export function getActiveRegion(
  session: AuthoringSession
): RegionDocument | null {
  if (!session.activeRegionId) return null;
  return session.regions.get(session.activeRegionId) ?? null;
}

/**
 * Plan 058 §058.1 — resolve the author's active Scene. Falls
 * back to the first Scene by order when the pointer is unset or
 * dangling (Scene deleted); a migrated project always has ≥1.
 */
export function getActiveScene(session: AuthoringSession): Scene | null {
  const scenes = session.gameProject.scenes;
  if (scenes.length === 0) return null;
  return (
    scenes.find((scene) => scene.sceneId === session.activeSceneId) ??
    scenes[0] ??
    null
  );
}

/**
 * Composed Base + Overlay view of the active region under the
 * active Scene (Pattern 1). What the pre-058 `region.scene` nest
 * used to be — workspaces read presences / assets from here.
 */
export function getActiveRegionContents(
  session: AuthoringSession
): ComposedRegionContents | null {
  const region = getActiveRegion(session);
  if (!region) return null;
  return composeRegionContents(region, getActiveScene(session));
}

/** Switch the ambient Scene context. Clears undo/redo like
 *  `switchActiveRegion` does (checkpoint identity across context
 *  switches is more confusing than helpful). */
export function switchActiveScene(
  session: AuthoringSession,
  sceneId: string
): AuthoringSession {
  const exists = session.gameProject.scenes.some(
    (scene) => scene.sceneId === sceneId
  );
  if (!exists || session.activeSceneId === sceneId) return session;
  return {
    ...session,
    activeSceneId: sceneId,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory()
  };
}

export function getAllRegions(session: AuthoringSession): RegionDocument[] {
  return Array.from(session.regions.values());
}

export function getAllAssetDefinitions(
  session: AuthoringSession
): AssetDefinition[] {
  return listAssetDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllAudioClipDefinitions(
  session: AuthoringSession
): AudioClipDefinition[] {
  return listAudioClipDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllCharacterModelDefinitions(
  session: AuthoringSession
): CharacterModelDefinition[] {
  return listCharacterModelDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllCharacterAnimationDefinitions(
  session: AuthoringSession
): CharacterAnimationDefinition[] {
  return listCharacterAnimationDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllEnvironmentDefinitions(
  session: AuthoringSession
): EnvironmentDefinition[] {
  return listEnvironmentDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllMaterialDefinitions(
  session: AuthoringSession
): MaterialDefinition[] {
  return listMaterialDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllSoundCueDefinitions(
  session: AuthoringSession
): SoundCueDefinition[] {
  return listSoundCueDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllSurfaceDefinitions(
  session: AuthoringSession
): SurfaceDefinition[] {
  return listSurfaceDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllTextureDefinitions(
  session: AuthoringSession
): TextureDefinition[] {
  return listTextureDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllMaskTextureDefinitions(
  session: AuthoringSession
): MaskTextureDefinition[] {
  return listMaskTextureDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllShaderDefinitions(
  session: AuthoringSession
): ShaderGraphDocument[] {
  return listShaderDefinitionsFromLibrary(session.contentLibrary);
}

export function getPlayerDefinition(session: AuthoringSession) {
  return session.gameProject.playerDefinition;
}

export function getAllNPCDefinitions(
  session: AuthoringSession
): NPCDefinition[] {
  return session.gameProject.npcDefinitions;
}

export function getAllItemDefinitions(
  session: AuthoringSession
): ItemDefinition[] {
  return session.gameProject.itemDefinitions;
}

export function getAllSpellDefinitions(
  session: AuthoringSession
): SpellDefinition[] {
  return session.gameProject.spellDefinitions;
}

export function getAllDocumentDefinitions(
  session: AuthoringSession
): DocumentDefinition[] {
  return session.gameProject.documentDefinitions;
}

export function getAllDialogueDefinitions(
  session: AuthoringSession
): DialogueDefinition[] {
  return session.gameProject.dialogueDefinitions;
}

export function getAllQuestDefinitions(
  session: AuthoringSession
): QuestDefinition[] {
  return session.gameProject.questDefinitions;
}

export function getAllMenuDefinitions(
  session: AuthoringSession
): MenuDefinition[] {
  return session.gameProject.menuDefinitions;
}

export function getHUDDefinition(
  session: AuthoringSession
): HUDDefinition | null {
  return session.gameProject.hudDefinition;
}

export function getUITheme(session: AuthoringSession): UITheme {
  return session.gameProject.uiTheme;
}

export function getAllPluginConfigurations(
  session: AuthoringSession
): PluginConfigurationRecord[] {
  return session.gameProject.pluginConfigurations;
}

export function createAuthoringSession(
  gameProject: GameProject,
  regions: RegionDocument[],
  contentLibrary: ContentLibrarySnapshot = createEmptyContentLibrarySnapshot(
    gameProject.identity.id
  )
): AuthoringSession {
  // Plan 058 §058.1 — lift pre-058 `region.scene` nests into the
  // project's default Scene BEFORE normalization, so overlay
  // presences flow through the same contentLibrary-aware
  // normalization the regions get. Idempotent: an already-
  // migrated project passes through unchanged.
  const migrated = migrateToScenes({
    scenes: gameProject.scenes ?? [],
    regions
  });
  const normalizedProject = normalizeGameProject({
    ...gameProject,
    scenes: migrated.scenes
  });
  const normalizedContentLibrary = normalizeContentLibrarySnapshot(
    contentLibrary,
    normalizedProject.identity.id
  );
  const projectWithScenes: GameProject = {
    ...normalizedProject,
    scenes: normalizeScenesForLoad(
      normalizedProject.scenes,
      normalizedContentLibrary
    )
  };
  const regionMap = new Map<string, RegionDocument>();
  for (const region of migrated.regions) {
    regionMap.set(
      region.identity.id,
      normalizeRegionDocumentForLoad(region, normalizedContentLibrary)
    );
  }

  return {
    gameProject: projectWithScenes,
    contentLibrary: normalizedContentLibrary,
    regions: regionMap,
    activeRegionId: regions[0]?.identity.id ?? null,
    activeSceneId: projectWithScenes.scenes[0]?.sceneId ?? null,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    // Plan 058 §058.1 — a fresh migration leaves the in-memory
    // shape ahead of disk; flag dirty so Studio's save flow
    // persists the upgrade instead of re-migrating every load
    // (re-migration is idempotent, but persisting is cleaner).
    isDirty: migrated.didMigrate
  };
}

export function switchActiveRegion(
  session: AuthoringSession,
  regionId: string
): AuthoringSession {
  if (!session.regions.has(regionId)) return session;
  if (session.activeRegionId === regionId) return session;

  return {
    ...session,
    activeRegionId: regionId,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory()
  };
}

function applyEnvironmentDefinitionCommand(
  session: AuthoringSession,
  command: UpdateEnvironmentDefinitionCommand
): AuthoringSession {
  const definitionIndex =
    session.contentLibrary.environmentDefinitions.findIndex(
      (definition) => definition.definitionId === command.payload.definitionId
    );
  if (definitionIndex < 0) {
    return session;
  }

  const nextDefinitions = [...session.contentLibrary.environmentDefinitions];
  nextDefinitions[definitionIndex] = synchronizeEnvironmentDefinition(
    command.payload.definition,
    session.gameProject.identity.id
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      environmentDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function replaceShaderOverride<
  T extends {
    shaderOverride: { shaderDefinitionId: string } | null;
    shaderParameterOverrides: ShaderParameterOverride[];
  }
>(value: T, shaderDefinitionId: string | null): T {
  return {
    ...value,
    shaderOverride: shaderDefinitionId ? { shaderDefinitionId } : null
  };
}

function upsertShaderParameterOverride(
  overrides: ShaderParameterOverride[],
  nextOverride: ShaderParameterOverride
): ShaderParameterOverride[] {
  const existingIndex = overrides.findIndex(
    (override) => override.parameterId === nextOverride.parameterId
  );
  if (existingIndex < 0) {
    return [...overrides, nextOverride];
  }

  const next = [...overrides];
  next[existingIndex] = nextOverride;
  return next;
}

function removeShaderParameterOverride(
  overrides: ShaderParameterOverride[],
  parameterId: string
): ShaderParameterOverride[] {
  return overrides.filter((override) => override.parameterId !== parameterId);
}

function applyShaderGraphMutation(
  session: AuthoringSession,
  shaderDefinitionId: string,
  mutate: (definition: ShaderGraphDocument) => ShaderGraphDocument | null,
  command: SemanticCommand
): AuthoringSession {
  const definitionIndex = session.contentLibrary.shaderDefinitions.findIndex(
    (definition) => definition.shaderDefinitionId === shaderDefinitionId
  );
  if (definitionIndex < 0) {
    return session;
  }

  const currentDefinition =
    session.contentLibrary.shaderDefinitions[definitionIndex]!;
  const nextDefinition = mutate(currentDefinition);
  if (!nextDefinition) {
    return session;
  }

  const issues = validateShaderGraphDocument(nextDefinition).filter(
    (issue) => issue.severity === "error"
  );
  if (issues.length > 0) {
    console.warn("[domain] rejected invalid shader graph mutation", {
      shaderDefinitionId,
      commandKind: command.kind,
      issues
    });
    return session;
  }

  const nextDefinitions = [...session.contentLibrary.shaderDefinitions];
  nextDefinitions[definitionIndex] = nextDefinition;
  const transaction = createTransactionForCommand(command, [
    shaderDefinitionId
  ]);

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      shaderDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateShaderGraphCommand(
  session: AuthoringSession,
  command: CreateShaderGraphCommand
): AuthoringSession {
  const issues = validateShaderGraphDocument(command.payload.definition).filter(
    (issue) => issue.severity === "error"
  );
  if (issues.length > 0) {
    console.warn("[domain] rejected invalid shader graph creation", {
      shaderDefinitionId: command.payload.definition.shaderDefinitionId,
      issues
    });
    return session;
  }

  const transaction = createTransactionForCommand(command, [
    command.payload.definition.shaderDefinitionId
  ]);

  const insertAfterId = command.payload.insertAfterShaderDefinitionId;
  const existing = session.contentLibrary.shaderDefinitions;
  const insertIndex = insertAfterId
    ? existing.findIndex((d) => d.shaderDefinitionId === insertAfterId)
    : -1;
  const nextShaderDefinitions =
    insertIndex >= 0
      ? [
          ...existing.slice(0, insertIndex + 1),
          command.payload.definition,
          ...existing.slice(insertIndex + 1)
        ]
      : [...existing, command.payload.definition];

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      shaderDefinitions: nextShaderDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyRenameShaderGraphCommand(
  session: AuthoringSession,
  command: RenameShaderGraphCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => ({
      ...definition,
      displayName: command.payload.displayName,
      revision: definition.revision + 1
    }),
    command
  );
}

/** Drop every override referencing a deleted shader from an
 *  entity that carries shader overrides (assets + presences). */
function stripShaderReferences<
  T extends {
    shaderOverrides?: { shaderDefinitionId: string }[];
    shaderParameterOverrides: unknown[];
  }
>(entity: T, shaderDefinitionId: string): T {
  const hasReference = (entity.shaderOverrides ?? []).some(
    (override) => override.shaderDefinitionId === shaderDefinitionId
  );
  if (!hasReference) return entity;
  return {
    ...entity,
    shaderOverrides: (entity.shaderOverrides ?? []).filter(
      (override) => override.shaderDefinitionId !== shaderDefinitionId
    ),
    shaderParameterOverrides: []
  };
}

function applyDeleteShaderGraphCommand(
  session: AuthoringSession,
  command: DeleteShaderGraphCommand
): AuthoringSession {
  const nextDefinitions = session.contentLibrary.shaderDefinitions.filter(
    (definition) =>
      definition.shaderDefinitionId !== command.payload.shaderDefinitionId
  );
  if (
    nextDefinitions.length === session.contentLibrary.shaderDefinitions.length
  ) {
    return session;
  }

  const transaction = createTransactionForCommand(command, [
    command.payload.shaderDefinitionId
  ]);
  return {
    ...session,
    // Plan 058 §058.1 — scrub overlay-side references across
    // EVERY Scene's overlays (base-side scrub is in `regions`
    // below).
    gameProject: {
      ...session.gameProject,
      scenes: session.gameProject.scenes.map((scene) => ({
        ...scene,
        regionOverlays: Object.fromEntries(
          Object.entries(scene.regionOverlays).map(([regionId, overlay]) => [
            regionId,
            {
              ...overlay,
              placedAssets: overlay.placedAssets.map((asset) =>
                stripShaderReferences(
                  asset,
                  command.payload.shaderDefinitionId
                )
              ),
              npcPresences: overlay.npcPresences.map((presence) =>
                stripShaderReferences(
                  presence,
                  command.payload.shaderDefinitionId
                )
              ),
              itemPresences: overlay.itemPresences.map((presence) =>
                stripShaderReferences(
                  presence,
                  command.payload.shaderDefinitionId
                )
              )
            }
          ])
        )
      }))
    },
    contentLibrary: {
      ...session.contentLibrary,
      shaderDefinitions: nextDefinitions,
      assetDefinitions: session.contentLibrary.assetDefinitions.map(
        (definition) => ({
          ...definition,
          surfaceSlots: definition.surfaceSlots.map((slot) =>
            slot.surface?.kind === "inline" &&
            slot.surface.surface.layers.some(
              (layer) =>
                layer.kind === "appearance" &&
                layer.content.kind === "shader" &&
                layer.content.shaderDefinitionId ===
                  command.payload.shaderDefinitionId
            )
              ? { ...slot, surface: null }
              : slot
          ),
          deform:
            definition.deform?.kind === "shader" &&
            definition.deform.shaderDefinitionId ===
              command.payload.shaderDefinitionId
              ? null
              : definition.deform,
          effect:
            definition.effect?.kind === "shader" &&
            definition.effect.shaderDefinitionId ===
              command.payload.shaderDefinitionId
              ? null
              : definition.effect
        })
      ),
      environmentDefinitions: session.contentLibrary.environmentDefinitions.map(
        (definition) => ({
          ...definition,
          postProcessShaders: definition.postProcessShaders.filter(
            (binding) =>
              binding.shaderDefinitionId !== command.payload.shaderDefinitionId
          )
        })
      )
    },
    regions: new Map(
      Array.from(session.regions.entries()).map(([regionId, region]) => [
        regionId,
        {
          ...region,
          // Plan 058 §058.1 — base-scope assets scrub here; the
          // overlay-side scrub happens across gameProject.scenes
          // below (a shader delete is global, not Scene-scoped).
          placedAssets: region.placedAssets.map((asset) =>
            stripShaderReferences(asset, command.payload.shaderDefinitionId)
          )
        }
      ])
    ),
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateShaderNodeCommand(
  session: AuthoringSession,
  command: UpdateShaderNodeCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => {
      const existingIndex = definition.nodes.findIndex(
        (node) => node.nodeId === command.payload.node.nodeId
      );
      const nextNodes = [...definition.nodes];
      if (existingIndex < 0) {
        nextNodes.push(command.payload.node);
      } else {
        nextNodes[existingIndex] = command.payload.node;
      }

      return {
        ...definition,
        nodes: nextNodes,
        revision: definition.revision + 1
      };
    },
    command
  );
}

function applyRemoveShaderNodeCommand(
  session: AuthoringSession,
  command: RemoveShaderNodeCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => ({
      ...definition,
      nodes: definition.nodes.filter(
        (node) => node.nodeId !== command.payload.nodeId
      ),
      edges: definition.edges.filter(
        (edge) =>
          edge.sourceNodeId !== command.payload.nodeId &&
          edge.targetNodeId !== command.payload.nodeId
      ),
      revision: definition.revision + 1
    }),
    command
  );
}

function applyAddShaderEdgeCommand(
  session: AuthoringSession,
  command: AddShaderEdgeCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => ({
      ...definition,
      edges: [
        ...definition.edges.filter(
          (edge) => edge.edgeId !== command.payload.edge.edgeId
        ),
        command.payload.edge
      ],
      revision: definition.revision + 1
    }),
    command
  );
}

function applyRemoveShaderEdgeCommand(
  session: AuthoringSession,
  command: RemoveShaderEdgeCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => ({
      ...definition,
      edges: definition.edges.filter(
        (edge) => edge.edgeId !== command.payload.edgeId
      ),
      revision: definition.revision + 1
    }),
    command
  );
}

function applyUpdateShaderParameterCommand(
  session: AuthoringSession,
  command: UpdateShaderParameterCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => {
      const existingIndex = definition.parameters.findIndex(
        (parameter) =>
          parameter.parameterId === command.payload.parameter.parameterId
      );
      const nextParameters = [...definition.parameters];
      if (existingIndex < 0) {
        nextParameters.push(command.payload.parameter);
      } else {
        nextParameters[existingIndex] = command.payload.parameter;
      }

      return {
        ...definition,
        parameters: nextParameters,
        revision: definition.revision + 1
      };
    },
    command
  );
}

function applyRemoveShaderParameterCommand(
  session: AuthoringSession,
  command: RemoveShaderParameterCommand
): AuthoringSession {
  return applyShaderGraphMutation(
    session,
    command.payload.shaderDefinitionId,
    (definition) => ({
      ...definition,
      parameters: definition.parameters.filter(
        (parameter) => parameter.parameterId !== command.payload.parameterId
      ),
      nodes: definition.nodes.filter((node) => {
        if (node.nodeType !== "input.parameter") {
          return true;
        }
        return node.settings.parameterId !== command.payload.parameterId;
      }),
      revision: definition.revision + 1
    }),
    command
  );
}

function applySetAssetDefaultShaderCommand(
  session: AuthoringSession,
  command: SetAssetDefaultShaderCommand
): AuthoringSession {
  const nextDefinitions = session.contentLibrary.assetDefinitions.map(
    (definition) =>
      definition.definitionId === command.payload.definitionId
        ? {
            ...definition,
            deform:
              command.payload.slot === "deform"
                ? command.payload.shaderDefinitionId
                  ? {
                      kind: "shader" as const,
                      shaderDefinitionId: command.payload.shaderDefinitionId,
                      parameterValues: {},
                      textureBindings: {}
                    }
                  : null
                : definition.deform,
            effect:
              command.payload.slot === "effect"
                ? command.payload.shaderDefinitionId
                  ? {
                      kind: "shader" as const,
                      shaderDefinitionId: command.payload.shaderDefinitionId,
                      parameterValues: {},
                      textureBindings: {}
                    }
                  : null
                : definition.effect
          }
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applySetAssetDefaultShaderParameterOverrideCommand(
  session: AuthoringSession,
  command: SetAssetDefaultShaderParameterOverrideCommand
): AuthoringSession {
  return session;
}

function applyClearAssetDefaultShaderParameterOverrideCommand(
  session: AuthoringSession,
  command: ClearAssetDefaultShaderParameterOverrideCommand
): AuthoringSession {
  return session;
}

function applyAddPostProcessShaderCommand(
  session: AuthoringSession,
  command: AddPostProcessShaderCommand
): AuthoringSession {
  const definition = session.contentLibrary.environmentDefinitions.find(
    (entry) => entry.definitionId === command.payload.environmentDefinitionId
  );
  if (!definition) {
    return session;
  }

  return applyEnvironmentDefinitionCommand(session, {
    ...command,
    kind: "UpdateEnvironmentDefinition",
    payload: {
      definitionId: definition.definitionId,
      definition: {
        ...definition,
        postProcessShaders: [
          ...definition.postProcessShaders.filter(
            (binding) =>
              binding.shaderDefinitionId !==
              command.payload.binding.shaderDefinitionId
          ),
          command.payload.binding
        ]
      }
    }
  });
}

function applyUpdatePostProcessShaderOrderCommand(
  session: AuthoringSession,
  command: UpdatePostProcessShaderOrderCommand
): AuthoringSession {
  return applyEnvironmentDefinitionCommand(session, {
    ...command,
    kind: "UpdateEnvironmentDefinition",
    payload: {
      definitionId: command.payload.environmentDefinitionId,
      definition:
        session.contentLibrary.environmentDefinitions.find(
          (definition) =>
            definition.definitionId === command.payload.environmentDefinitionId
        ) === undefined
          ? session.contentLibrary.environmentDefinitions[0]!
          : {
              ...session.contentLibrary.environmentDefinitions.find(
                (definition) =>
                  definition.definitionId ===
                  command.payload.environmentDefinitionId
              )!,
              postProcessShaders: session.contentLibrary.environmentDefinitions
                .find(
                  (definition) =>
                    definition.definitionId ===
                    command.payload.environmentDefinitionId
                )!
                .postProcessShaders.map((binding) =>
                  binding.shaderDefinitionId ===
                  command.payload.shaderDefinitionId
                    ? { ...binding, order: command.payload.order }
                    : binding
                )
            }
    }
  });
}

function updatePostProcessBindingOverride(
  session: AuthoringSession,
  command:
    | UpdatePostProcessShaderParameterCommand
    | TogglePostProcessShaderCommand
    | RemovePostProcessShaderCommand
): AuthoringSession {
  const definition = session.contentLibrary.environmentDefinitions.find(
    (entry) =>
      entry.definitionId ===
      ("environmentDefinitionId" in command.payload
        ? command.payload.environmentDefinitionId
        : null)
  );
  if (!definition) {
    return session;
  }

  let nextDefinition: EnvironmentDefinition = definition;
  if (command.kind === "UpdatePostProcessShaderParameter") {
    nextDefinition = {
      ...definition,
      postProcessShaders: definition.postProcessShaders.map((binding) =>
        binding.shaderDefinitionId === command.payload.shaderDefinitionId
          ? {
              ...binding,
              parameterOverrides: upsertShaderParameterOverride(
                binding.parameterOverrides,
                command.payload.override
              )
            }
          : binding
      )
    };
    if (
      command.payload.shaderDefinitionId ===
      createBuiltInFogTintShaderId(session.gameProject.identity.id)
    ) {
      const currentFog = definition.atmosphere.fog;
      nextDefinition = {
        ...nextDefinition,
        atmosphere: {
          ...nextDefinition.atmosphere,
          fog: {
            ...currentFog,
            color:
              command.payload.override.parameterId === "color"
                ? (() => {
                    const value = command.payload.override.value;
                    if (
                      Array.isArray(value) &&
                      value.length >= 3 &&
                      value.every(
                        (channel) =>
                          typeof channel === "number" &&
                          Number.isFinite(channel)
                      )
                    ) {
                      return (
                        (Math.round((value[0] ?? 0) * 255) << 16) |
                        (Math.round((value[1] ?? 0) * 255) << 8) |
                        Math.round((value[2] ?? 0) * 255)
                      );
                    }
                    return currentFog.color;
                  })()
                : currentFog.color,
            density:
              command.payload.override.parameterId === "density" &&
              typeof command.payload.override.value === "number"
                ? command.payload.override.value
                : currentFog.density,
            heightFalloff:
              command.payload.override.parameterId === "heightFalloff" &&
              typeof command.payload.override.value === "number"
                ? command.payload.override.value
                : currentFog.heightFalloff
          }
        }
      };
    }
    if (
      command.payload.shaderDefinitionId ===
      createBuiltInCloudShadowsShaderId(session.gameProject.identity.id)
    ) {
      const current =
        nextDefinition.atmosphere.cloudShadows ?? DEFAULT_CLOUD_SHADOW_SETTINGS;
      const value = command.payload.override.value;
      const param = command.payload.override.parameterId;
      const numericFields = [
        "scale",
        "speedX",
        "speedZ",
        "coverage",
        "softness",
        "darkness"
      ];
      if (
        numericFields.includes(param) &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        nextDefinition = {
          ...nextDefinition,
          atmosphere: {
            ...nextDefinition.atmosphere,
            cloudShadows: { ...current, [param]: value }
          }
        };
      } else if (
        param === "shadowColor" &&
        Array.isArray(value) &&
        value.length >= 3 &&
        value.every((c) => typeof c === "number" && Number.isFinite(c))
      ) {
        nextDefinition = {
          ...nextDefinition,
          atmosphere: {
            ...nextDefinition.atmosphere,
            cloudShadows: {
              ...current,
              shadowColor: [
                value[0] as number,
                value[1] as number,
                value[2] as number
              ] as [number, number, number]
            }
          }
        };
      }
    }
  } else if (command.kind === "TogglePostProcessShader") {
    nextDefinition = {
      ...definition,
      postProcessShaders: definition.postProcessShaders.map((binding) =>
        binding.shaderDefinitionId === command.payload.shaderDefinitionId
          ? { ...binding, enabled: command.payload.enabled }
          : binding
      )
    };
    if (
      command.payload.shaderDefinitionId ===
      createBuiltInFogTintShaderId(session.gameProject.identity.id)
    ) {
      nextDefinition = {
        ...nextDefinition,
        atmosphere: {
          ...nextDefinition.atmosphere,
          fog: {
            ...nextDefinition.atmosphere.fog,
            enabled: command.payload.enabled
          }
        }
      };
    }
    if (
      command.payload.shaderDefinitionId ===
      createBuiltInCloudShadowsShaderId(session.gameProject.identity.id)
    ) {
      nextDefinition = {
        ...nextDefinition,
        atmosphere: {
          ...nextDefinition.atmosphere,
          cloudShadows: {
            ...nextDefinition.atmosphere.cloudShadows,
            enabled: command.payload.enabled
          }
        }
      };
    }
  } else if (command.kind === "RemovePostProcessShader") {
    nextDefinition = {
      ...definition,
      postProcessShaders: definition.postProcessShaders.filter(
        (binding) =>
          binding.shaderDefinitionId !== command.payload.shaderDefinitionId
      )
    };
    if (
      command.payload.shaderDefinitionId ===
      createBuiltInFogTintShaderId(session.gameProject.identity.id)
    ) {
      nextDefinition = {
        ...nextDefinition,
        atmosphere: {
          ...nextDefinition.atmosphere,
          fog: {
            ...nextDefinition.atmosphere.fog,
            enabled: false
          }
        }
      };
    }
  }

  return applyEnvironmentDefinitionCommand(session, {
    ...command,
    kind: "UpdateEnvironmentDefinition",
    payload: {
      definitionId: definition.definitionId,
      definition: nextDefinition
    }
  });
}

function applyUpdatePluginConfigurationCommand(
  session: AuthoringSession,
  command: UpdatePluginConfigurationCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.configuration.identity.id
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      pluginConfigurations: upsertPluginConfiguration(
        session.gameProject.pluginConfigurations,
        command.payload.configuration
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeletePluginConfigurationCommand(
  session: AuthoringSession,
  command: DeletePluginConfigurationCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    session.gameProject.identity.id
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      pluginConfigurations: removePluginConfiguration(
        session.gameProject.pluginConfigurations,
        command.payload.pluginId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

// Story 45.7.5 — `applyUpdateDeploymentSettingsCommand` and
// `applyEnsureVersionedProjectIdentifierCommand` removed. Deploy state
// mutations now flow through the generic `UpdatePluginConfiguration`
// command applier, which writes the SugarDeploy plugin's
// `pluginConfigurations[].config` slot. The deploy plugin contributes
// typed builders that produce the right payload shape.

// Story 45.8 — bump `majorVersion`. Idempotent / no-op when the
// requested value already matches. Rejects non-integer / non-positive
// inputs by leaving the session unchanged (the cut saga rolls back
// rather than dispatching invalid bumps; this is the belt-and-suspenders).
function applyBumpMajorVersionCommand(
  session: AuthoringSession,
  command: BumpMajorVersionCommand
): AuthoringSession {
  const target = command.payload.newMajorVersion;
  if (
    typeof target !== "number" ||
    !Number.isFinite(target) ||
    target < 1 ||
    Math.floor(target) !== target
  ) {
    return session;
  }
  if (session.gameProject.majorVersion === target) return session;
  const transaction = createTransactionForCommand(command, [
    session.gameProject.identity.id
  ]);
  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      majorVersion: target
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyPlayerDefinitionCommand(
  session: AuthoringSession,
  command: UpdatePlayerDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      playerDefinition: command.payload.definition
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyMechanicsDefinitionCommand(
  session: AuthoringSession,
  command: UpdateMechanicsDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    session.gameProject.identity.id
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      mechanics: command.payload.mechanics
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateNPCDefinitionCommand(
  session: AuthoringSession,
  command: CreateNPCDefinitionCommand
): AuthoringSession {
  const normalizedDefinition = normalizeNPCDefinitionForWrite(
    command.payload.definition
  );
  const transaction = createTransactionForCommand(command, [
    normalizedDefinition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      npcDefinitions: [
        ...session.gameProject.npcDefinitions,
        normalizedDefinition
      ]
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateItemDefinitionCommand(
  session: AuthoringSession,
  command: CreateItemDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      itemDefinitions: [
        ...session.gameProject.itemDefinitions,
        command.payload.definition
      ]
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateSpellDefinitionCommand(
  session: AuthoringSession,
  command: CreateSpellDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      spellDefinitions: [
        ...session.gameProject.spellDefinitions,
        command.payload.definition
      ]
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateDocumentDefinitionCommand(
  session: AuthoringSession,
  command: CreateDocumentDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      documentDefinitions: [
        ...session.gameProject.documentDefinitions,
        command.payload.definition
      ]
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateDialogueDefinitionCommand(
  session: AuthoringSession,
  command: CreateDialogueDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      dialogueDefinitions: [
        ...session.gameProject.dialogueDefinitions,
        command.payload.definition
      ]
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyCreateQuestDefinitionCommand(
  session: AuthoringSession,
  command: CreateQuestDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      questDefinitions: [
        ...session.gameProject.questDefinitions,
        command.payload.definition
      ]
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateNPCDefinitionCommand(
  session: AuthoringSession,
  command: UpdateNPCDefinitionCommand
): AuthoringSession {
  const normalizedDefinition = normalizeNPCDefinitionForWrite(
    command.payload.definition
  );
  const nextDefinitions = session.gameProject.npcDefinitions.map(
    (definition) =>
      definition.definitionId === normalizedDefinition.definitionId
        ? normalizedDefinition
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    normalizedDefinition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      npcDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateItemDefinitionCommand(
  session: AuthoringSession,
  command: UpdateItemDefinitionCommand
): AuthoringSession {
  const nextDefinitions = session.gameProject.itemDefinitions.map(
    (definition) =>
      definition.definitionId === command.payload.definition.definitionId
        ? command.payload.definition
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      itemDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateSpellDefinitionCommand(
  session: AuthoringSession,
  command: UpdateSpellDefinitionCommand
): AuthoringSession {
  const nextDefinitions = session.gameProject.spellDefinitions.map(
    (definition) =>
      definition.definitionId === command.payload.definition.definitionId
        ? command.payload.definition
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      spellDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateDocumentDefinitionCommand(
  session: AuthoringSession,
  command: UpdateDocumentDefinitionCommand
): AuthoringSession {
  const nextDefinitions = session.gameProject.documentDefinitions.map(
    (definition) =>
      definition.definitionId === command.payload.definition.definitionId
        ? command.payload.definition
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      documentDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateDialogueDefinitionCommand(
  session: AuthoringSession,
  command: UpdateDialogueDefinitionCommand
): AuthoringSession {
  const nextDefinitions = session.gameProject.dialogueDefinitions.map(
    (definition) =>
      definition.definitionId === command.payload.definition.definitionId
        ? command.payload.definition
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      dialogueDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyUpdateQuestDefinitionCommand(
  session: AuthoringSession,
  command: UpdateQuestDefinitionCommand
): AuthoringSession {
  const nextDefinitions = session.gameProject.questDefinitions.map(
    (definition) =>
      definition.definitionId === command.payload.definition.definitionId
        ? command.payload.definition
        : definition
  );
  const transaction = createTransactionForCommand(command, [
    command.payload.definition.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      questDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeleteNPCDefinitionCommand(
  session: AuthoringSession,
  command: DeleteNPCDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      npcDefinitions: session.gameProject.npcDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeleteItemDefinitionCommand(
  session: AuthoringSession,
  command: DeleteItemDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      itemDefinitions: session.gameProject.itemDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeleteSpellDefinitionCommand(
  session: AuthoringSession,
  command: DeleteSpellDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      spellDefinitions: session.gameProject.spellDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeleteDocumentDefinitionCommand(
  session: AuthoringSession,
  command: DeleteDocumentDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      documentDefinitions: session.gameProject.documentDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeleteDialogueDefinitionCommand(
  session: AuthoringSession,
  command: DeleteDialogueDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      dialogueDefinitions: session.gameProject.dialogueDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function applyDeleteQuestDefinitionCommand(
  session: AuthoringSession,
  command: DeleteQuestDefinitionCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    command.payload.definitionId
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      questDefinitions: session.gameProject.questDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function commitProjectUICommand(
  session: AuthoringSession,
  command: SemanticCommand,
  nextProject: GameProject,
  affectedAggregateIds: string[]
): AuthoringSession {
  const transaction = createTransactionForCommand(
    command,
    affectedAggregateIds
  );
  return {
    ...session,
    gameProject: nextProject,
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

function mapUINodeTree(
  root: UINode,
  nodeId: string,
  mapper: (node: UINode) => UINode
): UINode {
  if (root.nodeId === nodeId) {
    return mapper(root);
  }
  return {
    ...root,
    children: root.children.map((child) => mapUINodeTree(child, nodeId, mapper))
  };
}

function removeUINodeFromTree(root: UINode, nodeId: string): UINode {
  if (root.nodeId === nodeId) return root;
  return {
    ...root,
    children: root.children
      .filter((child) => child.nodeId !== nodeId)
      .map((child) => removeUINodeFromTree(child, nodeId))
  };
}

function applyCreateMenuDefinitionCommand(
  session: AuthoringSession,
  command: CreateMenuDefinitionCommand
): AuthoringSession {
  const definition = normalizeMenuDefinition(
    command.payload.definition,
    session.gameProject.identity.id,
    session.gameProject.menuDefinitions.length
  );
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      menuDefinitions: [...session.gameProject.menuDefinitions, definition]
    },
    [definition.definitionId]
  );
}

function applyUpdateMenuDefinitionCommand(
  session: AuthoringSession,
  command: UpdateMenuDefinitionCommand
): AuthoringSession {
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      menuDefinitions: session.gameProject.menuDefinitions.map((definition) =>
        definition.definitionId === command.payload.definitionId
          ? normalizeMenuDefinition(
              { ...definition, ...command.payload.patch },
              session.gameProject.identity.id
            )
          : definition
      )
    },
    [command.payload.definitionId]
  );
}

function applyDeleteMenuDefinitionCommand(
  session: AuthoringSession,
  command: DeleteMenuDefinitionCommand
): AuthoringSession {
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      menuDefinitions: session.gameProject.menuDefinitions.filter(
        (definition) => definition.definitionId !== command.payload.definitionId
      )
    },
    [command.payload.definitionId]
  );
}

function applyAddMenuNodeCommand(
  session: AuthoringSession,
  command: AddMenuNodeCommand
): AuthoringSession {
  const node = normalizeUINode(command.payload.node);
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      menuDefinitions: session.gameProject.menuDefinitions.map((definition) =>
        definition.definitionId === command.payload.definitionId
          ? {
              ...definition,
              root: mapUINodeTree(
                definition.root,
                command.payload.parentNodeId,
                (parent) => ({
                  ...parent,
                  children: [...parent.children, node]
                })
              )
            }
          : definition
      )
    },
    [command.payload.definitionId, node.nodeId]
  );
}

function applyUpdateMenuNodeCommand(
  session: AuthoringSession,
  command: UpdateMenuNodeCommand
): AuthoringSession {
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      menuDefinitions: session.gameProject.menuDefinitions.map((definition) =>
        definition.definitionId === command.payload.definitionId
          ? {
              ...definition,
              root: mapUINodeTree(
                definition.root,
                command.payload.nodeId,
                (node) =>
                  normalizeUINode({
                    ...node,
                    ...command.payload.patch,
                    nodeId: node.nodeId,
                    children: command.payload.patch.children ?? node.children
                  })
              )
            }
          : definition
      )
    },
    [command.payload.definitionId, command.payload.nodeId]
  );
}

function applyRemoveMenuNodeCommand(
  session: AuthoringSession,
  command: RemoveMenuNodeCommand
): AuthoringSession {
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      menuDefinitions: session.gameProject.menuDefinitions.map((definition) =>
        definition.definitionId === command.payload.definitionId
          ? {
              ...definition,
              root: removeUINodeFromTree(
                definition.root,
                command.payload.nodeId
              )
            }
          : definition
      )
    },
    [command.payload.definitionId, command.payload.nodeId]
  );
}

function applyUpdateHUDDefinitionCommand(
  session: AuthoringSession,
  command: UpdateHUDDefinitionCommand
): AuthoringSession {
  const hudDefinition = normalizeHUDDefinition(
    command.payload.definition,
    session.gameProject.identity.id
  );
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      hudDefinition
    },
    [hudDefinition.definitionId]
  );
}

function getExistingHUD(session: AuthoringSession): HUDDefinition {
  return normalizeHUDDefinition(
    session.gameProject.hudDefinition,
    session.gameProject.identity.id
  );
}

function applyAddHUDNodeCommand(
  session: AuthoringSession,
  command: AddHUDNodeCommand
): AuthoringSession {
  const hudDefinition = getExistingHUD(session);
  const node = normalizeUINode(command.payload.node);
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      hudDefinition: {
        ...hudDefinition,
        root: mapUINodeTree(
          hudDefinition.root,
          command.payload.parentNodeId,
          (parent) => ({ ...parent, children: [...parent.children, node] })
        )
      }
    },
    [hudDefinition.definitionId, node.nodeId]
  );
}

function applyUpdateHUDNodeCommand(
  session: AuthoringSession,
  command: UpdateHUDNodeCommand
): AuthoringSession {
  const hudDefinition = getExistingHUD(session);
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      hudDefinition: {
        ...hudDefinition,
        root: mapUINodeTree(
          hudDefinition.root,
          command.payload.nodeId,
          (node) =>
            normalizeUINode({
              ...node,
              ...command.payload.patch,
              nodeId: node.nodeId,
              children: command.payload.patch.children ?? node.children
            })
        )
      }
    },
    [hudDefinition.definitionId, command.payload.nodeId]
  );
}

function applyRemoveHUDNodeCommand(
  session: AuthoringSession,
  command: RemoveHUDNodeCommand
): AuthoringSession {
  const hudDefinition = getExistingHUD(session);
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      hudDefinition: {
        ...hudDefinition,
        root: removeUINodeFromTree(hudDefinition.root, command.payload.nodeId)
      }
    },
    [hudDefinition.definitionId, command.payload.nodeId]
  );
}

function applyUpdateUIThemeCommand(
  session: AuthoringSession,
  command: UpdateUIThemeCommand
): AuthoringSession {
  return commitProjectUICommand(
    session,
    command,
    {
      ...session.gameProject,
      uiTheme: normalizeUITheme(command.payload.theme)
    },
    [session.gameProject.identity.id]
  );
}

export function applyCommand(
  session: AuthoringSession,
  command: SemanticCommand
): AuthoringSession {
  if (command.kind === "CreateShaderGraph") {
    return applyCreateShaderGraphCommand(session, command);
  }

  if (command.kind === "RenameShaderGraph") {
    return applyRenameShaderGraphCommand(session, command);
  }

  if (command.kind === "DeleteShaderGraph") {
    return applyDeleteShaderGraphCommand(session, command);
  }

  if (command.kind === "UpdateShaderNode") {
    return applyUpdateShaderNodeCommand(session, command);
  }

  if (command.kind === "RemoveShaderNode") {
    return applyRemoveShaderNodeCommand(session, command);
  }

  if (command.kind === "AddShaderEdge") {
    return applyAddShaderEdgeCommand(session, command);
  }

  if (command.kind === "RemoveShaderEdge") {
    return applyRemoveShaderEdgeCommand(session, command);
  }

  if (command.kind === "UpdateShaderParameter") {
    return applyUpdateShaderParameterCommand(session, command);
  }

  if (command.kind === "RemoveShaderParameter") {
    return applyRemoveShaderParameterCommand(session, command);
  }

  if (command.kind === "SetAssetDefaultShader") {
    return applySetAssetDefaultShaderCommand(session, command);
  }
  if (command.kind === "SetAssetDefaultShaderParameterOverride") {
    return applySetAssetDefaultShaderParameterOverrideCommand(session, command);
  }
  if (command.kind === "ClearAssetDefaultShaderParameterOverride") {
    return applyClearAssetDefaultShaderParameterOverrideCommand(
      session,
      command
    );
  }

  if (command.kind === "UpdateEnvironmentDefinition") {
    return applyEnvironmentDefinitionCommand(session, command);
  }

  if (command.kind === "AddPostProcessShader") {
    return applyAddPostProcessShaderCommand(session, command);
  }

  if (command.kind === "UpdatePostProcessShaderOrder") {
    return applyUpdatePostProcessShaderOrderCommand(session, command);
  }

  if (
    command.kind === "UpdatePostProcessShaderParameter" ||
    command.kind === "TogglePostProcessShader" ||
    command.kind === "RemovePostProcessShader"
  ) {
    return updatePostProcessBindingOverride(session, command);
  }

  if (command.kind === "UpdatePlayerDefinition") {
    return applyPlayerDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateMechanicsDefinition") {
    return applyMechanicsDefinitionCommand(session, command);
  }

  if (command.kind === "UpdatePluginConfiguration") {
    return applyUpdatePluginConfigurationCommand(session, command);
  }

  if (command.kind === "DeletePluginConfiguration") {
    return applyDeletePluginConfigurationCommand(session, command);
  }

  if (command.kind === "BumpMajorVersion") {
    return applyBumpMajorVersionCommand(session, command);
  }

  if (command.kind === "CreateMenuDefinition") {
    return applyCreateMenuDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateMenuDefinition") {
    return applyUpdateMenuDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteMenuDefinition") {
    return applyDeleteMenuDefinitionCommand(session, command);
  }

  if (command.kind === "AddMenuNode") {
    return applyAddMenuNodeCommand(session, command);
  }

  if (command.kind === "UpdateMenuNode") {
    return applyUpdateMenuNodeCommand(session, command);
  }

  if (command.kind === "RemoveMenuNode") {
    return applyRemoveMenuNodeCommand(session, command);
  }

  if (command.kind === "UpdateHUDDefinition") {
    return applyUpdateHUDDefinitionCommand(session, command);
  }

  if (command.kind === "AddHUDNode") {
    return applyAddHUDNodeCommand(session, command);
  }

  if (command.kind === "UpdateHUDNode") {
    return applyUpdateHUDNodeCommand(session, command);
  }

  if (command.kind === "RemoveHUDNode") {
    return applyRemoveHUDNodeCommand(session, command);
  }

  if (command.kind === "UpdateUITheme") {
    return applyUpdateUIThemeCommand(session, command);
  }

  if (command.kind === "CreateNPCDefinition") {
    return applyCreateNPCDefinitionCommand(session, command);
  }

  if (command.kind === "CreateItemDefinition") {
    return applyCreateItemDefinitionCommand(session, command);
  }

  if (command.kind === "CreateSpellDefinition") {
    return applyCreateSpellDefinitionCommand(session, command);
  }

  if (command.kind === "CreateDocumentDefinition") {
    return applyCreateDocumentDefinitionCommand(session, command);
  }

  if (command.kind === "CreateDialogueDefinition") {
    return applyCreateDialogueDefinitionCommand(session, command);
  }

  if (command.kind === "CreateQuestDefinition") {
    return applyCreateQuestDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateNPCDefinition") {
    return applyUpdateNPCDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateItemDefinition") {
    return applyUpdateItemDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateSpellDefinition") {
    return applyUpdateSpellDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateDocumentDefinition") {
    return applyUpdateDocumentDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateDialogueDefinition") {
    return applyUpdateDialogueDefinitionCommand(session, command);
  }

  if (command.kind === "UpdateQuestDefinition") {
    return applyUpdateQuestDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteNPCDefinition") {
    return applyDeleteNPCDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteItemDefinition") {
    return applyDeleteItemDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteSpellDefinition") {
    return applyDeleteSpellDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteDocumentDefinition") {
    return applyDeleteDocumentDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteDialogueDefinition") {
    return applyDeleteDialogueDefinitionCommand(session, command);
  }

  if (command.kind === "DeleteQuestDefinition") {
    return applyDeleteQuestDefinitionCommand(session, command);
  }

  const activeRegion = getActiveRegion(session);
  if (!activeRegion) return session;
  // Plan 058 §058.1 — the executor operates on the Base + Overlay
  // pair. The active Scene is the Ambient Context that decides
  // which Scene presence / overlay-scoped commands land in.
  const activeScene = getActiveScene(session);
  if (!activeScene) return session;

  const result = executeCommand(
    { region: activeRegion, scene: activeScene },
    command
  );
  const newHistory = pushTransaction(session.history, result.transaction);

  const newRegions = new Map(session.regions);
  newRegions.set(result.region.identity.id, result.region);

  return {
    ...session,
    gameProject:
      result.scene === activeScene
        ? session.gameProject
        : {
            ...session.gameProject,
            scenes: session.gameProject.scenes.map((scene) =>
              scene.sceneId === result.scene.sceneId ? result.scene : scene
            )
          },
    regions: newRegions,
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: newHistory,
    isDirty: true
  };
}

export function undoSession(session: AuthoringSession): AuthoringSession {
  if (session.undoStack.length === 0) return session;

  const previous = session.undoStack[session.undoStack.length - 1];
  return restoreCheckpoint(
    session,
    previous,
    session.undoStack.slice(0, -1),
    [...session.redoStack, checkpointSession(session)],
    {
      undoStack: session.history.undoStack.slice(0, -1),
      redoStack: [
        ...session.history.redoStack,
        ...session.history.undoStack.slice(-1)
      ]
    }
  );
}

export function redoSession(session: AuthoringSession): AuthoringSession {
  if (session.redoStack.length === 0) return session;

  const next = session.redoStack[session.redoStack.length - 1];
  return restoreCheckpoint(
    session,
    next,
    [...session.undoStack, checkpointSession(session)],
    session.redoStack.slice(0, -1),
    {
      undoStack: [
        ...session.history.undoStack,
        ...session.history.redoStack.slice(-1)
      ],
      redoStack: session.history.redoStack.slice(0, -1)
    }
  );
}

export function addRegionToSession(
  session: AuthoringSession,
  region: RegionDocument
): AuthoringSession {
  const normalizedRegion = normalizeRegionDocumentForLoad(
    region,
    session.contentLibrary
  );
  const newRegions = new Map(session.regions);
  newRegions.set(normalizedRegion.identity.id, normalizedRegion);

  const newProject: GameProject = {
    ...session.gameProject,
    regionRegistry: [
      ...session.gameProject.regionRegistry,
      { regionId: normalizedRegion.identity.id }
    ]
  };

  return {
    ...session,
    gameProject: newProject,
    regions: newRegions,
    activeRegionId: normalizedRegion.identity.id,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: true
  };
}

// --- Plan 058 §058.3 — Scene management (session-level, like
// addRegionToSession: structural mutations outside the semantic
// command/undo stream) ---

function withScenes(
  session: AuthoringSession,
  scenes: Scene[]
): AuthoringSession {
  return {
    ...session,
    gameProject: { ...session.gameProject, scenes },
    isDirty: true
  };
}

/** Append a new empty Scene (no overlays anywhere — base assets
 *  show through automatically) and make it active. */
export function addSceneToSession(
  session: AuthoringSession,
  options: { displayName: string }
): AuthoringSession {
  const maxOrder = session.gameProject.scenes.reduce(
    (max, scene) => Math.max(max, scene.sceneOrder),
    -1
  );
  const scene = createDefaultScene({
    displayName: options.displayName.trim() || "Untitled Scene",
    sceneOrder: maxOrder + 1
  });
  return {
    ...withScenes(session, [...session.gameProject.scenes, scene]),
    activeSceneId: scene.sceneId
  };
}

/** Patch Scene metadata + per-Scene overrides (Plan 058 §058.6 —
 *  the Scene properties panel writes through here). */
export function updateSceneInSession(
  session: AuthoringSession,
  sceneId: string,
  patch: Partial<
    Pick<
      Scene,
      | "displayName"
      | "description"
      | "notes"
      | "unlockCondition"
      | "startingRegionId"
      | "environmentOverride"
      | "audioOverride"
      | "transitionConfig"
    >
  >
): AuthoringSession {
  if (!session.gameProject.scenes.some((scene) => scene.sceneId === sceneId)) {
    return session;
  }
  return withScenes(
    session,
    session.gameProject.scenes.map((scene) =>
      scene.sceneId === sceneId ? { ...scene, ...patch } : scene
    )
  );
}

/** Delete a Scene and its overlays. Refuses to delete the last
 *  Scene (a project always has >= 1); the active pointer moves to
 *  the first remaining Scene. Destructive — the caller confirms. */
export function deleteSceneFromSession(
  session: AuthoringSession,
  sceneId: string
): AuthoringSession {
  const scenes = session.gameProject.scenes;
  if (scenes.length <= 1) return session;
  const remaining = scenes.filter((scene) => scene.sceneId !== sceneId);
  if (remaining.length === scenes.length) return session;
  return {
    ...withScenes(session, remaining),
    activeSceneId:
      session.activeSceneId === sceneId
        ? remaining[0]?.sceneId ?? null
        : session.activeSceneId
  };
}

/** Swap a Scene one step up/down the narrative order. */
export function reorderSceneInSession(
  session: AuthoringSession,
  sceneId: string,
  direction: "up" | "down"
): AuthoringSession {
  const scenes = [...session.gameProject.scenes].sort(
    (left, right) => left.sceneOrder - right.sceneOrder
  );
  const index = scenes.findIndex((scene) => scene.sceneId === sceneId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= scenes.length) {
    return session;
  }
  const reordered = [...scenes];
  [reordered[index], reordered[targetIndex]] = [
    reordered[targetIndex]!,
    reordered[index]!
  ];
  return withScenes(
    session,
    reordered.map((scene, order) => ({ ...scene, sceneOrder: order }))
  );
}

/**
 * Move a placed asset between the region base and the ACTIVE
 * Scene's overlay (Plan 058 §058.3 scope conversion). The asset's
 * folder assignment is cleared when its folder doesn't exist in
 * the destination scope — folders don't convert with their
 * contents.
 */
export function convertAssetScopeInSession(
  session: AuthoringSession,
  options: { regionId: string; instanceId: string }
): AuthoringSession {
  const region = session.regions.get(options.regionId);
  const activeScene = getActiveScene(session);
  if (!region || !activeScene) return session;

  const overlay = activeScene.regionOverlays[options.regionId];
  const inBase = region.placedAssets.find(
    (asset) => asset.instanceId === options.instanceId
  );
  const inOverlay = overlay?.placedAssets.find(
    (asset) => asset.instanceId === options.instanceId
  );
  const source = inBase ?? inOverlay;
  if (!source) return session;

  const destinationFolders = inBase
    ? overlay?.folders ?? []
    : region.folders;
  const moved: PlacedAssetInstance = {
    ...source,
    parentFolderId: destinationFolders.some(
      (folder) => folder.folderId === source.parentFolderId
    )
      ? source.parentFolderId
      : null
  };

  const newRegions = new Map(session.regions);
  newRegions.set(options.regionId, {
    ...region,
    placedAssets: inBase
      ? region.placedAssets.filter(
          (asset) => asset.instanceId !== options.instanceId
        )
      : [...region.placedAssets, moved]
  });

  const newScenes = session.gameProject.scenes.map((scene) => {
    if (scene.sceneId !== activeScene.sceneId) return scene;
    const current =
      scene.regionOverlays[options.regionId] ?? createRegionSceneOverlay();
    return {
      ...scene,
      regionOverlays: {
        ...scene.regionOverlays,
        [options.regionId]: {
          ...current,
          placedAssets: inBase
            ? [...current.placedAssets, moved]
            : current.placedAssets.filter(
                (asset) => asset.instanceId !== options.instanceId
              )
        }
      }
    };
  });

  return {
    ...withScenes(session, newScenes),
    regions: newRegions
  };
}

/**
 * Copy a presence (or overlay asset) from one Scene's overlay
 * into another's, same region, same transform. Mints a NEW id so
 * a later copy back can never collide inside one overlay.
 */
export function copyOverlayEntryToScene(
  session: AuthoringSession,
  options: {
    fromSceneId: string;
    toSceneId: string;
    regionId: string;
    kind: "npc" | "item" | "player" | "asset";
    id: string;
  }
): AuthoringSession {
  if (options.fromSceneId === options.toSceneId) return session;
  const fromScene = session.gameProject.scenes.find(
    (scene) => scene.sceneId === options.fromSceneId
  );
  const toScene = session.gameProject.scenes.find(
    (scene) => scene.sceneId === options.toSceneId
  );
  const fromOverlay = fromScene?.regionOverlays[options.regionId];
  if (!fromScene || !toScene || !fromOverlay) return session;

  const target =
    toScene.regionOverlays[options.regionId] ?? createRegionSceneOverlay();
  let nextTarget: RegionSceneOverlay | null = null;

  if (options.kind === "npc") {
    const source = fromOverlay.npcPresences.find(
      (presence) => presence.presenceId === options.id
    );
    if (source) {
      nextTarget = {
        ...target,
        npcPresences: [
          ...target.npcPresences,
          { ...source, presenceId: createNPCPresenceId() }
        ]
      };
    }
  } else if (options.kind === "item") {
    const source = fromOverlay.itemPresences.find(
      (presence) => presence.presenceId === options.id
    );
    if (source) {
      nextTarget = {
        ...target,
        itemPresences: [
          ...target.itemPresences,
          { ...source, presenceId: createItemPresenceId() }
        ]
      };
    }
  } else if (options.kind === "player") {
    const source =
      fromOverlay.playerPresence?.presenceId === options.id
        ? fromOverlay.playerPresence
        : null;
    // Per-(Scene, region) singularity: never clobber an existing
    // player spawn in the destination.
    if (source && !target.playerPresence) {
      nextTarget = {
        ...target,
        playerPresence: { ...source, presenceId: createPlayerPresenceId() }
      };
    }
  } else {
    const source = fromOverlay.placedAssets.find(
      (asset) => asset.instanceId === options.id
    );
    if (source) {
      nextTarget = {
        ...target,
        placedAssets: [
          ...target.placedAssets,
          {
            ...source,
            instanceId: createPlacedAssetInstanceId(source.displayName),
            // Folders are per-overlay; the destination Scene
            // doesn't have the source's folder.
            parentFolderId: null
          }
        ]
      };
    }
  }

  if (!nextTarget) return session;
  return withScenes(
    session,
    session.gameProject.scenes.map((scene) =>
      scene.sceneId === options.toSceneId
        ? {
            ...scene,
            regionOverlays: {
              ...scene.regionOverlays,
              [options.regionId]: nextTarget!
            }
          }
        : scene
    )
  );
}

export function addAssetDefinitionToSession(
  session: AuthoringSession,
  assetDefinition: AssetDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.assetDefinitions.findIndex(
    (definition) => definition.definitionId === assetDefinition.definitionId
  );
  const existingDefinition =
    existingIndex >= 0
      ? (session.contentLibrary.assetDefinitions[existingIndex] ?? null)
      : null;
  const nextSurfaceSlots = assetDefinition.surfaceSlots.map((binding) => ({
    ...binding,
    surface:
      existingDefinition?.surfaceSlots?.find(
        (candidate) => candidate.slotName === binding.slotName
      )?.surface ??
      binding.surface ??
      null
  }));

  const nextDefinitions = [...session.contentLibrary.assetDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = {
      ...assetDefinition,
      surfaceSlots: nextSurfaceSlots
    };
  } else {
    nextDefinitions.push({
      ...assetDefinition,
      surfaceSlots: nextSurfaceSlots
    });
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function addEnvironmentDefinitionToSession(
  session: AuthoringSession,
  environmentDefinition: EnvironmentDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.environmentDefinitions.findIndex(
    (definition) =>
      definition.definitionId === environmentDefinition.definitionId
  );

  const nextDefinitions = [...session.contentLibrary.environmentDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = environmentDefinition;
  } else {
    nextDefinitions.push(environmentDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      environmentDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateAssetDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<
    Pick<
      AssetDefinition,
      "displayName" | "surfaceSlots" | "deform" | "effect" | "collider"
    >
  >
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: session.contentLibrary.assetDefinitions.map(
        (definition) =>
          definition.definitionId === definitionId
            ? {
                ...definition,
                ...patch
              }
            : definition
      )
    },
    isDirty: true
  };
}

export function removeAssetDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: session.contentLibrary.assetDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      )
    },
    isDirty: true
  };
}

export function addAudioClipDefinitionToSession(
  session: AuthoringSession,
  audioClipDefinition: AudioClipDefinition
): AuthoringSession {
  const existingIndex = (
    session.contentLibrary.audioClipDefinitions ?? []
  ).findIndex(
    (definition) => definition.definitionId === audioClipDefinition.definitionId
  );
  const nextDefinitions = [
    ...(session.contentLibrary.audioClipDefinitions ?? [])
  ];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = audioClipDefinition;
  } else {
    nextDefinitions.push(audioClipDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      audioClipDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateAudioClipDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<
    Pick<AudioClipDefinition, "displayName" | "source" | "durationSeconds">
  >
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      audioClipDefinitions: (
        session.contentLibrary.audioClipDefinitions ?? []
      ).map((definition) =>
        definition.definitionId === definitionId
          ? { ...definition, ...patch }
          : definition
      )
    },
    isDirty: true
  };
}

export function removeAudioClipDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      audioClipDefinitions: (
        session.contentLibrary.audioClipDefinitions ?? []
      ).filter((definition) => definition.definitionId !== definitionId),
      soundCueDefinitions: (
        session.contentLibrary.soundCueDefinitions ?? []
      ).map((cue) => ({
        ...cue,
        clips: cue.clips.filter(
          (clip) => clip.audioClipDefinitionId !== definitionId
        )
      }))
    },
    isDirty: true
  };
}

export function addSoundCueDefinitionToSession(
  session: AuthoringSession,
  soundCueDefinition: SoundCueDefinition
): AuthoringSession {
  const existingIndex = (
    session.contentLibrary.soundCueDefinitions ?? []
  ).findIndex(
    (definition) => definition.definitionId === soundCueDefinition.definitionId
  );
  const nextDefinitions = [
    ...(session.contentLibrary.soundCueDefinitions ?? [])
  ];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = soundCueDefinition;
  } else {
    nextDefinitions.push(soundCueDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      soundCueDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateSoundCueDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<SoundCueDefinition>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      soundCueDefinitions: (
        session.contentLibrary.soundCueDefinitions ?? []
      ).map((definition) =>
        definition.definitionId === definitionId
          ? { ...definition, ...patch, definitionId }
          : definition
      )
    },
    isDirty: true
  };
}

export function removeSoundCueDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  const clearCue = (cueDefinitionId: string | null | undefined) =>
    cueDefinitionId === definitionId ? null : (cueDefinitionId ?? null);
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      soundCueDefinitions: (
        session.contentLibrary.soundCueDefinitions ?? []
      ).filter((definition) => definition.definitionId !== definitionId)
    },
    gameProject: {
      ...session.gameProject,
      soundEventBindings: Object.fromEntries(
        Object.entries(session.gameProject.soundEventBindings ?? {}).map(
          ([eventKey, cueDefinitionId]) => [eventKey, clearCue(cueDefinitionId)]
        )
      )
    },
    regions: new Map(
      Array.from(session.regions.entries()).map(([regionId, region]) => [
        regionId,
        {
          ...region,
          audio: {
            ...region.audio,
            emitters: (region.audio?.emitters ?? []).filter(
              (emitter) => emitter.cueDefinitionId !== definitionId
            ),
            ambienceZones: (region.audio?.ambienceZones ?? []).filter(
              (zone) => zone.cueDefinitionId !== definitionId
            )
          }
        }
      ])
    ),
    isDirty: true
  };
}

export function setSoundEventBindingInSession(
  session: AuthoringSession,
  eventKey: RuntimeSoundEventKey,
  soundCueDefinitionId: string | null
): AuthoringSession {
  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      soundEventBindings: {
        ...session.gameProject.soundEventBindings,
        [eventKey]: soundCueDefinitionId
      }
    },
    isDirty: true
  };
}

export function updateAudioMixerInSession(
  session: AuthoringSession,
  patch: Partial<AudioMixerSettings>
): AuthoringSession {
  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      audioMixer: normalizeAudioMixerSettings({
        ...session.gameProject.audioMixer,
        ...patch
      })
    },
    isDirty: true
  };
}

/** Plan 059 §059.2 — replace the project credits roll. Shape-
 *  coerces but preserves text VERBATIM (no trims, no blank-line
 *  drops): the editor commits per keystroke like every other
 *  Studio field, and normalizing here would fight the cursor.
 *  `normalizeCreditsDefinition` cleans up at project load and at
 *  publish; the runtime roll skips blanks defensively. */
export function updateCreditsInSession(
  session: AuthoringSession,
  credits: Partial<CreditsDefinition>
): AuthoringSession {
  const sections = (credits.sections ?? []).map((section) => ({
    heading: typeof section?.heading === "string" ? section.heading : "",
    lines: (Array.isArray(section?.lines) ? section.lines : []).filter(
      (line): line is string => typeof line === "string"
    )
  }));
  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      creditsDefinition: { sections }
    },
    isDirty: true
  };
}

/** Plan 059 §059.1 — project music slots (default background
 *  music + credits theme). */
export function updateMusicBindingsInSession(
  session: AuthoringSession,
  patch: Partial<MusicBindings>
): AuthoringSession {
  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      musicBindings: normalizeMusicBindings({
        ...session.gameProject.musicBindings,
        ...patch
      })
    },
    isDirty: true
  };
}

export function addCharacterAnimationDefinitionToSession(
  session: AuthoringSession,
  characterAnimationDefinition: CharacterAnimationDefinition
): AuthoringSession {
  const existingIndex =
    session.contentLibrary.characterAnimationDefinitions.findIndex(
      (definition) =>
        definition.definitionId === characterAnimationDefinition.definitionId
    );
  const nextDefinitions = [
    ...session.contentLibrary.characterAnimationDefinitions
  ];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = characterAnimationDefinition;
  } else {
    nextDefinitions.push(characterAnimationDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      characterAnimationDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateCharacterAnimationDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<
    Pick<CharacterAnimationDefinition, "displayName" | "clipNames" | "source">
  >
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      characterAnimationDefinitions:
        session.contentLibrary.characterAnimationDefinitions.map(
          (definition) =>
            definition.definitionId === definitionId
              ? { ...definition, ...patch }
              : definition
        )
    },
    isDirty: true
  };
}

export function removeCharacterAnimationDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  // Mirror the model-removal cascade: clear any Player or NPC slot
  // bound to this definitionId so the runtime doesn't dereference a
  // dangling id.
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      characterAnimationDefinitions:
        session.contentLibrary.characterAnimationDefinitions.filter(
          (definition) => definition.definitionId !== definitionId
        )
    },
    gameProject: {
      ...session.gameProject,
      playerDefinition: {
        ...session.gameProject.playerDefinition,
        presentation: {
          ...session.gameProject.playerDefinition.presentation,
          animationAssetBindings: Object.fromEntries(
            Object.entries(
              session.gameProject.playerDefinition.presentation
                .animationAssetBindings
            ).map(([slot, bindingId]) => [
              slot,
              bindingId === definitionId ? null : bindingId
            ])
          ) as typeof session.gameProject.playerDefinition.presentation.animationAssetBindings
        }
      },
      npcDefinitions: session.gameProject.npcDefinitions.map(
        (npcDefinition) => ({
          ...npcDefinition,
          presentation: {
            ...npcDefinition.presentation,
            animationAssetBindings: Object.fromEntries(
              Object.entries(
                npcDefinition.presentation.animationAssetBindings
              ).map(([slot, bindingId]) => [
                slot,
                bindingId === definitionId ? null : bindingId
              ])
            ) as typeof npcDefinition.presentation.animationAssetBindings
          }
        })
      )
    },
    isDirty: true
  };
}

export function addCharacterModelDefinitionToSession(
  session: AuthoringSession,
  characterModelDefinition: CharacterModelDefinition
): AuthoringSession {
  const existingIndex =
    session.contentLibrary.characterModelDefinitions.findIndex(
      (definition) =>
        definition.definitionId === characterModelDefinition.definitionId
    );
  const nextDefinitions = [...session.contentLibrary.characterModelDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = characterModelDefinition;
  } else {
    nextDefinitions.push(characterModelDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      characterModelDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateCharacterModelDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<Pick<CharacterModelDefinition, "displayName" | "source">>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      characterModelDefinitions:
        session.contentLibrary.characterModelDefinitions.map((definition) =>
          definition.definitionId === definitionId
            ? { ...definition, ...patch }
            : definition
        )
    },
    isDirty: true
  };
}

export function removeCharacterModelDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  // Mirror animation-removal: also clear any Player/NPC binding
  // pointing at this definitionId so we don't leave dangling refs.
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      characterModelDefinitions:
        session.contentLibrary.characterModelDefinitions.filter(
          (definition) => definition.definitionId !== definitionId
        )
    },
    gameProject: {
      ...session.gameProject,
      playerDefinition: {
        ...session.gameProject.playerDefinition,
        presentation: {
          ...session.gameProject.playerDefinition.presentation,
          modelAssetDefinitionId:
            session.gameProject.playerDefinition.presentation
              .modelAssetDefinitionId === definitionId
              ? null
              : session.gameProject.playerDefinition.presentation
                  .modelAssetDefinitionId
        }
      },
      npcDefinitions: session.gameProject.npcDefinitions.map(
        (npcDefinition) => ({
          ...npcDefinition,
          presentation: {
            ...npcDefinition.presentation,
            modelAssetDefinitionId:
              npcDefinition.presentation.modelAssetDefinitionId === definitionId
                ? null
                : npcDefinition.presentation.modelAssetDefinitionId
          }
        })
      )
    },
    isDirty: true
  };
}

export function addTextureDefinitionToSession(
  session: AuthoringSession,
  textureDefinition: TextureDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.textureDefinitions.findIndex(
    (definition) => definition.definitionId === textureDefinition.definitionId
  );
  const nextDefinitions = [...session.contentLibrary.textureDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = textureDefinition;
  } else {
    nextDefinitions.push(textureDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      textureDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function addMaskTextureDefinitionToSession(
  session: AuthoringSession,
  maskTextureDefinition: MaskTextureDefinition
): AuthoringSession {
  const existingDefinitions =
    session.contentLibrary.maskTextureDefinitions ?? [];
  const existingIndex = existingDefinitions.findIndex(
    (definition) =>
      definition.definitionId === maskTextureDefinition.definitionId
  );
  const nextDefinitions = [...existingDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = maskTextureDefinition;
  } else {
    nextDefinitions.push(maskTextureDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      maskTextureDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function addMaterialDefinitionToSession(
  session: AuthoringSession,
  materialDefinition: MaterialDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.materialDefinitions.findIndex(
    (definition) => definition.definitionId === materialDefinition.definitionId
  );
  const nextDefinitions = [...session.contentLibrary.materialDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = materialDefinition;
  } else {
    nextDefinitions.push(materialDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      materialDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function addSurfaceDefinitionToSession(
  session: AuthoringSession,
  surfaceDefinition: SurfaceDefinition
): AuthoringSession {
  assertReusableSurfaceHasNoPaintedMasks(
    surfaceDefinition.surface,
    `SurfaceDefinition "${surfaceDefinition.definitionId}"`
  );
  const existingDefinitions = session.contentLibrary.surfaceDefinitions ?? [];
  const existingIndex = existingDefinitions.findIndex(
    (definition) => definition.definitionId === surfaceDefinition.definitionId
  );

  const nextDefinitions = [...existingDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = surfaceDefinition;
  } else {
    nextDefinitions.push(surfaceDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      surfaceDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateSurfaceDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<SurfaceDefinition>
): AuthoringSession {
  const existingDefinition =
    (session.contentLibrary.surfaceDefinitions ?? []).find(
      (definition) => definition.definitionId === definitionId
    ) ?? null;
  const nextDefinition = existingDefinition
    ? {
        ...existingDefinition,
        ...patch
      }
    : null;
  if (nextDefinition?.surface) {
    assertReusableSurfaceHasNoPaintedMasks(
      nextDefinition.surface,
      `SurfaceDefinition "${definitionId}"`
    );
  }
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      surfaceDefinitions: (session.contentLibrary.surfaceDefinitions ?? []).map(
        (definition) =>
          definition.definitionId === definitionId
            ? {
                ...definition,
                ...patch
              }
            : definition
      )
    },
    isDirty: true
  };
}

export function removeSurfaceDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      surfaceDefinitions: (
        session.contentLibrary.surfaceDefinitions ?? []
      ).filter((definition) => definition.definitionId !== definitionId)
    },
    isDirty: true
  };
}

export function updateMaterialDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<MaterialDefinition>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      materialDefinitions: session.contentLibrary.materialDefinitions.map(
        (definition) =>
          definition.definitionId === definitionId
            ? {
                ...definition,
                ...patch
              }
            : definition
      )
    },
    isDirty: true
  };
}

/**
 * Duplicate an existing MaterialDefinition as a new user-owned material.
 * Creates a fresh `definitionId` via createUuid and copies its PBR payload.
 * Strips any `metadata.builtIn` marker so the copy is treated as authored
 * content that can be freely edited and persisted. Adds a " (Copy)" suffix
 * to the display name unless caller provides a custom one.
 *
 * Used by the "Duplicate to edit" flow when the user tries to edit a
 * built-in material — we fork a local copy rather than mutating the
 * engine-owned definition. Returns the new material's id so the caller
 * can redirect selection / re-point bindings.
 */
export function duplicateMaterialDefinitionInSession(
  session: AuthoringSession,
  sourceDefinitionId: string,
  options: { displayName?: string; newDefinitionId?: string } = {}
): { session: AuthoringSession; newDefinitionId: string } | null {
  const source = session.contentLibrary.materialDefinitions.find(
    (definition) => definition.definitionId === sourceDefinitionId
  );
  if (!source) {
    return null;
  }
  const projectScope = session.gameProject.identity.id;
  const newDefinitionId =
    options.newDefinitionId ?? `${projectScope}:material:${createUuid()}`;
  const displayName = options.displayName ?? `${source.displayName} (Copy)`;
  const copy: MaterialDefinition = {
    definitionId: newDefinitionId,
    definitionKind: "material",
    displayName,
    pbr: {
      ...source.pbr,
      tiling: [...source.pbr.tiling]
    },
    shaderDefinitionId: source.shaderDefinitionId
    // metadata intentionally omitted so the copy is user-owned.
  };
  return {
    session: {
      ...session,
      contentLibrary: {
        ...session.contentLibrary,
        materialDefinitions: [
          ...session.contentLibrary.materialDefinitions,
          copy
        ]
      },
      isDirty: true
    },
    newDefinitionId
  };
}

export function removeMaterialDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      materialDefinitions: session.contentLibrary.materialDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      )
    },
    isDirty: true
  };
}

/**
 * "Duplicate to edit" for surfaces (Procreate-brush model): the
 * copy deep-clones the layer stack, gets a project-scoped id, and
 * omits metadata so it is user-owned (built-in originals are
 * factory-replaced on every load and cannot hold edits).
 */
export function duplicateSurfaceDefinitionInSession(
  session: AuthoringSession,
  sourceDefinitionId: string,
  options: { displayName?: string } = {}
): { session: AuthoringSession; newDefinitionId: string } | null {
  const source = (session.contentLibrary.surfaceDefinitions ?? []).find(
    (definition) => definition.definitionId === sourceDefinitionId
  );
  if (!source) {
    return null;
  }
  const projectScope = session.gameProject.identity.id;
  const newDefinitionId = `${projectScope}:surface:${createUuid()}`;
  const copy: SurfaceDefinition = {
    definitionId: newDefinitionId,
    definitionKind: "surface",
    displayName: options.displayName ?? `${source.displayName} (Copy)`,
    surface: cloneSurface(source.surface)
    // metadata intentionally omitted so the copy is user-owned.
  };
  return {
    session: {
      ...session,
      contentLibrary: {
        ...session.contentLibrary,
        surfaceDefinitions: [
          ...(session.contentLibrary.surfaceDefinitions ?? []),
          copy
        ]
      },
      isDirty: true
    },
    newDefinitionId
  };
}

export function removeTextureDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      textureDefinitions: session.contentLibrary.textureDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      )
    },
    isDirty: true
  };
}

/**
 * True when a texture definition is referenced anywhere: material
 * texture maps, or texture-content / texture-mask layers in
 * inline surfaces (assets + landscape channels). Referenced
 * textures cannot be deleted from the Library.
 */
export function textureDefinitionHasReferences(
  session: AuthoringSession,
  definitionId: string
): boolean {
  const usedByMaterial = session.contentLibrary.materialDefinitions.some(
    (material) =>
      [
        material.pbr.baseColorMap,
        material.pbr.normalMap,
        material.pbr.ormMap,
        material.pbr.roughnessMap,
        material.pbr.metallicMap,
        material.pbr.ambientOcclusionMap,
        material.pbr.emissiveMap
      ].includes(definitionId)
  );
  if (usedByMaterial) return true;

  const layerUsesTexture = (layer: {
    kind: string;
    content?: { kind: string; textureDefinitionId?: string };
    masks?: Array<{ kind: string; textureDefinitionId?: string }>;
  }): boolean => {
    if (
      (layer.kind === "appearance" || layer.kind === "emission") &&
      layer.content?.kind === "texture" &&
      layer.content.textureDefinitionId === definitionId
    ) {
      return true;
    }
    return (layer.masks ?? []).some(
      (mask) =>
        mask.kind === "texture" &&
        mask.textureDefinitionId === definitionId
    );
  };
  const surfaceUsesTexture = (binding: {
    kind: string;
    surface?: { layers: readonly unknown[] };
  } | null): boolean =>
    binding?.kind === "inline" &&
    Boolean(
      binding.surface?.layers.some((layer) =>
        layerUsesTexture(layer as Parameters<typeof layerUsesTexture>[0])
      )
    );

  const usedBySurfaceDefinition =
    session.contentLibrary.surfaceDefinitions?.some((definition) =>
      definition.surface.layers.some((layer) =>
        layerUsesTexture(layer as Parameters<typeof layerUsesTexture>[0])
      )
    ) ?? false;
  if (usedBySurfaceDefinition) return true;

  const usedByAsset = session.contentLibrary.assetDefinitions.some(
    (assetDefinition) =>
      assetDefinition.surfaceSlots.some((slot) =>
        surfaceUsesTexture(slot.surface as Parameters<typeof surfaceUsesTexture>[0])
      )
  );
  if (usedByAsset) return true;

  return getAllRegions(session).some((region) =>
    region.landscape.surfaceSlots.some((channel) =>
      surfaceUsesTexture(channel.surface as Parameters<typeof surfaceUsesTexture>[0])
    )
  );
}

export function updateMaskTextureDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<MaskTextureDefinition>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      maskTextureDefinitions: (
        session.contentLibrary.maskTextureDefinitions ?? []
      ).map((definition) =>
        definition.definitionId === definitionId
          ? {
              ...definition,
              ...patch
            }
          : definition
      )
    },
    isDirty: true
  };
}

export function removeMaskTextureDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      maskTextureDefinitions: (
        session.contentLibrary.maskTextureDefinitions ?? []
      ).filter((definition) => definition.definitionId !== definitionId)
    },
    isDirty: true
  };
}

export function assetDefinitionHasSceneReferences(
  session: AuthoringSession,
  definitionId: string
): boolean {
  // Plan 058 §058.1 — check the base layer of every region AND
  // every Scene's overlays. A definition placed only in Scene 3's
  // overlay is still referenced.
  const inBase = getAllRegions(session).some((region) =>
    region.placedAssets.some(
      (asset) => asset.assetDefinitionId === definitionId
    )
  );
  if (inBase) return true;
  return session.gameProject.scenes.some((scene) =>
    Object.values(scene.regionOverlays).some((overlay) =>
      overlay.placedAssets.some(
        (asset) => asset.assetDefinitionId === definitionId
      )
    )
  );
}

/** Recursively true when any nested object carries this assetDefinitionId
 *  (scatter layer asset specs, LOD specs — the key is unique to asset refs). */
function valueReferencesAssetDefinition(
  value: unknown,
  definitionId: string
): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) =>
      valueReferencesAssetDefinition(entry, definitionId)
    );
  }
  const record = value as Record<string, unknown>;
  if (record.assetDefinitionId === definitionId) return true;
  return Object.values(record).some((entry) =>
    valueReferencesAssetDefinition(entry, definitionId)
  );
}

/**
 * True when an asset definition is referenced anywhere: placed
 * instances (region base + Scene overlays), grass/flower/rock
 * scatter types, or surface layer stacks (library definitions,
 * asset slots, landscape channels). Referenced assets cannot be
 * deleted from the Library.
 */
export function assetDefinitionHasReferences(
  session: AuthoringSession,
  definitionId: string
): boolean {
  if (assetDefinitionHasSceneReferences(session, definitionId)) return true;

  const library = session.contentLibrary;
  const scatterTypes: unknown[] = [
    ...(library.grassTypeDefinitions ?? []),
    ...(library.flowerTypeDefinitions ?? []),
    ...(library.rockTypeDefinitions ?? [])
  ];
  if (
    scatterTypes.some((definition) =>
      valueReferencesAssetDefinition(definition, definitionId)
    )
  ) {
    return true;
  }

  if (
    (library.surfaceDefinitions ?? []).some((definition) =>
      valueReferencesAssetDefinition(definition.surface, definitionId)
    )
  ) {
    return true;
  }
  if (
    library.assetDefinitions.some(
      (definition) =>
        definition.definitionId !== definitionId &&
        valueReferencesAssetDefinition(definition.surfaceSlots, definitionId)
    )
  ) {
    return true;
  }
  return getAllRegions(session).some((region) =>
    region.landscape.surfaceSlots.some((channel) =>
      valueReferencesAssetDefinition(channel.surface, definitionId)
    )
  );
}

export function environmentDefinitionHasRegionBindings(
  session: AuthoringSession,
  definitionId: string
): boolean {
  return getAllRegions(session).some(
    (region) => region.environmentBinding.defaultEnvironmentId === definitionId
  );
}

export function materialDefinitionHasReferences(
  session: AuthoringSession,
  definitionId: string
): boolean {
  const boundInAssets = session.contentLibrary.assetDefinitions.some(
    (assetDefinition) =>
      assetDefinition.surfaceSlots.some(
        (binding) =>
          binding.surface?.kind === "inline" &&
          binding.surface.surface.layers.some(
            (layer) =>
              (layer.kind === "appearance" || layer.kind === "emission") &&
              layer.content.kind === "material" &&
              layer.content.materialDefinitionId === definitionId
          )
      )
  );
  if (boundInAssets) {
    return true;
  }

  return getAllRegions(session).some((region) =>
    region.landscape.surfaceSlots.some(
      (channel) =>
        channel.surface?.kind === "inline" &&
        channel.surface.surface.layers.some(
          (layer) =>
            (layer.kind === "appearance" || layer.kind === "emission") &&
            layer.content.kind === "material" &&
            layer.content.materialDefinitionId === definitionId
        )
    )
  );
}

export function createAssetDefinitionId(fileNameStem: string): string {
  return createScopedId(`asset:${fileNameStem}`);
}

export function createPlacedAssetInstanceId(fileNameStem: string): string {
  return createScopedId(`placed-asset:${fileNameStem}`);
}

export function createSceneFolderId(): string {
  return createScopedId("scene-folder");
}

export function markSessionClean(session: AuthoringSession): AuthoringSession {
  return { ...session, isDirty: false };
}
