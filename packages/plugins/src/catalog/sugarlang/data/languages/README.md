# Language Data

This directory holds the plugin-shipped language assets for sugarlang: three
languages, one directory each.

**This file is the canonical "adding a language" checklist.** Other docs point
here rather than repeating it.

| | Spanish | Italian | French |
|---|---|---|---|
| Dictionary lemmas | 10,618 | 6,449 | 116 |
| Morphology surfaces | 103,229 | 41,423 | 734 |
| Competencies taught | 635 of 635 | 635 of 635 | 18 of 635 |
| Playable | yes | yes | **no** |

French is a check, not a language -- see `fr/README.md`.

## Runtime and language identity

Runtime code holds no language's grammar. Rules that differ per language live
in `scripts/data-prep/languages/<lang>.ts` and are baked into the data before
the runtime ever sees it.

What the runtime does have is a **registration map** in each of six loaders,
mapping a language code to its statically imported data file:

- `runtime/classifier/morphology-loader.ts`
- `runtime/classifier/english-collisions.ts`
- `runtime/providers/impls/cefr-lex-atlas-provider.ts`
- `runtime/inventory/competency-inventory-loader.ts`
- `runtime/teacher/always-target-words.ts`
- `runtime/placement/placement-questionnaire-loader.ts`

Those maps exist because the data is bundled at build time, not fetched. They
carry no behaviour -- adding a line changes what is loadable, never what is
done with it.

## Files per language

Required to be playable:

- `cefrlex.json` -- the DICTIONARY, one entry per lemma.
- `exponents.json` -- the PHRASES that perform each competency.
- `morphology.json` -- derived: `surface form -> lemma`.
- `competency-inventory.json` -- derived: what the runtime loads.
- `placement-questionnaire.json` -- the arrival form, generated from the
  language's own builder.
- `always-target.json` -- the handful of words spoken in this language at every
  level, however English the rest of the line is.
- `english-collisions.json` -- English words that are also real words here, so
  a learner typing English does not bank credit on a word they never used.
- `README.md` -- provenance for that language.

Italian additionally ships `frequency.json`, from its Kelly import. Spanish
does not have one.

## Three terms

**forms** -- the inflected shapes on a dictionary entry: a verb's conjugations,
a noun's plural, an adjective's gender and number. `forms` is the word for
this. Filling them is what makes a word resolve, and it is the bulk of the
authoring work. Read them through `runtime/classifier/word-forms.ts`, never by
bare index.

**function words** -- lemmas that carry no lexical content of their own:
articles, clitic pronouns, possessive determiners. An exponent does not count
them among the words it teaches. The list is per language and lives in that
language's rules file, because the same spelling can be functional in one
language and meaningful in another -- Italian `su` is a preposition and Spanish
`su` is a possessive. Prepositions are never on the list; they are vocabulary.

**written short forms** -- tokens that are not words and stand for one or more
that are. Three unlike things, one idea:

| | example | |
|---|---|---|
| Italian | `dov'è` -> `dove` `è` | apostrophe |
| Italian | `qual` -> `quale` | shortened, no apostrophe written |
| French | `allez-vous` -> `allez` `vous` | hyphen |

A language declares its own via `expandWrittenForm`. Before this existed the
build shredded `dov'è` into `dov` and `e` -- two fragments no dictionary holds.

## Source versus derived

**SOURCE. Hand-authored, never regenerated wholesale.**

`cefrlex.json`, `exponents.json`, `always-target.json`,
`english-collisions.json`.

There is no importer. Dictionaries were seeded once from a word list and
everything since is authored. Nothing in this repo can overwrite one; see
`scripts/data-prep/DICTIONARY-AUTHORING.md`.

**DERIVED. Regenerated from the sources above, never hand-edited.**

`morphology.json` is the reverse index. The dictionary answers "what is
`hablar`?"; this answers "I found `hablando`, what entry is that?" You need
both, because text contains surfaces and the dictionary is keyed by headwords.

`competency-inventory.json` is what the runtime loads, built from the
language-neutral curriculum plus this language's `exponents.json`.

`placement-questionnaire.json` is generated from the language's
`buildPlacementQuestionnaire()`. Editing the builder changes nothing until the
build re-runs, which the suite pins.

## The authoring loop

Exponents drive the dictionary, not the reverse. Write the phrases you want,
let the build tell you which words it cannot resolve, then fill those in.

