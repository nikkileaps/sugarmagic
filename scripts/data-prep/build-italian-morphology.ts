/**
 * scripts/data-prep/build-italian-morphology.ts
 *
 * Purpose: Rebuilds the checked-in Italian morphology snapshot from the imported Italian atlas.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/it/morphology.json.
 *
 * Implements: Epic 4 Story 4.3
 *
 * Status: active
 */

import {
  buildItalianMorphologyData,
  type CefrLexDataFile,
  readJsonFile,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "it", "morphology.json"),
  buildItalianMorphologyData(
    readJsonFile<CefrLexDataFile>(
      sugarlangDataPath("languages", "it", "cefrlex.json")
    )
  )
);
