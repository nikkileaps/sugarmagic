/**
 * targets/web/src/creditsRoll.ts
 *
 * Purpose: Plan 059 §059.2 — the end-of-Scene credits roll.
 * Sections scroll bottom-to-top over a duration derived from
 * content length; any pointer/key input skips (resolves early).
 *
 * Plain DOM like `sceneTransitionCard` and for the same reason:
 * it renders during the exit sequence while the world is about
 * to be torn down, so it must not depend on the React UI layer.
 * The full-viewport overlay blocks pointer/keyboard interaction
 * with the game underneath.
 *
 * The overlay is removed on resolve — unlike the transition
 * card, the caller (059.3's exit sequence) continues to the
 * routing screen in the SAME document rather than reloading.
 *
 * Implements: Plan 059 §059.2
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

export interface CreditsRollHandle {
  /** Resolves when the roll finishes or the player skips. */
  done: Promise<void>;
}

export function showCreditsRoll(
  ownerDocument: Document,
  credits: CreditsDefinition
): CreditsRollHandle {
  if (credits.sections.length === 0) {
    return { done: Promise.resolve() };
  }

  const overlay = ownerDocument.createElement("div");
  overlay.setAttribute("data-credits-roll", "");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 9999",
    "overflow: hidden",
    "background: #000000",
    "pointer-events: all",
    "user-select: none",
    `font-family: ${SCENE_CARD_FONT_FAMILY}`,
    "text-align: center"
  ].join(";");

  const scroller = ownerDocument.createElement("div");
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

  for (const section of credits.sections) {
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

  const skipHint = ownerDocument.createElement("div");
  skipHint.textContent = "Press any key to skip";
  skipHint.style.cssText = [
    "position: absolute",
    "bottom: 14px",
    "right: 18px",
    "color: #8a8378",
    "font-size: 11px",
    "letter-spacing: 0.2em",
    "text-transform: uppercase",
    "opacity: 0.7"
  ].join(";");

  overlay.appendChild(scroller);
  overlay.appendChild(skipHint);
  ownerDocument.body.appendChild(overlay);

  const viewportHeight = Math.max(
    1,
    overlay.clientHeight || ownerDocument.documentElement.clientHeight
  );
  const contentHeight = scroller.scrollHeight;
  const travel = viewportHeight + contentHeight;
  const durationMs = Math.max(
    MIN_ROLL_MS,
    Math.min(MAX_ROLL_MS, (travel / viewportHeight) * MS_PER_VIEWPORT)
  );

  let settled = false;
  let timer = 0;
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      overlay.removeEventListener("pointerdown", finish);
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      resolve();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Swallow the skip input so the game underneath never
      // sees it.
      event.stopPropagation();
      finish();
    };
    overlay.addEventListener("pointerdown", finish);
    ownerDocument.addEventListener("keydown", onKeyDown, true);

    // Kick the scroll on the next frame so the transition runs.
    scroller.style.transition = `transform ${durationMs}ms linear`;
    requestAnimationFrame(() => {
      scroller.style.transform = `translateY(-${travel}px)`;
    });
    timer = window.setTimeout(finish, durationMs + 400);
  });

  return { done };
}
