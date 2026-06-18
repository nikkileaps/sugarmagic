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
import { normalizeNPCDefinition, type NPCDefinition } from "../npc-definition";
import {
  normalizeItemDefinition,
  type ItemDefinition
} from "../item-definition";
import {
  normalizeSpellDefinition,
  type SpellDefinition
} from "../spell-definition";
import {
  createDefaultMechanicsDefinition,
  normalizeMechanicsDefinition,
  type MechanicsDefinition
} from "../mechanics";
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
import type { SoundCategory } from "../content-library";

export type RuntimeSoundEventKey =
  | "game.menu-open"
  | "game.menu-close"
  | "ui.click"
  | "ui.hover"
  | "player.footstep"
  | "item.pickup"
  | "interaction.activate"
  | "spell.cast-success"
  | "spell.cast-fail"
  | "quest.reward";

export type SoundEventBindingMap = Partial<
  Record<RuntimeSoundEventKey, string | null>
>;

export type AudioMixerSettings = Record<"master" | SoundCategory, number>;

export function createDefaultAudioMixerSettings(): AudioMixerSettings {
  return {
    master: 1,
    music: 0.7,
    sfx: 1,
    ambient: 0.5,
    ui: 1,
    voice: 1
  };
}

export function normalizeAudioMixerSettings(
  mixer: Partial<AudioMixerSettings> | null | undefined
): AudioMixerSettings {
  const defaults = createDefaultAudioMixerSettings();
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const value = mixer?.[key as keyof AudioMixerSettings];
      return [
        key,
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, Math.min(1, value))
          : fallback
      ];
    })
  ) as AudioMixerSettings;
}

export function normalizeSoundEventBindings(
  bindings: Partial<Record<string, string | null>> | null | undefined
): SoundEventBindingMap {
  const validKeys: RuntimeSoundEventKey[] = [
    "game.menu-open",
    "game.menu-close",
    "ui.click",
    "ui.hover",
    "player.footstep",
    "item.pickup",
    "interaction.activate",
    "spell.cast-success",
    "spell.cast-fail",
    "quest.reward"
  ];
  return Object.fromEntries(
    validKeys.map((key) => {
      const value = bindings?.[key];
      return [
        key,
        typeof value === "string" && value.trim().length > 0 ? value : null
      ];
    })
  ) as SoundEventBindingMap;
}

export interface GameProject {
  identity: DocumentIdentity;
  displayName: string;
  majorVersion: number;
  /**
   * Per-major-version random suffixes that collision-resist the auto-derived
   * GCP project id. Keys are `v${majorVersion}` strings (e.g., `"v1"`, `"v2"`);
   * values are 5-character lowercase alphanumeric (base36) suffixes generated
   * client-side via `crypto.getRandomValues`. Generated lazily on first
   * SugarDeploy form mount per version and via the Cut New Major Version flow.
   * Historical entries are preserved forever so worktrees / `git checkout
   * v1.0.0` resolve back to the original v1 GCP project. Empty `{}` default
   * preserves back-compat for older project files. Story 45.4.7.
   */
  versionedProjectIdentifiers: Record<string, string>;
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
  soundEventBindings: SoundEventBindingMap;
  audioMixer: AudioMixerSettings;
  mechanics: MechanicsDefinition;
}

/**
 * Validate and project the persisted `versionedProjectIdentifiers` map to its
 * canonical shape. Entries that don't pass the `v\d+` key + 5-char alphanumeric
 * value shape are dropped silently (corrupt entries shouldn't break load).
 * Missing field collapses to `{}`. Used by `normalizeGameProject` so the
 * back-compat path for older project files survives.
 */
export function normalizeVersionedProjectIdentifiers(
  input: unknown
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^v\d+$/.test(key)) continue;
    if (typeof value !== "string" || !/^[a-z0-9]{5}$/.test(value)) continue;
    out[key] = value;
  }
  return out;
}

export function normalizeGameProject(
  gameProject:
    | GameProject
    | (Omit<
        GameProject,
        | "majorVersion"
        | "versionedProjectIdentifiers"
        | "deployment"
        | "pluginConfigurations"
        | "playerDefinition"
        | "spellDefinitions"
        | "itemDefinitions"
        | "documentDefinitions"
        | "npcDefinitions"
        | "dialogueDefinitions"
        | "questDefinitions"
        | "menuDefinitions"
        | "hudDefinition"
        | "uiTheme"
        | "soundEventBindings"
        | "audioMixer"
        | "mechanics"
      > & {
        majorVersion?: number | null;
        versionedProjectIdentifiers?: unknown;
        deployment?: Partial<DeploymentSettings> | null;
        pluginConfigurations?: Array<
          PluginConfigurationRecord | PartialPluginConfigurationRecord
        > | null;
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
        soundEventBindings?: Partial<Record<string, string | null>> | null;
        audioMixer?: Partial<AudioMixerSettings> | null;
        mechanics?: Partial<MechanicsDefinition> | null;
      })
): GameProject {
  const mechanics = normalizeMechanicsDefinition(gameProject.mechanics);
  const starterMenus = createDefaultMenuDefinitions(gameProject.identity.id);
  const sourceMenus =
    gameProject.menuDefinitions && gameProject.menuDefinitions.length > 0
      ? gameProject.menuDefinitions
      : starterMenus;
  const rawMajor = gameProject.majorVersion;
  const majorVersion =
    typeof rawMajor === "number" && Number.isFinite(rawMajor) && rawMajor >= 1
      ? Math.floor(rawMajor)
      : 1;
  return {
    ...gameProject,
    majorVersion,
    versionedProjectIdentifiers: normalizeVersionedProjectIdentifiers(
      gameProject.versionedProjectIdentifiers
    ),
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
    documentDefinitions: (gameProject.documentDefinitions ?? []).map(
      (definition) => normalizeDocumentDefinition(definition)
    ),
    npcDefinitions: (gameProject.npcDefinitions ?? []).map((definition) =>
      normalizeNPCDefinition(definition)
    ),
    dialogueDefinitions: (gameProject.dialogueDefinitions ?? []).map(
      (definition) => normalizeDialogueDefinition(definition)
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
    uiTheme: normalizeUITheme(gameProject.uiTheme ?? createDefaultUITheme()),
    soundEventBindings: normalizeSoundEventBindings(
      gameProject.soundEventBindings
    ),
    audioMixer: normalizeAudioMixerSettings(gameProject.audioMixer),
    mechanics
  };
}

export function createDefaultGameProject(
  gameName: string,
  slug: string
): GameProject {
  return {
    identity: { id: slug, schema: "GameProject", version: 1 },
    displayName: gameName,
    majorVersion: 1,
    versionedProjectIdentifiers: {},
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
    uiTheme: createDefaultUITheme(),
    soundEventBindings: normalizeSoundEventBindings(null),
    audioMixer: createDefaultAudioMixerSettings(),
    mechanics: createDefaultMechanicsDefinition()
  };
}
