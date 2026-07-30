/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/graded-text-marker.ts
 *
 * Purpose: Places target-language forms into a piece of text FOR A POOL IT IS
 *   HANDED, and reports what it placed so the presentation layer can mark them.
 *
 * RENAMED FROM `diglotWeave` (Plan 090.8a). "Weave" described a technique and
 * described it vaguely; the job is marking graded text. The rename came with a
 * demotion, which is the part that matters:
 *
 * IT IS A RENDERER, NOT A DECIDER. It makes no judgment about what should be
 * taught. It tokenizes, resolves through the atlas, substitutes what it is
 * given, and reports the result. Two decisions used to leak into it and both
 * are gone:
 *
 *   1. THE POOL -- unowned, so every call site improvised. One handed it the
 *      slate; another handed it EVERY lemma at or below the learner's band, i.e.
 *      the whole dictionary, which is why item text produced semantically wrong
 *      swaps (`left` -> izquierda, the direction rather than past-of-leave). The
 *      pool is now strictly an argument, and choosing it is the caller's job.
 *   2. THE STRATEGY CHOICE -- `isWeaveBand` let the renderer decide whether to
 *      run at all, duplicating `postureForBand`. Deleted; callers pass posture.
 *
 * WHAT REMAINS IS A PURE FUNCTION THAT CANNOT DECIDE ANYTHING. That is the
 * correct shape, and it is what makes 090.11 able to delete the substitution
 * path entirely: once realization happens at build, nothing needs to substitute
 * at runtime and only the MARKING half survives.
 *
 * IT IS DEMOTED BUT NOT YET REDUCED, AND THAT IS THE NEXT STEP.
 *
 * THE TARGET CONTRACT: DIRECTIVE IN, MARKED-UP SPANS OUT.
 *   It runs AFTER the Teacher. It reads the Directive -- what the Teacher chose
 *   to teach -- walks the text the Teacher settled on, and assigns each matched
 *   span a SEMANTIC ROLE from a closed set:
 *
 *     focus | recall | challenge | ambient | unmarked
 *
 *   IT DOES NOT BUILD THE HOVER. It does not style, gloss, or decide behavior.
 *   It says "this span is a focus word"; the PRESENTATION layer decides what a
 *   focus word looks like, whether it gets a gloss hover, and how it behaves.
 *   Two vocabularies, and this file speaks only the first.
 *
 * `ambient` DOES NOT COME FROM THE DIRECTIVE -- IT IS THE RESIDUE.
 *   Four of the five roles are read off the Teacher's decision. `ambient` is
 *   what is left when you subtract it: target-language tokens PRESENT in the
 *   text that the slate never accounted for (nikki, 2026-07-30 -- "to catch
 *   Spanish the LLM has added that isn't in the slate").
 *
 *   So the marker cannot work from the Directive alone. It must independently
 *   detect target-language content and subtract what the slate explains. That
 *   makes it a DRIFT DETECTOR as well as a marker: unrequested target language
 *   acquires a name and appears in the output instead of passing silently as
 *   authored text.
 *
 *   Reuse the existing detection -- `computeCoverage` and the classifier facade
 *   already classify target-language content, and `computeLanguageRatioVerdict`
 *   already measures the proportion. Do not build a second one.
 *
 *   Useful consequence: focus + recall + challenge + ambient IS the
 *   target-language content of the text, so the marker's own output is what
 *   measures the realized ratio against `TARGET_LANGUAGE_RATIO_BY_POSTURE`.
 *   That table has only ever verified generated text; this is how it finally
 *   governs.
 *
 * SPANS, NOT WORDS -- PHRASE RESOLUTION HAPPENS HERE.
 *   `buenos dias` is ONE thing: one underline, one hover, one translation. Marked
 *   word-by-word it becomes two glosses for half a greeting, which is wrong in a
 *   way the presentation layer cannot repair -- by the time it has two spans the
 *   information that they were one unit is gone.
 *
 *   So the unit is a SPAN and multi-word wins: a competency exponent beats its
 *   own constituent words. Do NOT hand-roll this. `createChunkMatcher`
 *   (classifier/chunk-matcher.ts) is a trie that already does longest-match
 *   (:128-131). Drive it from `getAllInventoryChunks(lang)` -- NOT from a
 *   scene's chunks, which contain only authored text and never the dynamic
 *   phrases an NPC actually says.
 *
 * THE HARD PART IS THAT THIS IS WHERE LLM OUTPUT BECOMES PROCEDURAL.
 *   The Directive is model output. The role vocabulary above is a closed enum.
 *   This file is the boundary between them, and that boundary is where things
 *   break -- silently, because the failure renders as `unmarked`, which is
 *   indistinguishable from "not taught".
 *
 *   So: the mapping must be TOTAL, and unmappable must be LOUD. Every Directive
 *   element resolves to exactly one role or is reported unmappable. `unmarked`
 *   must never be a fallback -- it is the value meaning "nothing here", and
 *   defaulting to it makes every mapping failure invisible.
 *
 * TWO MISSES, TWO DIFFERENT ANSWERS -- neither of them silence:
 *   - The term is NOT IN THE TEXT. The Directive says teach `queso`; there is no
 *     `queso`. Nothing to mark, and that is a realization mismatch worth
 *     REPORTING: what the Teacher decided and what the text says have drifted.
 *   - The term is there but the presentation layer has no gloss for it. Still
 *     marked, as a span whose gloss is unavailable -- visibly a taught word.
 *     Absent gloss must not read as "not taught".
 *
 * TODAY IT STILL SUBSTITUTES -- takes English, resolves through the atlas, swaps
 * in target forms -- which is rendering. It cannot stop while it is the thing
 * PRODUCING the target-language text at A1/A2.
 *
 *   REVISIT TRIGGER: when 090.11 lands build-time realization for anchored and
 *   supported, the text arrives already realized. Delete `resolveSubstitution`
 *   and the rewrite loop then; keep the term-finding, add the gloss lookup and
 *   the two miss reports. The exit to hold it to: the returned string is
 *   character-identical to the input.
 *
 * Exports:
 *   - MarkedForm, GradedTextMarkResult
 *   - markGradedText
 *
 * Relationships:
 *   - Depends on tokenize for word segmentation.
 *   - Depends on LexicalAtlasProvider.resolveFromGloss for English -> target mapping.
 *   - Depends on InventoryChunk for chunk surface substitution.
 *   - Callers own the pool and the posture; this file owns neither.
 *
 * Implements: Plan 086 story 086.2 + Plan 090 story 090.8a
 *
 * Status: active
 */

import type { LexicalAtlasProvider } from "../types";
import type { InventoryChunk } from "../contracts/competency-inventory";
import { tokenize } from "../classifier/tokenize";

export interface MarkedForm {
  /** Citation form or chunk surface placed in text. */
  targetForm: string;
  /** Target-lang lemma this substitution represents. */
  lemmaId: string;
  /** Original English word for UI gloss. */
  englishGloss: string;
}

export interface GradedTextMarkResult {
  text: string;
  markedForms: MarkedForm[];
}

/**
 * Builds a lowercase set of lemmaIds from the introduce list for O(1) lookup.
 */
function buildIntroduceSet(
  introduce: Array<{ lemmaId: string; lang: string }>
): Set<string> {
  const set = new Set<string>();
  for (const entry of introduce) {
    set.add(entry.lemmaId.normalize("NFC").toLocaleLowerCase());
  }
  return set;
}

/**
 * For a given English word token, returns the substitute target form and lemma
 * if any introduced lemma or chunk constituent resolves from this gloss.
 *
 * Chunk matching takes priority: if an inventory chunk has a constituent lemma
 * that resolves from the English word AND that constituent is in the introduce
 * set, the chunk's primary surface form is substituted.
 */
function resolveSubstitution(
  word: string,
  introduceSet: Set<string>,
  inventoryChunks: InventoryChunk[],
  atlas: LexicalAtlasProvider,
  targetLang: string,
  supportLang: string
): { targetForm: string; lemmaId: string } | null {
  const resolvedEntries = atlas.resolveFromGloss(word, targetLang, supportLang);
  if (resolvedEntries.length === 0) return null;

  const resolvedLemmaIds = resolvedEntries.map((e) =>
    e.lemmaId.normalize("NFC").toLocaleLowerCase()
  );

  // Check chunk substitution first: if any resolved lemma is a constituent of
  // an introduced chunk, substitute the chunk's primary surface form.
  for (const chunk of inventoryChunks) {
    if (!chunk.surfaceForms[0]) continue;
    const constituentMatch = chunk.constituentLemmas.some((cl) =>
      resolvedLemmaIds.includes(cl.normalize("NFC").toLocaleLowerCase())
    );
    if (!constituentMatch) continue;

    // The chunk itself must trace back to the introduce list via a constituent.
    const introConstituentLemmaId = chunk.constituentLemmas.find((cl) =>
      introduceSet.has(cl.normalize("NFC").toLocaleLowerCase())
    );
    if (!introConstituentLemmaId) continue;

    return {
      targetForm: chunk.surfaceForms[0],
      lemmaId: introConstituentLemmaId
    };
  }

  // Single-word substitution: substitute the citation form (lemmaId bare).
  // DEFERRED (086): inflected-form substitution needs a feature-tagged inverse
  // morphology index (lemma + features -> surface form); current data is
  // surface->lemma only. Revisit when citation-form output reads as grammatically
  // wrong to a learner past A2, or when a native reviewer flags weave grammar.
  for (const lemmaId of resolvedLemmaIds) {
    if (introduceSet.has(lemmaId)) {
      // Use the first resolved entry whose normalized lemmaId is in introduce.
      const entry = resolvedEntries.find(
        (e) => e.lemmaId.normalize("NFC").toLocaleLowerCase() === lemmaId
      );
      if (entry) {
        return { targetForm: entry.lemmaId, lemmaId: entry.lemmaId };
      }
    }
  }

  return null;
}

/**
 * True when the token at [start,end) is capitalised in the ORIGINAL text but is
 * not the first word of a sentence.
 *
 * In English a mid-sentence capital nearly always marks a proper noun, place,
 * or a multi-word title ("Station Manager", "Wordlark Hollow"). Those must not
 * be substituted word-by-word: a title is a fixed unit in the target language
 * too ("Jefe de Estacion"), so swapping one constituent produces a hybrid no
 * native speaker would say. Sentence-initial capitals carry no such signal --
 * they are just sentence case -- so they stay eligible.
 */
function isMidSentenceCapitalised(
  authoredText: string,
  start: number,
  end: number
): boolean {
  const original = authoredText.slice(start, end);
  const first = original[0];
  if (!first || first !== first.toLocaleUpperCase() || first === first.toLocaleLowerCase()) {
    return false;
  }
  for (let i = start - 1; i >= 0; i -= 1) {
    const ch = authoredText[i]!;
    if (ch === " " || ch === "\n" || ch === "\t" || ch === '"' || ch === "'") continue;
    // First non-space char before the token: sentence punctuation means this
    // capital is sentence case, anything else means it is mid-sentence.
    return !(ch === "." || ch === "!" || ch === "?" || ch === ":" || ch === ";");
  }
  return false; // reached start of text -> sentence-initial
}

/** Mirrors the original token's leading capital onto the substituted form. */
function matchLeadingCase(original: string, replacement: string): string {
  const first = original[0];
  if (!first || first !== first.toLocaleUpperCase() || first === first.toLocaleLowerCase()) {
    return replacement;
  }
  return replacement.charAt(0).toLocaleUpperCase() + replacement.slice(1);
}

/**
 * Weaves target-language citation forms into authored English text by
 * substituting English words that resolve to prescription-introduced lemmas.
 *
 * Citation forms are placed BARE -- no asterisk wrapping. Glossing is delivered
 * via the dialogueHighlight annotation path in the observe middleware.
 *
 * The introduce list drives which substitutions are attempted. Words not in the
 * introduce list (directly or via chunk constituent) are left as English.
 */
export function markGradedText(
  authoredText: string,
  introduce: Array<{ lemmaId: string; lang: string }>,
  inventoryChunks: InventoryChunk[],
  atlas: LexicalAtlasProvider,
  targetLang: string,
  supportLang: string
): GradedTextMarkResult {
  if (introduce.length === 0) {
    return { text: authoredText, markedForms: [] };
  }

  const introduceSet = buildIntroduceSet(introduce);
  const tokens = tokenize(authoredText, supportLang);
  const markedForms: MarkedForm[] = [];

  // Build a replacement map: character offset -> { targetForm, end }
  // We reconstruct the string in one pass over the original text.
  const replacements = new Map<number, { targetForm: string; end: number; lemmaId: string }>();

  const seenWords = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "word") continue;
    const word = token.surface; // already lowercased by tokenize
    if (seenWords.has(word)) continue;
    seenWords.add(word);

    const sub = resolveSubstitution(
      word,
      introduceSet,
      inventoryChunks,
      atlas,
      targetLang,
      supportLang
    );
    if (!sub) continue;

    // Record a replacement at each occurrence of this word token in the text.
    // We need to re-scan tokens for the same word to handle repeated occurrences.
    // Protection is evaluated PER OCCURRENCE: the same word can be part of a
    // title in one place ("Station Manager") and ordinary in another ("the
    // station is closed"), and only the latter should be woven.
    let substitutedAnyOccurrence = false;
    for (const t of tokens) {
      if (t.kind !== "word" || t.surface !== word) continue;
      if (replacements.has(t.start)) continue;
      if (isMidSentenceCapitalised(authoredText, t.start, t.end)) continue;
      replacements.set(t.start, {
        targetForm: matchLeadingCase(
          authoredText.slice(t.start, t.end),
          sub.targetForm
        ),
        end: t.end,
        lemmaId: sub.lemmaId
      });
      substitutedAnyOccurrence = true;
    }

    // Only report a weaved form when one actually landed, otherwise the gloss
    // UI would offer a hover for a word still shown in English.
    if (substitutedAnyOccurrence) {
      markedForms.push({
        targetForm: sub.targetForm,
        lemmaId: sub.lemmaId,
        englishGloss: word
      });
    }
  }

  if (replacements.size === 0) {
    return { text: authoredText, markedForms: [] };
  }

  // Reconstruct the text by splicing in target forms at the replacement offsets.
  const sortedOffsets = [...replacements.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  let cursor = 0;
  for (const start of sortedOffsets) {
    const replacement = replacements.get(start)!;
    if (start < cursor) continue; // overlap guard (shouldn't occur with single tokens)
    parts.push(authoredText.slice(cursor, start));
    parts.push(replacement.targetForm);
    cursor = replacement.end;
  }
  parts.push(authoredText.slice(cursor));

  return {
    text: parts.join(""),
    markedForms
  };
}
