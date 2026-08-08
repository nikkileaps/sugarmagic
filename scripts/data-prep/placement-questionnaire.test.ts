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
import {
  buildPlacementQuestionnaireFor,
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

/** Every word in a string, keeping an apostrophe inside one (`un po'`). */
function words(value: string): string[] {
  return value.match(/[\p{Letter}\p{Mark}]+(?:'[\p{Letter}\p{Mark}]+)?/gu) ?? [];
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
    const unknown: string[] = [];
    for (const question of bank.questions) {
      for (const value of targetLanguageStrings(question)) {
        words(value).forEach((word, index) => {
          if (index > 0 && word[0] !== word[0]!.toLocaleLowerCase(lang)) return;
          if (!morphology[word.toLocaleLowerCase(lang)]) {
            unknown.push(`${question.questionId}: "${word}" in "${value}"`);
          }
        });
      }
    }
    expect(unknown).toEqual([]);
  });
});
