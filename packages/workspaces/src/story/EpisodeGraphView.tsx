/**
 * packages/workspaces/src/story/EpisodeGraphView.tsx
 *
 * Purpose: draws an Episode's quests and the connections between them, so
 * the shape of a chapter can be read at once.
 *
 * READ-ONLY. Every editing callback on `NodeEditor` is optional and none
 * are passed, so nodes cannot be dragged, connected or deleted here.
 * Layout is computed (see `episode-graph.ts`), so there is nowhere to put
 * a dragged position anyway -- quests are edited in the Quests workspace
 * and this redraws from them.
 *
 * Exports:
 *   - EpisodeGraphView
 *
 * Status: active
 */

import { useMemo } from "react";
import { Stack, Text } from "@mantine/core";
import type { Episode } from "@sugarmagic/domain";
import {
  NodeEditor,
  type GraphEditorNodeRendererProps
} from "@sugarmagic/ui/node-editor";
import {
  buildEpisodeGraph,
  EPISODE_QUEST_NODE_KIND,
  type EpisodeQuestNodePayload
} from "../design/episode-graph";

/** What each start reason looks like, and what it is called on the card. */
const START_STYLES: Record<
  EpisodeQuestNodePayload["start"],
  { color: string; label: string }
> = {
  entry: { color: "var(--sm-accent-green)", label: "Starts at once" },
  chained: { color: "var(--sm-color-subtext)", label: "Waits for a quest" },
  // Named rather than left blank: a flag-gated quest has no incoming edge,
  // so without this it would read as a second way into the chapter.
  gated: { color: "var(--sm-accent-yellow)", label: "Waits for something else" }
};

function EpisodeQuestCard({ node }: GraphEditorNodeRendererProps) {
  const quest = node.payload as EpisodeQuestNodePayload;
  const style = START_STYLES[quest.start];
  const broken = quest.missingPrerequisiteIds.length > 0;

  return (
    <div
      style={{
        minWidth: 200,
        maxWidth: 260,
        background: "var(--sm-color-mantle)",
        border: `2px solid ${broken ? "var(--sm-accent-red)" : style.color}`,
        borderRadius: 8,
        padding: "10px 12px"
      }}
    >
      <Text size="sm" fw={600} c="var(--sm-color-text)">
        {quest.displayName}
      </Text>
      <Text size="xs" c="var(--sm-color-overlay0)">
        {quest.sceneDisplayName}
      </Text>
      <Text size="xs" c={broken ? "var(--sm-accent-red)" : style.color} mt={6}>
        {broken
          ? `Waits for ${quest.missingPrerequisiteIds.join(", ")}, which this Episode does not have`
          : style.label}
      </Text>
    </div>
  );
}

const EPISODE_NODE_RENDERERS = {
  [EPISODE_QUEST_NODE_KIND]: EpisodeQuestCard
};

export interface EpisodeGraphViewProps {
  episode: Episode | null;
}

export function EpisodeGraphView({ episode }: EpisodeGraphViewProps) {
  const graph = useMemo(() => buildEpisodeGraph(episode), [episode]);

  if (!episode) {
    return (
      <Stack p="md">
        <Text size="xs" c="var(--sm-color-overlay0)">
          Select an Episode to see its quests.
        </Text>
      </Stack>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <Stack p="md">
        <Text size="xs" c="var(--sm-color-overlay0)">
          {episode.displayName} has no quests yet. Add one in Quests and it
          appears here.
        </Text>
      </Stack>
    );
  }

  return (
    <NodeEditor
      nodes={graph.nodes}
      edges={graph.edges}
      renderers={EPISODE_NODE_RENDERERS}
    />
  );
}
