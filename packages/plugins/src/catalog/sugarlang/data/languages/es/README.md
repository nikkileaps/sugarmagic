# Spanish Data

This directory holds the checked-in Spanish language data snapshot for
sugarlang.

## Provenance Status

The current checked-in files are rebuilt from the real ELELex Spanish source via
the scripts in `scripts/data-prep/`. The morphology and simplification files are
derived from that imported atlas and are checked in as canonical plugin data.

## Source Families

- ELELex reference project: <https://cental.uclouvain.be/cefrlex/elelex/download/>
- Placement questionnaire ownership: plugin data under `placement-questionnaire.json`

## Files

- `cefrlex.json`
  - Atlas version: `es-elelex-2026-04-09`
  - Source: ELELex TSV import, deduplicated to single-token lemmas
  - Band distribution: A1 3,217, A2 2,685, B1 1,916, B2 1,437, C1 1,745, C2 0
  - Total lemmas: 11,000
- `morphology.json`
  - Surface-form entries: 29,284
  - Includes smoke-test forms such as `corriendo -> correr`
- `simplifications.json`
  - Higher-band entries covered: 5,098
  - Current build strategy: lower-band substitutions chosen from the imported atlas by part of speech and rank
  - Current B1+ substitution coverage: 100%
- `placement-questionnaire.json`
  - Mixed-kind canonical bank with 10 questions and `minAnswersForValid = 6`

## Licensing Notes

The checked-in atlas is rebuilt from the public ELELex source. Keep the ELELex
citation and license requirements in this file and rerun the schema/tests after
every refresh.

## Re-Run

From the repo root:

- `pnpm exec tsx scripts/data-prep/import-elelex.ts`
- `pnpm exec tsx scripts/data-prep/build-spanish-morphology.ts`
- `pnpm exec tsx scripts/data-prep/build-simplifications-es.ts`
- `pnpm exec tsx scripts/data-prep/build-placement-questionnaires.ts`
