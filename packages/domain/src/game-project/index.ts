import type { DocumentIdentity, RegionReference } from "../shared/identity";
import {
  normalizeDocumentDefinition,
  type DocumentDefinition
} from "../document-definition";
import {
  normalizeDialogueDefinition,
  type DialogueDefinition
} from "../dialogue-definition";
import {
  normalizeQuestDefinition,
  type QuestDefinition
} from "../quest-definition";
import {
  normalizeNPCDefinition,
  type NPCDefinition
} from "../npc-definition";
import {
  normalizeItemDefinition,
  type ItemDefinition
} from "../item-definition";
import {
  createDefaultPlayerDefinition,
  normalizePlayerDefinition,
  type PlayerDefinition
} from "../player-definition";

export interface GameProject {
  identity: DocumentIdentity;
  displayName: string;
  gameRootPath: string;
  regionRegistry: RegionReference[];
  pluginConfigIds: string[];
  contentLibraryId: string | null;
  playerDefinition: PlayerDefinition;
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
}

export function normalizeGameProject(
  gameProject: GameProject | (Omit<GameProject, "playerDefinition" | "itemDefinitions" | "documentDefinitions" | "npcDefinitions" | "dialogueDefinitions" | "questDefinitions"> & {
    playerDefinition?: Partial<PlayerDefinition> | null;
    itemDefinitions?: Array<Partial<ItemDefinition>> | null;
    documentDefinitions?: Array<Partial<DocumentDefinition>> | null;
    npcDefinitions?: Array<Partial<NPCDefinition>> | null;
    dialogueDefinitions?: Array<Partial<DialogueDefinition>> | null;
    questDefinitions?: Array<Partial<QuestDefinition>> | null;
  })
): GameProject {
  return {
    ...gameProject,
    playerDefinition: normalizePlayerDefinition(
      gameProject.playerDefinition,
      gameProject.identity.id
    ),
    itemDefinitions: (gameProject.itemDefinitions ?? []).map((definition) =>
      normalizeItemDefinition(definition)
    ),
    documentDefinitions: (gameProject.documentDefinitions ?? []).map((definition) =>
      normalizeDocumentDefinition(definition)
    ),
    npcDefinitions: (gameProject.npcDefinitions ?? []).map((definition) =>
      normalizeNPCDefinition(definition)
    ),
    dialogueDefinitions: (gameProject.dialogueDefinitions ?? []).map((definition) =>
      normalizeDialogueDefinition(definition)
    ),
    questDefinitions: (gameProject.questDefinitions ?? []).map((definition) =>
      normalizeQuestDefinition(definition)
    )
  };
}

export function createDefaultGameProject(
  gameName: string,
  slug: string
): GameProject {
  return {
    identity: { id: slug, schema: "GameProject", version: 1 },
    displayName: gameName,
    gameRootPath: ".",
    regionRegistry: [],
    pluginConfigIds: [],
    contentLibraryId: `${slug}:content-library`,
    playerDefinition: createDefaultPlayerDefinition(slug),
    itemDefinitions: [],
    documentDefinitions: [],
    npcDefinitions: [],
    dialogueDefinitions: [],
    questDefinitions: []
  };
}
