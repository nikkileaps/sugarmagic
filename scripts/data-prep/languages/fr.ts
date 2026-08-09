/**
 * scripts/data-prep/languages/fr.ts
 *
 * Purpose: French-specific data-prep rules -- elision, hyphenated inversion,
 *   contracted prepositions, derived tenses, function words, placement bank.
 *
 * WHY FRENCH IS HERE AT ALL
 *   This is a dry run, not a language. There is one lesson of exponents and a
 *   dictionary seeded by hand to cover it, and nothing registers `fr` for play.
 *   Its job is to answer a question that two languages could not: is every
 *   language's own rule really in that language's own file, or did the shared
 *   pipeline only get cleaned up as far as Italian happened to push it?
 *
 *   The check is the file list. Adding French should create French files and
 *   add one line to the registry. Anything else it forced is a rule that was
 *   still living in shared code.
 *
 * WHAT FRENCH DISAGREES WITH BOTH SHIPPED LANGUAGES ABOUT
 *   It writes its subject pronoun (`je parle`, never `parle`), where Spanish
 *   and Italian leave it out. It glues a pronoun on with a HYPHEN rather than
 *   running it into the word (`allez-vous`, not Italian `dirmi`). Its function
 *   words include the subject pronouns for that reason, where neither other
 *   list has them.
 *
 * Relationships:
 *   - Implements LanguageRules; registered in ./registry.
 *   - Uses the shared primitives in ../sugarlang-language-data.
 *
 * Status: active
 */

import type { LanguageRules } from "./language-rules";
import {
  addMorphologyEntry,
  authoredSurfacesOf,
  type AtlasLemmaEntry,
  type MorphologyEntry,
  type PlacementQuestionnaire
} from "../sugarlang-language-data";

/**
 * Articles, clitic pronouns, possessive determiners -- AND subject pronouns.
 *
 * LEMMA IDS, matching the other two lists: the check runs after a token
 * resolves.
 *
 * THE SUBJECT PRONOUNS ARE THE DIFFERENCE, and they are here for a reason
 * neither other language raises. Spanish and Italian leave the subject out of
 * an ordinary sentence, so `yo` and `io` appearing at all is a choice that
 * means something. French cannot leave it out: `je` is as obligatory and as
 * empty as the article, and counting it as a word the phrase teaches would
 * make `je m'appelle` a card about `je`.
 *
 * Prepositions are NOT here, same as the other two. `de` and `à` are the
 * frequent ones and they carry meaning a learner has to acquire.
 *
 * `en` is deliberately absent even though it is a clitic pronoun in `je vous
 * en prie`, because it is also the preposition in `en France`. This is the
 * Italian `su` case exactly: one spelling, two jobs, and the list can only
 * answer for the lemma. Leaving it out costs an occasional uncounted clitic;
 * putting it in would silently strip a real preposition.
 */
const FUNCTION_WORDS = new Set([
  "je",
  "tu",
  "il",
  "elle",
  "nous",
  "vous",
  "ils",
  "elles",
  "le",
  "la",
  "les",
  "un",
  "une",
  "me",
  "te",
  "se",
  "lui",
  "leur",
  "mon",
  "ton",
  "son",
  "notre",
  "votre",
  "ne"
]);

/**
 * What an apostrophe stub stands for.
 *
 * French elides in front of a vowel and always writes the apostrophe, so
 * unlike Italian there is no unmarked case to handle -- French has no
 * counterpart to `qual e`. The stubs are a closed set: it is a short list of
 * grammatical words, not a rule that applies to any word.
 */
const ELIDED_STUBS: Record<string, string> = {
  c: "ce",
  d: "de",
  j: "je",
  l: "le",
  m: "me",
  n: "ne",
  qu: "que",
  s: "si",
  t: "te"
};

