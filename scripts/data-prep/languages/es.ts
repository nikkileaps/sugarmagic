/**
 * scripts/data-prep/languages/es.ts
 *
 * Purpose: Spanish-specific data-prep rules -- derived tenses, attached
 *   pronouns, function words, and the placement bank.
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
 * Articles, clitic object and reflexive pronouns, and possessive determiners.
 *
 * LEMMA IDS. `os` and `les` used to be here and were dead: the check runs after
 * a token resolves, and those two are surfaces that resolve to `o` and `l`, so
 * nothing ever matched them. Removing them changed no output. `o` and `l` are
 * deliberately NOT put in their place -- `o` is the conjunction "or", which
 * carries meaning, and adding it would newly strip a real word.
 *
 * Prepositions are NOT here -- they carry meaning the learner has to acquire.
 */
const FUNCTION_WORDS = new Set([
  "el",
  "la",
  "los",
  "un",
  "una",
  "me",
  "te",
  "se",
  "nos",
  "lo",
  "le",
  "mi",
  "tu",
  "su"
]);

/**
 * Every distinct surface an entry claims, whatever its part of speech.
 *
 * Mirrors `allForms` in runtime/classifier/word-forms.ts. The two are separate
 * because this script does not import from the plugin package; if the stored
 * shape changes, change both.
 */
/**
 * Verbs whose present subjunctive is not built off the `yo` stem, given in
 * full. Every other verb in the language is regular here, including the ones
 * that look irregular: `oigo` -> `oiga`, `digo` -> `diga`, `tengo` -> `tenga`.
 */
const SPANISH_IRREGULAR_SUBJUNCTIVE: Record<string, string[]> = {
  ser: ["sea", "seas", "sea", "seamos", "seáis", "sean"],
  ir: ["vaya", "vayas", "vaya", "vayamos", "vayáis", "vayan"],
  estar: ["esté", "estés", "esté", "estemos", "estéis", "estén"],
  dar: ["dé", "des", "dé", "demos", "deis", "den"],
  saber: ["sepa", "sepas", "sepa", "sepamos", "sepáis", "sepan"],
  haber: ["haya", "hayas", "haya", "hayamos", "hayáis", "hayan"]
};

/**
 * The twelve verbs whose future and conditional are not built on the plain
 * infinitive. Every other verb in the language is, which is why these are a
 * list and not a rule.
 */
const SPANISH_IRREGULAR_FUTURE_STEM: Record<string, string> = {
  decir: "dir",
  hacer: "har",
  poder: "podr",
  poner: "pondr",
  querer: "querr",
  saber: "sabr",
  salir: "saldr",
  tener: "tendr",
  valer: "valdr",
  venir: "vendr",
  caber: "cabr",
  haber: "habr"
};

/**
 * Spanish keeps a consonant's SOUND across a vowel change, and respells it to
 * do so. Adding an -e ending to an -ar stem forces this: `buscar` gives
 * `busque`, not `busce`; `llegar` gives `llegue`; `empezar` gives `empiece`.
 *
 * Without this the derivation wrote non-words for every -car, -gar and -zar
 * verb -- a large class -- AND left their real forms missing, including the
 * polite imperative (`busque`, `pague`), which is ordinary language.
 *
 * -er and -ir verbs need no equivalent: their subjunctive takes an -a ending
 * and the `yo` stem already carries the respelling (`cojo` -> `coja`).
 */
function respellBeforeE(stem: string): string {
  if (stem.endsWith("gu")) return `${stem.slice(0, -2)}gü`;
  if (stem.endsWith("c")) return `${stem.slice(0, -1)}qu`;
  if (stem.endsWith("g")) return `${stem}u`;
  if (stem.endsWith("z")) return `${stem.slice(0, -1)}c`;
  return stem;
}

