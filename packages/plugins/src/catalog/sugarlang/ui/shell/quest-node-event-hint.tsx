/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/quest-node-event-hint.tsx
 *
 * Purpose: Renders the quest-node hint component for Sugarlang placement completion events.
 *
 * Exports:
 *   - QuestNodeEventHint
 *
 * Relationships:
 *   - Depends on the placement completion event constant from Epic 11.
 *   - Is registered by contributions.ts as an Epic 12 design.section contribution.
 *
 * Implements: Proposal 001 §Placement Interaction Contract
 *
 * Status: active
 */

import type { NPCDefinition, QuestDefinition, QuestNodeDefinition } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import type { ReactElement } from "react";
import { SUGARLANG_PLACEMENT_COMPLETED_EVENT } from "../../runtime/quest-integration/placement-completion";
import {
  applyPlacementEventSuggestion,
  shouldSuggestPlacementEvent
} from "./editor-support";

export interface QuestNodeEventHintProps {
  selectedQuest: QuestDefinition | null;
  selectedQuestNode: QuestNodeDefinition | null;
  npcDefinitions: NPCDefinition[];
  updateQuest: (definition: QuestDefinition) => void;
}

export function QuestNodeEventHint(
  props: QuestNodeEventHintProps
): ReactElement | null {
  const { selectedQuest, selectedQuestNode, npcDefinitions, updateQuest } = props;
  if (
    !selectedQuest ||
    !selectedQuestNode ||
    !shouldSuggestPlacementEvent(selectedQuestNode, npcDefinitions)
  ) {
    return null;
  }

  return (
    <PanelSection title="Sugarlang Event Hint" icon="✨">
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <p style={{ margin: 0, color: "var(--sm-color-subtext)" }}>
          Suggested event name: <code>{SUGARLANG_PLACEMENT_COMPLETED_EVENT}</code>
        </p>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
          This fires when the target placement NPC finishes the cold-start assessment.
        </p>
        <button
          type="button"
          onClick={() =>
            updateQuest(
              applyPlacementEventSuggestion(
                selectedQuest,
                selectedQuestNode.nodeId
              )
            )
          }
          style={{
            minHeight: 34,
            borderRadius: 10,
            border: "1px solid var(--sm-panel-border)",
            background: "var(--sm-color-surface2)",
            color: "var(--sm-color-text)",
            cursor: "pointer"
          }}
        >
          Use suggested event
        </button>
      </div>
    </PanelSection>
  );
}
