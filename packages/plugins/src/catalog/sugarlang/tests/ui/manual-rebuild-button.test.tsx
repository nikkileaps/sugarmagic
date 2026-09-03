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
import {
  createDefaultDeploymentSettings,
  normalizeGameProject
} from "@sugarmagic/domain";
import {
  createTestDocumentDefinitions,
  createTestSceneAuthoringContext
} from "../compile/test-helpers";
import {
  readSugarlangCompileStatus,
  rebuildSugarlangCompileCache,
  resolveStudioCompileWorkspaceId
} from "../../ui/shell/editor-support";

function createGameProjectFixture(): { gameProject: GameProject; region: ReturnType<typeof createTestSceneAuthoringContext>["region"] } {
  const scene = createTestSceneAuthoringContext();

  return {
    region: scene.region,
    gameProject: normalizeGameProject({
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
      documentDefinitions: createTestDocumentDefinitions(),
      npcDefinitions: scene.npcs,
      dialogueDefinitions: scene.dialogues
    })
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
      null,
      workspaceId
    );
    const progress: number[] = [];

    const after = await rebuildSugarlangCompileCache(
      gameProject,
      [region],
      "es",
      null,
      workspaceId,
      (next) => {
        progress.push(next.completedScenes);
      }
    );

    expect(before.totalScenes).toBe(1);
    expect(before.missingScenes).toBe(1);
    expect(after.status.cachedScenes).toBe(1);
    expect(after.status.missingScenes).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it("reports the missing gateway as a PROBLEM, not as a successful rebuild", async () => {
    // This test exists because the opposite was true: with no gateway URL the
    // scene-context, chunk and teach-plan passes were all silently skipped and
    // the button still said "rebuilt successfully". The build then looks fine
    // and the game quietly teaches nothing its scenes are about -- which
    // presents much later as "the Teacher made a boring choice" and sends
    // someone debugging the wrong layer entirely.
    const { gameProject, region } = createGameProjectFixture();
    const workspaceId = resolveStudioCompileWorkspaceId(gameProject.identity.id);

    const result = await rebuildSugarlangCompileCache(
      gameProject,
      [region],
      "es",
      null,
      workspaceId,
      () => {}
    );

    const gatewayProblem = result.problems.find(
      (problem) => problem.pass === "gateway"
    );
    expect(gatewayProblem).toBeDefined();
    expect(gatewayProblem?.message).toContain("NOT built");
  });

  it("090.11: STUDIO tolerates a null target language -- reading status does not throw", async () => {
    // A freshly installed plugin has no language, and the author needs the Build
    // panel to open so they can go set one. This used to throw
    // `Missing sugarlang cefrlex data for language ""` out of
    // computeCurrentSceneHashes -> atlas.getAtlasVersion(""), and the panel's
    // status read had no .catch -- so merely OPENING the panel on a new project
    // was an unhandled rejection.
    const { gameProject, region } = createGameProjectFixture();
    const workspaceId = resolveStudioCompileWorkspaceId(gameProject.identity.id);

    const status = await readSugarlangCompileStatus(
      gameProject,
      [region],
      "",
      null,
      workspaceId
    );

    expect(status.totalScenes).toBe(0);
  });

  it("090.11: Rebuild REFUSES on a null target language without invalidating the cache", async () => {
    // ORDER IS THE WHOLE POINT. `cache.invalidate()` runs early in the rebuild,
    // and the throw used to happen after it -- so pressing Rebuild on an
    // unconfigured project wiped the compile cache and THEN failed.
    //
    // Validate first, refuse with an explanation, change nothing.
    const { gameProject, region } = createGameProjectFixture();
    const workspaceId = resolveStudioCompileWorkspaceId(gameProject.identity.id);

    // Build a real cache entry, then confirm the refusal leaves it alone.
    await rebuildSugarlangCompileCache(
      gameProject,
      [region],
      "es",
      null,
      workspaceId,
      () => {}
    );
    const before = await readSugarlangCompileStatus(
      gameProject,
      [region],
      "es",
      null,
      workspaceId
    );
    expect(before.cachedScenes).toBe(1);

    const refused = await rebuildSugarlangCompileCache(
      gameProject,
      [region],
      "",
      null,
      workspaceId,
      () => {}
    );

    expect(refused.problems.some((p) => p.message.includes("No target language"))).toBe(
      true
    );

    // The cache survived the refusal.
    const after = await readSugarlangCompileStatus(
      gameProject,
      [region],
      "es",
      null,
      workspaceId
    );
    expect(after.cachedScenes).toBe(1);
  });
});
