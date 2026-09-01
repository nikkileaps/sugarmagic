import { describe, expect, it } from "vitest";
import {
  applyCommand,
  collectWorldFlagReferences,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createEmptyContentLibrarySnapshot,
  createWorldFlagDefinition,
  getAllWorldFlagDefinitions,
  validateProjectContent,
  type GameProject,
  type SemanticCommand,
  type WorldFlagDefinition,
  createDefaultRegion
} from "@sugarmagic/domain";

/**
 * The commands behind the World Flags tab. Create was already wired to the
 * picker's inline create; update and delete had no caller until this surface
 * existed, so nothing had exercised them.
 */

const FLAG_ID = "flag:gate";

function projectReferencing(worldFlagId: string): GameProject {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          displayName: "Check Gate",
          description: "Check",
          nodeBehavior: "branch"
        }),
        condition: { type: "hasFlag", worldFlagId, value: "true" },
        onCompleteActions: [{ type: "setFlag", worldFlagId, value: "true" }]
      }
    ]
  });
  return {
    ...createDefaultGameProject("Test", "test"),
    worldFlagDefinitions: [
      createWorldFlagDefinition({ definitionId: worldFlagId, name: "gate-open" })
    ],
    questDefinitions: [
      {
        ...createDefaultQuestDefinition({
          definitionId: "quest:test",
          displayName: "Test Quest"
        }),
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]
  };
}

const FLAG_TEST_REGION_ID = "region:flags";

/** These tests are about flags, but a project still has to be coherent:
 *  its Scenes name a region, so the region has to exist. */
function flagTestRegion() {
  return createDefaultRegion({
    regionId: FLAG_TEST_REGION_ID,
    displayName: "Flag Test Region"
  });
}

function sessionFor(gameProject: GameProject) {
  return createAuthoringSession(
    gameProject,
    [flagTestRegion()],
    createEmptyContentLibrarySnapshot(gameProject.identity.id)
  );
}

function command(
  kind: SemanticCommand["kind"],
  subjectId: string,
  payload: unknown
): SemanticCommand {
  return {
    kind,
    target: { aggregateKind: "game-project", aggregateId: "test" },
    subject: { subjectKind: "world-flag-definition", subjectId },
    payload
    // The command union is discriminated on `kind`; this helper builds any of
    // the three, so the payload cannot be narrowed at the call site.
  } as SemanticCommand;
}

describe("world flag commands", () => {
  it("creates a flag", () => {
    const definition: WorldFlagDefinition = createWorldFlagDefinition({
      name: "gate-open"
    });
    const session = applyCommand(
      sessionFor(createDefaultGameProject("Test", "test")),
      command("CreateWorldFlagDefinition", definition.definitionId, {
        definition
      })
    );

    expect(getAllWorldFlagDefinitions(session)).toEqual([definition]);
  });

  it("renames a flag without touching the content that references it", () => {
    const session = applyCommand(
      sessionFor(projectReferencing(FLAG_ID)),
      command("UpdateWorldFlagDefinition", FLAG_ID, {
        definitionId: FLAG_ID,
        changes: { name: "gate-unlocked" }
      })
    );

    expect(getAllWorldFlagDefinitions(session)[0].name).toBe("gate-unlocked");
    // The whole reason content references ids: a rename moves one row.
    const references = collectWorldFlagReferences(session.gameProject, []);
    expect(references).toHaveLength(2);
    expect(
      references.every((reference) => reference.worldFlagId === FLAG_ID)
    ).toBe(true);
    expect(validateProjectContent(session.gameProject, [flagTestRegion()]).valid).toBe(true);
  });

  it("deletes a flag and leaves the references dangling, which the save catches", () => {
    const session = applyCommand(
      sessionFor(projectReferencing(FLAG_ID)),
      command("DeleteWorldFlagDefinition", FLAG_ID, { definitionId: FLAG_ID })
    );

    expect(getAllWorldFlagDefinitions(session)).toHaveLength(0);

    // Deliberate: deleting does not silently rewrite an author's content. The
    // surface warns first, and the save gate then names every orphan.
    const result = validateProjectContent(session.gameProject, [flagTestRegion()]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.filter((issue) => issue.severity === "error")
    ).toHaveLength(2);
  });
});

describe("reference counts and locations", () => {
  it("finds every place one flag is used", () => {
    const references = collectWorldFlagReferences(
      projectReferencing(FLAG_ID),
      []
    ).filter((reference) => reference.worldFlagId === FLAG_ID);

    expect(references).toHaveLength(2);
    expect(references.map((reference) => reference.where).join(" ")).toContain(
      "Check Gate"
    );
  });

  // Navigation reads ids off the reference, never by parsing `where`.
  it("carries the content's ids, not just prose", () => {
    const [reference] = collectWorldFlagReferences(
      projectReferencing(FLAG_ID),
      []
    );

    expect(reference.target.kind).toBe("quest-node");
    if (reference.target.kind === "quest-node") {
      expect(reference.target.questDefinitionId).toBe("quest:test");
      expect(reference.target.nodeId).toBeTruthy();
    }
  });
});

describe("unique flag names", () => {
  it("refuses a save when two flags share a name", () => {
    const project: GameProject = {
      ...createDefaultGameProject("Test", "test"),
      worldFlagDefinitions: [
        createWorldFlagDefinition({ name: "gate-open" }),
        createWorldFlagDefinition({ name: "gate-open" })
      ]
    };

    const result = validateProjectContent(project, []);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("gate-open")
      )
    ).toBe(true);
  });

  it("accepts distinct names", () => {
    const base = createDefaultGameProject("Test", "test");
    const project: GameProject = {
      ...base,
      episodes: base.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => ({
          ...scene,
          regionId: FLAG_TEST_REGION_ID
        }))
      })),
      worldFlagDefinitions: [
        createWorldFlagDefinition({ name: "gate-open" }),
        createWorldFlagDefinition({ name: "gate-shut" })
      ]
    };

    expect(
      validateProjectContent(project, [flagTestRegion()]).valid
    ).toBe(true);
  });
});