/**
 * `à` and `de` fused with the article: `au` is `à le`, `des` is `de les`.
 *
 * Handled as extra SURFACES of the preposition rather than through the
 * expansion hook, because the article they swallow is a function word and
 * would be dropped again immediately. Italian does the same for `dal` and
 * `nel`; the words differ, the shape does not.
 *
 * `du` and `des` are also the partitive article. Pointing them at `de` is the
 * right call for a seed dictionary either way -- the alternative is a lemma
 * for each, and neither would be a word the learner has to acquire.
 */
const CONTRACTED_PREPOSITIONS: Record<string, string[]> = {
  à: ["au", "aux"],
  de: ["du", "des"]
};

/**
 * Splits a written token into the words it stands for.
 *
 * FRENCH NEEDS TWO SHAPES AND THE HOOK TAKES BOTH, which is the thing worth
 * knowing here. Italian only ever needed the apostrophe (plus its unmarked
 * cousin), so the hook could have been written as an apostrophe rule and
 * nothing would have complained. French would then have arrived with
 * `allez-vous` and had nowhere to put it.
 *
 *   HYPHEN, from inversion and from an imperative with its pronoun:
 *   `allez-vous` is `allez` + `vous`, `excusez-moi` is `excusez` + `moi`.
 *   Without this the token loses its hyphen to the tokenizer's punctuation
 *   strip and arrives as `allezvous`, which no dictionary will ever hold.
 *
 *   APOSTROPHE, from elision: `j'habite` is `je` + `habite`.
 *
 * Hyphen first, then each piece through the apostrophe rule, because French
 * writes both at once: `qu'est-ce`.
 */
function expandFrenchWrittenForm(token: string): string[] | null {
  const lower = token.toLowerCase();
  const marker = lower.includes("'") ? "'" : lower.includes("’") ? "’" : null;
  if (marker === null && !lower.includes("-")) {
    return null;
  }

  const out: string[] = [];
  for (const piece of lower.split("-")) {
    if (!piece) continue;
    const at = marker === null ? -1 : piece.indexOf(marker);
    if (at < 0) {
      out.push(piece);
      continue;
    }
    const base = ELIDED_STUBS[piece.slice(0, at)];
    const rest = piece.slice(at + 1);
    if (!base || !rest) return null;
    out.push(base, rest);
  }

  return out.length > 0 ? out : null;
}

/**
 * AUTHORED FORMS ONLY, WITH NO GUESSING FALLBACK -- and that is a deliberate
 * difference from Italian rather than an omission.
 *
 * Italian keeps a guessing rule because its dictionary is a six-thousand-lemma
 * corpus import that is being authored down over time, and a wrong guess for a
 * word nobody has reached yet is better than no entry. The French dictionary
 * here is ninety lemmas written by hand to cover one lesson. Every word in it
 * was written on purpose, so a word with no forms has none because it needs
 * none, and inventing some would only add non-words.
 *
 * If French were ever seeded from a corpus this is the first thing that would
 * have to change.
 */
function addFrenchMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  for (const surface of authoredSurfacesOf(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }

  for (const fused of CONTRACTED_PREPOSITIONS[entry.lemmaId] ?? []) {
    addMorphologyEntry(forms, fused, entry.lemmaId, entry.partsOfSpeech);
  }
}

/**
 * The verbs whose future and conditional are not built on the infinitive.
 * Everything else in the language is, including most of what looks irregular.
 */
const FRENCH_IRREGULAR_FUTURE_STEM: Record<string, string> = {
  être: "ser",
  avoir: "aur",
  aller: "ir",
  faire: "fer",
  venir: "viendr",
  tenir: "tiendr",
  voir: "verr",
  pouvoir: "pourr",
  vouloir: "voudr",
  devoir: "devr",
  savoir: "saur",
  recevoir: "recevr",
  courir: "courr",
  mourir: "mourr",
  envoyer: "enverr",
  falloir: "faudr"
};

/**
 * Verbs whose present subjunctive is not built off the third-person plural,
 * given in full. Every other verb in the language is, including the ones with
 * a stem change: `viennent` -> `vienne`, `peuvent` -> ... which is why
 * `pouvoir` is in this list and `venir` is not.
 */
