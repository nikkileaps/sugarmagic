/**
 * packages/runtime-core/src/dialogue/highlight.ts
 *
 * Purpose: Generic word-boundary-aware focus term matching for dialogue highlighting.
 *         Any plugin can write a DialogueHighlightAnnotation onto a turn's annotations
 *         under the key "dialogueHighlight" and the DialoguePanel will render it.
 *
 * Exports:
 *   - HighlightMatch
 *   - DialogueHighlightAnnotation
 *   - findTermMatches
 *   - readDialogueHighlight
 *
 * Status: active
 */

export interface HighlightMatch {
  start: number;
  end: number;
  term: string;
  celebrate: boolean;
}

export interface DialogueHighlightAnnotation {
  focusTerms: string[];
  celebrateTerms: string[];
}

const DIALOGUE_HIGHLIGHT_KEY = "dialogueHighlight";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findTermMatches(
  text: string,
  focusTerms: string[],
  celebrateTerms: string[]
): HighlightMatch[] {
  const celebrateSet = new Set(celebrateTerms.map((t) => t.toLowerCase()));
  const matches: HighlightMatch[] = [];
  const occupied = new Uint8Array(text.length);

  const sorted = [...focusTerms].sort((a, b) => b.length - a.length);

  for (const term of sorted) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(term)}\\b`,
      "gi"
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      let overlap = false;
      for (let i = start; i < end; i++) {
        if (occupied[i]) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      for (let i = start; i < end; i++) {
        occupied[i] = 1;
      }

      matches.push({
        start,
        end,
        term: match[0],
        celebrate: celebrateSet.has(term.toLowerCase())
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Reads the generic dialogueHighlight annotation from a turn's annotations.
 * Any plugin can write { focusTerms: string[], celebrateTerms: string[] }
 * under the "dialogueHighlight" key.
 */
export function readDialogueHighlight(
  annotations: Record<string, unknown> | undefined
): DialogueHighlightAnnotation | null {
  if (!annotations) return null;
  const highlight = annotations[DIALOGUE_HIGHLIGHT_KEY];
  if (
    typeof highlight !== "object" ||
    highlight === null ||
    !Array.isArray((highlight as Record<string, unknown>).focusTerms)
  ) {
    return null;
  }
  const record = highlight as Record<string, unknown>;
  return {
    focusTerms: (record.focusTerms as string[]).filter(
      (t) => typeof t === "string"
    ),
    celebrateTerms: Array.isArray(record.celebrateTerms)
      ? (record.celebrateTerms as string[]).filter(
          (t) => typeof t === "string"
        )
      : []
  };
}
