/**
 * targets/web/src/transitionCard.ts
 *
 * Purpose: the player-facing transition title card ("CHAPTER 3:
 * THE RECKONING"). Rendered by the host when the campaign advances
 * into something carrying a `transitionConfig` — an Episode's
 * chapter card or a Scene's between-Scenes cut, same shape either
 * way. A null config is a hard cut (no card).
 *
 * Plain DOM on purpose: the card renders over a world that is
 * about to be torn down by the reload, so it must not depend on
 * the React UI layer's lifecycle. The full-viewport overlay also
 * blocks pointer/keyboard focus for its duration, which is the
 * "block player input during the animation" rule.
 *
 * Status: active
 */

import type { TransitionConfig } from "@sugarmagic/domain";

/**
 * These styling constants are EXPORTED so Studio's card preview
 * renders from the same source as the runtime card; the two can't
 * drift apart.
 */
export const TRANSITION_CARD_FADE_BACKGROUNDS: Record<
  TransitionConfig["fadeStyle"],
  string
> = {
  black: "#000000",
  white: "#ffffff",
  // "cross" fades the card in over the live frame instead of
  // dropping to a solid; the backdrop stays translucent.
  cross: "rgba(0, 0, 0, 0.72)"
};

export const TRANSITION_CARD_FADE_TEXT_COLORS: Record<
  TransitionConfig["fadeStyle"],
  string
> = {
  black: "#f5f0e8",
  white: "#1a1616",
  cross: "#f5f0e8"
};

export const TRANSITION_CARD_FONT_FAMILY =
  "Georgia, 'Times New Roman', serif";

/**
 * Show the title card, resolve after it has fully played
 * (fade-in + hold). The caller decides what happens next
 * (currently: reload into the new Scene). The overlay is
 * intentionally never removed by this function — the reload
 * replaces the document, and leaving the card up masks the
 * reload flash.
 */
/**
 * Plan 059 §059.3 — the ENTRY title sequence, played over a
 * freshly booted Scene (doubles as a loading mask): game title
 * card, then the Scene's own title card, each fading in, holding,
 * fading out. Unlike `showTransitionCard` the overlays are
 * REMOVED on completion — gameplay continues underneath in the
 * same document. Resolves when the sequence has fully cleared.
 */
export async function showEntryTitleSequence(
  ownerDocument: Document,
  options: {
    gameTitle: string | null;
    sceneCard: TransitionConfig | null;
  }
): Promise<void> {
  if (options.gameTitle) {
    await playRemovableCard(ownerDocument, {
      titleText: options.gameTitle,
      subtitleText: null,
      durationMs: 2200,
      fadeStyle: "black"
    });
  }
  if (options.sceneCard) {
    await playRemovableCard(ownerDocument, options.sceneCard);
  }
}

const CARD_FADE_MS = 400;

function playRemovableCard(
  ownerDocument: Document,
  config: TransitionConfig
): Promise<void> {
  const overlay = buildCardOverlay(ownerDocument, config);
  ownerDocument.body.appendChild(overlay);
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });
    window.setTimeout(() => {
      overlay.style.opacity = "0";
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, CARD_FADE_MS);
    }, CARD_FADE_MS + config.durationMs);
  });
}

function buildCardOverlay(
  ownerDocument: Document,
  config: TransitionConfig
): HTMLDivElement {
  const overlay = ownerDocument.createElement("div");
  overlay.setAttribute("data-scene-transition-card", "");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 9999",
    "display: flex",
    "flex-direction: column",
    "align-items: center",
    "justify-content: center",
    "gap: 12px",
    `background: ${TRANSITION_CARD_FADE_BACKGROUNDS[config.fadeStyle]}`,
    "opacity: 0",
    `transition: opacity ${CARD_FADE_MS}ms ease-in-out`,
    "pointer-events: all",
    "user-select: none",
    `font-family: ${TRANSITION_CARD_FONT_FAMILY}`,
    "text-align: center",
    "padding: 24px"
  ].join(";");

  const title = ownerDocument.createElement("div");
  title.textContent = config.titleText;
  title.style.cssText = [
    `color: ${TRANSITION_CARD_FADE_TEXT_COLORS[config.fadeStyle]}`,
    "font-size: clamp(28px, 5vw, 56px)",
    "letter-spacing: 0.12em",
    "text-transform: uppercase"
  ].join(";");
  overlay.appendChild(title);

  if (config.subtitleText) {
    const subtitle = ownerDocument.createElement("div");
    subtitle.textContent = config.subtitleText;
    subtitle.style.cssText = [
      `color: ${TRANSITION_CARD_FADE_TEXT_COLORS[config.fadeStyle]}`,
      "font-size: clamp(14px, 2vw, 22px)",
      "letter-spacing: 0.3em",
      "opacity: 0.75",
      "text-transform: uppercase"
    ].join(";");
    overlay.appendChild(subtitle);
  }

  // Swallow input while the card is up.
  overlay.addEventListener("keydown", (event) => event.stopPropagation(), true);
  return overlay;
}

export function showTransitionCard(
  ownerDocument: Document,
  config: TransitionConfig
): Promise<void> {
  const overlay = buildCardOverlay(ownerDocument, config);
  ownerDocument.body.appendChild(overlay);

  return new Promise((resolve) => {
    // Next frame so the opacity transition actually animates.
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });
    window.setTimeout(resolve, CARD_FADE_MS + config.durationMs);
  });
}
