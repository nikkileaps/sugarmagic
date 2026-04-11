/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/prompt-template.ts
 *
 * Purpose: Holds the canonical Teacher prompt templates so Sugarlang has one editable prompt source of truth.
 *
 * Exports:
 *   - DIRECTOR_SYSTEM_TEMPLATE
 *   - DIRECTOR_USER_TEMPLATE
 *   - renderDirectorPromptTemplate
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

export const DIRECTOR_SYSTEM_TEMPLATE = [
  "{{rolePrompt}}",
  "{{pedagogicalRubricPrompt}}",
  "{{cefrDescriptorsPrompt}}",
  "{{outputSchemaPrompt}}",
  "{{hardConstraintsPrompt}}",
  "{{comprehensionGuidanceBlock}}"
].join("\n\n");

export const DIRECTOR_USER_TEMPLATE = [
  "{{learnerSummary}}",
  "{{relationshipState}}",
  "{{sceneSnapshot}}",
  "{{npcContext}}",
  "{{gameMoment}}",
  "{{recentDialogue}}",
  "{{prescription}}",
  "{{pendingProvisional}}",
  "{{turnShapingHints}}"
].join("\n\n");

export function renderDirectorPromptTemplate(
  template: string,
  slots: Record<string, string>
): string {
  return template.replace(TEMPLATE_SLOT, (_match, slotName: string) => {
    return slots[slotName] ?? "";
  });
}
