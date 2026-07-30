/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/scene-teachable-resolver.ts
 *
 * Purpose: Resolves a scene's concepts (demand) against the atlas into
 *   vocabulary teachables (supply).
 *
 * ONLY THE ATLAS IS JOINED HERE, AND THE ASYMMETRY IS THE REASON
 *   The two supply tables have opposite scarcity. The atlas is 11,000 entries,
 *   so the problem is SELECTION and a deterministic lookup is the right tool --
 *   `cheese` -> `queso` is a dictionary fact, and 11,000 entries cannot go in a
 *   prompt. The competency inventory is TEN entries, so the problem is COVERAGE
 *   and "does this scene call for `ask-where`" is a judgment, not a lookup. Ten
 *   items fit in a prompt trivially.
 *
 *   So competencies are NOT joined here. An earlier revision of this module
 *   matched concept labels against a hand-authored `conceptLabels` alias list on
 *   each competency; that was a lookup table standing in for a decision, it
 *   needed new aliases for every content domain forever, and a miss was silent.
 *   Concepts flow to the situation (090.3) and the Teacher decides against the
 *   inventory there (090.4).
 *
 * NOTHING HERE IS PERSISTED
 *   Derived at read time from concepts + atlas, both already in hand, and the
 *   gloss reverse index is built once and cached in-provider so resolution is a
 *   `Map.get`. Deriving means an atlas edit applies with no recompile.
 *
 * ROWS ARE KEYED BY TEACHABLE, NOT BY CONCEPT
 *   Two concepts resolving to one lemma merge into one row carrying both
 *   demanders. That is why `Concept` needs no identity, and it is the ranking
 *   signal a Teacher gets in place of the budgeter's `w_npc` boost: a teachable
 *   demanded by three NPCs outranks one mentioned in a lore page.
 *
 * Exports:
 *   - resolveSceneTeachables
 *
 * Relationships:
 *   - Pure and synchronous. Consumed by the situation composition in 090.3.
 *
 * Implements: Plan 090 story 090.2
 *
 * Status: active
 */

import type { Concept, ConceptProvenance } from "../contracts/scene-context";
import type { AtlasLemmaEntry, LexicalAtlasProvider } from "../contracts/providers";
import type {
  SceneTeachable,
  SceneTeachableResolution,
  TeachableKind
} from "../contracts/scene-teachable";

export interface ResolveSceneTeachablesArgs {
  concepts: readonly Concept[];
  atlas: LexicalAtlasProvider;
  /** The language being taught -- which half of the atlas to resolve into. */
  targetLanguage: string;
  /** The language concept labels and atlas glosses are written in. */
  supportLanguage: string;
}

/** Case- and whitespace-insensitive key for matching authored English labels. */
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Best atlas lemma for a concept, or a reason there is none.
 *
 * Ranked by `frequencyRank` ascending so `greeting` picks `saludo` (1503) over
 * `saluda` (5690) and `university` picks `universidad` (258) over `uni` (10210)
 * -- the commoner word is the one worth a learner's attention. Entries with no
 * rank sort last rather than being dropped.
 */
function resolveVocabulary(
  concept: Concept,
  atlas: LexicalAtlasProvider,
  targetLanguage: string,
  supportLanguage: string
): { lemmaId: string } | { miss: "multi-word" | "no-gloss" | "pos-filtered" } {
  // A phrase never reaches the atlas. Reverse-gloss lookup is single-word by
  // construction, so this is not a rejection -- it is why `self introduction`
  // silently produces no vocabulary and waits for the Teacher to read it as an
  // act instead.
  if (normalizeLabel(concept.label).includes(" ")) {
    return { miss: "multi-word" };
  }

  const entries = atlas.resolveFromGloss(concept.label, targetLanguage, supportLanguage);
  if (entries.length === 0) {
    return { miss: "no-gloss" };
  }

  // POS is optional on a concept, and ABSENT means "do not filter", never
  // "unknown" -- filtering on a missing value would silently drop everything.
  const pool = concept.pos
    ? entries.filter((entry) => entry.partsOfSpeech.includes(concept.pos as string))
    : entries;

  if (pool.length === 0) {
    // The atlas HAS this gloss, in another sense: `dock` glosses only `atracar`,
    // a verb, so a `dock (noun)` concept empties the pool. Worth counting
    // separately from a plain miss -- it means the curriculum is one sense away.
    return { miss: "pos-filtered" };
  }

  const best = [...pool].sort(byFrequencyThenId)[0] as AtlasLemmaEntry;
  return { lemmaId: best.lemmaId };
}

/** Commonest first; unranked last; lemmaId breaks ties so output is stable. */
function byFrequencyThenId(a: AtlasLemmaEntry, b: AtlasLemmaEntry): number {
  const rankA = a.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return a.lemmaId.localeCompare(b.lemmaId);
}

/** Accumulates demanders into one row per (kind, id). */
class TeachableAccumulator {
  private readonly rows = new Map<string, SceneTeachable>();

  add(kind: TeachableKind, id: string, concept: Concept): void {
    const key = `${kind}:${id}`;
    const existing = this.rows.get(key);
    if (!existing) {
      this.rows.set(key, {
        kind,
        id,
        concepts: [concept.label],
        provenance: [...concept.provenance],
        mustComprehend: concept.mustComprehend === true
      });
      return;
    }
    if (!existing.concepts.includes(concept.label)) {
      existing.concepts.push(concept.label);
    }
    for (const entry of concept.provenance) {
      if (!existing.provenance.some((seen) => isSameProvenance(seen, entry))) {
        existing.provenance.push(entry);
      }
    }
    // ANY demanding concept being quest-essential makes the teachable so; one
    // incidental mention must never downgrade a quest-critical demand.
    existing.mustComprehend = existing.mustComprehend || concept.mustComprehend === true;
  }

  finish(): SceneTeachable[] {
    const rows = [...this.rows.values()];
    for (const row of rows) {
      row.concepts.sort();
      row.provenance.sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.sourceId.localeCompare(b.sourceId)
      );
    }
    return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }
}

function isSameProvenance(a: ConceptProvenance, b: ConceptProvenance): boolean {
  return a.sourceId === b.sourceId && a.kind === b.kind;
}

/**
 * Resolves every concept against the atlas.
 *
 * A concept producing no vocabulary is NOT reported as a gap. Whether it is an
 * unknown word or an act the curriculum can teach is not knowable here -- only
 * the Teacher, reading the concept against the inventory, can say. Reporting it
 * as a curriculum gap from this module would be guessing.
 */
export function resolveSceneTeachables(
  args: ResolveSceneTeachablesArgs
): SceneTeachableResolution {
  const accumulator = new TeachableAccumulator();

  let atlasHits = 0;
  let droppedForPos = 0;
  let skippedMultiWord = 0;

  for (const concept of args.concepts) {
    const vocabulary = resolveVocabulary(
      concept,
      args.atlas,
      args.targetLanguage,
      args.supportLanguage
    );

    if ("lemmaId" in vocabulary) {
      accumulator.add("vocabulary", vocabulary.lemmaId, concept);
      atlasHits += 1;
    } else if (vocabulary.miss === "pos-filtered") {
      droppedForPos += 1;
    } else if (vocabulary.miss === "multi-word") {
      skippedMultiWord += 1;
    }
  }

  return {
    teachables: accumulator.finish(),
    diagnostics: {
      conceptCount: args.concepts.length,
      atlasHits,
      droppedForPos,
      skippedMultiWord
    }
  };
}
