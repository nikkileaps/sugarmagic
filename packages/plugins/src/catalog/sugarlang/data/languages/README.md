# Language Data

This directory holds plugin-shipped language assets for sugarlang. Runtime code
never branches on language identity; adding a supported language means adding
one new `languages/<lang>/` directory that satisfies the shared schemas.

## Required Files Per Language

- `languages/<lang>/README.md`: provenance, licensing notes, rerun instructions, and coverage notes.
- `languages/<lang>/cefrlex.json`: lexical atlas consumed by the classifier, budgeter, compiler, and provider layer.
- `languages/<lang>/morphology.json`: surface-form lookup data consumed by lemmatization.
- `languages/<lang>/placement-questionnaire.json`: plugin-owned canonical placement question bank.

Spanish also ships `languages/es/competency-inventory.json`. Italian also ships
`languages/it/frequency.json`.

## Schema References

- `../schemas/cefrlex.schema.json`
- `../schemas/morphology.schema.json`
- `../schemas/placement-questionnaire.schema.json`
- `../schemas/frequency.schema.json`

## Source Versus Derived

Only two kinds of file live here, and the difference decides how you change one.

**SOURCE. Hand-authored, never regenerated wholesale.**

- `cefrlex.json` -- the DICTIONARY. One entry per lemma: band, part of speech,
  frequency rank, glosses, and (for verbs) the full paradigm.
- `competency-inventory.json`, `placement-questionnaire.json`.

**DERIVED. Regenerated from the dictionary, never hand-edited.**

- `morphology.json` -- the reverse index: `surface form -> lemma`. The
  dictionary answers "what is `hablar`?"; this answers "I found `hablando` in
  this text, what dictionary entry is that?" You need both, because text
  contains surfaces and the dictionary is keyed by headwords.

There is no importer. Dictionaries were seeded once from a CEFR word list and
everything since is authored and reviewed, so nothing in this repo can overwrite
one. See `scripts/data-prep/DICTIONARY-AUTHORING.md` for the prompt and the
rules an author or model follows.

## The Pipeline: Adding Or Changing A Word

1. **Edit the dictionary entry.** This is the only step where anyone types
   anything. Fill gaps, never overwrite: an entry carries provenance
   (`cefrPriorSource`, `formsSource`), and a pass may only write where a field
   is absent or still marked as machine-generated. A human or model correction
   is permanent.
2. **Regenerate morphology.**

       pnpm exec tsx scripts/data-prep/build-spanish-morphology.ts
       pnpm exec tsx scripts/data-prep/build-italian-morphology.ts

   This is total, not incremental -- it discards the old index and rebuilds it
   from the dictionary. So the two cannot drift by hand.
3. **Run the tests.** The shipped data is validated against the schemas, and
   `tests/classifier/verb-forms.test.ts` checks the paradigms themselves: six
   slots per tense, provenance present, target-language orthography only.

## What Reads This Data

Worth knowing before changing it, because the blast radius is wider than it looks.

- The DICTIONARY is read through `CefrLexAtlasProvider` by the classifier, the
  Teacher, scene compilation and the grading pipeline.
- MORPHOLOGY is read through `lemmatize()`, and therefore by ambient spans,
  the language-ratio gate in `coverage.ts`, click-to-translate
  (`lookupSelection`), observation credit for words the player types, and
  proper-noun detection at compile time.

A wrong lemma is worse than a missing one: it produces a confident wrong gloss
on a real word, and it writes a card against the wrong headword.

## Adding A Language

1. **Seed the dictionary.** Use `scripts/data-prep/DICTIONARY-AUTHORING.md`. A
   CEFR-graded word list is a good starting point for lemmas and bands; where
   one does not exist, derive bands from frequency and record that honestly in
   `cefrPriorSource`. Seeding is one-time -- after it, the dictionary is source.
2. **Author the paradigms.** Verbs need `forms`. Decide the tense scope for the
   language before starting: Spanish ships present, preterite and imperfect for
   A1-B1 because the future at those levels is `ir a` + infinitive. Another
   language will differ -- Italian's everyday past is the compound passato
   prossimo, and its `futuro semplice` is one word and common.
3. **Add a morphology deriver** in `scripts/data-prep/` if the language needs
   one that differs from the existing ones, and regenerate.
4. **Author placement questions.** Placement banks are plugin-owned v1 data,
   not per-project content.
5. **Validate and test.** Every shipped JSON must pass its schema, and the
   loader, lemmatization and band-distribution tests are the minimum bar.
6. **Write the language README.** It is the single source of truth for where
   that language's data came from and what has been reviewed.

Note a language is not playable on the dictionary alone. Italian ships a
dictionary and a placement bank but has no `competency-inventory.json`, so the
chunk and competency half of teaching is Spanish-only today.

## Reference Patterns

- Well-resourced pattern: Spanish, seeded from a CEFR-graded lexicon, with
  hand-authored verb paradigms.
- Under-resourced pattern: Italian, seeded from a frequency list with
  frequency-derived band backfill, and no paradigms yet.

Languages likely feasible with the same architecture include French, German,
Swedish, Dutch, and English. Languages intentionally out of scope for v1
include Japanese, Chinese, Korean, and Arabic because the CEFR-aligned data,
and morphology assumptions differ too much from the current
Latin-script pipeline.
