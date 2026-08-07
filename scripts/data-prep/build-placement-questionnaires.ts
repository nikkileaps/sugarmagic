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
  buildPlacementQuestionnaireFor,
  registeredLanguages
} from "./languages/registry";
import { sugarlangDataPath, writeJsonFile } from "./sugarlang-language-data";

// Every registered language, so a new one needs no edit here.
for (const lang of registeredLanguages()) {
  writeJsonFile(
    sugarlangDataPath("languages", lang, "placement-questionnaire.json"),
    buildPlacementQuestionnaireFor(lang)
  );
}
