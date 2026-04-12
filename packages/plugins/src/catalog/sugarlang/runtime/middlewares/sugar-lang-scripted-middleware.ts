/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-scripted-middleware.ts
 *
 * Purpose: Adapts scripted (authored English) NPC dialogue to the learner's
 *          language level via an LLM call. Runs in the analysis stage at
 *          priority 15 (after verify at 20, before observe at 90).
 *
 * For scripted dialogue:
 *   1. Reads the authored English turn text
 *   2. Reads the sugarlang constraint (posture/ratio/overlay)
 *   3. Calls the LLM via the gateway to adapt the line
 *   4. Replaces turn.text with the adapted version
 *
 * Skips: agent mode turns, player VO turns, turns without a constraint.
 *
 * Exports:
 *   - createSugarLangScriptedMiddleware
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import {
  PLAYER_VO_SPEAKER,
  NARRATOR_SPEAKER,
  EXCERPT_SPEAKER
} from "@sugarmagic/domain";
import type { LemmaRef, SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import { tokenize } from "../classifier/tokenize";
import type { SugarlangLoggerLike } from "./shared";
import {
  isScriptedMode,
  normalizeTurn,
  shouldRunSugarlangForExecution,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  createNoOpSugarlangLogger
} from "./shared";

export interface SugarLangScriptedMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
}

/** Speakers that should NOT be adapted — narration and voice-over stay as-is. */
function isNonAdaptableSpeaker(speakerId: string | undefined): boolean {
  return (
    speakerId === PLAYER_VO_SPEAKER.speakerId ||
    speakerId === NARRATOR_SPEAKER.speakerId ||
    speakerId === EXCERPT_SPEAKER.speakerId
  );
}

export function createSugarLangScriptedMiddleware(
  deps: SugarLangScriptedMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();

  return {
    middlewareId: "sugarlang.scripted",
    displayName: "Sugarlang Scripted Adaptation",
    priority: 15,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      if (!normalizedTurn) return turn;
      if (!shouldRunSugarlangForExecution(execution)) return normalizedTurn;
      if (!isScriptedMode(execution)) return normalizedTurn;
      if (isNonAdaptableSpeaker(normalizedTurn.speakerId)) return normalizedTurn;

      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      if (!constraint?.generatorPromptOverlay) return normalizedTurn;

      const services = deps.services.resolveForExecution(execution);
      if (!services?.llmClient) {
        logger.warn("Scripted adaptation skipped — no LLM client available.");
        return normalizedTurn;
      }

      const authoredText = normalizedTurn.text;
      const npcDisplayName =
        normalizedTurn.speakerLabel ??
        execution.selection.npcDisplayName ??
        "NPC";

      // Scan the authored English text to find teaching candidates.
      // Each English word that resolves to a target-language lemma via the
      // gloss index becomes an introduce candidate.
      const targetLanguage = constraint.targetLanguage;
      const supportLanguage = execution.selection.supportLanguage ?? "en";
      const lineIntroduce: LemmaRef[] = [];
      const seen = new Set<string>();
      for (const token of tokenize(authoredText, "en")) {
        if (token.kind !== "word") continue;
        const word = token.surface.toLowerCase();
        if (word.length < 3 || seen.has(word)) continue;
        seen.add(word);
        const resolved = services.atlas.resolveFromGloss(
          word,
          targetLanguage,
          supportLanguage
        );
        for (const entry of resolved) {
          if (!seen.has(entry.lemmaId)) {
            seen.add(entry.lemmaId);
            lineIntroduce.push({ lemmaId: entry.lemmaId, lang: targetLanguage });
          }
        }
      }

      // Update the constraint with line-specific vocabulary so the observe
      // middleware can highlight these words in the adapted text.
      if (lineIntroduce.length > 0) {
        constraint.targetVocab = {
          introduce: lineIntroduce,
          reinforce: constraint.targetVocab.reinforce,
          avoid: constraint.targetVocab.avoid
        };
        execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
      }

      const systemPrompt = [
        `Speak as ${npcDisplayName}.`,
        "Return only the NPC's spoken words.",
        "You are adapting a pre-authored English dialogue line for a language learner.",
        "You MUST preserve the exact narrative meaning, quest-critical information, and emotional tone.",
        "Do NOT add, remove, or change any story content.",
        "Do NOT add parenthetical translations — the UI handles glossing.",
        "",
        constraint.generatorPromptOverlay
      ].join("\n");

      const questContext =
        execution.runtimeContext?.trackedQuest?.displayName ?? null;
      const vocabHint = lineIntroduce.length > 0
        ? `Target vocabulary to use in ${targetLanguage} (translate these English concepts): ${lineIntroduce.map((l) => l.lemmaId).join(", ")}.`
        : null;
      const userPrompt = [
        "Adapt the following authored dialogue line for the learner's current level.",
        `Speaker: ${npcDisplayName}`,
        `Authored line: ${authoredText}`,
        questContext ? `Quest context: ${questContext}` : null,
        vocabHint,
        "Preserve the EXACT meaning. Adjust the language mix to match the learner's level. Return only the adapted spoken line — no quotes, no stage directions."
      ].filter(Boolean).join("\n\n");

      try {
        const model = deps.services.getConfig().scriptedAdaptationModel;
        const result = await services.llmClient.generate({
          model,
          systemPrompt,
          userPrompt,
          maxTokens: 300
        });

        let adapted = result.text.trim();
        // Strip leading/trailing quotes the LLM may echo from the prompt format.
        if (adapted.startsWith('"') && adapted.endsWith('"')) {
          adapted = adapted.slice(1, -1).trim();
        }
        if (adapted) {
          normalizedTurn.text = adapted;
          logger.debug("Scripted line adapted.", {
            authoredText,
            adaptedText: adapted,
            learnerCefr: constraint.learnerCefr
          });
        }
      } catch (error) {
        logger.warn("Scripted adaptation LLM call failed; using authored text.", {
          error: error instanceof Error ? error.message : String(error)
        });
        // Fall back to original authored text — the quest still works
      }

      return normalizedTurn;
    }
  };
}
