/**
 * Studio Playtest iframe entry point.
 *
 * Story 47.7.5+ — originally a vanilla TS script that only mounted
 * the runtime canvas. Now also mounts a React overlay so the
 * SugarProfile-contributed LoginModal + SignedInBadge render in
 * Studio Playtest the same way they render in the published-web
 * bundle. Keeps the iteration loop tight: enable SugarProfile in
 * wordlark's plugin config, click Playtest, see the LoginModal in
 * the iframe with Vite HMR — no Build Frontend / deploy round-trip
 * needed to iterate on auth UI.
 *
 * Two roots live in preview.html:
 *   - `#preview-root` — runtime canvas + three.js scene
 *   - `#preview-overlay-root` — React tree (MantineProvider +
 *     LoginModal / SignedInBadge / SignIn pill)
 *
 * Status: active
 */

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
  type RuntimeBootModel,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";
import { createWebRuntimeHost } from "@sugarmagic/target-web";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { sugarmagicTheme } from "@sugarmagic/ui";
import { LoginModal, SignedInBadge } from "@sugarmagic/plugins";

import "@mantine/core/styles.css";
import "@sugarmagic/ui/shell-variables.css";

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

const overlayRoot = document.getElementById("preview-overlay-root");
if (!overlayRoot) {
  throw new Error("Preview overlay root element was not found.");
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

interface ProviderBindings {
  identityProvider: UserIdentityProvider;
  saveStore: GameSaveStore;
}

// Shared state across the postMessage handler + the React overlay:
// the host calls into `publishResolvedBindings` after the resolver
// fires, and the React tree reflects whichever providers are
// active. EventTarget keeps the two sides decoupled.
const providerEvents = new EventTarget();
let resolvedBindings: ProviderBindings | null = null;

function publishResolvedBindings(next: ProviderBindings) {
  resolvedBindings = next;
  providerEvents.dispatchEvent(new Event("change"));
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
        fallbackIdentityProvider: identityProvider,
        fallbackSaveStore: saveStore,
        onProvidersResolved: (resolved) => {
          publishResolvedBindings(resolved);
        },
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

function PreviewOverlay() {
  const [active, setActive] = useState<ProviderBindings | null>(
    resolvedBindings
  );
  const [user, setUser] = useState<User | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  useEffect(() => {
    const handler = () => setActive(resolvedBindings);
    providerEvents.addEventListener("change", handler);
    return () => providerEvents.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!active) return;
    setUser(active.identityProvider.currentUser());
    const unsubscribe = active.identityProvider.onChange((next) => {
      setUser(next);
    });
    return unsubscribe;
  }, [active]);

  // Detect SugarProfile (or any plugin) overriding the fallback.
  const pluginIdentityActive =
    active != null && active.identityProvider !== identityProvider;

  if (!pluginIdentityActive || !active) {
    return null;
  }

  const requireSignIn = user === null;
  const showLoginModal = loginModalOpen || requireSignIn;

  return (
    <>
      {user?.isAnonymous ? (
        <button
          type="button"
          onClick={() => setLoginModalOpen(true)}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 18,
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid rgba(236, 72, 153, 0.4)",
            background: "rgba(236, 72, 153, 0.18)",
            color: "#fff",
            cursor: "pointer",
            fontSize: 13
          }}
        >
          Sign In
        </button>
      ) : null}
      {user && !user.isAnonymous ? (
        <SignedInBadge user={user} provider={active.identityProvider} />
      ) : null}
      {showLoginModal ? (
        <LoginModal
          provider={active.identityProvider}
          mode={user?.isAnonymous ? "upgrade" : "required"}
          onClose={
            user?.isAnonymous ? () => setLoginModalOpen(false) : undefined
          }
        />
      ) : null}
    </>
  );
}

createRoot(overlayRoot).render(
  <MantineProvider theme={sugarmagicTheme} defaultColorScheme="dark">
    <PreviewOverlay />
  </MantineProvider>
);
