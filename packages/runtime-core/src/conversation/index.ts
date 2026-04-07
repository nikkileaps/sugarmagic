import type {
  DialogueCondition,
  DialogueDefinition,
  DialogueEdgeDefinition,
  DialogueNodeDefinition
} from "@sugarmagic/domain";
import type {
  EntityCurrentAreaFact,
  EntityLocationFact,
  EntityCurrentActivityFact,
  EntityPlayerSpatialRelationFact,
  EntityPositionFact,
  EntityCurrentGoalFact,
  EntityMovementFact,
  QuestActiveObjectivesFact,
  QuestActiveStageFact,
  TrackedQuestFact,
  LocationReference
} from "../state";
import type { RuntimeNpcCurrentTask } from "../behavior";

export type ConversationKind = "scripted-dialogue" | "free-form";
export type ConversationInteractionMode = "scripted" | "agent";

export interface ConversationActiveQuestObjectiveContext {
  nodeId: string;
  displayName: string;
  description: string;
}

export interface ConversationActiveQuestContext {
  questDefinitionId: string;
  displayName: string;
  stageDisplayName: string;
  objectives: ConversationActiveQuestObjectiveContext[];
}

export interface ConversationSelectionContext {
  conversationKind: ConversationKind;
  dialogueDefinitionId?: string;
  npcDefinitionId?: string;
  npcDisplayName?: string;
  interactionMode?: ConversationInteractionMode;
  lorePageId?: string | null;
  activeQuest?: ConversationActiveQuestContext | null;
  scriptedFollowupDialogueDefinitionId?: string | null;
  learnerBandOverride?: string | null;
  targetLanguage?: string | null;
  supportLanguage?: string | null;
  metadata?: Record<string, unknown>;
}

export type ConversationPlayerInput =
  | { kind: "advance" }
  | { kind: "choice"; choiceId: string }
  | { kind: "free_text"; text: string };

export interface ConversationChoice {
  choiceId: string;
  label: string;
  metadata?: Record<string, unknown>;
}

export type ConversationActionProposal =
  | { kind: "start-scripted-followup"; dialogueDefinitionId: string }
  | { kind: "set-conversation-flag"; key: string; value: unknown }
  | { kind: "surface-beat-evidence"; beatId: string; evidence: string }
  | { kind: "request-close" }
  | {
      kind: "propose-quest-hook";
      questTemplateId: string;
      params: Record<string, unknown>;
    };

export interface ConversationTurnEnvelope {
  turnId: string;
  providerId: string;
  conversationKind: ConversationKind;
  speakerId?: string;
  speakerLabel?: string;
  displayName?: string;
  text: string;
  choices: ConversationChoice[];
  inputMode?: ConversationPlayerInput["kind"];
  inputPlaceholder?: string;
  proposedActions?: ConversationActionProposal[];
  metadata?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}

export interface ConversationExecutionContext {
  selection: ConversationSelectionContext;
  input: ConversationPlayerInput | null;
  state: Record<string, unknown>;
  annotations: Record<string, unknown>;
  runtimeContext?: ConversationRuntimeContext;
}

export interface ConversationRuntimeContext {
  here: LocationReference | null;
  playerLocation: EntityLocationFact | null;
  playerPosition: EntityPositionFact | null;
  playerArea?: EntityCurrentAreaFact | null;
  npcLocation: EntityLocationFact | null;
  npcPosition: EntityPositionFact | null;
  npcArea?: EntityCurrentAreaFact | null;
  npcPlayerRelation?: EntityPlayerSpatialRelationFact | null;
  npcBehavior?: ConversationRuntimeNpcBehaviorContext | null;
  trackedQuest: TrackedQuestFact | null;
  activeQuestStage: QuestActiveStageFact | null;
  activeQuestObjectives: QuestActiveObjectivesFact | null;
}

export interface ConversationRuntimeNpcBehaviorContext {
  movement: EntityMovementFact | null;
  task: RuntimeNpcCurrentTask | null;
  activity: EntityCurrentActivityFact | null;
  goal: EntityCurrentGoalFact | null;
}

export interface ConversationProviderContext {
  selection: ConversationSelectionContext;
  execution: ConversationExecutionContext;
}

