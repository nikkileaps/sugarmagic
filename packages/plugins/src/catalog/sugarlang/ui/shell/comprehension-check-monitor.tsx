/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/comprehension-check-monitor.tsx
 *
 * Purpose: Renders the Studio-side monitor for Sugarlang comprehension probe activity.
 *
 * Exports:
 *   - ComprehensionCheckMonitor
 *
 * Relationships:
 *   - Depends on the comprehension-monitor telemetry data source.
 *   - Is registered by contributions.ts as an Epic 13 design.section contribution.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 *
 * Status: active
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { PanelSection } from "@sugarmagic/ui";
import {
  ComprehensionMonitorDataSource,
  type ProbeDetail,
  type ProbeSummary,
  type SessionProbeRollup
} from "../../runtime/telemetry/comprehension-monitor-data";
import { IndexedDBTelemetrySink, SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID } from "../../runtime/telemetry/telemetry";

export interface ComprehensionCheckMonitorProps {
  dataSource?: ComprehensionMonitorDataSource;
  initialProbes?: ProbeSummary[];
  initialProbeDetail?: ProbeDetail | null;
  initialSessionRollup?: SessionProbeRollup | null;
}

function createDefaultDataSource(): ComprehensionMonitorDataSource {
  return new ComprehensionMonitorDataSource({
    telemetrySink: new IndexedDBTelemetrySink({
      workspaceId: SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID
    })
  });
}

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function ComprehensionCheckMonitor(
  props: ComprehensionCheckMonitorProps
): ReactElement {
  const dataSource = useMemo(
    () => props.dataSource ?? createDefaultDataSource(),
    [props.dataSource]
  );
  const [probes, setProbes] = useState<ProbeSummary[]>(props.initialProbes ?? []);
  const [selectedProbeId, setSelectedProbeId] = useState<string | null>(
    props.initialProbes?.[0]?.probeId ?? null
  );
  const [detail, setDetail] = useState<ProbeDetail | null>(
    props.initialProbeDetail ?? null
  );
  const [rollup, setRollup] = useState<SessionProbeRollup | null>(
    props.initialSessionRollup ?? null
  );

  useEffect(() => {
    let cancelled = false;
    void dataSource.listRecentProbes().then((result) => {
      if (cancelled) {
        return;
      }
      setProbes(result);
      if (!selectedProbeId && result[0]) {
        setSelectedProbeId(result[0].probeId);
      }
      if (result[0]?.sessionId) {
        void dataSource.getSessionRollup(result[0].sessionId).then((nextRollup) => {
          if (!cancelled) {
            setRollup(nextRollup);
          }
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, selectedProbeId]);

  useEffect(() => {
    if (!selectedProbeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void dataSource.getProbeDetail(selectedProbeId).then((result) => {
      if (!cancelled) {
        setDetail(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, selectedProbeId]);

  return (
    <PanelSection title="Comprehension Check Monitor" icon="🩺">
      <div style={{ display: "grid", gap: "1rem" }}>
        {rollup ? (
          <div style={{ display: "grid", gap: "0.3rem" }}>
            <strong>Session Rollup</strong>
            <span>Probes: {rollup.probeCount}</span>
            <span>Pass: {rollup.passCount}</span>
            <span>Fail: {rollup.failCount}</span>
            <span>Mixed: {rollup.mixedCount}</span>
            <span>Language fallback: {rollup.languageFallbackCount}</span>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: "0.4rem" }}>
          <strong>Recent Probes</strong>
          {probes.length === 0 ? (
            <span style={{ fontSize: "0.9rem", opacity: 0.75 }}>
              No comprehension probes have fired yet.
            </span>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {probes.map((probe) => (
                <button
                  key={probe.probeId}
                  type="button"
                  onClick={() => setSelectedProbeId(probe.probeId)}
                  style={{
                    textAlign: "left",
                    borderRadius: 10,
                    border: "1px solid var(--sm-panel-border)",
                    background:
                      selectedProbeId === probe.probeId
                        ? "rgba(166, 227, 161, 0.16)"
                        : "transparent",
                    padding: "0.55rem 0.7rem",
                    cursor: "pointer"
                  }}
                >
                  <strong>{probe.npcDisplayName ?? probe.npcId ?? "Unknown NPC"}</strong>
                  <div>
                    {probe.triggerReason} · {probe.outcome}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {detail ? (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <strong>Probe Detail</strong>
            <pre>{renderJson(detail.events)}</pre>
          </div>
        ) : null}
      </div>
    </PanelSection>
  );
}
