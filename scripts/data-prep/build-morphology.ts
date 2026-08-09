/**
 * scripts/data-prep/build-morphology.ts
 *
 * Purpose: Rebuilds a language's checked-in morphology snapshot from its
 *   dictionary.
 *
 * Replaces build-spanish-morphology.ts and build-italian-morphology.ts, which
 * were the same script twice and would have become a third for French. The
 * language part now lives in languages/<lang>.ts and is reached through the
 * registry.
 *
 * Usage:
 *   pnpm exec tsx scripts/data-prep/build-morphology.ts es
 *
 * Status: active
 */

import { buildMorphologyFor } from "./languages/registry";
import {
  readJsonFile,
  sugarlangDataPath,
  writeJsonFile,
  type CefrLexDataFile
} from "./sugarlang-language-data";

const lang = process.argv[2];
if (!lang) {
  throw new Error("Usage: build-morphology.ts <lang>");
}

writeJsonFile(
  sugarlangDataPath("languages", lang, "morphology.json"),
  buildMorphologyFor(
    readJsonFile<CefrLexDataFile>(
      sugarlangDataPath("languages", lang, "cefrlex.json")
    )
  )
);
