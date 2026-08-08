/**
 * scripts/data-prep/languages/it.ts
 *
 * Purpose: Italian-specific data-prep rules -- the Kelly corpus import,
 *   morphology forms, function words, and the placement bank.
 *
 * Relationships:
 *   - Implements LanguageRules; registered in ./registry.
 *   - Uses the shared primitives in ../sugarlang-language-data.
 *
 * Status: active
 */

import XLSX from "xlsx";

import type { LanguageRules } from "./language-rules";
import {
  DATA_BUILD_DATE,
  addMorphologyEntry,
  authoredSurfacesOf,
  downloadToCache,
  isCefrBand,
  normalizeLemma,
  pickLowerBand,
  type AtlasLemmaEntry,
  type CEFRBand,
  type FrequencyDataFile,
  type MorphologyEntry,
  type PlacementQuestionnaire
} from "../sugarlang-language-data";

/**
 * Articles, clitic pronouns and the elided forms' bases.
 *
 * Deliberately NOT a translation of the Spanish list. `su` and `tu` are in
 * that one and must not be here: Italian `su` is the preposition "on", and
 * `tu` is the subject pronoun, which the always-target list wants a learner to
 * say out loud rather than treat as filler.
 *
 * Lemma ids, so `i` and `vi` are omitted rather than listed inertly -- neither
 * resolves in the Italian index today, so the check would never reach them.
 */
const FUNCTION_WORDS = new Set([
  "il",
  "lo",
  "la",
  "gli",
  "un",
  "uno",
  "una",
  "mi",
  "ti",
  "si",
  "ci",
  "ne",
  "lui",
  "lei"
]);

/**
 * Italian elides a final vowel before a vowel and writes it with an
 * apostrophe. `dov'e` is `dove` + `e`; `c'e` is `ci` + `e`; `un'amica` is
 * `una` + `amica`.
 *
 * The base is recoverable from the stub because the elided vowel is fixed per
 * word, so this is a lookup rather than a rule -- guessing which vowel was
 * dropped is exactly the kind of thing that produced non-words elsewhere.
 */
const ELIDED_STUBS: Record<string, string> = {
  c: "ci",
  d: "di",
  quant: "quanto",
  // `l'` is `lo` before a masculine word and `la` before a feminine one, and
  // the stub cannot say which. Answering `lo` always is safe HERE because both
  // are function words: whichever it is, it is dropped from the words an
  // exponent teaches, so the two answers are indistinguishable downstream. If
  // this is ever consulted somewhere that keeps function words, that stops
  // being true and the caller needs the gender.
  l: "lo",
  dov: "dove",
  quest: "questo",
  un: "una",
  all: "alla",
  dell: "della",
  nell: "nella",
  sull: "sulla",
  bell: "bello",
  quell: "quello",
  sant: "santo"
};

/**
 * Italian also shortens before a vowel WITHOUT writing an apostrophe, which is
 * the part that is easy to miss: `qual e` is correct and `qual'e` is not.
 *
 * Only stubs that are not words in their own right belong here. `un` and
 * `nessun` are shortened too but already resolve on their own, and mapping
 * them would put a second answer in front of a working one.
 */
const APOCOPE: Record<string, string> = {
  qual: "quale",
  buon: "buono",
  gran: "grande",
  san: "santo",
  bel: "bello",
  quel: "quello"
};

/**
 * Italian fuses a preposition with a following definite article into one
 * word: `di` + `il` is `del`, `in` + `il` is `nel`. Spanish does this twice
 * (`del`, `al`) and stores both as words; Italian does it about forty times,
 * which is a rule rather than forty dictionary entries.
 *
 * They are prepositions once fused, so each points at the preposition it came
 * from. The forms written with an apostrophe -- `dell'`, `all'` -- are handled
 * before this, by the contraction rule, which reduces them to the plain
 * feminine form listed here.
 */
const ARTICULATED_PREPOSITIONS: Record<string, string[]> = {
  di: ["del", "dello", "della", "dei", "degli", "delle"],
  a: ["al", "allo", "alla", "ai", "agli", "alle"],
  da: ["dal", "dallo", "dalla", "dai", "dagli", "dalle"],
  in: ["nel", "nello", "nella", "nei", "negli", "nelle"],
  su: ["sul", "sullo", "sulla", "sui", "sugli", "sulle"],
  con: ["col", "coi"]
};

