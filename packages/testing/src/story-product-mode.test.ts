/**
 * The Story product mode (epic #226 story 7).
 *
 * The narrative has its own place: Episodes and the Scenes they hold, the
 * quests those Scenes contain, and the dialogue the quests use. Quests
 * and dialogue moved out of Design, which keeps the definitions that
 * exist independent of a story.
 *
 * These pin the wiring and the move. Whether the surface is USABLE is
 * eyes-on-Studio work, not something a test can claim.
 */

import { describe, expect, it } from "vitest";
import {
  getProductModeDescriptor,
  productModes,
  storyProductMode
} from "@sugarmagic/productmodes";
import {
  CORE_DESIGN_WORKSPACE_KINDS,
  CORE_STORY_WORKSPACE_KINDS,
  createShellStore,
  deriveStoryWorkspaceId
} from "@sugarmagic/shell";

describe("Story product mode", () => {
  it("is registered and reachable by id", () => {
    expect(productModes.map((mode) => mode.id)).toContain("story");
    expect(getProductModeDescriptor("story")).toBe(storyProductMode);
  });

  it("owns structure, the composer, quests, and dialogues", () => {
    expect(CORE_STORY_WORKSPACE_KINDS).toEqual([
      "structure",
      "composer",
      "quests",
      "dialogues"
    ]);
    expect(storyProductMode.workspaceKinds).toEqual([
      "structure",
      "composer",
      "quests",
      "dialogues"
    ]);
  });

  it("Design no longer owns quests or dialogue", () => {
    // They moved modes, not implementations -- but Design must not be
    // able to render them too, or two modes answer one question.
    expect(CORE_DESIGN_WORKSPACE_KINDS).not.toContain("quests");
    expect(CORE_DESIGN_WORKSPACE_KINDS).not.toContain("dialogues");
    expect(getProductModeDescriptor("design").workspaceKinds).not.toContain(
      "quests"
    );
  });

  it("selecting the mode lands on a story workspace", () => {
    const store = createShellStore();
    store.getState().setActiveProductMode("story");

    expect(store.getState().activeProductMode).toBe("story");
    expect(store.getState().activeWorkspaceId).toBe(
      deriveStoryWorkspaceId("structure")
    );
  });

  it("switching workspace inside the mode moves the active workspace", () => {
    const store = createShellStore();
    store.getState().setActiveProductMode("story");
    store.getState().setActiveStoryWorkspaceKind("quests");

    expect(store.getState().activeStoryWorkspaceKind).toBe("quests");
    expect(store.getState().activeWorkspaceId).toBe(
      deriveStoryWorkspaceId("quests")
    );
  });

  it("switching workspace from another mode does not steal the view", () => {
    const store = createShellStore();
    store.getState().setActiveProductMode("build");
    const before = store.getState().activeWorkspaceId;
    store.getState().setActiveStoryWorkspaceKind("dialogues");

    expect(store.getState().activeStoryWorkspaceKind).toBe("dialogues");
    expect(store.getState().activeWorkspaceId).toBe(before);
  });
});
