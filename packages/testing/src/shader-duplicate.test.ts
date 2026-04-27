import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultGrassSurface6ShaderGraph,
  createDefaultFoliageSurface3ShaderGraph,
  duplicateShaderGraphDocument,
  getAllShaderDefinitions,
  validateShaderGraphDocument
} from "@sugarmagic/domain";

describe("duplicateShaderGraphDocument", () => {
  it("produces a Grass Surface 6 fork that passes validation", () => {
    const source = createDefaultGrassSurface6ShaderGraph("wordlark");
    const fork = duplicateShaderGraphDocument(source, "wordlark");
    const issues = validateShaderGraphDocument(fork).filter(
      (i) => i.severity === "error"
    );
    expect(issues).toEqual([]);
    expect(fork.shaderDefinitionId).not.toBe(source.shaderDefinitionId);
    expect(fork.metadata.builtIn).toBeUndefined();
  });

  it("produces a Foliage Surface 3 fork that passes validation", () => {
    const source = createDefaultFoliageSurface3ShaderGraph("wordlark");
    const fork = duplicateShaderGraphDocument(source, "wordlark");
    const issues = validateShaderGraphDocument(fork).filter(
      (i) => i.severity === "error"
    );
    expect(issues).toEqual([]);
  });

  it("dispatching CreateShaderGraph with a duplicate appends to the session's shader list", () => {
    const project = createDefaultGameProject("Test", "test");
    const session = createAuthoringSession(project, []);
    const sourceList = getAllShaderDefinitions(session);
    const grass6 = sourceList.find((s) => /grass-surface-6/i.test(s.shaderDefinitionId));
    if (!grass6) {
      throw new Error("Test setup: no grass-surface-6 in session.");
    }
    const fork = duplicateShaderGraphDocument(grass6, "test");

    const next = applyCommand(session, {
      kind: "CreateShaderGraph",
      target: {
        aggregateKind: "content-definition",
        aggregateId: fork.shaderDefinitionId
      },
      subject: {
        subjectKind: "shader-definition",
        subjectId: fork.shaderDefinitionId
      },
      payload: { definition: fork }
    });

    const after = getAllShaderDefinitions(next);
    expect(after.length).toBe(sourceList.length + 1);
    expect(after.some((s) => s.shaderDefinitionId === fork.shaderDefinitionId)).toBe(true);
  });

  it("inserts the duplicate immediately after its source when insertAfterShaderDefinitionId is set", () => {
    const project = createDefaultGameProject("Test", "test");
    const session = createAuthoringSession(project, []);
    const sourceList = getAllShaderDefinitions(session);
    const grass6 = sourceList.find((s) => /grass-surface-6/i.test(s.shaderDefinitionId));
    if (!grass6) {
      throw new Error("Test setup: no grass-surface-6 in session.");
    }
    const sourceIndex = sourceList.findIndex(
      (s) => s.shaderDefinitionId === grass6.shaderDefinitionId
    );
    const fork = duplicateShaderGraphDocument(grass6, "test");

    const next = applyCommand(session, {
      kind: "CreateShaderGraph",
      target: {
        aggregateKind: "content-definition",
        aggregateId: fork.shaderDefinitionId
      },
      subject: {
        subjectKind: "shader-definition",
        subjectId: fork.shaderDefinitionId
      },
      payload: {
        definition: fork,
        insertAfterShaderDefinitionId: grass6.shaderDefinitionId
      }
    });

    const after = getAllShaderDefinitions(next);
    expect(after[sourceIndex + 1]?.shaderDefinitionId).toBe(fork.shaderDefinitionId);
  });
});
