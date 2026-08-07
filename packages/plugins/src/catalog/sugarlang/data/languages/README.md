# Language Data

This directory holds plugin-shipped language assets for sugarlang. Runtime code
never branches on language identity; adding a supported language means adding
one new `languages/<lang>/` directory that satisfies the shared schemas.

## Required Files Per Language

- `languages/<lang>/README.md`: provenance, licensing notes, rerun instructions, and coverage notes.
- `languages/<lang>/cefrlex.json`: lexical atlas consumed by the classifier, budgeter, compiler, and provider layer.
- `languages/<lang>/morphology.json`: surface-form lookup data consumed by lemmatization.
- `languages/<lang>/placement-questionnaire.json`: plugin-owned canonical placement question bank.

Spanish also ships `languages/es/exponents.json` and the
`languages/es/competency-inventory.json` generated from it. Italian also ships
`languages/it/frequency.json`.

## Schema References

- `../schemas/cefrlex.schema.json`
- `../schemas/morphology.schema.json`
- `../schemas/placement-questionnaire.schema.json`
- `../schemas/frequency.schema.json`
- `../schemas/competency-inventory.schema.json`

## Source Versus Derived

Only two kinds of file live here, and the difference decides how you change one.

**SOURCE. Hand-authored, never regenerated wholesale.**

- `cefrlex.json` -- the DICTIONARY. One entry per lemma: band, part of speech,
  frequency rank, glosses, and (for verbs) the full set of forms.
- `exponents.json` -- the PHRASES that perform each competency, in this
  language. Wordings only; write them spelled correctly, accents and all.
  Everything else about an exponent is derived.
- `placement-questionnaire.json`.

- `always-target.json` -- the handful of words spoken in this language at every
  level, however much of the line is in English: subject pronouns, possessives,
  yes and no. HAND-AUTHORED, and short on purpose. These are not teachables --
  the Teacher never chooses them and they consume no slate slot. A content word
  here would be taught to every learner forever, so the suite rejects anything
  that is only a noun.

**DERIVED. Regenerated from the sources above, never hand-edited.**

- `morphology.json` -- the reverse index: `surface form -> lemma`. The
  dictionary answers "what is `hablar`?"; this answers "I found `hablando` in
  this text, what dictionary entry is that?" You need both, because text
  contains surfaces and the dictionary is keyed by headwords.
- `competency-inventory.json` -- what the runtime loads. Built from the
  language-neutral curriculum in `../curriculum/` plus this language's
  `exponents.json`, with every word resolved through `morphology.json`. A
  phrase whose words do not resolve fails the build rather than shipping a
  lemma nobody checked.

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

       pnpm exec tsx scripts/data-prep/build-morphology.ts es
       pnpm exec tsx scripts/data-prep/build-morphology.ts it

   This is total, not incremental -- it discards the old index and rebuilds it
   from the dictionary. So the two cannot drift by hand.
3. **Rebuild any inventory that depends on it.** Constituent lemmas are
   resolved through the morphology index, so a dictionary change can move them.

       pnpm exec tsx scripts/data-prep/build-competency-inventory.ts es

   Also rerun this after editing `../curriculum/*.json` or `exponents.json`.
   `scripts/data-prep/competency-inventory.test.ts` fails if the checked-in
   file is not exactly what a fresh build produces, so a skipped rebuild or a
   hand-edit is caught by the suite rather than at the next regeneration.
4. **Run the tests.** The shipped data is validated against the schemas, and
   `tests/classifier/verb-forms.test.ts` checks the forms themselves: six
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
2. **Author the forms.** Verbs need `forms`. Decide the tense scope for the
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
dictionary and a placement bank but authors no `exponents.json`, so it has no
generated `competency-inventory.json` either and the competency half of
teaching is Spanish-only today.

That absence is deliberate and stays silent at runtime: the loader throws for a
language it has no inventory for, and every caller catches that and carries on
with no competencies, which is the same state as an empty curriculum. Making it
an error would take Italian out of the game entirely to report a gap the game
already handles. It is loud in the only place it can be fixed -- there is no
Italian build script to run, because there is nothing yet for it to read.

## Reference Patterns

- Well-resourced pattern: Spanish, seeded from a CEFR-graded lexicon, with
  hand-authored verb forms.
- Under-resourced pattern: Italian, seeded from a frequency list with
  frequency-derived band backfill, and no forms yet.

Languages likely feasible with the same architecture include French, German,
Swedish, Dutch, and English. Languages intentionally out of scope for v1
include Japanese, Chinese, Korean, and Arabic because the CEFR-aligned data,
and morphology assumptions differ too much from the current
Latin-script pipeline.
