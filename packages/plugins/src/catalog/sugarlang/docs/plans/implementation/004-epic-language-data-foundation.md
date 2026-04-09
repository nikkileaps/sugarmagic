# Epic 4: Language Data Foundation

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Multi-Language Handling](../../proposals/001-adaptive-language-learning-architecture.md#multi-language-handling)
**Depends on:** Epic 1 (skeleton with `data/languages/` placeholders)
**Blocks:** Epic 5 (Classifier uses morphology + CEFRLex lookup), Epic 6 (Compiler uses atlas), Epic 8 (Budgeter uses priors), Epic 9 (Director uses rubric), Epic 11 (Placement uses question banks)

## Context

The Proposal 001 architecture is language-parameterized: every language is a data directory under `data/languages/<lang>/` with exactly four data files — `cefrlex.json`, `morphology.json`, `simplifications.json`, and `placement-questionnaire.json`. The runtime code never branches on language identity; adding a language is adding a directory.

This epic populates the **Spanish (`es`)** and **Italian (`it`)** data directories with real content. Spanish is well-resourced (ELELex). Italian is under-resourced and requires a derived-frequency pipeline using OpenSubtitles + Wikipedia + Kelly project + optional compile-time Claude batch classification. Both languages must ship with all four files and pass schema validation before any downstream epic can start consuming them.

This epic is largely **offline data preparation work**. The compile scripts run once (or occasionally, when upstream data updates), and their outputs are checked into the repo. The runtime only reads the final JSON files.

## Prerequisites

- Epic 1 complete and QA-signed-off
- Epic 3 (Contracts and Types) should be in progress or complete so the schema files can be validated against the TypeScript types. If Epic 3 is running in parallel, the schema files can be drafted first and the type alignment check deferred to the end of this epic.

## Success Criteria

- `data/languages/es/` has populated `cefrlex.json`, `morphology.json`, `simplifications.json`, `placement-questionnaire.json`
- `data/languages/it/` has populated `frequency.json`, `kelly-subset.json`, `cefrlex.json` (merged view), `morphology.json`, `simplifications.json`, `placement-questionnaire.json`
- JSON schemas at `data/schemas/` validate every shipped data file
- A one-time data-prep script in `scripts/data-prep/` produces the derived files from upstream sources (checked in so it can be re-run)
- All upstream licenses are documented in `data/languages/<lang>/README.md`
- Runtime loaders (one per data file type) exist with unit tests
- API documentation describes each data file format and the workflow for adding a new language

## Stories

### Story 4.1: Write JSON schemas for all four data files

**Purpose:** Codify the shape of every language data file as a JSON Schema before populating any real data. Schema-first prevents accidental drift between the data and the runtime types.

**Tasks:**

1. `data/schemas/cefrlex.schema.json` — object keyed by lemma id, values are AtlasLemmaEntry-shaped objects with CEFR band, frequency rank, parts of speech, gloss, optional `cefrPriorSource: "cefrlex" | "frequency-derived" | "claude-classified" | "human-override"`
2. `data/schemas/morphology.schema.json` — trie-like structure mapping surface forms to lemma ids; allow for per-form part-of-speech hints
3. `data/schemas/simplifications.schema.json` — object keyed by "higher-band" lemma id, values are arrays of lower-band substitution lemma ids with optional context tags
4. `data/schemas/placement-questionnaire.schema.json` — the top-level `PlacementQuestionnaire` shape from Epic 3 Story 3.7b: `schemaVersion`, `lang`, `targetLanguage`, `supportLanguage`, `formTitle`, `formIntro`, `questions` (discriminated union over multiple-choice, free-text, yes/no, fill-in-blank kinds via JSON Schema `oneOf`), `minAnswersForValid`. Each question kind has its own sub-schema.
5. Add a `data/schemas/README.md` explaining what each schema covers and how to validate against it using the workspace's preferred JSON Schema validator

**Tests Required:**

- Validation test: each schema is itself valid JSON Schema (draft 2020-12)
- Validation test: a hand-crafted minimal valid example of each file type validates against its schema
- Validation test: a hand-crafted invalid example of each file type fails validation

**API Documentation Update:**

- `docs/api/README.md`: add "Language data files" section pointing to the schemas
- Populate the corresponding sections of `docs/api/classifier.md`, `docs/api/budgeter.md`, `docs/api/director.md`, and `docs/api/placement-contract.md` with the file formats they consume

**Acceptance Criteria:**

- All four schemas exist and validate themselves
- Example validation tests pass
- Schemas are aligned with the TypeScript types from Epic 3 (or flagged for alignment if Epic 3 is in progress)

### Story 4.2: Populate Spanish (`es`) data directory

**Purpose:** Import ELELex, derive the morphology index, build the simplifications dictionary, and populate the placement questions (with generic voice; character-specific voice is Epic 11's work).

**Tasks:**

1. **ELELex import:** Download ELELex from the official source (cite the URL in the README), transform it to the `cefrlex.schema.json` shape, and write to `data/languages/es/cefrlex.json`. Include only lemma-level entries (not inflections) and cap to the top ~11,000 entries. Use a one-time script at `scripts/data-prep/import-elelex.ts`.
2. **License documentation:** Update `data/languages/es/README.md` with:
   - Source URL
   - License terms and citation requirements
   - Date of import
   - Script path (`scripts/data-prep/import-elelex.ts`)
   - Re-run instructions
3. **Morphology index:** Generate `data/languages/es/morphology.json` as a trie of surface-form → lemma-id mappings. Use a Spanish inflection generator (e.g., a Python `spaCy es_core_news_md` pipeline in a one-time script, OR a JavaScript library like `lemmatizer-es`). Target coverage of at least all inflections of the top 5,000 lemmas.
4. **Simplifications dictionary:** Generate `data/languages/es/simplifications.json` by joining ELELex with WordNet (Spanish WordNet / MCR) alignments: for each B1+ lemma, find a synonym at A2 or below. Where no synonym exists, include the English gloss as a fallback tagged with `"kind": "gloss-fallback"`. Script at `scripts/data-prep/build-simplifications-es.ts`.
5. **Placement questionnaire (plugin-owned, canonical per language):** Author one canonical `placement-questionnaire.json` for Spanish conforming to the `PlacementQuestionnaire` type from Epic 3 Story 3.7b. Target ~10–15 questions spanning A1 through B2, mixing multiple-choice, free-text, yes/no, and fill-in-the-blank kinds. Per Proposal 001 § Cold Start Sequence, this is **plugin data, not per-project authored content** — every project that uses sugarlang inherits this canonical bank. The questions are diegetically framed as arrival-form questions an immigration/customs officer would ask ("What's your name?", "Where are you from?", "How long will you stay?", "Do you speak any Spanish?", "Write one sentence about why you're here.", etc.). This is content authoring work and should be done by a native-speaker reviewer, not generated by an LLM. Schema file: `placement-questionnaire.schema.json` (Epic 4 Story 4.1).
6. Validate all four files against their schemas.

**Tests Required:**

- Schema validation: each of the four files validates
- Loader test: `CefrLexAtlasProvider.load("es")` reads `cefrlex.json` and returns a populated atlas (runs against the real file in a test fixture mode)
- Content smoke test: the atlas contains at least 500 A1 lemmas, 500 A2 lemmas, etc. Sanity check on distribution
- Morphology smoke test: `lemmatize("corriendo", "es")` returns `"correr"` (catches obvious breakage in the morphology data)
- Simplifications smoke test: at least 80% of B1+ lemmas have a lower-band substitution (otherwise the fallback rate will be too high)

**API Documentation Update:**

- `data/languages/es/README.md`: full provenance, license, re-run instructions, coverage statistics
- `docs/api/classifier.md`: Spanish morphology coverage statistics
- `docs/api/scene-lexicon-compilation.md`: note that Spanish uses ELELex as the atlas source

**Acceptance Criteria:**

- All four Spanish data files exist and validate
- Smoke tests pass with real data
- License and provenance documented

### Story 4.3: Populate Italian (`it`) data directory — derived-frequency pipeline

**Purpose:** Build the Italian data files from the under-resourced strategy described in Proposal 001: OpenSubtitles-it + Wikipedia-it frequency, merged with Kelly project, with quantile-based CEFR band assignment and optional Claude-batch classification for ambiguous cases.

**Tasks:**

1. **Frequency derivation script:** Write `scripts/data-prep/derive-italian-frequency.ts` that:
   - Downloads OpenSubtitles-it corpus from OPUS (cite URL, document size)
   - Downloads Wikipedia-it dump (cite URL, use a recent snapshot)
   - Tokenizes and lemmatizes each corpus using a Python `spaCy it_core_news_md` sidecar or equivalent
   - Computes lemma frequency ranks across the combined corpus
   - Writes `data/languages/it/frequency.json`
2. **Kelly project import:** Download the Kelly Italian wordlist (~6,000 lemmas with rough CEFR bands) and write `data/languages/it/kelly-subset.json`. Document the source URL and license in the README.
3. **Merge script:** Write `scripts/data-prep/build-italian-cefrlex.ts` that:
   - Takes `frequency.json` + `kelly-subset.json` as inputs
   - For lemmas in Kelly: use Kelly's CEFR band directly, tag `cefrPriorSource: "kelly"`
   - For lemmas not in Kelly: assign CEFR band by frequency quantile (top-1000 → A1, 1000–2000 → A2, 2000–4000 → B1, 4000–8000 → B2, 8000+ → C1), tag `cefrPriorSource: "frequency-derived"`
   - For lemmas straddling a quantile boundary: queue for optional Claude batch classification
   - Writes `data/languages/it/cefrlex.json` as the merged view the runtime actually consumes
4. **Claude batch classification (optional):** Write `scripts/data-prep/claude-classify-italian-lemmas.ts` that:
   - Reads the straddling-boundary queue from step 3
   - Batches ~100 lemmas per Claude call: "Classify this Italian lemma at CEFR level, respond with the level only."
   - Writes results back to `cefrlex.json` tagged `cefrPriorSource: "claude-classified"`
   - Caches results by lemma so re-runs are cheap
5. **Review queue:** Generate `data/languages/it/review-queue.yaml` listing the lowest-confidence CEFR assignments (e.g. those where Kelly disagrees with frequency quantile, or where Claude returned a different band than quantile) for optional human override
6. **Morphology:** Build `data/languages/it/morphology.json` using spaCy Italian or equivalent. Same coverage target as Spanish: top 5,000 lemmas and their inflections.
7. **Simplifications:** Build `data/languages/it/simplifications.json`. Coverage may be thinner than Spanish because of the fewer resources; accept whatever the script produces and document the coverage in the README.
8. **Placement questionnaire (plugin-owned, canonical for Italian):** Author one canonical `placement-questionnaire.json` for Italian per the `PlacementQuestionnaire` type (Epic 3 Story 3.7b), mirroring the Spanish structure from Story 4.2 step 5. ~10–15 questions, mixed kinds, arrival-form diegetic framing. Per Proposal 001 § Cold Start Sequence, this is plugin data, not per-project content. Author with a native-speaker reviewer.
9. **Update `data/languages/it/README.md`** with full provenance (OpenSubtitles source, Wikipedia snapshot date, Kelly source, Claude batch run date, coverage statistics, re-run instructions).

**Tests Required:**

- Schema validation: all six Italian data files validate
- Loader test: `CefrLexAtlasProvider.load("it")` works and returns a populated atlas
- Content smoke test: at least 200 A1 lemmas, 200 A2 lemmas, etc. — Italian coverage is intentionally lower than Spanish
- Morphology smoke test: `lemmatize("correndo", "it")` returns `"correre"`
- Provenance source test: every lemma in `cefrlex.json` has a `cefrPriorSource` field (so we can audit data quality later)

**API Documentation Update:**

- `data/languages/it/README.md`: full provenance documentation
- `docs/api/classifier.md`: note the Italian atlas is derived-frequency and document the lower confidence compared to Spanish
- `docs/api/scene-lexicon-compilation.md`: note the Italian coverage gap

**Acceptance Criteria:**

- Italian data directory is populated and validates
- Derivation scripts are checked in and rerunnable
- Coverage gap vs. Spanish is honest and documented
- `cefrPriorSource` tagging is complete across every lemma

### Story 4.4: Implement runtime data loaders

**Purpose:** Write the runtime code that loads each language data file at startup and exposes it through the provider interfaces from Epic 3.

**Tasks:**

1. `runtime/providers/impls/cefr-lex-atlas-provider.ts` — implements `LexicalAtlasProvider` per Epic 3. Loads `cefrlex.json` lazily on first lookup, caches in memory, provides `getLemma`, `getBand`, `getFrequencyRank`, `listLemmasAtBand`, `getAtlasVersion`.
2. `runtime/classifier/morphology-loader.ts` — loads `morphology.json`, builds an in-memory trie, exposes a `lemmatize(surfaceForm, lang)` function. (Actual `lemmatize.ts` in Epic 5 wraps this.)
3. `runtime/classifier/simplifications-loader.ts` — loads `simplifications.json`, exposes `getSimplification(lemmaId, lang)` returning the first available lower-band substitution or a gloss fallback.
4. `runtime/placement/placement-questionnaire-loader.ts` — loads `placement-questionnaire.json` as a `PlacementQuestionnaire` object, exposes `getQuestionnaire(lang): PlacementQuestionnaire`. Note: this module lives under `runtime/placement/` not `runtime/director/` because placement is no longer a Director-driven flow per Proposal 001 § Cold Start Sequence — it's a plugin-owned questionnaire with its own scoring engine.
5. All loaders fail-fast if the data file is missing or invalid — throw at startup, don't silently fall back to an empty atlas.
6. Add atlas version tracking: `cefrlex.json` carries a top-level `atlasVersion: string` field (e.g., `"es-elelex-1.0"` or `"it-derived-2026-04"`) that the compile cache uses to invalidate when data changes.

**Tests Required:**

- Unit test per loader: loads a fixture data file and returns expected values
- Unit test: missing file throws at load time, not silently
- Unit test: atlas version is surfaced correctly
- Integration test: `CefrLexAtlasProvider` loads both `es` and `it` data in parallel without collision

**API Documentation Update:**

- `docs/api/providers.md`: document `CefrLexAtlasProvider` implementation details, atlas version semantics, fail-fast behavior
- `docs/api/classifier.md`: document morphology loader
- `docs/api/placement-contract.md`: document placement bank loader

**Acceptance Criteria:**

- All loaders work against real Spanish and Italian data
- Fail-fast discipline enforced
- Atlas version flows through to the compile cache key

### Story 4.5: Write the "Adding a new language" walkthrough

**Purpose:** Document the end-to-end process for adding a new language so future contributors (or future-you) can do it without re-deriving the workflow.

**Tasks:**

1. Update `data/languages/README.md` with:
   - The four required data files per language
   - Schema file references
   - Step-by-step workflow: 1) obtain upstream CEFR data or build derived frequency, 2) write morphology, 3) build simplifications, 4) author placement questions, 5) validate against schemas, 6) run smoke tests
   - Examples of well-resourced languages (ES via ELELex) vs. under-resourced (IT via derived-frequency)
   - Languages known to be feasible (FR via FLELex, DE via DAFlex, SV via SVALex, NL, EN via EFLLex)
   - Languages known to be out-of-scope for v1 (JA, ZH, KO, AR due to different CEFR-equivalent systems and morphology)

