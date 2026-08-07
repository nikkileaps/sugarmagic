# API 016: Sugarlang Competency Inventory

## Purpose

The competency inventory is what the runtime loads to know what a learner can
be taught in one language: the competencies ("greet", "ask-price"), the lesson
each belongs to, and the phrases that perform them ("buenos días", "hasta
luego"). It drives the curriculum spine -- which phrases the learner needs to
acquire, and which of the four interpret-lexicon slots each competency fills
for social-move detection.

**It is a generated file.** It is built from the language-neutral curriculum
plus one language's authored exponents; nothing here is hand-edited.

## Files

| Role | Path |
|------|------|
| Authored curriculum (language-neutral) | `packages/plugins/src/catalog/sugarlang/data/curriculum/<band>.json` |
| Authored phrases (per language) | `packages/plugins/src/catalog/sugarlang/data/languages/es/exponents.json` |
| Generator | `scripts/data-prep/build-competency-inventory.ts <lang>` |
| Generated data | `packages/plugins/src/catalog/sugarlang/data/languages/es/competency-inventory.json` |
| JSON schema | `packages/plugins/src/catalog/sugarlang/data/schemas/competency-inventory.schema.json` |
| TypeScript contracts | `packages/plugins/src/catalog/sugarlang/runtime/contracts/competency-inventory.ts` |
| Runtime loader | `packages/plugins/src/catalog/sugarlang/runtime/inventory/competency-inventory-loader.ts` |
| Tests | `packages/plugins/src/catalog/sugarlang/tests/data/competency-inventory.test.ts`, `scripts/data-prep/competency-inventory.test.ts` |

## Regenerating

```
pnpm exec tsx scripts/data-prep/build-competency-inventory.ts es
```

Rerun after editing any of its three inputs:

- `data/curriculum/<band>.json` -- a competency's descriptor, band or lesson.
- `data/languages/<lang>/exponents.json` -- the phrases.
- `data/languages/<lang>/cefrlex.json` -- constituent lemmas resolve through
  the dictionary, so a dictionary edit can move them. Regenerate
  `morphology.json` first; the inventory reads the index, not the dictionary.

`scripts/data-prep/competency-inventory.test.ts` fails if the checked-in file
is not byte-identical to a fresh build, so a hand-edit or a skipped rebuild is
caught by the suite rather than surviving until the next regeneration quietly
discards it.

## Adding a Phrase

Edit `exponents.json`. A wording is a phrase plus what it means, spelled
properly -- accents and all:

```json
"greet": [
  { "wordings": [{ "phrase": "buenos días", "gloss": { "en": "good morning" } }] },
  { "wordings": [{ "phrase": "qué tal",     "gloss": { "en": "how's it going" } }] }
]
```

Wordings grouped in one entry are **one exponent and one learner card**. Put
alternative phrasings of the same move together, and separate moves apart. The
gloss is per wording, because sharing a card is not sharing a meaning:

```json
"meta-language": [
  { "wordings": [
      { "phrase": "qué es",        "gloss": { "en": "what is it" } },
      { "phrase": "qué significa", "gloss": { "en": "what does it mean" } }
  ]},
  { "wordings": [{ "phrase": "no entiendo", "gloss": { "en": "I don't understand" } }] }
]
```

Authoring rules in depth: `scripts/data-prep/EXPONENT-AUTHORING.md`.

The competency id must already exist in `data/curriculum/`. Naming one that
does not fails the build.

## Exponent, Not Chunk

An **exponent** is a phrase that performs a competency. A **chunk** is any
multi-word expression, including ones the scene extractor found in authored
text. The two share a shape and a join key because one matcher scans for both,
but they are not the same concept: every exponent performs some competency, and
most chunks perform none.

## Data Shape

The JSON root (`CompetencyInventory`):

```typescript
interface CompetencyInventory {
  schemaVersion: "2";
  lang: string;               // BCP-47, e.g. "es"
  lessons: Lesson[];
  competencies: Competency[];
}

interface Lesson {
  lessonId: string;           // stable slug, e.g. "social-contact"
  band: CEFRBand;
  ordinal: number;            // position within the band; `A1.1` is derived, never stored
  displayName: string;
}
```

Each `Competency`:

```typescript
interface Competency {
  competencyId: string;       // stable slug, e.g. "greet". PERMANENT once shipped.
  lessonId: string;           // the lesson it belongs to. Exactly one.
  displayName: string;
  cefrDescriptor: string;     // CEFR can-do descriptor, from the curriculum
  band: CEFRBand;
  placementGateBand?: CEFRBand; // if set, taught before placement rather than after
  isItemZero?: boolean;       // taught before anything else, regardless of level
  interpretLexiconCategory?: "farewell" | "greeting" | "gratitude" | "acknowledgement";
  exponents: Record<string, Exponent[]>;  // key = BCP-47 lang
}
```

Each `Exponent`:

```typescript
interface Exponent {
  exponentId: string;         // stable slug, e.g. "buenos_dias". Deaccented.
  normalizedForm: string;     // join key to scene-extracted chunks
  surfaceForms: string[];     // every spelling, accented and not
  cefrBand: CEFRBand;
  constituentLemmas: string[];
  // Every spelling to what it means, per support language. Keyed by surface so
  // a hover answers from the text it matched.
  glossBySurface: Record<string, Record<string, string>>;
}
```

## What Is Derived

Only `wordings` (and, where needed, a lemma override) is authored. Everything
else on an exponent comes from the build:

- `exponentId` and `normalizedForm` -- the first wording, deaccented, with
  spaces as underscores. Learner cards are keyed `exponent:<exponentId>`.
- `surfaceForms` -- every accent combination of each wording, each accented
  word independently kept or dropped, because players accent inconsistently.
  `cómo estás` ships as all eight of `cómo estás`, `cómo estas`, `como estás`,
  `como esta`, and so on.
- `cefrBand` -- from the competency's band in the curriculum.
- `glossBySurface` -- every spelling of a wording mapped to that wording's
  gloss, so an accented and an unaccented spelling answer identically.
- `constituentLemmas` -- every wording tokenized and resolved through the
  morphology index, minus words with no lexical content of their own (articles,
  clitic pronouns, possessives). Prepositions are kept: `hasta` and `por` are
  vocabulary at A1.

A word that does not resolve **fails the build**, naming the competency, the
phrase and the word. It does not ship a guess.

### Lemma overrides

The morphology index maps a surface to exactly one lemma, and a headword
outranks another word's inflected form. So `cuesta` resolves to the noun
("slope") rather than to `costar`, and `llama` to the animal rather than to
`llamar`. Where that is wrong for a phrase, the authored exponent says so:

The override sits on the wording, beside its phrase and gloss:

```json
{ "phrase": "habla más despacio",
  "gloss": { "en": "speak more slowly" },
  "lemmas": { "habla": "hablar" } }
```

This matters beyond tidiness: a competency counts as in-envelope when one of
its constituent lemmas is being taught, so a wrong lemma silently stops the
phrase from linking to the word it teaches.

## Loader API

Import from `runtime/inventory/competency-inventory-loader`:

```typescript
// Load the full inventory for a language (throws if missing).
loadCompetencyInventory(lang: string): CompetencyInventory

// Every exponent across all competencies.
getAllInventoryExponents(lang: string): Exponent[]

// The competency that owns an exponent id, or undefined.
getCompetencyForExponent(exponentId: string, lang: string): Competency | undefined

// Build the interpretLexicon contribution for interpretation.ts's detectSocialMove.
buildInterpretLexiconFromInventory(lang: string): Record<string, string[]>

// Class form -- inject a different data map in tests.
class CompetencyInventoryLoader {
  constructor(dataByLang?: Partial<Record<string, unknown>>)
  load(lang: string): CompetencyInventory
  getCompetencies(lang: string): Competency[]
  getExponents(competencyId: string, lang: string): Exponent[]
  getAllExponents(lang: string): Exponent[]
  getCompetencyForExponent(exponentId: string, lang: string): Competency | undefined
  buildInterpretLexicon(lang: string): Record<string, string[]>
}
```

## Item-Zero Competencies

Competencies with `isItemZero: true` carry the repair language a beginner needs
to survive turn two ("no entiendo", "más despacio", "cómo se dice", "qué es").
They are taught before anything else and are not subject to the CEFR gate.

## InterpretLexicon Integration

Competencies with `interpretLexiconCategory` set contribute their
`surfaceForms` to the four-slot interpretLexicon consumed by `detectSocialMove`
in `sugaragent/runtime/stages/interpretation.ts`. Call
`buildInterpretLexiconFromInventory("es")` for the full category map.

## normalizedForm Join Key

`Exponent.normalizedForm` is the join key to scene-extracted
`LexicalChunk.normalizedForm` objects in `SceneVocabularyModel.chunks`
(`runtime/contracts/scene-lexicon.ts`). The scene-extraction pipeline uses the
same underscore-lowercased convention.

## Adding a New Language

1. Author `data/languages/<lang>/exponents.json` -- wordings only, spelled
   correctly. The competency ids must already exist in the curriculum.
2. Run `build-competency-inventory.ts <lang>`, which needs no new script, and run
   it. Unresolvable words fail there, which is the point.
3. Import the generated file in `competency-inventory-loader.ts` and add it to
   `DEFAULT_INVENTORY_DATA`.
4. Add `interpretLexiconCategory` entries only if `detectSocialMove` is live
   for that language (currently `es` only).

A language with no `exponents.json` ships no inventory. The loader throws for
it and every caller catches that and carries on with no competencies, which is
the same state as an empty curriculum.
