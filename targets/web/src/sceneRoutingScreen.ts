/**
 * targets/web/src/sceneRoutingScreen.ts
 *
 * Purpose: Plan 059 §059.3 — the post-credits routing screen.
 * Netflix model (nikki, 2026-07-04): when a next Scene is
 * unlocked, one big "Next: <title>" button that advances on
 * press AND visually fills over a countdown, auto-advancing when
 * full. When there is no next Scene, a single return button (no
 * countdown) back to the menu.
 *
 * Plain DOM in the sceneTransitionCard family — renders during
 * the exit sequence, and the overlay intentionally stays up
 * after resolve: the caller reloads, and the dark screen masks
 * the reload flash.
 *
 * Implements: Plan 059 §059.3
 *
 * Status: active
 */

import { SCENE_CARD_FONT_FAMILY } from "./sceneTransitionCard";

const DEFAULT_COUNTDOWN_MS = 10000;

export function showSceneRoutingScreen(
  ownerDocument: Document,
  options: {
    /** Display name of the next unlocked Scene, or null when the
     *  player has finished the last unlocked Scene. */
    nextSceneTitle: string | null;
    /** Return-button label; the destination is the caller's
     *  concern ("menu" resolution). */
    menuLabel: string;
    countdownMs?: number;
  }
): Promise<"next" | "menu"> {
  const overlay = ownerDocument.createElement("div");
  overlay.setAttribute("data-scene-routing", "");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 9999",
    "display: flex",
    "flex-direction: column",
    "align-items: center",
    "justify-content: center",
    "gap: 18px",
    "background: #000000",
    "opacity: 0",
    "transition: opacity 400ms ease-in-out",
    "pointer-events: all",
    "user-select: none",
    `font-family: ${SCENE_CARD_FONT_FAMILY}`,
    "text-align: center"
  ].join(";");

  const makeButton = (label: string): HTMLButtonElement => {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
      "position: relative",
      "overflow: hidden",
      "padding: 14px 36px",
      "font-size: 18px",
      "letter-spacing: 0.08em",
      `font-family: ${SCENE_CARD_FONT_FAMILY}`,
      "color: #f5f0e8",
      "background: rgba(245, 240, 232, 0.08)",
      "border: 1px solid rgba(245, 240, 232, 0.45)",
      "border-radius: 6px",
      "cursor: pointer"
    ].join(";");
    return button;
  };

  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (choice: "next" | "menu") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // Overlay stays up — the caller reloads and the black
      // screen masks the flash.
      resolve(choice);
    };

    if (options.nextSceneTitle) {
      const button = makeButton("");
      // The fill layer animates width behind the label — the
      // "button filling up" countdown affordance.
      const fill = ownerDocument.createElement("span");
      const countdownMs = options.countdownMs ?? DEFAULT_COUNTDOWN_MS;
      fill.style.cssText = [
        "position: absolute",
        "inset: 0",
        "width: 0%",
        "background: rgba(245, 240, 232, 0.28)",
        `transition: width ${countdownMs}ms linear`
      ].join(";");
      const label = ownerDocument.createElement("span");
      label.textContent = `Next: ${options.nextSceneTitle}`;
      label.style.cssText = "position: relative";
      button.append(fill, label);
      button.addEventListener("click", () => finish("next"));
      overlay.appendChild(button);
      requestAnimationFrame(() => {
        fill.style.width = "100%";
      });
      timer = window.setTimeout(() => finish("next"), countdownMs);
    } else {
      const button = makeButton(options.menuLabel);
      button.addEventListener("click", () => finish("menu"));
      overlay.appendChild(button);
    }

    ownerDocument.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });
  });
}
