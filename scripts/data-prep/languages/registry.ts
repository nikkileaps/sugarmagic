/**
 * scripts/data-prep/languages/registry.ts
 *
 * Purpose: Maps a language code to its rules, and runs the shared builds
 *   through them.
 *
 * ADDING A LANGUAGE SHOULD BE A FILE AND A LINE
 *   Write `./<lang>.ts` implementing LanguageRules, then add it to RULES below.
 *   Nothing else here or in the shared pipeline should need editing -- if it
 *   does, a language's rule is still living in shared code and belongs in the
 *   new file instead. That property is the point of this layout, and it is
 *   checked by building a language end to end and reading `git diff --stat`.
 *
 * Relationships:
 *   - Depends on ./<lang> and ../sugarlang-language-data. Nothing depends back
 *     on it from the shared pipeline, so the dependency runs one way.
 *
 * Exports:
 *   - languageRules
 *   - buildMorphologyFor
 *   - buildPlacementQuestionnaireFor
 *
 * Status: active
 */

import {
  buildMorphologyData,
  type CefrLexDataFile,
  type MorphologyDataFile,
  type PlacementQuestionnaire
} from "../sugarlang-language-data";
import { spanishRules } from "./es";
import { italianRules } from "./it";
import type { LanguageRules } from "./language-rules";

const RULES: Record<string, LanguageRules> = {
  es: spanishRules,
  it: italianRules
};

/** Every language with rules, so callers can loop instead of naming them. */
export function registeredLanguages(): string[] {
  return Object.keys(RULES);
}

export function languageRules(lang: string): LanguageRules {
  const rules = RULES[lang];
  if (!rules) {
    throw new Error(
      `No data-prep rules for "${lang}". Add scripts/data-prep/languages/${lang}.ts and register it.`
    );
  }
  return rules;
}

export function buildMorphologyFor(atlas: CefrLexDataFile): MorphologyDataFile {
  const rules = languageRules(atlas.lang);
  return buildMorphologyData(
    atlas,
    (forms, entry) => rules.addMorphologyForms(forms, entry),
    rules.addDerivedForms
      ? (forms, entry) => rules.addDerivedForms!(forms, entry)
      : undefined
  );
}

export function buildPlacementQuestionnaireFor(
  lang: string
): PlacementQuestionnaire {
  return languageRules(lang).buildPlacementQuestionnaire();
}
