/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/account-tables.test.ts
 *
 * Purpose: This plugin's per-account tables and the migration that creates
 *   them (Plan 092.6.3 / 092.6.4).
 *
 * WHAT THIS IS PROTECTING
 *   The first version of this put every plugin's data into one shared table as
 *   opaque JSON, which made the database unable to index, constrain or answer
 *   anything about it. The tables here have real columns; these tests pin that
 *   a word survives the round trip through them, that the mechanism's own
 *   columns are not written by this plugin, and that the migration ships as
 *   its own numbered file.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  SUGARLANG_ACCOUNT_MIGRATIONS,
  SUGARLANG_LEARNER_TABLE,
  SUGARLANG_WORD_TABLE
} from "../../runtime/learner/account-tables";
import type { LemmaCard } from "../../runtime/types";

const card: LemmaCard = {
  lemmaId: "riconoscere",
  difficulty: 5.5,
  stability: 12.25,
  retrievability: 0.87,
  lastReviewedAt: 1_786_000_000_000,
  reviewCount: 12,
  lapseCount: 1,
  cefrPriorBand: "B1",
  priorWeight: 0.5,
  productiveStrength: 0.42,
  lastProducedAtMs: 1_786_000_000_000,
  provisionalEvidence: 2,
  provisionalEvidenceFirstSeenTurn: 41
};

const RESERVED = ["user_id", "record_key", "deleted", "updated_at"];

describe("092.6.3 - sugarlang's tables have real columns", () => {
  it("THE ONE THAT MATTERS: a word survives the round trip through columns", () => {
    const row = { ...SUGARLANG_WORD_TABLE.toColumns(card), record_key: card.lemmaId };
    const back = SUGARLANG_WORD_TABLE.fromColumns(row);

    expect(back.lemmaId).toBe("riconoscere");
    expect(back.difficulty).toBe(5.5);
    expect(back.stability).toBe(12.25);
    expect(back.reviewCount).toBe(12);
    expect(back.lapseCount).toBe(1);
    expect(back.cefrPriorBand).toBe("B1");
    expect(back.lastReviewedAt).toBe(1_786_000_000_000);
    expect(back.provisionalEvidenceFirstSeenTurn).toBe(41);
  });

  it("the scheduling numbers are their own columns, not a JSON blob", () => {
    // They decide what gets taught next; as text the database cannot index or
    // constrain any of them.
    const columns = SUGARLANG_WORD_TABLE.toColumns(card);
    for (const column of ["difficulty", "stability", "review_count", "cefr_prior_band"]) {
      expect(columns).toHaveProperty(column);
    }
    expect(Object.values(columns).some((v) => typeof v === "object" && v !== null)).toBe(
      false
    );
  });

  it("retrievability is NOT stored", () => {
    // It is a function of elapsed time. A stored value would decay from
    // whenever it happened to be written rather than from the last review.
    expect(SUGARLANG_WORD_TABLE.toColumns(card)).not.toHaveProperty("retrievability");
  });

  it("neither table writes a column the sync mechanism owns", () => {
    // Writing updated_at would let a device with a wrong clock win every
    // conflict; writing user_id would let it write into another account.
    const wordColumns = Object.keys(SUGARLANG_WORD_TABLE.toColumns(card));
    for (const reserved of RESERVED) expect(wordColumns).not.toContain(reserved);

    const core = {
      learnerId: "x",
      targetLanguage: "it",
      supportLanguage: "en",
      estimatedCefrBand: "B1",
      assessment: {
        status: "evaluated",
        evaluatedCefrBand: "B1",
        cefrConfidence: 0.9,
        evaluatedAtMs: 1
      }
    } as never;
    const learnerColumns = Object.keys(SUGARLANG_LEARNER_TABLE.toColumns(core));
    for (const reserved of RESERVED) expect(learnerColumns).not.toContain(reserved);
  });

  it("the level and the words are SEPARATE tables", () => {
    // One row versus thousands, different shapes, different questions.
    expect(SUGARLANG_LEARNER_TABLE.tableName).not.toBe(SUGARLANG_WORD_TABLE.tableName);
  });
});

