/**
 * packages/runtime-core/src/dialogue/highlight.ts
 *
 * Purpose: Generic word-boundary-aware focus term matching for dialogue highlighting.
 *         Any plugin can write a DialogueHighlightAnnotation onto a turn's annotations
 *         under the key "dialogueHighlight" and the DialoguePanel will render it.
 *         Carries the DialogueTeachLineAnnotation contract on the same terms: a
 *         generic key, written by whoever has something to say, rendered by
 *         runtime-core without knowing who wrote it.
 *
 * Exports:
 *   - HighlightMatch
 *   - DialogueHighlightAnnotation
 *   - DialogueTeachLineAnnotation
 *   - findTermMatches
 *   - readDialogueHighlight
 *   - readDialogueTeachLine
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
   * Optional term → the identity the term counts AS.
   *
   * A term is a surface, and several surfaces are the same word: `hablo`,
   * `hablas` and `hablar` are one thing to a learner. Anything recording WHAT
   * WAS MET rather than where it sat on screen reads this -- runtime-core does
   * not know or care what the values mean, only that a term may carry one.
   *
   * Absent means the writer had nothing to say, and readers fall back to the
   * term itself.
   */
  creditByTerm?: Record<string, string>;
}

const DIALOGUE_HIGHLIGHT_KEY = "dialogueHighlight";

/**
 * A short labelled note attached to a turn, rendered beneath it.
 *
 * GENERIC, like DialogueHighlightAnnotation beside it: any plugin may write one
 * and runtime-core renders whatever it finds. WHY a plugin writes one, and when,
 * is the plugin's business and is documented at the writer -- runtime-core knows
 * only that a turn may carry a label and a line of text.
 */
export interface DialogueTeachLineAnnotation {
  /** Short label, e.g. "Greeting". */
  label: string;
  /** One line of text, e.g. '"Buenos dias" is a formal morning greeting.' */
  text: string;
}

/**
 * Was "sugarlang.teachLine". A key namespaced to one plugin, in the layer that
 * must not know that plugin exists: remove sugarlang and the reader became dead
 * code that still shipped, and no other plugin could ever produce a teach line.
 *
 * EXPORTED so writers import it instead of copying the string. A private key
 * with a hand-typed literal on the writing side is the same silent-failure
 * shape this rename was meant to end -- both sides' tests keep passing while
 * the annotation quietly stops rendering.
 */
export const DIALOGUE_TEACH_LINE_KEY = "dialogueTeachLine";

/**
 * Attaches a teach line to a turn's annotations.
 *
 * The write half of the contract, so the key and the shape are checked by the
 * compiler rather than agreed by convention.
 */
export function writeDialogueTeachLine(
  annotations: Record<string, unknown>,
  teachLine: DialogueTeachLineAnnotation
): void {
  annotations[DIALOGUE_TEACH_LINE_KEY] = teachLine;
}

export function readDialogueTeachLine(
  annotations: Record<string, unknown> | undefined
): DialogueTeachLineAnnotation | null {
  if (!annotations) return null;
  const raw = annotations[DIALOGUE_TEACH_LINE_KEY];
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

  // TWO CHARACTERS IS A WORD. `es`, `va`, `ve`, `da` and `ha` are forms of
  // ser, ir, ver, dar and haber -- the five commonest verbs in the language --
  // and a three-character floor silently dropped every one of them. The floor
  // existed to stop stray fragments matching when terms were guessed; terms are
  // now exact forms supplied by the caller, so a short term is a real word
  // rather than a fragment.
  const MIN_TERM_LENGTH = 2;
  const sorted = [...focusTerms]
    .filter((t) => t.length >= MIN_TERM_LENGTH)
    .sort((a, b) => b.length - a.length);

  for (const term of sorted) {
    // EXACT MATCH, WITH A UNICODE-AWARE BOUNDARY.
    //
    // This was `\b<term>\w{0,4}\b` -- a guess at inflection, tolerating up to
    // four trailing characters so `maleta` could catch `maletas`. It was wrong
    // in both directions: it never reached `hablo` from `hablar`, because
    // Spanish conjugation changes the stem rather than appending to it, and it
    // over-matched into words that merely began the same way.
    //
    // The caller now supplies every form explicitly, so there is nothing left
    // to guess and the match is literal.
    //
    // `\b` and `\w` are ASCII-only, so they treat an accent as a word
    // boundary: `\bhabló\b` matches NOTHING, and `\bhablar\w{0,4}\b` inside
    // `hablarás` used to match just `hablar` and light up half a word. Spanish
    // preterite first and third person always end in an accented vowel, so that
    // was most of a tense. The lookarounds below are letter-aware.
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{M}])${escapeRegExp(term)}(?![\\p{L}\\p{M}])`,
      "giu"
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
  // COPY EVERY FIELD THE TYPE DECLARES. A field the reader forgets is a field
  // nothing downstream can see, however carefully the writer set it -- that
  // already happened once with ambientSpans, which rode the annotation for a
  // release while `readDialogueHighlight` quietly dropped it.
  const creditByTerm =
    typeof record.creditByTerm === "object" && record.creditByTerm !== null
      ? (record.creditByTerm as Record<string, string>)
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
    glosses,
    creditByTerm
  };
}
