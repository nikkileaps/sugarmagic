/**
 * scripts/data-prep/derive-italian-frequency.ts
 *
 * Purpose: Imports the real Italian Kelly frequency list and regenerates the checked-in Italian frequency snapshot used by sugarlang.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/it/frequency.json.
 *
 * Implements: Epic 4 Story 4.3
 *
 * Status: active
 */

import {
  buildItalianFrequencyData,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "it", "frequency.json"),
  await buildItalianFrequencyData()
);