const FRENCH_IRREGULAR_SUBJUNCTIVE: Record<string, string[]> = {
  être: ["sois", "sois", "soit", "soyons", "soyez", "soient"],
  avoir: ["aie", "aies", "ait", "ayons", "ayez", "aient"],
  aller: ["aille", "ailles", "aille", "allions", "alliez", "aillent"],
  faire: ["fasse", "fasses", "fasse", "fassions", "fassiez", "fassent"],
  pouvoir: ["puisse", "puisses", "puisse", "puissions", "puissiez", "puissent"],
  savoir: ["sache", "saches", "sache", "sachions", "sachiez", "sachent"],
  vouloir: [
    "veuille",
    "veuilles",
    "veuille",
    "voulions",
    "vouliez",
    "veuillent"
  ]
};

const SUBJUNCTIVE = ["e", "es", "e", "ions", "iez", "ent"];
const CONDITIONAL = ["ais", "ais", "ait", "ions", "iez", "aient"];
const FUTURE = ["ai", "as", "a", "ons", "ez", "ont"];

/**
 * `parler` -> `parler`, `finir` -> `finir`, `prendre` -> `prendr`.
 *
 * The endings are added to the infinitive itself, so only the `-re` class
 * needs anything done to it: French does not say `prendreai`.
 */
function frenchFutureStem(lemmaId: string): string | null {
  const irregular = FRENCH_IRREGULAR_FUTURE_STEM[lemmaId];
  if (irregular) return irregular;
  if (lemmaId.endsWith("re")) return lemmaId.slice(0, -1);
  if (lemmaId.endsWith("er") || lemmaId.endsWith("ir")) return lemmaId;
  return null;
}

/**
 * Tenses the dictionary does not store but the language needs.
 *
 * The stored shape is present, simple past, imperfect, plus the two
 * participles -- the same five slots Spanish and Italian use, which is the
 * first thing this dry run checked and the reason the shape stayed shared.
 * French fills all five: `parle`, `parla`, `parlait`, `parlant`, `parlé`.
 *
 * That leaves out the subjunctive, the conditional and the future. All three
 * are derived rather than authored for the same reason as in the other two
 * languages: they ARE derivable, and asking an author to write `parlerait`
 * beside `parlerais` is asking them to restate a rule.
 */
function frenchDerivedTenses(entry: AtlasLemmaEntry): string[] {
  const f = entry.forms;
  if (!f || !("pres" in f)) return [];
  const out: string[] = [];

  const irregular = FRENCH_IRREGULAR_SUBJUNCTIVE[entry.lemmaId];
  if (irregular) {
    out.push(...irregular);
  } else {
    // Off the third-person plural, which is where the stem change lives:
    // `viennent` gives `vienne`, and building off the infinitive would have
    // given `venne`.
    const they = f.pres[5];
    if (typeof they === "string" && they.endsWith("ent")) {
      const stem = they.slice(0, -3);
      // The `nous` and `vous` forms take the imperfect stem instead, which is
      // how `allions` sits beside `aille` -- so those two come from `imp`
      // where it exists rather than from the same stem as the rest.
      const we = f.imp[3];
      const youAll = f.imp[4];
      SUBJUNCTIVE.forEach((ending, index) => {
        if (index === 3 && typeof we === "string") return out.push(we);
        if (index === 4 && typeof youAll === "string") return out.push(youAll);
        out.push(`${stem}${ending}`);
      });
    }
  }

  const stem = frenchFutureStem(entry.lemmaId);
  if (stem) {
    out.push(...FUTURE.map((ending) => `${stem}${ending}`));
    out.push(...CONDITIONAL.map((ending) => `${stem}${ending}`));
  }

  return out;
}

function addFrenchDerivedForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  if (!entry.partsOfSpeech.includes("verb")) return;
  for (const surface of frenchDerivedTenses(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }
}

/**
 * The placement bank.
 *
 * Written from the same seed vocabulary as the exponents, so every word in it
 * is one the French dictionary here actually holds -- which is what
 * placement-questionnaire.test.ts checks, now for a third language.
 */
