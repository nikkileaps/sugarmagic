/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/rationale.ts
 *
 * Purpose: Implements the lexical rationale builder used for debugging and telemetry.
 *
 * Exports:
 *   - BudgeterFunnelResult
 *   - buildLexicalRationale
 *
 * Relationships:
 *   - Depends on lexical-prescription contract types and Budgeter scoring results.
 *   - Is consumed by the Budgeter and later debug tooling.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / §Verification and Acceptance
 *
 * Status: active
 */

import type {
  LemmaRef,
  LexicalPrescriptionInput,
  LexicalPriorityScore,
  LexicalRationale
} from "../types";
import type { LemmaScore } from "./scoring";

export interface BudgeterFunnelResult {
  candidateSetSize: number;
  envelopeSurvivorCount: number;
  levelCap: number;
  chosenIntroduce: LemmaRef[];
  chosenReinforce: LemmaRef[];
  droppedByEnvelope: LemmaRef[];
  priorityScores: LemmaScore[];
  questEssentialExclusionLemmaIds: string[];
}

function toPriorityScore(
  score: LemmaScore,
  lang: string
): LexicalPriorityScore {
  return {
    lemmaRef: {
      lemmaId: score.lemmaId,
      lang
    },
    score: score.score,
    components: score.components,
    reasons: score.reasons
  };
}

export function buildLexicalRationale(
  input: LexicalPrescriptionInput,
  funnelResult: BudgeterFunnelResult
): LexicalRationale {
  const priorityScores = funnelResult.priorityScores.map((score) =>
    toPriorityScore(score, input.learner.targetLanguage)
  );
  const summary = `Scene gate yielded ${funnelResult.candidateSetSize} candidate lemmas and ${funnelResult.envelopeSurvivorCount} survived the envelope. ` +
    `The budgeter chose ${funnelResult.chosenIntroduce.length} introduce item(s) and ${funnelResult.chosenReinforce.length} reinforce item(s) with a level cap of ${funnelResult.levelCap}.`;

  return {
    summary,
    candidateSetSize: funnelResult.candidateSetSize,
    envelopeSurvivorCount: funnelResult.envelopeSurvivorCount,
    priorityScores,
    reasons: [
      `level-cap:${funnelResult.levelCap}`,
      `introduce:${funnelResult.chosenIntroduce.length}`,
      `reinforce:${funnelResult.chosenReinforce.length}`,
      `avoid:${funnelResult.droppedByEnvelope.length}`
    ],
    levelCap: funnelResult.levelCap,
    chosenIntroduce: funnelResult.chosenIntroduce,
    chosenReinforce: funnelResult.chosenReinforce,
    droppedByEnvelope: funnelResult.droppedByEnvelope,
    questEssentialExclusionLemmaIds:
      funnelResult.questEssentialExclusionLemmaIds.length > 0
        ? funnelResult.questEssentialExclusionLemmaIds
        : undefined
  };
}
