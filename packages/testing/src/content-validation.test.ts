import { describe, expect, it } from "vitest";
import {
  createEmptyContentLibrarySnapshot,
  createDefaultGameProject,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createDefaultRegion,
  createDefaultRegionLandscapeState,
  createRegionBehaviorQuestBinding,
  createRegionNPCBehaviorTask,
  createWorldFlagDefinition,
  validateProjectContent,
  validateQuest,
  type GameProject,
  type QuestConditionDefinition,
  type QuestDefinition,
  type RegionDocument,
  type RegionNPCBehaviorTask
} from "@sugarmagic/domain";

/** Nothing here is about textures, so an empty library is the right
 *  answer: no texture reference can dangle against it. */
const VALIDATION_CONTENT_LIBRARY = createEmptyContentLibrarySnapshot("test");

/**
 * One checker, two callers: the quest editor's panel and the save gate. These
 * cover the rule. That `performSave` calls it and that the panel still renders
 * are Studio wiring with no harness -- they are checked by hand.
 */

function questWith(
  condition: QuestConditionDefinition,
  overrides: Partial<Parameters<typeof createDefaultQuestNodeDefinition>[0]> = {}
): QuestDefinition {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          displayName: "Check",
          description: "Check something",
          nodeBehavior: "branch",
          ...overrides
        }),
        condition
      }
    ]
  });
  return {
    ...createDefaultQuestDefinition({
      definitionId: "quest:test",
      displayName: "Test Quest"
    }),
    startStageId: stage.stageId,
    stageDefinitions: [stage]
  };
}

const VALIDATION_REGION_ID = "region:test";

/** A region for the project's Scenes to name, so scene-region validation
 *  stays quiet and these tests only report on the quest under test. */
function validationRegion(): RegionDocument {
  return createDefaultRegion({
    regionId: VALIDATION_REGION_ID,
    displayName: "Test Region"
  });
}

function projectWith(quest: QuestDefinition): GameProject {
  const project = createDefaultGameProject("Test", "test");
  return {
    ...project,
    episodes: project.episodes.map((episode) => ({
      ...episode,
      scenes: episode.scenes.map((scene, index) => ({
        ...scene,
        regionId: VALIDATION_REGION_ID,
        // Quests are held by the Scene they happen in (epic #226).
        questDefinitions: index === 0 ? [quest] : scene.questDefinitions
      }))
    }))
  };
}

describe("validateQuest", () => {
  // These checks existed before the extraction but lived inside a React
  // component that nothing could import, so none of them were ever tested.
  it("reports a missing start stage", () => {
    const quest = questWith({
      type: "hasFlag",
      worldFlagId: "flag:a",
      value: "true"
    });
    const issues = validateQuest({ ...quest, startStageId: "stage:gone" });

    expect(issues.map((issue) => issue.message)).toContain(
      "Start stage is missing."
    );
  });

  it("reports a flag condition with no flag picked", () => {
    const issues = validateQuest(
      questWith({ type: "hasFlag", worldFlagId: "", value: "true" })
    );

    expect(issues.map((issue) => issue.message)).toContain(
      'Node "Check" has a flag condition with no flag picked.'
    );
  });

  it("reports a flag condition with no value, including under not", () => {
    const issues = validateQuest(
      questWith({
        type: "not",
        condition: { type: "hasFlag", worldFlagId: "flag:a", value: "" }
      })
    );

    expect(issues.map((issue) => issue.message)).toContain(
      'Node "Check" checks a flag with no value, so it never matches.'
    );
  });

  // Everything a quest reports is a warning. A quest is half-authored for most
  // of its life; a save that refused an unfinished node would be unusable.
  it("reports only warnings, so an unfinished quest still saves", () => {
    const quest = questWith({ type: "hasFlag", worldFlagId: "", value: "" });
    const result = validateProjectContent(projectWith(quest), [validationRegion()], VALIDATION_CONTENT_LIBRARY);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === "warning")).toBe(
      true
    );
    expect(result.valid).toBe(true);
  });
});

describe("dangling world flag references", () => {
  it("refuses a quest condition pointing at a flag that is not in the registry", () => {
    const quest = questWith({
      type: "hasFlag",
      worldFlagId: "flag:deleted",
      value: "true"
    });
    const result = validateProjectContent(projectWith(quest), [validationRegion()], VALIDATION_CONTENT_LIBRARY);

    expect(result.valid).toBe(false);
    const dangling = result.issues.filter(
      (issue) => issue.severity === "error"
    );
    expect(dangling).toHaveLength(1);
    expect(dangling[0].message).toContain("flag:deleted");
    // The message has to say WHERE, or a refused save is a puzzle.
    expect(dangling[0].path).toContain('quest "Test Quest"');
    expect(dangling[0].path).toContain('node "Check"');
  });

  it("accepts the same content once the flag is in the registry", () => {
    const flag = createWorldFlagDefinition({ name: "gate-open" });
    const quest = questWith({
      type: "hasFlag",
      worldFlagId: flag.definitionId,
      value: "true"
    });
    const result = validateProjectContent(
      { ...projectWith(quest), worldFlagDefinitions: [flag] },
      [validationRegion()]
    , VALIDATION_CONTENT_LIBRARY);

    expect(result.valid).toBe(true);
    expect(
      result.issues.filter((issue) => issue.severity === "error")
    ).toHaveLength(0);
  });

  // Deleting a flag orphans every reference at once. One save should name all
  // of them, not make the author fix and re-save one at a time.
  it("lists every place a deleted flag is still referenced", () => {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Check",
            description: "Check",
            nodeBehavior: "branch"
          }),
          condition: {
            type: "hasFlag",
            worldFlagId: "flag:deleted",
            value: "true"
          },
          onCompleteActions: [
            { type: "setFlag", worldFlagId: "flag:deleted", value: "true" }
          ]
        }
      ]
    });
    const quest: QuestDefinition = {
      ...createDefaultQuestDefinition({
        definitionId: "quest:test",
        displayName: "Test Quest"
      }),
      startStageId: stage.stageId,
      stageDefinitions: [stage]
    };
    const result = validateProjectContent(projectWith(quest), [validationRegion()], VALIDATION_CONTENT_LIBRARY);

    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors).toHaveLength(2);
    expect(errors.map((issue) => issue.path).join(" ")).toContain("condition");
    expect(errors.map((issue) => issue.path).join(" ")).toContain(
      "on-complete action"
    );
  });
});

