/**
 * targets/web/src/ui/QuestFormOverlay.tsx
 *
 * Full-screen quest form overlay -- 081.8.
 *
 * Renders a QuestFormDefinition as a document-style form over the full
 * viewport. Sits above the dialogue panel (GameUILayer z-40 > panel z-20).
 * Called by GameUILayer when uiState.questFormOpen === true.
 */

import { useState, useCallback } from "react";
import type { CSSProperties } from "react";
import type {
  QuestFormDefinition,
  ConversationQuestFormResponse,
  QuestFormAnswerValue
} from "@sugarmagic/runtime-core";

export interface QuestFormOverlayProps {
  definition: QuestFormDefinition;
  onSubmit: (response: ConversationQuestFormResponse) => void;
  onDismiss: () => void;
}

function countAnswered(answers: Map<string, QuestFormAnswerValue>): number {
  let n = 0;
  for (const v of answers.values()) {
    if (v.kind !== "skipped") n++;
  }
  return n;
}

function buildFillFragments(template: string): { prefix: string; suffix: string } {
  const [prefix = "", suffix = ""] = template.split("___", 2);
  return { prefix, suffix };
}

const S: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(7, 7, 15, 0.82)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    // The backdrop does NOT scroll. If it did, a long form would be scrolled by
    // the window scrollbar at the far edge of the screen, half a metre from the
    // 600px card it belongs to. The card owns its own scrolling below.
    overflow: "hidden",
    pointerEvents: "auto",
    zIndex: 50,
    padding: "32px 16px 64px"
  },
  card: {
    background: "var(--sm-game-ui-color-surface, #1a1a2e)",
    border: "1px solid rgba(246, 241, 255, 0.12)",
    borderRadius: 8,
    width: "100%",
    maxWidth: 600,
    // Never taller than the space the backdrop's padding leaves it, so the
    // questions scroll inside the card instead of growing the page. Needs
    // border-box or the card's own padding is added on top of the cap and it
    // overflows the bottom of the screen.
    maxHeight: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    padding: "32px 28px",
    color: "var(--sm-game-ui-color-text, #f6f1ff)",
    fontFamily: "var(--sm-game-ui-font-body, sans-serif)"
  },
  form: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0
  },
  // The only part that scrolls. Title, intro and Submit stay put.
  questionScroll: {
    overflowY: "auto",
    minHeight: 0,
    // Keeps text off the scrollbar without shifting the layout when absent.
    paddingRight: 8,
    marginRight: -8
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    flexShrink: 0
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
    lineHeight: 1.3
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "rgba(246, 241, 255, 0.5)",
    fontSize: 22,
    cursor: "pointer",
    lineHeight: 1,
    padding: "0 4px",
    marginLeft: 12,
    flexShrink: 0
  },
  intro: {
    fontSize: 14,
    opacity: 0.72,
    marginTop: 0,
    marginBottom: 28,
    lineHeight: 1.6,
    flexShrink: 0
  },
  question: {
    marginBottom: 28,
    paddingBottom: 24,
    borderBottom: "1px solid rgba(246, 241, 255, 0.08)"
  },
  prompt: {
    fontSize: 15,
    fontWeight: 500,
    marginBottom: 8
  },
  support: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 0,
    marginBottom: 10
  },
  optionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    marginBottom: 6,
    border: "1px solid rgba(246, 241, 255, 0.12)"
  },
  optionInput: { accentColor: "var(--sm-game-ui-color-accent, #9b59b6)" },
  toggleGroup: { display: "flex", gap: 10, marginTop: 4 },
  toggleBtn: {
    flex: 1,
    padding: "8px 0",
    borderRadius: 6,
    border: "1px solid rgba(246, 241, 255, 0.18)",
    background: "transparent",
    color: "var(--sm-game-ui-color-text, #f6f1ff)",
    fontSize: 14,
    cursor: "pointer"
  },
  toggleBtnActive: {
    background: "rgba(155, 89, 182, 0.3)",
    border: "1px solid rgba(155, 89, 182, 0.7)"
  },
  textarea: {
    width: "100%",
    background: "rgba(246, 241, 255, 0.06)",
    border: "1px solid rgba(246, 241, 255, 0.18)",
    borderRadius: 6,
    color: "var(--sm-game-ui-color-text, #f6f1ff)",
    fontSize: 14,
    padding: "8px 12px",
    resize: "vertical",
    boxSizing: "border-box"
  },
  fillWrap: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    fontSize: 14,
    marginTop: 4
  },
  fillInput: {
    background: "rgba(246, 241, 255, 0.06)",
    border: "1px solid rgba(246, 241, 255, 0.18)",
    borderRadius: 4,
    color: "var(--sm-game-ui-color-text, #f6f1ff)",
    fontSize: 14,
    padding: "4px 8px",
    minWidth: 80
  },
  skipBtn: {
    marginTop: 8,
    background: "transparent",
    border: "none",
    color: "rgba(246, 241, 255, 0.4)",
    fontSize: 12,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline"
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    paddingTop: 16,
    borderTop: "1px solid rgba(246, 241, 255, 0.08)",
    // Stays visible while the questions scroll past it.
    flexShrink: 0
  },
  submitBtn: {
    padding: "10px 28px",
    borderRadius: 6,
    border: "none",
    background: "var(--sm-game-ui-color-accent, #9b59b6)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer"
  },
  submitNote: {
    fontSize: 12,
    opacity: 0.7,
    marginRight: 12,
    alignSelf: "center"
  }
};

