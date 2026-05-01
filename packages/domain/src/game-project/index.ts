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
import {
  createDefaultDeploymentSettings,
  normalizeDeploymentSettings,
  type DeploymentSettings
} from "../deployment";
import {
  createDefaultHUD,
  createDefaultMenuDefinitions,
  createDefaultUITheme,
  normalizeHUDDefinition,
  normalizeMenuDefinition,
  normalizeUITheme,
  type HUDDefinition,
  type MenuDefinition,
  type UITheme
} from "../ui-definition";

export interface GameProject {
  identity: DocumentIdentity;
  displayName: string;
  gameRootPath: string;
  deployment: DeploymentSettings;
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
  menuDefinitions: MenuDefinition[];
  hudDefinition: HUDDefinition | null;
  uiTheme: UITheme;
}

export function normalizeGameProject(
  gameProject: GameProject | (Omit<GameProject, "deployment" | "pluginConfigurations" | "playerDefinition" | "spellDefinitions" | "itemDefinitions" | "documentDefinitions" | "npcDefinitions" | "dialogueDefinitions" | "questDefinitions" | "menuDefinitions" | "hudDefinition" | "uiTheme"> & {
    deployment?: Partial<DeploymentSettings> | null;
    pluginConfigurations?: Array<PluginConfigurationRecord | PartialPluginConfigurationRecord> | null;
    playerDefinition?: Partial<PlayerDefinition> | null;
    spellDefinitions?: Array<Partial<SpellDefinition>> | null;
    itemDefinitions?: Array<Partial<ItemDefinition>> | null;
    documentDefinitions?: Array<Partial<DocumentDefinition>> | null;
    npcDefinitions?: Array<Partial<NPCDefinition>> | null;
    dialogueDefinitions?: Array<Partial<DialogueDefinition>> | null;
    questDefinitions?: Array<Partial<QuestDefinition>> | null;
    menuDefinitions?: Array<Partial<MenuDefinition>> | null;
    hudDefinition?: Partial<HUDDefinition> | null;
    uiTheme?: Partial<UITheme> | null;
  })
): GameProject {
  const starterMenus = createDefaultMenuDefinitions(gameProject.identity.id);
  const sourceMenus =
    gameProject.menuDefinitions && gameProject.menuDefinitions.length > 0
      ? gameProject.menuDefinitions
      : starterMenus;
  return {
    ...gameProject,
    deployment: normalizeDeploymentSettings(gameProject.deployment),
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
    ),
    menuDefinitions: sourceMenus.map((definition, index) =>
      normalizeMenuDefinition(definition, gameProject.identity.id, index)
    ),
    hudDefinition: normalizeHUDDefinition(
      gameProject.hudDefinition ?? createDefaultHUD(gameProject.identity.id),
      gameProject.identity.id
    ),
    uiTheme: normalizeUITheme(gameProject.uiTheme ?? createDefaultUITheme())
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
    deployment: createDefaultDeploymentSettings(),
    regionRegistry: [],
    pluginConfigurations: [],
    contentLibraryId: `${slug}:content-library`,
    playerDefinition: createDefaultPlayerDefinition(slug),
    spellDefinitions: [],
    itemDefinitions: [],
    documentDefinitions: [],
    npcDefinitions: [],
    dialogueDefinitions: [],
    questDefinitions: [],
    menuDefinitions: createDefaultMenuDefinitions(slug),
    hudDefinition: createDefaultHUD(slug),
    uiTheme: createDefaultUITheme()
  };
}
