/**
 * packages/runtime-core/src/dialogue/DialoguePanel.ts
 *
 * Purpose: Renders the runtime conversation panel, including the placement questionnaire form mode.
 *
 * Exports:
 *   - RuntimeDialoguePanel
 *   - createRuntimeDialoguePanel
 *
 * Relationships:
 *   - Depends on runtime-core conversation contracts and DialogueManager presenter hooks.
 *   - Is the single browser-side renderer for both normal conversation turns and placement questionnaires.
 *
 * Implements: Runtime dialogue host UI / Sugarlang Epic 11 questionnaire mode
 *
 * Status: active
 */

import {
  EXCERPT_SPEAKER,
  PLAYER_SPEAKER,
  PLAYER_VO_SPEAKER
} from "@sugarmagic/domain";
import {
  type DialoguePresenter
} from "./DialogueManager";
import type {
  ConversationPlayerInput,
  ConversationTurnEnvelope
} from "../conversation";
import { findTermMatches, readDialogueHighlight } from "./highlight";

interface PlacementQuestionnaireView {
  schemaVersion: number;
  lang: string;
  targetLanguage: string;
  supportLanguage: string;
  formTitle: string;
  formIntro: string;
  minAnswersForValid: number;
  questions: Array<
    | {
        kind: "multiple-choice";
        questionId: string;
        promptText: string;
        supportText?: string;
        options: Array<{ optionId: string; text: string }>;
      }
    | {
        kind: "free-text";
        questionId: string;
        promptText: string;
        supportText?: string;
      }
    | {
        kind: "yes-no";
        questionId: string;
        promptText: string;
        supportText?: string;
        yesLabel: string;
        noLabel: string;
      }
    | {
        kind: "fill-in-blank";
        questionId: string;
        promptText: string;
        supportText?: string;
        sentenceTemplate: string;
      }
  >;
}

type PlacementAnswerValue =
  | { kind: "multiple-choice"; optionId: string }
  | { kind: "free-text"; text: string }
  | { kind: "yes-no"; answer: "yes" | "no" }
  | { kind: "fill-in-blank"; text: string }
  | { kind: "skipped" };

function isPlacementQuestionnaireView(
  value: unknown
): value is PlacementQuestionnaireView {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as PlacementQuestionnaireView).questions) &&
    typeof (value as PlacementQuestionnaireView).formTitle === "string"
  );
}

function countAnsweredPlacementQuestions(
  answers: Map<string, PlacementAnswerValue>
): number {
  let answered = 0;
  for (const value of answers.values()) {
    if (value.kind !== "skipped") {
      answered += 1;
    }
  }
  return answered;
}

function buildFillInBlankFragments(sentenceTemplate: string): {
  prefix: string;
  suffix: string;
} {
  const [prefix, suffix = ""] = sentenceTemplate.split("___", 2);
  return {
    prefix: prefix ?? "",
    suffix
  };
}

export interface RuntimeDialoguePanel extends DialoguePresenter {
  getElement: () => HTMLElement;
}

export type DialogueEntryDecorator = (
  turn: ConversationTurnEnvelope
) => ConversationTurnEnvelope;

export type DialogueTermHoverCallback = (event: {
  term: string;
  dwellMs: number;
}) => void;

