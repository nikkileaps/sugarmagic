/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/account-tables.ts
 *
 * Purpose: The database tables this plugin owns for a player's learning, and
 *   how its records map into them.
 *
 * TWO TABLES, BECAUSE THEY ARE TWO DIFFERENT THINGS
 *   A player has ONE row of learner state -- their level, how confident the
 *   estimate is, whether placement is done -- and THOUSANDS of rows of words.
 *   Different cardinality, different shape, different questions asked of them.
 *   Putting both in one table as opaque JSON makes "how many B1 words does
 *   this player know" unanswerable without pulling every row and parsing it in
 *   the browser.
 *
 * REAL COLUMNS, NOT A JSON BLOB
 *   Every field the game reasons about is its own typed column, so the
 *   database can index it, constrain it, and answer questions about it. The
 *   spaced-repetition numbers are the whole point of the word table -- they
 *   decide what gets taught next -- and they are meaningless as text.
 *
 * FOUR COLUMNS ARE NOT OURS
 *   `user_id`, `record_key`, `deleted` and `updated_at` belong to the sync
 *   mechanism. It scopes rows to their owner, tombstones deletes so they
 *   survive the next pull, and stamps the time that decides conflicts. This
 *   file must not write them, and there is a check that it does not.
 *
 * Exports:
 *   - SUGARLANG_WORD_TABLE
 *   - SUGARLANG_LEARNER_TABLE
 *   - SUGARLANG_ACCOUNT_MIGRATIONS
 *
 * Implements: Plan 092 story 092.6.3 / 092.6.4
 *
 * Status: active
 */

import type { RemoteTableSpec } from "@sugarmagic/runtime-core";
import type { CEFRBand, LemmaCard } from "../types";
import type {
  CefrPosterior,
  LearnerAssessment
} from "./learner-profile";
import type { PersistedLearnerProfileCore } from "./persistence";

const WORD_TABLE_NAME = "sugarlang_words";
const LEARNER_TABLE_NAME = "sugarlang_learner";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** A row is data from a network, so its text columns are checked rather than
 *  trusted. An unrecognised band reads as the lowest one: over-estimating a
 *  learner teaches them things they cannot follow. */
function asBand(value: unknown): CEFRBand {
  return (BANDS as readonly string[]).includes(String(value))
    ? (value as CEFRBand)
    : "A1";
}

function asAssessmentStatus(value: unknown): LearnerAssessment["status"] {
  return value === "estimated" || value === "evaluated" ? value : "unassessed";
}

/**
 * The stored posterior, with every band present.
 *
 * Filled in per band rather than trusted wholesale: this arrives as json from
 * a network, and a missing band would surface later as arithmetic on
 * `undefined` rather than as a bad read here.
 */
function asPosterior(value: unknown): CefrPosterior {
  const stored = (value ?? {}) as Record<string, unknown>;
  const posterior = {} as CefrPosterior;
  for (const band of BANDS) {
    const weight = (stored[band] ?? {}) as Record<string, unknown>;
    posterior[band] = {
      alpha: num(weight.alpha, 1),
      beta: num(weight.beta, 1)
    };
  }
  return posterior;
}

/**
 * One word a player has met, with the numbers that decide when it is next
 * worth teaching.
 *
 * `record_key` is the lemma id, so it is not repeated as a column of its own.
 */
export const SUGARLANG_WORD_TABLE: RemoteTableSpec<LemmaCard> = {
  tableName: WORD_TABLE_NAME,

  toColumns: (card) => ({
    difficulty: card.difficulty,
    stability: card.stability,
    // `retrievability` is deliberately ABSENT. It is derived from how long it
    // has been since the last review, so storing it would freeze the moment it
    // was calculated and every later read would decay from the wrong instant.
    last_reviewed_at: card.lastReviewedAt,
    review_count: card.reviewCount,
    lapse_count: card.lapseCount,
    cefr_prior_band: card.cefrPriorBand,
    prior_weight: card.priorWeight,
    productive_strength: card.productiveStrength,
    last_produced_at: card.lastProducedAtMs,
    provisional_evidence: card.provisionalEvidence,
    provisional_evidence_first_seen_turn: card.provisionalEvidenceFirstSeenTurn
  }),

  fromColumns: (row) => ({
    lemmaId: String(row.record_key ?? ""),
    difficulty: num(row.difficulty),
    stability: num(row.stability),
    // Rebuilt as "perfectly remembered" and immediately decayed by the read
    // path, which is where retrievability is owned.
    retrievability: 1,
    lastReviewedAt: nullableNum(row.last_reviewed_at),
    reviewCount: num(row.review_count),
    lapseCount: num(row.lapse_count),
    cefrPriorBand: (row.cefr_prior_band ?? "A1") as LemmaCard["cefrPriorBand"],
    priorWeight: num(row.prior_weight),
    productiveStrength: num(row.productive_strength),
    lastProducedAtMs: nullableNum(row.last_produced_at),
    provisionalEvidence: num(row.provisional_evidence),
    provisionalEvidenceFirstSeenTurn: nullableNum(
      row.provisional_evidence_first_seen_turn
    )
  })
};