**Tests Required:** none (documentation only)

**API Documentation Update:**

- `data/languages/README.md` as above
- `docs/api/README.md`: add pointer to the adding-a-language walkthrough

**Acceptance Criteria:**

- A reader unfamiliar with the system can follow the walkthrough to add a new language

## Risks and Open Questions

- **Upstream data licensing.** ELELex is research-permissive, Kelly project is free, OpenSubtitles/OPUS is permissive. Verify each license before checkin and include terms in the README. If any license requires attribution at runtime (unlikely but possible), the plugin must surface it.
- **Morphology library choice.** Spanish and Italian morphology can be generated via spaCy (Python), Stanza, or pure-JS lemmatizer libraries. Python sidecar at build time is fine (scripts live in `scripts/data-prep/` and run offline), but the runtime must not depend on Python. Confirm the runtime loader uses pure-JS trie lookup.
- **Compile script dependencies.** The `scripts/data-prep/` directory might need Python + pip packages for spaCy. This pulls in a build-time Python dependency. Alternatives: (a) use pure-JS libraries if acceptable coverage exists, (b) pre-commit the generated output and only run Python locally when data updates. Prefer (b) — don't force every dev to install spaCy.
- **Placement questions as code or content.** For v1, generic-voice placement questions ship as plugin data. Character-voiced questions (Orrin Lark's lines) are content owned by the project per Plan 001-Wordlark-Hollow. The split is: generic questions are the *fallback*, character-voiced questions *override* them when provided. Document the precedence rule.
- **Italian quality ceiling.** Derived-frequency CEFR assignment correlates with human judgment at ~0.78 per research. That's "good enough for placement" but not equivalent to hand-curated. Expect some noticeable rough edges; the `cefrPriorSource` tagging and `review-queue.yaml` are the release valves for fixing them post-launch.

## Exit Criteria

Epic 4 is complete when:

1. All five stories are complete
2. Spanish and Italian data directories are fully populated and schema-validated
3. Data preparation scripts are checked in and rerunnable
4. Runtime loaders are implemented and unit-tested
5. License and provenance documentation is complete
6. The "adding a new language" walkthrough is written
7. `tsc --noEmit` passes
8. This file's `Status:` is updated to `Complete`
