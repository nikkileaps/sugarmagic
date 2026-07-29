/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/scene-context.ts
 *
 * Purpose: Declares the scene-context artifact -- what a piece of authored
 *   content is ABOUT -- and the source shape the extractor reads.
 *
 * Exports:
 *   - CONCEPT_PARTS_OF_SPEECH
 *   - ConceptPartOfSpeech
 *   - ContextSourceKind
 *   - ContextSource
 *   - ConceptProvenance
 *   - Concept
 *   - SceneContextModel
 *   - SceneContextCacheKey
 *
 * Relationships:
 *   - Produced by SceneContextExtractor; consumed by concept resolution (090.2)
 *     and, once composed with runtime facts, by the Teacher.
 *   - SIBLING of the vocabulary path (compile-sugarlang-scene.ts). Both read the
 *     same SceneAuthoringContext and answer different questions: this one asks
 *     what the content is about, that one asks which words are in it. Neither
 *     derives from the other.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

/**
 * Parts of speech a concept may carry.
 *
 * This is the UNION of `partsOfSpeech` values across every shipped atlas, and
 * it must stay that way: atlas resolution (090.2) tests a concept's POS for
 * membership in the atlas entry's `partsOfSpeech`, so a value the atlas never
 * emits can never match, and every concept carrying it drops SILENTLY --
 * telemetry would read "no atlas resolution", which looks like a coverage
 * problem rather than a schema mismatch.
 *
 * Measured 2026-07-29: es emits 12 of these, it emits all 14 (it adds
 * `abbreviation` and `formula`). A test pins this list against every shipped
 * atlas so adding a language with a new value fails loudly here rather than
 * quietly at resolution time.
 *
 * TRAP: do NOT build this from the budgeter's `FUNCTIONAL_POS`
 * (lexical-budgeter.ts) -- that set names article, auxiliary and particle, none
 * of which any atlas emits.
 */
export const CONCEPT_PARTS_OF_SPEECH = [
  "abbreviation",
  "adjective",
  "adverb",
  "conjunction",
  "determiner",
  "formula",
  "interjection",
  "noun",
  "numeral",
  "other",
  "preposition",
  "pronoun",
  "proper-noun",
  "verb"
] as const;

export type ConceptPartOfSpeech = (typeof CONCEPT_PARTS_OF_SPEECH)[number];

/** Where a context source came from. Mirrors the authored content kinds. */
export type ContextSourceKind =
  | "npc"
  | "region"
  | "area"
  | "quest"
  | "item"
  | "document"
  | "lore"
  | "runtime-facts";

/**
 * One thing the extractor can read.
 *
 * Deliberately satisfied by BOTH authored documents and live game state, so the
 * extractor never asks where in the lifecycle it is running -- that is the
 * caller's concern. Authored callers project existing objects into this shape;
 * they do not re-traverse content.
 *
 * `prose` is free text for the model to infer from. `labels` are already-structured
 * facts that need no inference (an NPC's `placementLabel`, a region's display
 * name) and should be passed through rather than guessed at.
 */
export interface ContextSource {
  sourceId: string;
  kind: ContextSourceKind;
  /** Authored display name, when one exists. Never inferred. */
  displayName?: string;
  /** Free text the model reads to infer what this is about. */
  prose?: string;
  /** Structured authored facts. Keys are stable; values are authored strings. */
  labels?: Record<string, string>;
}

/** Which source contributed a concept. Always present -- a concept with no source is a bug. */
export interface ConceptProvenance {
  sourceId: string;
  kind: ContextSourceKind;
}

