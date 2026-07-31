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

import { PLAYER_SPEAKER, resolveDialogueSpeaker } from "@sugarmagic/domain";
import {
  type DialoguePresenter
} from "./DialogueManager";
import type {
  ConversationPlayerInput,
  ConversationQuestFormResponse,
  ConversationTurnEnvelope,
  QuestFormDefinition
} from "../conversation";
import { isQuestFormDefinition } from "../conversation";
import { readTeachLine } from "./highlight";
import { createTurnTextElement } from "./turn-text";
import {
  createScriptedDialogueBox,
  type ScriptedDialogueBox
} from "./ScriptedDialogueBox";


export interface RuntimeDialoguePanel extends DialoguePresenter {
  getElement: () => HTMLElement;
  /** 081.8 -- submits the active quest_form response and closes the overlay. */
  submitQuestFormResponse: (response: ConversationQuestFormResponse) => void;
  /** 081.8 -- cancels the active quest_form conversation and closes the overlay. */
  cancelQuestForm: () => void;
}

export type DialogueEntryDecorator = (
  turn: ConversationTurnEnvelope
) => ConversationTurnEnvelope;

export type DialogueTermHoverCallback = (event: {
  term: string;
  dwellMs: number;
}) => void;

/**
 * 090.12: resolves a selected span to something worth showing. Returning null
 * means "nothing to say", and the panel shows NO card -- not an error, not
 * "translation unavailable". Most misses are expected (support-language words,
 * names, punctuation), so silence is the honest response.
 */
export type DialogueSelectionLookup = (
  selection: string
) => { surface: string; gloss: string } | null;

