/**
 * scripts/data-prep/build-placement-questionnaires.ts
 *
 * Purpose: Regenerates the checked-in Spanish and Italian placement questionnaire snapshots used by sugarlang.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/<lang>/placement-questionnaire.json.
 *
 * Implements: Epic 4 Stories 4.2 and 4.3
 *
 * Status: active
 */

import {
  buildItalianPlacementQuestionnaire,
  buildSpanishPlacementQuestionnaire,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

writeJsonFile(
  sugarlangDataPath("languages", "es", "placement-questionnaire.json"),
  buildSpanishPlacementQuestionnaire()
);
writeJsonFile(
  sugarlangDataPath("languages", "it", "placement-questionnaire.json"),
  buildItalianPlacementQuestionnaire()
);
