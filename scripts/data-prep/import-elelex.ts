/**
 * scripts/data-prep/import-elelex.ts
 *
 * Purpose: Imports the real ELELex Spanish source and regenerates the checked-in CEFR lexicon snapshot used by sugarlang.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/es/cefrlex.json.
 *
 * Implements: Epic 4 Story 4.2
 *
 * Status: active
 */

import {
  buildSpanishCefrlexData,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "es", "cefrlex.json"),
  await buildSpanishCefrlexData()
);
