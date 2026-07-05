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
 * ## Runtime host scope: MODULE-scoped here. (ADR 021)
 *
 * The host is constructed at MODULE scope (just below the
 * imports). React subscriptions to host state use
 * `useSyncExternalStore` against the host's `host.state.*`
 * (Plan 051's `ObservableValue` primitive). This shape is
 * forced by two constraints:
 *
 *   1. **Root DOM is static.** `#preview-root` lives in
 *      preview.html, present at module load. The host can be
 *      constructed immediately — no need to wait for a React
 *      ref to populate.
 *   2. **postMessage handler lives outside React.** Studio's
 *      parent window sends `PREVIEW_BOOT` to this iframe; the
 *      `window.addEventListener("message", ...)` handler needs
 *      access to `host` to call `host.start({...})`. That
 *      handler runs outside any React component, so the host
 *      MUST exist outside React's tree.
 *
 * Compare with `targets/web/src/App.tsx`, which uses COMPONENT-
 * scoped host + plain `useState` + host callbacks. Its root is
 * a React-rendered `<div ref={rootRef}>` that only exists after
 * React's first commit. Same `host.state.*` source of truth,
 * same runtime code; just different React APIs for the
 * subscription edge.
 *
 * See [ADR 021](/docs/adr/021-runtime-host-lifetime-scope.md)
 * for the architectural rule + why unifying isn't worth it.
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
  CreditsDefinition,
  MusicBindings,
  UITheme,
  RegionDocument,
  Scene
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "@sugarmagic/plugins";
import {
  createAnonymousLocalIdentityProvider,
  createIndexedDBGameSaveStore,
  createSerializedSaveStore,
  createObservableValue,
  registerActiveIdentityProvider,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore,
  type SerializedSaveStore,
  type MutableObservableValue,
  type RuntimeBootModel,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";
import {
  consumeFreshStartFlag,
  createWebRuntimeHost,
  migrateLocalSaveToCloud,
  useAutosave,
  waitForActiveUser
} from "@sugarmagic/target-web";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { sugarmagicTheme } from "@sugarmagic/ui";
import { LoginModal, SignedInBadge } from "@sugarmagic/plugins";

import "@mantine/core/styles.css";
import "@sugarmagic/ui/shell-variables.css";

interface PreviewBootMessage {
  type: "PREVIEW_BOOT";
  regions: RegionDocument[];
  /** Plan 058 §058.1 — narrative Scenes for overlay composition. */
  scenes?: Scene[];
  /** Plan 058 §058.2 — the editor's active Scene (Ambient
   *  Context); Preview boots into it. */
  activeSceneId?: string | null;
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
  /** Plan 059 §059.1 — project music slots. */
  musicBindings?: MusicBindings | null;
  /** Plan 059 §059.2 — credits roll content. */
  creditsDefinition?: CreditsDefinition | null;
  /** Plan 059 §059.3 — entry title sequence's first card. */
  gameTitle?: string | null;
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
const saveStore = createSerializedSaveStore(createIndexedDBGameSaveStore());

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
  // SerializedSaveStore: the resolver inside the host wraps
  // unconditionally so callers can use `resetForNewGame` without
  // narrowing checks.
  saveStore: SerializedSaveStore;
}

// Story 51.2 — replaced the previous module-level
// `providerEvents = new EventTarget()` + `let resolvedBindings`
// with the host's own `host.state.activeProviders`
// ObservableValue. The host mutates it inside `host.start()`
// after plugin bootstrap resolves; React subscribers attach via
// `useSyncExternalStore` and read the current snapshot at
// subscribe time (no late-subscriber race — Plan 047 §47.10
// incident structurally fixed). Other module-scope readers
// (window-message handler, onStartNewGame) read via
// `host.state.activeProviders.getSnapshot()`.

// Story 47.10.5 + 51.2 — boot status drives the "Syncing..."
// overlay so the player sees a deliberate loading state instead
// of the bare dark canvas while host.start fetches plugins +
// provider session + save. Migrated from the previous
// EventTarget-backed module state to an `ObservableValue` so the
// React subscriber's `useSyncExternalStore` gets the same race-
// free snapshot+subscribe contract as activeProviders.
type PreviewBootPhase = "loading" | "running" | "failed";
interface PreviewBootStatus {
  phase: PreviewBootPhase;
  reason: string | null;
}

const bootStatusStore: MutableObservableValue<PreviewBootStatus> =
  createObservableValue<PreviewBootStatus>({ phase: "loading", reason: null });

function publishBootPhase(next: PreviewBootPhase, reason: string | null = null) {
  bootStatusStore.set({ phase: next, reason });
}

// Story 51.2 — host's `state.activeProviders` is the source of
// truth; this helper still exists because it ALSO updates
// runtime-core's access-token registry (Story 47.9.5). The
// access-token registry is targeted for retirement in Story 51.3,
// at which point this helper retires too. Until then, treat it
// as a co-ordination point: host store gets set inside
// `host.start()`; THIS helper fires alongside, mirroring the
// active identity provider into the access-token side-channel.
function publishResolvedBindings(next: ProviderBindings) {
  registerActiveIdentityProvider(next.identityProvider);
}

window.addEventListener("message", (event) => {
  const data = event.data as PreviewBootMessage | undefined;
  if (data?.type === "PREVIEW_BOOT") {
    void (async () => {
      // Consume the fresh-start flag once per boot so a normal
      // Continue / refresh doesn't accidentally skip the start
      // menu. sessionStorage clears on tab close anyway; this
      // guards against same-tab reloads after a New Game click.
      const freshStart = consumeFreshStartFlag();
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
        scenes: data.scenes,
        activeSceneId: data.activeSceneId,
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
        musicBindings: data.musicBindings,
        creditsDefinition: data.creditsDefinition,
        gameTitle: data.gameTitle,
        assetSources: data.assetSources,
        pluginBootPayloads: data.pluginBootPayloads,
        defaultGameSavePayload: data.defaultGameSavePayload ?? null,
        skipStartMenuOnBoot: freshStart
        // Plan 054 §054.3 — host owns the destructive transition.
      })
        .then(() => publishBootPhase("running"))
        .catch((error) => {
          console.error("[studio-preview] host.start failed", error);
          publishBootPhase(
            "failed",
            error instanceof Error ? error.message : String(error)
          );
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

/**
 * Story 47.10.5 — full-iframe loading / failure surface. Used by
 * PreviewOverlay to mask the dark canvas until `host.start`
 * settles (or to show an error if it throws). Inline styles keep
 * the component self-contained — Studio Preview owns the iframe;
 * we don't pull in Mantine just for two lines of text.
 */
function BootOverlay(props: {
  title: string;
  body: string;
  tone?: "default" | "error";
}) {
  const isError = props.tone === "error";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(7, 7, 15, 0.85)",
        color: "#f6f1ff",
        pointerEvents: "auto",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      }}
    >
      <div
        style={{
          padding: "24px 32px",
          background: isError
            ? "rgba(244, 67, 54, 0.16)"
            : "rgba(236, 72, 153, 0.12)",
          border: isError
            ? "1px solid rgba(244, 67, 54, 0.45)"
            : "1px solid rgba(236, 72, 153, 0.35)",
          borderRadius: 12,
          minWidth: 240,
          textAlign: "center"
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            opacity: 0.7
          }}
        >
          {props.title}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 15 }}>{props.body}</p>
      </div>
    </div>
  );
}

function PreviewOverlay() {
  // Story 51.2 — `useSyncExternalStore` replaces the previous
  // useState + EventTarget pattern + catch-up read. React calls
  // the snapshot getter at subscribe time, so a late-mounting
  // subscriber always reads the current value (no "I missed the
  // only event" race). The host's `state.activeProviders` is
  // the single source of truth.
  const active = useSyncExternalStore(
    host.state.activeProviders.subscribe,
    host.state.activeProviders.getSnapshot
  );
  const [user, setUser] = useState<User | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  // Same snapshot+subscribe shape for the boot phase. One store,
  // {phase, reason}; reading via destructure below.
  const bootStatus = useSyncExternalStore(
    bootStatusStore.subscribe,
    bootStatusStore.getSnapshot
  );
  const phase = bootStatus.phase;
  const failureReason = bootStatus.reason;

  useEffect(() => {
    if (!active) return;
    setUser(active.identityProvider.currentUser());
    const unsubscribe = active.identityProvider.onChange((next) => {
      setUser(next);
    });
    return unsubscribe;
  }, [active]);

  // Story 47.10.5 — re-open the start menu when the user transitions
  // null → signed-in AFTER having been signed in once already (i.e.
  // the player signed out mid-game and then back in). The first
  // boot-time arrival of a signed-in user does NOT count — React
  // may batch `setUser(signed-in)` with the boot-phase transition
  // into a single commit, and a naive prev-was-null check would
  // fire on the very first boot and stomp the host's
  // `skipStartMenuOnBoot` decision (the New-Game reset path).
  const prevUserForMenuRef = useRef<User | null>(null);
  const hasEverBeenSignedInRef = useRef(false);
  useEffect(() => {
    const prev = prevUserForMenuRef.current;
    prevUserForMenuRef.current = user;
    if (user !== null) {
      const wasSignedIn = hasEverBeenSignedInRef.current;
      hasEverBeenSignedInRef.current = true;
      if (phase === "running" && prev === null && wasSignedIn) {
        host.showStartMenu();
      }
    }
  }, [user, phase]);

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
  // The 053.7 halt() handle is gone: the SerializedSaveStore
  // wrapper now owns the in-flight-flush + freeze guarantee, so
  // module-scope onStartNewGame (which can't lexically close
  // over this hook anyway) doesn't need a callback bridge to
  // the hook. The hook just polls + writes; it knows nothing
  // about destructive flows.
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

  // Story 47.10.5 — boot overlay. Renders above everything else
  // until `host.start` resolves. Mirrors target-web App.tsx's
  // `target-overlay` card so the boot UX is consistent across
  // Studio Preview and the deployed bundle.
  const bootOverlay =
    phase === "loading" ? (
      <BootOverlay title="Sugarmagic" body="Syncing..." />
    ) : phase === "failed" ? (
      <BootOverlay
        title="Failed to load"
        body={failureReason ?? "Unknown error"}
        tone="error"
      />
    ) : null;

  // Story 47.10.5 — only require sign-in once the boot has settled.
  // Without this gate, the brief window where `active` is set but
  // Supabase's session restore hasn't completed yet renders the
  // LoginModal for a frame or two before the user materializes, then
  // hides it — visible as a "flash of login screen" before the start
  // menu. The BootOverlay already covers the loading phase visually;
  // the modal only needs to render AFTER we know there's truly no
  // user.
  //
  // Computed BEFORE the early-return on `!pluginIdentityActive ||
  // !active` so the `useEffect` below runs unconditionally on every
  // render (React Rules of Hooks: hook order must be stable; a hook
  // after a conditional early-return changes hook count between
  // renders and React throws). The gate on `pluginIdentityActive
  // && active != null` defends the boolean against the early-return
  // case — when those are false, showLoginModal stays false and the
  // useEffect tells the host the modal isn't open.
  const requireSignIn =
    pluginIdentityActive && active != null && user === null && phase !== "loading";
  const showLoginModal = loginModalOpen || requireSignIn;

  // Story 50.6 — mirror the modal-open boolean into the host's
  // `UIStateStore.loginModalOpen` so the runtime mode resolver
  // routes to "login-modal" mode while the modal is mounted.
  // Disables all in-game / dialogue shortcuts so typing the email
  // doesn't co-fire inventory.
  useEffect(() => {
    host.setLoginModalOpen(showLoginModal);
  }, [showLoginModal]);

  if (!pluginIdentityActive || !active) {
    return <>{bootOverlay}</>;
  }

  return (
    <>
      {bootOverlay}
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
