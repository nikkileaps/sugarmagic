# Language Data

This directory holds plugin-shipped language assets for sugarlang.

## Directory Schema

- `languages/<lang>/README.md`: provenance, licensing notes, and file inventory for a supported language.
- `languages/<lang>/cefrlex.json`: graded lexical data used by the classifier and budgeter.
- `languages/<lang>/morphology.json`: morphology and lemmatization support data.
- `languages/<lang>/simplifications.json`: deterministic simplification substitutions.
- `languages/<lang>/placement-questionnaire.json`: plugin-owned placement question bank.
- `languages/it/frequency.json` and `languages/it/kelly-subset.json`: Italian-specific source data merged into the eventual atlas.

## Adding A Language

1. Create `languages/<lang>/`.
2. Add a provenance `README.md` for that language.
3. Add the required placeholder data files for the new language.
4. Update this document and the eventual API/docs references when the language is implemented.

Epic 1 keeps every data file as a placeholder only. Epic 4 will populate the real language assets.
