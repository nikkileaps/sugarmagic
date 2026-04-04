import { describe, expect, it, vi } from "vitest";
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

  const presenter: DialoguePresenter = {
    show: vi.fn(),
    hide: vi.fn(),
    clearHistory: vi.fn(),
    showTurn: vi.fn((turn, onInput, onCancel) => {
      latestTurn = turn;
      latestInput = onInput;
      latestCancel = onCancel ?? null;
    })
  };

  return {
    presenter,
    getLatestTurn: () => latestTurn,
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
});