/** Puts a written accent on a stem's final vowel: `tuvie` -> `tuvié`. */
function accentFinalVowel(stem: string): string {
  const map: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
  for (let index = stem.length - 1; index >= 0; index -= 1) {
    const accented = map[stem[index]!];
    if (accented) return stem.slice(0, index) + accented + stem.slice(index + 1);
  }
  return stem;
}

const SUBJUNCTIVE_AR = ["e", "es", "e", "emos", "éis", "en"];
const SUBJUNCTIVE_ER_IR = ["a", "as", "a", "amos", "áis", "an"];
const CONDITIONAL = ["ía", "ías", "ía", "íamos", "íais", "ían"];
const FUTURE = ["é", "ás", "á", "emos", "éis", "án"];
const IMPERFECT_SUBJUNCTIVE = ["ra", "ras", "ra", "ramos", "rais", "ran"];

/**
 * Tenses the dictionary does not store but the language needs.
 *
 * The stored forms are present, preterite and imperfect. That leaves out
 * three things a beginner meets constantly:
 *
 *   PRESENT SUBJUNCTIVE, which is also the `usted` imperative -- `disculpe`,
 *   `perdone`, `oiga`. A1 politeness is largely polite imperatives, and none of
 *   them resolved before this.
 *
 *   CONDITIONAL, which is how wanting is said politely -- `querría`, `podría`,
 *   `gustaría`.
 *
 *   FUTURE, one word rather than `ir a` + infinitive.
 *
 * All three are derived rather than authored because they ARE derivable:
 * subjunctive from the `yo` stem, future and conditional from the infinitive.
 * Asking an author to write `disculpe` beside `disculpo` would be asking them
 * to restate a rule the language already follows.
 */
function spanishDerivedTenses(entry: AtlasLemmaEntry): string[] {
  const f = entry.forms;
  if (!f || !("pres" in f)) return [];
  const out: string[] = [];

  const irregular = SPANISH_IRREGULAR_SUBJUNCTIVE[entry.lemmaId];
  if (irregular) {
    out.push(...irregular);
  } else {
    const yo = f.pres[0];
    if (typeof yo === "string" && yo.endsWith("o")) {
      const stem = yo.slice(0, -1);
      const isAr = entry.lemmaId.endsWith("ar");
      const endings = isAr ? SUBJUNCTIVE_AR : SUBJUNCTIVE_ER_IR;
      const spelled = isAr ? respellBeforeE(stem) : stem;
      out.push(...endings.map((ending) => `${spelled}${ending}`));
    }
  }

  // Imperfect subjunctive, off the third-person plural preterite:
  // `quisieron` -> `quisiera`. It is how wanting is said politely, so a
  // beginner meets `quisiera` long before the tense is taught.
  const theyDid = f.pret[5];
  if (typeof theyDid === "string" && theyDid.endsWith("ron")) {
    const stem = theyDid.slice(0, -3);
    // The first-person plural is the one form that shifts the written accent:
    // `tuvieron` -> `tuviéramos`, not `tuvieramos`.
    out.push(
      ...IMPERFECT_SUBJUNCTIVE.map((ending) =>
        ending === "ramos"
          ? `${accentFinalVowel(stem)}${ending}`
          : `${stem}${ending}`
      )
    );
  }

  const futureStem =
    SPANISH_IRREGULAR_FUTURE_STEM[entry.lemmaId] ??
    (/(ar|er|ir)$/.test(entry.lemmaId) ? entry.lemmaId : null);
  if (futureStem) {
    out.push(...CONDITIONAL.map((ending) => `${futureStem}${ending}`));
    out.push(...FUTURE.map((ending) => `${futureStem}${ending}`));
  }

  return out;
}

