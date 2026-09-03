/**
 * Quests are contained by their Scene (epic #226 story 5).
 *
 * A quest used to be a project-wide row in a flat list. It now belongs to
 * the Scene it happens in, the way a Scene belongs to an Episode -- so
 * "owned by exactly one" is structural rather than a rule someone has to
 * remember. These pin the containment, the load-time move that gets every
 * existing quest an owner, and the two things containment must NOT break:
 * the runtime still seeing every quest, and dialogue staying project-scoped.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultGameProject,
  createDefaultQuestDefinition,
  findSceneByQuestDefinitionId,
  getAllQuestDefinitionsInEpisodes,
  getAllScenes,
  normalizeGameProject,
  applyCommand,
  createAuthoringSession,
  createDefaultRegion,
  createDefaultScene,
  moveQuestToSceneInSession,
  takeQuestContainmentNotes,
  type GameProject,
  type QuestDefinition
} from "@sugarmagic/domain";
import { buildPublishedWebManagedFiles } from "@sugarmagic/plugins";

const QUEST_ID = "quest:find-the-cheese";

/**
 * A pre-#226 project as it appears on disk: quests in a flat list. The
 * flat key is gone from `GameProject`, so it rides alongside the typed
 * project the way the loader actually encounters it.
 */
function legacyProjectRaw(): GameProject & {
  questDefinitions: QuestDefinition[];
} {
  return {
    ...createDefaultGameProject("Test", "test"),
    questDefinitions: [
      createDefaultQuestDefinition({
        definitionId: QUEST_ID,
        displayName: "Find the Cheese"
      })
    ]
  };
}

describe("quest containment", () => {
  it("moves a flat quest onto the first Scene, and says so", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());
    const notes = takeQuestContainmentNotes();

    const scenes = getAllScenes(project.episodes);
    expect(scenes[0]!.questDefinitions.map((q) => q.definitionId)).toEqual([
      QUEST_ID
    ]);
    // Reported rather than relocated silently: the author has to know
    // where their quests went.
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      questDefinitionId: QUEST_ID,
      sceneId: scenes[0]!.sceneId
    });
  });

  it("a quest is owned by exactly one Scene", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());

    const owners = getAllScenes(project.episodes).filter((scene) =>
      scene.questDefinitions.some((q) => q.definitionId === QUEST_ID)
    );
    expect(owners).toHaveLength(1);
    expect(findSceneByQuestDefinitionId(project.episodes, QUEST_ID)).toBe(
      owners[0]
    );
  });

  it("running the move twice does not duplicate the quest", () => {
    takeQuestContainmentNotes();
    const once = normalizeGameProject(legacyProjectRaw());
    // A second load still sees the flat key on disk, beside the Scene
    // that now holds the quest. It must not land twice.
    const secondLoad: GameProject & { questDefinitions: QuestDefinition[] } = {
      ...once,
      questDefinitions: legacyProjectRaw().questDefinitions
    };
    const twice = normalizeGameProject(secondLoad);

    expect(
      getAllQuestDefinitionsInEpisodes(twice.episodes).filter(
        (q) => q.definitionId === QUEST_ID
      )
    ).toHaveLength(1);
  });

  it("the flat view still returns every quest, for the runtime", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());

    // The quest manager takes a flat array; containment is the storage,
    // this is the projection.
    expect(
      getAllQuestDefinitionsInEpisodes(project.episodes).map(
        (q) => q.definitionId
      )
    ).toEqual([QUEST_ID]);
  });

  it("moving a quest to another Scene keeps exactly one owner", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());
    const region = createDefaultRegion({
      regionId: "region:test",
      displayName: "Test"
    });
    let session = createAuthoringSession(
      {
        ...project,
        episodes: project.episodes.map((episode) => ({
          ...episode,
          scenes: [
            ...episode.scenes.map((scene) => ({
              ...scene,
              regionId: "region:test"
            })),
            createDefaultScene({
              sceneId: "scene:second",
              displayName: "Second",
              regionId: "region:test"
            })
          ]
        }))
      },
      [region]
    );

    session = moveQuestToSceneInSession(session, QUEST_ID, "scene:second");

    const owners = getAllScenes(session.gameProject.episodes).filter((scene) =>
      scene.questDefinitions.some((q) => q.definitionId === QUEST_ID)
    );
    expect(owners.map((scene) => scene.sceneId)).toEqual(["scene:second"]);

    // Moving it again is not a way to end up with two.
    session = moveQuestToSceneInSession(session, QUEST_ID, "scene:second");
    expect(
      getAllQuestDefinitionsInEpisodes(session.gameProject.episodes).filter(
        (q) => q.definitionId === QUEST_ID
      )
    ).toHaveLength(1);
  });

  it("creating a quest into a Scene that does not exist refuses loudly", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());
    const session = createAuthoringSession(project, [
      createDefaultRegion({ regionId: "region:test", displayName: "Test" })
    ]);
    const definition = createDefaultQuestDefinition({
      definitionId: "quest:new",
      displayName: "New"
    });

    // Before this story the command read the ambient `activeSceneId`, so
    // a null or stale one matched no Scene and the quest was created and
    // then silently DISCARDED. A visible error beats a vanished quest.
    expect(() =>
      applyCommand(session, {
        kind: "CreateQuestDefinition",
        target: {
          aggregateKind: "game-project",
          aggregateId: session.gameProject.identity.id
        },
        subject: {
          subjectKind: "quest-definition",
          subjectId: definition.definitionId
        },
        payload: { definition, sceneId: "scene:does-not-exist" }
      })
    ).toThrow(/does not exist/);
  });

  it("a created quest lands in the Scene it named", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());
    const session = createAuthoringSession(project, [
      createDefaultRegion({ regionId: "region:test", displayName: "Test" })
    ]);
    const target = getAllScenes(session.gameProject.episodes)[0]!;
    const definition = createDefaultQuestDefinition({
      definitionId: "quest:new",
      displayName: "New"
    });

    const next = applyCommand(session, {
      kind: "CreateQuestDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: session.gameProject.identity.id
      },
      subject: {
        subjectKind: "quest-definition",
        subjectId: definition.definitionId
      },
      payload: { definition, sceneId: target.sceneId }
    });

    expect(
      findSceneByQuestDefinitionId(next.gameProject.episodes, "quest:new")
        ?.sceneId
    ).toBe(target.sceneId);
  });

  it("the deploy bundle carries each quest exactly once", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject(legacyProjectRaw());

    const files = buildPublishedWebManagedFiles(project);
    const bootFile = files.find((file) =>
      file.relativePath.endsWith("boot.json")
    );
    const boot = JSON.parse(bootFile?.content ?? "{}");
    const shipped = (boot.questDefinitions ?? []) as Array<{
      definitionId: string;
    }>;

    // Derived at the wire seam from containment, so it appears once --
    // not once from a flat store and again from the Scene holding it.
    expect(shipped.filter((q) => q.definitionId === QUEST_ID)).toHaveLength(1);
  });
});