export interface ConversationProviderSession {
  advance: (
    input: ConversationPlayerInput,
    context: ConversationExecutionContext
  ) => ConversationTurnEnvelope | null | Promise<ConversationTurnEnvelope | null>;
  dispose?: () => void | Promise<void>;
}

export interface ConversationProviderStartResult {
  session: ConversationProviderSession;
  initialTurn: ConversationTurnEnvelope | null;
}

export interface ConversationProvider {
  providerId: string;
  displayName: string;
  priority: number;
  canHandle: (
    selection: ConversationSelectionContext
  ) => boolean | Promise<boolean>;
  startSession: (
    context: ConversationProviderContext
  ) => ConversationProviderStartResult | null | Promise<ConversationProviderStartResult | null>;
}

export type ConversationMiddlewareStage =
  | "context"
  | "policy"
  | "generic"
  | "analysis";

export interface ConversationMiddleware {
  middlewareId: string;
  displayName: string;
  priority: number;
  stage: ConversationMiddlewareStage;
  prepare?: (
    context: ConversationExecutionContext
  ) => ConversationExecutionContext | Promise<ConversationExecutionContext>;
  finalize?: (
    context: ConversationExecutionContext,
    turn: ConversationTurnEnvelope | null
  ) => ConversationTurnEnvelope | null | Promise<ConversationTurnEnvelope | null>;
}

export interface ConversationHost {
  startSession: (
    selection: ConversationSelectionContext
  ) => Promise<ConversationTurnEnvelope | null>;
  submitInput: (
    input: ConversationPlayerInput
  ) => Promise<ConversationTurnEnvelope | null>;
  endSession: () => Promise<void>;
  isSessionActive: () => boolean;
  getCurrentTurn: () => ConversationTurnEnvelope | null;
  getActiveProviderId: () => string | null;
}

const MIDDLEWARE_STAGE_ORDER: ConversationMiddlewareStage[] = [
  "context",
  "policy",
  "generic",
  "analysis"
];

function sortMiddlewares(
  middlewares: ConversationMiddleware[]
): ConversationMiddleware[] {
  return [...middlewares].sort((left, right) => {
    const stageDelta =
      MIDDLEWARE_STAGE_ORDER.indexOf(left.stage) -
      MIDDLEWARE_STAGE_ORDER.indexOf(right.stage);
    if (stageDelta !== 0) return stageDelta;
    return left.priority - right.priority;
  });
}

async function prepareExecutionContext(
  middlewares: ConversationMiddleware[],
  context: ConversationExecutionContext
): Promise<ConversationExecutionContext> {
  let current = context;
  for (const middleware of middlewares) {
    current = (await middleware.prepare?.(current)) ?? current;
  }
  return current;
}

async function finalizeTurn(
  middlewares: ConversationMiddleware[],
  context: ConversationExecutionContext,
  turn: ConversationTurnEnvelope | null
): Promise<ConversationTurnEnvelope | null> {
  let current = turn;
  for (const middleware of middlewares) {
    current = (await middleware.finalize?.(context, current)) ?? current;
  }
  return current;
}

