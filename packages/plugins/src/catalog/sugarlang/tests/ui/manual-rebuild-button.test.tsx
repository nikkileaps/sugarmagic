/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/manual-rebuild-button.test.tsx
 *
 * Purpose: Verifies the Sugarlang compile-status and rebuild helper flow.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/editor-support.
 *   - Guards the Epic 12 manual rebuild affordance against cache drift regressions.
 *
 * Implements: Epic 12 Story 12.3
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { GameProject } from "@sugarmagic/domain";
import { createDefaultDeploymentSettings } from "@sugarmagic/domain";
import { createTestSceneAuthoringContext } from "../compile/test-helpers";
import {
  readSugarlangCompileStatus,
  rebuildSugarlangCompileCache,
  resolveStudioCompileWorkspaceId
} from "../../ui/shell/editor-support";

function createGameProjectFixture(): { gameProject: GameProject; region: ReturnType<typeof createTestSceneAuthoringContext>["region"] } {
  const scene = createTestSceneAuthoringContext();

  return {
    region: scene.region,
    gameProject: {
      identity: { id: "project-1", schema: "GameProject", version: 1 },
      displayName: "Wordlark Hollow",
      gameRootPath: ".",
      deployment: createDefaultDeploymentSettings(),
      regionRegistry: [],
      pluginConfigurations: [],
      contentLibraryId: "project-1:content-library",
      playerDefinition: {
        definitionId: "player-1",
        displayName: "Player",
        physicalProfile: { height: 1.8, radius: 0.35, eyeHeight: 1.62 },
        movementProfile: { walkSpeed: 4.5, runSpeed: 6.5, acceleration: 10 },
        presentation: {
          modelAssetDefinitionId: null,
          animationAssetBindings: { idle: null, walk: null, run: null }
        },
        casterProfile: {
          initialBattery: 100,
          rechargeRate: 1,
          initialResonance: 0,
          allowedSpellTags: [],
          blockedSpellTags: []
        }
      },
      spellDefinitions: [],
      itemDefinitions: scene.items,
      documentDefinitions: scene.lorePages,
      npcDefinitions: scene.npcs,
      dialogueDefinitions: scene.dialogues,
      questDefinitions: scene.quests
    }
  };
}

describe("Sugarlang compile rebuild helpers", () => {
  it("reports missing scenes before rebuild and cached scenes after rebuild", async () => {
    const { gameProject, region } = createGameProjectFixture();
    const workspaceId = resolveStudioCompileWorkspaceId(gameProject.identity.id);

    const before = await readSugarlangCompileStatus(
      gameProject,
      [region],
      "es",
      workspaceId
    );
    const progress: number[] = [];

    const after = await rebuildSugarlangCompileCache(
      gameProject,
      [region],
      "es",
      workspaceId,
      (next) => {
        progress.push(next.completedScenes);
      }
    );

    expect(before.totalScenes).toBe(1);
    expect(before.missingScenes).toBe(1);
    expect(after.cachedScenes).toBe(1);
    expect(after.missingScenes).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });
});
