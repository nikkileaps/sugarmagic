/**
 * scripts/data-prep/build-spanish-morphology.ts
 *
 * Purpose: Rebuilds the checked-in Spanish morphology snapshot from the imported Spanish atlas.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/es/morphology.json.
 *
 * Implements: Epic 4 Story 4.2
 *
 * Status: active
 */

import {
  buildSpanishMorphologyData,
  type CefrLexDataFile,
  readJsonFile,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "es", "morphology.json"),
  buildSpanishMorphologyData(
    readJsonFile<CefrLexDataFile>(
      sugarlangDataPath("languages", "es", "cefrlex.json")
    )
  )
);
