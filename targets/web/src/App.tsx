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
 * payload comes from. Build-time baking of `boot.json` from the
 * game's `project.sgrmagic` + content library + regions + assets is
 * 46.4's concern; until then, `targets/web/public/boot.json` ships a
 * synthetic fixture so the dev server can render an empty world end-
 * to-end.
 */

import { useEffect, useRef, useState } from "react";
import {
  createWebRuntimeHost,
  type WebRuntimeHost,
  type WebRuntimeStartState
} from "./runtimeHost";

type BootPhase =
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "failed"; reason: string };

export function App() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<WebRuntimeHost | null>(null);
  const [phase, setPhase] = useState<BootPhase>({ kind: "loading" });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
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
        const response = await fetch("/boot.json", {
          headers: { accept: "application/json" }
        });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch /boot.json: HTTP ${response.status} ${response.statusText}`
          );
        }
        const payload = (await response.json()) as WebRuntimeStartState;
        if (cancelled) return;
        host.start(payload);
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
  }, []);

  return (
    <main className="target-shell">
      <div ref={rootRef} className="target-runtime-root" />
      {phase.kind === "loading" ? (
        <div className="target-overlay">
          <div className="target-overlay-card">
            <p className="eyebrow">Sugarmagic</p>
            <p>Loading game data...</p>
          </div>
        </div>
      ) : null}
      {phase.kind === "failed" ? (
        <div className="target-overlay">
          <div className="target-overlay-card target-overlay-card-error">
            <p className="eyebrow">Failed to load</p>
            <p>{phase.reason}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
