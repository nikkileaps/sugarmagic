import { describe, expect, it, vi } from "vitest";
import {
  createDefaultDialogueDefinition,
  createDialogueNodeId,
  type DialogueDefinition,
  type DialogueEdgeDefinition
} from "@sugarmagic/domain";
import {
  DialogueManager,
  type DialoguePresenter,
  type DialogueSessionNode
} from "@sugarmagic/runtime-core";

function createMockPresenter() {
  let latestNode: DialogueSessionNode | null = null;
  let latestComplete: ((selected?: DialogueEdgeDefinition) => void) | null = null;
  let latestCancel: (() => void) | null = null;

  const presenter: DialoguePresenter = {
    show: vi.fn(),
    hide: vi.fn(),
    clearHistory: vi.fn(),
    showNode: vi.fn((node, onComplete, onCancel) => {
      latestNode = node;
      latestComplete = onComplete;
      latestCancel = onCancel ?? null;
    })
  };

  return {
    presenter,
    getLatestNode: () => latestNode,
    advance: (selected?: DialogueEdgeDefinition) => latestComplete?.(selected),
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
  it("filters conditional edges and resolves speaker labels", () => {
    const mock = createMockPresenter();
    const manager = new DialogueManager(mock.presenter);
    manager.registerDefinition(createConditionalDialogue());
    manager.setConditionContext({
      hasFlag: (key) => key === "gate-open"
    });
    manager.setSpeakerNameResolver((speakerId) =>
      speakerId === "builtin:dialogue-speaker:narrator" ? "Narrator" : undefined
    );

    expect(manager.start("dialogue:test")).toBe(true);

    const node = mock.getLatestNode();
    expect(node?.speakerLabel).toBe("Narrator");
    expect(node?.next).toHaveLength(2);
    expect(node?.next[0]?.choiceText).toBe("Open gate");
  });

  it("runs node enter events and ends cleanly on cancel", () => {
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

    manager.start("dialogue:test");
    mock.advance({ targetNodeId: dialogue.nodes[2]!.nodeId });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("dialogue:leave");

    mock.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(manager.isDialogueActive()).toBe(false);
  });
});
