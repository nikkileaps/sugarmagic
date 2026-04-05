import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultDialogueDefinition,
  createDialogueNodeId,
  type DialogueDefinition
} from "@sugarmagic/domain";
import {
  DialogueManager,
  type DialoguePresenter
} from "@sugarmagic/runtime-core";
import type {
  ConversationPlayerInput,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";

function createMockPresenter() {
  let latestTurn: ConversationTurnEnvelope | null = null;
  let latestInput: ((input: ConversationPlayerInput) => void) | null = null;
  let latestCancel: (() => void) | null = null;
  let pendingCalls = 0;
  let latestPendingSpeakerLabel: string | null = null;

  const presenter: DialoguePresenter = {
    show: vi.fn(),
    hide: vi.fn(),
    clearHistory: vi.fn(),
    showPending: vi.fn((options) => {
      pendingCalls += 1;
      latestPendingSpeakerLabel = options?.speakerLabel ?? null;
      latestCancel = options?.onCancel ?? null;
    }),
    showTurn: vi.fn((turn, onInput, onCancel) => {
      latestTurn = turn;
      latestInput = onInput;
      latestCancel = onCancel ?? null;
    })
  };

  return {
    presenter,
    getLatestTurn: () => latestTurn,
    getPendingCalls: () => pendingCalls,
    getLatestPendingSpeakerLabel: () => latestPendingSpeakerLabel,
    advance: (input: ConversationPlayerInput = { kind: "advance" }) =>
      latestInput?.(input),
    cancel: () => latestCancel?.()
  };
}

function createConditionalDialogue(): DialogueDefinition {
  const definition = createDefaultDialogueDefinition({
    definitionId: "dialogue:test",
    displayName: "Conditional Test"
  });

  const gatedNodeId = createDialogueNodeId();
  const fallbackNodeId = createDialogueNodeId();

  return {
    ...definition,
    nodes: [
      {
        ...definition.nodes[0]!,
        speakerId: "builtin:dialogue-speaker:narrator",
        text: "Start",
        next: [
          {
            targetNodeId: gatedNodeId,
            choiceText: "Open gate",
            condition: { type: "flag", key: "gate-open" }
          },
          {
            targetNodeId: fallbackNodeId,
            choiceText: "Leave"
          }
        ]
      },
      {
        nodeId: gatedNodeId,
        displayName: "Gated",
        text: "Gate is open",
        next: [],
        graphPosition: { x: 320, y: 0 }
      },
      {
        nodeId: fallbackNodeId,
        displayName: "Fallback",
        text: "Maybe later",
        onEnterEventId: "dialogue:leave",
        next: [],
        graphPosition: { x: 320, y: 180 }
      }
    ]
  };
}

describe("DialogueManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters conditional edges and resolves speaker labels", async () => {
    const mock = createMockPresenter();
    const manager = new DialogueManager(mock.presenter);
    manager.registerDefinition(createConditionalDialogue());
    manager.setConditionContext({
      hasFlag: (key) => key === "gate-open"
    });
    manager.setSpeakerNameResolver((speakerId) =>
      speakerId === "builtin:dialogue-speaker:narrator" ? "Narrator" : undefined
    );

    expect(await manager.start("dialogue:test")).toBe(true);

    const turn = mock.getLatestTurn();
    expect(turn?.speakerLabel).toBe("Narrator");
    expect(turn?.choices).toHaveLength(2);
    expect(turn?.choices[0]?.label).toBe("Open gate");
    expect(mock.getPendingCalls()).toBe(1);
  });

  it("runs node enter events and ends cleanly on cancel", async () => {
    const mock = createMockPresenter();
    const manager = new DialogueManager(mock.presenter);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onEvent = vi.fn();
    const dialogue = createConditionalDialogue();

    manager.registerDefinition(dialogue);
    manager.setOnStart(onStart);
    manager.setOnEnd(onEnd);
    manager.setOnEvent(onEvent);

    await manager.start("dialogue:test");
    const firstTurn = mock.getLatestTurn();
    const fallbackChoice = firstTurn?.choices.find(
      (choice) =>
        choice.metadata?.targetNodeId === dialogue.nodes[2]!.nodeId
    );
    mock.advance({
      kind: "choice",
      choiceId: fallbackChoice!.choiceId
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("dialogue:leave");

    mock.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(manager.isDialogueActive()).toBe(false);
  });

  it("becomes active immediately and shows pending state while the first turn is loading", async () => {
    const mock = createMockPresenter();
    const manager = new DialogueManager(mock.presenter);
    manager.setConversationProviders([
      {
        providerId: "test.provider",
        displayName: "Test",
        priority: 10,
        canHandle: () => true,
        async startSession() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            session: {
              advance: () => null
            },
            initialTurn: {
              turnId: "turn:test",
              providerId: "test.provider",
              conversationKind: "free-form",
              speakerId: "npc:test",
              speakerLabel: "Station Manager",
              text: "Hello there.",
              choices: [],
              inputMode: "free_text"
            }
          };
        }
      }
    ]);

    const startPromise = manager.startConversation({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent"
    });

    expect(manager.isDialogueActive()).toBe(true);
    expect(mock.presenter.show).toHaveBeenCalledTimes(1);
    expect(mock.getPendingCalls()).toBe(1);
    expect(mock.getLatestPendingSpeakerLabel()).toBe("Station Manager");

    await startPromise;

    expect(mock.getLatestTurn()?.speakerLabel).toBe("Station Manager");
    expect(manager.isDialogueActive()).toBe(true);
  });

  it("can be cancelled while the first turn is still pending", async () => {
    const mock = createMockPresenter();
    const manager = new DialogueManager(mock.presenter);
    const onEnd = vi.fn();
    manager.setOnEnd(onEnd);
    manager.setConversationProviders([
      {
        providerId: "test.provider",
        displayName: "Test",
        priority: 10,
        canHandle: () => true,
        async startSession() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            session: {
              advance: () => null
            },
            initialTurn: {
              turnId: "turn:test",
              providerId: "test.provider",
              conversationKind: "free-form",
              speakerId: "npc:test",
              speakerLabel: "Station Manager",
              text: "Hello there.",
              choices: [],
              inputMode: "free_text"
            }
          };
        }
      }
    ]);

    const startPromise = manager.startConversation({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent"
    });

    expect(manager.isDialogueActive()).toBe(true);
    mock.cancel();

    expect(onEnd).toHaveBeenCalledWith(null, "cancelled");
    expect(manager.isDialogueActive()).toBe(false);

    await startPromise;
    expect(manager.isDialogueActive()).toBe(false);
  });

  it("auto-closes a turn that declares autoCloseAfterMs", async () => {
    vi.useFakeTimers();

    const mock = createMockPresenter();
    const manager = new DialogueManager(mock.presenter);
    const onEnd = vi.fn();
    manager.setOnEnd(onEnd);
    manager.setConversationProviders([
      {
        providerId: "test.provider",
        displayName: "Test",
        priority: 10,
        canHandle: () => true,
        async startSession() {
          return {
            session: {
              advance: () => null
            },
            initialTurn: {
              turnId: "turn:test",
              providerId: "test.provider",
              conversationKind: "free-form",
              speakerId: "npc:test",
              speakerLabel: "Station Manager",
              text: "Sorry, I need to get back to work. Let's chat later.",
              choices: [],
              inputMode: "advance",
              metadata: {
                autoCloseAfterMs: 100
              }
            }
          };
        }
      }
    ]);

    await manager.startConversation({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent"
    });

    expect(manager.isDialogueActive()).toBe(true);

    await vi.advanceTimersByTimeAsync(100);

    expect(onEnd).toHaveBeenCalledWith(null, "completed");
    expect(manager.isDialogueActive()).toBe(false);
  });
});
