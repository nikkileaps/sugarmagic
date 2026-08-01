/**
 * Scripted-dialogue presentation: a small bottom-center box.
 *
 * Deliberately NOT the chat panel. Scripted dialogue is authored, linear, and
 * advanced one line at a time, so it shows a single line with the speaker
 * named above it and no history, no scrollback, and no text input. The chat
 * panel remains the presentation for agent conversations.
 *
 * Language enrichment is identical to the chat panel's -- both build their
 * text through `createTurnTextElement`, so glosses, focus terms, celebrate
 * bursts, and hover telemetry behave the same in either presentation.
 *
 * Keyboard is NOT handled here. The routing panel owns the action-registry
 * registrations (the registry throws on duplicate action ids) and calls
 * `submitAdvance`/choice handling through the callbacks passed to `showTurn`.
 */

import type { ConversationPlayerInput, ConversationTurnEnvelope } from "../conversation";
import { readTeachLine } from "./highlight";
import { createTurnTextElement } from "./turn-text";
import { createPaperPanel } from "./paper-panel";

export interface ScriptedDialogueBoxOptions {
  onTermHover?: (event: { term: string; dwellMs: number }) => void;
  /** 090.12: select-to-translate, same gesture as the free-form panel. */
  onSelectionLookup?: (event: {
    selection: string;
    anchor: DOMRect | null;
  }) => void;
}

export interface ScriptedDialogueBox {
  readonly element: HTMLElement;
  show: () => void;
  hide: () => void;
  showPending: (speakerLabel: string | null) => void;
  showTurn: (
    turn: ConversationTurnEnvelope,
    onInput: (input: ConversationPlayerInput) => void
  ) => void;
  /** Choices currently offered, so the router can gate its Enter/number keys. */
  getChoiceIds: () => string[];
  submitChoice: (choiceId: string) => void;
  submitAdvance: () => void;
  dispose: () => void;
}

export function createScriptedDialogueBox(
  parent: HTMLElement,
  options: ScriptedDialogueBoxOptions = {}
): ScriptedDialogueBox {
  const container = document.createElement("div");
  // Same celebration treatment as the panel -- both present on paper.
  container.className = "sm-dialogue-box-container sm-celebrate-v2";

  const box = document.createElement("div");
  box.className = "sm-dialogue-box";

  const speaker = document.createElement("div");
  speaker.className = "sm-dialogue-box-speaker";

  const body = document.createElement("div");
  body.className = "sm-dialogue-box-body";

  const enrichment = document.createElement("div");
  enrichment.className = "sm-dialogue-box-enrichment";

  const choices = document.createElement("div");
  choices.className = "sm-dialogue-box-choices";

  const advance = document.createElement("div");
  advance.className = "sm-dialogue-box-advance";
  advance.setAttribute("aria-hidden", "true");
  advance.textContent = "▶";

  // The torn-paper background. FIRST child so it sits behind the content;
  // everything above it is position:relative with a z-index in the stylesheet.
  const paper = createPaperPanel();
  box.append(paper.element, body, enrichment, choices, advance);
  container.append(speaker, box);
  parent.appendChild(container);

  // The box changes size on EVERY line, so the outline has to be regenerated
  // rather than authored once. This is string building, not rasterising, and
  // createPaperPanel short-circuits when the size has not actually changed.
  const paperObserver = new ResizeObserver(() => {
    // BORDER box, not contentRect: contentRect excludes padding, and the paper
    // has to cover the whole panel including its 28px of it.
    const rect = box.getBoundingClientRect();
    paper.resize(rect.width, rect.height);
  });
  paperObserver.observe(box);

  let currentInput: ((input: ConversationPlayerInput) => void) | null = null;
  let currentChoiceIds: string[] = [];

  function setSpeaker(label: string | null | undefined): void {
    const name = label?.trim() ?? "";
    speaker.textContent = name;
    speaker.classList.toggle("is-empty", name.length === 0);
  }

  function clearBody(): void {
    body.replaceChildren();
    enrichment.replaceChildren();
    choices.replaceChildren();
    currentChoiceIds = [];
  }

  function submitInput(input: ConversationPlayerInput): void {
    const handler = currentInput;
    if (!handler) return;
    // Clear first so a double-press cannot submit the same line twice.
    currentInput = null;
    currentChoiceIds = [];
    handler(input);
  }

  return {
    element: container,

    show() {
      container.classList.add("visible");
    },

    hide() {
      container.classList.remove("visible");
      clearBody();
      setSpeaker(null);
      currentInput = null;
    },

    showPending(speakerLabel) {
      setSpeaker(speakerLabel);
      clearBody();
      advance.classList.remove("is-ready");
      const dots = document.createElement("div");
      dots.className = "sm-dialogue-thinking-dots";
      for (let i = 0; i < 3; i += 1) {
        dots.appendChild(document.createElement("span"));
      }
      body.appendChild(dots);
    },

    showTurn(turn, onInput) {
      currentInput = onInput;
      clearBody();
      setSpeaker(turn.speakerLabel ?? null);
      body.appendChild(
        createTurnTextElement(turn, {
          onTermHover: options.onTermHover,
          onSelectionLookup: options.onSelectionLookup
        })
      );

      const teachLine = readTeachLine(turn.annotations);
      if (teachLine) {
        const line = document.createElement("p");
        line.className = "sm-dialogue-teach-line";
        line.textContent = `${teachLine.label}: ${teachLine.text}`;
        enrichment.appendChild(line);
      }

      currentChoiceIds = turn.choices.map((choice) => choice.choiceId);
      if (turn.choices.length > 1) {
        turn.choices.forEach((choice, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "sm-dialogue-box-choice";
          const number = document.createElement("span");
          number.className = "choice-number";
          number.textContent = String(index + 1);
          const label = document.createElement("span");
          label.className = "choice-text";
          label.textContent = choice.label;
          button.append(number, label);
          button.addEventListener("click", () => {
            submitInput({ kind: "choice", choiceId: choice.choiceId });
          });
          choices.appendChild(button);
        });
      }
      // The advance chevron only means anything when a press would advance.
      advance.classList.toggle("is-ready", turn.choices.length <= 1);
    },

    getChoiceIds() {
      return currentChoiceIds;
    },

    submitChoice(choiceId) {
      submitInput({ kind: "choice", choiceId });
    },

    submitAdvance() {
      submitInput({ kind: "advance" });
    },

    dispose() {
      paperObserver.disconnect();
      paper.dispose();
      container.remove();
    }
  };
}
