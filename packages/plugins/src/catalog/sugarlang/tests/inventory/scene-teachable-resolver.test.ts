/**
 * packages/plugins/src/catalog/sugarlang/tests/inventory/scene-teachable-resolver.test.ts
 *
 * Purpose: Pins concept -> vocabulary resolution against the REAL shipped Spanish
 *   atlas, not a fixture.
 *
 * WHY REAL DATA
 *   The pinned rows are claims ABOUT the shipped curriculum -- that `dock` really
 *   is only a verb in the atlas, that `saludo` really outranks `saluda`. A fixture
 *   would let those claims stay true in the test while being false in the game,
 *   which is what the epic's "measured against the shipped es atlas" framing
 *   exists to avoid.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 *   Concept -> competency. That is a judgment made by the Teacher against the
 *   situation (090.3, 090.4), not a lookup, so this module does not attempt it
 *   and there is nothing here to pin.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/inventory/scene-teachable-resolver.
 *
 * Implements: Plan 090 story 090.2
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import { resolveSceneTeachables } from "../../runtime/inventory/scene-teachable-resolver";
import type { Concept, ConceptPartOfSpeech } from "../../runtime/contracts/scene-context";

const atlas = new CefrLexAtlasProvider();

function concept(
  label: string,
  pos?: ConceptPartOfSpeech,
  overrides: Partial<Concept> = {}
): Concept {
  return {
    label,
    ...(pos ? { pos } : {}),
    provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }],
    ...overrides
  };
}

function resolve(concepts: Concept[]) {
  return resolveSceneTeachables({
    concepts,
    atlas,
    targetLanguage: "es",
    supportLanguage: "en"
  });
}

function lemmaIds(result: ReturnType<typeof resolve>): string[] {
  return result.teachables.map((teachable) => teachable.id);
}

describe("resolveSceneTeachables -- atlas lookup on shipped data", () => {
  it("resolves the pinned scene rows", () => {
    const result = resolve([
      concept("cheese", "noun"),
      concept("trade", "noun"),
      concept("boat", "noun")
    ]);

    expect(lemmaIds(result)).toEqual(["barca", "oficio", "queso"]);
    expect(result.diagnostics.atlasHits).toBe(3);
  });

  it("every row is a vocabulary teachable -- competencies are not resolved here", () => {
    // Pin: matching a concept to one of ten competencies is a judgment, and this
    // module deliberately does not make it. If competency rows ever appear here,
    // a lookup table has been reintroduced in place of the Teacher.
    const result = resolve([concept("greeting", "noun"), concept("asking for directions")]);

    expect(result.teachables.every((teachable) => teachable.kind === "vocabulary")).toBe(true);
  });

  it("ranks by frequency so the commoner word wins", () => {
    // greeting -> saludo (1503) beats saluda (5690);
    // university -> universidad (258) beats uni (10210).
    expect(lemmaIds(resolve([concept("greeting", "noun")]))).toEqual(["saludo"]);
    expect(lemmaIds(resolve([concept("university", "noun")]))).toEqual(["universidad"]);
  });

  it("a multi-word label does not throw, does not warn, and never reaches the POS filter", () => {
    // Pin: the single-word rule belongs to the atlas lookup, not to concepts.
    const result = resolve([concept("self introduction", "noun")]);

    expect(result.diagnostics.skippedMultiWord).toBe(1);
    expect(result.diagnostics.droppedForPos).toBe(0);
    expect(result.teachables).toEqual([]);
  });

  it("counts a POS-emptied pool separately from a plain miss", () => {
    // `dock` glosses only `atracar` (verb) in the shipped atlas, so a noun
    // concept empties the pool. That means "the atlas has this word in another
    // sense", which is a different signal from "never heard of it".
    const asNoun = resolve([concept("dock", "noun")]);
    expect(asNoun.diagnostics.droppedForPos).toBe(1);
    expect(asNoun.teachables).toEqual([]);

    const asVerb = resolve([concept("dock", "verb")]);
    expect(lemmaIds(asVerb)).toEqual(["atracar"]);
  });

  it("absent POS means do not filter, never unknown", () => {
    const result = resolve([concept("dock")]);

    expect(lemmaIds(result)).toEqual(["atracar"]);
    expect(result.diagnostics.droppedForPos).toBe(0);
  });

  it("an unresolvable concept is counted, not reported as a curriculum gap", () => {
    // Whether this is an unknown word or an act the curriculum can teach is not
    // knowable here -- only the Teacher, reading it against the inventory, can
    // say. Claiming a gap from this module would be guessing.
    const result = resolve([concept("moon cheese bartering")]);

    expect(result.teachables).toEqual([]);
    expect(result.diagnostics.conceptCount).toBe(1);
    expect(result).not.toHaveProperty("gaps");
  });
});

describe("resolveSceneTeachables -- rows are keyed by teachable", () => {
  it("merges two concepts that resolve to one lemma", () => {
    const result = resolve([
      concept("greeting", "noun", {
        provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }]
      }),
      // `saludo` is also the primary gloss target for this label in the atlas.
      concept("greeting", "noun", {
        provenance: [{ sourceId: "lore:lore.dock", kind: "lore" }],
        mustComprehend: true
      })
    ]);

    expect(result.teachables).toHaveLength(1);
    const saludo = result.teachables[0];
    expect(saludo?.id).toBe("saludo");
    expect(saludo?.concepts).toEqual(["greeting"]);
    expect(saludo?.provenance).toEqual([
      { sourceId: "lore:lore.dock", kind: "lore" },
      { sourceId: "npc:npc-orrin", kind: "npc" }
    ]);
    // ANY demanding concept being quest-essential makes the teachable so.
    expect(saludo?.mustComprehend).toBe(true);
  });

  it("dedupes provenance when two concepts cite the same source", () => {
    const result = resolve([concept("greeting", "noun"), concept("greeting", "noun")]);

    expect(result.teachables[0]?.provenance).toEqual([
      { sourceId: "npc:npc-orrin", kind: "npc" }
    ]);
  });

  it("is deterministic in row and field order", () => {
    const concepts = [concept("cheese", "noun"), concept("boat", "noun")];
    expect(resolve(concepts)).toEqual(resolve([...concepts].reverse()));
  });
});

describe("resolveSceneTeachables -- derived, never stored", () => {
  it("holds no state between calls", () => {
    // The list is recomputed from concepts + atlas every time it is wanted, so
    // an atlas edit applies with no recompile and there is no cache key to keep
    // honest. Repeated calls must not accumulate.
    const first = resolve([concept("cheese", "noun")]);
    const second = resolve([concept("cheese", "noun")]);

    expect(first).toEqual(second);
    expect(second.teachables).toHaveLength(1);
  });
});
