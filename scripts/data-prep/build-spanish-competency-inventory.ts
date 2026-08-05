/**
 * scripts/data-prep/build-spanish-competency-inventory.ts
 *
 * Purpose: Rebuilds the checked-in Spanish competency inventory from the
 *   authored curriculum and the authored Spanish exponents.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Uses the build in ./competency-inventory.
 *   - Writes packages/plugins/src/catalog/sugarlang/data/languages/es/competency-inventory.json.
 *
 * Status: active
 */

import {
  buildCompetencyInventory,
  type CurriculumBandFile,
  type ExponentsFile,
  type MorphologyFile
} from "./competency-inventory";
import {
  readJsonFile,
  sugarlangDataPath,
  writeJsonFile
} from "./sugarlang-language-data";

const BANDS = ["a1", "a2", "b1", "b2", "c1"];

writeJsonFile(
  sugarlangDataPath("languages", "es", "competency-inventory.json"),
  buildCompetencyInventory({
    bands: BANDS.map((band) =>
      readJsonFile<CurriculumBandFile>(
        sugarlangDataPath("curriculum", `${band}.json`)
      )
    ),
    exponents: readJsonFile<ExponentsFile>(
      sugarlangDataPath("languages", "es", "exponents.json")
    ),
    morphology: readJsonFile<MorphologyFile>(
      sugarlangDataPath("languages", "es", "morphology.json")
    )
  })
);
