/**
 * packages/runtime-core/src/npc/interaction-mode-store.ts
 *
 * Purpose: quest-set overrides of an NPC's interaction mode, and
 * the `npc.interaction-mode` save slice that carries them.
 *
 * An NPC's authored definition says what it normally is. A quest
 * action can override that while the story needs something else
 * -- a shopkeeper who is scripted until you have been introduced,
 * then free to talk -- and clearing the override hands the NPC
 * back to its definition.
 *
 * Overrides are keyed by npcDefinitionId, NOT by presence, so a
 * flip reaches every placement of that NPC. That matches the
 * `playAnimation` quest action, whose comment says "Every
 * presence of that NPC in the scene plays."
 *
 * This store holds ONLY the override. Precedence lives in
 * `resolveEffectiveInteractionMode` (domain), which every site
 * that branches on scripted-vs-agent goes through.
 *
 * Status: active
 */

import type { NPCInteractionMode, SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";

export const NPC_INTERACTION_MODE_PARTICIPANT_ID = "npc.interaction-mode";
export const NPC_INTERACTION_MODE_SLICE_SCHEMA_VERSION = 1;

export interface NpcInteractionModeSlice {
  /** npcDefinitionId -> the mode a quest forced. */
  overrides: Record<string, NPCInteractionMode>;
}

/**
 * Host-lifetime store. Created by the runtime host so it survives
 * the assembly, and read inside the assembly by the sites that
 * decide how a conversation opens.
 */
export class NpcInteractionModeStore {
  private readonly overrides = new Map<string, NPCInteractionMode>();
  private listener: (() => void) | null = null;

  /** The override for this NPC, or null when none is set. */
  get(npcDefinitionId: string): NPCInteractionMode | null {
    return this.overrides.get(npcDefinitionId) ?? null;
  }

  /**
   * Force a mode, or pass null to clear and fall back to the
   * definition. Returns true when something actually changed --
   * the caller uses that to avoid re-warming the Teacher for a
   * no-op flip.
   */
  set(
    npcDefinitionId: string,
    mode: NPCInteractionMode | null
  ): boolean {
    const current = this.overrides.get(npcDefinitionId) ?? null;
    if (current === mode) return false;
    if (mode === null) {
      this.overrides.delete(npcDefinitionId);
    } else {
      this.overrides.set(npcDefinitionId, mode);
    }
    this.listener?.();
    return true;
  }

  /**
   * Called after any change that took effect. The Teacher warmer
   * subscribes: a mode flip usually does NOT move the situation
   * key (which is scene/quest/objectives/time and has no NPC
   * axis), so without this a newly agentified NPC would talk on
   * whatever directive the region was warmed with.
   */
  setChangeHandler(listener: (() => void) | null): void {
    this.listener = listener;
  }

  serializeSaveSlice(): NpcInteractionModeSlice {
    return { overrides: Object.fromEntries(this.overrides) };
  }

  deserializeSaveSlice(
    slice: SaveSlice<NpcInteractionModeSlice> | null
  ): void {
    this.overrides.clear();
    if (!slice) return;
    for (const [npcDefinitionId, mode] of Object.entries(
      slice.data.overrides ?? {}
    )) {
      // A mode that is no longer in the union (an authored value
      // removed since the save was written) is dropped rather
      // than restored -- the NPC falls back to its definition,
      // which is the safe direction.
      if (mode === "scripted" || mode === "agent") {
        this.overrides.set(npcDefinitionId, mode);
      }
    }
  }
}

/**
 * Tier is `host-owned`: the mode decides how a conversation opens
 * and which NPCs the Teacher warms, both of which are read from
 * the moment the world spawns. It must be in place before then,
 * which is the same boot-ordering class as `host.player`'s
 * `currentRegionId`.
 */
export function createNpcInteractionModeSaveParticipant(deps: {
  store: NpcInteractionModeStore;
}): SaveParticipant<NpcInteractionModeSlice> {
  return {
    participantId: NPC_INTERACTION_MODE_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: NPC_INTERACTION_MODE_SLICE_SCHEMA_VERSION,
    serialize(): NpcInteractionModeSlice {
      return deps.store.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<NpcInteractionModeSlice> | null): void {
      deps.store.deserializeSaveSlice(slice);
    }
  };
}
