import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultSpellDefinition,
  getAllSpellDefinitions
} from "@sugarmagic/domain";

describe("spell definition authoring", () => {
  it("creates spell definitions through the command boundary", () => {
    const project = createDefaultGameProject("Sugarmagic", "sugarmagic");
    const session = createAuthoringSession(project, []);
    const definition = createDefaultSpellDefinition({
      displayName: "Kindle"
    });

    const created = applyCommand(session, {
      kind: "CreateSpellDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: project.identity.id
      },
      subject: {
        subjectKind: "spell-definition",
        subjectId: definition.definitionId
      },
      payload: {
        definition
      }
    });

    expect(getAllSpellDefinitions(created)).toHaveLength(1);
    expect(getAllSpellDefinitions(created)[0]?.definitionId).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });
});
