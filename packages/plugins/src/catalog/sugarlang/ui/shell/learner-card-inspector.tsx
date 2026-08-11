/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/learner-card-inspector.tsx
 *
 * Purpose: Studio panel that reads chunk cards and teach records directly from
 *          IDB without requiring a live game session. Enumerates all
 *          sugarlang-card-store:* databases via indexedDB.databases() so every
 *          learner profile is visible even when Preview is not running.
 *
 * Exports:
 *   - LearnerCardInspector
 *
 * Relationships:
 *   - Registered as a designSection in contributions.ts.
 *   - Reads from the same IDB stores as IndexedDBCardStore ("lemma-cards") and
 *     IndexedDBTeachRecordStore ("teach-records") but without importing those
 *     classes -- direct raw IDB reads so no session context is needed.
 *   - CARD_STORE_DB_NAME_PREFIX / TEACH_RECORD_DB_NAME_PREFIX imported for
 *     database name filtering.
 *
 * Implements: Plan 085 (post-verification fix)
 *
 * Status: active
 */

import { useState, useEffect, useCallback, type ReactElement } from "react";
import { PanelSection } from "@sugarmagic/ui";
import { CARD_STORE_DB_NAME_PREFIX } from "../../runtime/learner";
import { TEACH_RECORD_DB_NAME_PREFIX } from "../../runtime/learner";
import type { LemmaCard } from "../../runtime/learner";
import type { TeachRecord } from "../../runtime/learner";
import { isExponentCardKey } from "../../runtime/inventory/card-display-name";

const LEMMA_CARDS_STORE = "lemma-cards";
const TEACH_RECORDS_STORE = "teach-records";

interface ProfileSnapshot {
  learnerId: string;
  exponentCards: LemmaCard[];
  teachRecords: TeachRecord[];
}

async function readStoreAll<T>(dbName: string, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const getAll = store.getAll();
      getAll.onsuccess = () => {
        db.close();
        resolve(getAll.result as T[]);
      };
      getAll.onerror = () => {
        db.close();
        resolve([]);
      };
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * The learner id out of a storage name, whatever leads it.
 *
 * Slicing a fixed number of characters off the front assumed the name STARTED
 * with the prefix. It does not any more -- the game id comes first -- and the
 * old arithmetic silently produced a mangled id rather than failing.
 */
function learnerIdFromDbName(dbName: string, prefix: string): string {
  const at = dbName.indexOf(prefix);
  if (at < 0) return dbName;
  return dbName.slice(at + prefix.length).replace(/^:/, "");
}

async function loadAllProfiles(): Promise<ProfileSnapshot[]> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") {
    return [];
  }

  const allDbs = await indexedDB.databases();

  // MATCHED ANYWHERE IN THE NAME, NOT AT THE FRONT.
  //
  // These databases lead with the GAME id now (`gameScopedStorageName`), so
  // `{game}:sugarlang-cards:{learnerId}` no longer starts with the prefix this
  // used to test. The panel matched nothing and showed an empty list, which
  // reads exactly like a player who has learned nothing.
  const cardDbNames = allDbs
    .map((d) => d.name ?? "")
    .filter(
      (n) => n.includes(CARD_STORE_DB_NAME_PREFIX) && !n.includes(TEACH_RECORD_DB_NAME_PREFIX)
    );

  const teachDbNames = allDbs
    .map((d) => d.name ?? "")
    .filter((n) => n.includes(TEACH_RECORD_DB_NAME_PREFIX));

  const profileMap = new Map<string, ProfileSnapshot>();

  await Promise.all(
    cardDbNames.map(async (dbName) => {
      const learnerId = learnerIdFromDbName(dbName, CARD_STORE_DB_NAME_PREFIX);
      const allCards = await readStoreAll<LemmaCard>(dbName, LEMMA_CARDS_STORE);
      const exponentCards = allCards.filter((c) => isExponentCardKey(c.lemmaId));
      profileMap.set(learnerId, { learnerId, exponentCards, teachRecords: [] });
    })
  );

  await Promise.all(
    teachDbNames.map(async (dbName) => {
      const learnerId = learnerIdFromDbName(dbName, TEACH_RECORD_DB_NAME_PREFIX);
      const teachRecords = await readStoreAll<TeachRecord>(dbName, TEACH_RECORDS_STORE);
      const existing = profileMap.get(learnerId);
      if (existing) {
        existing.teachRecords = teachRecords;
      } else {
        profileMap.set(learnerId, { learnerId, exponentCards: [], teachRecords });
      }
    })
  );

  return Array.from(profileMap.values()).filter(
    (p) => p.exponentCards.length > 0 || p.teachRecords.length > 0
  );
}

