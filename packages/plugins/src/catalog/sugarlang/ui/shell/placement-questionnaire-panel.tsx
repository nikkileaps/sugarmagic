/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/placement-questionnaire-panel.tsx
 *
 * Purpose: Renders the plugin-owned placement questionnaire form as a reusable React UI primitive.
 *
 * Exports:
 *   - PlacementQuestionnairePanel
 *   - createPlacementQuestionnaireResponse
 *   - setPlacementQuestionnaireAnswer
 *   - countAnsweredPlacementAnswers
 *   - canSubmitPlacementQuestionnaire
 *
 * Relationships:
 *   - Depends on sugarlang placement contract types.
 *   - Provides the Studio-side twin of the runtime dialogue questionnaire renderer.
 *
 * Implements: Proposal 001 §Cold Start Sequence / Epic 11 Story 11.2
 *
 * Status: active
 */

import { useId, useState, type FormEvent, type ReactElement } from "react";
import type {
  PlacementAnswer,
  PlacementQuestionnaire,
  PlacementQuestionnaireResponse
} from "../../runtime/types";

export interface PlacementQuestionnairePanelProps {
  questionnaire: PlacementQuestionnaire;
  onSubmit: (response: PlacementQuestionnaireResponse) => void;
  onSkip?: (questionId: string) => void;
}

export function createPlacementQuestionnaireResponse(
  questionnaire: PlacementQuestionnaire
): PlacementQuestionnaireResponse {
  return {
    questionnaireId: `${questionnaire.lang}-placement-v${questionnaire.schemaVersion}`,
    submittedAtMs: 0,
    answers: {}
  };
}

export function setPlacementQuestionnaireAnswer(
  response: PlacementQuestionnaireResponse,
  questionId: string,
  answer: PlacementAnswer
): PlacementQuestionnaireResponse {
  return {
    ...response,
    answers: {
      ...response.answers,
      [questionId]: answer
    }
  };
}

export function countAnsweredPlacementAnswers(
  response: PlacementQuestionnaireResponse
): number {
  return Object.values(response.answers).filter((answer) => answer.kind !== "skipped")
    .length;
}

export function canSubmitPlacementQuestionnaire(
  questionnaire: PlacementQuestionnaire,
  response: PlacementQuestionnaireResponse
): boolean {
  return (
    countAnsweredPlacementAnswers(response) >= questionnaire.minAnswersForValid
  );
}

function buildFillInBlankFragments(sentenceTemplate: string): [string, string] {
  const [prefix, suffix = ""] = sentenceTemplate.split("___", 2);
  return [prefix ?? "", suffix];
}

