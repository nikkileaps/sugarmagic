/**
 * packages/plugins/src/catalog/sugarlang/tests/data/curriculum.test.ts
 *
 * Purpose: Validates the authored curriculum against its schema and pins the
 *   invariants a band file has to hold for the inventory to be generatable
 *   from it.
 *
 * Relationships:
 *   - Validates every data/curriculum/<band>.json against
 *     data/schemas/curriculum-band.schema.json.
 *
 * Status: active
 */

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import a1 from "../../data/curriculum/a1.json";
import a2 from "../../data/curriculum/a2.json";
import b1 from "../../data/curriculum/b1.json";
import b2 from "../../data/curriculum/b2.json";
import c1 from "../../data/curriculum/c1.json";
import bandSchema from "../../data/schemas/curriculum-band.schema.json";
import shippedInventory from "../../data/languages/es/competency-inventory.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(bandSchema);

type BandFile = {
  band: string;
  lessons: Array<{ lessonId: string; ordinal: number; displayName: string }>;
  competencies: Array<{
    competencyId: string;
    lessonId: string;
    displayName: string;
    cefrDescriptor: string;
  }>;
};

const BANDS: BandFile[] = [
  a1 as BandFile,
  a2 as BandFile,
  b1 as BandFile,
  b2 as BandFile,
  c1 as BandFile
];

// The shipped inventory is A1, so the assertions about it read from A1 alone.
const competencies = (a1 as BandFile).competencies;

describe("every band validates", () => {
  for (const band of BANDS) {
    it(`${band.band} matches its schema`, () => {
      const ok = validate(band);
      if (!ok) console.error(ajv.errorsText(validate.errors, { separator: "\n" }));
      expect(ok).toBe(true);
    });
  }
});

