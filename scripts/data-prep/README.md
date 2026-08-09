# Sugarlang Data Prep

Offline scripts that regenerate the checked-in language data in
`packages/plugins/src/catalog/sugarlang/data/languages/`. Tooling, not runtime
logic -- the runtime only ever reads the generated JSON.

## Layout

    languages/language-rules.ts   what a language must supply
    languages/<lang>.ts           one language's rules -- es, it, fr
    languages/registry.ts         code -> rules; adding a language is a line here
    competency-inventory.ts       the shared build, language-neutral
    sugarlang-language-data.ts    shared primitives and file IO

A rule that names a word, an ending, an accent or a tense belongs in
`languages/<lang>.ts`. Shared code holds only what is true of every language.

## Scripts

    build-morphology.ts <lang>              dictionary -> surface-form index
    build-competency-inventory.ts <lang>    curriculum + exponents -> inventory
    build-placement-questionnaires.ts       every registered language's bank
    derive-italian-frequency.ts             one-off: Kelly ranks -> it/frequency.json

Run from the repo root with `pnpm exec tsx <script-path>`.

## There is no atlas importer

Nothing here builds `cefrlex.json`, for any language. The dictionaries were
seeded once -- Spanish from ELELex, Italian from Kelly, French by hand -- and
have been source files ever since. That is deliberate: an importer that could
overwrite them would destroy authored forms and corrections, and the entry
provenance (`cefrPriorSource`, `formsSource`) exists to make overwriting
detectable rather than routine.

No script named `import-elelex.ts` or `build-italian-cefrlex.ts` exists here.
Both are cited by older documents and commit messages; neither was ever
written.

To change a dictionary, edit `cefrlex.json` and regenerate morphology. See
`DICTIONARY-AUTHORING.md`.

## Where to start

- Writing phrases for a lesson: `EXPONENT-AUTHORING.md`
- Adding or correcting dictionary entries: `DICTIONARY-AUTHORING.md`
- Adding a whole language: `../../packages/plugins/src/catalog/sugarlang/data/languages/README.md`
