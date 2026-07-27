/**
 * packages/plugins/src/catalog/sugarlang/runtime/language-names.ts
 *
 * Purpose: Maps ISO-639-1 language codes to human-readable display names for
 *          use in LLM prompts, where "es" is ambiguous but "Spanish" is not.
 *
 * Exports:
 *   - languageDisplayName
 *
 * Status: active
 */

const LANGUAGE_ISO_TO_DISPLAY: Record<string, string> = {
  ar: "Arabic",
  de: "German",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  zh: "Chinese"
};

export function languageDisplayName(isoCode: string): string {
  return LANGUAGE_ISO_TO_DISPLAY[isoCode] ?? isoCode;
}