describe("bands do not collide", () => {
  it("THE ONE A SECOND BAND EXISTS TO CATCH: no id is reused across bands", () => {
    // Every band merges into one inventory, so an id repeated between two of
    // them silently loses one. Ordinals are exempt -- they are positions WITHIN
    // a band, so A1.1 and A2.1 are different lessons and both are correct.
    const seenLesson = new Map<string, string>();
    const seenCompetency = new Map<string, string>();
    const collisions: string[] = [];
    for (const band of BANDS) {
      for (const l of band.lessons) {
        const prior = seenLesson.get(l.lessonId);
        if (prior) collisions.push(`lesson ${l.lessonId}: ${prior} and ${band.band}`);
        else seenLesson.set(l.lessonId, band.band);
      }
      for (const c of band.competencies) {
        const prior = seenCompetency.get(c.competencyId);
        if (prior) collisions.push(`competency ${c.competencyId}: ${prior} and ${band.band}`);
        else seenCompetency.set(c.competencyId, band.band);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("no lesson name is ambiguous across bands", () => {
    // A collision is a signal that a name is too vague, not that the key needs
    // widening. A1's health lesson and A2's health lesson are not one topic at
    // two levels -- one names the body and says it hurts, the other describes
    // illness over time -- so they get names that say which is which.
    //
    // This matters past tidiness: the lesson name is what the TEACHER reads to
    // match a scene. Two lessons both called "Travel" are ambiguous to it too.
    const STOPWORDS = new Set(["and", "the", "a", "of", "to", "in"]);
    const words = (name: string) =>
      new Set(
        name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      );
    const ambiguous: string[] = [];
    for (let i = 0; i < BANDS.length; i += 1) {
      for (let j = i + 1; j < BANDS.length; j += 1) {
        for (const x of BANDS[i].lessons) {
          for (const y of BANDS[j].lessons) {
            const shared = [...words(x.displayName)].filter((w) =>
              words(y.displayName).has(w)
            );
            if (shared.length > 0) {
              ambiguous.push(
                `${BANDS[i].band} "${x.displayName}" / ${BANDS[j].band} "${y.displayName}" share: ${shared.join(", ")}`
              );
            }
          }
        }
      }
    }
    expect(ambiguous).toEqual([]);
  });

  it("a higher band advances on a lower one rather than restating it", () => {
    // Two bands describing the same thing in near-identical words is a band
    // that did not actually go anywhere -- and the Teacher, reading both,
    // cannot tell which it should reach for. Caught two real ones: A2 said
    // "describe where they work or study" against A1's "say where they work or
    // study", and B1 restated A2's uncertainty descriptor almost verbatim.
    const STOP = new Set([
      "can", "the", "and", "for", "with", "they", "their", "someone",
      "something", "what", "say", "ask", "describe", "simple", "basic",
      "simply", "about", "that", "have", "them"
    ]);
    const words = (d: string) =>
      new Set(
        d.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w))
      );
    const overlaps: string[] = [];
    for (let i = 0; i < BANDS.length; i += 1) {
      for (let j = i + 1; j < BANDS.length; j += 1) {
        for (const x of BANDS[i].competencies) {
          const wx = words(x.cefrDescriptor);
          for (const y of BANDS[j].competencies) {
            const wy = words(y.cefrDescriptor);
            // Below three content words the ratio stops meaning anything:
            // "Can say please" is one word, so every descriptor containing
            // "please" scores 100% against it.
            if (wx.size < 3 || wy.size < 3) continue;
            const shared = [...wx].filter((w) => wy.has(w)).length;
            if (shared / Math.max(wx.size, wy.size) >= 0.7) {
              overlaps.push(
                `${BANDS[i].band} ${x.competencyId} ~ ${BANDS[j].band} ${y.competencyId}`
              );
            }
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("a band's competencies all name a lesson from that same band", () => {
    // A competency reaching across into another band's lesson would put it in
    // the wrong place in the prompt and break the band window later.
    for (const band of BANDS) {
      const own = new Set(band.lessons.map((l) => l.lessonId));
      const strays = band.competencies
        .filter((c) => !own.has(c.lessonId))
        .map((c) => `${band.band}: ${c.competencyId} -> ${c.lessonId}`);
      expect(strays).toEqual([]);
    }
  });
});

describe.each(BANDS.map((b) => [b.band, b] as const))(
  "%s holds together",
  (_name, band) => {
    it("every competency names a lesson that exists", () => {
      const known = new Set(band.lessons.map((l) => l.lessonId));
      const orphans = band.competencies
        .filter((c) => !known.has(c.lessonId))
        .map((c) => `${c.competencyId} -> ${c.lessonId}`);
      expect(orphans).toEqual([]);
    });

    it("no competency id repeats", () => {
      // Two entries with one id means one silently wins at load, and which one
      // depends on ordering.
      const ids = band.competencies.map((c) => c.competencyId);
      expect(ids.length).toBe(new Set(ids).size);
    });

    it("no lesson id repeats, and ordinals are unique", () => {
      const ids = band.lessons.map((l) => l.lessonId);
      expect(ids.length).toBe(new Set(ids).size);
      const ordinals = band.lessons.map((l) => l.ordinal);
      expect(ordinals.length).toBe(new Set(ordinals).size);
    });

    it("every lesson has at least one competency", () => {
      // An empty lesson is a heading with nothing under it -- either the
      // competencies were dropped or the lesson should have been.
      const used = new Set(band.competencies.map((c) => c.lessonId));
      expect(band.lessons.filter((l) => !used.has(l.lessonId))).toEqual([]);
    });

    it("no two competencies share a descriptor", () => {
      // The source listed the same ability under both a topic and a mode. Two
      // competencies for one ability means two cards for one skill.
      const seen = new Map<string, string>();
      const collisions: string[] = [];
      for (const c of band.competencies) {
        const key = c.cefrDescriptor.toLowerCase();
        const prior = seen.get(key);
        if (prior) collisions.push(`${prior} / ${c.competencyId}`);
        else seen.set(key, c.competencyId);
      }
      expect(collisions).toEqual([]);
    });
  }
);

describe("shipped ids survive", () => {
  it("THE ONE THAT MATTERS: no shipped competency loses its id silently", () => {
    // Learner cards and teach records are written against these, so a shipped
    // id disappearing has to be a decision somebody made rather than something
    // a reshuffle did. Every departure is recorded here, with what happened to
    // it -- an empty list below would mean the ids were never disturbed.
    //
    // What a departure costs: teach records are keyed by competencyId and
    // orphan. Cards do not -- they are keyed by chunk, so the phrases keep
    // their learner history through any of this.
    const RETIRED: Record<string, string> = {
      // Two phrases, two abilities: "how much is it" and "I'll take it". They
      // are now ask-price and accept-offer.
      buy: "split into ask-price and accept-offer"
    };
    const RENAMED: Record<string, string> = {
      // `ask-what` said nothing on its own, and the id is what the Teacher
      // reads once the prompt drops the descriptors.
      "ask-what": "ask-meaning"
    };

    const authored = new Set(competencies.map((c) => c.competencyId));
    const lost = shippedInventory.competencies
      .map((c) => c.competencyId)
      .filter((id) => !authored.has(id) && !(id in RETIRED) && !(id in RENAMED));
    expect(lost).toEqual([]);

    // A rename has to land somewhere. Recording one without adding it is how a
    // competency quietly disappears while looking accounted for.
    for (const [, to] of Object.entries(RENAMED)) {
      expect(authored.has(to)).toBe(true);
    }
  });

  it("keeps the fields that cannot come from a can-do statement", () => {
    const byId = new Map(competencies.map((c) => [c.competencyId, c] as const));
    const meta = byId.get("meta-language") as Record<string, unknown> | undefined;
    expect(meta?.isItemZero).toBe(true);
    expect(meta?.placementGateBand).toBe("A2");
    for (const [id, category] of [
      ["greet", "greeting"],
      ["thank", "gratitude"],
      ["acknowledge", "acknowledgement"],
      ["farewell", "farewell"]
    ] as const) {
      expect(
        (byId.get(id) as Record<string, unknown> | undefined)
          ?.interpretLexiconCategory
      ).toBe(category);
    }
  });
});
