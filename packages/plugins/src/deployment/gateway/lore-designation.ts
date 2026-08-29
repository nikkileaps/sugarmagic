/**
 * packages/plugins/src/deployment/gateway/lore-designation.ts
 *
 * Purpose: Pure designation of parsed lore-page sections into the NPC
 * Knowledge Model's three layers (Plan 072, story 072.1).
 *
 * Exports:
 *   - DesignatableLoreSection, DesignatedLore, LoreRelationshipEntry
 *   - ParsedRecoverySection, RecoveryStrategy
 *   - PERSONA_CARD_SECTION_SLUGS, SECRETS_SECTION_SLUG,
 *     RELATIONSHIPS_SECTION_SLUG, RECOVERY_SECTION_SLUG, RECOVERY_STRATEGIES
 *   - isPersonaCardSection, isSecretSection, isRelationshipsSection,
 *     isRecoverySection, isWithheldSection, designateLoreSections
 *   - parseRelationshipEntries, findRelationshipEntry, parseRecoveryStrategies
 *
 * Relationships:
 *   - Operates on the EXISTING parser output (core.ts `splitLoreSections`);
 *     it classifies, it does NOT parse. One classifier, three consumers:
 *     ingest chunking (072.1), lore/resolve (072.2), the card fetch (072.3).
 *   - Lives in the gateway source (bundled by build:gateway-source, no
 *     @sugarmagic imports) so all three consumers share one definition of
 *     what a persona / core / secret section is.
 *   - IMPORTED BY BROWSER RUNTIME: `catalog/sugaragent/runtime/clients.ts`
 *     (the card fetch) imports this module. It MUST therefore stay pure --
 *     ZERO imports, no `node:*` builtins, no @sugarmagic/* -- or it will drag
 *     node-only code into the browser bundle. The rest of `deployment/gateway/`
 *     is node-only; this file is the deliberate browser-safe exception.
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

/**
 * `## Relationships` -- what this character knows about other characters. It
 * stays in core knowledge like any other section; the slug is reserved so a
 * caller can find it and read one entry out of it.
 */
export const RELATIONSHIPS_SECTION_SLUG = "relationships";

/**
 * `## Recovery` -- what this character does when it cannot understand the
 * player. Withheld from core knowledge and from the ingest chunks the way
 * `## Secrets` is, so the character never reads its own list of moves back as
 * something it knows. Unlike secrets it survives on `sections`, because that
 * is the only field the conversation runtime reads a page through.
 */
export const RECOVERY_SECTION_SLUG = "recovery";

/**
 * The moves a character can make when it does not understand the player. A
 * closed set: the planner has a branch per name, and a page naming anything
 * else is telling the planner to do something it has no branch for.
 */
export const RECOVERY_STRATEGIES = [
  "curt-exit",
  "change-subject",
  "joke",
  "playful-probe",
  "self-disclosure"
] as const;

export type RecoveryStrategy = (typeof RECOVERY_STRATEGIES)[number];

export function isPersonaCardSection(section: DesignatableLoreSection): boolean {
  return PERSONA_CARD_SECTION_SLUGS.includes(section.slug);
}

export function isRelationshipsSection(section: DesignatableLoreSection): boolean {
  return section.slug === RELATIONSHIPS_SECTION_SLUG;
}

export function isRecoverySection(section: DesignatableLoreSection): boolean {
  return section.slug === RECOVERY_SECTION_SLUG;
}

/**
 * Sections kept out of `body` and out of the vector index. Two reasons, one
 * rule: a secret must never leave the gateway, and a recovery list is a brief
 * for the writer rather than something the character knows.
 *
 * [LAW:single-enforcer] Every consumer that withholds a section asks here, so
 * adding a third reserved slug is one edit rather than a hunt through the
 * ingest, resolve and card-fetch paths.
 */
export function isWithheldSection(section: DesignatableLoreSection): boolean {
  return isSecretSection(section) || isRecoverySection(section);
}

/** One entry from a `## Relationships` section. */
export interface LoreRelationshipEntry {
  /** The other character's name, as written. */
  name: string;
  /** The lore page linked in the entry; null when the author wrote a bare name. */
  pageId: string | null;
  /** What this page says about them. Empty when the bullet is only a name. */
  description: string;
}

// An entry is a markdown link and whatever follows it. A leading list marker
// is allowed and ignored.
const LINKED_NAME = /^(?:[-*]\s+)?\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/;

// Between the name and what is said about them: "--", an em dash (escaped so
// this file stays ASCII), or a colon.
function stripLeadingSeparator(text: string): string {
  return text.replace(/^(--|\u2014|:)\s*/, "").trim();
}

/**
 * Read the entries out of a `## Relationships` section.
 *
 * An entry is a line carrying a markdown link -- the link text is the
 * character's name, the target is their lore page, and the rest of the line is
 * what this page says about them:
 *
 *     [Finnick Thorn](lore.entities.npcs.finnick_thorn) -- An unbearable
 *     cheese bore.
 *
 * A line with no link continues the description of the entry above it, so an
 * entry can wrap. A line before the first entry is ignored.
 */
