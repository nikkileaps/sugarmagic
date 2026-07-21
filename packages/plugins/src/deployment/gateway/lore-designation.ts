/**
 * packages/plugins/src/deployment/gateway/lore-designation.ts
 *
 * Purpose: Pure designation of parsed lore-page sections into the NPC
 * Knowledge Model's three layers (Plan 072, story 072.1).
 *
 * Exports:
 *   - DesignatableLoreSection, DesignatedLore
 *   - PERSONA_CARD_SECTION_SLUGS, SECRETS_SECTION_SLUG
 *   - isPersonaCardSection, isSecretSection, designateLoreSections
 *
 * Relationships:
 *   - Operates on the EXISTING parser output (core.ts `splitLoreSections`);
 *     it classifies, it does NOT parse. One classifier, three consumers:
 *     ingest chunking (072.1), lore/resolve (072.2), the card fetch (072.3).
 *   - Lives in the gateway source (bundled by build:gateway-source, no
 *     @sugarmagic imports) so all three consumers share one definition of
 *     what a persona / core / secret section is.
 *
 * Implements: Plan 072 story 072.1 -- lore-page authoring convention
 *
 * Status: active
 */

/**
 * The minimal shape this module needs from a parsed section. core.ts's
 * `LoreSection` ({ heading, slug, content }) is structurally assignable.
 */
export interface DesignatableLoreSection {
  heading: string;
  slug: string;
  content: string;
}

/**
 * Reserved section slugs. Matched against the parser's lowercase `slug`
 * (from `slugify`), so matching is inherently case-insensitive -- `## Persona`,
 * `## PERSONA`, and `## persona` all designate the persona card. Matching is
 * also heading-LEVEL-agnostic: `splitLoreSections` discards heading level, so
 * `# Voice` and `## Voice` designate identically. Only an EXACT reserved slug
 * counts -- `## Persona and Backstory` (slug `persona-and-backstory`) is core
 * knowledge, not the card.
 */
export const PERSONA_CARD_SECTION_SLUGS: readonly string[] = ["persona", "voice"];

/**
 * The one section excluded from EVERYTHING: the persona card, core knowledge,
 * AND the ingest chunks / vector index. The strategy's secrets invariant in
 * its minimum-viable form -- a place to author unrevealable truths that never
 * enter any prompt or index. Quest-stage-gated revelation arrives at epics C/D/E.
 */
export const SECRETS_SECTION_SLUG = "secrets";

export function isPersonaCardSection(section: DesignatableLoreSection): boolean {
  return PERSONA_CARD_SECTION_SLUGS.includes(section.slug);
}

export function isSecretSection(section: DesignatableLoreSection): boolean {
  return section.slug === SECRETS_SECTION_SLUG;
}

export interface DesignatedLore<T extends DesignatableLoreSection> {
  /** `## Persona` + `## Voice`, in document order -> cached system prompt. */
  personaCard: T[];
  /**
   * Every other section, including the implicit pre-heading "Overview"
   * section -> cached system prompt. Missing persona sections is legal:
   * the card is then empty and only core knowledge loads.
   */
  coreKnowledge: T[];
  /** `## Secrets` -- excluded from card, core knowledge, AND ingest. */
  secrets: T[];
}

/**
 * Bucket a page's sections into the three layers. Pure and order-preserving
 * within each bucket. Secrets win over persona-card designation (a section
 * can't be both), though authoring a `## Secrets` that also slugs to a card
 * name is impossible by construction.
 */
export function designateLoreSections<T extends DesignatableLoreSection>(
  sections: readonly T[]
): DesignatedLore<T> {
  const personaCard: T[] = [];
  const coreKnowledge: T[] = [];
  const secrets: T[] = [];
  for (const section of sections) {
    if (isSecretSection(section)) {
      secrets.push(section);
    } else if (isPersonaCardSection(section)) {
      personaCard.push(section);
    } else {
      coreKnowledge.push(section);
    }
  }
  return { personaCard, coreKnowledge, secrets };
}

/**
 * Reconstruct a page's `body` markdown from a section list. Used by the
 * lore/resolve route (072.2) to recompute `body` after excluding `## Secrets`,
 * so the secret text never ships in the raw body field while `body` stays a
 * valid non-empty string for consumers (an all-secrets page yields ""). Heading
 * level is not preserved by the parser, so sections re-emit at `##`.
 */
export function composeLoreBody(
  sections: readonly DesignatableLoreSection[]
): string {
  return sections
    .map((section) => `## ${section.heading}\n\n${section.content}`)
    .join("\n\n");
}
