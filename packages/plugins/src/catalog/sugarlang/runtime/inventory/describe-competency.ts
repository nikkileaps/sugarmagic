/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/describe-competency.ts
 *
 * Purpose: Turns a competency REFERENCE into something an NPC can act on.
 *
 * WHY THIS EXISTS
 *   The slate can name a competency (090.4a), and the generator overlay has
 *   always had a seam for describing one -- but nothing was passing a describer,
 *   so a competency reached the NPC's prompt as its bare id:
 *
 *       Introduce vocabulary: greeting-informal
 *
 *   Which tells a generator nothing. Observed in play: the Teacher chose
 *   `greeting-informal`, the NPC said "hola" because it was going to anyway, and
 *   nothing was taught or marked. The seam existed and was never connected --
 *   worse than not having it, because it looked done.
 *
 * WHAT AN NPC ACTUALLY NEEDS
 *   Not the id, and not really the CEFR descriptor either -- those are written
 *   for curriculum authors ("Can greet people in a simple way"). What performs a
 *   competency is its EXPONENTS: the actual phrases. So the description leads
 *   with the descriptor for intent and follows with the exponents for material.
 *
 * Exports:
 *   - createCompetencyDescriber
 *
 * Relationships:
 *   - Reads the competency inventory. Returns a plain function so the overlay
 *     stays free of inventory knowledge.
 *
 * Implements: Plan 090 story 090.4
 *
 * Status: active
 */

import type { CompetencyRef } from "../contracts/teachable-ref";
import { loadCompetencyInventory } from "./competency-inventory-loader";

const MAX_EXPONENTS = 3;

/**
 * Builds a describer for one language, or a fallback that returns the id.
 *
 * The fallback matters: a missing inventory must degrade to "the NPC sees an
 * unhelpful id", never to "the competency silently disappears from the prompt".
 * Those look identical in the output and mean completely different things.
 */
export function createCompetencyDescriber(
  targetLanguage: string
): (ref: CompetencyRef) => string {
  let byId: Map<string, { descriptor: string; exponents: string[] }> | null = null;

  try {
    const inventory = loadCompetencyInventory(targetLanguage);
    byId = new Map(
      inventory.competencies.map((competency) => [
        competency.competencyId,
        {
          descriptor: competency.cefrDescriptor,
          exponents: (competency.exponents[targetLanguage] ?? [])
            .flatMap((chunk) => chunk.surfaceForms.slice(0, 1))
            .slice(0, MAX_EXPONENTS)
        }
      ])
    );
  } catch {
    // No inventory for this language. Fall through to the id.
  }

  return (ref) => {
    const entry = byId?.get(ref.competencyId);
    if (!entry) return ref.competencyId;
    const exponents =
      entry.exponents.length > 0 ? ` -- e.g. ${entry.exponents.join(", ")}` : "";
    return `${entry.descriptor}${exponents}`;
  };
}
