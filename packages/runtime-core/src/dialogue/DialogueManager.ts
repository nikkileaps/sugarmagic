import type {
  DialogueCondition,
  DialogueDefinition,
  DialogueEdgeDefinition,
  DialogueNodeDefinition
} from "@sugarmagic/domain";

export interface DialogueConditionContext {
  hasFlag?: (key: string, value?: unknown) => boolean;
  hasItem?: (itemId: string, count?: number) => boolean;
  isQuestActive?: (questId: string) => boolean;
  isQuestCompleted?: (questId: string) => boolean;
  getQuestStageState?: (
    questId: string,
    stageId: string
  ) => "active" | "completed" | null;
}

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
  showNode: (
    node: DialogueSessionNode,
    onComplete: (selected?: DialogueEdgeDefinition) => void,
    onCancel?: () => void
  ) => void;
  dispose?: () => void;
}

export type DialogueEventHandler = (eventName: string) => void;
export type DialogueNodeHandler = (nodeId: string) => void;
export type SpeakerNameResolver = (speakerId: string) => string | undefined;

function evaluateDialogueCondition(
  condition: DialogueCondition,
  context: DialogueConditionContext
): boolean {
  switch (condition.type) {
    case "flag":
      return context.hasFlag?.(condition.key, condition.value) ?? false;
    case "hasItem":
      return context.hasItem?.(condition.itemId, condition.count) ?? false;
    case "questActive":
      return context.isQuestActive?.(condition.questId) ?? false;
    case "questCompleted":
      return context.isQuestCompleted?.(condition.questId) ?? false;
    case "questStage":
      return (
        context.getQuestStageState?.(condition.questId, condition.stageId) ===
        condition.state
      );
    case "not":
      return !evaluateDialogueCondition(condition.condition, context);
    default:
      return false;
  }
}

function resolveNodeDisplay(
  node: DialogueNodeDefinition,
  speakerNameResolver: SpeakerNameResolver | null
): DialogueSessionNode {
  let speakerLabel = node.speakerLabel;
  if (!speakerLabel && node.speakerId && speakerNameResolver) {
    speakerLabel = speakerNameResolver(node.speakerId);
  }

  return {
    nodeId: node.nodeId,
    displayName: node.displayName,
    speakerId: node.speakerId,
    speakerLabel,
    text: node.text,
    onEnterEventId: node.onEnterEventId,
    next: [...node.next]
  };
}

export class DialogueManager {
  private definitions = new Map<string, DialogueDefinition>();
  private currentDialogue: DialogueDefinition | null = null;
  private currentNode: DialogueNodeDefinition | null = null;
  private onDialogueStart: (() => void) | null = null;
  private onDialogueEnd:
    | ((dialogueDefinitionId: string | null, reason: "completed" | "cancelled") => void)
    | null = null;
  private onEvent: DialogueEventHandler | null = null;
  private onNodeEnter: DialogueNodeHandler | null = null;
  private speakerNameResolver: SpeakerNameResolver | null = null;
  private conditionContext: DialogueConditionContext = {};

  constructor(private readonly presenter: DialoguePresenter) {}

  registerDefinition(definition: DialogueDefinition): void {
    this.definitions.set(definition.definitionId, definition);
  }

  registerDefinitions(definitions: DialogueDefinition[]): void {
    this.definitions.clear();
    for (const definition of definitions) {
      this.registerDefinition(definition);
    }
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

  isDialogueActive(): boolean {
    return Boolean(this.currentDialogue && this.currentNode);
  }

  getCurrentDialogueId(): string | null {
    return this.currentDialogue?.definitionId ?? null;
  }

  start(definitionId: string): boolean {
    if (this.isDialogueActive()) {
      this.end("cancelled");
    }

    const dialogue = this.definitions.get(definitionId);
    if (!dialogue) {
      return false;
    }

    this.currentDialogue = dialogue;
    this.presenter.clearHistory();
    this.presenter.show();
    this.onDialogueStart?.();

    const startNode = dialogue.nodes.find((node) => node.nodeId === dialogue.startNodeId);
    if (!startNode) {
      this.end("cancelled");
      return false;
    }

    this.showNode(startNode);
    return true;
  }

  end(reason: "completed" | "cancelled" = "completed"): void {
    const currentDialogueId = this.currentDialogue?.definitionId ?? null;
    this.presenter.hide();
    this.currentDialogue = null;
    this.currentNode = null;
    this.onDialogueEnd?.(currentDialogueId, reason);
  }

  dispose(): void {
    this.end("cancelled");
    this.presenter.dispose?.();
  }

  private showNode(node: DialogueNodeDefinition): void {
    this.currentNode = node;
    this.onNodeEnter?.(node.nodeId);
    if (node.onEnterEventId) {
      this.onEvent?.(node.onEnterEventId);
    }

    const next = node.next.filter((edge) => {
      if (!edge.condition) return true;
      return evaluateDialogueCondition(edge.condition, this.conditionContext);
    });

    const displayNode = resolveNodeDisplay(
      {
        ...node,
        next
      },
      this.speakerNameResolver
    );

    this.presenter.showNode(
      displayNode,
      (selected) => this.handleAdvance(selected),
      () => this.end("cancelled")
    );
  }

  private handleAdvance(selected?: DialogueEdgeDefinition): void {
    if (!this.currentDialogue || !this.currentNode) {
      this.end("completed");
      return;
    }

    const nextNodeId = selected?.targetNodeId ?? this.currentNode.next[0]?.targetNodeId;
    if (!nextNodeId) {
      this.end("completed");
      return;
    }

    const nextNode = this.currentDialogue.nodes.find(
      (candidate) => candidate.nodeId === nextNodeId
    );
    if (!nextNode) {
      this.end("completed");
      return;
    }

    this.showNode(nextNode);
  }
}