export function createRuntimeDialoguePanel(
  parentContainer: HTMLElement,
  options?: {
    entryDecorators?: DialogueEntryDecorator[];
    onTermHover?: DialogueTermHoverCallback;
    /** 090.12: select-to-translate. Absent means the gesture is simply inert. */
    onSelectionLookup?: DialogueSelectionLookup;
    /**
     * Story 50.5 — central keyboard action registry. The
     * dialogue panel registers its Escape (cancel) + Enter
     * (advance / submit) + 1-9 (choice pick) actions against
     * `modes: ["dialogue"]` so they fire only during dialogue.
     * Replaces the previous per-handler window listener +
     * inline visible-check.
     */
    actionRegistry?: import("../input-modes/registry").RuntimeActionRegistry;
    /**
     * Story 50.5 — when the panel becomes visible, it flips
     * `uiStateStore.visibleMenuKey = "dialogue"` so the runtime
     * mode resolver returns "dialogue" and only this panel's
     * actions are active. Cleared on hide. Optional so legacy
     * callers (tests, headless construction) still work.
     */
    uiStateStore?: import("../ui-state").UIStateStore;
  }
): RuntimeDialoguePanel {
  const entryDecorators = options?.entryDecorators ?? [];
  const onTermHover = options?.onTermHover ?? null;
  const onSelectionLookup = options?.onSelectionLookup ?? null;
  const actionRegistry = options?.actionRegistry;
  const uiStateStore = options?.uiStateStore;
  injectStyles();

  // ONE popover, reused. Creating a card per lookup leaks nodes over a long
  // conversation and makes "is a card open" unanswerable.
  let lookupCard: HTMLDivElement | null = null;

  function hideLookupCard(): void {
    if (lookupCard) {
      lookupCard.remove();
      lookupCard = null;
    }
  }

  function showLookupCard(
    result: { surface: string; gloss: string },
    anchor: DOMRect | null
  ): void {
    hideLookupCard();
    const card = document.createElement("div");
    card.className = "sm-dialogue-lookup-card";
    const term = document.createElement("span");
    term.className = "sm-dialogue-lookup-card-term";
    term.textContent = result.surface;
    const gloss = document.createElement("span");
    gloss.className = "sm-dialogue-lookup-card-gloss";
    gloss.textContent = result.gloss;
    card.append(term, gloss);
    if (anchor) {
      card.style.left = `${Math.round(anchor.left)}px`;
      card.style.top = `${Math.round(anchor.bottom + 6)}px`;
    }
    document.body.appendChild(card);
    lookupCard = card;
  }

  function handleSelectionLookup(event: {
    selection: string;
    anchor: DOMRect | null;
  }): void {
    if (!onSelectionLookup) return;
    const result = onSelectionLookup(event.selection);
    if (!result) {
      hideLookupCard();
      return;
    }
    showLookupCard(result, event.anchor);
  }

  // Any click that is not itself a new selection dismisses the card. Registered
  // once, not per card, so it cannot outlive the panel.
  document.addEventListener("mousedown", (mouseEvent) => {
    if (lookupCard && !lookupCard.contains(mouseEvent.target as Node)) {
      hideLookupCard();
    }
  });

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

  // Scripted dialogue gets its own presentation (small bottom-center box).
  // This object owns BOTH: the action-registry ids and the
  // `activeOverlayMenuKey` flag are single-owner (the registry throws on
  // duplicate ids), so the two presentations cannot each register their own.
  const scriptedBox: ScriptedDialogueBox = createScriptedDialogueBox(
    parentContainer,
    {
      onTermHover: onTermHover ?? undefined,
      onSelectionLookup: onSelectionLookup ? handleSelectionLookup : undefined
    }
  );
  let scriptedActive = false;

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
    const speaker = resolveDialogueSpeaker(speakerId, null);
    if (!speaker) return null;
    switch (speaker.kind) {
      case "player":
        return "player";
      case "player-vo":
        return "player-vo";
      case "excerpt":
        return "excerpt";
      // Narrator deliberately has no modifier class: narration renders with the
      // default entry styling. Called out explicitly because the previous
      // if-chain simply fell through, which read as an omission rather than a
      // decision. NPC lines likewise use the default.
      case "narrator":
      case "npc":
        return null;
    }
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

    // Shared with the scripted box so both presentations render identical
    // language enrichment (focus terms, glosses, bursts, hover telemetry).
    entry.appendChild(
      createTurnTextElement(turn, {
        onTermHover: onTermHover ?? undefined,
        onSelectionLookup: onSelectionLookup ? handleSelectionLookup : undefined
      })
    );
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
    if (input.kind === "quest_form") {
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

    if (currentInputMode === "quest_form") {
      // 081.8 -- form renders in the full-screen QuestFormOverlay React component.
      // Signal UIStateStore to open it; actions area stays empty.
      const formDef = isQuestFormDefinition(
        currentTurnMetadata?.["sugarlang.placementQuestionnaire"]
      )
        ? {
            ...(currentTurnMetadata!["sugarlang.placementQuestionnaire"] as QuestFormDefinition),
            formId:
              typeof currentTurnMetadata?.["sugarlang.placementQuestionnaireVersion"] ===
              "string"
                ? (currentTurnMetadata["sugarlang.placementQuestionnaireVersion"] as string)
                : "quest-form"
          }
        : null;
      uiStateStore?.setState({ questFormOpen: true, questFormDefinition: formDef });
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

  // Story 50.5 — dialogue keyboard shortcuts route through the
  // central registry against `modes: ["dialogue"]`. Three logical
  // bindings (Escape cancel, Enter advance, 1-9 choice pick),
  // expanded to 11 registrations because the registry matches a
  // single key per action. Each handler guards with the visible
  // check so dispose-without-hide doesn't leave stray listeners.
  // Free-text input mode still submits via the form's own submit
  // event (Enter inside the textarea is captured by
  // `textInput.addEventListener("keydown", ...)`'s stopPropagation;
  // the registry's `isInputContext` check would also bail).
  // quest_form input mode delegates to the React QuestFormOverlay;
  // keyboard shortcuts are guarded below to avoid conflicting.
  const unregisterActions: Array<() => void> = [];
  function isVisible() {
    return (
      container.classList.contains("visible") ||
      scriptedBox.element.classList.contains("visible")
    );
  }
  if (actionRegistry) {
    unregisterActions.push(
      actionRegistry.register({
        actionId: "runtime-dialogue-cancel",
        modes: ["dialogue"],
        key: "Escape",
        handler: (event) => {
          if (!isVisible()) return;
          event.preventDefault();
          onCancel?.();
        }
      })
    );
    unregisterActions.push(
      actionRegistry.register({
        actionId: "runtime-dialogue-advance",
        modes: ["dialogue"],
        key: "Enter",
        handler: (event) => {
          if (!isVisible()) return;
          if (scriptedActive) {
            // Scripted lines advance on Enter unless choices are showing.
            if (scriptedBox.getChoiceIds().length > 1) return;
            event.preventDefault();
            scriptedBox.submitAdvance();
            return;
          }
          // Free-text mode owns Enter via its own input element.
          // quest_form mode defers to the React overlay.
          if (currentInputMode === "free_text") return;
          if (currentInputMode === "quest_form") return;
          if (currentChoices.length > 1) return;
          event.preventDefault();
          submitInput({ kind: "advance" });
        }
      })
    );
    // Digit shortcuts 1-9 for multi-choice dialogue.
    for (let digit = 1; digit <= 9; digit += 1) {
      const choiceIndex = digit - 1;
      unregisterActions.push(
        actionRegistry.register({
          actionId: `runtime-dialogue-choice-${digit}`,
          modes: ["dialogue"],
          key: String(digit),
          handler: (event) => {
            if (!isVisible()) return;
            if (scriptedActive) {
              const ids = scriptedBox.getChoiceIds();
              if (choiceIndex >= ids.length) return;
              event.preventDefault();
              scriptedBox.submitChoice(ids[choiceIndex]!);
              return;
            }
            if (currentInputMode === "free_text") return;
            if (currentInputMode === "quest_form") return;
            if (choiceIndex >= currentChoices.length) return;
            event.preventDefault();
            submitInput({
              kind: "choice",
              choiceId: currentChoices[choiceIndex]!.choiceId
            });
          }
        })
      );
    }
  }

  return {
    getElement() {
      return container;
    },
    show() {
      // Deliberately does NOT reveal a presentation. Which box to show is not
      // known until showPending/showTurn supplies the conversationKind, and
      // revealing the chat panel here flashed it before a scripted
      // conversation swapped to the box. The manager always calls showPending
      // immediately after show(), and both pending paths reveal their own box.
      //
      // Story 50.5 — flip the UI state into "dialogue" mode so
      // the action registry routes Escape / Enter / 1-9 to this
      // panel and skips in-game shortcuts (inventory, journal,
      // etc.). Cleared on hide().
      uiStateStore?.setState({ activeOverlayMenuKey: "dialogue" });
    },
    hide() {
      scriptedBox.hide();
      scriptedActive = false;
      container.classList.remove("visible");
      activeContainer.innerHTML = "";
      actionsContainer.innerHTML = "";
      enrichmentContainer.innerHTML = "";
      inputContainer.innerHTML = "";
      entryCount = 0;
      stopCurrent();
      uiStateStore?.setState({ questFormOpen: false, questFormDefinition: null });
      // Story 50.5 — restore the in-game mode. If something else
      // had set activeOverlayMenuKey to a non-dialogue value before
      // this call, we'd clobber it — but in practice dialogue is
      // mutually exclusive with other overlay states (the
      // interaction system locks input first).
      if (uiStateStore?.getState().activeOverlayMenuKey === "dialogue") {
        uiStateStore.setState({ activeOverlayMenuKey: null });
      }
    },
    clearHistory() {
      scriptedBox.hide();
      historyContainer.innerHTML = "";
      activeContainer.innerHTML = "";
      actionsContainer.innerHTML = "";
      enrichmentContainer.innerHTML = "";
      inputContainer.innerHTML = "";
      entryCount = 0;
      uiStateStore?.setState({ questFormOpen: false, questFormDefinition: null });
    },
    showPending(options) {
      pendingSpeakerLabel = options?.speakerLabel ?? null;
      onCancel = options?.onCancel ?? null;
      // Decide the presentation up front so the pending state does not flash
      // in the wrong box before the first turn arrives.
      //
      // An ABSENT conversationKind means "carry on with whatever is showing",
      // not "switch to chat": showPending is also called mid-conversation on
      // every submit, and treating undefined as non-scripted flashed the chat
      // panel between scripted lines.
      if (options?.conversationKind) {
        scriptedActive = options.conversationKind === "scripted-dialogue";
      }
      if (scriptedActive) {
        container.classList.remove("visible");
        scriptedBox.show();
        scriptedBox.showPending(pendingSpeakerLabel);
        return;
      }
      scriptedBox.hide();
      graduateActive();
      stopCurrent();
      activeContainer.innerHTML = "";
      activeContainer.appendChild(createPendingEntry(pendingSpeakerLabel));
      container.classList.add("visible");
      scrollToBottom();
    },
    showTurn(turn, handleTurnInput, handleCancel) {
      // conversationKind is stable for the session; inputMode is NOT a valid
      // switch (an agent's closing turn reports "advance", which would snap a
      // chat into the scripted box and drop its visible history).
      scriptedActive = turn.conversationKind === "scripted-dialogue";
      if (scriptedActive) {
        onCancel = handleCancel ?? null;
        container.classList.remove("visible");
        scriptedBox.show();
        scriptedBox.showTurn(turn, handleTurnInput);
        return;
      }
      scriptedBox.hide();
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

      // 085.5: Render the teach-line annotation in the enrichment slot if present.
      const teachLine = readTeachLine(turn.annotations);
      enrichmentContainer.innerHTML = "";
      if (teachLine) {
        const el = document.createElement("p");
        el.className = "sm-dialogue-teach-line";
        el.textContent = `${teachLine.label}: ${teachLine.text}`;
        enrichmentContainer.appendChild(el);
      }

      container.classList.add("visible");
      scrollToBottom();
    },
    submitQuestFormResponse(response: ConversationQuestFormResponse) {
      uiStateStore?.setState({ questFormOpen: false, questFormDefinition: null });
      submitInput({ kind: "quest_form", response });
    },
    cancelQuestForm() {
      uiStateStore?.setState({ questFormOpen: false, questFormDefinition: null });
      onCancel?.();
    },
    dispose() {
      for (const unregister of unregisterActions) unregister();
      stopCurrent();
      scriptedBox.dispose();
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

    /* ---- Scripted presentation: small bottom-center box ---- */

    .sm-dialogue-box-container {
      position: absolute;
      left: 50%;
      /* Clears the HUD icon row that sits along the bottom edge. */
      bottom: 108px;
      transform: translateX(-50%) translateY(6px);
      width: min(680px, calc(100vw - 64px));
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.18s ease-out, transform 0.18s ease-out;
      z-index: 20;
    }

    .sm-dialogue-box-container.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }

    /* Speaker rides ABOVE the box as a pill, so the box itself stays short. */
    .sm-dialogue-box-speaker {
      position: relative;
      z-index: 1;
      margin-bottom: -10px;
      padding: 4px 16px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(180deg, rgba(36, 34, 56, 0.98), rgba(26, 24, 42, 0.98));
      color: #85c1e9;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
    }

    .sm-dialogue-box-speaker.is-empty {
      display: none;
    }

    .sm-dialogue-box {
      position: relative;
      width: 100%;
      min-height: 84px;
      padding: 18px 46px 16px 22px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(24, 24, 37, 0.94), rgba(17, 17, 27, 0.96));
      box-shadow: 0 18px 54px rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(20px);
      /* NOT overflow:hidden -- unlike the chat panel, this box is short and
         hover glosses open upward, so clipping would swallow them. */
    }

    .sm-dialogue-box .sm-dialogue-entry-text {
      color: rgba(240, 232, 223, 0.9);
      font-size: 16px;
      line-height: 1.6;
    }

    .sm-dialogue-box-enrichment:empty {
      display: none;
    }

    .sm-dialogue-box-choices:empty {
      display: none;
    }

    .sm-dialogue-box-choices {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 12px;
    }

    .sm-dialogue-box-choice {
      display: flex;
      align-items: baseline;
      gap: 10px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      color: rgba(240, 232, 223, 0.92);
      font-size: 15px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease-out, border-color 0.15s ease-out;
    }

    .sm-dialogue-box-choice:hover {
      background: rgba(137, 180, 250, 0.12);
      border-color: rgba(137, 180, 250, 0.35);
    }

    .sm-dialogue-box-choice .choice-number {
      color: rgba(249, 226, 175, 0.9);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    /* Advance chevron, bottom-right, pulsing only when a press would advance. */
    .sm-dialogue-box-advance {
      position: absolute;
      right: 18px;
      bottom: 12px;
      color: rgba(240, 232, 223, 0.35);
      font-size: 13px;
      opacity: 0;
      transition: opacity 0.15s ease-out;
    }

    .sm-dialogue-box-advance.is-ready {
      opacity: 1;
      animation: sm-dialogue-box-advance-pulse 1.6s ease-in-out infinite;
    }

    @keyframes sm-dialogue-box-advance-pulse {
      0%, 100% { opacity: 0.35; transform: translateX(0); }
      50% { opacity: 0.85; transform: translateX(2px); }
    }

    /* Referenced by both presentations since 085.5 but never defined. */
    .sm-dialogue-teach-line {
      margin: 10px 0 0;
      padding: 8px 10px;
      border-radius: 10px;
      border-left: 2px solid rgba(249, 226, 175, 0.5);
      background: rgba(249, 226, 175, 0.07);
      color: rgba(240, 232, 223, 0.78);
      font-size: 13px;
      line-height: 1.5;
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
    /* 090.12: the select-to-translate card. Deliberately NOT gold or blue --
       those two colours mean "the Teacher chose this word", and a lookup card
       is the player asking, not the curriculum telling. */
    .sm-dialogue-lookup-card {
      position: fixed;
      z-index: 60;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.4rem 0.6rem;
      border-radius: 0.35rem;
      background: rgba(24, 24, 37, 0.97);
      border: 1px solid rgba(205, 214, 244, 0.18);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      pointer-events: auto;
      max-width: 18rem;
    }

    .sm-dialogue-lookup-card-term {
      font-size: 0.75rem;
      color: rgba(205, 214, 244, 0.65);
    }

    .sm-dialogue-lookup-card-gloss {
      font-size: 0.95rem;
      color: #cdd6f4;
    }

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
