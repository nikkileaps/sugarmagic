/**
 * packages/runtime-core/src/identity/session-hud-card.ts
 *
 * Purpose: Author-facing live readout of the runtime's
 * user-management state. Contributes a `debug.hudCard` with
 * `hostKinds: ["studio"]` so it appears in Studio Playtest only
 * and never in published-web. Shows the resolved user id, anon
 * flag, the saved game's region/quest/lastPlayed (or "(none)")
 * and the live player position updating per tick from
 * `DebugHudCardContext.gameplaySession.playerPosition`.
 *
 * Reuses the existing `.sm-debug-hud__world-card` /
 * `.sm-debug-hud__metric` styles from `debug-hud/DebugHud.ts` so no
 * new CSS is introduced; the row labels + values are styled the
 * same as the existing Renderer + World cards.
 *
 * Implements: Plan 047 §Story 47.5.5
 *
 * Status: active
 */

import type { DebugHudCardContext, DebugHudCardContribution } from "../plugins";
import type { User } from "./index";

/**
 * Snapshot of the saved game's identifying fields. The host loads
 * the save at boot (story 47.5) and passes the relevant subset
 * here — the HUD card doesn't need access to the full payload.
 * `null` means "no save loaded" (first-time player).
 */
export interface SessionHudSavedGameSnapshot {
  lastPlayed: string;
  currentRegionId: string | null;
  currentQuestId: string | null;
}

export interface CreateSessionHudCardArgs {
  user: User | null;
  savedGameSnapshot: SessionHudSavedGameSnapshot | null;
}

const SESSION_PLUGIN_ID = "runtime-core.session";
const SESSION_CONTRIBUTION_ID = "runtime-core.session.hud";
const SESSION_CARD_ID = "session";

/**
 * Story 47.5.5 follow-up — prefer the first dash-separated segment
 * as the chip label. UUIDs split into `xxxxxxxx-xxxx-xxxx-...` so
 * the 8-char first group is the recognizable handle; game ids like
 * `wordlark-v1-...` produce a short readable label without
 * ellipses. Falls back to first-8-chars-plus-ellipsis when there's
 * no dash within the first 12 chars.
 *
 * Mirror of `truncateIdForChip` in `@sugarmagic/ui`'s `IdChip`
 * component; duplicated rather than imported because runtime-core
 * must not depend on Mantine. Keep the two in sync if the
 * truncation strategy changes.
 */
function truncateUserId(userId: string): string {
  const dashIndex = userId.indexOf("-");
  if (dashIndex > 0 && dashIndex <= 12) {
    return userId.slice(0, dashIndex);
  }
  if (userId.length <= 8) return userId;
  return `${userId.slice(0, 8)}...`;
}

function applyChipStyle(element: HTMLElement): void {
  // Inline styles keep the chip self-contained — the HUD's CSS
  // injection is owned by DebugHud.ts, and adding a new class here
  // would require modifying that injection. Inline lets the
  // session card own its own visual without coupling.
  element.style.display = "inline-block";
  element.style.padding = "0px 6px";
  element.style.borderRadius = "999px";
  element.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  element.style.background = "rgba(236, 72, 153, 0.18)";
  element.style.border = "1px solid rgba(236, 72, 153, 0.35)";
  element.style.cursor = "default";
}

function formatPosition(
  position: { x: number; y: number; z: number } | null
): string {
  if (!position) return "-";
  return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
}

function formatUserId(user: User | null): string {
  if (!user) return "-";
  return truncateUserId(user.userId);
}

function formatAnonymousFlag(user: User | null): string {
  if (!user) return "-";
  return user.isAnonymous ? "yes" : "no";
}

function formatSavePresent(snapshot: SessionHudSavedGameSnapshot | null): string {
  return snapshot ? "present" : "(none)";
}

function formatLastPlayed(snapshot: SessionHudSavedGameSnapshot | null): string {
  return snapshot?.lastPlayed ?? "-";
}

function formatRegion(snapshot: SessionHudSavedGameSnapshot | null): string {
  return snapshot?.currentRegionId ?? "-";
}

function formatQuest(snapshot: SessionHudSavedGameSnapshot | null): string {
  return snapshot?.currentQuestId ?? "-";
}

/**
 * Builds the Session debug HUD card contribution. The host appends
 * the result to the `pluginCards` list it passes to
 * `createRuntimeDebugHud` when `hostKind === "studio"`. The factory
 * closes over its DOM refs so `updateCard` can refresh the live
 * position row without rebuilding the panel.
 */
export function createSessionHudCard(
  args: CreateSessionHudCardArgs
): DebugHudCardContribution {
  const valueElements = new Map<string, HTMLSpanElement>();

  const labels = [
    "User",
    "Anon",
    "Save",
    "Last Played",
    "Region",
    "Quest",
    "Position"
  ] as const;

  return {
    pluginId: SESSION_PLUGIN_ID,
    contributionId: SESSION_CONTRIBUTION_ID,
    kind: "debug.hudCard",
    displayName: "Session",
    priority: 50,
    hostKinds: ["studio"],
    payload: {
      cardId: SESSION_CARD_ID,
      renderCard(container: HTMLElement, context: DebugHudCardContext) {
        const documentRef = container.ownerDocument ?? document;
        const content = documentRef.createElement("div");
        // Reuse the world-card style so the rows render identically
        // to the existing Renderer + World cards without
        // introducing new CSS.
        content.className = "sm-debug-hud__world-card";
        for (const label of labels) {
          const row = documentRef.createElement("div");
          row.className = "sm-debug-hud__metric";
          const labelElement = documentRef.createElement("span");
          labelElement.textContent = label;
          const valueElement = documentRef.createElement("span");
          valueElement.textContent = "-";
          valueElements.set(label, valueElement);
          row.append(labelElement, valueElement);
          content.appendChild(row);
        }
        container.appendChild(content);

        // Story 47.5.5 — fields sourced from args (resolved at host
        // start) are static for the card's lifetime. The Position
        // row is the only one that ticks live; updateCard handles
        // that.
        const userValue = valueElements.get("User")!;
        userValue.textContent = formatUserId(args.user);
        if (args.user) {
          // Full uuid surfaces via the browser-native `title`
          // tooltip on hover. The pill background mirrors the
          // IdChip React component in @sugarmagic/ui so the visual
          // language matches across surfaces.
          userValue.title = args.user.userId;
          applyChipStyle(userValue);
        }
        valueElements.get("Anon")!.textContent = formatAnonymousFlag(args.user);
        valueElements.get("Save")!.textContent = formatSavePresent(
          args.savedGameSnapshot
        );
        valueElements.get("Last Played")!.textContent = formatLastPlayed(
          args.savedGameSnapshot
        );
        valueElements.get("Region")!.textContent = formatRegion(
          args.savedGameSnapshot
        );
        valueElements.get("Quest")!.textContent = formatQuest(
          args.savedGameSnapshot
        );
        valueElements.get("Position")!.textContent = formatPosition(
          context.gameplaySession.playerPosition
        );
      },
      updateCard(context: DebugHudCardContext) {
        // Position ticks live from the gameplay session snapshot.
        // The other fields stay static — sign-in / sign-out flows
        // (47.7+) will reconstruct the card via a fresh host.start.
        const positionRow = valueElements.get("Position");
        if (positionRow) {
          positionRow.textContent = formatPosition(
            context.gameplaySession.playerPosition
          );
        }
      }
    }
  };
}
