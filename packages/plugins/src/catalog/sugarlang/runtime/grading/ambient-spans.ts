/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/ambient-spans.ts
 *
 * Purpose: AMBIENT -- target-language spans in a rendered line that the slate
 *   never asked for. The residue left when you subtract what the Teacher chose
 *   from what the text actually contains.
 *
 * WHY IT EXISTS
 *   Before this, the only target-language the system knew about in a finished
 *   line was what it had asked for: `dialogueHighlight` is built purely from
 *   `constraint.targetVocab`. Everything else the generator wrote in Spanish was
 *   invisible -- unmarkable, unmeasurable, and unaskable by the player, who
 *   could see a word plainly and had no way to ask what it meant.
 *
 * AMBIENT IS DATA, NOT DECORATION
 *   Nothing here is styled. Presentation renders `focus` (gold) and `recall`
 *   (blue) exactly as before; ambient reaches the UI only so a SELECTED span can
 *   be resolved to a gloss.
 *
 *   The rejected alternative was a third colour. It fails on its own terms: at
 *   A1 (25% target language) ambient is a few words, but at B2+ (85%) it is
 *   nearly the whole line -- so marking it marks everything, which means
 *   nothing, and drowns out the two colours that do carry meaning.
 *
 * IT IS ALSO A DRIFT DETECTOR
 *   `focus + recall + ambient` IS the target-language content of the line. That
 *   makes the realized ratio measurable against `TARGET_LANGUAGE_RATIO_BY_POSTURE`
 *   for the first time -- today that table only ever instructs the generator and
 *   never checks it. Not consumed yet; see the plan's 090.12 note.
 *
 * NO SECOND DETECTOR
 *   Reuses `tokenize` (which already returns positions) and `lemmatize` (which
 *   already handles inflection) from the classifier. A word is target-language
 *   if it lemmatizes to something the atlas knows. That is the same test
 *   coverage uses; this only adds "and where was it".
 *
 * Exports:
 *   - AmbientSpan, findAmbientSpans
 *
 * Relationships:
 *   - Pure. Reads text + an atlas + morphology; no I/O, no store, no clock.
 *
 * Implements: Plan 090 story 090.12
 *
 * Status: active
 */

import { tokenize } from "../classifier/tokenize";
import { lemmatize } from "../classifier/lemmatize";
import type { MorphologyLoader } from "../classifier/morphology-loader";
import type { LexicalAtlasProvider } from "../contracts/providers";

/** One target-language span the slate did not account for. */
export interface AmbientSpan {
  /** Character offsets into the rendered line, for selection resolution. */
  start: number;
  end: number;
  /** The surface as it appears in the text (inflected, original case). */
  surface: string;
  /** Atlas lemma the surface resolved to. */
  lemmaId: string;
}

export interface FindAmbientSpansArgs {
  text: string;
  targetLanguage: string;
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  /**
   * Surfaces the slate already accounts for -- `focusTerms` from the highlight.
   * Matched case-insensitively against both the surface and its lemma, because
   * the highlight carries citation forms while the text carries inflections.
   */
  slateTerms: string[];
  /**
   * Authored proper nouns from the scene's vocabulary model. `Finnick` and
   * `Wordlark` lemmatize to nothing useful and must never offer a translation --
   * a name is not a word the player failed to learn.
   */
  properNouns?: string[];
}

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase();
}

/**
 * Target-language spans the slate did not ask for, in text order.
 *
 * Returns [] rather than throwing on any missing input: this feeds a
 * presentation affordance, and a line with no ambient spans is
 * indistinguishable from one where detection could not run. Neither should
 * break the turn.
 */
export function findAmbientSpans(args: FindAmbientSpansArgs): AmbientSpan[] {
  const { text, targetLanguage, atlas, morphology } = args;
  if (!text) {
    return [];
  }

  const slate = new Set(args.slateTerms.map(normalize));
  const properNouns = new Set((args.properNouns ?? []).map(normalize));

  const spans: AmbientSpan[] = [];
  for (const token of tokenize(text, targetLanguage)) {
    if (token.kind !== "word") {
      continue;
    }
    const surface = normalize(token.surface);
    if (properNouns.has(surface)) {
      continue;
    }

    const lemmaRef = lemmatize(token, targetLanguage, morphology);
    if (!lemmaRef) {
      continue;
    }
    // The atlas is what makes it TARGET language rather than merely a word the
    // morphology happened to fold. A support-language token that survives
    // lemmatization still fails here, which is the intended filter.
    if (!atlas.getLemma(lemmaRef.lemmaId, targetLanguage)) {
      continue;
    }
    // Already accounted for by the Teacher's decision -- focus or recall, not
    // ambient. Checked on BOTH forms: the slate speaks citation forms while the
    // text speaks inflections, so `hablas` must match a slate carrying `hablar`.
    if (slate.has(surface) || slate.has(normalize(lemmaRef.lemmaId))) {
      continue;
    }

    spans.push({
      start: token.start,
      end: token.end,
      surface: token.surface,
      lemmaId: lemmaRef.lemmaId
    });
  }

  return spans;
}