export function createRuntimeDialoguePanel(
  parentContainer: HTMLElement,
  options?: {
    entryDecorators?: DialogueEntryDecorator[];
    onTermHover?: DialogueTermHoverCallback;
  }
): RuntimeDialoguePanel {
  const entryDecorators = options?.entryDecorators ?? [];
  const onTermHover = options?.onTermHover ?? null;
  injectStyles();

  const container = document.createElement("div");
  container.className = "sm-dialogue-panel-container";

  const panel = document.createElement("div");
  panel.className = "sm-dialogue-panel";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "sm-dialogue-panel-close";
  closeButton.setAttribute("aria-label", "Close conversation");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => {
    onCancel?.();
  });

  const scrollArea = document.createElement("div");
  scrollArea.className = "sm-dialogue-panel-scroll";

  const historyContainer = document.createElement("div");
  historyContainer.className = "sm-dialogue-panel-history";
  scrollArea.appendChild(historyContainer);

  const activeContainer = document.createElement("div");
  activeContainer.className = "sm-dialogue-panel-active";
  scrollArea.appendChild(activeContainer);

  panel.appendChild(scrollArea);

  const enrichmentContainer = document.createElement("div");
  enrichmentContainer.className = "sm-dialogue-panel-enrichment";
  panel.appendChild(enrichmentContainer);

  const actionsContainer = document.createElement("div");
  actionsContainer.className = "sm-dialogue-panel-actions";
  panel.appendChild(actionsContainer);

  const inputContainer = document.createElement("div");
  inputContainer.className = "sm-dialogue-panel-input";
  panel.appendChild(inputContainer);

  container.appendChild(panel);
  parentContainer.appendChild(container);

  let currentChoices: ConversationTurnEnvelope["choices"] = [];
  let currentInputMode: ConversationTurnEnvelope["inputMode"] = "advance";
  let currentInputPlaceholder = "";
  let onInput: ((input: ConversationPlayerInput) => void) | null = null;
  let onCancel: (() => void) | null = null;
  let entryCount = 0;
  let textInput: HTMLTextAreaElement | null = null;
  let pendingSpeakerLabel: string | null = null;
  let currentTurnMetadata: Record<string, unknown> | undefined;

  function stopCurrent() {
    onInput = null;
    onCancel = null;
    currentChoices = [];
    currentInputMode = "advance";
    currentInputPlaceholder = "";
    actionsContainer.innerHTML = "";
    enrichmentContainer.innerHTML = "";
    inputContainer.innerHTML = "";
    textInput = null;
    pendingSpeakerLabel = null;
    currentTurnMetadata = undefined;
  }

  function scrollToBottom() {
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  function graduateActive() {
    if (activeContainer.childElementCount === 0) return;
    while (activeContainer.firstChild) {
      historyContainer.appendChild(activeContainer.firstChild);
    }
  }

  function activeContainsPendingEntry(): boolean {
    return activeContainer.querySelector(".sm-dialogue-entry-pending") !== null;
  }

  function getSpeakerClass(speakerId: string | undefined): string | null {
    if (speakerId === PLAYER_SPEAKER.speakerId) return "player";
    if (speakerId === PLAYER_VO_SPEAKER.speakerId) return "player-vo";
    if (speakerId === EXCERPT_SPEAKER.speakerId) return "excerpt";
    return null;
  }

  function createEntry(turn: ConversationTurnEnvelope): HTMLDivElement {
    for (const decorator of entryDecorators) {
      turn = decorator(turn);
    }

    const entry = document.createElement("div");
    entry.className = "sm-dialogue-entry";
    entry.classList.add(entryCount % 2 === 0 ? "align-left" : "align-right");
    entryCount += 1;
    const speakerClass = getSpeakerClass(turn.speakerId);
    if (speakerClass) {
      entry.classList.add(speakerClass);
    }

    const speakerName = turn.speakerLabel;
    if (speakerName) {
      const speakerElement = document.createElement("div");
      speakerElement.className = "sm-dialogue-entry-speaker";
      speakerElement.textContent = speakerName;
      entry.appendChild(speakerElement);
    }

    const textElement = document.createElement("div");
    textElement.className = "sm-dialogue-entry-text";

    const turnHighlight = readDialogueHighlight(turn.annotations);
    if (turnHighlight && turnHighlight.focusTerms.length > 0) {
      const matches = findTermMatches(
        turn.text,
        turnHighlight.focusTerms,
        turnHighlight.celebrateTerms,
        turnHighlight.introduceTerms
      );
      if (matches.length > 0) {
        let cursor = 0;
        for (const match of matches) {
          if (match.start > cursor) {
            textElement.appendChild(
              document.createTextNode(turn.text.slice(cursor, match.start))
            );
          }
          const wrapper = document.createElement("span");
          const vocabKind = match.introduce
            ? "sm-dialogue-focus-term-introduce"
            : "sm-dialogue-focus-term-reinforce";
          wrapper.className = match.celebrate
            ? `sm-dialogue-focus-term ${vocabKind} sm-dialogue-focus-term-celebrate`
            : `sm-dialogue-focus-term ${vocabKind}`;

          if (onTermHover) {
            let hoverTimer: ReturnType<typeof setTimeout> | null = null;
            let hoverStartMs = 0;
            wrapper.addEventListener("mouseenter", () => {
              hoverStartMs = Date.now();
              hoverTimer = setTimeout(() => {
                onTermHover({
                  term: match.term.toLowerCase(),
                  dwellMs: Date.now() - hoverStartMs
                });
              }, 300);
            });
            wrapper.addEventListener("mouseleave", () => {
              if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
              }
            });
          }

          const termText = document.createElement("span");
          termText.className = "sm-dialogue-focus-term-text";
          termText.textContent = match.term;
          wrapper.appendChild(termText);

          const gloss = turnHighlight.glosses?.[match.term.toLowerCase()];
          if (gloss) {
            const tooltip = document.createElement("span");
            tooltip.className = "sm-dialogue-focus-tooltip";
            tooltip.textContent = gloss;
            tooltip.setAttribute("aria-hidden", "true");
            wrapper.appendChild(tooltip);
          }

          if (match.celebrate) {
            const burst = document.createElement("span");
            burst.className = "sm-dialogue-focus-burst";
            const halo = document.createElement("span");
            halo.className = "sm-dialogue-focus-burst-halo";
            const star = document.createElement("span");
            star.className = "sm-dialogue-focus-burst-star";
            star.textContent = "\u2605";
            burst.appendChild(halo);
            burst.appendChild(star);
            wrapper.appendChild(burst);
          }

          textElement.appendChild(wrapper);
          cursor = match.end;
        }
        if (cursor < turn.text.length) {
          textElement.appendChild(
            document.createTextNode(turn.text.slice(cursor))
          );
        }
      } else {
        textElement.textContent = turn.text;
      }
    } else {
      textElement.textContent = turn.text;
    }

    entry.appendChild(textElement);
    return entry;
  }

  function createPendingEntry(speakerLabel: string | null): HTMLDivElement {
    const entry = document.createElement("div");
    entry.className = "sm-dialogue-entry sm-dialogue-entry-pending align-left";

    if (speakerLabel) {
      const speakerElement = document.createElement("div");
      speakerElement.className = "sm-dialogue-entry-speaker";
      speakerElement.textContent = speakerLabel;
      entry.appendChild(speakerElement);
    }

    const textElement = document.createElement("div");
    textElement.className = "sm-dialogue-entry-text sm-dialogue-entry-thinking";

    const dots = document.createElement("span");
    dots.className = "sm-dialogue-thinking-dots";
    dots.innerHTML = `
      <span class="sm-dialogue-thinking-dot"></span>
      <span class="sm-dialogue-thinking-dot"></span>
      <span class="sm-dialogue-thinking-dot"></span>
    `;

    textElement.appendChild(dots);
    entry.appendChild(textElement);
    return entry;
  }

  function submitInput(input: ConversationPlayerInput) {
    const handler = onInput;
    if (input.kind === "free_text") {
      const trimmed = input.text.trim();
      if (!trimmed) return;
      activeContainer.appendChild(
        createEntry({
          turnId: `player:${crypto.randomUUID()}`,
          providerId: "runtime:player-input",
          conversationKind: "free-form",
          speakerId: PLAYER_SPEAKER.speakerId,
          speakerLabel: PLAYER_SPEAKER.displayName,
          text: trimmed,
          choices: []
        })
      );
      scrollToBottom();
      stopCurrent();
      handler?.({ kind: "free_text", text: trimmed });
      return;
    }
    if (input.kind === "placement_questionnaire") {
      stopCurrent();
      handler?.(input);
      return;
    }
    stopCurrent();
    handler?.(input);
  }

  function renderActions() {
    actionsContainer.innerHTML = "";
    inputContainer.innerHTML = "";
    textInput = null;

    function createFooterRow(hintText: string, includeSubmit: boolean): HTMLDivElement {
      const footer = document.createElement("div");
      footer.className = "sm-dialogue-input-footer";

      const hint = document.createElement("div");
      hint.className = "sm-dialogue-text-hint";
      hint.innerHTML = hintText;
      footer.appendChild(hint);

      const controls = document.createElement("div");
      controls.className = "sm-dialogue-footer-controls";

      const dismissButton = closeButton.cloneNode(true) as HTMLButtonElement;
      dismissButton.addEventListener("click", () => {
        onCancel?.();
      });
      controls.appendChild(dismissButton);

      if (includeSubmit) {
        const submitButton = document.createElement("button");
        submitButton.type = "submit";
        submitButton.className = "sm-dialogue-submit-btn";
        submitButton.textContent = "Send";
        controls.appendChild(submitButton);
      }

      footer.appendChild(controls);
      return footer;
    }

    if (currentInputMode === "placement_questionnaire") {
      const questionnaire = isPlacementQuestionnaireView(
        currentTurnMetadata?.["sugarlang.placementQuestionnaire"]
      )
        ? (currentTurnMetadata?.["sugarlang.placementQuestionnaire"] as PlacementQuestionnaireView)
        : null;
      const questionnaireVersion =
        typeof currentTurnMetadata?.["sugarlang.placementQuestionnaireVersion"] ===
        "string"
          ? (currentTurnMetadata?.[
              "sugarlang.placementQuestionnaireVersion"
            ] as string)
          : "placement-questionnaire";

      if (!questionnaire) {
        actionsContainer.appendChild(
          createFooterRow(
            'Press Enter to continue or <span class="sm-dialogue-key-hint">Esc</span> to close',
            false
          )
        );
        return;
      }

      const answers = new Map<string, PlacementAnswerValue>();
      const form = document.createElement("form");
      form.className = "sm-placement-form";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (answers.size < questionnaire.minAnswersForValid) {
          return;
        }
        submitInput({
          kind: "placement_questionnaire",
          response: {
            questionnaireId: questionnaireVersion,
            submittedAtMs: Date.now(),
            answers: Object.fromEntries(answers)
          }
        });
      });

      const title = document.createElement("h3");
      title.className = "sm-placement-form-title";
      title.textContent = questionnaire.formTitle;
      form.appendChild(title);

      const intro = document.createElement("p");
      intro.className = "sm-placement-form-intro";
      intro.textContent = questionnaire.formIntro;
      form.appendChild(intro);

      const submitButton = document.createElement("button");
      submitButton.type = "submit";
      submitButton.className = "sm-placement-submit-btn";
      submitButton.textContent = "Submit form";
      submitButton.disabled = true;

      const refreshSubmitState = () => {
        submitButton.disabled =
          countAnsweredPlacementQuestions(answers) < questionnaire.minAnswersForValid;
      };

      for (const question of questionnaire.questions) {
        const questionCard = document.createElement("section");
        questionCard.className = "sm-placement-question";

        const prompt = document.createElement("div");
        prompt.className = "sm-placement-question-prompt";
        prompt.textContent = question.promptText;
        questionCard.appendChild(prompt);

        if (question.supportText) {
          const support = document.createElement("div");
          support.className = "sm-placement-question-support";
          support.textContent = question.supportText;
          questionCard.appendChild(support);
        }

        if (question.kind === "multiple-choice") {
          const options = document.createElement("div");
          options.className = "sm-placement-question-options";
          for (const option of question.options) {
            const label = document.createElement("label");
            label.className = "sm-placement-option";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = question.questionId;
            input.addEventListener("change", () => {
              answers.set(question.questionId, {
                kind: "multiple-choice",
                optionId: option.optionId
              });
              refreshSubmitState();
            });
            label.appendChild(input);
            const text = document.createElement("span");
            text.textContent = option.text;
            label.appendChild(text);
            options.appendChild(label);
          }
          questionCard.appendChild(options);
        } else if (question.kind === "yes-no") {
          const options = document.createElement("div");
          options.className = "sm-placement-question-options";
          for (const answer of [
            { label: question.yesLabel, value: "yes" as const },
            { label: question.noLabel, value: "no" as const }
          ]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "sm-placement-toggle-btn";
            button.textContent = answer.label;
            button.addEventListener("click", () => {
              answers.set(question.questionId, {
                kind: "yes-no",
                answer: answer.value
              });
              refreshSubmitState();
            });
            options.appendChild(button);
          }
          questionCard.appendChild(options);
        } else if (question.kind === "free-text") {
          const input = document.createElement("textarea");
          input.className = "sm-placement-textarea";
          input.rows = 3;
          input.placeholder = question.supportText ?? "";
          input.addEventListener("input", () => {
            answers.set(question.questionId, {
              kind: "free-text",
              text: input.value
            });
            refreshSubmitState();
          });
          questionCard.appendChild(input);
        } else if (question.kind === "fill-in-blank") {
          const wrap = document.createElement("label");
          wrap.className = "sm-placement-fill";
          const { prefix, suffix } = buildFillInBlankFragments(
            question.sentenceTemplate
          );
          const prefixText = document.createElement("span");
          prefixText.textContent = prefix;
          const input = document.createElement("input");
          input.type = "text";
          input.className = "sm-placement-fill-input";
          input.addEventListener("input", () => {
            answers.set(question.questionId, {
              kind: "fill-in-blank",
              text: input.value
            });
            refreshSubmitState();
          });
          const suffixText = document.createElement("span");
          suffixText.textContent = suffix;
          wrap.appendChild(prefixText);
          wrap.appendChild(input);
          wrap.appendChild(suffixText);
          questionCard.appendChild(wrap);
        }

        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "sm-placement-skip-btn";
        skip.textContent = "Skip this one";
        skip.addEventListener("click", () => {
          answers.set(question.questionId, { kind: "skipped" });
          refreshSubmitState();
        });
        questionCard.appendChild(skip);
        form.appendChild(questionCard);
      }

      const footer = document.createElement("div");
      footer.className = "sm-placement-form-footer";
      footer.appendChild(submitButton);
      form.appendChild(footer);
      inputContainer.appendChild(form);
      return;
    }

    if (currentInputMode === "free_text") {
      const form = document.createElement("form");
      form.className = "sm-dialogue-input-form";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!textInput) return;
        submitInput({ kind: "free_text", text: textInput.value });
      });

      textInput = document.createElement("textarea");
      textInput.className = "sm-dialogue-text-input";
      textInput.rows = 3;
      textInput.placeholder = currentInputPlaceholder || "Type your response...";
      textInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
      });
      textInput.addEventListener("keyup", (event) => {
        event.stopPropagation();
      });
      form.appendChild(textInput);

      form.appendChild(
        createFooterRow(
          'Enter to send, Shift+Enter for a new line, <span class="sm-dialogue-key-hint">Esc</span> to close',
          true
        )
      );
      inputContainer.appendChild(form);
      queueMicrotask(() => textInput?.focus());
      return;
    }

    if (currentChoices.length > 1) {
      currentChoices.forEach((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sm-dialogue-choice-btn";
        button.innerHTML = `<span class="choice-number">${index + 1}</span><span class="choice-text">${
          choice.label
        }</span>`;
        button.addEventListener("click", () =>
          submitInput({ kind: "choice", choiceId: choice.choiceId })
        );
        actionsContainer.appendChild(button);
      });
      actionsContainer.appendChild(
        createFooterRow(
          'Press a number to choose or <span class="sm-dialogue-key-hint">Esc</span> to close',
          false
        )
      );
      return;
    }

    actionsContainer.appendChild(
      createFooterRow(
        currentChoices.length === 1
          ? 'Press Enter to continue or <span class="sm-dialogue-key-hint">Esc</span> to close'
          : 'Press Enter to close or <span class="sm-dialogue-key-hint">Esc</span> to close',
        false
      )
    );
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!container.classList.contains("visible")) return;

    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
      return;
    }

    if (currentInputMode === "free_text") {
      if (event.key === "Enter" && !event.shiftKey) {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement && target === textInput) {
          event.preventDefault();
          submitInput({ kind: "free_text", text: target.value });
        }
      }
      return;
    }

    if (currentInputMode === "placement_questionnaire") {
      return;
    }

    if (currentChoices.length > 1) {
      const index = Number.parseInt(event.key, 10) - 1;
      if (index >= 0 && index < currentChoices.length) {
        event.preventDefault();
        submitInput({ kind: "choice", choiceId: currentChoices[index]!.choiceId });
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitInput({ kind: "advance" });
    }
  }

  window.addEventListener("keydown", handleKeyDown);

  return {
    getElement() {
      return container;
    },
    show() {
      container.classList.add("visible");
    },
    hide() {
      container.classList.remove("visible");
      activeContainer.innerHTML = "";
      actionsContainer.innerHTML = "";
      enrichmentContainer.innerHTML = "";
      inputContainer.innerHTML = "";
      entryCount = 0;
      stopCurrent();
    },
    clearHistory() {
      historyContainer.innerHTML = "";
      activeContainer.innerHTML = "";
      actionsContainer.innerHTML = "";
      enrichmentContainer.innerHTML = "";
      inputContainer.innerHTML = "";
      entryCount = 0;
    },
    showPending(options) {
      pendingSpeakerLabel = options?.speakerLabel ?? null;
      graduateActive();
      stopCurrent();
      onCancel = options?.onCancel ?? null;
      activeContainer.innerHTML = "";
      activeContainer.appendChild(createPendingEntry(pendingSpeakerLabel));
      container.classList.add("visible");
      scrollToBottom();
    },
    showTurn(turn, handleTurnInput, handleCancel) {
      if (activeContainsPendingEntry()) {
        activeContainer.innerHTML = "";
      } else {
        graduateActive();
      }
      onInput = handleTurnInput;
      onCancel = handleCancel ?? null;
      currentChoices = turn.choices;
      currentTurnMetadata = turn.metadata;
      currentInputMode =
        turn.inputMode ??
        (turn.choices.length > 1 ? "choice" : "advance");
      currentInputPlaceholder = turn.inputPlaceholder ?? "";
      activeContainer.innerHTML = "";
      activeContainer.appendChild(createEntry(turn));
      renderActions();
      container.classList.add("visible");
      scrollToBottom();
    },
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      stopCurrent();
      parentContainer.removeChild(container);
    }
  };
}

