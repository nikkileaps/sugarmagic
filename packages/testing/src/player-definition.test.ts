import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultPlayerDefinition,
  getPlayerDefinition
} from "@sugarmagic/domain";

describe("player definition authoring", () => {
  it("creates new projects with a canonical player definition", () => {
    const project = createDefaultGameProject("Sugarmagic", "sugarmagic");
    expect(project.playerDefinition.displayName).toBe("Player");
    expect(project.playerDefinition.physicalProfile.height).toBeGreaterThan(1);
    expect(project.playerDefinition.casterProfile.initialBattery).toBeGreaterThan(0);
  });

  it("updates player definition through the authoring command boundary", () => {
    const project = createDefaultGameProject("Sugarmagic", "sugarmagic");
    const session = createAuthoringSession(project, []);
    const nextDefinition = createDefaultPlayerDefinition(project.identity.id, {
      definitionId: session.gameProject.playerDefinition.definitionId,
      displayName: "Holly"
    });

    const updated = applyCommand(session, {
      kind: "UpdatePlayerDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: session.gameProject.identity.id
      },
      subject: {
        subjectKind: "player-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: {
          ...nextDefinition,
          movementProfile: {
            ...nextDefinition.movementProfile,
            walkSpeed: 5.2
          },
          casterProfile: {
            ...nextDefinition.casterProfile,
            allowedSpellTags: ["ritual"],
            initialBattery: 8
          }
        }
      }
    });

    expect(getPlayerDefinition(updated).displayName).toBe("Holly");
    expect(getPlayerDefinition(updated).movementProfile.walkSpeed).toBe(5.2);
    expect(getPlayerDefinition(updated).casterProfile.allowedSpellTags).toEqual(["ritual"]);
    expect(getPlayerDefinition(updated).casterProfile.initialBattery).toBe(8);
    expect(updated.undoStack).toHaveLength(1);
  });
});