export function parseRelationshipEntries(content: string): LoreRelationshipEntry[] {
  const entries: LoreRelationshipEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const linked = LINKED_NAME.exec(line);
    if (linked) {
      entries.push({
        name: linked[1]!.trim(),
        pageId: linked[2]!.trim() || null,
        description: stripLeadingSeparator(linked[3] ?? "")
      });
      continue;
    }

    const previous = entries[entries.length - 1];
    if (previous) {
      previous.description = previous.description
        ? `${previous.description} ${line}`
        : line;
    }
  }
  return entries;
}

/**
 * The entry describing a given page, or null when this character has nothing
 * written about them. Matched on the linked page id, or on the name when the
 * author wrote a bare name.
 */
export function findRelationshipEntry(
  entries: readonly LoreRelationshipEntry[],
  target: { pageId?: string | null; title?: string | null }
): LoreRelationshipEntry | null {
  const pageId = target.pageId?.trim() ?? "";
  const title = target.title?.trim().toLowerCase() ?? "";
  for (const entry of entries) {
    if (pageId && entry.pageId === pageId) return entry;
    if (title && entry.name.trim().toLowerCase() === title) return entry;
  }
  return null;
}

export function isSecretSection(section: DesignatableLoreSection): boolean {
  return section.slug === SECRETS_SECTION_SLUG;
}

/** What a `## Recovery` section turned out to say. */
export interface ParsedRecoverySection {
  /** The moves the planner can choose from, in document order. */
  strategies: RecoveryStrategy[];
  /**
   * Names the page asked for that are not moves. Kept rather than discarded so
   * the caller can say which line it ignored -- a typo here is otherwise a
   * character that quietly never does the thing its author wrote.
   */
  unrecognized: string[];
}

// An entry is a list item whose first word is the move. Everything after that
// word is prose for the writer and is read from the section text, not here.
const RECOVERY_ENTRY = /^[-*]\s+([^\s:]+)/;

function isRecoveryStrategy(name: string): name is RecoveryStrategy {
  return (RECOVERY_STRATEGIES as readonly string[]).includes(name);
}

/**
 * Read the moves out of a `## Recovery` section.
 *
 *     ## Recovery
 *
 *     - change-subject -- She assumes you have not yet learned how things
 *       ought to be done, and tells you.
 *     - playful-probe
 *
 * A line without a list marker continues the prose above it, so an entry can
 * wrap. Names are matched exactly, lowercase.
 *
 * [LAW:parse-dont-validate] Returns `RecoveryStrategy[]`, a type that could not
 * exist before the check, so no caller downstream re-tests whether a name is a
 * real move. [LAW:no-silent-failure] The names it refused come back beside the
 * ones it kept, because a dropped line the author never hears about is the
 * failure mode this section is most likely to have.
 */
export function parseRecoveryStrategies(content: string): ParsedRecoverySection {
  const strategies: RecoveryStrategy[] = [];
  const unrecognized: string[] = [];
  for (const rawLine of content.split("\n")) {
    const entry = RECOVERY_ENTRY.exec(rawLine.trim());
    if (!entry) continue;

    const name = entry[1]!.toLowerCase();
    if (isRecoveryStrategy(name)) {
      strategies.push(name);
    } else {
      unrecognized.push(name);
    }
  }
  return { strategies, unrecognized };
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
  /**
   * `## Recovery` -- excluded the same way, and read by the conversation
   * runtime to learn what this character does when it does not understand the
   * player.
   */
  recovery: T[];
}

/**
 * Bucket a page's sections into the layers. Pure and order-preserving within
 * each bucket. Withheld sections win over persona-card designation (a section
 * can't be both), though authoring a `## Secrets` that also slugs to a card
 * name is impossible by construction.
 */
export function designateLoreSections<T extends DesignatableLoreSection>(
  sections: readonly T[]
): DesignatedLore<T> {
  const personaCard: T[] = [];
  const coreKnowledge: T[] = [];
  const secrets: T[] = [];
  const recovery: T[] = [];
  for (const section of sections) {
    if (isSecretSection(section)) {
      secrets.push(section);
    } else if (isRecoverySection(section)) {
      recovery.push(section);
    } else if (isPersonaCardSection(section)) {
      personaCard.push(section);
    } else {
      coreKnowledge.push(section);
    }
  }
  return { personaCard, coreKnowledge, secrets, recovery };
}

/**
 * Reconstruct a page's `body` markdown from a section list. Used by the
 * lore/resolve route to recompute `body` after excluding the withheld
 * sections, so their text never ships in the raw body field while `body` stays
 * a valid string for consumers (a page that is nothing but withheld sections
 * yields ""). Heading level is not preserved by the parser, so sections
 * re-emit at `##`.
 */
export function composeLoreBody(
  sections: readonly DesignatableLoreSection[]
): string {
  return sections
    .map((section) =>
      // The implicit pre-heading section (slug "overview") had no heading in
      // the source, so re-emit its content only -- don't inject a synthetic
      // "## Overview" the author never wrote.
      section.slug === "overview"
        ? section.content
        : `## ${section.heading}\n\n${section.content}`
    )
    .join("\n\n");
}
