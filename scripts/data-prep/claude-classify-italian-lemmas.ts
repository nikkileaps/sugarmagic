/**
 * scripts/data-prep/claude-classify-italian-lemmas.ts
 *
 * Purpose: Regenerates the checked-in Italian review queue for lower-confidence frequency-derived assignments.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the shared source-backed import helpers in ./sugarlang-language-data.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/it/review-queue.yaml.
 *
 * Implements: Epic 4 Story 4.3
 *
 * Status: active
 */

import {
  buildItalianReviewQueueYaml,
  type CefrLexDataFile,
  readJsonFile,
  sugarlangDataPath,
  writeTextFile
} from "./sugarlang-language-data";

writeTextFile(
  sugarlangDataPath("languages", "it", "review-queue.yaml"),
  buildItalianReviewQueueYaml(
    readJsonFile<CefrLexDataFile>(
      sugarlangDataPath("languages", "it", "cefrlex.json")
    )
  )
);
