/**
 * scripts/data-prep/build-italian-cefrlex.ts
 *
 * Purpose: Imports the real Italian Kelly source and regenerates the checked-in Kelly subset and merged CEFR lexicon snapshots used by sugarlang.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/it/kelly-subset.json and cefrlex.json.
 *
 * Implements: Epic 4 Story 4.3
 *
 * Status: active
 */

import {
  buildItalianCefrlexData,
  buildItalianKellySubsetData,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "it", "kelly-subset.json"),
  await buildItalianKellySubsetData()
);
writeJsonFile(
  sugarlangDataPath("languages", "it", "cefrlex.json"),
  await buildItalianCefrlexData()
);
