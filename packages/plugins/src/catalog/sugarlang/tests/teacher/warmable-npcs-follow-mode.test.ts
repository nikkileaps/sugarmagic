/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/warmable-npcs-follow-mode.test.ts
 *
 * Purpose: `listWarmableNpcIds` must follow a quest's interaction-mode
 * override, not the mode the project shipped with.
 *
 * Why this needs its own pin: the warm situation key is
 * scene/quest/objectives/time and has NO NPC axis (situation-key.ts),
 * and the NPC list is read AFTER the key check (warm-region-teacher.ts).
 * So an NPC flipped to agent mid-scene is exactly the case the warmer
 * cannot notice by itself -- if this filter reads the authored mode,
 * that NPC talks on the cold path forever and nothing fails loudly.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultPlayerDefinition,
  createDefaultRegion,
  createDefaultScene,
  createRegionNPCPresence,
  createRegionSceneOverlay,
  normalizeNPCDefinition,
  type NPCInteractionMode
} from "@sugarmagic/domain";
import { createRuntimeBootModel } from "@sugarmagic/runtime-core";
import { SugarlangRuntimeServices } from "../../runtime/runtime-services";
import { createSugarlangLogger } from "../../runtime/logger";
import { normalizeSugarLangPluginConfig } from "../../config";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";

const SCRIPTED_NPC = normalizeNPCDefinition({
  definitionId: "npc-horace",
  displayName: "Horace",
  interactionMode: "scripted"
});

const AGENT_NPC = normalizeNPCDefinition({
  definitionId: "npc-finnick",
  displayName: "Finnick",
  interactionMode: "agent"
});

function servicesWithOverrides(
  overrides: Record<string, NPCInteractionMode>
): SugarlangRuntimeServices {
  const config = normalizeSugarLangPluginConfig({ targetLanguage: "es" });
  const logger = createSugarlangLogger({ debugLogging: false });
  const services = new SugarlangRuntimeServices({
    config,
    logger,
    telemetry: new MemoryTelemetrySink()
  });
  const region = createDefaultRegion({
    regionId: "region-town",
    displayName: "Town"
  });
  services.bindRuntime({
    boot: createRuntimeBootModel({
      hostKind: "published-web",
      compileProfile: "runtime-preview",
      contentSource: "authored-game-root"
    }),
    blackboard: { facts: {} } as never,
    playerDefinition: createDefaultPlayerDefinition("project-1"),
    activeRegion: region,
    // Presences are overlay-only today, so both NPCs are placed by the
    // active Scene rather than by the region. `listWarmableNpcIds`
    // composes the two, which is why it needs the Scene at all.
    activeScene: createDefaultScene({
      sceneId: "scene-1",
      regionId: region.identity.id,
      overlay: createRegionSceneOverlay({
          npcPresences: [
            createRegionNPCPresence({
              npcDefinitionId: SCRIPTED_NPC.definitionId
            }),
            createRegionNPCPresence({
              npcDefinitionId: AGENT_NPC.definitionId
            })
          ]
        })
    }),
    npcDefinitions: [SCRIPTED_NPC, AGENT_NPC],
    dialogueDefinitions: [],
    itemDefinitions: [],
    documentDefinitions: [],
    getEffectiveNpcInteractionMode: (npcDefinitionId) =>
      overrides[npcDefinitionId] ?? null
  });
  return services;
}

describe("listWarmableNpcIds follows the effective interaction mode", () => {
  it("warms only the authored agent NPC when nothing is overridden", () => {
    expect(servicesWithOverrides({}).listWarmableNpcIds()).toEqual([
      AGENT_NPC.definitionId
    ]);
  });

  it("warms an NPC a quest flipped TO agent", () => {
    const ids = servicesWithOverrides({
      [SCRIPTED_NPC.definitionId]: "agent"
    }).listWarmableNpcIds();
    expect(ids).toContain(SCRIPTED_NPC.definitionId);
    expect(ids).toContain(AGENT_NPC.definitionId);
  });

  it("stops warming an NPC a quest flipped TO scripted", () => {
    // The other half: a warm spent on an NPC whose slot is never read
    // is a blocking call spent on nothing.
    expect(
      servicesWithOverrides({
        [AGENT_NPC.definitionId]: "scripted"
      }).listWarmableNpcIds()
    ).toEqual([]);
  });
});