/**
 * A player's learner state: one row. The level, how it was arrived at, and
 * whether placement is finished.
 *
 * Session signals are NOT here -- they describe one sitting and mean nothing
 * on another device.
 */
export const SUGARLANG_LEARNER_TABLE: RemoteTableSpec<PersistedLearnerProfileCore> =
  {
    tableName: LEARNER_TABLE_NAME,

    toColumns: (core) => ({
      target_language: core.targetLanguage,
      support_language: core.supportLanguage,
      estimated_cefr_band: core.estimatedCefrBand,
      assessment_status: core.assessment.status,
      evaluated_cefr_band: core.assessment.evaluatedCefrBand,
      cefr_confidence: core.assessment.cefrConfidence,
      evaluated_at: core.assessment.evaluatedAtMs,
      // THE EVIDENCE BEHIND THE BAND, and the one thing here that is not a
      // scalar. It is a fixed set of weights per level, read and rewritten
      // whole and never queried by, so a single json column is the honest
      // shape -- unlike the word table, where every number is something the
      // teacher asks questions about.
      //
      // Dropping it would leave a returning player holding a level with
      // nothing supporting it: the next thing they did would update a fresh
      // prior, quietly discarding everything that produced the estimate.
      cefr_posterior: core.cefrPosterior
    }),

    // NO CAST HERE, DELIBERATELY. This was written `as unknown as` once, which
    // told the compiler to trust a value missing two required fields. It built,
    // shipped, and crashed the first conversation on a second device --
    // something read `.map` on the array that was never there. The type is the
    // only thing standing between a column list and a runtime crash, so it has
    // to be allowed to do its job.
    fromColumns: (row): PersistedLearnerProfileCore => ({
      learnerId: String(row.record_key ?? "") as PersistedLearnerProfileCore["learnerId"],
      targetLanguage: String(row.target_language ?? ""),
      supportLanguage: String(row.support_language ?? ""),
      estimatedCefrBand: asBand(row.estimated_cefr_band),
      assessment: {
        status: asAssessmentStatus(row.assessment_status),
        evaluatedCefrBand: row.evaluated_cefr_band
          ? asBand(row.evaluated_cefr_band)
          : null,
        cefrConfidence: num(row.cefr_confidence),
        evaluatedAtMs: nullableNum(row.evaluated_at)
      },
      cefrPosterior: asPosterior(row.cefr_posterior),
      // Both describe ONE sitting, and a sitting does not travel. `currentSession`
      // belongs to the tab that is open; `sessionHistory` is a log that grows
      // without bound and nothing reads across devices today. Carrying either
      // would mean a second machine inheriting a session it was not present for.
      //
      // History is worth keeping eventually -- see the ticket on truncating or
      // compacting it -- but silently syncing an unbounded log is not the way in.
      currentSession: null,
      sessionHistory: []
    })
  };

/**
 * The SQL that creates both tables.
 *
 * A NEW NUMBERED FILE, never an edit to an earlier one: the Supabase CLI
 * records what it has applied by filename version and skips the rest, so
 * editing a file a project already ran changes nothing and reports success.
 */