describe("092.6.4 - the learner core round-trips completely", () => {
  it("THE ONE THAT MATTERS: every field the profile needs comes back", async () => {
    // Two were missing once -- the mapping was forced through with a double
    // cast, so the compiler could not object -- and the first conversation on
    // a second device crashed reading `.map` of undefined.
    const row = {
      record_key: "user:player:es:en",
      target_language: "es",
      support_language: "en",
      estimated_cefr_band: "B1",
      assessment_status: "evaluated",
      evaluated_cefr_band: "B1",
      cefr_confidence: 0.8,
      evaluated_at: 1_700_000_000_000,
      cefr_posterior: { A1: { alpha: 4, beta: 2 } }
    };
    const core = SUGARLANG_LEARNER_TABLE.fromColumns(row);

    expect(core.estimatedCefrBand).toBe("B1");
    expect(core.assessment.status).toBe("evaluated");
    // The two that were missing:
    expect(Array.isArray(core.sessionHistory)).toBe(true);
    expect(core.cefrPosterior).toBeDefined();
  });

  it("the evidence behind the band survives, not just the band", () => {
    // Without it a returning player holds a level with nothing supporting it,
    // and the next observation updates a fresh prior.
    const posterior = SUGARLANG_LEARNER_TABLE.toColumns({
      cefrPosterior: { A1: { alpha: 7, beta: 3 } },
      assessment: {}
    } as never).cefr_posterior as Record<string, { alpha: number }>;
    expect(posterior.A1!.alpha).toBe(7);

    const back = SUGARLANG_LEARNER_TABLE.fromColumns({
      cefr_posterior: { A1: { alpha: 7, beta: 3 } }
    });
    expect(back.cefrPosterior.A1).toEqual({ alpha: 7, beta: 3 });
  });

  it("a band missing from the stored posterior is filled in, not left undefined", () => {
    // It arrives as json from a network. A gap would surface later as
    // arithmetic on undefined rather than as a bad read here.
    const back = SUGARLANG_LEARNER_TABLE.fromColumns({ cefr_posterior: {} });
    for (const band of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      expect(back.cefrPosterior[band as keyof typeof back.cefrPosterior]).toEqual({
        alpha: 1,
        beta: 1
      });
    }
  });

  it("junk in a text column reads as the SAFEST value, not as itself", () => {
    // Over-estimating a learner teaches them things they cannot follow.
    const back = SUGARLANG_LEARNER_TABLE.fromColumns({
      estimated_cefr_band: "not-a-band",
      assessment_status: "nonsense"
    });
    expect(back.estimatedCefrBand).toBe("A1");
    expect(back.assessment.status).toBe("unassessed");
  });

  it("a sitting does not travel between devices", () => {
    const back = SUGARLANG_LEARNER_TABLE.fromColumns({});
    expect(back.currentSession).toBeNull();
    expect(back.sessionHistory).toEqual([]);
  });
});

describe("092.6.3 - the migration", () => {
  const sql = SUGARLANG_ACCOUNT_MIGRATIONS.map((m) => m.sql).join("\n");

  it("THE ONE THAT MATTERS: every change is its own numbered file, in order", () => {
    // `supabase db push` skips anything it has already applied, comparing only
    // the filename version. Editing an earlier file changes nothing and
    // reports success -- so a schema change has to arrive as a NEW file that
    // sorts after the ones already out there.
    const names = SUGARLANG_ACCOUNT_MIGRATIONS.map((m) => m.filename);

    for (const name of names) {
      expect(name).toMatch(/^\d{4}_.*\.sql$/);
      // 0001 belongs to the account plugin's own schema.
      expect(name.startsWith("0001")).toBe(false);
    }
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
  });

  it("a column added later comes as a new file, not an edit to an old one", () => {
    // The posterior was added after 0002 had been applied. Putting it there
    // would have been a silent no-op on every project that already ran it.
    const first = SUGARLANG_ACCOUNT_MIGRATIONS[0]!;
    expect(first.sql).not.toContain("cefr_posterior");

    const later = SUGARLANG_ACCOUNT_MIGRATIONS.slice(1)
      .map((m) => m.sql)
      .join("\n");
    expect(later).toContain("add column if not exists cefr_posterior");
  });

  it("creates both tables with the four columns the mechanism requires", () => {
    for (const table of [
      SUGARLANG_LEARNER_TABLE.tableName,
      SUGARLANG_WORD_TABLE.tableName
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
    for (const column of ["user_id", "record_key", "deleted", "updated_at"]) {
      expect(sql).toContain(column);
    }
  });

  it("scopes every row to its owner", () => {
    // Without this any signed-in player could read every other player's rows.
    for (const table of [
      SUGARLANG_LEARNER_TABLE.tableName,
      SUGARLANG_WORD_TABLE.tableName
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("auth.uid() = user_id");
  });

  it("lets the database stamp the time, not the client", () => {
    expect(sql).toContain("new.updated_at = now()");
    expect(sql).toContain("before insert or update");
  });

  it("indexes what is actually asked: what changed, and which band", () => {
    expect(sql).toContain("(user_id, updated_at)");
    expect(sql).toContain("cefr_prior_band)");
  });
});
