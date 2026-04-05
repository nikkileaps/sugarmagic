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

export interface RuntimeDialoguePanel extends DialoguePresenter {
  getElement: () => HTMLElement;
}

export function createRuntimeDialoguePanel(
  parentContainer: HTMLElement
): RuntimeDialoguePanel {
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
    textElement.textContent = turn.text;
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
  `;
  document.head.appendChild(style);
}
