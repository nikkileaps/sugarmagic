import type {
  ContentLibrarySnapshot,
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  PluginConfigurationRecord,
  NPCDefinition,
  PlayerDefinition,
  QuestDefinition,
  SpellDefinition,
  HUDDefinition,
  MenuDefinition,
  MechanicsDefinition,
  SoundEventBindingMap,
  AudioMixerSettings,
  UITheme,
  RegionDocument
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "@sugarmagic/plugins";
import {
  createAnonymousLocalIdentityProvider,
  createIndexedDBGameSaveStore,
  type GameSave,
  type GameSaveStore,
  type RuntimeBootModel
} from "@sugarmagic/runtime-core";
import { createWebRuntimeHost } from "@sugarmagic/target-web";

interface PreviewBootMessage {
  type: "PREVIEW_BOOT";
  regions: RegionDocument[];
  activeRegionId?: string | null;
  activeEnvironmentId?: string | null;
  installedPluginIds: string[];
  pluginRuntimeEnvironment?: RuntimePluginEnvironment;
  pluginConfigurations: PluginConfigurationRecord[];
  contentLibrary: ContentLibrarySnapshot;
  mechanics: MechanicsDefinition;
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
  assetSources: Record<string, string>;
  pluginBootPayloads?: Record<string, unknown>;
}

interface PreviewReadyMessage {
  type: "PREVIEW_READY";
  boot: RuntimeBootModel;
}

const root = document.getElementById("preview-root");

if (!root) {
  throw new Error("Preview root element was not found.");
}

const host = createWebRuntimeHost({
  root,
  ownerWindow: window,
  request: {
    hostKind: "studio",
    compileProfile: "runtime-preview",
    contentSource: "authored-game-root"
  }
});

// Story 47.5 — Studio Playtest shares the same default identity +
// save-store substrate as the published-web bundle so save behaviors
// can be developed in-Studio without deploying. IndexedDB is same-
// origin with the Studio dev server, so the iframe + the parent
// Studio page see the same storage. SugarProfile would override via
// the runtime contribution mechanism if it were enabled.
const identityProvider = createAnonymousLocalIdentityProvider();
const saveStore = createIndexedDBGameSaveStore();

async function loadSaveSafely(
  store: GameSaveStore,
  userId: string
): Promise<GameSave | null> {
  try {
    return await store.load(userId);
  } catch (error) {
    console.warn(
      "[studio-preview] Failed to load saved game; continuing with a fresh world.",
      error
    );
    return null;
  }
}

window.addEventListener("message", (event) => {
  const data = event.data as PreviewBootMessage | undefined;
  if (data?.type === "PREVIEW_BOOT") {
    void (async () => {
      const user = identityProvider.currentUser();
      const savedGame = user
        ? await loadSaveSafely(saveStore, user.userId)
        : null;
      host.start({
        regions: data.regions,
        activeRegionId: data.activeRegionId,
        activeEnvironmentId: data.activeEnvironmentId,
        savedGame,
        currentUser: user,
        // Story 47.7.5 — Studio Playtest doesn't render a Login
        // modal (the SugarProfile design workspace owns those dev
        // actions). But the resolver call inside the host still
        // needs fallbacks so the active provider lookup works
        // uniformly across published-web + Studio Playtest. The
        // resolved providers are accepted (and silently dropped)
        // via onProvidersResolved; future Studio-side surfaces
        // can consume them if needed.
        fallbackIdentityProvider: identityProvider,
        fallbackSaveStore: saveStore,
        onProvidersResolved: () => undefined,
        installedPluginIds: data.installedPluginIds,
        pluginRuntimeEnvironment: data.pluginRuntimeEnvironment,
        pluginConfigurations: data.pluginConfigurations,
        contentLibrary: data.contentLibrary,
        mechanics: data.mechanics,
        playerDefinition: data.playerDefinition,
        spellDefinitions: data.spellDefinitions,
        itemDefinitions: data.itemDefinitions,
        documentDefinitions: data.documentDefinitions,
        npcDefinitions: data.npcDefinitions,
        dialogueDefinitions: data.dialogueDefinitions,
        questDefinitions: data.questDefinitions,
        menuDefinitions: data.menuDefinitions,
        hudDefinition: data.hudDefinition,
        uiTheme: data.uiTheme,
        soundEventBindings: data.soundEventBindings,
        audioMixer: data.audioMixer,
        assetSources: data.assetSources,
        pluginBootPayloads: data.pluginBootPayloads
      });
    })();
  }
});

if (window.opener) {
  const message: PreviewReadyMessage = {
    type: "PREVIEW_READY",
    boot: host.boot
  };
  window.opener.postMessage(message, "*");
}
