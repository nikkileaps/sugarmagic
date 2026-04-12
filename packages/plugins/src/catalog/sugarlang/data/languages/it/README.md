# Italian Data

This directory holds the checked-in Italian language data snapshot for
sugarlang.

## Provenance Status

The current checked-in files are rebuilt from the real Italian Kelly list via
the scripts in `scripts/data-prep/`. The checked-in frequency file preserves the
Kelly ordering as a monotonic frequency proxy, while the atlas merges explicit
Kelly CEFR assignments with quantile-derived bands for entries whose Kelly row
does not provide a CEFR point.

## Source Families

- Kelly project reference: <https://spraakbanken.gu.se/projekt/kelly>
- Kelly multilingual Italian download: <https://ssharoff.github.io/kelly/it_m3.xls>

## Files

- `frequency.json`
  - Generated snapshot date: `2026-04-09`
  - Source: Italian Kelly rank order
  - Current representation: monotonic frequency proxy derived from the published Kelly ordering
  - Total ranked lemmas: 6,370
- `kelly-subset.json`
  - Source version tag: `it-kelly-2014`
  - Seed lemmas carried through to the merged atlas
- `cefrlex.json`
  - Atlas version: `it-kelly-2026-04-09`
  - Band distribution: A1 953, A2 982, B1 958, B2 2,024, C1 1,323, C2 130
  - Every lemma carries `cefrPriorSource`
- `morphology.json`
  - Surface-form entries: 12,943
  - Includes smoke-test forms such as `correndo -> correre`
- `simplifications.json`
  - Higher-band entries covered: 4,435
  - Current build strategy: lower-band substitutions chosen from the imported atlas by part of speech and rank
  - Current substitution coverage: 100%
- `placement-questionnaire.json`
  - Mixed-kind canonical bank with 10 questions and `minAnswersForValid = 6`
- `review-queue.yaml`
  - Human-review queue for low-confidence derived assignments

## Confidence Notes

Italian remains the lower-confidence atlas relative to Spanish. The shipped
snapshot keeps `cefrPriorSource` on every lemma and preserves a review queue so
human overrides can replace low-confidence derived assignments later without
changing the runtime contract.

## Re-Run

From the repo root:

- `pnpm exec tsx scripts/data-prep/derive-italian-frequency.ts`
- `pnpm exec tsx scripts/data-prep/build-italian-cefrlex.ts`
- `pnpm exec tsx scripts/data-prep/build-italian-morphology.ts`
- `pnpm exec tsx scripts/data-prep/build-italian-simplifications.ts`
- `pnpm exec tsx scripts/data-prep/build-placement-questionnaires.ts`
- `pnpm exec tsx scripts/data-prep/claude-classify-italian-lemmas.ts`
