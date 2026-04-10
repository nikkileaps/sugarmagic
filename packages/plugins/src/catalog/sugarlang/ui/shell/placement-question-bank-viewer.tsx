/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/placement-question-bank-viewer.tsx
 *
 * Purpose: Renders the read-only Studio view for plugin-owned placement question banks.
 *
 * Exports:
 *   - PlacementQuestionBankViewer
 *
 * Relationships:
 *   - Depends on the plugin-owned placement questionnaire data and loader.
 *   - Is registered by contributions.ts as an Epic 12 design.section contribution.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import { PanelSection } from "@sugarmagic/ui";
import type { ReactElement } from "react";
import type { PlacementQuestionnaire } from "../../runtime/types";
import { loadPlacementQuestionBank } from "./editor-support";

export interface PlacementQuestionBankViewerProps {
  targetLanguage: string;
  questionnaire?: PlacementQuestionnaire | null;
}

const BAND_GROUPS = ["A1", "A2", "B1", "B2"] as const;

export function PlacementQuestionBankViewer(
  props: PlacementQuestionBankViewerProps
): ReactElement {
  const questionnaire =
    props.questionnaire ?? loadPlacementQuestionBank(props.targetLanguage);

  return (
    <PanelSection title="Placement Question Bank" icon="📝">
      <div style={{ display: "grid", gap: "1rem" }}>
        {questionnaire ? (
          <>
            <p style={{ margin: 0, color: "var(--sm-color-subtext)" }}>
              {questionnaire.formTitle} · {questionnaire.questions.length} canonical plugin-owned questions for {questionnaire.targetLanguage}.
            </p>
            {BAND_GROUPS.map((band) => {
              const questions = questionnaire.questions.filter(
                (question) => question.targetBand === band
              );
              if (questions.length === 0) {
                return null;
              }

              return (
                <div key={band} style={{ display: "grid", gap: "0.5rem" }}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: "var(--sm-color-subtext)"
                    }}
                  >
                    {band}
                  </span>
                  {questions.map((question) => (
                    <div
                      key={question.questionId}
                      style={{
                        border: "1px solid var(--sm-panel-border)",
                        borderRadius: "var(--sm-radius-md)",
                        background: "var(--sm-color-surface2)",
                        padding: "0.75rem",
                        display: "grid",
                        gap: "0.35rem"
                      }}
                    >
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            borderRadius: 999,
                            background: "rgba(137, 180, 250, 0.18)",
                            padding: "0.15rem 0.45rem",
                            fontSize: "0.75rem",
                            fontWeight: 600
                          }}
                        >
                          {question.kind}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
                          {question.questionId}
                        </span>
                      </div>
                      <span>{question.promptText}</span>
                      {question.supportText ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
                          Support: {question.supportText}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
              Per-project and per-NPC questionnaire overrides are a future feature. V1 reads the canonical plugin-shipped bank only.
            </p>
          </>
        ) : (
          <p style={{ margin: 0, color: "var(--sm-color-subtext)" }}>
            No shipped placement questionnaire is available for target language "{props.targetLanguage}".
          </p>
        )}
      </div>
    </PanelSection>
  );
}
