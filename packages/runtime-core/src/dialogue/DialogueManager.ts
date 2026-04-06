import type {
  DialogueDefinition,
  DialogueEdgeDefinition
} from "@sugarmagic/domain";
import {
  createConversationHost,
  createScriptedDialogueConversationProvider,
  type ConversationHost,
  type ConversationActionProposal,
  type ConversationMiddleware,
  type ConversationPlayerInput,
  type ConversationProvider,
  type ConversationSelectionContext,
  type ConversationTurnEnvelope,
  type DialogueConditionContext,
  type SpeakerNameResolver
} from "../conversation";

export interface DialogueSessionNode {
  nodeId: string;
  displayName?: string;
  speakerId?: string;
  speakerLabel?: string;
  text: string;
  onEnterEventId?: string;
  next: DialogueEdgeDefinition[];
}

export interface DialoguePresenter {
  show: () => void;
  hide: () => void;
  clearHistory: () => void;
  showPending: (options?: {
    speakerLabel?: string | null;
    inputPlaceholder?: string | null;
    onCancel?: () => void;
  }) => void;
  showTurn: (
    turn: ConversationTurnEnvelope,
    onInput: (input: ConversationPlayerInput) => void,
    onCancel?: () => void
  ) => void;
  dispose?: () => void;
}

export type DialogueEventHandler = (eventName: string) => void;
export type DialogueNodeHandler = (nodeId: string) => void;
export type DialogueTurnHandler = (
  turn: ConversationTurnEnvelope,
  proposedActions: ConversationActionProposal[]
) => void;