export const SUGARLANG_ACCOUNT_MIGRATIONS = [
  {
    filename: "0002_sugarlang_learning.sql",
    sql: [
      "-- A player's learner state. One row per player per language pair.",
      `create table if not exists public.${LEARNER_TABLE_NAME} (`,
      "  user_id uuid not null references auth.users(id) on delete cascade,",
      "  record_key text not null,",
      "  target_language text not null,",
      "  support_language text not null,",
      "  estimated_cefr_band text not null,",
      "  assessment_status text not null,",
      "  evaluated_cefr_band text,",
      "  cefr_confidence double precision not null default 0,",
      "  evaluated_at bigint,",
      "  deleted boolean not null default false,",
      "  updated_at timestamptz not null default now(),",
      "  primary key (user_id, record_key)",
      ");",
      "",
      "-- Every word a player has met, with the numbers that schedule it.",
      `create table if not exists public.${WORD_TABLE_NAME} (`,
      "  user_id uuid not null references auth.users(id) on delete cascade,",
      "  -- The lemma id.",
      "  record_key text not null,",
      "  difficulty double precision not null default 0,",
      "  stability double precision not null default 0,",
      "  -- retrievability is NOT stored: it is a function of elapsed time, so a",
      "  -- stored value would decay from whenever it happened to be written.",
      "  last_reviewed_at bigint,",
      "  review_count integer not null default 0,",
      "  lapse_count integer not null default 0,",
      "  cefr_prior_band text not null default 'A1',",
      "  prior_weight double precision not null default 0,",
      "  productive_strength double precision not null default 0,",
      "  last_produced_at bigint,",
      "  provisional_evidence double precision not null default 0,",
      "  provisional_evidence_first_seen_turn integer,",
      "  deleted boolean not null default false,",
      "  updated_at timestamptz not null default now(),",
      "  primary key (user_id, record_key)",
      ");",
      "",
      "-- A sync asks 'what changed since?', so that is what is indexed.",
      `create index if not exists ${LEARNER_TABLE_NAME}_since_idx`,
      `  on public.${LEARNER_TABLE_NAME} (user_id, updated_at);`,
      `create index if not exists ${WORD_TABLE_NAME}_since_idx`,
      `  on public.${WORD_TABLE_NAME} (user_id, updated_at);`,
      "",
      "-- What the teacher asks: which words at this level does this player",
      "-- know? Unanswerable without this if the row were opaque JSON.",
      `create index if not exists ${WORD_TABLE_NAME}_band_idx`,
      `  on public.${WORD_TABLE_NAME} (user_id, cefr_prior_band);`,
      "",
      ...[LEARNER_TABLE_NAME, WORD_TABLE_NAME].flatMap((table) => [
        `alter table public.${table} enable row level security;`,
        "",
        `create policy "users select own ${table}" on public.${table}`,
        "  for select using (auth.uid() = user_id);",
        `create policy "users insert own ${table}" on public.${table}`,
        "  for insert with check (auth.uid() = user_id);",
        `create policy "users update own ${table}" on public.${table}`,
        "  for update using (auth.uid() = user_id);",
        `create policy "users delete own ${table}" on public.${table}`,
        "  for delete using (auth.uid() = user_id);",
        ""
      ]),
      "-- The client never writes updated_at. A device with a wrong clock would",
      "-- otherwise win every conflict it took part in.",
      "create or replace function public.sugarlang_touch_updated_at()",
      "  returns trigger",
      "  language plpgsql",
      "as $$",
      "begin",
      "  new.updated_at = now();",
      "  return new;",
      "end;",
      "$$;",
      "",
      ...[LEARNER_TABLE_NAME, WORD_TABLE_NAME].flatMap((table) => [
        `drop trigger if exists ${table}_touch on public.${table};`,
        `create trigger ${table}_touch`,
        `  before insert or update on public.${table}`,
        "  for each row execute function public.sugarlang_touch_updated_at();",
        ""
      ])
    ].join("\n")
  },
  {
    // A SEPARATE FILE because 0002 has already been applied somewhere, and the
    // CLI skips anything it has a record of -- editing 0002 would change
    // nothing and report success. Every schema change from here gets its own
    // numbered file.
    filename: "0003_sugarlang_learner_posterior.sql",
    sql: [
      "-- The evidence behind a learner's level. Without it a returning player",
      "-- holds a band with nothing supporting it, and the next thing they do",
      "-- updates a fresh prior -- quietly discarding how the estimate was",
      "-- reached.",
      "--",
      "-- json rather than columns: it is a fixed set of weights per level,",
      "-- read and rewritten whole and never queried by. The word table is the",
      "-- opposite case and gets real columns.",
      `alter table public.${LEARNER_TABLE_NAME}`,
      "  add column if not exists cefr_posterior jsonb;",
      ""
    ].join("\n")
  }
];
