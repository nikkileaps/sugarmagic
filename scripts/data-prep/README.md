# Sugarlang Data Prep

This directory holds the offline regeneration scripts for the checked-in
sugarlang language-data snapshots.

These scripts are tooling, not runtime logic. The runtime only consumes the JSON
and YAML files checked into
`packages/plugins/src/catalog/sugarlang/data/languages/`.

## Current Workflow

- Spanish atlas snapshot: `import-elelex.ts`
- Spanish morphology snapshot: `build-spanish-morphology.ts`
- Spanish simplifications snapshot: `build-simplifications-es.ts`
- Italian frequency snapshot: `derive-italian-frequency.ts`
- Italian merged atlas snapshot: `build-italian-cefrlex.ts`
- Italian morphology snapshot: `build-italian-morphology.ts`
- Italian simplifications snapshot: `build-italian-simplifications.ts`
- Italian review queue: `claude-classify-italian-lemmas.ts`
- Shared placement banks: `build-placement-questionnaires.ts`

## Re-Run

Run these from the repo root with `pnpm exec tsx <script-path>`.

The shared helpers live in `sugarlang-language-data.ts`, which is the single
source-backed import and transform layer for the current checked-in snapshots.
