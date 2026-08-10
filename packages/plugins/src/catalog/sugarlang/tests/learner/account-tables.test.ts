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

describe("092.6.3 - the migration", () => {
  const sql = SUGARLANG_ACCOUNT_MIGRATIONS.map((m) => m.sql).join("\n");

  it("THE ONE THAT MATTERS: ships as its own numbered file", () => {
    // `supabase db push` skips anything it has already applied, comparing only
    // the filename version. Editing an earlier file changes nothing and
    // reports success.
    expect(SUGARLANG_ACCOUNT_MIGRATIONS).toHaveLength(1);
    expect(SUGARLANG_ACCOUNT_MIGRATIONS[0]!.filename).toMatch(/^\d{4}_.*\.sql$/);
    expect(SUGARLANG_ACCOUNT_MIGRATIONS[0]!.filename).not.toContain("0001");
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
