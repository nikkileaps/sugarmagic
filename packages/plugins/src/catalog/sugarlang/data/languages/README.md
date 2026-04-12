# Language Data

This directory holds plugin-shipped language assets for sugarlang. Runtime code
never branches on language identity; adding a supported language means adding
one new `languages/<lang>/` directory that satisfies the shared schemas.

## Required Files Per Language

- `languages/<lang>/README.md`: provenance, licensing notes, rerun instructions, and coverage notes.
- `languages/<lang>/cefrlex.json`: lexical atlas consumed by the classifier, budgeter, compiler, and provider layer.
- `languages/<lang>/morphology.json`: surface-form lookup data consumed by lemmatization.
- `languages/<lang>/simplifications.json`: deterministic lower-band substitutions or gloss fallbacks.
- `languages/<lang>/placement-questionnaire.json`: plugin-owned canonical placement question bank.

Some under-resourced languages also carry auxiliary prep artifacts. Italian
currently ships:

- `languages/it/frequency.json`
- `languages/it/kelly-subset.json`
- `languages/it/review-queue.yaml`

## Schema References

- `../schemas/cefrlex.schema.json`
- `../schemas/morphology.schema.json`
- `../schemas/simplifications.schema.json`
- `../schemas/placement-questionnaire.schema.json`
- `../schemas/frequency.schema.json`
- `../schemas/kelly-subset.schema.json`

## Adding A Language

1. Obtain an atlas source.
   Use a CEFR-graded lexicon when one exists. If not, derive a frequency-backed atlas and document the confidence limits honestly.
2. Generate morphology.
   Build a runtime-owned surface-form index that covers the shipped lemma set and key inflections.
3. Build simplifications.
   For higher-band lemmas, ship deterministic lower-band substitutions or a tagged gloss fallback.
4. Author placement questions.
   Placement banks are plugin-owned v1 data, not per-project content.
5. Validate against the schemas.
   Every shipped JSON file must pass the JSON Schema tests before merge.
6. Run the smoke tests.
   Loader reachability, lemmatization spot checks, and atlas distribution tests are the minimum bar.
7. Update the provenance README and API docs.
   The language README is the single source of truth for where the data came from and how to rerun it.

## Reference Patterns

- Well-resourced pattern: Spanish via direct ELELex atlas import.
- Under-resourced pattern: Italian via Kelly source import plus frequency-derived backfill and review queue.

Languages likely feasible with the same architecture include French, German,
Swedish, Dutch, and English. Languages intentionally out of scope for v1
include Japanese, Chinese, Korean, and Arabic because the CEFR-aligned data,
morphology, and simplification assumptions differ too much from the current
Latin-script pipeline.
