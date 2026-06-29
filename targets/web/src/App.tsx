/**
 * Published-web entry point.
 *
 * Story 46.3 — replaces the placeholder card with the real game-render
 * composition. Mounts a div as the runtime root, instantiates the
 * shared `createWebRuntimeHost` with `hostKind: "published-web"`,
 * fetches the baked-in `/boot.json` artifact, and starts the runtime
 * against it. The same `runtimeHost.ts` powers Studio's preview
 * window via `apps/studio/src/preview.ts` (with `hostKind: "studio"`
 * + postMessage boot); the only difference here is where the boot
 * payload comes from.
 *
 * Story 47.5 — at boot, App.tsx constructs the default identity +
 * save providers (anonymous-local + IndexedDB), loads any existing
 * save for the current user, and threads the save into host.start
 * so a returning player resumes where they left off.
 *
 * Story 47.7.5 — App.tsx now passes the defaults to the host as
 * *fallbacks*, and the host's resolver dance (after plugin init)
 * swaps in SugarProfile's Supabase-backed providers when configured.
 * App.tsx receives the resolved providers via the
 * `onProvidersResolved` callback, subscribes to the active provider's
 * `onChange`, and mounts the SugarProfile login modal + signed-in
 * badge when appropriate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createAnonymousLocalIdentityProvider,
  createIndexedDBGameSaveStore,
  type GameSave,
  type GameSaveStore,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";
import {
  LoginModal,
  SignedInBadge
} from "@sugarmagic/plugins";
import { readBuildConfigFromViteEnv } from "./buildConfig";
import { UserContextProvider } from "./identity/useUserContext";
import {
  createWebRuntimeHost,
  type WebRuntimeHost,
  type WebRuntimeStartState
} from "./runtimeHost";
import { migrateLocalSaveToCloud } from "./save/migrate-local-to-cloud";
import { useAutosave } from "./save/useAutosave";
import { waitForActiveUser } from "./save/waitForActiveUser";

// Story 47.10.5 — consume the "fresh-start" flag at MODULE LOAD,
// not inside the React useEffect. React StrictMode (active in dev
// builds) double-invokes effects: setup → cleanup → setup. If we
// read+clear inside the effect, setup #1 sees "1" and clears it,
// then setup #2 sees null. The host then starts twice — the
// second time with `skipStartMenuOnBoot: false`, which re-opens
// the menu we were trying to skip. Module-level code runs once
// per page load regardless of React lifecycle. Plan 053.1 fixed
// the underlying bug (Studio was shelling the build with
// `NODE_ENV=development` inherited, which made the deployed
// bundle a dev-React bundle and turned StrictMode on in prod);
// the module-level capture stays as belt-and-suspenders so the
// reset path is correct under either build mode.
const __freshStartFlag =
  typeof sessionStorage !== "undefined" &&
  sessionStorage.getItem("sugarmagic.fresh-start") === "1";
if (typeof sessionStorage !== "undefined") {
  sessionStorage.removeItem("sugarmagic.fresh-start");
}

type BootPhase =
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "failed"; reason: string };

interface ProviderBindings {
  identityProvider: UserIdentityProvider;
  saveStore: GameSaveStore;
}

export function App() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<WebRuntimeHost | null>(null);
  const [phase, setPhase] = useState<BootPhase>({ kind: "loading" });

  // Story 47.5 / 47.7.5 — construct the default fallback providers
  // ONCE per App mount. SugarProfile's runtime contribution (47.7)
  // overrides via the resolver inside the host; the host fires
  // `onProvidersResolved` below with the resolved active providers.
  const fallback: ProviderBindings | null = useMemo(() => {
    try {
      return {
        identityProvider: createAnonymousLocalIdentityProvider(),
        saveStore: createIndexedDBGameSaveStore()
      };
    } catch (error) {
      console.error(
        "[target-web] Failed to construct default identity/save providers.",
        error
      );
      return null;
    }
  }, []);

  const [active, setActive] = useState<ProviderBindings | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!fallback) {
      setPhase({
        kind: "failed",
        reason:
          "Failed to construct default identity + save providers. Check the browser supports localStorage + IndexedDB."
      });
      return;
    }
    let cancelled = false;

    const host = createWebRuntimeHost({
      root,
      ownerWindow: window,
      request: {
        hostKind: "published-web",
        compileProfile: "published-target",
        contentSource: "published-artifact"
      }
    });
    hostRef.current = host;

    // Story 47.10.5 — `__freshStartFlag` is captured at module load
    // (see top of file). Using a module-level constant here so the
    // value is stable across StrictMode double-invocations of this
    // effect.
    const freshStart = __freshStartFlag;
    void (async () => {
      try {
        const bootResponse = await fetch("/boot.json", {
          headers: { accept: "application/json" }
        });
        if (!bootResponse.ok) {
          throw new Error(
            `Failed to fetch /boot.json: HTTP ${bootResponse.status} ${bootResponse.statusText}`
          );
        }
        const payload = (await bootResponse.json()) as WebRuntimeStartState;
        if (cancelled) return;
        const buildConfig = readBuildConfigFromViteEnv();
        if (payload.pluginRuntimeEnvironment) {
          console.warn(
            "[target-web] boot.json carried pluginRuntimeEnvironment; ignoring (this lives in the build-time config, not the baked artifact)."
          );
        }
        // Story 47.10 boot-ordering follow-up — the save load now
        // runs INSIDE host.start, after provider resolution, so a
        // signed-in returning player reads from the active (cloud)
        // store under the credentialed userId rather than from the
        // anonymous fallback. Wired via a deferred promise: the host
        // awaits `savedGamePromise` after firing
        // `onProvidersResolved`; we resolve the promise here once
        // we've waited for the active provider's user to settle and
        // loaded their save.
        let resolveSavedGame: (save: GameSave | null) => void = () => {};
        const savedGamePromise = new Promise<GameSave | null>((resolve) => {
          resolveSavedGame = resolve;
        });
        await host.start({
          ...payload,
          pluginRuntimeEnvironment: buildConfig.pluginRuntimeEnvironment,
          savedGamePromise,
          currentUser: fallback.identityProvider.currentUser(),
          fallbackIdentityProvider: fallback.identityProvider,
          fallbackSaveStore: fallback.saveStore,
          onProvidersResolved: (resolved) => {
            if (cancelled) return;
            setActive(resolved);
            void (async () => {
              const settledUser = await waitForActiveUser(
                resolved.identityProvider
              );
              if (cancelled) {
                resolveSavedGame(null);
                return;
              }
              const save = settledUser
                ? await loadSaveSafely(
                    resolved.saveStore,
                    settledUser.userId
                  )
                : null;
              resolveSavedGame(save);
            })();
          },
          skipStartMenuOnBoot: freshStart,
          // Story 47.10.5 — clear save under the active user, mark a
          // sessionStorage flag so the next boot drops the player
          // straight into gameplay (no second click on the start
          // menu), then reload. sessionStorage clears on tab close.
          // In-place reset would skip the reload entirely; deferred
          // to Plan 051 boot phases.
          onStartNewGame: async () => {
            // Story 053.7 — halt autosave + flush any in-flight
            // write BEFORE clearing the save. Otherwise a tick
            // that's mid-`store.save(userId, payload)` when New
            // Game fires will resolve AFTER the clear, write the
            // stale player position back into the store, and the
            // post-reload boot reads the stale save — player
            // doesn't return to origin.
            await autosave.halt();
            const settledUser = active?.identityProvider.currentUser();
            if (active && settledUser) {
              try {
                await active.saveStore.clear(settledUser.userId);
              } catch (error) {
                console.warn(
                  "[target-web] start-new-game: clearing save failed; continuing with reload anyway",
                  error
                );
              }
            }
            sessionStorage.setItem("sugarmagic.fresh-start", "1");
            window.location.reload();
          }
        });
        if (cancelled) return;
        setPhase({ kind: "running" });
      } catch (error) {
        if (cancelled) return;
        setPhase({
          kind: "failed",
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    })();

    return () => {
      cancelled = true;
      host.dispose();
      hostRef.current = null;
    };
  }, [fallback]);

  // Story 47.7.5 — subscribe to the active provider's onChange so
  // sign-in / sign-out / Supabase async bootstrap settling all flow
  // through React state. The active provider's currentUser may be
  // null briefly while Supabase bootstraps; the subscription fires
  // when it settles.
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
  // the player signed out mid-game and then back in). The
  // boot-time "first arrival" of a signed-in user from session
  // restoration does NOT count, because React 18 may batch
  // `setUser(signed-in)` with `setPhase("running")` into a single
  // commit — in that case a naive "prev was null + user is now set
  // + phase is running" check would fire on the very first boot
  // and stomp the host's `skipStartMenuOnBoot` decision.
  // `hasEverBeenSignedInRef` gates that: we only treat the
  // transition as a "sign back in" event after we've observed a
  // signed-in user at least once.
  const prevUserForMenuRef = useRef<User | null>(null);
  const hasEverBeenSignedInRef = useRef(false);
  useEffect(() => {
    const prev = prevUserForMenuRef.current;
    prevUserForMenuRef.current = user;
    if (user !== null) {
      const wasSignedIn = hasEverBeenSignedInRef.current;
      hasEverBeenSignedInRef.current = true;
      if (
        phase.kind === "running" &&
        prev === null &&
        wasSignedIn
      ) {
        hostRef.current?.showStartMenu();
      }
    }
  }, [user, phase]);

  // Story 47.10 — autosave loop. Polls the host's live save payload
  // on a fixed interval (default 5s) and writes through to the
  // active save store under the active userId. Before plugin
  // resolution settles `active` is null and we fall back to the
  // anonymous-local + IndexedDB pair so progress survives a tab
  // close even before SugarProfile boots.
  const autosaveSource = useMemo(
    () => ({
      getCurrentSavePayload: () =>
        hostRef.current?.getCurrentSavePayload() ?? null
    }),
    []
  );
  // Story 47.10 verify — bind autosave to the LIVE React user,
  // not to the anonymous-local fallback's currentUser. See
  // preview.tsx for the rationale; same considerations apply here.
  const autosaveStore = active?.saveStore ?? fallback?.saveStore ?? null;
  const autosaveUserId = user?.userId ?? null;
  // Story 053.7 — `onStartNewGame` (defined inside the boot effect
  // ABOVE) needs to halt + flush autosave before calling
  // `store.clear()`, otherwise an in-flight autosave write resolves
  // AFTER the clear and the next boot reads stale player position.
  // The boot effect closes over `autosave` lexically; that's fine
  // because `useAutosave`'s internal `haltedRef` /
  // `inFlightWriteRef` are stable across renders, so any handle
  // object (first render or later) drives the current state.
  const autosave = useAutosave(autosaveSource, autosaveStore, autosaveUserId, {
    onWritten: (written) => {
      hostRef.current?.notifyAutosaveWritten(written);
    }
  });

  // Story 47.10 — migrate the anonymous IndexedDB save to the active
  // (cloud) store when the user upgrades from anonymous to
  // credentialed via SugarProfile's `linkAnonymousToCredentials`
  // path (which preserves userId). Sign-in to a DIFFERENT account
  // (distinct userId) intentionally does NOT migrate — the
  // anonymous save belongs to whoever was playing before, not the
  // person who just signed in.
  const prevUserRef = useRef<User | null>(null);
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = user;
    if (!user || !active || !fallback) return;
    if (
      prev?.isAnonymous &&
      !user.isAnonymous &&
      prev.userId === user.userId
    ) {
      void (async () => {
        const result = await migrateLocalSaveToCloud({
          localStore: fallback.saveStore,
          cloudStore: active.saveStore,
          fromUserId: prev.userId,
          toUserId: user.userId
        });
        if (result.error) {
          console.warn(
            "[target-web] anonymous->credentialed save migration failed",
            result.error
          );
        }
      })();
    }
  }, [user, active, fallback]);

  // Detect whether SugarProfile (or any plugin) overrode the
  // fallback identity provider. When the resolved provider equals
  // the fallback, no plugin contributed — anonymous-local owns
  // identity and there's nothing for the login modal to do.
  const pluginIdentityActive =
    active && fallback ? active.identityProvider !== fallback.identityProvider : false;

  const overlay =
    phase.kind === "loading" ? (
      <div className="target-overlay">
        <div className="target-overlay-card">
          <p className="eyebrow">Sugarmagic</p>
          <p>Loading game data...</p>
        </div>
      </div>
    ) : phase.kind === "failed" ? (
      <div className="target-overlay">
        <div className="target-overlay-card target-overlay-card-error">
          <p className="eyebrow">Failed to load</p>
          <p>{phase.reason}</p>
        </div>
      </div>
    ) : pluginIdentityActive && active && user === null ? (
      <div className="target-overlay">
        <div className="target-overlay-card">
          <p className="eyebrow">Sugarmagic</p>
          <p>Signing in...</p>
        </div>
      </div>
    ) : null;

  // Story 47.7.5 — login modal mounts when the active provider has
  // no user (required sign-in) OR when the user clicks an explicit
  // "Sign In" affordance to upgrade an anonymous account. The modal
  // itself decides between `signIn` vs `linkAnonymousToCredentials`
  // based on the current user state.
  const requireSignIn =
    pluginIdentityActive && active && user === null && phase.kind === "running";

  const showLoginModal = loginModalOpen || requireSignIn;

  // Story 50.6 — mirror the modal-open boolean into the host's
  // `UIStateStore.loginModalOpen` so the runtime mode resolver
  // switches to "login-modal" mode while the modal is mounted.
  // This is what makes typing into the email/password input
  // safe from co-firing in-game shortcuts — the central action
  // registry's mode gate skips everything that isn't registered
  // against "login-modal".
  useEffect(() => {
    hostRef.current?.setLoginModalOpen(Boolean(showLoginModal));
  }, [showLoginModal]);

  const tree = (
    <main className="target-shell">
      <div ref={rootRef} className="target-runtime-root" />
      {overlay}
      {pluginIdentityActive && active && user?.isAnonymous ? (
        <button
          type="button"
          className="target-sign-in-pill"
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
      {pluginIdentityActive && active && user && !user.isAnonymous ? (
        <SignedInBadge
          user={user}
          provider={active.identityProvider}
        />
      ) : null}
      {showLoginModal && pluginIdentityActive && active ? (
        <LoginModal
          provider={active.identityProvider}
          mode={user?.isAnonymous ? "upgrade" : "required"}
          onClose={
            user?.isAnonymous ? () => setLoginModalOpen(false) : undefined
          }
        />
      ) : null}
    </main>
  );

  // Build the context value from whichever providers + user are
  // currently active. Render without a provider when nothing is
  // ready (loading / failed phase); the descendant tree just won't
  // render any consumers in that case.
  const contextValue =
    active && user
      ? {
          user,
          identityProvider: active.identityProvider,
          saveStore: active.saveStore
        }
      : fallback
        ? (() => {
            const fb = fallback.identityProvider.currentUser();
            if (!fb) return null;
            return {
              user: fb,
              identityProvider: fallback.identityProvider,
              saveStore: fallback.saveStore
            };
          })()
        : null;

  return contextValue ? (
    <UserContextProvider value={contextValue}>{tree}</UserContextProvider>
  ) : (
    tree
  );
}

async function loadSaveSafely(
  store: GameSaveStore,
  userId: string
): Promise<GameSave | null> {
  try {
    return await store.load(userId);
  } catch (error) {
    console.warn(
      "[target-web] Failed to load saved game; continuing with a fresh world.",
      error
    );
    return null;
  }
}
