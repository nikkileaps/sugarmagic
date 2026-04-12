/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/sugarlang-turn-inspector.tsx
 *
 * Purpose: Renders the Studio-side Sugarlang turn inspector over persisted telemetry traces.
 *
 * Exports:
 *   - SugarlangTurnInspector
 *
 * Relationships:
 *   - Depends on the telemetry debug-panel data source.
 *   - Is registered by contributions.ts as an Epic 13 design.section contribution.
 *
 * Implements: Proposal 001 §Verification and Acceptance
 *
 * Status: active
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { PanelSection } from "@sugarmagic/ui";
import {
  DebugPanelDataSource,
  type ConversationSummary,
  type TurnSummary
} from "../../runtime/telemetry/debug-panel-data";
import { IndexedDBTelemetrySink, SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID } from "../../runtime/telemetry/telemetry";
import type { RationaleTrace } from "../../runtime/telemetry/rationale-trace";

export interface SugarlangTurnInspectorProps {
  dataSource?: DebugPanelDataSource;
  initialConversations?: ConversationSummary[];
  initialTurns?: TurnSummary[];
  initialTrace?: RationaleTrace | null;
}

function createDefaultDataSource(): DebugPanelDataSource {
  return new DebugPanelDataSource({
    telemetrySink: new IndexedDBTelemetrySink({
      workspaceId: SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID
    })
  });
}

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function SugarlangTurnInspector(
  props: SugarlangTurnInspectorProps
): ReactElement {
  const dataSource = useMemo(
    () => props.dataSource ?? createDefaultDataSource(),
    [props.dataSource]
  );
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    props.initialConversations ?? []
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    props.initialConversations?.[0]?.conversationId ?? null
  );
  const [turns, setTurns] = useState<TurnSummary[]>(props.initialTurns ?? []);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(
    props.initialTurns?.[0]?.turnId ?? null
  );
  const [trace, setTrace] = useState<RationaleTrace | null>(
    props.initialTrace ?? null
  );

  useEffect(() => {
    let cancelled = false;
    void dataSource.listRecentConversations().then((result) => {
      if (cancelled) {
        return;
      }
      setConversations(result);
      if (!selectedConversationId && result[0]) {
        setSelectedConversationId(result[0].conversationId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setTurns([]);
      return;
    }
    let cancelled = false;
    void dataSource.listTurnsInConversation(selectedConversationId).then((result) => {
      if (cancelled) {
        return;
      }
      setTurns(result);
      if (!selectedTurnId && result[0]) {
        setSelectedTurnId(result[0].turnId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, selectedConversationId, selectedTurnId]);

  useEffect(() => {
    if (!selectedConversationId || !selectedTurnId) {
      setTrace(null);
      return;
    }
    let cancelled = false;
    void dataSource
      .getTurnRationale(selectedConversationId, selectedTurnId)
      .then((result) => {
        if (!cancelled) {
          setTrace(result);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, selectedConversationId, selectedTurnId]);

  return (
    <PanelSection title="Sugarlang Turn Inspector" icon="🧭">
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <strong>Recent Conversations</strong>
          {conversations.length === 0 ? (
            <span style={{ fontSize: "0.9rem", opacity: 0.75 }}>
              No Sugarlang telemetry has been recorded yet.
            </span>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {conversations.map((conversation) => (
                <button
                  key={conversation.conversationId}
                  type="button"
                  onClick={() => {
                    setSelectedConversationId(conversation.conversationId);
                    setSelectedTurnId(null);
                  }}
                  style={{
                    borderRadius: 999,
                    border: "1px solid var(--sm-panel-border)",
                    background:
                      selectedConversationId === conversation.conversationId
                        ? "var(--sm-accent-blue)"
                        : "transparent",
                    color:
                      selectedConversationId === conversation.conversationId
                        ? "white"
                        : "inherit",
                    padding: "0.45rem 0.75rem",
                    cursor: "pointer"
                  }}
                >
                  {conversation.conversationId} ({conversation.turnCount} turns)
                </button>
              ))}
            </div>
          )}
        </div>

        {turns.length > 0 ? (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <strong>Turns</strong>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {turns.map((turn) => (
                <button
                  key={turn.turnId}
                  type="button"
                  onClick={() => setSelectedTurnId(turn.turnId)}
                  style={{
                    borderRadius: 10,
                    border: "1px solid var(--sm-panel-border)",
                    background:
                      selectedTurnId === turn.turnId
                        ? "rgba(137, 180, 250, 0.18)"
                        : "transparent",
                    padding: "0.4rem 0.7rem",
                    cursor: "pointer"
                  }}
                >
                  {turn.turnId}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {trace ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <strong>Turn Context</strong>
              <pre>{renderJson(trace.turnContext)}</pre>
            </div>
            <div>
              <strong>Prescription</strong>
              <pre>{renderJson(trace.prescription)}</pre>
            </div>
            <div>
              <strong>Directive</strong>
              <pre>{renderJson(trace.directive)}</pre>
            </div>
            <div>
              <strong>Classifier Verdict</strong>
              <pre>{renderJson(trace.verdict)}</pre>
            </div>
            <div>
              <strong>Observations</strong>
              <pre>{renderJson(trace.observations)}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </PanelSection>
  );
}