function expandItalianWrittenForm(token: string): string[] | null {
  const lower = token.toLowerCase();

  const marker = lower.includes("'") ? "'" : lower.includes("’") ? "’" : null;
  if (marker !== null) {
    const [stub, rest] = lower.split(marker);
    if (!stub || !rest) return null;
    const base = ELIDED_STUBS[stub];
    return base ? [base, rest] : null;
  }

  const full = APOCOPE[lower];
  return full ? [full] : null;
}

interface ParsedItalianLemma {
  lemmaId: string;
  partsOfSpeech: Set<string>;
  rank: number;
  cefrBand: CEFRBand | null;
}

const ITALIAN_KELLY_URL = "https://ssharoff.github.io/kelly/it_m3.xls";

function mapItalianPos(pos: string): string[] {
  switch (pos) {
    case "v":
      return ["verb"];
    case "n":
      return ["noun"];
    case "np":
      return ["proper-noun"];
    case "adj":
      return ["adjective"];
    case "adv":
      return ["adverb"];
    case "prep":
      return ["preposition"];
    case "conj":
      return ["conjunction"];
    case "det":
      return ["determiner"];
    case "pron":
      return ["pronoun"];
    case "num":
      return ["numeral"];
    case "int":
      return ["interjection"];
    case "for":
      return ["formula"];
    case "abb":
      return ["abbreviation"];
    default:
      return ["other"];
  }
}

async function loadItalianSourceEntries(): Promise<ParsedItalianLemma[]> {
  const path = await downloadToCache(ITALIAN_KELLY_URL, "it_m3.xls");
  const workbook = XLSX.readFile(path);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
    workbook.Sheets[workbook.SheetNames[0]!],
    { raw: false, defval: "" }
  );

  const grouped = new Map<string, ParsedItalianLemma>();
  let rank = 0;

  for (const row of rows) {
    const points = isCefrBand(row.Points) ? row.Points : null;
    const partsOfSpeech = mapItalianPos(row.Pos ?? "");
    const variants = (row.Lemma ?? "")
      .split(",")
      .map((variant) => normalizeLemma(variant))
      .filter((variant): variant is string => variant !== null);

    for (const variant of variants) {
      rank += 1;
      const existing = grouped.get(variant);
      if (existing) {
        existing.rank = Math.min(existing.rank, rank);
        if (points) {
          existing.cefrBand = existing.cefrBand
            ? pickLowerBand(existing.cefrBand, points)
            : points;
        }
        partsOfSpeech.forEach((partOfSpeech) =>
          existing.partsOfSpeech.add(partOfSpeech)
        );
        continue;
      }

      grouped.set(variant, {
        lemmaId: variant,
        partsOfSpeech: new Set(partsOfSpeech),
        rank,
        cefrBand: points
      });
    }
  }

  return [...grouped.values()].sort((left, right) => left.rank - right.rank);
}

export async function buildItalianFrequencyData(): Promise<FrequencyDataFile> {
  const entries = await loadItalianSourceEntries();
  const total = entries.length;

  return {
    lang: "it",
    generatedAt: DATA_BUILD_DATE,
    lemmas: Object.fromEntries(
      entries.map((entry, index) => [
        entry.lemmaId,
        {
          lemmaId: entry.lemmaId,
          lang: "it",
          rank: index + 1,
          corpusFrequency: total - index
        }
      ])
    )
  };
}

/**
 * AUTHORED FORMS WIN; THE RULE IS THE FALLBACK FOR LEMMAS THAT HAVE NONE.
 *
 * Italian is authored a lesson at a time -- writing the exponents for a lesson
 * surfaces the words it needs, and those get forms. So the dictionary is
 * partly authored and partly bare at every point until it is finished, and both
 * kinds have to produce forms in the same pass.
 *
 * The rule is kept rather than deleted because it is right more often than not
 * for nouns: `-o` and `-e` lemmas take `-i`, which covers most of them. It is
 * wrong for masculine `-a` nouns (`problema` -> `probleme`, real `problemi`)
 * and for the velar class, where Italian inserts an `h` (`banco` -> `banci`,
 * real `banchi`). Every lemma with authored forms stops going through
 * it, so those errors retire as the dictionary fills rather than all at once.
 */
function addItalianMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  const { lemmaId, partsOfSpeech } = entry;

  if (entry.forms) {
    for (const surface of authoredSurfacesOf(entry)) {
      addMorphologyEntry(forms, surface, lemmaId, partsOfSpeech);
    }
    return;
  }

  addMorphologyEntry(forms, lemmaId, lemmaId, partsOfSpeech);

  if (partsOfSpeech.includes("verb")) {
    if (lemmaId.endsWith("are")) {
      const stem = lemmaId.slice(0, -3);
      addMorphologyEntry(forms, `${stem}ando`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}ato`, lemmaId, partsOfSpeech);
    } else if (lemmaId.endsWith("ere")) {
      const stem = lemmaId.slice(0, -3);
      addMorphologyEntry(forms, `${stem}endo`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}uto`, lemmaId, partsOfSpeech);
    } else if (lemmaId.endsWith("ire")) {
      const stem = lemmaId.slice(0, -3);
      addMorphologyEntry(forms, `${stem}endo`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}ito`, lemmaId, partsOfSpeech);
    }
  }

  if (partsOfSpeech.includes("noun") || partsOfSpeech.includes("adjective")) {
    if (lemmaId.endsWith("o")) {
      addMorphologyEntry(
        forms,
        `${lemmaId.slice(0, -1)}i`,
        lemmaId,
        partsOfSpeech
      );
    } else if (lemmaId.endsWith("a")) {
      addMorphologyEntry(
        forms,
        `${lemmaId.slice(0, -1)}e`,
        lemmaId,
        partsOfSpeech
      );
    } else if (lemmaId.endsWith("e")) {
      addMorphologyEntry(
        forms,
        `${lemmaId.slice(0, -1)}i`,
        lemmaId,
        partsOfSpeech
      );
    }
  }
}

function buildItalianQuestionnaire(): PlacementQuestionnaire {
  return {
    schemaVersion: 1,
    lang: "it",
    targetLanguage: "it",
    supportLanguage: "en",
    formTitle: "Modulo di Arrivo",
    formIntro:
      "Rispondi in italiano quando puoi. Lascia vuoto quello che ancora non capisci.",
    minAnswersForValid: 6,
    questions: [
      {
        kind: "multiple-choice",
        questionId: "it-q1",
        targetBand: "A1",
        promptText: "Come ti chiami?",
        options: [
          { optionId: "a", text: "Mi chiamo Luca.", isCorrect: true },
          { optionId: "b", text: "Ho una valigia.", isCorrect: false },
          { optionId: "c", text: "Lavoro qui.", isCorrect: false }
        ]
      },
      {
        kind: "fill-in-blank",
        questionId: "it-q2",
        targetBand: "A1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Io ___ del Canada.",
        acceptableAnswers: ["sono"],
        acceptableLemmas: ["essere"]
      },
      {
        kind: "yes-no",
        questionId: "it-q3",
        targetBand: "A1",
        promptText: "Parli un po di italiano?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "free-text",
        questionId: "it-q4",
        targetBand: "A2",
        promptText: "Scrivi una frase sul tuo lavoro.",
        expectedLemmas: ["lavorare"],
        acceptableForms: ["lavoro", "lavorare", "lavorando"],
        minExpectedLength: 10
      },
      {
        kind: "multiple-choice",
        questionId: "it-q5",
        targetBand: "A2",
        promptText: "Quanto tempo resti in citta?",
        options: [
          { optionId: "a", text: "Due settimane.", isCorrect: true },
          { optionId: "b", text: "La stazione e grande.", isCorrect: false },
          { optionId: "c", text: "Mi piace il formaggio.", isCorrect: false }
        ]
      },
      {
        kind: "yes-no",
        questionId: "it-q6",
        targetBand: "A2",
        promptText: "Viaggi da solo oggi?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "fill-in-blank",
        questionId: "it-q7",
        targetBand: "B1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Ho bisogno del mio ___ per il treno.",
        acceptableAnswers: ["biglietto"],
        acceptableLemmas: ["biglietto"]
      },
      {
        kind: "free-text",
        questionId: "it-q8",
        targetBand: "B1",
        promptText: "Spiega perche vieni in questa citta.",
        expectedLemmas: ["venire", "citta"],
        minExpectedLength: 18
      },
      {
        kind: "multiple-choice",
        questionId: "it-q9",
        targetBand: "B2",
        promptText: "Quale documento presenti alla dogana?",
        options: [
          { optionId: "a", text: "Il mio passaporto.", isCorrect: true },
          {
            optionId: "b",
            text: "Il mio formaggio preferito.",
            isCorrect: false
          },
          { optionId: "c", text: "Il mio calendario.", isCorrect: false }
        ]
      },
      {
        kind: "free-text",
        questionId: "it-q10",
        targetBand: "B2",
        promptText:
          "Descrivi un problema di viaggio che hai risolto di recente.",
        expectedLemmas: ["risolvere", "viaggiare"],
        minExpectedLength: 24
      }
    ]
  };
}
/**
 * Verbs whose present subjunctive is not built off the `io` stem, given in
 * full. Everything else in the language is regular here, including the ones
 * that look irregular: `vengo` -> `venga`, `dico` -> `dica`, `faccio` ->
 * `faccia`.
 */
const ITALIAN_IRREGULAR_SUBJUNCTIVE: Record<string, string[]> = {
  essere: ["sia", "sia", "sia", "siamo", "siate", "siano"],
  avere: ["abbia", "abbia", "abbia", "abbiamo", "abbiate", "abbiano"],
  andare: ["vada", "vada", "vada", "andiamo", "andiate", "vadano"],
  dare: ["dia", "dia", "dia", "diamo", "diate", "diano"],
  stare: ["stia", "stia", "stia", "stiamo", "stiate", "stiano"],
  sapere: ["sappia", "sappia", "sappia", "sappiamo", "sappiate", "sappiano"],
  volere: ["voglia", "voglia", "voglia", "vogliamo", "vogliate", "vogliano"],
  potere: ["possa", "possa", "possa", "possiamo", "possiate", "possano"],
  dovere: ["debba", "debba", "debba", "dobbiamo", "dobbiate", "debbano"]
};

/**
 * Verbs whose future and conditional are not built on the infinitive. Every
 * other verb is, which is why these are a list and not a rule.
 */
const ITALIAN_IRREGULAR_FUTURE_STEM: Record<string, string> = {
  essere: "sar",
  avere: "avr",
  andare: "andr",
  volere: "vorr",
  potere: "potr",
  dovere: "dovr",
  sapere: "sapr",
  vedere: "vedr",
  venire: "verr",
  fare: "far",
  stare: "star",
  dare: "dar",
  rimanere: "rimarr",
  tenere: "terr",
  bere: "berr",
  vivere: "vivr",
  cadere: "cadr"
};

/** Pronouns that attach to the end of a verb: `dirmi`, `figurati`, `farlo`. */
const ITALIAN_CLITICS = [
  "mi",
  "ti",
  "si",
  "ci",
  "vi",
  "lo",
  "la",
  "li",
  "le",
  "ne"
];

const SUBJUNCTIVE_ARE = ["i", "i", "i", "", "", "ino"];
const SUBJUNCTIVE_ERE_IRE = ["a", "a", "a", "", "", "ano"];
const CONDITIONAL = ["ei", "esti", "ebbe", "emmo", "este", "ebbero"];
const FUTURE = ["ò", "ai", "à", "emo", "ete", "anno"];

/** `parlare` -> `parler`, `prendere` -> `prender`, `sentire` -> `sentir`. */
function italianFutureStem(lemmaId: string): string | null {
  const irregular = ITALIAN_IRREGULAR_FUTURE_STEM[lemmaId];
  if (irregular) return irregular;
  if (lemmaId.endsWith("are")) return `${lemmaId.slice(0, -3)}er`;
  if (lemmaId.endsWith("ere") || lemmaId.endsWith("ire")) {
    return lemmaId.slice(0, -1);
  }
  return null;
}

/**
 * Tenses the dictionary does not store but the language needs.
 *
 * The stored forms are present, passato remoto, imperfect, gerund and past
 * participle. That leaves out three things a beginner meets immediately:
 *
 *   PRESENT SUBJUNCTIVE, which is also the polite `Lei` command -- `senta`,
 *   `scusi`, `dica`. A1 politeness is largely polite commands, and lesson 1
 *   could not resolve `senta` before this.
 *
 *   CONDITIONAL, which is how wanting is said politely -- `vorrei`, `potrei`.
 *
 *   FUTURE, one word rather than a periphrasis.
 *
 * All three are derived rather than authored because they ARE derivable, and
 * asking an author to write `senta` beside `sento` would be asking them to
 * restate a rule the language already follows.
 *
 * Returns nothing for an entry with no stored forms, so this never invents
 * anything for the thousands of Italian lemmas still awaiting them.
 */
function italianDerivedTenses(entry: AtlasLemmaEntry): string[] {
  const f = entry.forms;
  if (!f || !("pres" in f)) return [];
  const out: string[] = [];

  const irregular = ITALIAN_IRREGULAR_SUBJUNCTIVE[entry.lemmaId];
  if (irregular) {
    out.push(...irregular);
  } else {
    const io = f.pres[0];
    const noi = f.pres[3];
    if (typeof io === "string" && io.endsWith("o")) {
      const stem = io.slice(0, -1);
      const isAre = entry.lemmaId.endsWith("are");
      const endings = isAre ? SUBJUNCTIVE_ARE : SUBJUNCTIVE_ERE_IRE;
      // A stem already ending in `i` ABSORBS the subjunctive `i` rather than
      // doubling it: `mangiare` gives `mangi` and `mangino`, never `mangii`
      // and `mangiino`. Every -giare and -ciare verb is in this class, and
      // adding the ending blindly wrote a non-word for all of them.
      const absorbs = isAre && stem.endsWith("i");
      out.push(
        absorbs ? stem : `${stem}${endings[0]}`,
        absorbs ? `${stem}no` : `${stem}${endings[5]}`
      );
      // The two plural persons are NOT built off the `io` stem. For an -isc-
      // verb that stem carries the infix, and `capisciamo` is not a word --
      // the real forms are `capiamo` and `capiate`. First person plural is
      // identical to the present indicative, so the dictionary already has it.
      if (typeof noi === "string") out.push(noi);
      const bare = entry.lemmaId.slice(0, -3);
      if (bare) out.push(`${bare}iate`);
    }
  }

  const futureStem = italianFutureStem(entry.lemmaId);
  if (futureStem) {
    out.push(...CONDITIONAL.map((ending) => `${futureStem}${ending}`));
    out.push(...FUTURE.map((ending) => `${futureStem}${ending}`));
  }

  return out;
}

/**
 * Pronouns attached to the end of a verb.
 *
 * Italian attaches them to the infinitive (`dirmi`, `chiamarsi`, `farlo`) and
 * to the informal command (`figurati`, `dimmi`). The infinitive drops its
 * final `-e` first, which is why this works off a stem rather than the lemma.
 *
 * The informal command is the third-person singular present for `-are` verbs
 * and the second-person singular for the rest, so it is read from the stored
 * forms rather than guessed.
 */
function addItalianExtraForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  const f = entry.forms;
  const { lemmaId, partsOfSpeech } = entry;
  if (!partsOfSpeech.includes("verb")) return;
  if (!/(are|ere|ire)$/.test(lemmaId)) return;

  const bases: string[] = [lemmaId.slice(0, -1)];
  if (f && "pres" in f) {
    const command = lemmaId.endsWith("are") ? f.pres[2] : f.pres[1];
    if (typeof command === "string") bases.push(command);
  }

  for (const base of bases) {
    for (const clitic of ITALIAN_CLITICS) {
      addMorphologyEntry(forms, `${base}${clitic}`, lemmaId, partsOfSpeech);
    }
  }

  // The past participle AGREES when the verb takes `essere`: `sono nato` from
  // a man, `sono nata` from a woman, and the plurals. The dictionary stores
  // one form because there is one participle; the agreement is a rule, and
  // without it half the speakers of a sentence cannot be understood.
  if (f && "pres" in f && typeof f.part === "string" && f.part.endsWith("o")) {
    const stem = f.part.slice(0, -1);
    for (const ending of ["a", "i", "e"]) {
      addMorphologyEntry(forms, `${stem}${ending}`, lemmaId, partsOfSpeech);
    }
  }
}

function addItalianDerivedForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  for (const surface of italianDerivedTenses(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }
  addItalianExtraForms(forms, entry);

  // Fused preposition + article. Last, so a real word always keeps its own
  // entry: `dai` is the second person of `dare` before it is `da` + `i`, and
  // `coi` and `col` are optional spellings nobody has to use.
  for (const fused of ARTICULATED_PREPOSITIONS[entry.lemmaId] ?? []) {
    addMorphologyEntry(forms, fused, entry.lemmaId, entry.partsOfSpeech);
  }
}

export const italianRules: LanguageRules = {
  lang: "it",
  functionWords: FUNCTION_WORDS,
  expandWrittenForm: expandItalianWrittenForm,
  addMorphologyForms: addItalianMorphologyForms,
  addDerivedForms: addItalianDerivedForms,
  buildPlacementQuestionnaire: buildItalianQuestionnaire
};