export function PlacementQuestionnairePanel(
  props: PlacementQuestionnairePanelProps
): ReactElement {
  const panelId = useId();
  const [response, setResponse] = useState<PlacementQuestionnaireResponse>(() =>
    createPlacementQuestionnaireResponse(props.questionnaire)
  );

  function updateAnswer(questionId: string, answer: PlacementAnswer): void {
    setResponse((current) =>
      setPlacementQuestionnaireAnswer(current, questionId, answer)
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmitPlacementQuestionnaire(props.questionnaire, response)) {
      return;
    }

    props.onSubmit({
      ...response,
      submittedAtMs: Date.now()
    });
  }

  return (
    <form
      aria-labelledby={`${panelId}-title`}
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gap: "1rem",
        padding: "1.25rem",
        borderRadius: "18px",
        border: "1px solid rgba(104, 73, 33, 0.25)",
        background:
          "linear-gradient(180deg, rgba(244, 233, 203, 0.98), rgba(227, 208, 171, 0.96))",
        boxShadow: "0 14px 32px rgba(62, 41, 12, 0.18)",
        color: "#3d2711"
      }}
    >
      <header style={{ display: "grid", gap: "0.35rem" }}>
        <h2
          id={`${panelId}-title`}
          style={{ margin: 0, fontSize: "1.35rem", lineHeight: 1.1 }}
        >
          {props.questionnaire.formTitle}
        </h2>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{props.questionnaire.formIntro}</p>
      </header>

      {props.questionnaire.questions.map((question) => {
        const answer = response.answers[question.questionId];
        const [prefix, suffix] =
          question.kind === "fill-in-blank"
            ? buildFillInBlankFragments(question.sentenceTemplate)
            : ["", ""];

        return (
          <section
            key={question.questionId}
            style={{
              display: "grid",
              gap: "0.65rem",
              padding: "0.95rem",
              borderRadius: "14px",
              background: "rgba(255, 250, 239, 0.72)",
              border: "1px solid rgba(104, 73, 33, 0.16)"
            }}
          >
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <strong>{question.promptText}</strong>
              {question.supportText ? (
                <span style={{ fontSize: "0.92rem", opacity: 0.8 }}>
                  {question.supportText}
                </span>
              ) : null}
            </div>

            {question.kind === "multiple-choice" ? (
              <div style={{ display: "grid", gap: "0.45rem" }}>
                {question.options.map((option) => (
                  <label
                    key={option.optionId}
                    style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
                  >
                    <input
                      type="radio"
                      name={question.questionId}
                      checked={
                        answer?.kind === "multiple-choice" &&
                        answer.optionId === option.optionId
                      }
                      onChange={() =>
                        updateAnswer(question.questionId, {
                          kind: "multiple-choice",
                          optionId: option.optionId
                        })
                      }
                    />
                    <span>{option.text}</span>
                  </label>
                ))}
              </div>
            ) : null}

            {question.kind === "yes-no" ? (
              <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
                {[
                  { value: "yes" as const, label: question.yesLabel },
                  { value: "no" as const, label: question.noLabel }
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      updateAnswer(question.questionId, {
                        kind: "yes-no",
                        answer: option.value
                      })
                    }
                    style={{
                      padding: "0.65rem 0.9rem",
                      borderRadius: "999px",
                      border: "1px solid rgba(104, 73, 33, 0.25)",
                      background:
                        answer?.kind === "yes-no" && answer.answer === option.value
                          ? "rgba(122, 80, 33, 0.18)"
                          : "rgba(255,255,255,0.7)",
                      cursor: "pointer"
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            {question.kind === "free-text" ? (
              <textarea
                rows={3}
                value={answer?.kind === "free-text" ? answer.text : ""}
                placeholder={question.supportText ?? ""}
                onChange={(event) =>
                  updateAnswer(question.questionId, {
                    kind: "free-text",
                    text: event.target.value
                  })
                }
                style={{
                  width: "100%",
                  minHeight: "4.75rem",
                  padding: "0.7rem 0.8rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(104, 73, 33, 0.2)",
                  resize: "vertical"
                }}
              />
            ) : null}

            {question.kind === "fill-in-blank" ? (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap"
                }}
              >
                <span>{prefix}</span>
                <input
                  type="text"
                  value={answer?.kind === "fill-in-blank" ? answer.text : ""}
                  onChange={(event) =>
                    updateAnswer(question.questionId, {
                      kind: "fill-in-blank",
                      text: event.target.value
                    })
                  }
                  style={{
                    minWidth: "9rem",
                    padding: "0.55rem 0.7rem",
                    borderRadius: "10px",
                    border: "1px solid rgba(104, 73, 33, 0.2)"
                  }}
                />
                <span>{suffix}</span>
              </label>
            ) : null}

            <div>
              <button
                type="button"
                onClick={() => {
                  updateAnswer(question.questionId, { kind: "skipped" });
                  props.onSkip?.(question.questionId);
                }}
                style={{
                  padding: "0.45rem 0.75rem",
                  borderRadius: "999px",
                  border: "1px solid rgba(104, 73, 33, 0.18)",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer"
                }}
              >
                Skip this one
              </button>
            </div>
          </section>
        );
      })}

      <footer
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <span style={{ fontSize: "0.9rem", opacity: 0.8 }}>
          Answer at least {props.questionnaire.minAnswersForValid} questions to submit.
        </span>
        <button
          type="submit"
          disabled={!canSubmitPlacementQuestionnaire(props.questionnaire, response)}
          style={{
            padding: "0.7rem 1rem",
            borderRadius: "999px",
            border: "1px solid rgba(104, 73, 33, 0.2)",
            background: "#7a5021",
            color: "#fff9ef",
            cursor: canSubmitPlacementQuestionnaire(props.questionnaire, response)
              ? "pointer"
              : "not-allowed",
            opacity: canSubmitPlacementQuestionnaire(props.questionnaire, response)
              ? 1
              : 0.55
          }}
        >
          Submit form
        </button>
      </footer>
    </form>
  );
}
