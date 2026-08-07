/**
 * scripts/data-prep/build-competency-inventory.ts
 *
 * Purpose: Rebuilds a language's checked-in competency inventory from the
 *   shared curriculum and that language's authored exponents.
 *
 * Replaces build-spanish-competency-inventory.ts, which named the language in
 * its filename and in all three paths it touched -- so there was no way to
 * produce any other language's inventory, however complete its exponents were.
 *
 * Usage:
 *   pnpm exec tsx scripts/data-prep/build-competency-inventory.ts es
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

const lang = process.argv[2];
if (!lang) {
  throw new Error("Usage: build-competency-inventory.ts <lang>");
}

writeJsonFile(
  sugarlangDataPath("languages", lang, "competency-inventory.json"),
  buildCompetencyInventory({
    bands: BANDS.map((band) =>
      readJsonFile<CurriculumBandFile>(
        sugarlangDataPath("curriculum", `${band}.json`)
      )
    ),
    exponents: readJsonFile<ExponentsFile>(
      sugarlangDataPath("languages", lang, "exponents.json")
    ),
    morphology: readJsonFile<MorphologyFile>(
      sugarlangDataPath("languages", lang, "morphology.json")
    )
  })
);