function injectStyles() {
  if (document.getElementById("sm-dialogue-panel-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-dialogue-panel-styles";
  style.textContent = `
    .sm-dialogue-panel-container {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease-out;
      z-index: 20;
    }

    .sm-dialogue-panel-container.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .sm-dialogue-panel {
      position: absolute;
      top: 32px;
      right: 32px;
      bottom: 32px;
      width: min(420px, calc(100vw - 48px));
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(24,24,37,0.94), rgba(17,17,27,0.96));
      box-shadow: 0 18px 54px rgba(0,0,0,0.38);
      overflow: hidden;
      backdrop-filter: blur(20px);
    }

    .sm-dialogue-panel-close {
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: rgba(240, 232, 223, 0.88);
      font: inherit;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      transition: background 0.15s ease-out, border-color 0.15s ease-out;
    }

    .sm-dialogue-panel-close:hover {
      background: rgba(255,255,255,0.12);
      border-color: rgba(255,255,255,0.24);
    }

    .sm-dialogue-panel-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px 8px;
    }

    .sm-dialogue-panel-history,
    .sm-dialogue-panel-active {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .sm-dialogue-panel-enrichment:empty,
    .sm-dialogue-panel-actions:empty {
      display: none;
    }

    .sm-dialogue-panel-enrichment {
      padding: 0 20px 12px;
    }

    .sm-dialogue-panel-actions {
      padding: 12px 20px 20px;
      border-top: 1px solid rgba(255,255,255,0.06);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sm-dialogue-panel-input:empty {
      display: none;
    }

    .sm-dialogue-panel-input {
      padding: 0 20px 20px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }

    .sm-dialogue-entry {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 82%;
    }

    .sm-dialogue-entry.align-left {
      align-self: flex-start;
      text-align: left;
    }

    .sm-dialogue-entry.align-right {
      align-self: flex-end;
      text-align: right;
    }

    .sm-dialogue-entry-speaker {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #85c1e9;
    }

    .sm-dialogue-entry-text {
      color: rgba(240, 232, 223, 0.9);
      font-size: 16px;
      line-height: 1.6;
    }

    .sm-dialogue-entry-pending .sm-dialogue-entry-text {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
    }

    .sm-dialogue-entry-thinking {
      color: rgba(240, 232, 223, 0.72);
    }

    .sm-dialogue-thinking-dots {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .sm-dialogue-thinking-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: rgba(240, 232, 223, 0.82);
      animation: sm-dialogue-thinking-bounce 1s infinite ease-in-out;
    }

    .sm-dialogue-thinking-dot:nth-child(2) {
      animation-delay: 0.15s;
    }

    .sm-dialogue-thinking-dot:nth-child(3) {
      animation-delay: 0.3s;
    }

    @keyframes sm-dialogue-thinking-bounce {
      0%, 80%, 100% {
        transform: translateY(0);
        opacity: 0.45;
      }

      40% {
        transform: translateY(-4px);
        opacity: 1;
      }
    }

    .sm-dialogue-entry.player .sm-dialogue-entry-speaker,
    .sm-dialogue-entry.player-vo .sm-dialogue-entry-speaker {
      color: #f0e6d8;
    }

    .sm-dialogue-entry.player-vo .sm-dialogue-entry-text {
      font-style: italic;
      color: rgba(240, 230, 216, 0.85);
    }

    .sm-dialogue-entry.excerpt {
      padding-left: 14px;
      border-left: 2px solid rgba(212,196,160,0.3);
    }

    .sm-dialogue-entry.excerpt .sm-dialogue-entry-speaker,
    .sm-dialogue-entry.excerpt .sm-dialogue-entry-text {
      color: rgba(212,196,160,0.9);
      font-style: italic;
    }

    .sm-dialogue-choice-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: #f0e8df;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease-out, border-color 0.15s ease-out;
    }

    .sm-dialogue-choice-btn:hover {
      background: rgba(137,180,250,0.18);
      border-color: rgba(137,180,250,0.5);
    }

    .sm-dialogue-choice-btn .choice-number {
      width: 20px;
      color: rgba(249,226,175,0.9);
      font-weight: 700;
      flex-shrink: 0;
    }

    .sm-dialogue-choice-btn .choice-text {
      flex: 1;
    }

    .sm-dialogue-continue-hint {
      text-align: center;
      color: rgba(240,232,223,0.6);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .sm-dialogue-input-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sm-dialogue-text-input {
      width: 100%;
      resize: vertical;
      min-height: 84px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: #f0e8df;
      font: inherit;
    }

    .sm-dialogue-text-input::placeholder {
      color: rgba(240,232,223,0.45);
    }

    .sm-dialogue-input-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .sm-dialogue-footer-controls {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .sm-dialogue-text-hint {
      color: rgba(240,232,223,0.55);
      font-size: 12px;
    }

    .sm-dialogue-key-hint {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: rgba(240,232,223,0.72);
    }

    .sm-dialogue-submit-btn {
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid rgba(137,180,250,0.45);
      background: rgba(137,180,250,0.18);
      color: #f0e8df;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }

    /* ── Sugarlang focus-term highlighting ── */

    .sm-dialogue-focus-term {
      position: relative;
      display: inline-flex;
      align-items: baseline;
      overflow: visible;
    }

    /* Introduce: gold with underline — "pay attention, this is new" */
    .sm-dialogue-focus-term-introduce {
      color: #f5c35b;
      text-shadow: 0 0 10px rgba(245, 195, 91, 0.2);
    }

    .sm-dialogue-focus-term-introduce .sm-dialogue-focus-term-text {
      border-bottom: 1px solid rgba(245, 195, 91, 0.35);
      box-shadow: inset 0 -0.18em 0 rgba(245, 195, 91, 0.14);
    }

    /* Reinforce: blue, no underline — "you've seen this, try to remember" */
    .sm-dialogue-focus-term-reinforce {
      color: rgba(137, 180, 250, 0.85);
      text-shadow: 0 0 8px rgba(137, 180, 250, 0.25);
    }

    .sm-dialogue-focus-term-celebrate .sm-dialogue-focus-term-text {
      border-bottom-color: rgba(255, 224, 130, 0.75);
      box-shadow: inset 0 -0.2em 0 rgba(255, 224, 130, 0.2);
      animation: sm-dialogue-focus-term-pop 1.05s ease-out;
    }

    .sm-dialogue-focus-tooltip {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%) scale(0.92);
      padding: 4px 10px;
      border-radius: 6px;
      background: rgba(30, 30, 46, 0.95);
      border: 1px solid rgba(245, 195, 91, 0.3);
      color: #f0e8df;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s ease;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    .sm-dialogue-focus-tooltip::after {
      content: "";
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: rgba(30, 30, 46, 0.95);
    }

    .sm-dialogue-focus-term:hover .sm-dialogue-focus-tooltip {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }

    .sm-dialogue-focus-burst {
      position: absolute;
      left: 50%;
      bottom: calc(100% - 1px);
      width: 0;
      height: 0;
      pointer-events: none;
      overflow: visible;
      z-index: 2;
    }

    .sm-dialogue-focus-burst-halo {
      position: absolute;
      left: 0;
      top: 0;
      width: 26px;
      height: 26px;
      border-radius: 999px;
      border: 2px solid rgba(255, 220, 116, 0.68);
      opacity: 0;
      transform: translate(-50%, -48%) scale(0.3);
      animation: sm-dialogue-focus-halo 1100ms ease-out forwards;
      box-shadow: 0 0 20px rgba(255, 216, 107, 0.3);
    }

    .sm-dialogue-focus-burst-star {
      position: absolute;
      left: 0;
      top: 0;
      color: #ffd86b;
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
      opacity: 0;
      transform: translate(-50%, -6px) scale(0.45);
      animation: sm-dialogue-focus-burst 1320ms cubic-bezier(0.16, 0.84, 0.22, 1) forwards;
      text-shadow: 0 0 16px rgba(255, 216, 107, 0.72);
    }

    @keyframes sm-dialogue-focus-term-pop {
      0% { transform: scale(1); text-shadow: 0 0 0 rgba(255, 216, 107, 0); }
      18% { transform: scale(1.08); text-shadow: 0 0 16px rgba(255, 216, 107, 0.55); }
      100% { transform: scale(1); text-shadow: 0 0 0 rgba(255, 216, 107, 0); }
    }

    @keyframes sm-dialogue-focus-halo {
      0% { opacity: 0; transform: translate(-50%, -46%) scale(0.3); }
      24% { opacity: 0.9; }
      100% { opacity: 0; transform: translate(-50%, -74%) scale(1.5); }
    }

    @keyframes sm-dialogue-focus-burst {
      0% { opacity: 0; transform: translate(-50%, -4px) scale(0.45); }
      15% { opacity: 1; transform: translate(-50%, -12px) scale(1); }
      58% { opacity: 1; transform: translate(-50%, -34px) scale(1.02); }
      100% { opacity: 0; transform: translate(-50%, -54px) scale(0.88); }
    }
  `;
  document.head.appendChild(style);
}
