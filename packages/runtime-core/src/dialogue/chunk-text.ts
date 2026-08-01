/**
 * packages/runtime-core/src/dialogue/chunk-text.ts
 *
 * Purpose: Split a long turn's text into chunks that each fit a maximum number
 *   of RENDERED lines, so a long-winded NPC is read a card at a time instead of
 *   overflowing the dialogue panel and being clipped mid-sentence.
 *
 * PRESENTATION ONLY
 *   Chunking never reaches the conversation. One envelope still produces one
 *   turn upstream; this only decides how many cards the panel draws for it, so
 *   telemetry, grading and observation see exactly what they saw before.
 *
 * WHY LINES ARE MEASURED AND NOT COUNTED FROM CHARACTERS
 *   "Three lines" is a WRAPPING outcome, not a length. It moves with the panel
 *   width, and it moves with the text: a focus term renders as an
 *   `inline-flex` span, which is an atomic inline box, so highlighted text
 *   wraps differently from the same string in plain text. Any character
 *   estimate is measuring the wrong thing. The caller supplies `measureLines`,
 *   which renders a candidate and counts its real line boxes.
 *
 * Exports:
 *   - splitTextIntoChunks
 *
 * Relationships:
 *   - Pure. No DOM, no conversation, no language knowledge -- the DOM probe
 *     lives in DialoguePanel, which is what makes this unit-testable.
 *
 * Status: active
 */

export interface UnbreakableRange {
  /** Inclusive start offset in the original text. */
  start: number;
  /** Exclusive end offset in the original text. */
  end: number;
}

export interface SplitTextOptions {
  /** Maximum rendered line boxes a single chunk may occupy. */
  maxLines: number;
  /** Renders `text` and returns how many line boxes it occupies. */
  measureLines: (text: string) => number;
  /**
   * Spans that must never be cut through -- in practice the matched focus
   * terms, so a highlighted phrase cannot be torn across two cards and lose
   * its gold/blue marking or its celebrate burst.
   */
  unbreakable?: readonly UnbreakableRange[];
}

/** Offsets at which a new word begins -- the only places a split may land. */
function wordStartOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let i = 1; i < text.length; i++) {
    if (!/\s/.test(text[i]!) && /\s/.test(text[i - 1]!)) {
      offsets.push(i);
    }
  }
  return offsets;
}

function cutsThroughTerm(offset: number, ranges: readonly UnbreakableRange[]): boolean {
  return ranges.some((range) => offset > range.start && offset < range.end);
}

/**
 * Splits `text` so that every chunk renders within `maxLines`.
 *
 * Returns `[text]` unchanged when it already fits, which is the common case --
 * most turns are short and must not pay for this.
 */
export function splitTextIntoChunks(text: string, options: SplitTextOptions): string[] {
  const { maxLines, measureLines, unbreakable = [] } = options;
  if (maxLines < 1) {
    throw new Error("splitTextIntoChunks: maxLines must be at least 1");
  }
  if (!text.trim()) {
    return [text];
  }
  if (measureLines(text) <= maxLines) {
    return [text];
  }

  const chunks: string[] = [];
  const allOffsets = wordStartOffsets(text);
  let base = 0;

  while (base < text.length) {
    const remainder = text.slice(base);
    if (measureLines(remainder) <= maxLines) {
      chunks.push(remainder);
      break;
    }

    // Candidate cut points ahead of the current chunk's start, in order.
    const candidates = allOffsets.filter(
      (offset) => offset > base && !cutsThroughTerm(offset, unbreakable)
    );
    if (candidates.length === 0) {
      // One unbreakable run longer than the budget -- a single very long word,
      // or a term that fills the card. Overflowing one card beats looping.
      chunks.push(remainder);
      break;
    }

    // Largest prefix that still fits. Binary search because `measureLines` does
    // real layout work, so the probe count matters.
    let lo = 0;
    let hi = candidates.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = text.slice(base, candidates[mid]!).trimEnd();
      if (candidate && measureLines(candidate) <= maxLines) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Nothing fits: the first word alone already overflows. Emit it anyway so
    // `base` always advances -- a chunker that can return no progress hangs the
    // dialogue rather than degrading it.
    const cut = candidates[best >= 0 ? best : 0]!;
    // Only whitespace lies before the first candidate when the text is indented
    // or the opening word already overflows -- pushing that slice put an EMPTY
    // card in the conversation. `base` still advances, so nothing is lost and
    // the loop still terminates.
    const chunk = text.slice(base, cut).trimEnd();
    if (chunk) chunks.push(chunk);
    base = cut;
  }

  return chunks;
}
