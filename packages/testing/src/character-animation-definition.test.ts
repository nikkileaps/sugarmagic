/**
 * CharacterAnimationDefinition domain tests.
 *
 * Verifies the entity-owned content kind for character animation
 * clips. Same shape as CharacterModelDefinition + clipNames metadata.
 * Removing a definition cascades to clear any Player/NPC slot that
 * referenced it (so the runtime doesn't dereference dangling ids).
 */

import { describe, expect, it } from "vitest";
import {
  addCharacterAnimationDefinitionToSession,
  createAuthoringSession,
  createDefaultCharacterAnimationDefinition,
  createDefaultGameProject,
  createDefaultNPCDefinition,
  createEmptyContentLibrarySnapshot,
  getAllCharacterAnimationDefinitions,
  getAllNPCDefinitions,
  getPlayerDefinition,
  normalizeContentLibrarySnapshot,
  removeCharacterAnimationDefinitionFromSession,
  type AuthoringSession,
  type CharacterAnimationDefinition
} from "@sugarmagic/domain";

function makeAnimation(): CharacterAnimationDefinition {
  return createDefaultCharacterAnimationDefinition("little-world", {
    source: {
      relativeAssetPath: "assets/character-animations/walk.glb",
      fileName: "walk.glb",
      mimeType: "model/gltf-binary"
    },
    displayName: "Walk",
    clipNames: ["Walk"]
  });
}

describe("CharacterAnimationDefinition content library", () => {
  it("normalizes missing characterAnimationDefinitions to an empty collection", () => {
    const snapshot = createEmptyContentLibrarySnapshot("little-world");
    const normalized = normalizeContentLibrarySnapshot(
      {
        ...snapshot,
        characterAnimationDefinitions: undefined
      } as unknown as typeof snapshot,
      "little-world"
    );

    expect(normalized.characterAnimationDefinitions).toEqual([]);
  });

  it("preserves clipNames through CRUD round-trip", () => {
    const project = createDefaultGameProject("Little World", "little-world");
    const session = createAuthoringSession(project, []);
    const animation = makeAnimation();

    const withAnim = addCharacterAnimationDefinitionToSession(
      session,
      animation
    );
    const stored = getAllCharacterAnimationDefinitions(withAnim)[0];
    expect(stored?.clipNames).toEqual(["Walk"]);

    const withoutAnim = removeCharacterAnimationDefinitionFromSession(
      withAnim,
      animation.definitionId
    );
    expect(getAllCharacterAnimationDefinitions(withoutAnim)).toEqual([]);
  });

  it("clears Player and NPC slots when the referenced animation is removed", () => {
    const project = createDefaultGameProject("Little World", "little-world");
    project.npcDefinitions = [
      createDefaultNPCDefinition({ displayName: "Guard" })
    ];
    const baseSession = createAuthoringSession(project, []);

    const animation = makeAnimation();
    let session: AuthoringSession = addCharacterAnimationDefinitionToSession(
      baseSession,
      animation
    );
    // Bind it to the Player's walk slot AND the NPC's walk slot.
    session = {
      ...session,
      gameProject: {
        ...session.gameProject,
        playerDefinition: {
          ...session.gameProject.playerDefinition,
          presentation: {
            ...session.gameProject.playerDefinition.presentation,
            animationAssetBindings: {
              ...session.gameProject.playerDefinition.presentation
                .animationAssetBindings,
              walk: animation.definitionId
            }
          }
        },
        npcDefinitions: session.gameProject.npcDefinitions.map((n) => ({
          ...n,
          presentation: {
            ...n.presentation,
            animationAssetBindings: {
              ...n.presentation.animationAssetBindings,
              walk: animation.definitionId
            }
          }
        }))
      }
    };

    expect(
      getPlayerDefinition(session).presentation.animationAssetBindings.walk
    ).toBe(animation.definitionId);
    expect(
      getAllNPCDefinitions(session)[0]?.presentation.animationAssetBindings.walk
    ).toBe(animation.definitionId);

    const cleared = removeCharacterAnimationDefinitionFromSession(
      session,
      animation.definitionId
    );
    expect(
      getPlayerDefinition(cleared).presentation.animationAssetBindings.walk
    ).toBeNull();
    expect(
      getAllNPCDefinitions(cleared)[0]?.presentation.animationAssetBindings.walk
    ).toBeNull();
  });
});
