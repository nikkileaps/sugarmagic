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
 * so a returning player resumes where they left off. The
 * UserContextProvider exposes the identity + store to descendant
 * React UI (today: none; future: SugarProfile login modal).
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
import { readBuildConfigFromViteEnv } from "./buildConfig";
import { UserContextProvider } from "./identity/useUserContext";
import {
  createWebRuntimeHost,
  type WebRuntimeHost,
  type WebRuntimeStartState
} from "./runtimeHost";

type BootPhase =
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "failed"; reason: string };

interface ResolvedIdentity {
  user: User;
  identityProvider: UserIdentityProvider;
  saveStore: GameSaveStore;
}

export function App() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<WebRuntimeHost | null>(null);
  const [phase, setPhase] = useState<BootPhase>({ kind: "loading" });

  // Story 47.5 — construct the default identity + save store ONCE per
  // App mount. SugarProfile (Plan 047 §47.7) overrides via the
  // runtime contribution mechanism without this code changing; the
  // resolver lives behind the runtime plugin manager and picks the
  // active impl during host start.
  const identity: ResolvedIdentity | null = useMemo(() => {
    try {
      const identityProvider = createAnonymousLocalIdentityProvider();
      const saveStore = createIndexedDBGameSaveStore();
      const user = identityProvider.currentUser();
      if (!user) return null;
      return { user, identityProvider, saveStore };
    } catch (error) {
      console.error(
        "[target-web] Failed to construct default identity/save providers.",
        error
      );
      return null;
    }
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!identity) {
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

    void (async () => {
      try {
        // Story 47.5 — load the saved game in parallel with the boot
        // payload. Both must complete before host.start. A null save
        // means "first-time player"; host falls through to authored
        // defaults.
        const [bootResponse, savedGame] = await Promise.all([
          fetch("/boot.json", { headers: { accept: "application/json" } }),
          loadSaveSafely(identity.saveStore, identity.user.userId)
        ]);
        if (!bootResponse.ok) {
          throw new Error(
            `Failed to fetch /boot.json: HTTP ${bootResponse.status} ${bootResponse.statusText}`
          );
        }
        const payload = (await bootResponse.json()) as WebRuntimeStartState;
        if (cancelled) return;
        // Story 46.4 — pluginRuntimeEnvironment lives in the build-time
        // config (env vars baked by the GHA workflow per Story 46.7),
        // NOT in boot.json (which is the game's authored data). Merge
        // here so gateway-needing plugins see their URLs / tokens. Any
        // env value in boot.json would be a misconfig — log + ignore.
        const buildConfig = readBuildConfigFromViteEnv();
        if (payload.pluginRuntimeEnvironment) {
          console.warn(
            "[target-web] boot.json carried pluginRuntimeEnvironment; ignoring (this lives in the build-time config, not the baked artifact)."
          );
        }
        host.start({
          ...payload,
          pluginRuntimeEnvironment: buildConfig.pluginRuntimeEnvironment,
          savedGame,
          currentUser: identity.user
        });
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
  }, [identity]);

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
    ) : null;

  const tree = (
    <main className="target-shell">
      <div ref={rootRef} className="target-runtime-root" />
      {overlay}
    </main>
  );

  // Story 47.5 — wrap the React tree in UserContextProvider so future
  // SugarProfile-contributed UI (login modal, plugin "Logged in as X"
  // affordances) can read identity + save without prop-drilling. When
  // identity is null we surface the failed phase from the overlay
  // above; rendering without a provider would crash any descendant
  // useUserContext call.
  return identity ? (
    <UserContextProvider value={identity}>{tree}</UserContextProvider>
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