export function createConversationHost(options: {
  providers: ConversationProvider[];
  middlewares?: ConversationMiddleware[];
}): ConversationHost {
  const providers = [...options.providers].sort(
    (left, right) => left.priority - right.priority
  );
  const middlewares = sortMiddlewares(options.middlewares ?? []);

  function logDebug(event: string, payload?: Record<string, unknown>): void {
    console.info(`[conversation-host] ${event}`, payload ?? {});
  }

  let activeSession:
    | {
        provider: ConversationProvider;
        session: ConversationProviderSession;
        selection: ConversationSelectionContext;
        state: Record<string, unknown>;
      }
    | null = null;
  let currentTurn: ConversationTurnEnvelope | null = null;

  async function resolveProvider(
    selection: ConversationSelectionContext
  ): Promise<ConversationProvider | null> {
    logDebug("resolve-provider", {
      conversationKind: selection.conversationKind,
      interactionMode: selection.interactionMode ?? null,
      npcDefinitionId: selection.npcDefinitionId ?? null,
      providerIds: providers.map((provider) => provider.providerId)
    });
    for (const provider of providers) {
      const canHandle = await provider.canHandle(selection);
      logDebug("provider-can-handle", {
        providerId: provider.providerId,
        canHandle,
        conversationKind: selection.conversationKind,
        interactionMode: selection.interactionMode ?? null
      });
      if (canHandle) {
        return provider;
      }
    }
    return null;
  }

  return {
    async startSession(selection) {
      await this.endSession();

      const provider = await resolveProvider(selection);
      if (!provider) {
        logDebug("start-session-no-provider", {
          conversationKind: selection.conversationKind,
          interactionMode: selection.interactionMode ?? null,
          npcDefinitionId: selection.npcDefinitionId ?? null
        });
        currentTurn = null;
        return null;
      }

      logDebug("start-session-provider-selected", {
        providerId: provider.providerId,
        conversationKind: selection.conversationKind,
        interactionMode: selection.interactionMode ?? null,
        npcDefinitionId: selection.npcDefinitionId ?? null
      });

      const execution = await prepareExecutionContext(middlewares, {
        selection,
        input: null,
        state: {},
        annotations: {}
      });

      const start = await provider.startSession({
        selection: execution.selection,
        execution
      });
      if (!start) {
        logDebug("start-session-provider-returned-null", {
          providerId: provider.providerId,
          conversationKind: selection.conversationKind,
          interactionMode: selection.interactionMode ?? null,
          npcDefinitionId: selection.npcDefinitionId ?? null
        });
        currentTurn = null;
        return null;
      }

      activeSession = {
        provider,
        session: start.session,
        selection: execution.selection,
        state: execution.state
      };

      currentTurn = await finalizeTurn(middlewares, execution, start.initialTurn);
      if (!currentTurn) {
        logDebug("start-session-finalize-returned-null", {
          providerId: provider.providerId,
          conversationKind: selection.conversationKind,
          interactionMode: selection.interactionMode ?? null,
          npcDefinitionId: selection.npcDefinitionId ?? null
        });
      } else {
        logDebug("start-session-finalized-turn", {
          providerId: provider.providerId,
          speakerLabel: currentTurn.speakerLabel ?? null,
          displayName: currentTurn.displayName ?? null,
          textPreview: currentTurn.text.slice(0, 120)
        });
      }
      return currentTurn;
    },

    async submitInput(input) {
      if (!activeSession) return null;

      const execution = await prepareExecutionContext(middlewares, {
        selection: activeSession.selection,
        input,
        state: activeSession.state,
        annotations: {}
      });

      const nextTurn = await activeSession.session.advance(input, execution);
      activeSession.state = execution.state;
      currentTurn = await finalizeTurn(middlewares, execution, nextTurn);

      if (!currentTurn) {
        await this.endSession();
      }

      return currentTurn;
    },

    async endSession() {
      const session = activeSession;
      activeSession = null;
      currentTurn = null;
      await session?.session.dispose?.();
    },

    isSessionActive() {
      return activeSession !== null;
    },

    getCurrentTurn() {
      return currentTurn;
    },

    getActiveProviderId() {
      return activeSession?.provider.providerId ?? null;
    }
  };
}

export interface DialogueConditionContext {
  hasFlag?: (key: string, value?: unknown) => boolean;
  hasItem?: (itemId: string, count?: number) => boolean;
  hasSpell?: (spellId: string) => boolean;
  canCastSpell?: (spellId: string) => boolean;
  isQuestActive?: (questId: string) => boolean;
  isQuestCompleted?: (questId: string) => boolean;
  getQuestStageState?: (
    questId: string,
    stageId: string
  ) => "active" | "completed" | null;
}

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
    case "hasSpell":
      return context.hasSpell?.(condition.spellId) ?? false;
    case "canCastSpell":
      return context.canCastSpell?.(condition.spellId) ?? false;
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

function resolveNodeChoices(
  node: DialogueNodeDefinition,
  conditionContext: DialogueConditionContext
): Array<{ edge: DialogueEdgeDefinition; choiceId: string }> {
  return node.next
    .filter((edge) => {
      if (!edge.condition) return true;
      return evaluateDialogueCondition(edge.condition, conditionContext);
    })
    .map((edge, index) => ({
      edge,
      choiceId: `${node.nodeId}:choice:${index}:${edge.targetNodeId}`
    }));
}