describe("dangling story point references", () => {
  function regionWaitingOn(
    questDefinitionId: string,
    nodeId: string
  ): RegionDocument[] {
    const region: RegionDocument = {
      placedLights: [],
      identity: { id: "region:test", schema: "RegionDocument", version: 1 },
      displayName: "Test Region",
      placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
      placedAssets: [],
      folders: [],
      environmentBinding: { defaultEnvironmentId: null },
      areas: [],
      behaviors: [
        {
          behaviorId: "behavior:test",
          npcDefinitionId: "npc:test",
          displayName: "Test Behavior",
          tasks: [
            {
              ...createRegionNPCBehaviorTask({ displayName: "Test Task" }),
              // Through the factory, the way a loaded file arrives: an old
              // `nodeCompleted` becomes that node on the "after" side.
              activation: createRegionBehaviorQuestBinding({
                nodeCompleted: { questDefinitionId, nodeId }
              })
            }
          ]
        }
      ],
      landscape: createDefaultRegionLandscapeState({}),
      markers: [],
      npcPresences: [],
      itemPresences: [],
      playerPresence: null
    };
    return [region];
  }

  it("refuses a binding naming a quest that is not in the project", () => {
    const flag = createWorldFlagDefinition({ name: "a" });
    const result = validateProjectContent(
      {
        ...projectWith(
          questWith({
            type: "hasFlag",
            worldFlagId: flag.definitionId,
            value: "true"
          })
        ),
        worldFlagDefinitions: [flag]
      },
      regionWaitingOn("quest:gone", "node:whatever")
    , VALIDATION_CONTENT_LIBRARY);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("quest:gone")
      )
    ).toBe(true);
  });

  it("refuses a binding naming a node the quest does not have", () => {
    const flag = createWorldFlagDefinition({ name: "a" });
    const result = validateProjectContent(
      {
        ...projectWith(
          questWith({
            type: "hasFlag",
            worldFlagId: flag.definitionId,
            value: "true"
          })
        ),
        worldFlagDefinitions: [flag]
      },
      regionWaitingOn("quest:test", "node:gone")
    , VALIDATION_CONTENT_LIBRARY);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("node:gone")
      )
    ).toBe(true);
  });
});

describe("behavior tasks with no ordering between them", () => {
  function regionWithTasks(
    tasks: Array<Partial<RegionNPCBehaviorTask["activation"]>>
  ): RegionDocument[] {
    return [
      {
        placedLights: [],
        identity: { id: "region:test", schema: "RegionDocument", version: 1 },
        displayName: "Test Region",
        placement: {
          gridPosition: { x: 0, y: 0 },
          placementPolicy: "world-grid"
        },
        placedAssets: [],
        folders: [],
        environmentBinding: { defaultEnvironmentId: null },
        areas: [],
        behaviors: [
          {
            behaviorId: "behavior:test",
            npcDefinitionId: "npc:test",
            displayName: "Horace",
            tasks: tasks.map((activation, index) => ({
              ...createRegionNPCBehaviorTask({
                displayName: `Task ${index + 1}`
              }),
              activation: {
                ...createRegionBehaviorQuestBinding(),
                ...activation
              }
            }))
          }
        ],
        landscape: createDefaultRegionLandscapeState({}),
        markers: [],
        npcPresences: [],
        itemPresences: [],
        playerPresence: null
      }
    ];
  }

  function validate(regions: RegionDocument[]) {
    const flag = createWorldFlagDefinition({ name: "upset" });
    return {
      flag,
      result: validateProjectContent(
        {
          ...projectWith(
            questWith({
              type: "hasFlag",
              worldFlagId: flag.definitionId,
              value: "true"
            })
          ),
          worldFlagDefinitions: [flag]
        },
        regions
      , VALIDATION_CONTENT_LIBRARY)
    };
  }

  it("warns when a quest task and a flag task can both apply", () => {
    // Neither is a sharper version of the other, so nothing the author
    // wrote says which Horace should do while both hold.
    const flag = createWorldFlagDefinition({ name: "upset" });
    const { result } = validate(
      regionWithTasks([
        { questDefinitionId: "quest:test" },
        {
          worldFlagEquals: {
            worldFlagId: flag.definitionId,
            valueType: "boolean",
            value: "true"
          }
        }
      ])
    );

    const ambiguous = result.issues.filter((issue) =>
      issue.message.includes("neither is more specific")
    );
    expect(ambiguous).toHaveLength(1);
    // A question to settle, not a reason to refuse the save.
    expect(ambiguous[0]?.severity).toBe("warning");
  });

  it("stays quiet when one task is simply narrower than the other", () => {
    // The shape authors are meant to write: a baseline plus an override.
    const { result } = validate(
      regionWithTasks([{}, { questDefinitionId: "quest:test" }])
    );

    expect(
      result.issues.some((issue) =>
        issue.message.includes("neither is more specific")
      )
    ).toBe(false);
  });
});
