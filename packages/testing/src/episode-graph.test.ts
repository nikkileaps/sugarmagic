/**
 * An Episode's quests as one graph (epic #226 story 17).
 *
 * Story 10 made the connections real data: a `questCompleted` condition on
 * B naming A is an edge from A to B. This is the translation into the
 * shared node editor's shape -- pure, so it is tested without a browser.
 *
 * The value beyond looking nice is the two things it makes visible that
 * were otherwise only findable by playing: which quests can start at all,
 * and a chain broken by a deleted quest.
 */

import { describe, expect, it } from "vitest";
import {
  buildEpisodeGraph,
  type EpisodeQuestNodePayload
} from "@sugarmagic/workspaces";
import {
  createDefaultEpisode,
  createDefaultQuestDefinition,
  createDefaultScene,
  type Episode,
  type QuestConditionDefinition
} from "@sugarmagic/domain";

/** One Scene holding quests, each with an optional start condition. */
function episodeOf(
  specs: Array<{
    id: string;
    startCondition?: QuestConditionDefinition;
    sceneName?: string;
  }>
): Episode {
  return createDefaultEpisode({
    episodeId: "e:1",
    scenes: [
      {
        ...createDefaultScene({ sceneId: "s:1" }),
        displayName: specs[0]?.sceneName ?? "Arrival",
        questDefinitions: specs.map((spec) => ({
          ...createDefaultQuestDefinition({
            definitionId: spec.id,
            displayName: spec.id
          }),
          startCondition: spec.startCondition
        }))
      }
    ]
  });
}

const payloadOf = (graph: ReturnType<typeof buildEpisodeGraph>, id: string) =>
  graph.nodes.find((node) => node.id === id)!.payload as EpisodeQuestNodePayload;

describe("the shape of a chapter", () => {
  it("draws an edge from the quest a start condition names", () => {
    const graph = buildEpisodeGraph(
      episodeOf([
        { id: "q:a" },
        {
          id: "q:b",
          startCondition: { type: "questCompleted", questDefinitionId: "q:a" }
        }
      ])
    );

    expect(graph.edges).toEqual([
      { id: "q:a->q:b", fromId: "q:a", toId: "q:b" }
    ]);
  });

  it("finds a reference nested inside `not`", () => {
    const graph = buildEpisodeGraph(
      episodeOf([
        { id: "q:a" },
        {
          id: "q:b",
          startCondition: {
            type: "not",
            condition: { type: "questActive", questDefinitionId: "q:a" }
          }
        }
      ])
    );

    expect(graph.edges.map((edge) => edge.id)).toEqual(["q:a->q:b"]);
  });

  it("lays the chain out left to right by how deep it runs", () => {
    const graph = buildEpisodeGraph(
      episodeOf([
        { id: "q:a" },
        {
          id: "q:b",
          startCondition: { type: "questCompleted", questDefinitionId: "q:a" }
        },
        {
          id: "q:c",
          startCondition: { type: "questCompleted", questDefinitionId: "q:b" }
        }
      ])
    );
    const x = (id: string) => graph.nodes.find((n) => n.id === id)!.position.x;

    expect(x("q:a")).toBeLessThan(x("q:b"));
    expect(x("q:b")).toBeLessThan(x("q:c"));
  });
});

describe("why a quest starts when it does", () => {
  it("no condition reads as an entry point", () => {
    const graph = buildEpisodeGraph(episodeOf([{ id: "q:a" }]));

    expect(payloadOf(graph, "q:a").start).toBe("entry");
  });

  it("a flag-gated quest is NOT an entry point", () => {
    // It has no quest-to-quest edge, so without saying so it would draw
    // exactly like one that starts at boot -- and the graph would claim
    // the chapter has more ways in than it has.
    const graph = buildEpisodeGraph(
      episodeOf([
        {
          id: "q:a",
          startCondition: {
            type: "hasFlag",
            worldFlagId: "flag:festival",
            value: true
          }
        }
      ])
    );

    expect(payloadOf(graph, "q:a").start).toBe("gated");
  });

  it("a quest waiting on another reads as chained", () => {
    const graph = buildEpisodeGraph(
      episodeOf([
        { id: "q:a" },
        {
          id: "q:b",
          startCondition: { type: "questCompleted", questDefinitionId: "q:a" }
        }
      ])
    );

    expect(payloadOf(graph, "q:b").start).toBe("chained");
  });
});

describe("a chain broken by a missing quest", () => {
  const graph = buildEpisodeGraph(
    episodeOf([
      {
        id: "q:b",
        startCondition: {
          type: "questCompleted",
          questDefinitionId: "q:deleted"
        }
      }
    ])
  );

  it("names the quest that is gone, on the node", () => {
    // Otherwise this is only discoverable by playing and noticing the
    // quest never starts.
    expect(payloadOf(graph, "q:b").missingPrerequisiteIds).toEqual([
      "q:deleted"
    ]);
  });

  it("draws no edge to a quest that is not there", () => {
    // An edge whose other end is absent from `nodes` has nothing to
    // attach to; the renderer drops it, which would hide the very thing
    // being reported.
    expect(graph.edges).toEqual([]);
  });
});

describe("edges", () => {
  it("survives a cycle instead of recursing forever", () => {
    // Authored content can contain one. The layout cannot express it, but
    // the picture still has to draw.
    const graph = buildEpisodeGraph(
      episodeOf([
        {
          id: "q:a",
          startCondition: { type: "questCompleted", questDefinitionId: "q:b" }
        },
        {
          id: "q:b",
          startCondition: { type: "questCompleted", questDefinitionId: "q:a" }
        }
      ])
    );

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual([
      "q:a->q:b",
      "q:b->q:a"
    ]);
  });

  it("no Episode is an empty graph, not a crash", () => {
    expect(buildEpisodeGraph(null)).toEqual({ nodes: [], edges: [] });
  });
});
