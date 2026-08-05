# Language Data Schemas

This directory holds the JSON Schema files for sugarlang's plugin-shipped data.

Per-language data:

- `cefrlex.schema.json` -- the dictionary.
- `morphology.schema.json` -- the surface-to-lemma index. Generated.
- `placement-questionnaire.schema.json`
- `frequency.schema.json`

The curriculum, which is language-neutral, and the inventory it produces:

- `curriculum-band.schema.json` -- one CEFR band: its lessons and competencies.
- `competency-inventory.schema.json` -- what the runtime loads for one
  language. Generated from a curriculum band plus that language's exponents.

Runtime-persistence and compile-artifact schemas:

- `learner-profile.schema.json`
- `scene-lexicon.schema.json`

Validation workflow:

1. Load a schema with a Draft 2020-12 validator such as `ajv/dist/2020`.
2. Compile the schema.
3. Validate the target JSON payload.
4. Fail fast on any error; do not silently coerce bad language data.

The automated checks live in:

- `tests/data/language-data-foundation.test.ts` -- dictionaries, morphology,
  frequency and placement banks for every shipped language.
- `tests/data/competency-inventory.test.ts` -- the competency inventory, which
  is validated on its own because it is a generated file and the check is
  stricter (`strict: true`).
- `tests/data/curriculum.test.ts` -- the language-neutral curriculum bands.

The checked-in data-prep scripts that regenerate the current snapshots live in:

- `scripts/data-prep/`
