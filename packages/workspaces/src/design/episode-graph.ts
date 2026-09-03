/**
 * packages/workspaces/src/design/episode-graph.ts
 *
 * Purpose: translates an Episode's quests into the shared node editor's
 * nodes and edges, so the shape of a chapter can be read at once instead
 * of one quest at a time.
 *
 * Story 10 gave a quest a start condition, which is what makes this a
 * graph rather than a list: a `questCompleted` condition on B naming A is
 * an edge from A to B. The connections are already data; nothing drew
 * them.
 *
 * READ-ONLY, and that decides the layout. Positions are computed from
 * containment and chain depth rather than authored, so there is nothing
 * new persisted and nothing that can drift from what actually runs. A
 * `QuestDefinition` has no position field and does not gain one here.
 *
 * NOT grouped by Scene, though containment would allow it. The layout
 * runs left to right by chain depth, which is what answers "why did that
 * quest not start"; a Scene's quests spread across those columns, so a
 * box drawn round each Scene would overlap its neighbours and fight the
 * thing the picture is for. The Scene is named on the node instead.
 *
 * Pure functions, so the translation is unit tested without a browser --
 * same shape as `quest-graph.ts` and `dialogue-graph.ts`.
 *
 * Exports:
 *   - EPISODE_QUEST_NODE_KIND
 *   - buildEpisodeGraph
 *   - type EpisodeQuestNodePayload
 *
 * Status: active
 */

import type { Episode, QuestConditionDefinition } from "@sugarmagic/domain";
import type {
  GraphEditorEdge,
  GraphEditorNode
} from "@sugarmagic/ui/node-editor";

export const EPISODE_QUEST_NODE_KIND = "episode-quest";

/**
 * Why a quest starts when it does, as the graph can tell it.
 *
 * `gated` matters: a quest waiting on a world flag has no quest-to-quest
 * edge, so without saying so it would draw identically to one that starts
 * at boot. The graph would then claim the chapter has more entry points
 * than it does.
 */
export type EpisodeQuestStart = "entry" | "chained" | "gated";

export interface EpisodeQuestNodePayload {
  questDefinitionId: string;
  displayName: string;
  sceneDisplayName: string;
  start: EpisodeQuestStart;
  /** Quests this one waits on that the Episode does not contain -- a
   *  deleted quest, or one in another Episode. Drawn as a broken edge so
   *  it is found here rather than by playing. */
  missingPrerequisiteIds: string[];
}

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 120;

/**
 * Every quest this condition waits on, including inside `not`.
 *
 * Only the three that name a quest directly. A `hasFlag` condition can
 * stand for "after the festival" when another quest sets that flag, but
 * the link runs through the flag and the graph would be guessing.
 */
function referencedQuestIds(
  condition: QuestConditionDefinition | undefined
): string[] {
  if (!condition) return [];
  switch (condition.type) {
    case "questCompleted":
    case "questActive":
    case "questStage":
      return condition.questDefinitionId ? [condition.questDefinitionId] : [];
    case "not":
      return referencedQuestIds(condition.condition);
    default:
      return [];
  }
}

export interface EpisodeGraph {
  nodes: GraphEditorNode[];
  edges: GraphEditorEdge[];
}

/**
 * Lay the Episode out left to right by how far into the chain a quest is:
 * a quest that waits on nothing sits in the first column, one that waits
 * on it in the second, and so on. Quests that cannot be reached from an
 * entry point still get a column, so a broken chain is visible rather
 * than absent.
 */
function computeDepths(
  questIds: string[],
  waitsOn: Map<string, string[]>
): Map<string, number> {
  const depths = new Map<string, number>();
  const resolving = new Set<string>();

  const depthOf = (questId: string): number => {
    const known = depths.get(questId);
    if (known !== undefined) return known;
    // A cycle cannot be laid out by depth, and authored content can
    // contain one (A waits on B, B waits on A). Break it at 0 rather
    // than recursing forever; the edges still draw, so the loop is
    // visible in the picture.
    if (resolving.has(questId)) return 0;
    resolving.add(questId);
    const parents = waitsOn.get(questId) ?? [];
    const depth = parents.length
      ? Math.max(...parents.map((parent) => depthOf(parent) + 1))
      : 0;
    resolving.delete(questId);
    depths.set(questId, depth);
    return depth;
  };

  for (const questId of questIds) depthOf(questId);
  return depths;
}

export function buildEpisodeGraph(episode: Episode | null): EpisodeGraph {
  if (!episode) return { nodes: [], edges: [] };

  const quests = episode.scenes.flatMap((scene) =>
    scene.questDefinitions.map((quest) => ({ quest, scene }))
  );
  const present = new Set(quests.map(({ quest }) => quest.definitionId));

  const waitsOn = new Map<string, string[]>();
  for (const { quest } of quests) {
    waitsOn.set(
      quest.definitionId,
      referencedQuestIds(quest.startCondition).filter((id) => present.has(id))
    );
  }

  const depths = computeDepths(
    quests.map(({ quest }) => quest.definitionId),
    waitsOn
  );
  const rowByColumn = new Map<number, number>();

  const nodes: GraphEditorNode[] = quests.map(({ quest, scene }) => {
    const column = depths.get(quest.definitionId) ?? 0;
    const row = rowByColumn.get(column) ?? 0;
    rowByColumn.set(column, row + 1);

    const referenced = referencedQuestIds(quest.startCondition);
    const start: EpisodeQuestStart = !quest.startCondition
      ? "entry"
      : referenced.some((id) => present.has(id))
        ? "chained"
        : "gated";

    const payload: EpisodeQuestNodePayload = {
      questDefinitionId: quest.definitionId,
      displayName: quest.displayName,
      sceneDisplayName: scene.displayName,
      start,
      missingPrerequisiteIds: referenced.filter((id) => !present.has(id))
    };

    return {
      id: quest.definitionId,
      kind: EPISODE_QUEST_NODE_KIND,
      position: { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      payload
    };
  });

  // Only between quests the Episode actually holds. An edge whose other
  // end is not among `nodes` has nothing to attach to -- it would be
  // dropped by the renderer, which is the silent failure this view exists
  // to remove. A prerequisite the Episode does not contain is reported on
  // the NODE instead, through `missingPrerequisiteIds`, where it can be
  // read.
  const edges: GraphEditorEdge[] = [];
  for (const { quest } of quests) {
    for (const parentId of referencedQuestIds(quest.startCondition)) {
      if (!present.has(parentId)) continue;
      edges.push({
        id: `${parentId}->${quest.definitionId}`,
        fromId: parentId,
        toId: quest.definitionId
      });
    }
  }

  return { nodes, edges };
}
