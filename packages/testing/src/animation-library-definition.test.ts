/**
 * AnimationLibraryDefinition domain tests.
 *
 * Covers the AnimLib pool: session CRUD (upsert by definitionId),
 * the getCharacterAnimationDefinition fallthrough that synthesizes a
 * playable proxy for library-bound slots (the runtime playback
 * bridge), and the removal cascade that clears any Player/NPC slot
 * bound to a deleted library entry.
 */

import { describe, expect, it } from "vitest";
import {
  addAnimationLibraryDefinitionToSession,
  createAuthoringSession,
  createDefaultAnimationLibraryDefinition,
  createDefaultGameProject,
  createDefaultNPCDefinition,
  getAllAnimationLibraryDefinitions,
  getAllNPCDefinitions,
  getCharacterAnimationDefinition,
  getPlayerDefinition,
  removeAnimationLibraryDefinitionFromSession,
  resolveCharacterAnimationBinding,
  updateAnimationLibraryDefinitionInSession,
  type AnimationLibraryDefinition,
  type AuthoringSession
} from "@sugarmagic/domain";

function makeLibraryDefinition(
  overrides: Partial<
    Pick<AnimationLibraryDefinition, "definitionId" | "displayName">
  > = {}
): AnimationLibraryDefinition {
  return createDefaultAnimationLibraryDefinition("little-world", {
    definitionId:
      overrides.definitionId ?? "little-world:animation-library:tail-wag",
    displayName: overrides.displayName ?? "Tail Wag",
    origin: "imported",
    source: {
      relativeAssetPath: "assets/animations/tail-wag.glb",
      fileName: "tail-wag.glb",
      mimeType: "model/gltf-binary"
    },
    clipNames: ["Tail_Wag"]
  });
}

function makeSession(): AuthoringSession {
  const project = createDefaultGameProject("Little World", "little-world");
  project.npcDefinitions = [createDefaultNPCDefinition({ displayName: "Owl" })];
  return createAuthoringSession(project, []);
}

describe("AnimationLibraryDefinition session CRUD", () => {
  it("adds, updates, and removes library definitions", () => {
    const definition = makeLibraryDefinition();
    let session = addAnimationLibraryDefinitionToSession(
      makeSession(),
      definition
    );
    expect(getAllAnimationLibraryDefinitions(session)).toHaveLength(1);

    session = updateAnimationLibraryDefinitionInSession(
      session,
      definition.definitionId,
      { displayName: "Happy Tail" }
    );
    expect(getAllAnimationLibraryDefinitions(session)[0]?.displayName).toBe(
      "Happy Tail"
    );

    session = removeAnimationLibraryDefinitionFromSession(
      session,
      definition.definitionId
    );
    expect(getAllAnimationLibraryDefinitions(session)).toEqual([]);
  });

  it("upserts by definitionId instead of duplicating", () => {
    const definition = makeLibraryDefinition();
    let session = addAnimationLibraryDefinitionToSession(
      makeSession(),
      definition
    );
    session = addAnimationLibraryDefinitionToSession(
      session,
      makeLibraryDefinition({ displayName: "Tail Wag v2" })
    );

    const stored = getAllAnimationLibraryDefinitions(session);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.displayName).toBe("Tail Wag v2");
  });
});

describe("library fallthrough resolution", () => {
  it("synthesizes a playable proxy for a library-bound slot id", () => {
    const definition = makeLibraryDefinition();
    const session = addAnimationLibraryDefinitionToSession(
      makeSession(),
      definition
    );

    const resolved = getCharacterAnimationDefinition(
      session.contentLibrary,
      definition.definitionId
    );
    expect(resolved).toMatchObject({
      definitionId: definition.definitionId,
      definitionKind: "character-animation",
      displayName: "Tail Wag",
      clipNames: ["Tail_Wag"],
      source: definition.source
    });
  });

  it("prefers a per-character definition over the library pool", () => {
    const definition = makeLibraryDefinition();
    const direct = {
      ...definition,
      definitionKind: "character-animation" as const,
      displayName: "Direct Match"
    };
    const resolved = resolveCharacterAnimationBinding(
      [direct],
      [definition],
      definition.definitionId
    );
    expect(resolved?.displayName).toBe("Direct Match");
  });

  it("returns null once the library definition is removed", () => {
    const definition = makeLibraryDefinition();
    let session = addAnimationLibraryDefinitionToSession(
      makeSession(),
      definition
    );
    session = removeAnimationLibraryDefinitionFromSession(
      session,
      definition.definitionId
    );

    expect(
      getCharacterAnimationDefinition(
        session.contentLibrary,
        definition.definitionId
      )
    ).toBeNull();
  });
});

describe("library removal cascade", () => {
  it("clears Player and NPC slots bound to the removed library entry", () => {
    const definition = makeLibraryDefinition();
    let session = addAnimationLibraryDefinitionToSession(
      makeSession(),
      definition
    );
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
              idle: definition.definitionId
            }
          }
        },
        npcDefinitions: session.gameProject.npcDefinitions.map((npc) => ({
          ...npc,
          presentation: {
            ...npc.presentation,
            animationAssetBindings: {
              ...npc.presentation.animationAssetBindings,
              idle: definition.definitionId
            }
          }
        }))
      }
    };

    const cleared = removeAnimationLibraryDefinitionFromSession(
      session,
      definition.definitionId
    );
    expect(
      getPlayerDefinition(cleared).presentation.animationAssetBindings.idle
    ).toBeNull();
    expect(
      getAllNPCDefinitions(cleared)[0]?.presentation.animationAssetBindings.idle
    ).toBeNull();
  });
});
