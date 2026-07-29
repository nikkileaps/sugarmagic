/**
 * packages/plugins/src/catalog/sugarlang/tests/contracts/scene-context.test.ts
 *
 * Purpose: Pins CONCEPT_PARTS_OF_SPEECH against every shipped atlas, so a
 *   language whose atlas emits an unknown part of speech fails HERE rather than
 *   silently dropping every concept at resolution time.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Guards ../../runtime/contracts/scene-context.
 *   - Reads ../../data/languages/{es,it}/cefrlex.json as checked-in truth.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import esAtlas from "../../data/languages/es/cefrlex.json";
import itAtlas from "../../data/languages/it/cefrlex.json";
import {
  CONCEPT_PARTS_OF_SPEECH,
  type ConceptPartOfSpeech
} from "../../runtime/contracts/scene-context";

const SHIPPED_ATLASES: Array<[string, { lemmas: Record<string, { partsOfSpeech?: string[] }> }]> = [
  ["es", esAtlas as never],
  ["it", itAtlas as never]
];

function partsOfSpeechIn(atlas: {
  lemmas: Record<string, { partsOfSpeech?: string[] }>;
}): Set<string> {
  const found = new Set<string>();
  for (const entry of Object.values(atlas.lemmas)) {
    for (const pos of entry.partsOfSpeech ?? []) found.add(pos);
  }
  return found;
}

describe("CONCEPT_PARTS_OF_SPEECH", () => {
  it.each(SHIPPED_ATLASES)(
    "covers every part of speech the %s atlas emits",
    (lang, atlas) => {
      // The failure this guards is silent: a concept tagged with a POS the
      // atlas never emits cannot match any entry, so it drops at resolution
      // and telemetry reads "no atlas resolution" -- a coverage problem, not
      // the schema mismatch it actually is.
      const allowed = new Set<string>(CONCEPT_PARTS_OF_SPEECH);
      const missing = [...partsOfSpeechIn(atlas)].filter((pos) => !allowed.has(pos)).sort();

      expect(
        missing,
        `${lang} atlas emits parts of speech absent from CONCEPT_PARTS_OF_SPEECH. ` +
          `Add them there, or concepts carrying them will drop silently.`
      ).toEqual([]);
    }
  );

  it("declares no value that no shipped atlas emits", () => {
    // The reverse guard: a value here that nothing emits is dead weight the
    // extractor schema would still accept, admitting concepts that can never
    // resolve.
    const emitted = new Set<string>();
    for (const [, atlas] of SHIPPED_ATLASES) {
      for (const pos of partsOfSpeechIn(atlas)) emitted.add(pos);
    }

    const unused = CONCEPT_PARTS_OF_SPEECH.filter((pos) => !emitted.has(pos));

    expect(unused).toEqual([]);
  });

  it("is the union across atlases, not one atlas's set", () => {
    // Regression pin for the specific mistake an earlier draft of the plan
    // proposed: hard-pinning the es twelve would reject every Italian concept
    // tagged abbreviation or formula.
    const es = partsOfSpeechIn(esAtlas as never);
    const it = partsOfSpeechIn(itAtlas as never);

    expect(es.has("abbreviation")).toBe(false);
    expect(it.has("abbreviation")).toBe(true);
    expect(CONCEPT_PARTS_OF_SPEECH).toContain<ConceptPartOfSpeech>("abbreviation");
    expect(CONCEPT_PARTS_OF_SPEECH).toContain<ConceptPartOfSpeech>("formula");
  });

  it("does not adopt the budgeter's FUNCTIONAL_POS values", () => {
    // article / auxiliary / particle are the budgeter's own vocabulary and are
    // emitted by no atlas; admitting them would create concepts that can never
    // resolve.
    for (const pos of ["article", "auxiliary", "particle"]) {
      expect(CONCEPT_PARTS_OF_SPEECH as readonly string[]).not.toContain(pos);
    }
  });
});