1. **Write a lesson's phrases** in `exponents.json`. See
   `scripts/data-prep/EXPONENT-AUTHORING.md`.
2. **Build the inventory.** It fails loudly and names every unresolvable word.

       pnpm exec tsx scripts/data-prep/build-competency-inventory.ts it

3. **Fill the dictionary** with the words it named -- add the entry, or add
   `forms` to an entry that has none. Fill gaps, never overwrite: an entry
   carries `cefrPriorSource` and `formsSource`, and a pass may write only where
   a field is absent or still marked `generated`.
4. **Regenerate morphology**, which is total rather than incremental, so the
   index and the dictionary cannot drift.

       pnpm exec tsx scripts/data-prep/build-morphology.ts it

5. **Rebuild the inventory** and repeat until it is green.
6. **Run the tests.**

       pnpm vitest run scripts/data-prep packages/plugins/src/catalog/sugarlang/tests/data

### Two failure modes, and only one is loud

A word that resolves to **nothing** fails the build by name. That is the easy
one.

A word that resolves to the **wrong lemma** is silent and green. The morphology
index maps a surface to exactly one lemma and a headword outranks another
word's inflected form, so Italian `costa` resolves to the noun "coast" rather
than to `costare`. The phrase then links to a word it does not teach.

The remedy is a `lemmas` override on the wording -- but only where the
resolution is genuinely wrong. A word that does not resolve *at all* needs the
dictionary, not an override. Spanish carries 388 overrides (13% of wordings)
and Italian 28 (1%); the difference is that Italian's dictionary was filled
properly instead.

## What reads this data

Wider than it looks:

- The DICTIONARY is read through `CefrLexAtlasProvider` by the classifier, the
  Teacher, scene compilation and grading.
- MORPHOLOGY is read through `lemmatize()`, and therefore by ambient spans, the
  language-ratio gate in `coverage.ts`, click-to-translate, observation credit
  for words the player types, and proper-noun detection at compile time.

A wrong lemma is worse than a missing one: it produces a confident wrong gloss
on a real word, and writes a card against the wrong headword.

## Adding a language

**Build side** -- one new file and one line:

1. **Write `scripts/data-prep/languages/<lang>.ts`** implementing
   `LanguageRules`: its function words, its written short forms, how its stored
   forms become morphology entries, which tenses are derived rather than stored,
   and its placement bank.
2. **Register it** in `scripts/data-prep/languages/registry.ts`.

If anything outside `languages/` needs editing to make a language build, a rule
belonging to one language is still living in shared code. That is the finding,
and `scripts/data-prep/new-language.test.ts` exists to catch it.

3. **Seed the dictionary.** A CEFR-graded word list is a good start; where none
   exists, derive bands from frequency and say so in `cefrPriorSource`. Seeding
   is one-time -- after it the dictionary is source. French was seeded by hand
   instead, straight from what lesson 1 needed.
4. **Author forms as the build asks for them**, following the loop above.
   Decide the tense scope for the language first: Spanish ships present,
   preterite and imperfect because its A1-B1 future is `ir a` + infinitive.
   Italian differs -- its everyday past is the compound passato prossimo and its
   `futuro semplice` is one word and common. Do not copy Spanish's answer.
5. **Author `always-target.json`**, including `dropsSubjectPronouns`. Spanish
   and Italian leave the subject out of an ordinary sentence; French does not,
   and the flag has no safe default.
6. **Author `english-collisions.json`.**
7. **Write the language README.**

**Runtime side** -- to make it playable, add the language to the map in each of
the six loaders listed above, and to `VALID_TARGET_LANGUAGES`.

## Reference patterns

- **Spanish** -- seeded from a CEFR-graded lexicon (ELELex). Forms are largely
  machine-generated: 9,378 entries are `generated`, 405 `authored`, 835 have
  none.
- **Italian** -- seeded from a frequency list (Kelly) with model-assigned bands
  for the 1,476 lemmas Kelly did not place. Fewer entries carry forms (407),
  but all of them are `authored`, which is why it needs a fourteenth as many
  lemma overrides as Spanish.
- **French** -- 116 lemmas written by hand to cover one lesson. Not playable.

Languages feasible with this architecture include French, German, Swedish,
Dutch and English. Japanese, Chinese, Korean and Arabic are out of scope for
v1: the CEFR-aligned data and the morphology assumptions differ too much from
this Latin-script pipeline.
