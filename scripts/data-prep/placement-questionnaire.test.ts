/**
 * scripts/data-prep/placement-questionnaire.test.ts
 *
 * Purpose: Pins the placement banks of every registered language against the
 *   dictionary that scores them, and against the builder that writes them.
 *
 * The banks were hand-written prose and nothing checked them, so they drifted
 * from the language: the Italian bank asked for the lemma `citta`, which is not
 * a word (the dictionary spells it `citta`, accented), so that half of the
 * question could never be earned. Both banks also offered `si` as the word for
 * yes, which is the reflexive pronoun. None of it failed anything.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { MorphologyFile } from "./competency-inventory";
import type { LanguageRules } from "./languages/language-rules";
import {
  buildPlacementQuestionnaireFor,
  languageRules,
  registeredLanguages
} from "./languages/registry";
import {
  readJsonFile,
  sugarlangDataPath,
  type PlacementQuestionnaire
} from "./sugarlang-language-data";
import { readFileSync } from "node:fs";

/**
 * The bank shape this file reads. The data-prep `PlacementQuestionnaire` leaves
 * `questions` untyped because the builders only ever write it; here it is read,
 * and the runtime contract that scores it is in a package this script does not
 * import from. If a new question kind is added, add it here too.
 */
type Question = { questionId: string; promptText: string } & (
  | { kind: "multiple-choice"; options: Array<{ text: string }> }
  | { kind: "free-text"; expectedLemmas: string[]; acceptableForms?: string[] }
  | { kind: "yes-no"; yesLabel: string; noLabel: string }
  | {
      kind: "fill-in-blank";
      sentenceTemplate: string;
      acceptableAnswers: string[];
      acceptableLemmas?: string[];
    }
);

const LANGS = registeredLanguages();

/**
 * The dictionary keys one written chunk stands for, resolved the way the BUILD
 * resolves them: the language's own expansion first, then strip what is left.
 *
 * This started as a regex over letters, which was enough for two languages that
 * write their contractions rarely and never at the start of a word. French does
 * both constantly -- `J'ai`, `m'appelle`, `J'habite` -- and every one of them
 * came back unknown against a check that had never been asked the question.
 * Going through `expandWrittenForm` is not a French accommodation; it is what
 * the check meant all along.
 */
function lookupKeys(chunk: string, rules: LanguageRules): string[] {
  const bare = (value: string) =>
    value.replace(/[^\p{Letter}\p{Number}\p{Mark}]/gu, "");
  const lower = chunk.toLocaleLowerCase(rules.lang);
  const expanded = rules.expandWrittenForm?.(lower);
  if (expanded) return expanded.map(bare).filter(Boolean);
  const cleaned = bare(lower);
  return cleaned ? [cleaned] : [];
}

/**
 * Strings written IN the target language: what the learner reads as the
 * question, and what counts as an answer. `supportText` is deliberately absent
 * -- it is the English gloss.
 */
function targetLanguageStrings(question: Question): string[] {
  const out = [question.promptText];
  if (question.kind === "fill-in-blank") {
    out.push(question.sentenceTemplate, ...question.acceptableAnswers);
  }
  if (question.kind === "multiple-choice") {
    out.push(...question.options.map((option) => option.text));
  }
  if (question.kind === "yes-no") {
    out.push(question.yesLabel, question.noLabel);
  }
  if (question.kind === "free-text") {
    out.push(...(question.acceptableForms ?? []));
  }
  return out;
}

/** The lemma ids the scorer compares a learner's answer against. */
function scoredLemmas(question: Question): string[] {
  if (question.kind === "free-text") return question.expectedLemmas;
  if (question.kind === "fill-in-blank") return question.acceptableLemmas ?? [];
  return [];
}

describe.each(LANGS)("placement bank (%s)", (lang) => {
  const path = sugarlangDataPath("languages", lang, "placement-questionnaire.json");
  const bank = readJsonFile<Omit<PlacementQuestionnaire, "questions"> & {
    questions: Question[];
  }>(path);
  const morphology = readJsonFile<MorphologyFile>(
    sugarlangDataPath("languages", lang, "morphology.json")
  ).forms;

  it("a fresh build reproduces the checked-in file byte for byte", () => {
    // Nothing else pinned this, so editing the builder and forgetting to run it
    // left the shipped bank on the old text -- which is exactly what a fix to
    // the bank looks like right up until it does nothing.
    const rebuilt = `${JSON.stringify(buildPlacementQuestionnaireFor(lang), null, 2)}\n`;
    expect(rebuilt).toBe(readFileSync(path, "utf8"));
  });

  it("THE ONE THAT WAS WRONG: every lemma the scorer looks for is a real lemma", () => {
    // `expectedLemmas` and `acceptableLemmas` are compared against whatever
    // lemmatize() returns, so a value the dictionary has never heard of is not
    // an error -- it is a silently unearnable point.
    const unknown: string[] = [];
    for (const question of bank.questions) {
      for (const lemmaId of scoredLemmas(question)) {
        if (morphology[lemmaId]?.lemmaId !== lemmaId) {
          unknown.push(`${question.questionId}: ${lemmaId}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every target-language word in the bank is one the dictionary knows", () => {
    // Catches a word spelled without its accent, which is how `citta` and
    // `perche` got in. A capitalised word that is not the first of its sentence
    // is a name (`Luca`, `Canada`) and is not expected to be in a dictionary.
    const rules = languageRules(lang);
    const unknown: string[] = [];
    for (const question of bank.questions) {
      for (const value of targetLanguageStrings(question)) {
        value
          .split(/\s+/)
          .filter(Boolean)
          .forEach((chunk, index) => {
            const first = chunk[0]!;
            if (index > 0 && first !== first.toLocaleLowerCase(lang)) return;
            for (const key of lookupKeys(chunk, rules)) {
              if (!morphology[key]) {
                unknown.push(`${question.questionId}: "${chunk}" in "${value}"`);
              }
            }
          });
      }
    }
    expect(unknown).toEqual([]);
  });
});
