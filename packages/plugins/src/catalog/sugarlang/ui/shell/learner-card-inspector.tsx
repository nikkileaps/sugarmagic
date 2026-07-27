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
import { CARD_STORE_DB_NAME_PREFIX } from "../../runtime/learner/card-store";
import { TEACH_RECORD_DB_NAME_PREFIX } from "../../runtime/learner/teach-record-store";
import type { LemmaCard } from "../../runtime/contracts/learner-profile";
import type { TeachRecord } from "../../runtime/learner/teach-record-store";

const LEMMA_CARDS_STORE = "lemma-cards";
const TEACH_RECORDS_STORE = "teach-records";

interface ProfileSnapshot {
  learnerId: string;
  chunkCards: LemmaCard[];
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

async function loadAllProfiles(): Promise<ProfileSnapshot[]> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") {
    return [];
  }

  const allDbs = await indexedDB.databases();

  const cardDbNames = allDbs
    .map((d) => d.name ?? "")
    .filter((n) => n.startsWith(CARD_STORE_DB_NAME_PREFIX) && !n.startsWith(TEACH_RECORD_DB_NAME_PREFIX));

  const teachDbNames = allDbs
    .map((d) => d.name ?? "")
    .filter((n) => n.startsWith(TEACH_RECORD_DB_NAME_PREFIX));

  const profileMap = new Map<string, ProfileSnapshot>();

  await Promise.all(
    cardDbNames.map(async (dbName) => {
      const learnerId = dbName.slice(CARD_STORE_DB_NAME_PREFIX.length + 1);
      const allCards = await readStoreAll<LemmaCard>(dbName, LEMMA_CARDS_STORE);
      const chunkCards = allCards.filter((c) => c.lemmaId.startsWith("chunk:"));
      profileMap.set(learnerId, { learnerId, chunkCards, teachRecords: [] });
    })
  );

  await Promise.all(
    teachDbNames.map(async (dbName) => {
      const learnerId = dbName.slice(TEACH_RECORD_DB_NAME_PREFIX.length);
      const teachRecords = await readStoreAll<TeachRecord>(dbName, TEACH_RECORDS_STORE);
      const existing = profileMap.get(learnerId);
      if (existing) {
        existing.teachRecords = teachRecords;
      } else {
        profileMap.set(learnerId, { learnerId, chunkCards: [], teachRecords });
      }
    })
  );

  return Array.from(profileMap.values()).filter(
    (p) => p.chunkCards.length > 0 || p.teachRecords.length > 0
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
              chunk cards: {profile.chunkCards.length} | teach records: {profile.teachRecords.length}
            </div>

            {profile.chunkCards.length > 0 && (
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
                  {profile.chunkCards.map((c) => (
                    <div key={c.lemmaId}>
                      {c.lemmaId} [{c.cefrPriorBand}] pro {c.productiveStrength.toFixed(2)}
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
                  {profile.teachRecords.map((r) => (
                    <div key={r.functionId}>
                      {r.functionId} via {r.realizingChunkId}
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
