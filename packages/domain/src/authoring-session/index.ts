/**
 * Authoring session: the canonical owner of in-memory authored documents.
 *
 * This is NOT a zustand store. It is a plain domain-owned container
 * for canonical authored truth, mutation history, and undo/redo.
 * Shell orchestration coordinates access to this session but does
 * not replace it as the source of truth.
 */

import type { GameProject } from "../game-project";
import { normalizeGameProject } from "../game-project";
import type { DocumentDefinition } from "../document-definition";
import type { RegionDocument } from "../region-authoring";
import { normalizeRegionDocumentForLoad } from "../io";
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
  UpdateDeploymentSettingsCommand,
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
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
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
  listCharacterModelDefinitions as listCharacterModelDefinitionsFromLibrary,
  listCharacterAnimationDefinitions as listCharacterAnimationDefinitionsFromLibrary,
  listAssetDefinitions as listAssetDefinitionsFromLibrary,
  listEnvironmentDefinitions as listEnvironmentDefinitionsFromLibrary,
  listMaterialDefinitions as listMaterialDefinitionsFromLibrary,
  listMaskTextureDefinitions as listMaskTextureDefinitionsFromLibrary,
  listSurfaceDefinitions as listSurfaceDefinitionsFromLibrary,
  listShaderDefinitions as listShaderDefinitionsFromLibrary,
  listTextureDefinitions as listTextureDefinitionsFromLibrary,
  normalizeContentLibrarySnapshot,
  synchronizeEnvironmentDefinition
} from "../content-library";
import type { ShaderGraphDocument, ShaderParameterOverride } from "../shader-graph";
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
}

export interface AuthoringSession {
  gameProject: GameProject;
  contentLibrary: ContentLibrarySnapshot;
  regions: Map<string, RegionDocument>;
  activeRegionId: string | null;
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
    activeRegionId: session.activeRegionId
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
    undoStack: nextUndoStack,
    redoStack: nextRedoStack,
    history: nextHistory,
    isDirty: true
  };
}

export function getActiveRegion(session: AuthoringSession): RegionDocument | null {
  if (!session.activeRegionId) return null;
  return session.regions.get(session.activeRegionId) ?? null;
}

export function getAllRegions(session: AuthoringSession): RegionDocument[] {
  return Array.from(session.regions.values());
}

