/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/teachable-ref.ts
 *
 * Purpose: What the Teacher may name. A reference to something teachable --
 *   EITHER a vocabulary item or a competency.
 *
 * WHY THIS TYPE EXISTS
 *   `targetVocab` held `LemmaRef[]`, so the Teacher's world was words. A
 *   competency could only reach teaching through a side door: the scheduler
 *   picked it, `realizeCompetencyChunksFromSchedule` flattened it into
 *   `exponent:<id>` pseudo-lemmas, and those were injected into
 *   `prescription.introduce` so they could ride the lemma channel.
 *
 *   That is why "delete the prescriber" was dangerous: with the slate holding
 *   lemma refs, deleting the prescription deletes competency teaching entirely,
 *   and nothing fails. It nearly happened for real -- removing the prescription
 *   block from the Teacher's prompt (090.4) severed the channel immediately,
 *   with no test noticing, because competency teaching has never had one.
 *
 *   With a discriminant, `introduce ask-where` is expressible directly. The side
 *   door closes because there is a front door.
 *
 * A COMPETENCY IS NOT A WORD, AND THE UNION SAYS SO
 *   `exponent:` pseudo-lemmas were a lie told to a type: a competency was smuggled
 *   through a field meaning "lemma" by prefixing a string. Anything downstream
 *   that reasoned about lemmas -- the atlas, morphology, card seeding -- had to
 *   special-case a prefix, and anything that forgot silently treated a
 *   competency as a word that does not exist.
 *
 * READERS MUST NARROW EXPLICITLY
 *   `vocabularyRefs` and `competencyRefs` exist so that a consumer which only
 *   handles words says so at the call site, in a named function, rather than
 *   filtering `kind === "vocabulary"` inline and quietly dropping half the
 *   slate. Dropping is sometimes correct; doing it invisibly never is.
 *
 * Exports:
 *   - TeachableRef, VocabularyRef, CompetencyRef
 *   - isVocabularyRef, isCompetencyRef
 *   - vocabularyRefs, competencyRefs
 *   - teachableRefKey
 *
 * Relationships:
 *   - Used by PedagogicalDirective and SugarlangConstraint (./pedagogy).
 *   - `VocabularyRef` is structurally a `LemmaRef` plus a discriminant, so
 *     existing lemma readers keep working once they narrow.
 *
 * Implements: Plan 090 story 090.4
 *
 * Status: active
 */

import type { LemmaRef } from "./lexical-prescription";

export interface VocabularyRef extends LemmaRef {
  kind: "vocabulary";
}

export interface CompetencyRef {
  kind: "competency";
  competencyId: string;
  /** The language whose exponents realize it. */
  lang: string;
}

export type TeachableRef = VocabularyRef | CompetencyRef;

export function isVocabularyRef(ref: TeachableRef): ref is VocabularyRef {
  return ref.kind === "vocabulary";
}

export function isCompetencyRef(ref: TeachableRef): ref is CompetencyRef {
  return ref.kind === "competency";
}

/**
 * The vocabulary half, for consumers that genuinely only handle words.
 *
 * Call this rather than filtering inline. The named call is the record that a
 * consumer considered competencies and does not serve them -- an inline
 * `kind === "vocabulary"` reads as an implementation detail and is exactly how
 * competency teaching disappeared the last time.
 */
export function vocabularyRefs(refs: readonly TeachableRef[]): VocabularyRef[] {
  return refs.filter(isVocabularyRef);
}

export function competencyRefs(refs: readonly TeachableRef[]): CompetencyRef[] {
  return refs.filter(isCompetencyRef);
}

/**
 * Lifts plain `LemmaRef`s into the union.
 *
 * The bridge from everything that predates the discriminant -- the prescription,
 * quest-essential lemmas, probe targets. Those are genuinely word-shaped, so the
 * lift is honest rather than a cast; what it must NOT be used for is smuggling a
 * competency across by pretending it is a lemma, which is what `exponent:` prefixes
 * did.
 */
export function toVocabularyRefs(lemmas: readonly LemmaRef[]): VocabularyRef[] {
  return lemmas.map((lemma) => ({ ...lemma, kind: "vocabulary" as const }));
}

/** Stable identity across both kinds, for dedup and set membership. */
export function teachableRefKey(ref: TeachableRef): string {
  return ref.kind === "vocabulary"
    ? `vocabulary:${ref.lang}:${ref.lemmaId}`
    : `competency:${ref.lang}:${ref.competencyId}`;
}
