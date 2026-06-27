/**
 * Studio Preview iframe entry point.
 *
 * Story 47.7.5+ — originally a vanilla TS script that only mounted
 * the runtime canvas. Now also mounts a React overlay so the
 * SugarProfile-contributed LoginModal + SignedInBadge render in
 * the Studio Preview iframe the same way they render in the
 * published-web bundle. Keeps the iteration loop tight: enable
 * SugarProfile in wordlark's plugin config, open Preview, see the
 * LoginModal in the iframe with Vite HMR — no Build Frontend /
 * deploy round-trip needed to iterate on auth UI.
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
  registerActiveIdentityProvider,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore,
  type RuntimeBootModel,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";
import {
  createWebRuntimeHost,
  migrateLocalSaveToCloud,
  useAutosave,
  waitForActiveUser
} from "@sugarmagic/target-web";
import { useEffect, useMemo, useRef, useState } from "react";
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
  defaultGameSavePayload?: GameSavePayload | null;
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
  // Story 47.9.5 — gateway clients (SugarAgent etc.) read the active
  // user's access token from runtime-core's access-token registry,
  // refreshed per request. Wire it up at the same point we notify
  // the React overlay so both paths see consistent state.
  registerActiveIdentityProvider(next.identityProvider);
  providerEvents.dispatchEvent(new Event("change"));
}

window.addEventListener("message", (event) => {
  const data = event.data as PreviewBootMessage | undefined;
  if (data?.type === "PREVIEW_BOOT") {
    void (async () => {
      // Story 47.10.5 — consume the "fresh-start" flag once per boot
      // so a normal Continue / refresh doesn't accidentally skip the
      // start menu. sessionStorage clears on tab close anyway, but
      // this guards against same-tab reloads after the New Game one.
      const freshStart =
        sessionStorage.getItem("sugarmagic.fresh-start") === "1";
      sessionStorage.removeItem("sugarmagic.fresh-start");
      // Story 47.10 boot-ordering follow-up — same deferred-save
      // pattern as App.tsx: the host awaits this promise after
      // provider resolution so a signed-in author resumes from the
      // active store rather than the anonymous-local fallback.
      let resolveSavedGame: (save: GameSave | null) => void = () => {};
      const savedGamePromise = new Promise<GameSave | null>((resolve) => {
        resolveSavedGame = resolve;
      });
      void host.start({
        regions: data.regions,
        activeRegionId: data.activeRegionId,
        activeEnvironmentId: data.activeEnvironmentId,
        savedGamePromise,
        currentUser: identityProvider.currentUser(),
        fallbackIdentityProvider: identityProvider,
        fallbackSaveStore: saveStore,
        onProvidersResolved: (resolved) => {
          publishResolvedBindings(resolved);
          void (async () => {
            const settledUser = await waitForActiveUser(
              resolved.identityProvider
            );
            const save = settledUser
              ? await loadSaveSafely(resolved.saveStore, settledUser.userId)
              : null;
            resolveSavedGame(save);
          })();
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
        pluginBootPayloads: data.pluginBootPayloads,
        defaultGameSavePayload: data.defaultGameSavePayload ?? null,
        skipStartMenuOnBoot: freshStart,
        // Story 47.10.5 — "New Game" sequence: clear the save under
        // the active user, mark a sessionStorage flag so the next
        // boot drops the player straight into gameplay (instead of
        // re-showing the start menu and forcing a second click),
        // then reload. The flag clears on tab close. In-place reset
        // would skip the reload entirely; deferred to Plan 051 boot
        // phases.
        onStartNewGame: async () => {
          const bindings = resolvedBindings;
          const user = bindings?.identityProvider.currentUser();
          if (bindings && user) {
            try {
              await bindings.saveStore.clear(user.userId);
            } catch (error) {
              console.warn(
                "[studio-preview] start-new-game: clearing save failed; continuing with reload anyway",
                error
              );
            }
          }
          sessionStorage.setItem("sugarmagic.fresh-start", "1");
          window.location.reload();
        }
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
    // Story 47.10 verify — catch-up read of the current value, in
    // case `publishResolvedBindings` already fired before this
    // effect attached the listener. Without this, a late-attaching
    // subscriber misses the only "change" event ever dispatched
    // (plugin bootstrap runs at the top of host.start; React's
    // useEffect commits in the next task). See
    // docs/plans/051-runtime-handoff-load-order-architecture.md
    // for the proper observable-store replacement.
    if (resolvedBindings) {
      setActive(resolvedBindings);
    }
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

  // Story 47.10 — autosave + migration mirror App.tsx's wiring so a
  // Studio Preview session carries the same persist-on-tick +
  // local-to-cloud-on-link behavior as the deployed bundle. Lets us
  // exercise the full save flow during authoring without round-
  // tripping through Build Frontend + Deploy.
  const autosaveSource = useMemo(
    () => ({
      getCurrentSavePayload: () => host.getCurrentSavePayload()
    }),
    []
  );
  // Story 47.10 verify — bind autosave to the LIVE React user (set
  // by the active provider's onChange subscription), not to the
  // anonymous-local fallback's currentUser. With SugarProfile
  // active but no session yet (e.g. allowAnonymous=false, no prior
  // sign-in), `user` is null and autosave is intentionally idle
  // until the player signs in. Falling back to the anonymous-local
  // UUID here would write under a userId Supabase RLS will reject,
  // and the resulting 403s would be invisible silent failures.
  const autosaveStore = active?.saveStore ?? saveStore;
  const autosaveUserId = user?.userId ?? null;
  useAutosave(autosaveSource, autosaveStore, autosaveUserId, {
    onWritten: (written) => {
      host.notifyAutosaveWritten(written);
    }
  });

  const prevUserRef = useRef<User | null>(null);
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = user;
    if (!user || !active) return;
    if (
      prev?.isAnonymous &&
      !user.isAnonymous &&
      prev.userId === user.userId
    ) {
      void (async () => {
        const result = await migrateLocalSaveToCloud({
          localStore: saveStore,
          cloudStore: active.saveStore,
          fromUserId: prev.userId,
          toUserId: user.userId
        });
        if (result.error) {
          console.warn(
            "[studio-preview] anonymous->credentialed save migration failed",
            result.error
          );
        }
      })();
    }
  }, [user, active]);

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
