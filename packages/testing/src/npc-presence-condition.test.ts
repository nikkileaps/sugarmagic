/**
 * packages/testing/src/npc-presence-condition.test.ts
 *
 * Purpose: Guards Plan 079.1 -- condition field on RegionNPCPresence,
 * SetNPCPresenceCondition command round-trip, legacy-load normalization,
 * and factory normalization.
 * Also guards Plan 079.6 -- placementLabel field + SetNPCPresenceLabel command.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultPlayerDefinition,
  createRegionBehaviorQuestBinding,
  createRegionNPCPresence,
  getActiveRegionContents,
  normalizeGameProject
} from "@sugarmagic/domain";

function makeSetLabelCmd(label: string | null) {
  return {
    kind: "SetNPCPresenceLabel" as const,
    target: {
      aggregateKind: "region-document" as const,
      aggregateId: REGION_ID
    },
    subject: {
      subjectKind: "npc-presence" as const,
      subjectId: PRESENCE_ID
    },
    payload: { presenceId: PRESENCE_ID, label }
  };
}

const REGION_ID = "region:hollow";
const PRESENCE_ID = "p:cheese-merchant";
const NPC_DEF_ID = "npc:finn";

function makeRegion(): RegionDocument {
  return {
    identity: { id: REGION_ID, schema: "RegionDocument", version: 1 },
    displayName: "Wordlark Hollow",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    behaviors: [],
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 160,
      surfaceSlots: [],
      deform: null,
      effect: null,
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

function makeSession() {
  return createAuthoringSession(
    normalizeGameProject({
      identity: { id: "project", schema: "GameProject", version: 1 },
      displayName: "Project",
      gameRootPath: ".",
      regionRegistry: [{ regionId: REGION_ID }],
      pluginConfigurations: [],
      contentLibraryId: "project:content-library",
      playerDefinition: createDefaultPlayerDefinition("project"),
      spellDefinitions: [],
      npcDefinitions: [],
      dialogueDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: [],
      questDefinitions: []
    }),
    [makeRegion()]
  );
}

function makeCreateCmd() {
  return {
    kind: "CreateNPCPresence" as const,
    target: {
      aggregateKind: "region-document" as const,
      aggregateId: REGION_ID
    },
    subject: {
      subjectKind: "npc-presence" as const,
      subjectId: PRESENCE_ID
    },
    payload: {
      presenceId: PRESENCE_ID,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      npcDefinitionId: NPC_DEF_ID
    }
  };
}

function makeSetConditionCmd(
  condition: {
    questDefinitionId: string | null;
    questStageId: string | null;
    worldFlagEquals: { flagId: string; expectedValue: boolean } | null;
  } | null
) {
  return {
    kind: "SetNPCPresenceCondition" as const,
    target: {
      aggregateKind: "region-document" as const,
      aggregateId: REGION_ID
    },
    subject: {
      subjectKind: "npc-presence" as const,
      subjectId: PRESENCE_ID
    },
    payload: {
      presenceId: PRESENCE_ID,
      condition
    }
  };
}

describe("RegionNPCPresence condition field (079.1)", () => {
  it("factory defaults condition to null", () => {
    const presence = createRegionNPCPresence({ npcDefinitionId: NPC_DEF_ID });
    expect(presence.condition).toBeNull();
  });

  it("factory normalizes a provided binding through createRegionBehaviorQuestBinding", () => {
    const binding = createRegionBehaviorQuestBinding({
      questDefinitionId: "quest:find-cheese",
      questStageId: "stage:searching",
      worldFlagEquals: null
    });
    const presence = createRegionNPCPresence({
      npcDefinitionId: NPC_DEF_ID,
      condition: binding
    });
    expect(presence.condition).toEqual(binding);
  });

  it("CreateNPCPresence sets condition null on new presences", () => {
    const session = applyCommand(makeSession(), makeCreateCmd());
    const contents = getActiveRegionContents(session);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.condition).toBeNull();
  });

  it("SetNPCPresenceCondition round-trip: create -> set compound binding -> read back", () => {
    const s1 = applyCommand(makeSession(), makeCreateCmd());
    const s2 = applyCommand(
      s1,
      makeSetConditionCmd({
        questDefinitionId: "quest:find-cheese",
        questStageId: "stage:searching",
        worldFlagEquals: null
      })
    );

    const contents = getActiveRegionContents(s2);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence).toBeDefined();
    expect(presence?.condition?.questDefinitionId).toBe("quest:find-cheese");
    expect(presence?.condition?.questStageId).toBe("stage:searching");
    expect(presence?.condition?.worldFlagEquals).toBeNull();
  });

  it("SetNPCPresenceCondition with null clears an existing condition", () => {
    const s1 = applyCommand(makeSession(), makeCreateCmd());
    const s2 = applyCommand(
      s1,
      makeSetConditionCmd({
        questDefinitionId: "quest:find-cheese",
        questStageId: null,
        worldFlagEquals: null
      })
    );
    const s3 = applyCommand(s2, makeSetConditionCmd(null));

    const contents = getActiveRegionContents(s3);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.condition).toBeNull();
  });

  it("SetNPCPresenceCondition on missing presenceId is a no-op (no phantom added)", () => {
    const s1 = applyCommand(makeSession(), makeCreateCmd());
    const s2 = applyCommand(s1, {
      kind: "SetNPCPresenceCondition" as const,
      target: {
        aggregateKind: "region-document" as const,
        aggregateId: REGION_ID
      },
      subject: {
        subjectKind: "npc-presence" as const,
        subjectId: "p:does-not-exist"
      },
      payload: {
        presenceId: "p:does-not-exist",
        condition: { questDefinitionId: "quest:x", questStageId: null, worldFlagEquals: null }
      }
    });

    const contents = getActiveRegionContents(s2);
    // Original presence unchanged.
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.condition).toBeNull();
    // No phantom presence was added.
    expect(contents?.npcPresences).toHaveLength(1);
  });

  it("legacy presence with no condition field normalizes to null via factory", () => {
    // createRegionNPCPresence is the normalization bottleneck used by both the
    // factory and the overlay deserialization path. Simulate a pre-079.1 record
    // by passing a Partial without condition.
    const presence = createRegionNPCPresence({
      presenceId: PRESENCE_ID,
      npcDefinitionId: NPC_DEF_ID
      // condition deliberately omitted -- simulates a legacy saved record
    });
    expect(presence.condition).toBeNull();
  });
});

describe("RegionNPCPresence placementLabel field (079.6)", () => {
  it("factory defaults placementLabel to null", () => {
    const presence = createRegionNPCPresence({ npcDefinitionId: NPC_DEF_ID });
    expect(presence.placementLabel).toBeNull();
  });

  it("CreateNPCPresence sets placementLabel null on new presences", () => {
    const session = applyCommand(makeSession(), makeCreateCmd());
    const contents = getActiveRegionContents(session);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.placementLabel).toBeNull();
  });

  it("SetNPCPresenceLabel round-trip: create -> set label -> read back", () => {
    const s1 = applyCommand(makeSession(), makeCreateCmd());
    const s2 = applyCommand(s1, makeSetLabelCmd("Finnick at the docks"));

    const contents = getActiveRegionContents(s2);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.placementLabel).toBe("Finnick at the docks");
  });

  it("SetNPCPresenceLabel with null clears an existing label", () => {
    const s1 = applyCommand(makeSession(), makeCreateCmd());
    const s2 = applyCommand(s1, makeSetLabelCmd("Finnick at the docks"));
    const s3 = applyCommand(s2, makeSetLabelCmd(null));

    const contents = getActiveRegionContents(s3);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.placementLabel).toBeNull();
  });

  it("SetNPCPresenceLabel on missing presenceId is a no-op", () => {
    const s1 = applyCommand(makeSession(), makeCreateCmd());
    const s2 = applyCommand(s1, {
      kind: "SetNPCPresenceLabel" as const,
      target: { aggregateKind: "region-document" as const, aggregateId: REGION_ID },
      subject: { subjectKind: "npc-presence" as const, subjectId: "p:ghost" },
      payload: { presenceId: "p:ghost", label: "Ghost NPC" }
    });

    const contents = getActiveRegionContents(s2);
    expect(contents?.npcPresences).toHaveLength(1);
    const presence = contents?.npcPresences.find(
      (p) => p.presenceId === PRESENCE_ID
    );
    expect(presence?.placementLabel).toBeNull();
  });

  it("legacy presence with no placementLabel field normalizes to null via factory", () => {
    const presence = createRegionNPCPresence({
      presenceId: PRESENCE_ID,
      npcDefinitionId: NPC_DEF_ID
      // placementLabel deliberately omitted -- simulates a pre-079.6 saved record
    });
    expect(presence.placementLabel).toBeNull();
  });
});
