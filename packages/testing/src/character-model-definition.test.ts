/**
 * CharacterModelDefinition domain tests.
 *
 * Verifies the entity-owned content kind: character `.glb`s are stored in the
 * project content library (asset-resolvable, version-controlled) but are
 * separate from general scene assets so they don't pollute Build > Layout's
 * asset list. Removing a definition also clears any Player/NPC binding that
 * pointed at it.
 */

import { describe, expect, it } from "vitest";
import {
  addCharacterModelDefinitionToSession,
  createAuthoringSession,
  createDefaultCharacterModelDefinition,
  createDefaultGameProject,
  createDefaultNPCDefinition,
  createEmptyContentLibrarySnapshot,
  getAllCharacterModelDefinitions,
  getAllNPCDefinitions,
  getPlayerDefinition,
  normalizeContentLibrarySnapshot,
  removeCharacterModelDefinitionFromSession,
  type AuthoringSession,
  type CharacterModelDefinition
} from "@sugarmagic/domain";

function makeModel(): CharacterModelDefinition {
  return createDefaultCharacterModelDefinition("little-world", {
    source: {
      relativeAssetPath: "assets/character-models/villager.glb",
      fileName: "villager.glb",
      mimeType: "model/gltf-binary"
    },
    displayName: "Villager"
  });
}

describe("CharacterModelDefinition content library", () => {
  it("normalizes missing characterModelDefinitions to an empty collection", () => {
    const snapshot = createEmptyContentLibrarySnapshot("little-world");
    const normalized = normalizeContentLibrarySnapshot(
      {
        ...snapshot,
        characterModelDefinitions: undefined
      } as unknown as typeof snapshot,
      "little-world"
    );

    expect(normalized.characterModelDefinitions).toEqual([]);
  });

  it("adds and removes character models through the authoring session", () => {
    const project = createDefaultGameProject("Little World", "little-world");
    const session = createAuthoringSession(project, []);
    const model = makeModel();

    const withModel = addCharacterModelDefinitionToSession(session, model);
    expect(getAllCharacterModelDefinitions(withModel)).toEqual([model]);

    const withoutModel = removeCharacterModelDefinitionFromSession(
      withModel,
      model.definitionId
    );
    expect(getAllCharacterModelDefinitions(withoutModel)).toEqual([]);
  });

  it("clears Player and NPC bindings when the referenced model is removed", () => {
    const project = createDefaultGameProject("Little World", "little-world");
    project.npcDefinitions = [createDefaultNPCDefinition({ displayName: "Guard" })];
    const baseSession = createAuthoringSession(project, []);

    const model = makeModel();
    let session: AuthoringSession = addCharacterModelDefinitionToSession(
      baseSession,
      model
    );
    // Manually bind: simulating what the inspector does after import.
    session = {
      ...session,
      gameProject: {
        ...session.gameProject,
        playerDefinition: {
          ...session.gameProject.playerDefinition,
          presentation: {
            ...session.gameProject.playerDefinition.presentation,
            modelAssetDefinitionId: model.definitionId
          }
        },
        npcDefinitions: session.gameProject.npcDefinitions.map((n) => ({
          ...n,
          presentation: {
            ...n.presentation,
            modelAssetDefinitionId: model.definitionId
          }
        }))
      }
    };

    expect(getPlayerDefinition(session).presentation.modelAssetDefinitionId).toBe(
      model.definitionId
    );
    expect(
      getAllNPCDefinitions(session)[0]?.presentation.modelAssetDefinitionId
    ).toBe(model.definitionId);

    const cleared = removeCharacterModelDefinitionFromSession(
      session,
      model.definitionId
    );
    expect(
      getPlayerDefinition(cleared).presentation.modelAssetDefinitionId
    ).toBeNull();
    expect(
      getAllNPCDefinitions(cleared)[0]?.presentation.modelAssetDefinitionId
    ).toBeNull();
  });
});
