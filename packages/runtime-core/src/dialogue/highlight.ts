/**
 * packages/runtime-core/src/dialogue/highlight.ts
 *
 * Purpose: Generic word-boundary-aware focus term matching for dialogue highlighting.
 *         Any plugin can write a DialogueHighlightAnnotation onto a turn's annotations
 *         under the key "dialogueHighlight" and the DialoguePanel will render it.
 *         Also carries the TeachLineAnnotation contract (085.5) for function-first-teach beats.
 *
 * Exports:
 *   - HighlightMatch
 *   - DialogueHighlightAnnotation
 *   - TeachLineAnnotation
 *   - findTermMatches
 *   - readDialogueHighlight
 *   - readTeachLine
 *
 * Status: active
 */

export interface HighlightMatch {
  start: number;
  end: number;
  term: string;
  celebrate: boolean;
  /** True if this term is newly introduced vocabulary; false means reinforce (review). */
  introduce: boolean;
}

export interface DialogueHighlightAnnotation {
  /** All highlighted terms (union of introduce and reinforce). */
  focusTerms: string[];
  /** Subset of focusTerms that are new vocabulary being introduced this turn. */
  introduceTerms: string[];
  celebrateTerms: string[];
  /** Optional term → gloss map for tooltip display (e.g. { "queso": "cheese" }). */
  glosses?: Record<string, string>;
  /**
   * 090.11/090.12: target-language spans the slate never asked for.
   *
   * ADDED, NOT RESTRUCTURED. The four fields above and `findTermMatches` are
   * untouched, so gold (introduce), blue (recall) and the celebrate animation
   * cannot be affected by anything downstream of this field -- there is no edit
   * to them to get wrong.
   *
   * Deliberately NOT styled. At A1 (25% target language) ambient is a few
   * words; at B2+ (85%) it is nearly the whole line, so marking it would mark
   * everything and drown the two colours that carry meaning. It exists so the
   * system KNOWS where the target language is -- for select-to-translate, and
   * so `focus + recall + ambient` can finally measure the realized ratio.
   */
  ambientSpans?: Array<{
    start: number;
    end: number;
    surface: string;
    lemmaId: string;
  }>;
}

const DIALOGUE_HIGHLIGHT_KEY = "dialogueHighlight";

/**
 * Written by sugarlang observe middleware on the first classifier-matched encounter
 * of a chunk that realizes a communicative function (085.5 first-teach beat).
 * DialoguePanel renders it in the enrichmentContainer as a labeled sub-line.
 */
export interface TeachLineAnnotation {
  /** Short function label, e.g. "Greeting". */
  label: string;
  /** One-line teach note, e.g. '"Buenos dias" is a formal morning greeting.' */
  text: string;
}

const TEACH_LINE_KEY = "sugarlang.teachLine";

export function readTeachLine(
  annotations: Record<string, unknown> | undefined
): TeachLineAnnotation | null {
  if (!annotations) return null;
  const raw = annotations[TEACH_LINE_KEY];
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).label !== "string" ||
    typeof (raw as Record<string, unknown>).text !== "string"
  ) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  return { label: r.label as string, text: r.text as string };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findTermMatches(
  text: string,
  focusTerms: string[],
  celebrateTerms: string[],
  introduceTerms?: string[]
): HighlightMatch[] {
  const celebrateSet = new Set(celebrateTerms.map((t) => t.toLowerCase()));
  const introduceSet = new Set((introduceTerms ?? []).map((t) => t.toLowerCase()));
  const matches: HighlightMatch[] = [];
  const occupied = new Uint8Array(text.length);

  const MIN_TERM_LENGTH = 3;
  const sorted = [...focusTerms]
    .filter((t) => t.length >= MIN_TERM_LENGTH)
    .sort((a, b) => b.length - a.length);

  for (const term of sorted) {
    // Match the lemma and common inflected forms (e.g. maleta → maletas,
    // hablar → hablando). The \w{0,4} suffix allows up to 4 extra characters
    // for plural, conjugation, or gender suffixes while staying word-bounded.
    const pattern = new RegExp(
      `\\b${escapeRegExp(term)}\\w{0,4}\\b`,
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
        celebrate: celebrateSet.has(term.toLowerCase()),
        introduce: introduceSet.has(term.toLowerCase())
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Reads the generic dialogueHighlight annotation from a turn's annotations.
 * Any plugin can write { focusTerms: string[], introduceTerms: string[], celebrateTerms: string[] }
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
  const glosses =
    typeof record.glosses === "object" && record.glosses !== null
      ? (record.glosses as Record<string, string>)
      : undefined;

  return {
    focusTerms: (record.focusTerms as string[]).filter(
      (t) => typeof t === "string"
    ),
    introduceTerms: Array.isArray(record.introduceTerms)
      ? (record.introduceTerms as string[]).filter(
          (t) => typeof t === "string"
        )
      : [],
    celebrateTerms: Array.isArray(record.celebrateTerms)
      ? (record.celebrateTerms as string[]).filter(
          (t) => typeof t === "string"
        )
      : [],
    glosses
  };
}
