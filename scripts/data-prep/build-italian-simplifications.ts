/**
 * scripts/data-prep/build-italian-simplifications.ts
 *
 * Purpose: Rebuilds the checked-in Italian simplifications snapshot from the imported Italian atlas.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/it/simplifications.json.
 *
 * Implements: Epic 4 Story 4.3
 *
 * Status: active
 */

import {
  buildItalianSimplificationsData,
  type CefrLexDataFile,
  readJsonFile,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "it", "simplifications.json"),
  buildItalianSimplificationsData(
    readJsonFile<CefrLexDataFile>(
      sugarlangDataPath("languages", "it", "cefrlex.json")
    )
  )
);
