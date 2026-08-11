/**
 * targets/web/src/save/AutosaveFailureNotice.tsx
 *
 * Purpose: Tells the player their progress is not being saved, and lets
 *   them dismiss it and keep playing.
 *
 * WHY A HOOK AND NOT JUST A COMPONENT
 *   There are two hosts that run the game -- the published bundle
 *   (`targets/web/src/App.tsx`) and Studio's Preview
 *   (`apps/studio/src/preview.tsx`) -- and each calls `useAutosave`
 *   itself. The notice needs the same state machine in both: show on a
 *   sustained failure, hide on dismiss, and come BACK if saving breaks
 *   again after recovering. Handing each host a `failing` boolean would
 *   have meant writing that machine twice and letting the two drift.
 *   This owns the state and hands back the element.
 *
 * WHY IT IS DISMISSABLE
 *   nikki: "can the player choose to keep playing? the answer should be
 *   fucking yes". A save problem is worth interrupting someone over once;
 *   it is not worth pinning a banner over their game for the rest of the
 *   session. Dismissing hides it until the next episode, not for ever.
 *
 * Exports:
 *   - useAutosaveFailureNotice
 *
 * Status: active
 */

import { useCallback, useState, type ReactNode } from "react";
import type { AutosaveStatus } from "./useAutosave";

export interface AutosaveFailureNotice {
  /** Wire straight into `useAutosave`'s `onStatusChange` option. */
  onStatusChange: (status: AutosaveStatus) => void;
  /** Render anywhere in the host's overlay tree. Null when there is
   *  nothing to say. */
  notice: ReactNode;
}

export function useAutosaveFailureNotice(): AutosaveFailureNotice {
  const [failing, setFailing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const onStatusChange = useCallback((status: AutosaveStatus) => {
    setFailing(status.failing);
    // A write landing ends the episode. If saving breaks again later that
    // is news again, so one dismissal does not silence the notice for the
    // rest of the session.
    if (!status.failing) setDismissed(false);
  }, []);

  const notice =
    failing && !dismissed ? (
      <div
        role="status"
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 19,
          display: "flex",
          alignItems: "center",
          gap: 12,
          minWidth: 220,
          maxWidth: "min(720px, calc(100vw - 48px))",
          padding: "10px 12px 10px 16px",
          borderRadius: 999,
          border: "1px solid rgba(243, 139, 168, 0.45)",
          background: "rgba(17, 17, 27, 0.92)",
          color: "#f8d7de",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.22)",
          // Only the pill itself takes clicks, so the world behind it
          // stays fully playable.
          pointerEvents: "auto"
        }}
      >
        <span style={{ userSelect: "none" }}>
          Your progress is not saving. Still trying.
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          style={{
            flex: "none",
            width: 22,
            height: 22,
            lineHeight: "20px",
            padding: 0,
            borderRadius: "50%",
            border: "1px solid rgba(248, 215, 222, 0.35)",
            background: "transparent",
            color: "inherit",
            fontSize: 14,
            cursor: "pointer"
          }}
        >
          x
        </button>
      </div>
    ) : null;

  return { onStatusChange, notice };
}
