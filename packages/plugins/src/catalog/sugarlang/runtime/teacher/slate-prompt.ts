/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/slate-prompt.ts
 *
 * Purpose: How a SLATE becomes prompt text. One renderer, for every path that
 *   has to tell a model what a line should teach.
 *
 * WHY THIS IS ITS OWN MODULE
 *   There are two moments where a slate turns into an instruction -- the agent
 *   generator at runtime, and the variant bake at build time -- and they are in
 *   different modules with different callers. That is exactly the shape that
 *   produced the `describeLanguageMix` bug: the same pedagogical fact phrased
 *   twice, drifting until an A1 line was generated at 100% target language
 *   while the envelope said 30%.
 *
 *   Rendering a slate is harder than it looks (see `renderTeachableList`), so a
 *   second implementation would not merely drift -- it would re-earn a bug that
 *   has already been paid for once.
 *
 * Exports:
 *   - MAX_PROMPT_REINFORCE
 *   - renderTeachableList
 *
 * Relationships:
 *   - Pure. Takes refs and a describer, returns a string. No I/O, no inventory
 *     lookup -- callers resolve competency descriptions and pass the function in
 *     (`inventory/describe-competency.ts`), which keeps prompt construction
 *     snapshot-testable.
 *   - The per-band introduce cap is NOT here; it is `getIntroduceCapForBand` in
 *     `band-envelope.ts` with the rest of the band-keyed tables. Callers apply
 *     it when slicing, because how many a learner can take is a property of the
 *     learner, not of the rendering.
 *
 * Status: active
 */

import type { CompetencyRef, TeachableRef } from "../contracts/teachable-ref";

/**
 * How many REINFORCE items one prompt may carry.
 *
 * Not band-keyed, unlike the introduce cap: reinforcement is re-exposure to
 * something already met, so it does not consume new-item capacity the way an
 * introduction does. If that ever stops being true this belongs in
 * `band-envelope.ts` beside `getIntroduceCapForBand`, not here.
 */
export const MAX_PROMPT_REINFORCE = 4;

/**
 * One teachable per line.
 *
 * WAS a `", "` join, and that was wrong the moment the slate could hold a
 * competency: a described competency reads `<descriptor> -- e.g. a, b, c`,
 * which already ENDS in a comma-separated list. Joining the next item onto it
 * produced, verbatim, in a live conversation:
 *
 *   Can greet people in a simple way. -- e.g. hola, buenos dias, buenas tardes, queso
 *
 * telling the NPC that `queso` is a way to greet someone. Any renderer that
 * flattens a list of items where an item may itself expand into a list has this
 * bug; a line break is the separator that cannot be confused with the contents.
 *
 * A competency with no describer falls back to its id rather than vanishing.
 * Silent omission is precisely how competency teaching disappeared before.
 */
export function renderTeachableList(
  refs: readonly TeachableRef[],
  describeCompetency?: (ref: CompetencyRef) => string
): string {
  const rendered = refs.map((ref) =>
    ref.kind === "vocabulary"
      ? ref.lemmaId
      : describeCompetency?.(ref) ?? ref.competencyId
  );
  if (rendered.length === 0) {
    return "";
  }
  return `\n${rendered.map((entry) => `- ${entry}`).join("\n")}`;
}
