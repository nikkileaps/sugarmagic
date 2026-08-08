# French Data

**This is a check, not a language.** French is not playable and is not meant to
be. It exists to answer a question two languages could not: is every language's
own rule really in that language's own file, or did the shared pipeline only get
cleaned up as far as Italian happened to push it?

The answer is the file list. Adding French created these files plus one line in
`scripts/data-prep/languages/registry.ts`, and touched no shared build code.

## What is here

- `cefrlex.json` -- 116 lemmas, 50 of them with authored forms. Atlas version
  `fr-seed-lesson1`.
- `exponents.json` -- lesson 1 (Social Contact) only: 18 competencies, 49
  cards, 56 wordings.
- `morphology.json` -- 734 surfaces, built from the above.
- `competency-inventory.json` -- generated; the 18 lesson-1 competencies are
  taught, the remaining 617 in the curriculum are not.
- `placement-questionnaire.json` -- generated; 10 questions, written from the
  same seed vocabulary so every word in it resolves.
- `always-target.json` -- the only shipped list with
  `dropsSubjectPronouns: false`. French writes `je parle`, never `parle`.

## Provenance

**Hand-authored, not imported.** Spanish and Italian come from Kelly corpus
lists; there is no French import and there is no script to re-run for
`cefrlex.json` or `exponents.json` -- those two files are the source. Every
lemma carries `cefrPriorSource: "human-override"` for that reason, and the
frequency ranks are estimates written to order the list plausibly, not measured
counts.

The dictionary was written the way `scripts/data-prep/EXPONENT-AUTHORING.md`
describes: the exponents came first, the build named the words that did not
resolve, and those words got entries.

## Re-run

From the repo root, after editing `cefrlex.json` or `exponents.json`:

- `pnpm exec tsx scripts/data-prep/build-morphology.ts fr`
- `pnpm exec tsx scripts/data-prep/build-competency-inventory.ts fr`
- `pnpm exec tsx scripts/data-prep/build-placement-questionnaires.ts`

## If French ever becomes real

Three things here are sized for a dry run and would need replacing:

- The dictionary is 116 hand-written lemmas. A real one is a corpus import.
- `addFrenchMorphologyForms` has no guessing fallback, because every lemma here
  was written on purpose. A corpus import would need one, the way Italian has.
- Nothing registers `fr` for play. That is a separate set of per-language maps
  in the runtime loaders, listed under "Adding a language" in `../README.md`.