/**
 * One thing a piece of content is about, or does.
 *
 * DEMAND, not supply. A concept says "this is relevant here"; it does not say
 * what to teach. What can be taught is looked up during resolution (090.2),
 * against TWO tables:
 *
 *   the atlas                 -> a vocabulary teachable
 *   the competency inventory  -> a competency teachable
 *
 * A concept therefore has NO KIND. Measured against the shipped es atlas, all
 * four outcomes are real:
 *
 *   | concept             | atlas         | competency | meaning                    |
 *   |---------------------|---------------|------------|----------------------------|
 *   | `cheese`            | queso (A1)    | --         | a thing                    |
 *   | `greeting`          | saludo (A1)   | greet      | BOTH -- the good case      |
 *   | `self introduction` | --            | (an act)   | an act, no single word     |
 *   | (unmatched)         | --            | --         | unknown word, OR a gap in  |
 *   |                     |               |            | the competency curriculum  |
 *
 * Tagging a concept `thing` or `act` up front would force `greeting` to pick
 * one and throw away the other resolution -- which is precisely the case worth
 * having, since it lets a word be taught INSIDE the act that uses it.
 *
 * Concepts are language-NEUTRAL: `cheese` is the concept, `queso` is Spanish's
 * answer, `formaggio` is Italian's. The label itself is in the SUPPORT language
 * (English today), never the target.
 */
export interface Concept {
  /**
   * A short English label. Usually one word (`cheese`), sometimes a small
   * phrase when no single word carries it (`self introduction`).
   *
   * NOT constrained to one word. Atlas resolution needs a single word and
   * simply MISSES on a phrase -- and that miss is informative rather than an
   * error: it is the signal that this concept is an act, so try the competency
   * table. The single-word rule belongs to that one lookup, not to concepts.
   */
  label: string;
  /**
   * Part of speech, when the label is word-like.
   *
   * Optional because it is only ever used by the atlas membership filter, and a
   * phrase like `self introduction` has no sensible value. Absent means "do not
   * POS-filter", not "unknown".
   */
  pos?: ConceptPartOfSpeech;
  /** Every source that contributed this concept, in stable order. */
  provenance: ConceptProvenance[];
  /**
   * The learner must UNDERSTAND this to progress -- quest-essential.
   *
   * Plan 090: this is where quest-essential lives under the domain model -- a
   * property of a concept, riding the same channel as everything else rather
   * than a second road to the Teacher. Absent means "not required", never
   * "unknown".
   */
  mustComprehend?: boolean;
}

/**
 * What one scene's authored content is about.
 *
 * NOT the Situation. This is the COMPILE-TIME, scene-scoped half; the Situation
 * the Teacher consumes is this composed with facts only the runtime knows (who
 * is actually present, met/unmet, quest stage, time of day). A cached model will
 * happily describe an NPC who is not standing there -- presence conditions are
 * runtime facts -- so anything reading this as if it were the Situation will
 * teach about characters the player cannot see. 090.3 owns the composition.
 */
export interface SceneContextModel {
  sceneId: string;
  /** Content hash of the sources this was derived from. */
  contentHash: string;
  /** Prompt version, so a prompt change invalidates deliberately. */
  promptVersion: string;
  /** Language the concepts are written in. Not the target language. */
  supportLanguage: string;
  /**
   * A short plain-English description of what this scene's content is about --
   * who and what is in it, what the place is, what is going on.
   *
   * The escape hatch for everything `concepts` cannot hold: relationships,
   * phrases, mood. Concepts are single words by schema; anything larger belongs
   * here.
   */
  prose: string;
  /** What this content is about. May be empty -- that is a legal, quiet answer. */
  concepts: Concept[];
  extractedAtMs: number;
  extractedByModel: string;
  /** True when extraction returned low-confidence or partial results. */
  reviewFlag: boolean;
}

/**
 * Cache identity.
 *
 * Keyed on SUPPORT language, not target: concepts are English words, so the
 * same scene compiled for Spanish and for Italian yields the SAME concepts and
 * should share a cache entry. Only resolution (090.2) is target-specific.
 */
export interface SceneContextCacheKey {
  contentHash: string;
  supportLanguage: string;
  promptVersion: string;
}
