/**
 * Shared enriched-text rendering for dialogue presentations.
 *
 * Turns a turn's text plus its `dialogueHighlight` annotation into a DOM
 * element with focus-term spans, hover glosses, celebrate bursts, and the
 * dwell-timer telemetry hook.
 *
 * This lives outside any one presenter on purpose: the chat panel and the
 * scripted box must show IDENTICAL language enrichment, and a second copy of
 * this logic would drift the moment either one is touched.
 */

import type { ConversationTurnEnvelope } from "../conversation";
import { findTermMatches, readDialogueHighlight } from "./highlight";

/** Dwell before a hover counts as a look, matching the observe-side contract. */
const HOVER_DWELL_MS = 300;

export interface TurnTextOptions {
  onTermHover?: (event: { term: string; dwellMs: number }) => void;
  /**
   * 090.12: fired when the player SELECTS text inside this turn -- drag across a
   * word the way you would with a highlighter. The host resolves it to a gloss
   * and decides whether to show anything.
   *
   * Deliberately not hover: at B2+ most of a line is target language, so hover
   * fires constantly on words nobody asked about. Selection only happens on
   * purpose. Taught words keep their hover gloss; this is the second way in and
   * works on any span, including target language the Teacher never chose.
   */
  onSelectionLookup?: (event: { selection: string; anchor: DOMRect | null }) => void;
}

/**
 * Attaches the selection listener. Separated so it is obvious this touches
 * NOTHING about how terms are marked up -- gold, blue and the celebrate
 * animation come from classes applied below and are not reachable from here.
 */
function attachSelectionLookup(
  element: HTMLElement,
  notify: NonNullable<TurnTextOptions["onSelectionLookup"]>
): void {
  element.addEventListener("mouseup", () => {
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    const text = selection?.toString() ?? "";
    if (!text.trim()) {
      return;
    }
    // Only react to a selection that lies inside THIS turn. A drag starting in
    // another entry and ending here would otherwise look up text the player
    // never pointed at in this line.
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || !element.contains(range.commonAncestorContainer)) {
      return;
    }
    notify({ selection: text, anchor: range.getBoundingClientRect() });
  });
}

/**
 * Builds the `.sm-dialogue-entry-text` element for a turn. Falls back to plain
 * text when there is no highlight annotation or nothing matches, so an
 * un-enriched turn renders exactly as before.
 */
export function createTurnTextElement(
  turn: ConversationTurnEnvelope,
  options: TurnTextOptions = {}
): HTMLDivElement {
  const textElement = document.createElement("div");
  textElement.className = "sm-dialogue-entry-text";

  // 090.12: selection works on EVERY turn, including ones with no highlight at
  // all. A line can be full of target language the slate never asked for --
  // that is exactly the case the player most needs to be able to interrogate,
  // and it is the case that returns early below.
  if (options.onSelectionLookup) {
    attachSelectionLookup(textElement, options.onSelectionLookup);
  }

  const turnHighlight = readDialogueHighlight(turn.annotations);
  if (!turnHighlight || turnHighlight.focusTerms.length === 0) {
    textElement.textContent = turn.text;
    return textElement;
  }

  const matches = findTermMatches(
    turn.text,
    turnHighlight.focusTerms,
    turnHighlight.celebrateTerms,
    turnHighlight.introduceTerms
  );
  if (matches.length === 0) {
    textElement.textContent = turn.text;
    return textElement;
  }

  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      textElement.appendChild(
        document.createTextNode(turn.text.slice(cursor, match.start))
      );
    }

    const wrapper = document.createElement("span");
    const vocabKind = match.introduce
      ? "sm-dialogue-focus-term-introduce"
      : "sm-dialogue-focus-term-reinforce";
    wrapper.className = match.celebrate
      ? `sm-dialogue-focus-term ${vocabKind} sm-dialogue-focus-term-celebrate`
      : `sm-dialogue-focus-term ${vocabKind}`;

    if (options.onTermHover) {
      const notify = options.onTermHover;
      let hoverTimer: ReturnType<typeof setTimeout> | null = null;
      let hoverStartMs = 0;
      wrapper.addEventListener("mouseenter", () => {
        hoverStartMs = Date.now();
        hoverTimer = setTimeout(() => {
          notify({
            term: match.term.toLowerCase(),
            dwellMs: Date.now() - hoverStartMs
          });
        }, HOVER_DWELL_MS);
      });
      wrapper.addEventListener("mouseleave", () => {
        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }
      });
    }

    const termText = document.createElement("span");
    termText.className = "sm-dialogue-focus-term-text";
    termText.textContent = match.term;
    wrapper.appendChild(termText);

    const gloss = turnHighlight.glosses?.[match.term.toLowerCase()];
    if (gloss) {
      const tooltip = document.createElement("span");
      tooltip.className = "sm-dialogue-focus-tooltip";
      tooltip.textContent = gloss;
      tooltip.setAttribute("aria-hidden", "true");
      wrapper.appendChild(tooltip);
    }

    if (match.celebrate) {
      const burst = document.createElement("span");
      burst.className = "sm-dialogue-focus-burst";
      const halo = document.createElement("span");
      halo.className = "sm-dialogue-focus-burst-halo";
      const star = document.createElement("span");
      star.className = "sm-dialogue-focus-burst-star";
      star.textContent = "★";
      burst.appendChild(halo);
      burst.appendChild(star);
      wrapper.appendChild(burst);
    }

    textElement.appendChild(wrapper);
    cursor = match.end;
  }

  if (cursor < turn.text.length) {
    textElement.appendChild(document.createTextNode(turn.text.slice(cursor)));
  }

  return textElement;
}