/**
 * EVERY SURFACE THE DICTIONARY HOLDS, POINTED AT ITS LEMMA. No rules.
 *
 * This function used to GUESS -- `-ar` verbs got `-ando`/`-ado`, nouns got
 * `+s`/`+es`, and anything ending in `-o` got a `-a` "feminine". Guessing does
 * not know meaning, so it produced words that do not exist (`pedir` ->
 * "pediendo", real: `pidiendo`) and, worse, words that exist and mean something
 * else: `caso` -> `casa`, `puerto` -> `puerta`, `libro` -> `libra`. Those are
 * not inflections, they are different words, and the index claimed otherwise.
 *
 * The forms now live in the dictionary, where a person or a model can read them
 * next to the gloss and correct them. This file only inverts them.
 */
function addSpanishMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  for (const surface of authoredSurfacesOf(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }
}

/**
 * Object and reflexive pronouns that attach to the end of a verb.
 *
 * Only the single-clitic case, and only on the INFINITIVE. Spanish also
 * attaches these to affirmative imperatives and gerunds, but both shift the
 * written accent (`cuenta` + `me` is `cuéntame`), which needs syllabification
 * to get right. The infinitive never shifts, so this half is exact; the other
 * half is absent and every authoring pass so far has reported it.
 */
const SPANISH_ENCLITICS = [
  "me", "te", "se", "lo", "la", "le", "nos", "los", "las", "les"
];

/**
 * The eight affirmative `tú` imperatives that are not simply the third-person
 * singular present. The regular ones already resolve through that form.
 */
const SPANISH_IRREGULAR_TU_IMPERATIVE: Record<string, string> = {
  decir: "di",
  hacer: "haz",
  ir: "ve",
  poner: "pon",
  salir: "sal",
  ser: "sé",
  tener: "ten",
  venir: "ven"
};

/**
 * Forms the dictionary does not store but authored phrases keep reaching for.
 *
 * Every A2 authoring pass independently reported the same four shapes missing,
 * which is why they are derived rather than filed one at a time:
 *
 *   INFINITIVE + CLITIC -- `ayudarme`, `verte`, `explicarlo`. The single
 *   biggest blocker reported; polite requests and instructions are built on it.
 *
 *   PARTICIPLE AGREEMENT -- `pasada`, `ocupada`, `preocupada`. The masculine
 *   resolved and the feminine did not, so half of every such phrase failed.
 *
 *   -MENTE ADVERBS -- `finalmente`, `totalmente`. Formed off the feminine
 *   adjective, so they are derivable wherever the adjective has one.
 *
 *   IRREGULAR TU IMPERATIVES -- `ten`, `pon`. The regular ones already resolve
 *   as third-person present; these eight do not.
 */
function addSpanishExtraForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  const f = entry.forms;
  const { lemmaId, partsOfSpeech } = entry;

  if (partsOfSpeech.includes("verb") && /(ar|er|ir)$/.test(lemmaId)) {
    for (const clitic of SPANISH_ENCLITICS) {
      addMorphologyEntry(forms, `${lemmaId}${clitic}`, lemmaId, partsOfSpeech);
    }
    const irregular = SPANISH_IRREGULAR_TU_IMPERATIVE[lemmaId];
    if (irregular) {
      addMorphologyEntry(forms, irregular, lemmaId, partsOfSpeech);
    }
  }

  if (f && "pres" in f && typeof f.part === "string" && f.part.endsWith("o")) {
    const stem = f.part.slice(0, -1);
    for (const ending of ["a", "os", "as"]) {
      addMorphologyEntry(forms, `${stem}${ending}`, lemmaId, partsOfSpeech);
    }
  }

  // -mente attaches to the FEMININE adjective where one exists. Adjectives
  // ending in -l, -e or -z do not inflect for gender, so the dictionary stores
  // `fs: null` and the base form is what takes the suffix: `final` ->
  // `finalmente`, but `rápida` -> `rápidamente`.
  if (partsOfSpeech.includes("adjective") && f && "fs" in f) {
    const base = typeof f.fs === "string" ? f.fs : f.ms;
    if (typeof base === "string") {
      addMorphologyEntry(forms, `${base}mente`, lemmaId, partsOfSpeech);
    }
  }
}

function addSpanishDerivedForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  for (const surface of spanishDerivedTenses(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }
  addSpanishExtraForms(forms, entry);
}

function buildSpanishQuestionnaire(): PlacementQuestionnaire {
  return {
    schemaVersion: 1,
    lang: "es",
    targetLanguage: "es",
    supportLanguage: "en",
    formTitle: "Arrival Form",
    formIntro:
      "Answer what you can in Spanish. Leave blanks for anything you do not understand yet.",
    minAnswersForValid: 6,
    questions: [
      {
        kind: "multiple-choice",
        questionId: "es-q1",
        targetBand: "A1",
        promptText: "¿Cómo te llamas?",
        supportText: "Choose the answer that introduces your name.",
        options: [
          { optionId: "a", text: "Me llamo Ana.", isCorrect: true },
          { optionId: "b", text: "Tengo una maleta.", isCorrect: false },
          { optionId: "c", text: "Trabajo aquí.", isCorrect: false }
        ]
      },
      {
        kind: "fill-in-blank",
        questionId: "es-q2",
        targetBand: "A1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Yo ___ de Canada.",
        acceptableAnswers: ["soy"],
        acceptableLemmas: ["ser"]
      },
      {
        kind: "yes-no",
        questionId: "es-q3",
        targetBand: "A1",
        promptText: "¿Hablas un poco de español?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "free-text",
        questionId: "es-q4",
        targetBand: "A2",
        promptText: "Escribe una frase sobre tu trabajo.",
        expectedLemmas: ["trabajar"],
        acceptableForms: ["trabajo", "trabajar", "trabajando"],
        minExpectedLength: 10
      },
      {
        kind: "multiple-choice",
        questionId: "es-q5",
        targetBand: "A2",
        promptText: "¿Cuanto tiempo vas a quedarte?",
        options: [
          { optionId: "a", text: "Dos semanas.", isCorrect: true },
          { optionId: "b", text: "La estacion es grande.", isCorrect: false },
          { optionId: "c", text: "Me gusta el queso.", isCorrect: false }
        ]
      },
      {
        kind: "yes-no",
        questionId: "es-q6",
        targetBand: "A2",
        promptText: "¿Viajas solo hoy?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "fill-in-blank",
        questionId: "es-q7",
        targetBand: "B1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Necesito mi ___ para el tren.",
        acceptableAnswers: ["boleto", "billete"],
        acceptableLemmas: ["boleto", "billete"]
      },
      {
        kind: "free-text",
        questionId: "es-q8",
        targetBand: "B1",
        promptText: "Explica por que vienes a esta ciudad.",
        expectedLemmas: ["venir", "ciudad"],
        minExpectedLength: 18
      },
      {
        kind: "multiple-choice",
        questionId: "es-q9",
        targetBand: "B2",
        promptText: "¿Que documento presentas en la aduana?",
        options: [
          { optionId: "a", text: "Mi pasaporte.", isCorrect: true },
          { optionId: "b", text: "Mi queso favorito.", isCorrect: false },
          { optionId: "c", text: "Mi calendario.", isCorrect: false }
        ]
      },
      {
        kind: "free-text",
        questionId: "es-q10",
        targetBand: "B2",
        promptText:
          "Describe un problema de viaje que resolviste recientemente.",
        expectedLemmas: ["resolver", "viajar"],
        minExpectedLength: 24
      }
    ]
  };
}
export const spanishRules: LanguageRules = {
  lang: "es",
  functionWords: FUNCTION_WORDS,
  // No expandWrittenForm: Spanish neither elides with an apostrophe nor
  // shortens before a vowel. `del` and `al` are single words the dictionary
  // already holds.
  addMorphologyForms: addSpanishMorphologyForms,
  addDerivedForms: addSpanishDerivedForms,
  buildPlacementQuestionnaire: buildSpanishQuestionnaire
};
