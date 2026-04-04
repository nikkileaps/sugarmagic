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

  container.appendChild(panel);
  parentContainer.appendChild(container);

  let currentChoices: ConversationTurnEnvelope["choices"] = [];
  let onInput: ((input: ConversationPlayerInput) => void) | null = null;
  let onCancel: (() => void) | null = null;
  let entryCount = 0;

  function stopCurrent() {
    onInput = null;
    onCancel = null;
    currentChoices = [];
    actionsContainer.innerHTML = "";
    enrichmentContainer.innerHTML = "";
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

  function submitInput(input: ConversationPlayerInput) {
    const handler = onInput;
    stopCurrent();
    handler?.(input);
  }

  function renderActions() {
    actionsContainer.innerHTML = "";

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
      return;
    }

    const hint = document.createElement("div");
    hint.className = "sm-dialogue-continue-hint";
    hint.textContent =
      currentChoices.length === 1 ? "Press Enter to continue" : "Press Enter to close";
    actionsContainer.appendChild(hint);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!container.classList.contains("visible")) return;

    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
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
      entryCount = 0;
      stopCurrent();
    },
    clearHistory() {
      historyContainer.innerHTML = "";
      activeContainer.innerHTML = "";
      actionsContainer.innerHTML = "";
      enrichmentContainer.innerHTML = "";
      entryCount = 0;
    },
    showTurn(turn, handleTurnInput, handleCancel) {
      graduateActive();
      onInput = handleTurnInput;
      onCancel = handleCancel ?? null;
      currentChoices = turn.choices;
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
  `;
  document.head.appendChild(style);
}
