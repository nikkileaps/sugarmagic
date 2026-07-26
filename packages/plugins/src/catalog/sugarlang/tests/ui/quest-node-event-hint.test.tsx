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
import type { QuestDefinition, QuestNodeDefinition } from "@sugarmagic/domain";
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

const ASSESSMENT_NODE: QuestNodeDefinition = {
  nodeId: "node-1",
  displayName: "Language Assessment",
  description: "Complete the language placement assessment.",
  nodeBehavior: "objective",
  objectiveSubtype: "assessment",
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

const TALK_NODE: QuestNodeDefinition = {
  nodeId: "node-2",
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
      nodeDefinitions: [ASSESSMENT_NODE, TALK_NODE]
    }
  ]
};

describe("QuestNodeEventHint", () => {
  it("suggests the placement completion event for assessment nodes", () => {
    expect(shouldSuggestPlacementEvent(ASSESSMENT_NODE)).toBe(true);
  });

  it("does not suggest the placement event for non-assessment nodes", () => {
    expect(shouldSuggestPlacementEvent(TALK_NODE)).toBe(false);
  });

  it("writes the suggested event name into the selected node", () => {
    const updatedQuest = applyPlacementEventSuggestion(QUEST, ASSESSMENT_NODE.nodeId);

    expect(updatedQuest.stageDefinitions[0]?.nodeDefinitions[0]?.eventName).toBe(
      SUGARLANG_PLACEMENT_COMPLETED_EVENT
    );
  });

  it("renders the suggestion text for an assessment node", () => {
    const markup = renderToStaticMarkup(
      <QuestNodeEventHint
        selectedQuest={QUEST}
        selectedQuestNode={ASSESSMENT_NODE}
        updateQuest={vi.fn()}
      />
    );

    expect(markup).toContain(SUGARLANG_PLACEMENT_COMPLETED_EVENT);
  });

  it("renders nothing for a non-assessment node", () => {
    const markup = renderToStaticMarkup(
      <QuestNodeEventHint
        selectedQuest={QUEST}
        selectedQuestNode={TALK_NODE}
        updateQuest={vi.fn()}
      />
    );

    expect(markup).toBe("");
  });
});
