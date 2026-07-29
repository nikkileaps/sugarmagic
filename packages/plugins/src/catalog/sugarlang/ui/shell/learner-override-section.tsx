/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/learner-override-section.tsx
 *
 * Purpose: Studio debug panel for overriding the learner's estimated CEFR band
 *          without going through the placement flow. Dev-only — works by calling
 *          window.__sugarlangDebug, which is only registered in DEV builds.
 *
 * Exports:
 *   - LearnerOverrideSection
 *
 * Relationships:
 *   - Registered as a design.section contribution in contributions.ts.
 *   - Calls window.__sugarlangDebug (registered in manifest.ts init, DEV only).
 *
 * Implements: Plan 081 story 081.7
 *
 * Status: active
 */

import { useState, useEffect, type ReactElement } from "react";
import { PanelSection } from "@sugarmagic/ui";
import type { SugarlangDebugState } from "../../runtime/runtime-services";

const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

interface DebugHandle {
  setBand: (band: string, pin?: boolean) => Promise<void>;
  reset: () => Promise<void>;
  getState: () => Promise<SugarlangDebugState | null>;
}

function getDebugHandle(): DebugHandle | null {
  return (globalThis as { __sugarlangDebug?: DebugHandle }).__sugarlangDebug ?? null;
}

export function LearnerOverrideSection(): ReactElement {
  const [selectedBand, setSelectedBand] = useState<string>("B1");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<SugarlangDebugState | null>(null);
  const [noHandle, setNoHandle] = useState(false);

  useEffect(() => {
    const handle = getDebugHandle();
    if (!handle) {
      setNoHandle(true);
      return;
    }
    handle.getState().then(setState).catch(() => setState(null));
  }, []);

  const refresh = () => {
    getDebugHandle()?.getState().then(setState).catch(() => setState(null));
  };

  const handleSet = () => {
    const handle = getDebugHandle();
    if (!handle) return;
    setBusy(true);
    handle.setBand(selectedBand, pin).then(() => {
      refresh();
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  const handleReset = () => {
    const handle = getDebugHandle();
    if (!handle) return;
    setBusy(true);
    handle.reset().then(() => {
      refresh();
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  if (noHandle) {
    return (
      <PanelSection title="Learner Override" icon="🎓">
        <div style={{ fontSize: "0.75rem", color: "var(--sm-color-subtext)", padding: "0.5rem 0" }}>
          __sugarlangDebug not registered. Run in DEV mode with a game loaded.
        </div>
      </PanelSection>
    );
  }

  return (
    <PanelSection title="Learner Override" icon="🎓">
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Band</label>
        <select
          value={selectedBand}
          onChange={(e) => setSelectedBand(e.target.value)}
          style={{
            padding: "0.3rem 0.5rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-surface1, #444)",
            background: "var(--sm-color-base, #1e1e2e)",
            color: "var(--sm-color-text, #cdd6f4)",
            fontSize: "0.8rem"
          }}
        >
          {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <label
          style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={pin}
            onChange={(e) => setPin(e.target.checked)}
            style={{ accentColor: "var(--sm-color-blue, #89b4fa)" }}
          />
          Pin
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={handleSet}
          style={{
            padding: "0.3rem 0.75rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-blue, #89b4fa)",
            background: "transparent",
            color: "var(--sm-color-blue, #89b4fa)",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.5 : 1
          }}
        >
          Set Band
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleReset}
          style={{
            padding: "0.3rem 0.75rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-red, #c0392b)",
            background: "transparent",
            color: "var(--sm-color-red, #c0392b)",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.5 : 1
          }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={refresh}
          style={{
            padding: "0.3rem 0.5rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-surface1, #444)",
            background: "transparent",
            color: "var(--sm-color-subtext, #6c7086)",
            fontSize: "0.7rem",
            cursor: "pointer"
          }}
        >
          Refresh
        </button>
      </div>

      {state ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div
            style={{
              background: "var(--sm-color-surface0, #313244)",
              borderRadius: "0.25rem",
              padding: "0.5rem 0.75rem",
              display: "grid",
              gap: "0.2rem",
              fontSize: "0.75rem",
              fontFamily: "var(--sm-font-mono, monospace)"
            }}
          >
            <div>band: <strong>{state.pinnedBand ?? state.estimatedCefrBand}</strong>{state.pinned ? " (pinned)" : ""}</div>
            <div>assessment: {state.assessmentStatus} ({(state.cefrConfidence * 100).toFixed(0)}%)</div>
            <div>placement: {state.placementStatus}</div>
            <div>calibration: {state.inCalibration ? "open" : "closed"}</div>
            <div>lemma cards: {state.lemmaCards.length} | chunk cards: {state.chunkCards.length} | teach records: {state.teachRecords.length}</div>
          </div>
          {state.chunkCards.length > 0 && (
            <details style={{ fontSize: "0.72rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--sm-color-subtext, #6c7086)", marginBottom: "0.25rem" }}>
                Chunk cards ({state.chunkCards.length})
              </summary>
              <div style={{ fontFamily: "var(--sm-font-mono, monospace)", display: "grid", gap: "0.15rem", paddingLeft: "0.5rem" }}>
                {state.chunkCards.map((c) => (
                  <div key={c.lemmaId}>{c.lemmaId} [{c.cefrPriorBand}] pro {c.productiveStrength.toFixed(2)}</div>
                ))}
              </div>
            </details>
          )}
          {state.teachRecords.length > 0 && (
            <details style={{ fontSize: "0.72rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--sm-color-subtext, #6c7086)", marginBottom: "0.25rem" }}>
                Teach records ({state.teachRecords.length})
              </summary>
              <div style={{ fontFamily: "var(--sm-font-mono, monospace)", display: "grid", gap: "0.15rem", paddingLeft: "0.5rem" }}>
                {state.teachRecords.map((r) => (
                  <div key={r.competencyId}>{r.competencyId} via {r.realizingChunkId}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div style={{ fontSize: "0.75rem", color: "var(--sm-color-subtext)" }}>
          No state - start a game first, then Refresh.
        </div>
      )}
    </div>
    </PanelSection>
  );
}
