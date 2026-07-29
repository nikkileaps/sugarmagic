/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/function-tag-resolver.ts
 *
 * Purpose: Derives scene and per-NPC communicative function tags at READ TIME from
 *   the function inventory and scene lexicon chunks. Tags are NEVER stored in the
 *   compiled artifact so they automatically reflect inventory edits without recompile.
 *
 * Exports:
 *   - FunctionTagResult
 *   - resolveFunctionTags
 *
 * Relationships:
 *   - Depends on function-inventory-loader for inventory data.
 *   - Depends on createChunkMatcher for the chunk-to-function join over NPC text.
 *   - Consumes CompiledSceneLexicon.chunks (optional -- returns empty tags if absent).
 *   - Consumes DialogueDefinition for NPC attribution (optional arg).
 *   - Is consumed by epic E's outer loop to read whole-board function presence.
 *
 * Design:
 *   Scene tags: set-intersection of inventory chunk normalizedForms vs sceneLexicon.chunks.
 *   NPC tags: chunk matcher run over NPC-spoken dialogue nodes; attribution via
 *   dialogue.interactionBinding.npcDefinitionId; player-spoken nodes (PLAYER_SPEAKER /
 *   PLAYER_VO_SPEAKER speakerIds) count toward scene tags but NOT the NPC's "can realize" list.
 *   undefined speakerId defaults to the bound NPC (same discriminator as isPlayerSpokenTurn).
 *
 * Implements: Plan 085 story 085.4
 *
 * Status: active
 */

import type { DialogueDefinition } from "@sugarmagic/domain";
import { isPlayerSpeaker, resolveDialogueSpeaker } from "@sugarmagic/domain";
import type { FunctionInventory } from "../contracts/function-inventory";
import type { LexicalChunk } from "../types";
import { createChunkMatcher } from "../classifier/chunk-matcher";
import { tokenize } from "../classifier/tokenize";

function isPlayerSpeakerId(speakerId: string | undefined): boolean {
  if (speakerId === undefined) return false;
  return isPlayerSpeaker(resolveDialogueSpeaker(speakerId, null));
}

export interface FunctionTagResult {
  /** FunctionIds whose realizing chunks appear in this scene's lexicon. */
  sceneFunctions: string[];
  /**
   * Per-NPC map of functionIds the NPC can realize via its authored dialogue.
   * Keyed by npcDefinitionId. Only includes NPCs with at least one tagged function.
   */
  npcFunctions: Record<string, string[]>;
}

/**
 * Derives function tags from the inventory + scene lexicon at read time.
 *
 * @param sceneChunks   The chunk layer from CompiledSceneLexicon (may be undefined
 *                      if chunk extraction has not run; returns empty tags in that case).
 * @param inventory     The loaded FunctionInventory for the scene's target language.
 * @param lang          BCP-47 language key matching the inventory's chunk keys.
 * @param dialogues     Optional dialogue definitions for per-NPC attribution.
 */
export function resolveFunctionTags(
  sceneChunks: LexicalChunk[] | undefined,
  inventory: FunctionInventory,
  lang: string,
  dialogues?: DialogueDefinition[]
): FunctionTagResult {
  if (!sceneChunks || sceneChunks.length === 0) {
    return { sceneFunctions: [], npcFunctions: {} };
  }

  // Build a normalizedForm -> functionId lookup from the inventory (for this lang).
  const chunkNormToFunctionId = new Map<string, string>();
  for (const fn of inventory.functions) {
    for (const chunk of fn.chunks[lang] ?? []) {
      // First-write wins (a chunk may theoretically appear in multiple functions,
      // but the inventory uniqueness constraint prevents this in practice).
      if (!chunkNormToFunctionId.has(chunk.normalizedForm)) {
        chunkNormToFunctionId.set(chunk.normalizedForm, fn.functionId);
      }
    }
  }

  // --- Scene tags: set-intersection of inventory normalizedForms vs sceneChunks ---
  const sceneChunkNormForms = new Set(sceneChunks.map((c) => c.normalizedForm));
  const sceneFunctionSet = new Set<string>();
  for (const [normForm, functionId] of chunkNormToFunctionId) {
    if (sceneChunkNormForms.has(normForm)) {
      sceneFunctionSet.add(functionId);
    }
  }
  const sceneFunctions = [...sceneFunctionSet].sort();

  // --- NPC tags: chunk matcher over per-NPC dialogue nodes ---
  const npcFunctionMap = new Map<string, Set<string>>();

  if (dialogues && dialogues.length > 0) {
    const chunkMatcher = createChunkMatcher(sceneChunks, lang);

    for (const dialogue of dialogues) {
      const npcId = dialogue.interactionBinding.npcDefinitionId;
      if (!npcId) continue; // unbound (scene-level) dialogue

      for (const node of dialogue.nodes) {
        if (isPlayerSpeakerId(node.speakerId)) {
          // Player-spoken node: counts toward scene functions but NOT this NPC's tags.
          continue;
        }
        if (!node.text) continue;

        const tokens = tokenize(node.text, lang);
        const matches = chunkMatcher.match(tokens, node.text);

        for (const match of matches) {
          const functionId = chunkNormToFunctionId.get(match.chunk.normalizedForm);
          if (!functionId) continue;
          const set = npcFunctionMap.get(npcId) ?? new Set();
          set.add(functionId);
          npcFunctionMap.set(npcId, set);
        }
      }
    }
  }

  const npcFunctions: Record<string, string[]> = {};
  for (const [npcId, functionSet] of npcFunctionMap) {
    npcFunctions[npcId] = [...functionSet].sort();
  }

  return { sceneFunctions, npcFunctions };
}