export function getAllAssetDefinitions(
  session: AuthoringSession
): AssetDefinition[] {
  return listAssetDefinitionsFromLibrary(session.contentLibrary);
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

export function getAllNPCDefinitions(session: AuthoringSession): NPCDefinition[] {
  return session.gameProject.npcDefinitions;
}

export function getAllItemDefinitions(session: AuthoringSession): ItemDefinition[] {
  return session.gameProject.itemDefinitions;
}

export function getAllSpellDefinitions(session: AuthoringSession): SpellDefinition[] {
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

export function getHUDDefinition(session: AuthoringSession): HUDDefinition | null {
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
  const normalizedProject = normalizeGameProject(gameProject);
  const normalizedContentLibrary = normalizeContentLibrarySnapshot(
    contentLibrary,
    normalizedProject.identity.id
  );
  const regionMap = new Map<string, RegionDocument>();
  for (const region of regions) {
    regionMap.set(
      region.identity.id,
      normalizeRegionDocumentForLoad(region, normalizedContentLibrary)
    );
  }

  return {
    gameProject: normalizedProject,
    contentLibrary: normalizedContentLibrary,
    regions: regionMap,
    activeRegionId: regions[0]?.identity.id ?? null,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: false
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
  const definitionIndex = session.contentLibrary.environmentDefinitions.findIndex(
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
  const transaction = createTransactionForCommand(command, [command.payload.definitionId]);

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
>(
  value: T,
  shaderDefinitionId: string | null
): T {
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

  const currentDefinition = session.contentLibrary.shaderDefinitions[definitionIndex]!;
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
  const transaction = createTransactionForCommand(command, [shaderDefinitionId]);

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

function applyDeleteShaderGraphCommand(
  session: AuthoringSession,
  command: DeleteShaderGraphCommand
): AuthoringSession {
  const nextDefinitions = session.contentLibrary.shaderDefinitions.filter(
    (definition) =>
      definition.shaderDefinitionId !== command.payload.shaderDefinitionId
  );
  if (nextDefinitions.length === session.contentLibrary.shaderDefinitions.length) {
    return session;
  }

  const transaction = createTransactionForCommand(command, [
    command.payload.shaderDefinitionId
  ]);
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      shaderDefinitions: nextDefinitions,
      assetDefinitions: session.contentLibrary.assetDefinitions.map((definition) => ({
        ...definition,
        surfaceSlots: definition.surfaceSlots.map((slot) =>
          slot.surface?.kind === "inline" &&
          slot.surface.surface.layers.some(
            (layer) =>
              layer.kind === "appearance" &&
              layer.content.kind === "shader" &&
              layer.content.shaderDefinitionId === command.payload.shaderDefinitionId
          )
            ? { ...slot, surface: null }
            : slot
        ),
        deform:
          definition.deform?.kind === "shader" &&
          definition.deform.shaderDefinitionId === command.payload.shaderDefinitionId
            ? null
            : definition.deform,
        effect:
          definition.effect?.kind === "shader" &&
          definition.effect.shaderDefinitionId === command.payload.shaderDefinitionId
            ? null
            : definition.effect
      })),
      environmentDefinitions: session.contentLibrary.environmentDefinitions.map((definition) => ({
        ...definition,
        postProcessShaders: definition.postProcessShaders.filter(
          (binding) => binding.shaderDefinitionId !== command.payload.shaderDefinitionId
        )
      }))
    },
    regions: new Map(
      Array.from(session.regions.entries()).map(([regionId, region]) => [
        regionId,
        {
          ...region,
          scene: {
            ...region.scene,
            placedAssets: region.scene.placedAssets.map((asset) =>
              (asset.shaderOverrides ?? []).some(
                (override) =>
                  override.shaderDefinitionId === command.payload.shaderDefinitionId
              )
                ? {
                    ...asset,
                    shaderOverrides: (asset.shaderOverrides ?? []).filter(
                      (override) =>
                        override.shaderDefinitionId !== command.payload.shaderDefinitionId
                    ),
                    shaderParameterOverrides: []
                  }
                : asset
            ),
            npcPresences: region.scene.npcPresences.map((presence) =>
              (presence.shaderOverrides ?? []).some(
                (override) =>
                  override.shaderDefinitionId === command.payload.shaderDefinitionId
              )
                ? {
                    ...presence,
                    shaderOverrides: (presence.shaderOverrides ?? []).filter(
                      (override) =>
                        override.shaderDefinitionId !== command.payload.shaderDefinitionId
                    ),
                    shaderParameterOverrides: []
                  }
                : presence
            ),
            itemPresences: region.scene.itemPresences.map((presence) =>
              (presence.shaderOverrides ?? []).some(
                (override) =>
                  override.shaderDefinitionId === command.payload.shaderDefinitionId
              )
                ? {
                    ...presence,
                    shaderOverrides: (presence.shaderOverrides ?? []).filter(
                      (override) =>
                        override.shaderDefinitionId !== command.payload.shaderDefinitionId
                    ),
                    shaderParameterOverrides: []
                  }
                : presence
            )
          }
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
      nodes: definition.nodes.filter((node) => node.nodeId !== command.payload.nodeId),
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
        ...definition.edges.filter((edge) => edge.edgeId !== command.payload.edge.edgeId),
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
      edges: definition.edges.filter((edge) => edge.edgeId !== command.payload.edgeId),
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
        (parameter) => parameter.parameterId === command.payload.parameter.parameterId
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
  const nextDefinitions = session.contentLibrary.assetDefinitions.map((definition) =>
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
  const transaction = createTransactionForCommand(command, [command.payload.definitionId]);

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
              binding.shaderDefinitionId !== command.payload.binding.shaderDefinitionId
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
          (definition) => definition.definitionId === command.payload.environmentDefinitionId
        ) === undefined
          ? session.contentLibrary.environmentDefinitions[0]!
          : {
              ...session.contentLibrary.environmentDefinitions.find(
                (definition) => definition.definitionId === command.payload.environmentDefinitionId
              )!,
              postProcessShaders: session.contentLibrary.environmentDefinitions
                .find(
                  (definition) =>
                    definition.definitionId === command.payload.environmentDefinitionId
                )!
                .postProcessShaders.map((binding) =>
                  binding.shaderDefinitionId === command.payload.shaderDefinitionId
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
                ? ((
                    () => {
                      const value = command.payload.override.value;
                      if (
                        Array.isArray(value) &&
                        value.length >= 3 &&
                        value.every(
                          (channel) =>
                            typeof channel === "number" && Number.isFinite(channel)
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
                  )
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
        (binding) => binding.shaderDefinitionId !== command.payload.shaderDefinitionId
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

function applyUpdateDeploymentSettingsCommand(
  session: AuthoringSession,
  command: UpdateDeploymentSettingsCommand
): AuthoringSession {
  const transaction = createTransactionForCommand(command, [
    session.gameProject.identity.id
  ]);

  return {
    ...session,
    gameProject: {
      ...session.gameProject,
      deployment: command.payload.settings
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
      npcDefinitions: [...session.gameProject.npcDefinitions, normalizedDefinition]
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
  const nextDefinitions = session.gameProject.npcDefinitions.map((definition) =>
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
  const nextDefinitions = session.gameProject.itemDefinitions.map((definition) =>
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
  const nextDefinitions = session.gameProject.spellDefinitions.map((definition) =>
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
  const nextDefinitions = session.gameProject.documentDefinitions.map((definition) =>
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
  const nextDefinitions = session.gameProject.dialogueDefinitions.map((definition) =>
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
  const nextDefinitions = session.gameProject.questDefinitions.map((definition) =>
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
  const transaction = createTransactionForCommand(command, affectedAggregateIds);
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
              root: mapUINodeTree(definition.root, command.payload.nodeId, (node) =>
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
              root: removeUINodeFromTree(definition.root, command.payload.nodeId)
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
        root: mapUINodeTree(hudDefinition.root, command.payload.nodeId, (node) =>
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
    return applyClearAssetDefaultShaderParameterOverrideCommand(session, command);
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

  if (command.kind === "UpdatePluginConfiguration") {
    return applyUpdatePluginConfigurationCommand(session, command);
  }

  if (command.kind === "DeletePluginConfiguration") {
    return applyDeletePluginConfigurationCommand(session, command);
  }

  if (command.kind === "UpdateDeploymentSettings") {
    return applyUpdateDeploymentSettingsCommand(session, command);
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

  const result = executeCommand(activeRegion, command);
  const newHistory = pushTransaction(session.history, result.transaction);

  const newRegions = new Map(session.regions);
  newRegions.set(result.region.identity.id, result.region);

  return {
    ...session,
    regions: newRegions,
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: newHistory,
    isDirty: true
  };
}

export function undoSession(
  session: AuthoringSession
): AuthoringSession {
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

export function redoSession(
  session: AuthoringSession
): AuthoringSession {
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

export function addAssetDefinitionToSession(
  session: AuthoringSession,
  assetDefinition: AssetDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.assetDefinitions.findIndex(
    (definition) => definition.definitionId === assetDefinition.definitionId
  );
  const existingDefinition =
    existingIndex >= 0 ? session.contentLibrary.assetDefinitions[existingIndex] ?? null : null;
  const nextSurfaceSlots = assetDefinition.surfaceSlots.map((binding) => ({
    ...binding,
    surface:
      existingDefinition?.surfaceSlots?.find(
        (candidate) => candidate.slotName === binding.slotName
      )?.surface ?? binding.surface ?? null
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
    (definition) => definition.definitionId === environmentDefinition.definitionId
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
  patch: Partial<Pick<AssetDefinition, "displayName" | "surfaceSlots" | "deform" | "effect">>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: session.contentLibrary.assetDefinitions.map((definition) =>
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
        session.contentLibrary.characterAnimationDefinitions.map((definition) =>
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
          ) as typeof session.gameProject.playerDefinition.presentation
            .animationAssetBindings
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
  const existingDefinitions = session.contentLibrary.maskTextureDefinitions ?? [];
  const existingIndex = existingDefinitions.findIndex(
    (definition) => definition.definitionId === maskTextureDefinition.definitionId
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
      surfaceDefinitions: (session.contentLibrary.surfaceDefinitions ?? []).map((definition) =>
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
      surfaceDefinitions: (session.contentLibrary.surfaceDefinitions ?? []).filter(
        (definition) => definition.definitionId !== definitionId
      )
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
      materialDefinitions: session.contentLibrary.materialDefinitions.map((definition) =>
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
  const displayName =
    options.displayName ?? `${source.displayName} (Copy)`;
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

export function updateMaskTextureDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<MaskTextureDefinition>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      maskTextureDefinitions: (session.contentLibrary.maskTextureDefinitions ?? []).map(
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

export function removeMaskTextureDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      maskTextureDefinitions: (session.contentLibrary.maskTextureDefinitions ?? []).filter(
        (definition) => definition.definitionId !== definitionId
      )
    },
    isDirty: true
  };
}

export function assetDefinitionHasSceneReferences(
  session: AuthoringSession,
  definitionId: string
): boolean {
  return getAllRegions(session).some((region) =>
    region.scene.placedAssets.some(
      (asset) => asset.assetDefinitionId === definitionId
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
  const boundInAssets = session.contentLibrary.assetDefinitions.some((assetDefinition) =>
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

export function markSessionClean(
  session: AuthoringSession
): AuthoringSession {
  return { ...session, isDirty: false };
}
