/**
 * targets/web/src/creditsRoll.ts
 *
 * Purpose: Plan 059 §059.3 + §059.4 — the end-of-Scene exit
 * overlay: credits scroll bottom-to-top while the Netflix-style
 * routing control sits in the bottom-right corner OVER them
 * (nikki, 2026-07-05 — no separate routing screen, no "press any
 * key" hint; the button IS the interaction):
 *
 *   - next Scene unlocked -> "Next: <title>" button that advances
 *     on press and FILLS over a countdown, auto-advancing when
 *     full (credits cut short exactly like Netflix's binge flow).
 *   - finale (no next) -> a return button, no countdown; the
 *     overlay waits for the press.
 *
 * Plain DOM (sceneTransitionCard family): renders while the world
 * is about to be torn down by the reload; the overlay stays up
 * after resolve to mask the reload flash.
 *
 * Implements: Plan 059 §059.2, §059.3, §059.4
 *
 * Status: active
 */

import type { CreditsDefinition } from "@sugarmagic/domain";
import { SCENE_CARD_FONT_FAMILY } from "./sceneTransitionCard";

/** Scroll pacing: how long each viewport-height of content takes
 *  to travel. Tuned for read-along speed; clamped so tiny credits
 *  don't blink past and huge ones don't drone. */
const MS_PER_VIEWPORT = 9000;
const MIN_ROLL_MS = 4000;
const MAX_ROLL_MS = 90000;
const DEFAULT_COUNTDOWN_MS = 10000;

/** Plan 059 §059.6 — exported so Studio's live credits preview
 *  paces identically to the runtime roll. */
export function computeCreditsRollDurationMs(
  travelPx: number,
  viewportPx: number
): number {
  return Math.max(
    MIN_ROLL_MS,
    Math.min(
      MAX_ROLL_MS,
      (travelPx / Math.max(1, viewportPx)) * MS_PER_VIEWPORT
    )
  );
}

export function showSceneExitOverlay(
  ownerDocument: Document,
  options: {
    credits: CreditsDefinition | null;
    /** Display name of the next unlocked Scene; null after the
     *  final Scene. */
    nextSceneTitle: string | null;
    /** Return-button label for the finale case. */
    menuLabel: string;
    countdownMs?: number;
  }
): Promise<"next" | "menu"> {
  const overlay = ownerDocument.createElement("div");
  overlay.setAttribute("data-scene-exit-overlay", "");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 9999",
    "overflow: hidden",
    "background: #000000",
    "opacity: 0",
    "transition: opacity 400ms ease-in-out",
    "pointer-events: all",
    "user-select: none",
    `font-family: ${SCENE_CARD_FONT_FAMILY}`,
    "text-align: center"
  ].join(";");

  // --- Credits scroller (skipped when nothing to render) -------
  const sections = (options.credits?.sections ?? [])
    .map((section) => ({
      heading: section.heading.trim(),
      lines: section.lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    }))
    .filter(
      (section) => section.heading.length > 0 || section.lines.length > 0
    );

  let scroller: HTMLDivElement | null = null;
  if (sections.length > 0) {
    scroller = ownerDocument.createElement("div");
    scroller.style.cssText = [
      "position: absolute",
      "left: 0",
      "right: 0",
      "top: 100%",
      "display: flex",
      "flex-direction: column",
      "gap: 28px",
      "padding: 0 24px"
    ].join(";");
    for (const section of sections) {
      const block = ownerDocument.createElement("div");
      if (section.heading) {
        const heading = ownerDocument.createElement("div");
        heading.textContent = section.heading;
        heading.style.cssText = [
          "color: #8a8378",
          "font-size: 13px",
          "letter-spacing: 0.3em",
          "text-transform: uppercase",
          "margin-bottom: 8px"
        ].join(";");
        block.appendChild(heading);
      }
      for (const line of section.lines) {
        const row = ownerDocument.createElement("div");
        row.textContent = line;
        row.style.cssText = [
          "color: #f5f0e8",
          "font-size: 22px",
          "letter-spacing: 0.06em",
          "line-height: 1.7"
        ].join(";");
        block.appendChild(row);
      }
      scroller.appendChild(block);
    }
    overlay.appendChild(scroller);
  }

  // --- Bottom-right routing control -----------------------------
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.style.cssText = [
    "position: absolute",
    "bottom: 22px",
    "right: 24px",
    "overflow: hidden",
    "padding: 12px 28px",
    "font-size: 16px",
    "letter-spacing: 0.08em",
    `font-family: ${SCENE_CARD_FONT_FAMILY}`,
    "color: #f5f0e8",
    "background: rgba(245, 240, 232, 0.08)",
    "border: 1px solid rgba(245, 240, 232, 0.45)",
    "border-radius: 6px",
    "cursor: pointer"
  ].join(";");

  return new Promise((resolve) => {
    let settled = false;
    let countdownTimer = 0;
    const finish = (choice: "next" | "menu") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(countdownTimer);
      // Overlay stays up — the caller reloads and the black
      // screen masks the flash.
      resolve(choice);
    };

    if (options.nextSceneTitle) {
      const countdownMs = options.countdownMs ?? DEFAULT_COUNTDOWN_MS;
      const fill = ownerDocument.createElement("span");
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
      countdownTimer = window.setTimeout(
        () => finish("next"),
        countdownMs
      );
      requestAnimationFrame(() => {
        fill.style.width = "100%";
      });
    } else {
      button.textContent = options.menuLabel;
      button.addEventListener("click", () => finish("menu"));
    }
    overlay.appendChild(button);

    ownerDocument.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });

    // Kick the credits scroll. When the roll finishes with no
    // routing chosen yet (finale case, or countdown still
    // filling), the screen simply holds black with the button.
    if (scroller) {
      const viewportHeight = Math.max(
        1,
        overlay.clientHeight || ownerDocument.documentElement.clientHeight
      );
      const travel = viewportHeight + scroller.scrollHeight;
      const durationMs = computeCreditsRollDurationMs(travel, viewportHeight);
      scroller.style.transition = `transform ${durationMs}ms linear`;
      requestAnimationFrame(() => {
        scroller!.style.transform = `translateY(-${travel}px)`;
      });
    }
  });
}
