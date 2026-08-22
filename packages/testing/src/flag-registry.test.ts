import { describe, expect, it } from "vitest";
import {
  createDefaultGameProject,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createFlagDefinition,
  createFlagNameResolver,
  findDuplicateFlagNames,
  migrateFlagReferences,
  normalizeGameProject,
  type GameProject
} from "@sugarmagic/domain";
import { buildPublishedWebManagedFiles } from "@sugarmagic/plugins";

/**
 * The flag registry and the chain that carries it. Most of that chain is
 * hand-written per-field code with no compiler check behind it, so a forgotten
 * line drops the field silently -- these are the tests that notice.
 */
describe("flag registry on GameProject", () => {
  it("defaults to an empty list for a project file saved before it existed", () => {
    const project = createDefaultGameProject("Test", "test");
    const { flagDefinitions: _dropped, ...withoutFlags } = project;

    const normalized = normalizeGameProject(withoutFlags as GameProject);

    expect(normalized.flagDefinitions).toEqual([]);
  });

  it("survives a normalize round trip", () => {
    const project = createDefaultGameProject("Test", "test");
    const flag = createFlagDefinition({ name: "gate-open" });

    const normalized = normalizeGameProject({
      ...project,
      flagDefinitions: [flag]
    });

    expect(normalized.flagDefinitions).toEqual([flag]);
  });

  it("resolves a reference to the flag's store key, and a stranger to null", () => {
    const flag = createFlagDefinition({ name: "gate-open" });
    const resolve = createFlagNameResolver([flag]);

    expect(resolve(flag.definitionId)).toBe("gate-open");
    expect(resolve("flag:not-here")).toBeNull();
  });

  // Two entries with one name share a slot in the runtime store, so two flags
  // the author sees as separate would read and write each other's value.
  it("reports duplicate names", () => {
    expect(
      findDuplicateFlagNames([
        createFlagDefinition({ name: "gate-open" }),
        createFlagDefinition({ name: "gate-open" }),
        createFlagDefinition({ name: "other" })
      ])
    ).toEqual(["gate-open"]);
    expect(
      findDuplicateFlagNames([createFlagDefinition({ name: "gate-open" })])
    ).toEqual([]);
  });
});

// buildBootJsonPayload returns Record<string, unknown>, so a forgotten line
// there compiles, and the published host casts boot.json without validating.
// This is the only thing standing between a dropped field and a game that
// silently has no flags.
describe("the deployed boot payload", () => {
  it("carries the flag registry", () => {
    const flag = createFlagDefinition({ name: "gate-open" });
    const files = buildPublishedWebManagedFiles({
      ...createDefaultGameProject("Test", "test"),
      flagDefinitions: [flag]
    });

    const bootFile = files.find((file) =>
      file.relativePath.endsWith("boot.json")
    );
    expect(bootFile).toBeDefined();

    const boot = JSON.parse(bootFile?.content ?? "{}");
    expect(boot.flagDefinitions).toEqual([flag]);
  });
});

describe("migrating flag references written before the registry", () => {
  function projectNamingFlag(name: string): GameProject {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Check",
            description: "Check the flag",
            nodeBehavior: "branch"
          }),
          condition: { type: "hasFlag", flagId: name, value: "true" },
          onCompleteActions: [{ type: "setFlag", flagId: name, value: "true" }]
        }
      ]
    });
    const quest = createDefaultQuestDefinition({
      definitionId: "quest:test",
      displayName: "Test"
    });
    return {
      ...createDefaultGameProject("Test", "test"),
      questDefinitions: [
        { ...quest, startStageId: stage.stageId, stageDefinitions: [stage] }
      ]
    };
  }

  function firstNodeOf(project: GameProject) {
    return project.questDefinitions[0].stageDefinitions[0].nodeDefinitions[0];
  }

  it("creates one entry per name and rewrites the references to its id", () => {
    const result = migrateFlagReferences(projectNamingFlag("gate-open"), []);

    expect(result.changed).toBe(true);
    expect(result.gameProject.flagDefinitions).toHaveLength(1);

    const [flag] = result.gameProject.flagDefinitions;
    expect(flag.name).toBe("gate-open");

    const node = firstNodeOf(result.gameProject);
    expect(node.condition).toMatchObject({ flagId: flag.definitionId });
    expect(node.onCompleteActions[0]).toMatchObject({
      flagId: flag.definitionId
    });
  });

  // A condition and an action naming the same flag must land on ONE entry --
  // two would put the writer and the reader in different store slots, which is
  // the silent miss this epic exists to remove.
  it("gives one name one entry however many places reference it", () => {
    const result = migrateFlagReferences(projectNamingFlag("gate-open"), []);
    expect(result.gameProject.flagDefinitions).toHaveLength(1);
  });

  it("changes nothing on a second run", () => {
    const once = migrateFlagReferences(projectNamingFlag("gate-open"), []);
    const twice = migrateFlagReferences(once.gameProject, once.regions);

    expect(twice.changed).toBe(false);
    expect(twice.gameProject.flagDefinitions).toEqual(
      once.gameProject.flagDefinitions
    );
    expect(firstNodeOf(twice.gameProject).condition).toEqual(
      firstNodeOf(once.gameProject).condition
    );
  });

  it("leaves a project with no flag references alone", () => {
    const result = migrateFlagReferences(
      createDefaultGameProject("Test", "test"),
      []
    );

    expect(result.changed).toBe(false);
    expect(result.gameProject.flagDefinitions).toEqual([]);
  });
});
