/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/diglot-weave.ts
 *
 * Purpose: Substitutes target-language citation forms for English words that
 *          resolve to prescription-introduced lemmas or chunk surface forms,
 *          producing a mixed-text (diglot-woven) line for anchored/supported
 *          postures without an LLM call.
 *
 * Exports:
 *   - WeavedForm
 *   - DiglotWeaveResult
 *   - diglotWeave
 *
 * Relationships:
 *   - Depends on tokenize for word segmentation.
 *   - Depends on LexicalAtlasProvider.resolveFromGloss for English -> target mapping.
 *   - Depends on InventoryChunk for chunk surface substitution.
 *   - Consumed by sugar-lang-scripted-middleware for anchored/supported postures.
 *
 * Implements: Plan 086 story 086.2
 *
 * Status: active
 */

import type { LexicalAtlasProvider } from "../types";
import type { InventoryChunk } from "../contracts/function-inventory";
import { tokenize } from "./tokenize";

export interface WeavedForm {
  /** Citation form or chunk surface placed in text. */
  targetForm: string;
  /** Target-lang lemma this substitution represents. */
  lemmaId: string;
  /** Original English word for UI gloss. */
  englishGloss: string;
}

export interface DiglotWeaveResult {
  text: string;
  weavedForms: WeavedForm[];
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
export function diglotWeave(
  authoredText: string,
  introduce: Array<{ lemmaId: string; lang: string }>,
  inventoryChunks: InventoryChunk[],
  atlas: LexicalAtlasProvider,
  targetLang: string,
  supportLang: string
): DiglotWeaveResult {
  if (introduce.length === 0) {
    return { text: authoredText, weavedForms: [] };
  }

  const introduceSet = buildIntroduceSet(introduce);
  const tokens = tokenize(authoredText, supportLang);
  const weavedForms: WeavedForm[] = [];

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
      weavedForms.push({
        targetForm: sub.targetForm,
        lemmaId: sub.lemmaId,
        englishGloss: word
      });
    }
  }

  if (replacements.size === 0) {
    return { text: authoredText, weavedForms: [] };
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
    weavedForms
  };
}
