/**
 * Region residents are reachable everywhere a Scene placement is (epic
 * #226 story 3).
 *
 * Composition is only half the story: several passes walked
 * `Scene.regionOverlays` directly and would have skipped a region's own
 * residents entirely -- a mutation that silently did nothing, a shader
 * reference left dangling, a quest binding never validated. One test per
 * pass, each one failing before the seam was re-pointed.
 */

import { describe, expect, it } from "vitest";
import {
  collectWorldFlagReferences,
  createDefaultRegion,
  createDefaultScene,
  createDefaultGameProject,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  executeCommand,
  validateProjectContent,
  type RegionDocument,
  type SemanticCommand
} from "@sugarmagic/domain";

const REGION_ID = "region:village";
const RESIDENT_ID = "presence:finnick";

function regionWithResident(): RegionDocument {
  const region = createDefaultRegion({
    regionId: REGION_ID,
    displayName: "Village"
  });
  region.npcPresences = [
    createRegionNPCPresence({
      presenceId: RESIDENT_ID,
      npcDefinitionId: "npc:finnick"
    })
  ];
  return region;
}

const scene = createDefaultScene({ sceneId: "scene:market-day" });

describe("region residents reach every pass a Scene placement does", () => {
  it("a transform command moves a resident instead of doing nothing", () => {
    const command: SemanticCommand = {
      kind: "TransformNPCPresence",
      target: { aggregateKind: "region-document", aggregateId: REGION_ID },
      subject: { subjectKind: "npc-presence", subjectId: RESIDENT_ID },
      payload: {
        presenceId: RESIDENT_ID,
        position: [5, 0, 7],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    };

    const result = executeCommand(
      { region: regionWithResident(), scene },
      command
    );

    expect(result.region.npcPresences[0]?.transform.position).toEqual([5, 0, 7]);
  });

  it("a remove command removes a resident", () => {
    const command: SemanticCommand = {
      kind: "RemoveNPCPresence",
      target: { aggregateKind: "region-document", aggregateId: REGION_ID },
      subject: { subjectKind: "npc-presence", subjectId: RESIDENT_ID },
      payload: { presenceId: RESIDENT_ID }
    };

    const result = executeCommand(
      { region: regionWithResident(), scene },
      command
    );

    expect(result.region.npcPresences).toEqual([]);
  });

  it("transform and remove both reach a region-owned player start", () => {
    const region = createDefaultRegion({
      regionId: REGION_ID,
      displayName: "Village"
    });
    region.playerPresence = createRegionPlayerPresence({
      presenceId: "presence:player-region"
    });
    const target = {
      aggregateKind: "region-document" as const,
      aggregateId: REGION_ID
    };
    const subject = {
      subjectKind: "player-presence" as const,
      subjectId: "presence:player-region"
    };

    const moved = executeCommand(
      { region, scene },
      {
        kind: "TransformPlayerPresence",
        target,
        subject,
        payload: {
          presenceId: "presence:player-region",
          position: [3, 0, 9],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      }
    );
    expect(moved.region.playerPresence?.transform.position).toEqual([3, 0, 9]);

    const removed = executeCommand(
      { region, scene },
      {
        kind: "RemovePlayerPresence",
        target,
        subject,
        payload: { presenceId: "presence:player-region" }
      }
    );
    expect(removed.region.playerPresence).toBeNull();
  });

  it("a resident's quest binding is validated", () => {
    const region = regionWithResident();
    region.npcPresences[0]!.condition = {
      questDefinitionId: "quest:does-not-exist",
      questStageId: null,
      worldFlagEquals: null
    };

    const report = validateProjectContent(
      createDefaultGameProject("Test", "project-test"),
      [region]
    );

    // The binding names a quest that does not exist. Before this story the
    // validator never walked region residents, so it passed silently.
    expect(
      report.issues.some((issue) =>
        issue.message.includes("quest:does-not-exist")
      )
    ).toBe(true);
  });

  it("a resident's world-flag reference is collected", () => {
    const region = regionWithResident();
    region.npcPresences[0]!.condition = {
      questDefinitionId: null,
      questStageId: null,
      worldFlagEquals: {
        worldFlagId: "flag:market-open",
        valueType: "boolean",
        value: "true"
      }
    };

    const references = collectWorldFlagReferences(
      createDefaultGameProject("Test", "project-test"),
      [region]
    );

    expect(
      references.some(
        (reference) =>
          reference.target.kind === "npc-placement" &&
          reference.target.presenceId === RESIDENT_ID &&
          reference.target.sceneId === null
      )
    ).toBe(true);
  });
});