function buildFrenchQuestionnaire(): PlacementQuestionnaire {
  return {
    schemaVersion: 1,
    lang: "fr",
    targetLanguage: "French",
    supportLanguage: "en",
    formTitle: "Arrival Form",
    formIntro:
      "A few questions before you go through. Answer what you can and skip the rest.",
    minAnswersForValid: 6,
    questions: [
      {
        kind: "multiple-choice",
        questionId: "fr-q1",
        targetBand: "A1",
        promptText: "Comment vous appelez-vous ?",
        options: [
          { optionId: "a", text: "Je m'appelle Luc.", isCorrect: true },
          { optionId: "b", text: "J'ai une valise.", isCorrect: false },
          { optionId: "c", text: "Je travaille ici.", isCorrect: false }
        ]
      },
      {
        kind: "fill-in-blank",
        questionId: "fr-q2",
        targetBand: "A1",
        promptText: "Complétez la phrase.",
        sentenceTemplate: "Je ___ du Canada.",
        acceptableAnswers: ["viens"],
        acceptableLemmas: ["venir"]
      },
      {
        kind: "yes-no",
        questionId: "fr-q3",
        targetBand: "A1",
        promptText: "Parlez-vous un peu français ?",
        correctAnswer: "yes",
        yesLabel: "oui",
        noLabel: "non"
      },
      {
        kind: "multiple-choice",
        questionId: "fr-q4",
        targetBand: "A1",
        promptText: "Où habitez-vous ?",
        options: [
          { optionId: "a", text: "J'habite à Lyon.", isCorrect: true },
          { optionId: "b", text: "Merci beaucoup.", isCorrect: false },
          { optionId: "c", text: "Il est tard.", isCorrect: false }
        ]
      },
      {
        kind: "multiple-choice",
        questionId: "fr-q5",
        targetBand: "A2",
        promptText: "Combien de temps restez-vous ?",
        options: [
          { optionId: "a", text: "Trois jours.", isCorrect: true },
          { optionId: "b", text: "La gare est grande.", isCorrect: false },
          { optionId: "c", text: "Bonne nuit.", isCorrect: false }
        ]
      },
      {
        kind: "yes-no",
        questionId: "fr-q6",
        targetBand: "A2",
        promptText: "Voyagez-vous seul aujourd'hui ?",
        correctAnswer: "yes",
        yesLabel: "oui",
        noLabel: "non"
      },
      {
        kind: "fill-in-blank",
        questionId: "fr-q7",
        targetBand: "B1",
        promptText: "Complétez la phrase.",
        sentenceTemplate: "J'ai besoin de mon ___ pour le train.",
        acceptableAnswers: ["billet"],
        acceptableLemmas: ["billet"]
      },
      {
        kind: "free-text",
        questionId: "fr-q8",
        targetBand: "B1",
        promptText: "Expliquez pourquoi vous venez dans cette ville.",
        expectedLemmas: ["venir", "ville"],
        minExpectedLength: 18
      },
      {
        kind: "multiple-choice",
        questionId: "fr-q9",
        targetBand: "B2",
        promptText: "Quel document présentez-vous à la douane ?",
        options: [
          { optionId: "a", text: "Mon passeport.", isCorrect: true },
          { optionId: "b", text: "Je suis désolé.", isCorrect: false },
          { optionId: "c", text: "À bientôt.", isCorrect: false }
        ]
      },
      {
        kind: "free-text",
        questionId: "fr-q10",
        targetBand: "B2",
        promptText: "Décrivez un problème de voyage que vous avez résolu.",
        expectedLemmas: ["résoudre", "voyage"],
        minExpectedLength: 24
      }
    ]
  };
}

export const frenchRules: LanguageRules = {
  lang: "fr",
  functionWords: FUNCTION_WORDS,
  expandWrittenForm: expandFrenchWrittenForm,
  addMorphologyForms: addFrenchMorphologyForms,
  addDerivedForms: addFrenchDerivedForms,
  buildPlacementQuestionnaire: buildFrenchQuestionnaire
};
