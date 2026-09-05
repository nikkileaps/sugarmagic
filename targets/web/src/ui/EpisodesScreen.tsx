/**
 * targets/web/src/ui/EpisodesScreen.tsx
 *
 * Purpose: Plan 059 §059.4 — the built-in Episodes screen: one
 * card per EPISODE showing title, synopsis, and progress state
 * (completed / current frontier / unlocked / locked). An Episode
 * is the gated unit, so it is the thing whose lock state a card
 * can meaningfully show; Scenes are ordered but not gated.
 * Entering an Episode resumes at whichever Scene the save holds.
 * Forward-only v1: only the frontier card is enterable ("Continue");
 * completed cards render their state but are not clickable —
 * that affordance is reserved for the future sandbox replay mode
 * (Plan 059 central tension).
 *
 * Built-in rather than an authored menu definition: the content
 * is entirely DERIVED (Scenes + campaign.progression), not
 * authored layout. The genre survey behind Plan 059 shows every
 * episodic game treats this screen as chrome, not content.
 *
 * Implements: Plan 059 §059.4
 *
 * Status: active
 */

import type { JSX } from "react";

export type EpisodeCardStatus = "completed" | "current" | "unlocked" | "locked";

export interface EpisodeCardModel {
  episodeId: string;
  displayName: string;
  description: string;
  status: EpisodeCardStatus;
}

/**
 * The cards, grouped by the Season holding them.
 *
 * Grouped rather than flat because the card ordinal restarts inside
 * each Season: under a heading reading "Season 2", a card numbered
 * 7 is wrong. A one-Season project renders with no heading at all,
 * so a game that never makes a second Season looks exactly as it
 * did before Seasons existed.
 */
export interface EpisodesViewModel {
  groups: Array<{
    seasonId: string;
    displayName: string;
    entries: EpisodeCardModel[];
  }>;
}

const STATUS_BADGES: Record<EpisodeCardStatus, string> = {
  completed: "Completed",
  current: "Current",
  unlocked: "Unlocked",
  locked: "Locked"
};

export function EpisodesScreen(props: {
  episodes: EpisodesViewModel;
  onContinue: () => void;
  onClose: () => void;
}): JSX.Element {
  const { episodes, onContinue, onClose } = props;
  return (
    <div
      data-sugarmagic-episodes-screen
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        padding: "48px 24px 24px",
        overflowY: "auto",
        pointerEvents: "auto",
        background: "rgba(7, 7, 15, 0.92)"
      }}
    >
      <div
        style={{
          fontSize: 13,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          opacity: 0.7
        }}
      >
        Episodes
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "min(560px, 100%)"
        }}
      >
        {episodes.groups.map((group) => (
          <div
            key={group.seasonId}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Only when there is more than one Season: a single-Season
                game has nothing to distinguish and the heading would be
                noise. */}
            {episodes.groups.length > 1 && (
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  opacity: 0.6,
                  textAlign: "left",
                  marginTop: 4
                }}
              >
                {group.displayName}
              </div>
            )}
            {group.entries.map((entry, index) => {
              const isCurrent = entry.status === "current";
              const isLocked = entry.status === "locked";
              return (
                <div
                  key={entry.episodeId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "14px 18px",
                    borderRadius: 10,
                    border: isCurrent
                      ? "1px solid rgba(246, 241, 255, 0.75)"
                      : "1px solid rgba(246, 241, 255, 0.18)",
                    background: isCurrent
                      ? "rgba(246, 241, 255, 0.08)"
                      : "rgba(246, 241, 255, 0.03)",
                    opacity: isLocked ? 0.45 : 1
                  }}
                >
                  <div style={{ fontSize: 22, opacity: 0.55, width: 28 }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontSize: 17, letterSpacing: "0.04em" }}>
                      {entry.displayName}
                    </div>
                    {entry.description && !isLocked && (
                      <div
                        style={{ fontSize: 13, opacity: 0.65, marginTop: 4 }}
                      >
                        {entry.description}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      opacity: 0.7
                    }}
                  >
                    {STATUS_BADGES[entry.status]}
                  </div>
                  {isCurrent && (
                    <button
                      type="button"
                      onClick={onContinue}
                      style={{
                        padding: "8px 18px",
                        fontSize: 14,
                        letterSpacing: "0.06em",
                        color: "inherit",
                        background: "rgba(246, 241, 255, 0.12)",
                        border: "1px solid rgba(246, 241, 255, 0.5)",
                        borderRadius: 6,
                        cursor: "pointer"
                      }}
                    >
                      Continue
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 6,
          padding: "8px 22px",
          fontSize: 13,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "inherit",
          background: "transparent",
          border: "1px solid rgba(246, 241, 255, 0.35)",
          borderRadius: 6,
          cursor: "pointer"
        }}
      >
        Back
      </button>
    </div>
  );
}
