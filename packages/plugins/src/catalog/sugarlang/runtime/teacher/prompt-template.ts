/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/prompt-template.ts
 *
 * Purpose: Holds the canonical Teacher prompt templates so Sugarlang has one editable prompt source of truth.
 *
 * Exports:
 *   - TEACHER_SYSTEM_TEMPLATE
 *   - TEACHER_USER_TEMPLATE
 *   - renderTeacherPromptTemplate
 *
 * Relationships:
 *   - Is consumed by ./prompt-builder to render structured Teacher prompts from formatted sections.
 *   - Keeps prompt wording separate from the code that formats runtime data into prompt-ready sections.
 *
 * Implements: Prompt-template refactor for Teacher'sdebugging and iteration
 *
 * Status: active
 */

const TEMPLATE_SLOT = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export const TEACHER_SYSTEM_TEMPLATE = [
  "{{rolePrompt}}",
  "{{pedagogicalRubricPrompt}}",
  "{{cefrDescriptorsPrompt}}",
  "{{outputSchemaPrompt}}",
  "{{hardConstraintsPrompt}}",
  "{{comprehensionGuidanceBlock}}",
  "{{pragmaticFeedbackBlock}}"
].join("\n\n");

export const TEACHER_USER_TEMPLATE = [
  "{{learnerSummary}}",
  "{{relationshipState}}",
  "{{sceneSnapshot}}",
  // 090.3d: the live half -- what is true in the world right now, as opposed to
  // the scene snapshot above, which is the same on every visit.
  "{{situation}}",
  // 090.10: the competency MENU. The schema has always let the Teacher name a
  // competency and the output-shape block gave an example id, but nothing ever
  // told it WHICH ids exist -- so naming a real one meant guessing. Competencies
  // reached teaching instead by being flattened into `prescription.introduce`,
  // which is the road this story deletes. Without the menu, that deletion stops
  // competency teaching silently.
  "{{availableCompetencies}}",
  "{{npcContext}}",
  "{{gameMoment}}",
  "{{recentDialogue}}",
  // 090.4: `{{prescription}}` removed. The Teacher is no longer bound by the
  // budgeter's shortlist, and showing it a block containing a "budget" and a
  // "rationale" while telling it "you are not limited to this" is the weakest
  // possible instruction -- the block reads as authoritative and anchors the
  // model regardless of the disclaimer. What the scene affords now arrives as
  // the situation; what is teachable arrives as resolved teachables.
  "{{pendingProvisional}}",
  "{{turnShapingHints}}"
].join("\n\n");

export function renderTeacherPromptTemplate(
  template: string,
  slots: Record<string, string>
): string {
  return template.replace(TEMPLATE_SLOT, (_match, slotName: string) => {
    return slots[slotName] ?? "";
  });
}