export function LearnerCardInspector(): ReactElement {
  const [profiles, setProfiles] = useState<ProfileSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    loadAllProfiles()
      .then((p) => {
        setProfiles(p);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = !loading && profiles.length === 0 && !error;

  return (
    <PanelSection title="Learner Card Inspector" icon="card_membership">
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "0.25rem 0.6rem",
              borderRadius: "0.25rem",
              border: "1px solid var(--sm-color-surface1, #444)",
              background: "transparent",
              color: "var(--sm-color-subtext, #6c7086)",
              fontSize: "0.7rem",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          {!loading && !error && (
            <span style={{ fontSize: "0.7rem", color: "var(--sm-color-subtext, #6c7086)" }}>
              {profiles.length} profile{profiles.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {error && (
          <div style={{ fontSize: "0.75rem", color: "var(--sm-color-red, #c0392b)" }}>
            {error}
          </div>
        )}

        {isEmpty && (
          <div style={{ fontSize: "0.75rem", color: "var(--sm-color-subtext, #6c7086)" }}>
            No chunk cards or teach records found. Play through a chunk introduction first.
          </div>
        )}

        {profiles.map((profile) => (
          <div
            key={profile.learnerId}
            style={{
              background: "var(--sm-color-surface0, #313244)",
              borderRadius: "0.25rem",
              padding: "0.5rem 0.75rem",
              display: "grid",
              gap: "0.35rem"
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                fontFamily: "var(--sm-font-mono, monospace)",
                color: "var(--sm-color-subtext, #6c7086)",
                wordBreak: "break-all"
              }}
            >
              {profile.learnerId}
            </div>
            <div style={{ fontSize: "0.75rem", fontFamily: "var(--sm-font-mono, monospace)" }}>
              competency cards: {profile.exponentCards.length} | teach records: {profile.teachRecords.length}
            </div>

            {profile.exponentCards.length > 0 && (
              <details style={{ fontSize: "0.72rem" }}>
                <summary
                  style={{ cursor: "pointer", color: "var(--sm-color-subtext, #6c7086)", marginBottom: "0.2rem" }}
                >
                  Chunk cards
                </summary>
                <div
                  style={{
                    fontFamily: "var(--sm-font-mono, monospace)",
                    display: "grid",
                    gap: "0.1rem",
                    paddingLeft: "0.5rem"
                  }}
                >
                  {/* Same unvalidated-IndexedDB caveat as teach records below. */}
                  {profile.exponentCards.map((c, index) => (
                    <div key={`${c.lemmaId ?? "unreadable"}:${index}`}>
                      {c.lemmaId ?? "(unreadable record)"} [{c.cefrPriorBand ?? "?"}] pro{" "}
                      {typeof c.productiveStrength === "number"
                        ? c.productiveStrength.toFixed(2)
                        : "?"}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {profile.teachRecords.length > 0 && (
              <details style={{ fontSize: "0.72rem" }}>
                <summary
                  style={{ cursor: "pointer", color: "var(--sm-color-subtext, #6c7086)", marginBottom: "0.2rem" }}
                >
                  Teach records
                </summary>
                <div
                  style={{
                    fontFamily: "var(--sm-font-mono, monospace)",
                    display: "grid",
                    gap: "0.1rem",
                    paddingLeft: "0.5rem"
                  }}
                >
                  {/*
                    These come straight out of IndexedDB with no validation, so
                    a record written under an older field name reads back with
                    undefined fields -- which React sees as a MISSING key, not a
                    bad one. Index-suffixing the key keeps the warning away, and
                    showing "(unreadable)" makes the stale record visible instead
                    of rendering a blank row. Plan 090.1 renamed functionId ->
                    competencyId with no migration (dev-only), so records written
                    before that read exactly this way; reset learner data to clear.
                  */}
                  {profile.teachRecords.map((r, index) => (
                    <div key={`${r.competencyId ?? "unreadable"}:${index}`}>
                      {r.competencyId ?? "(unreadable record)"} via{" "}
                      {r.realizingChunkId ?? "?"}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </PanelSection>
  );
}
