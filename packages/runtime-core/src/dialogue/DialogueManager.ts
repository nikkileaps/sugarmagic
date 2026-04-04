import type {
  DialogueDefinition,
  DialogueEdgeDefinition
} from "@sugarmagic/domain";
import {
  createConversationHost,
  createScriptedDialogueConversationProvider,
  type ConversationHost,
  type ConversationMiddleware,
  type ConversationPlayerInput,
  type ConversationProvider,
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
  showTurn: (
    turn: ConversationTurnEnvelope,
    onInput: (input: ConversationPlayerInput) => void,
    onCancel?: () => void
  ) => void;
  dispose?: () => void;
}

export type DialogueEventHandler = (eventName: string) => void;
export type DialogueNodeHandler = (nodeId: string) => void;

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
  private speakerNameResolver: SpeakerNameResolver | null = null;
  private conditionContext: DialogueConditionContext = {};
  private conversationProviders: ConversationProvider[] = [];
  private conversationMiddlewares: ConversationMiddleware[] = [];
  private conversationHost: ConversationHost | null = null;

  constructor(private readonly presenter: DialoguePresenter) {}

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
    return this.conversationHost?.isSessionActive() ?? false;
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
    if (this.isDialogueActive()) {
      this.end("cancelled");
    }

    const host = this.createConversationHost();
    const initialTurn = await host.startSession({
      conversationKind: "scripted-dialogue",
      dialogueDefinitionId: definitionId
    });
    if (!initialTurn) {
      this.currentDialogueId = null;
      this.currentNodeId = null;
      return false;
    }

    this.conversationHost = host;
    this.currentDialogueId = definitionId;
    this.presenter.clearHistory();
    this.presenter.show();
    this.onDialogueStart?.();
    this.presentTurn(initialTurn);
    return true;
  }

  end(reason: "completed" | "cancelled" = "completed"): void {
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
    const nodeId =
      typeof turn.metadata?.nodeId === "string" ? turn.metadata.nodeId : null;
    const onEnterEventId =
      typeof turn.metadata?.onEnterEventId === "string"
        ? turn.metadata.onEnterEventId
        : null;

    this.currentNodeId = nodeId;
    if (nodeId) {
      this.onNodeEnter?.(nodeId);
    }
    if (onEnterEventId) {
      this.onEvent?.(onEnterEventId);
    }

    this.presenter.showTurn(
      turn,
      (input) => {
        void this.handleAdvance(input);
      },
      () => this.end("cancelled")
    );
  }

  private async handleAdvance(input: ConversationPlayerInput): Promise<void> {
    if (!this.conversationHost) {
      this.end("completed");
      return;
    }

    const nextTurn = await this.conversationHost.submitInput(input);
    if (!nextTurn) {
      this.end("completed");
      return;
    }
    this.presentTurn(nextTurn);
  }
}
