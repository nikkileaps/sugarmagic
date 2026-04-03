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
  normalizeSpellDefinition,
  type SpellDefinition
} from "../spell-definition";
import {
  createDefaultPlayerDefinition,
  normalizePlayerDefinition,
  type PlayerDefinition
} from "../player-definition";
import {
  normalizePluginConfigurationRecords,
  type PluginConfigurationRecord,
  type PartialPluginConfigurationRecord
} from "../plugins";

export interface GameProject {
  identity: DocumentIdentity;
  displayName: string;
  gameRootPath: string;
  regionRegistry: RegionReference[];
  pluginConfigurations: PluginConfigurationRecord[];
  contentLibraryId: string | null;
  playerDefinition: PlayerDefinition;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
}

export function normalizeGameProject(
  gameProject: GameProject | (Omit<GameProject, "pluginConfigurations" | "playerDefinition" | "spellDefinitions" | "itemDefinitions" | "documentDefinitions" | "npcDefinitions" | "dialogueDefinitions" | "questDefinitions"> & {
    pluginConfigurations?: Array<PluginConfigurationRecord | PartialPluginConfigurationRecord> | null;
    playerDefinition?: Partial<PlayerDefinition> | null;
    spellDefinitions?: Array<Partial<SpellDefinition>> | null;
    itemDefinitions?: Array<Partial<ItemDefinition>> | null;
    documentDefinitions?: Array<Partial<DocumentDefinition>> | null;
    npcDefinitions?: Array<Partial<NPCDefinition>> | null;
    dialogueDefinitions?: Array<Partial<DialogueDefinition>> | null;
    questDefinitions?: Array<Partial<QuestDefinition>> | null;
  })
): GameProject {
  return {
    ...gameProject,
    pluginConfigurations: normalizePluginConfigurationRecords(
      gameProject.pluginConfigurations
    ),
    playerDefinition: normalizePlayerDefinition(
      gameProject.playerDefinition,
      gameProject.identity.id
    ),
    spellDefinitions: (gameProject.spellDefinitions ?? []).map((definition) =>
      normalizeSpellDefinition(definition)
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
    pluginConfigurations: [],
    contentLibraryId: `${slug}:content-library`,
    playerDefinition: createDefaultPlayerDefinition(slug),
    spellDefinitions: [],
    itemDefinitions: [],
    documentDefinitions: [],
    npcDefinitions: [],
    dialogueDefinitions: [],
    questDefinitions: []
  };
}