export class DialogueManager {
  private definitions: DialogueDefinition[] = [];
  private currentDialogueId: string | null = null;
  private currentNodeId: string | null = null;
  private onDialogueStart: (() => void) | null = null;
  private onDialogueEnd:
    | ((dialogueDefinitionId: string | null, reason: "completed" | "cancelled") => void)
    | null = null;
  private onEvent: DialogueEventHandler | null = null;
  private onNodeEnter: DialogueNodeHandler | null = null;
  private onTurn: DialogueTurnHandler | null = null;
  private speakerNameResolver: SpeakerNameResolver | null = null;
  private conditionContext: DialogueConditionContext = {};
  private conversationProviders: ConversationProvider[] = [];
  private conversationMiddlewares: ConversationMiddleware[] = [];
  private conversationHost: ConversationHost | null = null;
  private pending = false;
  private activeRequestId = 0;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly presenter: DialoguePresenter) {}

  private logDebug(event: string, payload?: Record<string, unknown>): void {
    console.info(`[dialogue] ${event}`, payload ?? {});
  }

  registerDefinition(definition: DialogueDefinition): void {
    const nextDefinitions = this.definitions.filter(
      (candidate) => candidate.definitionId !== definition.definitionId
    );
    nextDefinitions.push(definition);
    this.definitions = nextDefinitions;
  }

  registerDefinitions(definitions: DialogueDefinition[]): void {
    this.definitions = [...definitions];
  }

  setOnStart(handler: () => void): void {
    this.onDialogueStart = handler;
  }

  setOnEnd(
    handler: (dialogueDefinitionId: string | null, reason: "completed" | "cancelled") => void
  ): void {
    this.onDialogueEnd = handler;
  }

  setOnEvent(handler: DialogueEventHandler): void {
    this.onEvent = handler;
  }

  setOnNodeEnter(handler: DialogueNodeHandler): void {
    this.onNodeEnter = handler;
  }

  setOnTurn(handler: DialogueTurnHandler): void {
    this.onTurn = handler;
  }

  setSpeakerNameResolver(resolver: SpeakerNameResolver): void {
    this.speakerNameResolver = resolver;
  }

  setConditionContext(context: DialogueConditionContext): void {
    this.conditionContext = context;
  }

  setConversationProviders(providers: ConversationProvider[]): void {
    this.conversationProviders = [...providers];
  }

  setConversationMiddlewares(middlewares: ConversationMiddleware[]): void {
    this.conversationMiddlewares = [...middlewares];
  }

  isDialogueActive(): boolean {
    return this.pending || (this.conversationHost?.isSessionActive() ?? false);
  }

  getCurrentDialogueId(): string | null {
    return this.currentDialogueId;
  }

  private createConversationHost(): ConversationHost {
    return createConversationHost({
      providers: [
        createScriptedDialogueConversationProvider({
          definitions: this.definitions,
          conditionContext: this.conditionContext,
          speakerNameResolver: this.speakerNameResolver
        }),
        ...this.conversationProviders
      ],
      middlewares: this.conversationMiddlewares
    });
  }

  async start(definitionId: string): Promise<boolean> {
    return this.startConversation({
      conversationKind: "scripted-dialogue",
      dialogueDefinitionId: definitionId
    });
  }

  async startConversation(
    selection: ConversationSelectionContext
  ): Promise<boolean> {
    this.logDebug("start-conversation", {
      conversationKind: selection.conversationKind,
      dialogueDefinitionId: selection.dialogueDefinitionId ?? null,
      npcDefinitionId: selection.npcDefinitionId ?? null,
      npcDisplayName: selection.npcDisplayName ?? null,
      interactionMode: selection.interactionMode ?? null
    });
    if (this.isDialogueActive()) {
      this.logDebug("start-conversation-cancel-existing-session");
      this.end("cancelled");
    }

    const host = this.createConversationHost();
    const requestId = ++this.activeRequestId;
    this.pending = true;
    this.currentDialogueId = selection.dialogueDefinitionId ?? null;
    this.currentNodeId = null;
    this.presenter.clearHistory();
    this.presenter.show();
    this.presenter.showPending({
      speakerLabel: selection.npcDisplayName ?? null,
      onCancel: () => this.end("cancelled")
    });
    this.onDialogueStart?.();

    const initialTurn = await host.startSession(selection);
    if (requestId !== this.activeRequestId) {
      this.logDebug("start-conversation-stale-request", {
        requestId,
        activeRequestId: this.activeRequestId
      });
      return false;
    }
    this.pending = false;
    if (!initialTurn) {
      this.logDebug("start-conversation-no-initial-turn", {
        dialogueDefinitionId: selection.dialogueDefinitionId ?? null,
        conversationKind: selection.conversationKind
      });
      this.presenter.hide();
      this.currentDialogueId = null;
      this.currentNodeId = null;
      return false;
    }

    this.conversationHost = host;
    this.currentDialogueId = selection.dialogueDefinitionId ?? null;
    this.logDebug("start-conversation-initial-turn", {
      speakerLabel: initialTurn.speakerLabel ?? null,
      displayName: initialTurn.displayName ?? null,
      textPreview: initialTurn.text.slice(0, 120),
      proposedActionCount: initialTurn.proposedActions?.length ?? 0
    });
    this.presentTurn(initialTurn);
    return true;
  }

  end(reason: "completed" | "cancelled" = "completed"): void {
    this.logDebug("end-conversation", {
      reason,
      currentDialogueId: this.currentDialogueId,
      currentNodeId: this.currentNodeId,
      hasConversationHost: Boolean(this.conversationHost),
      pending: this.pending
    });
    this.activeRequestId += 1;
    this.pending = false;
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    const currentDialogueId = this.currentDialogueId;
    this.presenter.hide();
    this.currentDialogueId = null;
    this.currentNodeId = null;
    if (this.conversationHost) {
      void this.conversationHost.endSession();
    }
    this.conversationHost = null;
    this.onDialogueEnd?.(currentDialogueId, reason);
  }

  dispose(): void {
    this.end("cancelled");
    this.presenter.dispose?.();
  }

  private presentTurn(turn: ConversationTurnEnvelope): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    const nodeId =
      typeof turn.metadata?.nodeId === "string" ? turn.metadata.nodeId : null;
    const onEnterEventId =
      typeof turn.metadata?.onEnterEventId === "string"
        ? turn.metadata.onEnterEventId
        : null;
    const autoCloseAfterMs =
      typeof turn.metadata?.autoCloseAfterMs === "number" &&
      Number.isFinite(turn.metadata.autoCloseAfterMs) &&
      turn.metadata.autoCloseAfterMs > 0
        ? Math.floor(turn.metadata.autoCloseAfterMs)
        : null;

    this.currentNodeId = nodeId;
    this.logDebug("present-turn", {
      nodeId,
      speakerLabel: turn.speakerLabel ?? null,
      displayName: turn.displayName ?? null,
      textPreview: turn.text.slice(0, 120),
      autoCloseAfterMs
    });
    if (nodeId) {
      this.onNodeEnter?.(nodeId);
    }
    if (onEnterEventId) {
      this.onEvent?.(onEnterEventId);
    }

    this.onTurn?.(turn, turn.proposedActions ?? []);

    this.presenter.showTurn(
      turn,
      (input) => {
        void this.handleAdvance(input);
      },
      () => this.end("cancelled")
    );

    if (autoCloseAfterMs !== null) {
      this.autoCloseTimer = setTimeout(() => {
        this.autoCloseTimer = null;
        this.end("completed");
      }, autoCloseAfterMs);
    }
  }

  private async handleAdvance(input: ConversationPlayerInput): Promise<void> {
    if (this.pending) {
      this.logDebug("advance-ignored-pending", {
        currentDialogueId: this.currentDialogueId
      });
      return;
    }
    if (!this.conversationHost) {
      this.logDebug("advance-without-host", {
        currentDialogueId: this.currentDialogueId
      });
      this.end("completed");
      return;
    }
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    const requestId = ++this.activeRequestId;
    this.pending = true;
    this.logDebug("submit-input", {
      requestId,
      inputKind: input.kind,
      text:
        input.kind === "free_text"
          ? input.text.slice(0, 120)
          : null
    });
    this.presenter.showPending({
      speakerLabel:
        this.conversationHost.getCurrentTurn()?.speakerLabel ??
        this.conversationHost.getCurrentTurn()?.displayName ??
        this.currentDialogueId,
      onCancel: () => this.end("cancelled")
    });
    const nextTurn = await this.conversationHost.submitInput(input);
    if (requestId !== this.activeRequestId) {
      this.logDebug("submit-input-stale-request", {
        requestId,
        activeRequestId: this.activeRequestId
      });
      return;
    }
    this.pending = false;
    if (!nextTurn) {
      this.logDebug("submit-input-no-next-turn", {
        requestId
      });
      this.end("completed");
      return;
    }
    this.logDebug("submit-input-next-turn", {
      requestId,
      speakerLabel: nextTurn.speakerLabel ?? null,
      displayName: nextTurn.displayName ?? null,
      textPreview: nextTurn.text.slice(0, 120)
    });
    this.presentTurn(nextTurn);
  }
}