function createTurnFromNode(options: {
  providerId: string;
  dialogueDefinitionId: string;
  node: DialogueNodeDefinition;
  speakerNameResolver: SpeakerNameResolver | null;
  conditionContext: DialogueConditionContext;
}): ConversationTurnEnvelope {
  const { providerId, dialogueDefinitionId, node, speakerNameResolver, conditionContext } =
    options;
  const resolvedChoices = resolveNodeChoices(node, conditionContext);
  const speakerLabel =
    node.speakerLabel ??
    (node.speakerId ? speakerNameResolver?.(node.speakerId) : undefined);

  return {
    turnId: `${dialogueDefinitionId}:${node.nodeId}`,
    providerId,
    conversationKind: "scripted-dialogue",
    speakerId: node.speakerId,
    speakerLabel,
    displayName: node.displayName,
    text: node.text,
    choices: resolvedChoices.map(({ edge, choiceId }, index) => ({
      choiceId,
      label: edge.choiceText ?? `Choice ${index + 1}`,
      metadata: {
        targetNodeId: edge.targetNodeId
      }
    })),
    inputMode: resolvedChoices.length > 1 ? "choice" : "advance",
    metadata: {
      dialogueDefinitionId,
      nodeId: node.nodeId,
      onEnterEventId: node.onEnterEventId
    }
  };
}

export const SCRIPTED_DIALOGUE_PROVIDER_ID = "engine.scripted-dialogue";

export function createScriptedDialogueConversationProvider(options: {
  definitions: DialogueDefinition[];
  conditionContext?: DialogueConditionContext;
  speakerNameResolver?: SpeakerNameResolver | null;
  priority?: number;
}): ConversationProvider {
  const definitions = new Map(
    options.definitions.map((definition) => [definition.definitionId, definition])
  );
  const conditionContext = options.conditionContext ?? {};
  const speakerNameResolver = options.speakerNameResolver ?? null;

  return {
    providerId: SCRIPTED_DIALOGUE_PROVIDER_ID,
    displayName: "Scripted Dialogue",
    priority: options.priority ?? 10,
    canHandle(selection) {
      return (
        selection.conversationKind === "scripted-dialogue" &&
        typeof selection.dialogueDefinitionId === "string" &&
        definitions.has(selection.dialogueDefinitionId)
      );
    },
    startSession({ selection }) {
      const definitionId = selection.dialogueDefinitionId;
      if (!definitionId) return null;

      const definition = definitions.get(definitionId);
      if (!definition) return null;

      let currentNode =
        definition.nodes.find((node) => node.nodeId === definition.startNodeId) ??
        null;
      if (!currentNode) return null;

      return {
        session: {
          advance(input) {
            if (!currentNode) return null;

            const resolvedChoices = resolveNodeChoices(currentNode, conditionContext);
            let nextNodeId: string | null = null;

            if (input.kind === "choice") {
              nextNodeId =
                resolvedChoices.find(
                  (candidate) => candidate.choiceId === input.choiceId
                )?.edge.targetNodeId ?? null;
            } else if (input.kind === "advance") {
              nextNodeId = resolvedChoices[0]?.edge.targetNodeId ?? null;
            }

            if (!nextNodeId) {
              currentNode = null;
              return null;
            }

            currentNode =
              definition.nodes.find((node) => node.nodeId === nextNodeId) ?? null;
            if (!currentNode) return null;

            return createTurnFromNode({
              providerId: SCRIPTED_DIALOGUE_PROVIDER_ID,
              dialogueDefinitionId: definition.definitionId,
              node: currentNode,
              speakerNameResolver,
              conditionContext
            });
          }
        },
        initialTurn: createTurnFromNode({
          providerId: SCRIPTED_DIALOGUE_PROVIDER_ID,
          dialogueDefinitionId: definition.definitionId,
          node: currentNode,
          speakerNameResolver,
          conditionContext
        })
      };
    }
  };
}
