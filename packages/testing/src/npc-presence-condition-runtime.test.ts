/**
 * packages/testing/src/npc-presence-condition-runtime.test.ts
 *
 * Purpose: Guards Plan 079.2 -- the per-frame NPC presence reconciler.
 *
 * Exercises the same spawn/despawn/reconcile primitives that
 * gameplay-session.ts wires together at session construction time, but
 * without the DOM-bound UI panels. Uses the exact same runtime imports
 * (World, Position, Interactable, QuestManager, evaluateRegionQuestBinding)
 * so any future refactor of those contracts will break this test.
 *
 * Exit criteria (verbatim from plan 079.2):
 *   - presence gated on flag X is absent at load
 *   - appears after setFlag(X) mid-region without a reload
 *   - disappears again if the flag clears
 *   - null-condition presence is present throughout
 *   - despawn removes the interactable entity (assert ECS entity count /
 *     entity absence, not just a boolean) so no ghost E-prompt remains
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { RegionNPCPresence } from "@sugarmagic/domain";
import {
  evaluateRegionQuestBinding,
  Interactable,
  Position,
  QuestManager,
  World
} from "@sugarmagic/runtime-core";
import type { Entity } from "@sugarmagic/runtime-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FLAG_KEY = "finn_arrived";

const GATED_PRESENCE: RegionNPCPresence = {
  presenceId: "presence:finn",
  npcDefinitionId: "npc:finn",
  shaderOverride: null,
  shaderParameterOverrides: [],
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  condition: {
    questDefinitionId: null,
    questStageId: null,
    worldFlagEquals: {
      key: FLAG_KEY,
      valueType: "boolean",
      value: "true"
    }
  },
  placementLabel: null
};

const ALWAYS_PRESENCE: RegionNPCPresence = {
  presenceId: "presence:cheese-seller",
  npcDefinitionId: "npc:cheese-seller",
  shaderOverride: null,
  shaderParameterOverrides: [],
  transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  condition: null,
  placementLabel: null
};

const PRESENCES = [GATED_PRESENCE, ALWAYS_PRESENCE];

// ---------------------------------------------------------------------------
// Mini harness -- mirrors registerNpcInteractables / reconcileNpcPresences
// exactly as written in gameplay-session.ts, using the same runtime imports.
// If those functions change their dependencies, this will break and require
// an update -- which is the point.
// ---------------------------------------------------------------------------

type EntityEntry = { entity: Entity; npcDefinitionId: string };

function buildQuestCtx(questManager: QuestManager) {
  const trackedQuest = questManager.getTrackedQuest();
  return {
    activeQuest: trackedQuest
      ? {
          questDefinitionId: trackedQuest.questDefinitionId,
          stageId: trackedQuest.stageId
        }
      : null,
    hasWorldFlag: (key: string, value: boolean) =>
      questManager.hasFlag(key, value)
  };
}

function spawnNpc(
  presence: RegionNPCPresence,
  world: World,
  entityMap: Map<string, EntityEntry>
): void {
  const entity = world.createEntity();
  world.addComponent(entity, new Position(...presence.transform.position));
  world.addComponent(
    entity,
    new Interactable("npc", presence.presenceId, presence.npcDefinitionId, "Talk", 2.0, true)
  );
  entityMap.set(presence.presenceId, { entity, npcDefinitionId: presence.npcDefinitionId });
}

function despawnNpc(
  presenceId: string,
  world: World,
  entityMap: Map<string, EntityEntry>
): void {
  const entry = entityMap.get(presenceId);
  if (!entry) return;
  world.destroyEntity(entry.entity);
  entityMap.delete(presenceId);
}

function register(
  presences: RegionNPCPresence[],
  questManager: QuestManager,
  world: World,
  entityMap: Map<string, EntityEntry>
): void {
  const ctx = buildQuestCtx(questManager);
  for (const p of presences) {
    if (p.condition === null || evaluateRegionQuestBinding(p.condition, ctx)) {
      spawnNpc(p, world, entityMap);
    }
  }
}

function reconcile(
  presences: RegionNPCPresence[],
  questManager: QuestManager,
  world: World,
  entityMap: Map<string, EntityEntry>
): void {
  const ctx = buildQuestCtx(questManager);
  for (const p of presences) {
    const active =
      p.condition === null || evaluateRegionQuestBinding(p.condition, ctx);
    const spawned = entityMap.has(p.presenceId);
    if (active && !spawned) {
      spawnNpc(p, world, entityMap);
    } else if (!active && spawned) {
      despawnNpc(p.presenceId, world, entityMap);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("079.2 -- NPC presence reconciler", () => {
  it("flag-gated presence absent at load when flag not set", () => {
    const world = new World();
    const questManager = new QuestManager();
    const entityMap = new Map<string, EntityEntry>();

    register(PRESENCES, questManager, world, entityMap);

    expect(entityMap.has(GATED_PRESENCE.presenceId)).toBe(false);
    // null-condition presence is always active
    expect(entityMap.has(ALWAYS_PRESENCE.presenceId)).toBe(true);
    // exactly one entity in the ECS world
    expect(world.query(Interactable)).toHaveLength(1);
  });

  it("flag-gated presence spawns after setFlag mid-region (no reload)", () => {
    const world = new World();
    const questManager = new QuestManager();
    const entityMap = new Map<string, EntityEntry>();

    register(PRESENCES, questManager, world, entityMap);

    questManager.setFlag(FLAG_KEY, true);
    reconcile(PRESENCES, questManager, world, entityMap);

    expect(entityMap.has(GATED_PRESENCE.presenceId)).toBe(true);
    expect(entityMap.has(ALWAYS_PRESENCE.presenceId)).toBe(true);
    expect(world.query(Interactable)).toHaveLength(2);
  });

  it("flag-gated presence despawns when flag clears", () => {
    const world = new World();
    const questManager = new QuestManager();
    const entityMap = new Map<string, EntityEntry>();

    register(PRESENCES, questManager, world, entityMap);

    questManager.setFlag(FLAG_KEY, true);
    reconcile(PRESENCES, questManager, world, entityMap);
    // Both active
    expect(world.query(Interactable)).toHaveLength(2);

    questManager.setFlag(FLAG_KEY, false);
    reconcile(PRESENCES, questManager, world, entityMap);

    expect(entityMap.has(GATED_PRESENCE.presenceId)).toBe(false);
    expect(entityMap.has(ALWAYS_PRESENCE.presenceId)).toBe(true);
    expect(world.query(Interactable)).toHaveLength(1);
  });

  it("despawn removes ECS entity -- Interactable component is gone, not dangling", () => {
    const world = new World();
    const questManager = new QuestManager();
    const entityMap = new Map<string, EntityEntry>();

    register(PRESENCES, questManager, world, entityMap);
    questManager.setFlag(FLAG_KEY, true);
    reconcile(PRESENCES, questManager, world, entityMap);

    const spawnedEntity = entityMap.get(GATED_PRESENCE.presenceId)!.entity;
    expect(world.hasComponent(spawnedEntity, Interactable)).toBe(true);

    questManager.setFlag(FLAG_KEY, false);
    reconcile(PRESENCES, questManager, world, entityMap);

    // Entity destroyed -- component storage cleared, no ghost E-prompt
    expect(world.hasComponent(spawnedEntity, Interactable)).toBe(false);
  });

  it("null-condition presence survives flag toggling unchanged", () => {
    const world = new World();
    const questManager = new QuestManager();
    const entityMap = new Map<string, EntityEntry>();

    register(PRESENCES, questManager, world, entityMap);
    const alwaysEntity = entityMap.get(ALWAYS_PRESENCE.presenceId)!.entity;

    questManager.setFlag(FLAG_KEY, true);
    reconcile(PRESENCES, questManager, world, entityMap);
    questManager.setFlag(FLAG_KEY, false);
    reconcile(PRESENCES, questManager, world, entityMap);

    // Same entity, never despawned
    expect(entityMap.get(ALWAYS_PRESENCE.presenceId)?.entity).toBe(alwaysEntity);
    expect(world.hasComponent(alwaysEntity, Interactable)).toBe(true);
  });

  it("reconcile is idempotent -- no duplicate entities on repeated calls", () => {
    const world = new World();
    const questManager = new QuestManager();
    const entityMap = new Map<string, EntityEntry>();

    register(PRESENCES, questManager, world, entityMap);
    questManager.setFlag(FLAG_KEY, true);

    reconcile(PRESENCES, questManager, world, entityMap);
    reconcile(PRESENCES, questManager, world, entityMap);
    reconcile(PRESENCES, questManager, world, entityMap);

    expect(entityMap.size).toBe(2);
    expect(world.query(Interactable)).toHaveLength(2);
  });
});
