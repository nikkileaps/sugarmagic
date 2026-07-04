/**
 * targets/web/src/sceneTransitionCard.ts
 *
 * Purpose: Plan 058 §058.5 — the player-facing Scene transition
 * title card ("CHAPTER 3: THE RECKONING"). Rendered by the host
 * when a quest action advances the campaign into a Scene that
 * carries a `transitionConfig`; a null config is a hard cut (no
 * card).
 *
 * Plain DOM on purpose: the card renders over a world that is
 * about to be torn down by the Scene-change reload, so it must
 * not depend on the React UI layer's lifecycle. The full-viewport
 * overlay also blocks pointer/keyboard focus for its duration,
 * which is the "block player input during the animation" rule.
 *
 * Implements: Plan 058 §058.5
 *
 * Status: active
 */

import type { SceneTransitionConfig } from "@sugarmagic/domain";

/**
 * Plan 058 §058.6 — these styling constants are EXPORTED so
 * Studio's Scene properties panel renders its static card
 * preview from the same source; preview and runtime card can't
 * drift apart.
 */
export const SCENE_CARD_FADE_BACKGROUNDS: Record<
  SceneTransitionConfig["fadeStyle"],
  string
> = {
  black: "#000000",
  white: "#ffffff",
  // "cross" fades the card in over the live frame instead of
  // dropping to a solid; the backdrop stays translucent.
  cross: "rgba(0, 0, 0, 0.72)"
};

export const SCENE_CARD_FADE_TEXT_COLORS: Record<
  SceneTransitionConfig["fadeStyle"],
  string
> = {
  black: "#f5f0e8",
  white: "#1a1616",
  cross: "#f5f0e8"
};

export const SCENE_CARD_FONT_FAMILY =
  "Georgia, 'Times New Roman', serif";

/**
 * Show the title card, resolve after it has fully played
 * (fade-in + hold). The caller decides what happens next
 * (currently: reload into the new Scene). The overlay is
 * intentionally never removed by this function — the reload
 * replaces the document, and leaving the card up masks the
 * reload flash.
 */
export function showSceneTransitionCard(
  ownerDocument: Document,
  config: SceneTransitionConfig
): Promise<void> {
  const FADE_IN_MS = 400;
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
    `background: ${SCENE_CARD_FADE_BACKGROUNDS[config.fadeStyle]}`,
    "opacity: 0",
    `transition: opacity ${FADE_IN_MS}ms ease-in-out`,
    "pointer-events: all",
    "user-select: none",
    `font-family: ${SCENE_CARD_FONT_FAMILY}`,
    "text-align: center",
    "padding: 24px"
  ].join(";");

  const title = ownerDocument.createElement("div");
  title.textContent = config.titleText;
  title.style.cssText = [
    `color: ${SCENE_CARD_FADE_TEXT_COLORS[config.fadeStyle]}`,
    "font-size: clamp(28px, 5vw, 56px)",
    "letter-spacing: 0.12em",
    "text-transform: uppercase"
  ].join(";");
  overlay.appendChild(title);

  if (config.subtitleText) {
    const subtitle = ownerDocument.createElement("div");
    subtitle.textContent = config.subtitleText;
    subtitle.style.cssText = [
      `color: ${SCENE_CARD_FADE_TEXT_COLORS[config.fadeStyle]}`,
      "font-size: clamp(14px, 2vw, 22px)",
      "letter-spacing: 0.3em",
      "opacity: 0.75",
      "text-transform: uppercase"
    ].join(";");
    overlay.appendChild(subtitle);
  }

  ownerDocument.body.appendChild(overlay);
  // Swallow input while the card is up.
  overlay.addEventListener("keydown", (event) => event.stopPropagation(), true);

  return new Promise((resolve) => {
    // Next frame so the opacity transition actually animates.
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });
    window.setTimeout(resolve, FADE_IN_MS + config.durationMs);
  });
}
