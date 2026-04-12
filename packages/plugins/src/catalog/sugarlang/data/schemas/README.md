# Language Data Schemas

This directory holds the JSON Schema files for sugarlang's plugin-shipped data.

Epic 4 owns the language-data schemas:

- `cefrlex.schema.json`
- `morphology.schema.json`
- `simplifications.schema.json`
- `placement-questionnaire.schema.json`
- `frequency.schema.json`
- `kelly-subset.schema.json`

Later epics own runtime-persistence or compile-artifact schemas:

- `learner-profile.schema.json`: Epic 7
- `scene-lexicon.schema.json`: Epic 6

Validation workflow:

1. Load a schema with a Draft 2020-12 validator such as `ajv/dist/2020`.
2. Compile the schema.
3. Validate the target JSON payload.
4. Fail fast on any error; do not silently coerce bad language data.

The canonical automated check for Epic 4 lives in:

- `packages/plugins/src/catalog/sugarlang/tests/data/language-data-validation.test.ts`

The checked-in data-prep scripts that regenerate the current snapshots live in:

- `scripts/data-prep/`
