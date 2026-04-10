/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/quest-node-event-hint.test.tsx
 *
 * Purpose: Verifies the Sugarlang placement event hint helpers and render contract.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/quest-node-event-hint and ../../ui/shell/editor-support.
 *   - Guards the Epic 12 quest-node placement hint affordance.
 *
 * Implements: Epic 12 Story 12.5
 *
 * Status: active
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { NPCDefinition, QuestDefinition, QuestNodeDefinition } from "@sugarmagic/domain";
vi.mock("@sugarmagic/ui", () => ({
  PanelSection: ({
    title,
    children
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}));
import { QuestNodeEventHint } from "../../ui/shell/quest-node-event-hint";
import {
  applyPlacementEventSuggestion,
  shouldSuggestPlacementEvent
} from "../../ui/shell/editor-support";
import { SUGARLANG_PLACEMENT_COMPLETED_EVENT } from "../../runtime/quest-integration/placement-completion";

const PLACEMENT_NPC: NPCDefinition = {
  definitionId: "npc-orrin",
  displayName: "Orrin",
  description: "Station manager",
  interactionMode: "agent",
  lorePageId: null,
  metadata: {
    sugarlangRole: "placement"
  },
  presentation: {
    modelAssetDefinitionId: null,
    modelHeight: 1.7,
    animationAssetBindings: { idle: null, walk: null, run: null }
  }
};

const TALK_NODE: QuestNodeDefinition = {
  nodeId: "node-1",
  displayName: "Talk to Orrin",
  description: "Meet the station manager.",
  nodeBehavior: "objective",
  objectiveSubtype: "talk",
  targetId: "npc-orrin",
  count: 1,
  optional: false,
  prerequisiteNodeIds: [],
  failTargetNodeIds: [],
  onEnterActions: [],
  onCompleteActions: [],
  showInHud: true,
  graphPosition: { x: 80, y: 80 }
};

const QUEST: QuestDefinition = {
  definitionId: "quest-1",
  displayName: "Arrival",
  description: "Check in at the station.",
  startStageId: "stage-1",
  rewardDefinitions: [],
  repeatable: false,
  stageDefinitions: [
    {
      stageId: "stage-1",
      displayName: "Stage 1",
      nextStageId: null,
      entryNodeIds: ["node-1"],
      nodeDefinitions: [TALK_NODE]
    }
  ]
};

describe("QuestNodeEventHint", () => {
  it("suggests the placement completion event for placement NPC targets", () => {
    expect(shouldSuggestPlacementEvent(TALK_NODE, [PLACEMENT_NPC])).toBe(true);
  });

  it("writes the suggested event name into the selected node", () => {
    const updatedQuest = applyPlacementEventSuggestion(QUEST, TALK_NODE.nodeId);

    expect(updatedQuest.stageDefinitions[0]?.nodeDefinitions[0]?.eventName).toBe(
      SUGARLANG_PLACEMENT_COMPLETED_EVENT
    );
  });

  it("renders the suggestion text when the target NPC is a placement NPC", () => {
    const markup = renderToStaticMarkup(
      <QuestNodeEventHint
        selectedQuest={QUEST}
        selectedQuestNode={TALK_NODE}
        npcDefinitions={[PLACEMENT_NPC]}
        updateQuest={vi.fn()}
      />
    );

    expect(markup).toContain(SUGARLANG_PLACEMENT_COMPLETED_EVENT);
  });
});