export function QuestFormOverlay({ definition, onSubmit, onDismiss }: QuestFormOverlayProps) {
  const [answers, setAnswers] = useState<Map<string, QuestFormAnswerValue>>(() => new Map());

  const setAnswer = useCallback((id: string, value: QuestFormAnswerValue) => {
    setAnswers((prev) => new Map(prev).set(id, value));
  }, []);

  /**
   * SUBMIT IS ALWAYS ALLOWED. `minAnswersForValid` shapes the RESULT, it does
   * not grant permission.
   *
   * It used to disable the button below the threshold, which blocked the exact
   * player this form exists to place: the intro tells a beginner to leave
   * blanks for anything they do not understand yet, and then the button
   * refused to accept blanks. The scorer never needed it either -- it treats
   * sparse answers as a real signal, returning the lowest band with low
   * confidence, which is what opens the calibration window so the estimate is
   * corrected during play.
   */
  const answeredCount = countAnswered(answers);
  const belowConfidenceThreshold = answeredCount < definition.minAnswersForValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      questionnaireId: definition.formId ?? "quest-form",
      submittedAtMs: Date.now(),
      answers: Object.fromEntries(answers)
    });
  };

  return (
    <div style={S.backdrop}>
      <div style={S.card}>
        <div style={S.header}>
          <h2 style={S.title}>{definition.formTitle}</h2>
          <button style={S.closeBtn} onClick={onDismiss} aria-label="Close form">x</button>
        </div>
        <p style={S.intro}>{definition.formIntro}</p>
        <form onSubmit={handleSubmit} style={S.form}>
          <div style={S.questionScroll}>
          {definition.questions.map((q) => {
            const current = answers.get(q.questionId);
            return (
              <section key={q.questionId} style={S.question}>
                <div style={S.prompt}>{q.promptText}</div>
                {q.supportText ? <p style={S.support}>{q.supportText}</p> : null}

                {q.kind === "multiple-choice" ? (
                  <div>
                    {q.options.map((opt) => (
                      <label
                        key={opt.optionId}
                        style={{
                          ...S.optionLabel,
                          ...(current?.kind === "multiple-choice" && current.optionId === opt.optionId
                            ? { background: "rgba(155, 89, 182, 0.15)", borderColor: "rgba(155, 89, 182, 0.6)" }
                            : {})
                        }}
                      >
                        <input
                          type="radio"
                          name={q.questionId}
                          style={S.optionInput}
                          checked={current?.kind === "multiple-choice" && current.optionId === opt.optionId}
                          onChange={() => setAnswer(q.questionId, { kind: "multiple-choice", optionId: opt.optionId })}
                        />
                        {opt.text}
                      </label>
                    ))}
                  </div>
                ) : q.kind === "yes-no" ? (
                  <div style={S.toggleGroup}>
                    {(
                      [
                        { label: q.yesLabel, value: "yes" as const },
                        { label: q.noLabel, value: "no" as const }
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        style={{
                          ...S.toggleBtn,
                          ...(current?.kind === "yes-no" && current.answer === opt.value
                            ? S.toggleBtnActive
                            : {})
                        }}
                        onClick={() => setAnswer(q.questionId, { kind: "yes-no", answer: opt.value })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : q.kind === "free-text" ? (
                  <textarea
                    style={S.textarea}
                    rows={3}
                    placeholder={q.supportText ?? ""}
                    value={current?.kind === "free-text" ? current.text : ""}
                    onChange={(e) => setAnswer(q.questionId, { kind: "free-text", text: e.target.value })}
                  />
                ) : q.kind === "fill-in-blank" ? (
                  <div style={S.fillWrap}>
                    {(() => {
                      const { prefix, suffix } = buildFillFragments(q.sentenceTemplate);
                      return (
                        <>
                          <span>{prefix}</span>
                          <input
                            type="text"
                            style={S.fillInput}
                            value={current?.kind === "fill-in-blank" ? current.text : ""}
                            onChange={(e) => setAnswer(q.questionId, { kind: "fill-in-blank", text: e.target.value })}
                          />
                          <span>{suffix}</span>
                        </>
                      );
                    })()}
                  </div>
                ) : null}

                <button
                  type="button"
                  style={S.skipBtn}
                  onClick={() => setAnswer(q.questionId, { kind: "skipped" })}
                >
                  Skip this one
                </button>
              </section>
            );
          })}
          </div>
          <div style={S.footer}>
            {belowConfidenceThreshold ? (
              <span style={S.submitNote}>
                {answeredCount} of {definition.minAnswersForValid} answered -- we
                will keep adjusting as you play.
              </span>
            ) : null}
            <button type="submit" style={S.submitBtn}>
              Submit form
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
