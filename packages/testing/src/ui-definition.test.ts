/**
 * Game UI authored data tests.
 *
 * Verifies that project-owned Menu/HUD/Theme content normalizes into the
 * GameProject source of truth and mutates through semantic commands.
 */

import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createUINode,
  normalizeGameProject,
  runtimeUIRef
} from "@sugarmagic/domain";

describe("project game UI definitions", () => {
  it("seeds starter menus, hud, and theme for legacy project records", () => {
    const project = normalizeGameProject({
      identity: { id: "project", schema: "GameProject", version: 1 },
      displayName: "Project",
      gameRootPath: ".",
      regionRegistry: [],
      contentLibraryId: "project:content-library"
    });

    expect(project.menuDefinitions.map((menu) => menu.menuKey)).toContain("start-menu");
    expect(project.menuDefinitions.map((menu) => menu.menuKey)).toContain("pause-menu");
    expect(project.hudDefinition?.definitionKind).toBe("hud");
    expect(project.uiTheme.tokens["color.primary"]).toBeTruthy();
  });

  it("applies menu, hud, and theme commands through the authoring session", () => {
    const project = createDefaultGameProject("Project", "project");
    let session = createAuthoringSession(project, []);
    const startMenu = session.gameProject.menuDefinitions.find(
      (menu) => menu.menuKey === "start-menu"
    )!;
    const hudRootId = session.gameProject.hudDefinition!.root.nodeId;
    const textNode = createUINode("text", {
      props: { text: runtimeUIRef("region.name") }
    });
    const hudBar = createUINode("progress-bar", {
      props: {
        value: runtimeUIRef("player.battery"),
        max: runtimeUIRef("player.maxBattery")
      }
    });

    session = applyCommand(session, {
      kind: "UpdateMenuDefinition",
      target: { aggregateKind: "game-project", aggregateId: "project" },
      subject: { subjectKind: "menu-definition", subjectId: startMenu.definitionId },
      payload: {
        definitionId: startMenu.definitionId,
        patch: { displayName: "Opening Menu", menuKey: "opening-menu" }
      }
    });

    session = applyCommand(session, {
      kind: "AddHUDNode",
      target: { aggregateKind: "game-project", aggregateId: "project" },
      subject: { subjectKind: "ui-node", subjectId: hudBar.nodeId },
      payload: { parentNodeId: hudRootId, node: hudBar }
    });

    session = applyCommand(session, {
      kind: "AddMenuNode",
      target: { aggregateKind: "game-project", aggregateId: "project" },
      subject: { subjectKind: "ui-node", subjectId: textNode.nodeId },
      payload: {
        definitionId: startMenu.definitionId,
        parentNodeId: startMenu.root.nodeId,
        node: textNode
      }
    });

    session = applyCommand(session, {
      kind: "UpdateUITheme",
      target: { aggregateKind: "game-project", aggregateId: "project" },
      subject: { subjectKind: "ui-theme", subjectId: "project" },
      payload: {
        theme: {
          ...session.gameProject.uiTheme,
          tokens: {
            ...session.gameProject.uiTheme.tokens,
            "color.primary": "#00ff00"
          }
        }
      }
    });

    expect(
      session.gameProject.menuDefinitions.find(
        (menu) => menu.definitionId === startMenu.definitionId
      )?.menuKey
    ).toBe("opening-menu");
    expect(
      session.gameProject.hudDefinition?.root.children.some(
        (node) => node.nodeId === hudBar.nodeId
      )
    ).toBe(true);
    expect(
      session.gameProject.menuDefinitions.find(
        (menu) => menu.definitionId === startMenu.definitionId
      )?.root.children.some((node) => node.nodeId === textNode.nodeId)
    ).toBe(true);
    expect(session.gameProject.uiTheme.tokens["color.primary"]).toBe("#00ff00");
  });
});
