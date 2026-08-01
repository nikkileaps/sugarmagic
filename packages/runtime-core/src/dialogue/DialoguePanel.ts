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
import { createPaperPanel } from "./paper-panel";
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

  // Any click that is not itself a new selection dismisses the card.
  //
  // NAMED AND REMOVED IN `dispose()`. This was an anonymous listener with the
  // comment "registered once, not per card, so it cannot outlive the panel" --
  // which had it backwards: registering once on `document` is precisely what
  // made it outlive the panel, because nothing ever took it off. Every
  // conversation left another listener holding `lookupCard` and `hideLookupCard`
  // alive, and after dispose they fired against a panel that was gone.
  function handleDocumentMouseDown(mouseEvent: MouseEvent): void {
    if (lookupCard && !lookupCard.contains(mouseEvent.target as Node)) {
      hideLookupCard();
    }
  }
  document.addEventListener("mousedown", handleDocumentMouseDown);

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

  // Shown only when the player has scrolled up and something new arrived.
  const jumpButton = document.createElement("button");
  jumpButton.type = "button";
  jumpButton.className = "sm-dialogue-panel-jump";
  jumpButton.textContent = "New message \u2193";
  jumpButton.addEventListener("click", () => scrollToBottom(true));
  panel.appendChild(jumpButton);

  // Scrolling back down on their own dismisses it; no need to click.
  scrollArea.addEventListener("scroll", () => {
    if (isPinnedToBottom()) setJumpVisible(false);
  });

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
  /** One per rendered card. Disconnected on dispose so a long conversation
   *  does not leave an observer per message alive after the panel is gone. */
  const entryPaperObservers: ResizeObserver[] = [];
  let currentInputMode: ConversationTurnEnvelope["inputMode"] = "advance";
  /**
   * THE READING BEAT.
   *
   * A free-text turn arrives and the player should READ it before being asked
   * to write. So the NPC card lands alone with the advance arrow, and only when
   * they press Enter does the card rise and the input card appear beneath it.
   *
   * Rendering both at once (which is what this did first) puts a blinking
   * cursor under a line they have not read yet.
   */
  let awaitingReadAdvance = false;
  let currentInputPlaceholder = "";
  let onInput: ((input: ConversationPlayerInput) => void) | null = null;
  let onCancel: (() => void) | null = null;
  let textInput: HTMLTextAreaElement | null = null;
  let pendingSpeakerLabel: string | null = null;
  let currentTurnMetadata: Record<string, unknown> | undefined;

  function stopCurrent() {
    onInput = null;
    onCancel = null;
    currentChoices = [];
    currentInputMode = "advance";
    awaitingReadAdvance = false;
    currentInputPlaceholder = "";
    actionsContainer.innerHTML = "";
    enrichmentContainer.innerHTML = "";
    inputContainer.innerHTML = "";
    textInput = null;
    pendingSpeakerLabel = null;
    currentTurnMetadata = undefined;
  }

  /**
   * Anchors to the newest message -- UNLESS the player has scrolled up to
   * reread something.
   *
   * Yanking the view back down mid-read is the single most annoying thing a
   * chat stack can do, so a new message while scrolled up surfaces the jump
   * control instead and leaves the view where the player put it.
   */
  function scrollToBottom(force = false) {
    if (!force && !isPinnedToBottom()) {
      setJumpVisible(true);
      return;
    }
    scrollArea.scrollTop = scrollArea.scrollHeight;
    setJumpVisible(false);
  }

  /** Within a line's slack of the bottom counts as pinned. */
  function isPinnedToBottom(): boolean {
    const slack = 48;
    return (
      scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight <= slack
    );
  }

  function setJumpVisible(visible: boolean): void {
    jumpButton.classList.toggle("is-visible", visible);
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

  /**
   * Adds the paper card to an entry and returns it for content.
   *
   * The card is a SIBLING of the name chip rather than its parent: the chip
   * overlaps the card's top-left corner, and if it lived inside, the paper SVG
   * would paint over it.
   *
   * Each card owns its own PaperPanel because the deckled outline is generated
   * per size and per seed -- sharing one would make every message in the stack
   * an identical sheet, which reads as a repeated texture rather than paper.
   */
  function attachPaperCard(entry: HTMLElement): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "sm-dialogue-entry-card";
    const paper = createPaperPanel();
    card.appendChild(paper.element);
    entry.appendChild(card);

    const observer = new ResizeObserver(() => {
      const rect = card.getBoundingClientRect();
      paper.resize(rect.width, rect.height);
    });
    observer.observe(card);
    entryPaperObservers.push(observer);
    return card;
  }

  function createEntry(turn: ConversationTurnEnvelope): HTMLDivElement {
    for (const decorator of entryDecorators) {
      turn = decorator(turn);
    }

    const entry = document.createElement("div");
    entry.className = "sm-dialogue-entry";
    // NO left/right alternation any more. The stack is a single centred column
    // of paper cards; alternating them read as a chat app, which is the thing
    // this presentation moved away from.
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

    // The paper card. The name chip is a SIBLING above it, not a child, so it
    // can overlap the card's top-left corner without the paper painting over it.
    const card = attachPaperCard(entry);

    // Shared with the scripted box so both presentations render identical
    // language enrichment (focus terms, glosses, bursts, hover telemetry).
    card.appendChild(
      createTurnTextElement(turn, {
        onTermHover: onTermHover ?? undefined,
        onSelectionLookup: onSelectionLookup ? handleSelectionLookup : undefined
      })
    );
    return entry;
  }

  function createPendingEntry(speakerLabel: string | null): HTMLDivElement {
    const entry = document.createElement("div");
    // No `align-left`: that was the alternating-chat-bubble class, and its
    // `align-self: flex-start` made the thinking card shrink-wrap its three
    // motes instead of stretching to card width like every other entry.
    entry.className = "sm-dialogue-entry sm-dialogue-entry-pending";

    if (speakerLabel) {
      const speakerElement = document.createElement("div");
      speakerElement.className = "sm-dialogue-entry-speaker";
      speakerElement.textContent = speakerLabel;
      entry.appendChild(speakerElement);
    }

    const card = attachPaperCard(entry);

    const textElement = document.createElement("div");
    textElement.className = "sm-dialogue-entry-text sm-dialogue-entry-thinking";

    // Three drifting motes rather than chat dots. Scoped with its own class so
    // the scripted box's `.sm-dialogue-thinking-dots` is untouched.
    const motes = document.createElement("span");
    motes.className = "sm-dialogue-thinking-motes";
    motes.innerHTML = `
      <span class="sm-dialogue-thinking-mote"></span>
      <span class="sm-dialogue-thinking-mote"></span>
      <span class="sm-dialogue-thinking-mote"></span>
    `;

    textElement.appendChild(motes);
    card.appendChild(textElement);
    return entry;
  }

  function submitInput(input: ConversationPlayerInput) {
    const handler = onInput;
    if (input.kind === "free_text") {
      const trimmed = input.text.trim();
      if (!trimmed) return;
      // The live input card becomes a settled message. A brief purple pulse
      // confirms the send -- the same colour family as the name chip, so it
      // reads as "your card committed" rather than as an alert.
      const sentEntry = createEntry({
        turnId: `player:${crypto.randomUUID()}`,
        providerId: "runtime:player-input",
        conversationKind: "free-form",
        speakerId: PLAYER_SPEAKER.speakerId,
        speakerLabel: PLAYER_SPEAKER.displayName,
        text: trimmed,
        choices: []
      });
      sentEntry.classList.add("sm-dialogue-entry-sent");
      sentEntry.addEventListener(
        "animationend",
        () => sentEntry.classList.remove("sm-dialogue-entry-sent"),
        { once: true }
      );
      activeContainer.appendChild(sentEntry);
      // Force: the player just acted, so following their own message down is
      // wanted even if they had scrolled up.
      scrollToBottom(true);
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

    // Beat two onwards: the arrow has done its job. Leaving it pulsing while
    // the player types keeps telling them to press Enter to continue, which is
    // now the wrong instruction.
    if (!awaitingReadAdvance) {
      activeContainer
        .querySelectorAll(".sm-dialogue-entry-advance")
        .forEach((el) => el.remove());
    }

    if (currentInputMode === "free_text" && awaitingReadAdvance) {
      // Beat one: the NPC card alone, with the advance arrow. No input yet.
      const newest = activeContainer.querySelector<HTMLElement>(
        ".sm-dialogue-entry .sm-dialogue-entry-card"
      );
      if (newest && !newest.querySelector(".sm-dialogue-entry-advance")) {
        const arrow = document.createElement("div");
        arrow.className = "sm-dialogue-entry-advance is-ready";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "\u25B6";
        newest.appendChild(arrow);
      }
      return;
    }

    if (currentInputMode === "free_text") {
      // THE PLAYER CARD. Same paper as an NPC message -- the only difference is
      // that it holds a live input instead of settled text. It sits at the
      // bottom of the stack so the NPC's exact wording stays readable directly
      // above while the player composes.
      const playerEntry = document.createElement("div");
      playerEntry.className = "sm-dialogue-entry sm-dialogue-entry-player-input";
      const playerChip = document.createElement("div");
      playerChip.className = "sm-dialogue-entry-speaker";
      // displayName is a UI label, which is exactly what a chip is. The panel
      // already uses PLAYER_SPEAKER for the submitted turn's speakerId, so the
      // input card and the message it becomes carry the same name.
      playerChip.textContent = PLAYER_SPEAKER.displayName;
      playerEntry.appendChild(playerChip);
      const playerCard = attachPaperCard(playerEntry);

      const form = document.createElement("form");
      form.className = "sm-dialogue-input-form";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!textInput) return;
        submitInput({ kind: "free_text", text: textInput.value });
      });

      textInput = document.createElement("textarea");
      textInput.className = "sm-dialogue-text-input";
      // ONE ROW, GROWING. It was 3, which made the input card 180px of a 244px
      // budget -- 93% of the conversation's whole height allowance for an empty
      // box. The description asks for a box that "expands vertically if the
      // typed response wraps", so it starts at one line and grows to fit.
      textInput.rows = 1;
      textInput.placeholder = currentInputPlaceholder || "Type your response...";
      const autoGrow = () => {
        if (!textInput) return;
        textInput.style.height = "auto";
        // Capped so a long reply cannot reclaim the space this change freed.
        textInput.style.height = `${Math.min(textInput.scrollHeight, 132)}px`;
      };
      textInput.addEventListener("input", autoGrow);
      queueMicrotask(autoGrow);

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
      playerCard.appendChild(form);
      inputContainer.appendChild(playerEntry);
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
          // Beat one -> beat two: Enter promotes the reading beat into the
          // input card. Only after that does free-text own Enter.
          if (currentInputMode === "free_text" && awaitingReadAdvance) {
            event.preventDefault();
            awaitingReadAdvance = false;
            renderActions();
            scrollToBottom(true);
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
      // Re-armed per NPC turn: every new line gets read before it gets answered.
      awaitingReadAdvance = currentInputMode === "free_text";
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
      // Both halves of select-to-translate: the document listener, and a card
      // that is parented to document.body rather than to this panel -- so
      // removing the container below would NOT take it with it, and a lookup
      // card left open at dispose would simply stay on screen forever.
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      for (const observer of entryPaperObservers) observer.disconnect();
      entryPaperObservers.length = 0;
      hideLookupCard();
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
    /* runtime-core must not inherit the host's reset. The web target happens to
       set "* { box-sizing: border-box }" globally, and every width here is
       written assuming it -- a card is "width: 100%" PLUS padding, so under
       content-box the cards overflow their panel and each padding variant
       comes out a different width. Declare it locally so the component is
       correct in any host (and in a bare harness). */
    .sm-dialogue-panel-container,
    .sm-dialogue-panel-container *,
    .sm-dialogue-panel-container *::before,
    .sm-dialogue-panel-container *::after,
    .sm-dialogue-box-container,
    .sm-dialogue-box-container *,
    .sm-dialogue-box-container *::before,
    .sm-dialogue-box-container *::after {
      box-sizing: border-box;
    }

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
      /* flex-start, not center: the name chip is LEFT-anchored and overlaps
         the panel's top-left corner. The panel stretches back to full width
         below. */
      align-items: flex-start;
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

    /* NAME CHIP. Rides above the paper and overlaps its top-left corner.
       Spec settled in docs/prototypes/paper-dialogue-box-FINAL.html.
       Deliberately CLEAN-edged against the rough paper -- a printed label
       pinned to a torn sheet. Do not roughen it to match. */
    .sm-dialogue-box-speaker {
      position: relative;
      z-index: 2;
      width: fit-content;
      margin-left: 18px;
      margin-bottom: -14px;
      padding: 7px 15px;
      border-radius: 13px;
      border: 2.5px solid #d9b264;
      background: linear-gradient(180deg, #5d2a55, #4a2145);
      color: #f7ead9;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.13);
    }

    .sm-dialogue-box-speaker.is-empty {
      display: none;
    }

    /* PAPER PANEL. The background is an SVG layer (paper-panel.ts), NOT a CSS
       background -- a deckled edge cannot be expressed as border-radius. So
       this element is transparent and the paper is painted behind it.
       drop-shadow (not box-shadow) so the shadow follows the torn silhouette
       rather than a rectangle. */
    .sm-dialogue-box {
      position: relative;
      align-self: stretch;
      width: 100%;
      min-height: 86px;
      /* NOTE the spaces around + . CSS calc requires them, and a var()
         substitution failure falls back to the property's INITIAL value, not
         to the shorthand -- which silently zeroes the top padding and slides
         the first line of text under the name chip. */
      padding: 28px 28px 28px 28px;
      padding-top: 34px;
      background: transparent;
      border: none;
      filter: drop-shadow(0 9px 16px rgba(0, 0, 0, 0.40));
      /* NOT overflow:hidden -- unlike the chat panel, this box is short and
         hover glosses open upward, so clipping would swallow them. */
    }

    .sm-dialogue-box-paper {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      overflow: visible;
      pointer-events: none;
    }

    /* Everything above the paper. */
    .sm-dialogue-box-body,
    .sm-dialogue-box-enrichment,
    .sm-dialogue-box-choices,
    .sm-dialogue-box-advance {
      position: relative;
      z-index: 1;
    }

    /* Ink on paper: the scripted box flipped from light-on-dark to
       dark-on-cream, so text colours are re-specified here rather than
       inherited from the chat panel's palette. */
    .sm-dialogue-box .sm-dialogue-entry-text {
      color: #2f2620;
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
      font-size: 17px;
      line-height: 1.5;
    }

    .sm-dialogue-box-speaker {
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
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

    /* Choices sit ON the paper, so these are dark-on-cream. The chat panel
       keeps its own light-on-dark choice styling. */
    .sm-dialogue-box-choice {
      display: flex;
      align-items: baseline;
      gap: 10px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid rgba(90, 62, 24, 0.22);
      background: rgba(120, 84, 32, 0.06);
      color: #33291f;
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
      font-size: 15px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease-out, border-color 0.15s ease-out;
    }

    .sm-dialogue-box-choice:hover {
      background: rgba(120, 84, 32, 0.14);
      border-color: rgba(90, 62, 24, 0.45);
    }

    .sm-dialogue-box-choice .choice-number {
      color: #8a5a12;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    /* Advance chevron, bottom-right, pulsing only when a press would advance. */
    .sm-dialogue-box-advance {
      position: absolute;
      right: 18px;
      bottom: 12px;
      color: #b5762a;
      font-size: 15px;
      opacity: 0;
      transition: opacity 0.15s ease-out;
    }

    .sm-dialogue-box-advance.is-ready {
      opacity: 1;
      animation: sm-dialogue-box-advance-pulse 1.6s ease-in-out infinite;
    }

    @keyframes sm-dialogue-box-advance-pulse {
      0%, 100% { opacity: 0.55; transform: translateX(0); }
      50% { opacity: 1; transform: translateX(2px); }
    }

    /* HIGHLIGHTS ON PAPER -- scoped to .sm-dialogue-box ONLY.
       MEANING IS UNCHANGED and must stay that way: gold = introduce (new),
       blue = reinforce (review), and the celebrate animation is the same
       keyframes. Only the VALUES move, because the originals are tuned for the
       dark chat panel and wash out on cream.
       The free-form DialoguePanel keeps the originals untouched.

       Colour alone was not enough -- three other properties carry light-on-dark
       values and all three had to move too, or the word renders dark with a
       pale halo and an invisible underline:
         text-shadow   a light glow that hazes the ink on cream
         border-bottom the underline, light gold on light paper
         box-shadow    the inset "highlighter" bar behind the word */
    .sm-dialogue-box .sm-dialogue-focus-term-introduce,
    .sm-dialogue-entry-card .sm-dialogue-focus-term-introduce {
      color: #8a5a00;
      text-shadow: none;
    }

    .sm-dialogue-box .sm-dialogue-focus-term-introduce .sm-dialogue-focus-term-text,
    .sm-dialogue-entry-card .sm-dialogue-focus-term-introduce .sm-dialogue-focus-term-text {
      border-bottom: 1px solid rgba(138, 90, 0, 0.45);
      box-shadow: inset 0 -0.18em 0 rgba(176, 120, 0, 0.16);
    }

    .sm-dialogue-box .sm-dialogue-focus-term-reinforce,
    .sm-dialogue-entry-card .sm-dialogue-focus-term-reinforce {
      color: #1f5f86;
      text-shadow: none;
    }

    /* Celebrate: same keyframes, paper-appropriate colours. */
    .sm-dialogue-box .sm-dialogue-focus-term-celebrate .sm-dialogue-focus-term-text,
    .sm-dialogue-entry-card .sm-dialogue-focus-term-celebrate .sm-dialogue-focus-term-text {
      border-bottom-color: rgba(176, 120, 0, 0.9);
      box-shadow: inset 0 -0.2em 0 rgba(214, 158, 40, 0.34);
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

    /* Same element on paper: the chat-panel colours above are invisible here. */
    /* Compact: this sat as a full-width row costing ~40px of a 34vh budget
       for the least valuable thing on screen. */
    .sm-dialogue-panel-enrichment .sm-dialogue-teach-line {
      margin: 6px 0 0;
      padding: 5px 10px;
      font-size: 12px;
      line-height: 1.35;
      opacity: 0.85;
    }

    .sm-dialogue-box .sm-dialogue-teach-line,
    .sm-dialogue-entry-card .sm-dialogue-teach-line {
      border-left-color: rgba(138, 90, 18, 0.55);
      background: rgba(138, 90, 18, 0.08);
      color: #4a3c2a;
    }

    .sm-dialogue-panel-container.visible {
      opacity: 1;
      pointer-events: auto;
    }

    /* AGENT PANEL AS A BOTTOM-CENTRE STACK.
       Was a right-hand chat column. It is now the same place and the same
       paper material as the scripted box, so the two presentations read as one
       game rather than two apps. The panel itself is now INVISIBLE -- it is
       just a positioned, scrollable region; every visible surface is a paper
       card inside it. */
    .sm-dialogue-panel {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      /* The HUD is hidden during dialogue, so the stack sits low rather than
         clearing an icon row that is not there. */
      bottom: 28px;
      /* THE BOTTOM THIRD, AND NOT MORE. This was 58vh, which is what buried
         the characters -- the conversation obscured the two people having it.
         Everything below (tighter padding, smaller history, clamped older
         cards) exists to keep 2-3 messages readable inside this budget. */
      max-height: 34vh;
      width: min(680px, calc(100vw - 64px));
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      border-radius: 0;
      border: none;
      background: transparent;
      box-shadow: none;
      overflow: visible;
      /* NO backdrop-filter. It survived the switch to a transparent panel and
         became a blurred rectangle behind the cards -- previously invisible
         only because a solid background sat on top of it. The stack must read
         as paper floating over the scene, with nothing behind it. */
      backdrop-filter: none;
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
      flex: 1 1 auto;
      /* A floor, so a growing input cannot squeeze the messages to nothing --
         which is exactly what happened at rows=3 (38px left for the thread). */
      min-height: 96px;
      overflow-y: auto;
      overflow-x: visible;
      /* Top room is for the chips, which hang ABOVE their cards. The left and
         right insets must stay EQUAL, and equal to the input/enrichment/actions
         insets below -- they are what centres the cards under the panel, and
         the panel is what is centred on screen. */
      padding: 34px 8px 4px;
      /* Without this, a platform with classic (space-taking) scrollbars steals
         width from the right of the thread only, shifting every message card
         left of the input card. A no-op where scrollbars overlay, e.g. macOS. */
      scrollbar-gutter: stable both-edges;
      /* Softens the top edge when the deck is tall enough to scroll. Short --
         22px used to be right when a full card could be guillotined here, but
         the deck's slivers are only 14px each, so a long fade washed out the
         top two into smudges rather than reading as stacked paper. */
      -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 8px, #000 100%);
      mask-image: linear-gradient(to bottom, transparent 0, #000 8px, #000 100%);
      scrollbar-width: thin;
      scrollbar-color: rgba(217, 178, 100, 0.35) transparent;
    }
    .sm-dialogue-panel-scroll::-webkit-scrollbar { width: 6px; }
    .sm-dialogue-panel-scroll::-webkit-scrollbar-thumb {
      background: rgba(217, 178, 100, 0.30);
      border-radius: 3px;
    }
    .sm-dialogue-panel-scroll::-webkit-scrollbar-track { background: transparent; }

    .sm-dialogue-panel-history,
    .sm-dialogue-panel-active {
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow: visible;
    }

    /* ---- the stack: paper cards, newest at the bottom ---- */

    .sm-dialogue-entry {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      overflow: visible;
      /* Each card rises into place rather than appearing. */
      animation: sm-dialogue-entry-rise 0.26s cubic-bezier(0.22, 1, 0.36, 1);
    }

    @keyframes sm-dialogue-entry-rise {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ---- HISTORY IS A DECK ----
       Older cards tuck BEHIND the current one, vertical-carousel style: each
       keeps only a peeking sliver of its top edge and the rest of the card
       runs on underneath, hidden by whatever sits in front of it.

       WHY A FIXED HEIGHT AND NOT A NEGATIVE MARGIN
         The sliver has to be the same size for every card, and cards are 1-3
         lines tall. A negative margin would have to know each card's height,
         which CSS cannot do. Fixing the entry's height instead makes the peek
         constant and lets the card overflow.

       WHY THE OVERFLOW IS CLIPPED
         Left visible, a tall old card runs PAST a short card in front of it and
         its text pokes out the bottom. Clipping cuts it flat -- and the flat
         cut is exactly what the next card covers, so it is never seen. The
         card's deckled TOP edge, which is the part on show, is untouched.

       WHY EACH CARD IS WIDER THAN THE ONE BEHIND IT
         The cut edge is only hidden if the card in front is wider than the card
         behind. Scale must therefore grow monotonically toward the front; the
         active card, unscaled, is widest and covers the last sliver. Reversing
         these numbers exposes every cut edge at once. */
    .sm-dialogue-panel-history {
      /* The deck sets its own spacing via the sliver height. */
      gap: 0;
    }

    .sm-dialogue-panel-history .sm-dialogue-entry {
      overflow: hidden;
      transform-origin: center top;
      /* "transform" alone makes each entry its own stacking context, so a later
         sibling paints over an earlier one -- which is what puts newer cards in
         FRONT without hand-managing z-index per card. */
      transition: transform 0.25s ease-out, height 0.25s ease-out;
      animation: none;
    }

    /* THE REVEAL IS GRADUATED, NOT CONSTANT.
       An equal sliver for every card is a STACK; a carousel shows the card just
       behind the front one nearly whole, and hides each one further back a
       little more. These heights are what is left VISIBLE of each card -- the
       rest runs on underneath, covered by the card in front.

       Cutting through a line of text is fine here and is the whole effect: the
       cut itself is always hidden behind the next card's deckled top edge, so
       it reads as paper tucked under paper, not as clipped text. That only
       holds while each card is WIDER than the one behind it -- see below.

       The card DIRECTLY behind the front one is deliberately generous: 48px is
       about half of a three-line card and the whole of a one-line one, so the
       last thing said stays readable rather than being a hint. The two behind
       it stay peeks -- 17 and 10 -- because they are depth cues, and because
       every pixel here comes out of the height budget. */
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(1) {
      height: 48px;
      transform: scale(0.985);
    }
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(2) {
      height: 17px;
      transform: scale(0.96);
    }
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(3) {
      height: 10px;
      transform: scale(0.935);
    }

    /* THREE BEHIND THE FRONT CARD, AND NO MORE.
       Not just visual tidiness: this is what BOUNDS the deck. Without it the
       deck grows by one card per turn and a long conversation walks back out of
       the height budget the whole layout exists to respect. Three reveals sum
       to 81px no matter how long the thread gets. */
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(n + 4) {
      display: none;
    }
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(1)
      .sm-dialogue-entry-card {
      filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.30)) brightness(0.97);
    }
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(2)
      .sm-dialogue-entry-card {
      filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.30)) brightness(0.90);
    }
    .sm-dialogue-panel-history .sm-dialogue-entry:nth-last-child(3)
      .sm-dialogue-entry-card {
      filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.30)) brightness(0.83);
    }

    /* The chip names a card you cannot read; at 14px it is noise, and it costs
       more height than the sliver it would sit on. */
    .sm-dialogue-panel-history .sm-dialogue-entry-speaker {
      display: none;
    }

    /* NOTE: the per-depth rules below each set "filter" in full, shadow
       included. A card's normal shadow is offset 9px and blurred 16, which
       lands it squarely on the 14px sliver in front of it; stacked, that buries
       the deck. Each sliver needs only enough shadow to separate it from its
       neighbour, so every depth rule carries the same tight drop-shadow. */

    /* The current turn is unscaled and paints over the whole deck. */
    .sm-dialogue-panel-active {
      position: relative;
      z-index: 1;
    }

    .sm-dialogue-entry-speaker {
      position: relative;
      z-index: 2;
      width: fit-content;
      margin-left: 18px;
      margin-bottom: -14px;
      padding: 7px 15px;
      border-radius: 13px;
      border: 2.5px solid #d9b264;
      background: linear-gradient(180deg, #5d2a55, #4a2145);
      color: #f7ead9;
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 3px 10px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.13);
    }

    /* The paper card. Transparent element; the SVG behind it is the paper. */
    .sm-dialogue-entry-card {
      position: relative;
      align-self: stretch;
      width: 100%;
      /* Trimmed from 28/34 and min-height 76. Roughly 18px per card, which is
         a whole extra message inside a 34vh budget. */
      min-height: 0;
      padding: 18px 22px 20px;
      padding-top: 26px;
      background: transparent;
      filter: drop-shadow(0 9px 16px rgba(0,0,0,0.40));
    }

    .sm-dialogue-entry-card > .sm-dialogue-box-paper {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      overflow: visible;
      pointer-events: none;
    }

    /* Lifts content above the paper. The advance arrow is EXCLUDED: it
       positions itself absolutely, and this rule out-specifies it (0,2,0 beats
       0,1,0), which dropped it into normal flow at the bottom-left. */
    .sm-dialogue-entry-card > *:not(.sm-dialogue-box-paper):not(.sm-dialogue-entry-advance) {
      position: relative;
      z-index: 1;
    }

    /* Ink on paper, matching the scripted box. */
    .sm-dialogue-entry-card .sm-dialogue-entry-text {
      color: #2f2620;
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
      font-size: 17px;
      line-height: 1.45;
    }

    .sm-dialogue-panel-enrichment:empty,
    .sm-dialogue-panel-actions:empty {
      display: none;
    }

    /* Both of these sit in the same column as the message cards, so their
       horizontal insets match ".sm-dialogue-panel-scroll" too. */
    .sm-dialogue-panel-enrichment {
      padding: 0 8px 8px;
    }

    .sm-dialogue-panel-actions {
      padding: 8px 8px 6px;
      /* No border-top, same reason as ".sm-dialogue-panel-input". */
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sm-dialogue-panel-input:empty {
      display: none;
    }

    .sm-dialogue-panel-input {
      /* Horizontal insets MUST match ".sm-dialogue-panel-scroll" or the input
         card's left edge steps away from the message cards above it. The
         bottom inset only has to clear the card's drop-shadow; the panel's
         own "bottom" lifts the stack off the viewport edge. */
      padding: 4px 8px 6px;
      /* No border-top. That was the chat panel's divider, and on a
         transparent panel it read as a hairline drawn across the scene. */
    }

    /* The old chat-panel rules for ".sm-dialogue-entry" and
       ".sm-dialogue-entry-speaker" are GONE. Both were SECOND rules on
       selectors already styled above for the paper stack, at equal specificity
       and later in the sheet, so both silently won:
         - speaker  -> rendered every chip as "HORACE PENNYFEATHER"
         - entry    -> "max-width: 82%" left ~130px dead on the panel's right,
                       reading as the whole conversation being off-centre, and
                       "gap: 4px" ate 4px of the 14px chip overlap.
       If a card ever looks narrow or off-centre again, grep this file for a
       duplicate selector before touching any width. */

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

    .sm-dialogue-entry-card .sm-dialogue-entry-thinking {
      color: rgba(47, 38, 32, 0.72);
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


    /* The advance arrow during the reading beat. Same glyph, same pulse
       keyframes as the scripted box -- it is the same affordance, so it should
       not be a second animation that drifts out of sync with it. */
    .sm-dialogue-entry-advance {
      position: absolute;
      right: 18px;
      bottom: 12px;
      z-index: 1;
      color: #b5762a;
      font-size: 15px;
      opacity: 0;
      transition: opacity 0.15s ease-out;
    }
    .sm-dialogue-entry-advance.is-ready {
      opacity: 1;
      animation: sm-dialogue-box-advance-pulse 1.6s ease-in-out infinite;
    }

    /* ---- thinking: three drifting motes, not chat dots ---- */
    .sm-dialogue-thinking-motes {
      display: inline-flex;
      align-items: center;
      gap: 9px;
    }
    .sm-dialogue-thinking-mote {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #c9a3e0, #6d3a86);
      box-shadow: 0 0 8px rgba(160, 96, 200, 0.55);
      animation: sm-dialogue-mote-drift 2.1s ease-in-out infinite;
    }
    .sm-dialogue-thinking-mote:nth-child(2) { animation-delay: 0.35s; }
    .sm-dialogue-thinking-mote:nth-child(3) { animation-delay: 0.7s; }

    @keyframes sm-dialogue-mote-drift {
      0%, 100% { transform: translateY(0) scale(0.9); opacity: 0.45; }
      50%      { transform: translateY(-5px) scale(1.12); opacity: 1; }
    }

    /* ---- the player's card: paper with a live input ---- */
    .sm-dialogue-entry-player-input .sm-dialogue-input-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Tighter than a message card: this one holds a control, not prose. */
    .sm-dialogue-entry-player-input .sm-dialogue-entry-card {
      padding: 14px 20px 12px;
      padding-top: 24px;
    }
    .sm-dialogue-entry-player-input .sm-dialogue-input-footer {
      margin-top: 2px;
    }

    .sm-dialogue-entry-card .sm-dialogue-text-input {
      width: 100%;
      /* The unscoped rule's "padding: 12px 14px" leaks in here, and it is not
         free space: auto-grow sets height from scrollHeight, so the padding is
         24px of dead height under a single line of text, and the 14px pushed
         the typed text out of line with the hint row directly beneath it. The
         paper card already supplies the inset. */
      padding: 0;
      min-height: 26px;
      max-height: 132px;
      overflow-y: auto;
      resize: none;
      border: none;
      outline: none;
      background: transparent;
      color: #2f2620;
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
      font-size: 17px;
      line-height: 1.5;
      caret-color: #6d3a86;
    }
    .sm-dialogue-entry-card .sm-dialogue-text-input::placeholder {
      color: rgba(47, 38, 32, 0.42);
    }

    .sm-dialogue-entry-card .sm-dialogue-text-hint {
      color: rgba(47, 38, 32, 0.52);
      font-size: 12px;
    }
    .sm-dialogue-entry-card .sm-dialogue-key-hint {
      border-color: rgba(90, 62, 24, 0.28);
      background: rgba(120, 84, 32, 0.10);
      color: rgba(47, 38, 32, 0.72);
    }

    /* Confirmation when the player sends: a brief purple pulse on the card
       they just committed. Added by submitInput, removed when it ends. */
    .sm-dialogue-entry-sent .sm-dialogue-entry-card {
      animation: sm-dialogue-sent-pulse 0.5s ease-out;
    }
    @keyframes sm-dialogue-sent-pulse {
      0%   { filter: drop-shadow(0 9px 16px rgba(0,0,0,0.40)); }
      45%  { filter: drop-shadow(0 0 14px rgba(150, 92, 190, 0.75))
                     drop-shadow(0 9px 16px rgba(0,0,0,0.40)); }
      100% { filter: drop-shadow(0 9px 16px rgba(0,0,0,0.40)); }
    }

    /* ---- "jump to newest" when the player has scrolled up ---- */
    .sm-dialogue-panel-jump {
      position: absolute;
      left: 50%;
      bottom: -14px;
      transform: translateX(-50%) translateY(6px);
      padding: 6px 14px;
      border-radius: 999px;
      border: 2px solid #d9b264;
      background: linear-gradient(180deg, #5d2a55, #4a2145);
      color: #f7ead9;
      font-family: ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease-out, transform 0.18s ease-out;
      z-index: 5;
    }
    .sm-dialogue-panel-jump.is-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
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
