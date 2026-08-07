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
  bel: "bello"
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
export const italianRules: LanguageRules = {
  lang: "it",
  functionWords: FUNCTION_WORDS,
  expandWrittenForm: expandItalianWrittenForm,
  addMorphologyForms: addItalianMorphologyForms,
  // No third pass yet. Polite imperatives (`senta`) and attached pronouns
  // (`figurati`) need one; 091.7 owns it, scoped by what the lessons surface.
  buildPlacementQuestionnaire: buildItalianQuestionnaire
};
