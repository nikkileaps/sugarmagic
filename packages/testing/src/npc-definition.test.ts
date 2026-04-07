import { describe, expect, it, vi } from "vitest";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultNPCDefinition,
  getAllNPCDefinitions,
  normalizeNPCDefinition
} from "@sugarmagic/domain";
import type { NPCDefinition } from "@sugarmagic/domain";

function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

describe("npc definition authoring", () => {
  it("creates NPC definitions with UUID identities", () => {
    const definition = createDefaultNPCDefinition();
    expect(uuidLike(definition.definitionId)).toBe(true);
    expect(definition.displayName).toBe("New NPC");
  });

  it("creates, updates, and deletes NPC definitions through the command boundary", () => {
    const project = createDefaultGameProject("Sugarmagic", "sugarmagic");
    const session = createAuthoringSession(project, []);
    const definition = createDefaultNPCDefinition({ displayName: "Station Guard" });

    const created = applyCommand(session, {
      kind: "CreateNPCDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: project.identity.id
      },
      subject: {
        subjectKind: "npc-definition",
        subjectId: definition.definitionId
      },
      payload: {
        definition
      }
    });

    expect(getAllNPCDefinitions(created)).toHaveLength(1);
    expect(getAllNPCDefinitions(created)[0]?.displayName).toBe("Station Guard");

    const updatedDefinition = {
      ...definition,
      description: "Keeps watch over the station entrance.",
      presentation: {
        ...definition.presentation,
        modelHeight: 1.92
      }
    };

    const updated = applyCommand(created, {
      kind: "UpdateNPCDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: project.identity.id
      },
      subject: {
        subjectKind: "npc-definition",
        subjectId: definition.definitionId
      },
      payload: {
        definition: updatedDefinition
      }
    });

    expect(getAllNPCDefinitions(updated)[0]?.description).toContain("station entrance");
    expect(getAllNPCDefinitions(updated)[0]?.presentation.modelHeight).toBe(1.92);

    const deleted = applyCommand(updated, {
      kind: "DeleteNPCDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: project.identity.id
      },
      subject: {
        subjectKind: "npc-definition",
        subjectId: definition.definitionId
      },
      payload: {
        definitionId: definition.definitionId
      }
    });

    expect(getAllNPCDefinitions(deleted)).toHaveLength(0);
    expect(deleted.undoStack).toHaveLength(3);
  });

  it('warns and migrates legacy "guided" interaction mode on read', () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const normalized = normalizeNPCDefinition({
      definitionId: "npc-legacy-rick",
      displayName: "Rick Roll",
      interactionMode: "guided" as never,
      lorePageId: null,
      presentation: {
        modelAssetDefinitionId: null,
        modelHeight: 1.7,
        animationAssetBindings: {
          idle: null,
          walk: null,
          run: null
        }
      }
    });

    expect(normalized.interactionMode).toBe("agent");
    expect(warnSpy).toHaveBeenCalledWith(
      '[domain] NPC interaction mode "guided" is deprecated and will be migrated to "agent" on load.'
    );

    warnSpy.mockRestore();
  });

  it('rejects writing legacy "guided" interaction mode through the command boundary', () => {
    const project = createDefaultGameProject("Sugarmagic", "sugarmagic");
    const session = createAuthoringSession(project, []);
    const definition = {
      ...createDefaultNPCDefinition({ displayName: "Legacy Rick" }),
      interactionMode: "guided"
    } as unknown as NPCDefinition;

    expect(() =>
      applyCommand(session, {
        kind: "CreateNPCDefinition",
        target: {
          aggregateKind: "game-project",
          aggregateId: project.identity.id
        },
        subject: {
          subjectKind: "npc-definition",
          subjectId: definition.definitionId
        },
        payload: {
          definition
        }
      })
    ).toThrow('NPC interaction mode "guided" is no longer supported. Use "agent" instead.');
  });
});
