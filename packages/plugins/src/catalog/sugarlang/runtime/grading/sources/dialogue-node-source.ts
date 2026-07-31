/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/sources/dialogue-node-source.ts
 *
 * Purpose: Graded-text source strategy for scripted dialogue nodes.
 *
 * Exports:
 *   - DIALOGUE_NODE_SOURCE_KIND
 *   - buildDialogueNodeContentHash
 *   - createDialogueNodeSource
 *
 * Relationships:
 *   - Implements GradedTextSourceStrategy from ../graded-text-source.
 *   - Reads DialogueDefinition from @sugarmagic/domain. One-way: domain never
 *     imports this.
 *
 * Implements: Epic 086 Story 086.3 (extracted into a strategy 2026-07-28)
 *
 * Status: active
 */

import type { DialogueDefinition } from "@sugarmagic/domain";
import type {
  GradedTextCorpus,
  GradedTextSourceStrategy,
  GradedTextUnit
} from "../graded-text-source";

export const DIALOGUE_NODE_SOURCE_KIND = "dialogue-node" as const;

/**
 * The dialogue content-hash seed, UNCHANGED and load-bearing.
 *
 * `[nodeId, text, "{}"].join("|")` is the exact seed the runtime lookup and the
 * Studio popover already build independently. If this drifts from either of
 * them, every runtime lookup misses and scripted lines silently fall back to
 * the diglot weave -- which looks like "grading stopped working" rather than
 * like a hash mismatch. Change it in all three places or none.
 *
 * The `"{}"` is a deliberately empty intent slot: intent is excluded from the
 * key because the runtime has no access to authored intent when it rebuilds
 * the hash. It stays in the seed so the string shape does not shift.
 */
/**
 * THE VARIANT CACHE KEY'S CONTENT LEG. Bake side and runtime side MUST build
 * this identically -- the bake writes under it and the runtime reads under it,
 * so any divergence is a total, permanent, SILENT cache miss: every scripted
 * line falls through to the weave fallback and nothing reports it.
 *
 * It was duplicated (an identical private copy lived in the scripted
 * middleware) until 2026-07-31. One function now, imported by both.
 *
 * THE SLATE IS DELIBERATELY NOT IN HERE (090.11, decided 2026-07-31).
 *   It looks like it belongs -- the empty `{}` slot below is even the right
 *   shape for it, and a variant baked against a slate does depend on that slate.
 *   It cannot go in, because the RUNTIME CANNOT COMPUTE IT. Scripted mode skips
 *   the Teacher entirely and carries an empty slate
 *   (`sugar-lang-teacher-middleware.ts`, `isScriptedMode` early return), so a
 *   slate-bearing key would be written by the bake and never once looked up.
 *
 *   Slate staleness is handled by REBUILDING instead: a rebuild overwrites the
 *   variant at the same key. The key answers "which line, which band, which
 *   language, which prompt version" -- not "was this baked against current
 *   pedagogy". If that needs to become visible, it belongs as provenance ON the
 *   variant record, where Studio can read it, not in the lookup key.
 *
 * The `{}` is the intent slot and stays empty on purpose: intent goes into the
 * LLM prompt, not the key, so cache hits survive hand-authored intent edits.
 * Do NOT use this for the intent cache key; use buildIntentContentHash there.
 */
export function buildDialogueNodeContentHash(nodeId: string, text: string): string {
  return [nodeId, text, JSON.stringify({})].join("|");
}

export function createDialogueNodeSource(): GradedTextSourceStrategy {
  return {
    kind: DIALOGUE_NODE_SOURCE_KIND,
    displayName: "Dialogue lines",
    collect(corpus: GradedTextCorpus): GradedTextUnit[] {
      const units: GradedTextUnit[] = [];
      for (const dialogue of corpus.dialogues ?? []) {
        for (const node of dialogue.nodes) {
          const text = node.text.trim();
          if (!text) continue;

          units.push({
            source: {
              kind: DIALOGUE_NODE_SOURCE_KIND,
              dialogueDefinitionId: dialogue.definitionId,
              nodeId: node.nodeId
            },
            sourceText: text,
            contentHash: buildDialogueNodeContentHash(node.nodeId, node.text),
            guidance: {
              register: "dialogue line",
              notes: buildIntentNotes(dialogue, node.nodeId)
            },
            // Must-convey facts come from the intent EXTRACTOR at bake time,
            // not from authored data, so the strategy cannot supply them here.
            // The caller merges them in when it has an intent artifact.
            mustConveyFacts: []
          });
        }
      }
      return units;
    }
  };
}

function buildIntentNotes(
  dialogue: DialogueDefinition,
  nodeId: string
): string[] {
  const node = dialogue.nodes.find((candidate) => candidate.nodeId === nodeId);
  const intent = node?.intent;
  if (!intent) return [];
  return [
    intent.beat ? `Dramatic beat: ${intent.beat}` : null,
    intent.voiceNote ? `Voice note: ${intent.voiceNote}` : null
  ].filter((note): note is string => note !== null);
}
