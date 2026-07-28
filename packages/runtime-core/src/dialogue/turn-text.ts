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
