/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/function-chunk-realizer.ts
 *
 * Purpose: Realizes scheduled FUNCTION teachables as `chunk:{id}` LemmaRefs for
 *   injection into the budgeter's prescription introduce list.
 *
 * Contract (pinned 087.3):
 *   - A scheduled function (kind="function") is realized as ALL of its chunks for
 *     the target language via the `chunk:{chunkId}` pseudo-lemma convention.
 *   - Chunks already in the learner's card store (already encountered) are excluded;
 *     they are not re-introduced.
 *   - The `computePendingProvisionalLemmas` filter (middlewares/shared.ts:166)
 *     already excludes chunk cards from the provisional-evidence path, so chunk: refs
 *     in `prescription.introduce` are coherent with that filter.
 *   - The total injected count is bounded by the caller (context middleware applies
 *     the levelCap ceiling from `prescription.budget.newItemsAllowed`).
 *
 * Decision pinned here (087.3): hand-authored prerequisite edges are NOT added to
 *   the function inventory schema (FunctionEntry has no `prerequisites` field and
 *   there is no authored prerequisite data). Band ordering (A1 > A2 > B1 ...) is
 *   sufficient as the ordering floor. Revisit when authored prerequisite data exists.
 *
 * Exports:
 *   - realizeFunctionChunksFromSchedule
 *
 * Relationships:
 *   - Reads FunctionEntry from the function inventory (function-inventory-loader.ts).
 *   - Consumes TeachSchedule (teach-schedule.ts) to find function teachables.
 *   - Called by sugar-lang-context-middleware.ts after budgeter.prescribe().
 *
 * Implements: Plan 087 story 087.3
 *
 * Status: active
 */

import type { LemmaRef } from "../contracts/lexical-prescription";
import type { TeachSchedule } from "./teach-schedule";
import type { FunctionEntry } from "../contracts/function-inventory";
import type { LemmaCard } from "../types";

/**
 * Convert scheduled function teachables to `chunk:{id}` LemmaRefs ready for
 * injection into the prescription's introduce list.
 *
 * Only function-kind teachables are realized. Chunks already in the learner's
 * card store are excluded (already encountered, no re-introduction needed).
 * The result is ordered: functions appear in schedule priority order, chunks
 * within a function in inventory declaration order.
 *
 * maxFunctions caps how many top-ranked functions are realized per turn
 * (default: 2 -- prevents one turn from spending the entire introduce budget
 * on a single multi-chunk function).
 */
export function realizeFunctionChunksFromSchedule(
  schedule: TeachSchedule,
  targetLanguage: string,
  lemmaCards: Record<string, LemmaCard>,
  availableFunctions: FunctionEntry[],
  maxFunctions: number = 2
): LemmaRef[] {
  const functionMap = new Map<string, FunctionEntry>(
    availableFunctions.map((fn) => [fn.functionId, fn])
  );

  const functionTeachables = schedule.teachables
    .filter((t) => t.kind === "function")
    .slice(0, maxFunctions);

  const result: LemmaRef[] = [];
  for (const teachable of functionTeachables) {
    const fnEntry = functionMap.get(teachable.id);
    if (!fnEntry) continue;
    const chunks = fnEntry.chunks[targetLanguage] ?? [];
    for (const chunk of chunks) {
      const chunkLemmaId = `chunk:${chunk.chunkId}`;
      if (chunkLemmaId in lemmaCards) continue; // already known
      result.push({ lemmaId: chunkLemmaId, lang: targetLanguage });
    }
  }
  return result;
}
