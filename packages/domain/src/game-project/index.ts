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
  // Story 45.7.5 — `deployment` and `versionedProjectIdentifiers` moved
  // off this type and into the SugarDeploy plugin's
  // `pluginConfigurations[id="sugardeploy"].config` slot. The domain type
  // carries only game-authoring concerns now; deploy-shaped concerns live
  // in the plugin's namespaced state. `majorVersion` stays here because
  // it's a game-authoring concept (save-game compat, changelog, UI
  // display) independent of deployment.
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

// Story 45.7.5 — plugin id literal that matches `SUGARDEPLOY_PLUGIN_ID`
// in the SugarDeploy plugin source. Inlined here (rather than imported)
// because `packages/domain` cannot depend on `packages/plugins` without
// introducing a cycle. The migration below is the ONLY domain code
// that should reference this string; touch this constant if and only if
// the plugin id ever changes in the plugins package.
const SUGARDEPLOY_PLUGIN_ID_LITERAL = "sugardeploy";

/**
 * Migrate legacy top-level `deployment` + `versionedProjectIdentifiers`
 * fields (pre-45.7.5) into the SugarDeploy plugin's
 * pluginConfigurations[].config slot. Returns the updated
 * pluginConfigurations array. Idempotent: when no legacy fields are
 * present, returns the input unchanged. When the legacy field is set
 * AND the slot is also set (e.g., callers spreading an already-migrated
 * project and overriding `deployment: {...}`), the explicit legacy
 * field wins — that's the only way it could have been set by a caller
 * after normalize stripped it from disk, so it represents intent. Real
 * round-tripped files only ever have one shape or the other.
 */
function migrateLegacyDeployFields(
  pluginConfigurations: PluginConfigurationRecord[],
  legacyDeployment: unknown,
  legacyVersionedProjectIdentifiers: unknown
): PluginConfigurationRecord[] {
  const hasLegacyDeployment =
    legacyDeployment !== undefined && legacyDeployment !== null;
  const hasLegacyVPI =
    legacyVersionedProjectIdentifiers !== undefined &&
    legacyVersionedProjectIdentifiers !== null;
  if (!hasLegacyDeployment && !hasLegacyVPI) return pluginConfigurations;

  const existingRecord = pluginConfigurations.find(
    (record) => record.pluginId === SUGARDEPLOY_PLUGIN_ID_LITERAL
  );
  const existingConfig: Record<string, unknown> =
    (existingRecord?.config as Record<string, unknown> | undefined) ?? {};

  const nextConfig: Record<string, unknown> = { ...existingConfig };
  if (hasLegacyDeployment) {
    nextConfig.settings = normalizeDeploymentSettings(
      legacyDeployment as Partial<DeploymentSettings>
    );
  }
  if (hasLegacyVPI) {
    nextConfig.versionedProjectIdentifiers = normalizeVersionedProjectIdentifiers(
      legacyVersionedProjectIdentifiers
    );
  }

  const nextRecord: PluginConfigurationRecord = existingRecord
    ? { ...existingRecord, config: nextConfig }
    : {
        identity: {
          id: `${SUGARDEPLOY_PLUGIN_ID_LITERAL}-config`,
          schema: "PluginConfiguration",
          version: 1
        },
        pluginId: SUGARDEPLOY_PLUGIN_ID_LITERAL,
        enabled: false,
        config: nextConfig
      };

  const remaining = pluginConfigurations.filter(
    (record) => record.pluginId !== SUGARDEPLOY_PLUGIN_ID_LITERAL
  );
  return [...remaining, nextRecord];
}

export function normalizeGameProject(
  gameProject:
    | GameProject
    | (Omit<
        GameProject,
        | "majorVersion"
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
        // Legacy fields accepted on input for back-compat with pre-45.7.5
        // project.sgrmagic files. The migration below lifts them into
        // pluginConfigurations[id="sugardeploy"].config and DROPS them
        // from the output shape.
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

  // Story 45.7.5 — destructure the legacy fields off the spread so they
  // don't leak into the GameProject output. The migration below lifts
  // them into the SugarDeploy plugin-config slot before normalizing the
  // plugin configurations array.
  const {
    deployment: legacyDeployment,
    versionedProjectIdentifiers: legacyVersionedProjectIdentifiers,
    ...gameProjectRest
  } = gameProject as {
    deployment?: unknown;
    versionedProjectIdentifiers?: unknown;
  } & Record<string, unknown>;
  const migratedPluginConfigurations = migrateLegacyDeployFields(
    normalizePluginConfigurationRecords(
      gameProjectRest.pluginConfigurations as
        | Array<PluginConfigurationRecord | PartialPluginConfigurationRecord>
        | null
        | undefined
    ),
    legacyDeployment,
    legacyVersionedProjectIdentifiers
  );

  return {
    ...(gameProjectRest as unknown as GameProject),
    majorVersion,
    pluginConfigurations: migratedPluginConfigurations,
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
    questDefinitions: [],
    menuDefinitions: createDefaultMenuDefinitions(slug),
    hudDefinition: createDefaultHUD(slug),
    uiTheme: createDefaultUITheme(),
    soundEventBindings: normalizeSoundEventBindings(null),
    audioMixer: createDefaultAudioMixerSettings(),
    mechanics: createDefaultMechanicsDefinition()
  };
}
