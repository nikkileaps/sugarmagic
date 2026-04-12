/**
 * scripts/data-prep/build-simplifications-es.ts
 *
 * Purpose: Rebuilds the checked-in Spanish simplifications snapshot from the imported Spanish atlas.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/es/simplifications.json.
 *
 * Implements: Epic 4 Story 4.2
 *
 * Status: active
 */

import {
  buildSpanishSimplificationsData,
  type CefrLexDataFile,
  readJsonFile,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "es", "simplifications.json"),
  buildSpanishSimplificationsData(
    readJsonFile<CefrLexDataFile>(
      sugarlangDataPath("languages", "es", "cefrlex.json")
    )
  )
);
