# Epic 5: Envelope Classifier

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Envelope Classifier](../../proposals/001-adaptive-language-learning-architecture.md#2-envelope-classifier)
**Depends on:** Epic 1 (skeleton), Epic 3 (types), Epic 4 (CEFRLex + morphology data)
**Blocks:** Epic 10 (middleware uses classifier in the verify stage)

## Context

The Envelope Classifier is the **deterministic** component that answers the question: *is this generated line within the learner's comprehension envelope right now?* It runs every turn, on every generated NPC reply, in under ~5ms. Its verdict is byte-identical across runs given the same inputs — no LLM, no stochasticity. The classifier is the safety net that makes the Proposal 001 architecture safe: no matter what the Director, the Generator, or the retry loop produce, the classifier is the last check that says *this line never exceeds the learner's envelope*.

Because it's fully deterministic, the classifier is also the **easiest component to unit-test**. Unit tests with frozen fixtures catch regressions the moment they land. It should be the first real component we build — both because nothing downstream can trust the pipeline without it, and because it's confidence-building to have one thoroughly-tested piece landing before the LLM-heavy epics start.

This epic is pure algorithm + data work. No LLM calls, no plugin registration, no middleware integration. That comes in Epic 10.

## Prerequisites

- Epic 1 (skeleton with classifier file stubs)
- Epic 3 (`EnvelopeVerdict`, `CoverageProfile`, `LemmaRef`, `CEFRBand` types)
- Epic 4 (CEFRLex data for ES and IT, morphology indexes, `CefrLexAtlasProvider` implemented)

## Success Criteria

- `EnvelopeClassifier.check(text, learner)` returns a deterministic `EnvelopeVerdict`
- Performance: ≤5ms p95 on a typical 50-80 token NPC reply
- Handles named entities and proper nouns without counting them as vocabulary
- Implements the Krashen 95%-coverage + i+1-ceiling envelope rule exactly as specified in Proposal 001
- Auto-simplify fallback works for out-of-envelope text
- Comprehensive unit tests with frozen fixtures
- API documentation for every exported function

## Stories

### Story 5.1: Implement `tokenize.ts`

**Purpose:** Language-aware tokenizer using `Intl.Segmenter`. Splits a string into word-level tokens, strips punctuation, preserves token positions for later error reporting.

**Tasks:**

1. Implement `tokenize(text: string, lang: string): Token[]` where `Token = { surface: string; start: number; end: number; kind: "word" | "punct" | "number" | "whitespace" }`
2. Use `Intl.Segmenter(lang, { granularity: "word" })` which is built into modern JS runtimes
3. Strip punctuation and whitespace tokens from the output (return only `"word"` and `"number"` kinds)
4. Lowercase all word tokens for lemmatization (the lemmatizer handles case-sensitive cases for proper nouns via the NER allowlist, not the tokenizer)

**Tests Required:**

- Fixture test: `tokenize("Hola, ¿cómo estás?", "es")` returns `[hola, cómo, estás]` with correct start/end positions
- Fixture test: `tokenize("Mi chiamo Sam.", "it")` returns `[mi, chiamo, sam]`
- Fixture test: numbers are preserved as `"number"` kind (e.g. "I have 3 cats" includes "3")
- Edge case test: empty string returns empty array
- Edge case test: string with only punctuation returns empty array
- Performance test: tokenizing a 500-token string completes in <2ms

**API Documentation Update:**

- `docs/api/classifier.md`: document the `Token` type, the `tokenize` function, and why we use `Intl.Segmenter` (no external dependency, built-in language awareness)

**Acceptance Criteria:**

- All tokenization unit tests pass
- Tokenizer handles both Spanish and Italian correctly

### Story 5.2: Implement `lemmatize.ts`

**Purpose:** Reduce a surface form to its lemma via trie lookup in the morphology index (loaded by Epic 4's loader).

**Tasks:**

1. Implement `lemmatize(token: Token, lang: string): LemmaRef | null`
2. Use the morphology trie from `data/languages/<lang>/morphology.json` loaded by `morphology-loader.ts` (Epic 4)
3. Return `null` when the surface form is unknown — the caller decides how to classify unknowns (see coverage computation)
4. Handle case: morphology is stored lowercase; `lemmatize` lowercases input before lookup, preserving the original surface form in the returned `LemmaRef.surfaceForm`

**Tests Required:**

- Fixture test: `lemmatize({surface: "corriendo"}, "es")` returns `{lemmaId: "correr", surfaceForm: "corriendo", lang: "es"}`
- Fixture test: `lemmatize({surface: "parlato"}, "it")` returns `{lemmaId: "parlare", ...}`
- Fixture test: `lemmatize({surface: "asdfzxcv"}, "es")` returns `null`
- Edge case test: uppercase surface form still finds the lemma (`"Correr"` → `"correr"`)
- Edge case test: accents are preserved (`"está"` → lemma for the Spanish verb "estar")

**API Documentation Update:**

- `docs/api/classifier.md`: document the lemmatizer contract and the trie-lookup data flow

**Acceptance Criteria:**

- Lemmatization unit tests pass
- Unknown surface forms return `null` (never throw, never silently invent a lemma)

### Story 5.3: Implement `coverage.ts`

**Purpose:** Build the `CoverageProfile` from a tokenized+lemmatized text, a learner, and an atlas.

> **Extension point for Epic 14 (Lexical Chunk Awareness):** The coverage computation built in this story is the *lemma-only* layer. Epic 14 Story 14.5 extends the same function with a chunk-scan pre-pass that matches multi-word idiomatic sequences against `sceneLexicon.chunks` before lemmatization, treating matched chunks as virtual tokens with their own CEFR band. Epic 5's implementation stays correct on its own — when `sceneLexicon.chunks` is absent or empty, the chunk-scan pass is a no-op and the classifier behaves identically to this story's output. Design this story's code with that extension in mind: keep the tokenize→lemmatize→coverage pipeline as discrete steps so Epic 14 can insert a pre-step cleanly without refactoring.

**Tasks:**

1. Implement `computeCoverage(tokens: Token[], learner: LearnerProfile, atlas: LexicalAtlasProvider, knownEntities: Set<string>): CoverageProfile`
2. For each token:
   - If it's a number or known entity (by lowercase surface match against `knownEntities`), mark as "known" with band `learnerBand` (treated as in-envelope regardless of level)
   - Otherwise lemmatize; if lemmatization returns `null`, mark as "unknown"
   - For known lemmas: look up CEFR band from the atlas. If the lemma is in the learner's `lemmaCards` with `stability > 0`, mark as "learner-known"; otherwise mark as "in-band" if the band is ≤ learner band, else "out-of-band"
3. Compute:
   - `totalTokens`
   - `knownTokens` = learner-known + numbers + named entities + in-band
   - `inBandTokens` = tokens with band ≤ learnerBand
   - `unknownTokens` = lemmas not in atlas + surface forms with no lemma
   - `bandHistogram` — count per CEFR band
   - `outOfEnvelopeLemmas` — lemmas with band > learnerBand + 1
   - `coverageRatio` = `knownTokens / totalTokens`
4. Return the `CoverageProfile`

**Tests Required:**

- Fixture test: A text entirely composed of A1 lemmas for an A1 learner → `coverageRatio = 1.0`, no out-of-envelope
- Fixture test: A text with 90% A1 + 10% C1 lemmas for an A1 learner → `coverageRatio = 0.9` (below Krashen threshold), out-of-envelope includes the C1 lemmas
- Fixture test: A text containing named entities ("Wordlark Hollow", "Orrin") for an A1 learner where the entity set includes these → entities count as known
- Fixture test: A text with an unknown surface form ("asdfzxcv") → `unknownTokens = 1`
- Edge case: empty text → `totalTokens = 0`, `coverageRatio = 1.0` (vacuously in-envelope)
- Performance test: computing coverage for an 80-token text completes in <3ms

**API Documentation Update:**

- `docs/api/classifier.md`: document the `CoverageProfile` computation algorithm and the named-entity allowlist role

**Acceptance Criteria:**

- All coverage unit tests pass
- Behavior is deterministic and position-independent

### Story 5.4: Implement `envelope-rule.ts`

**Purpose:** Codify the envelope rule from Proposal 001 exactly, with citations, as a pure function.

**Tasks:**

1. Implement `applyEnvelopeRule(profile: CoverageProfile, learnerBand: CEFRBand, options: EnvelopeRuleOptions): { withinEnvelope: boolean; violations: LemmaRef[]; exemptionsApplied: string[] }` per the Proposal 001 rule:
   ```
   withinEnvelope ⇔
     coverageRatio ≥ 0.95                                (Krashen 95%)
     AND no lemma has band > learnerBand + 1             (i+1 ceiling)
     AND |outOfEnvelopeLemmas| ≤ 2
         OR all out-of-envelope lemmas ∈ options.prescription.introduce
         OR all are named entities (already handled in coverage)
         OR all are in options.questEssentialLemmas      (Linguistic Deadlock fix, Proposal 001)
   ```
2. Include the citation in the source file (JSDoc comment) — link to Nation 2001 for 95%, link to Krashen 1985 for i+1, and reference Proposal 001 § Quest-Essential Lemma Exemption for the new clause
3. Include an exhaustive test matrix in the test file — one test per rule clause, so if anyone changes a threshold, the test makes them justify it
4. `EnvelopeRuleOptions` (from Epic 3 Story 3.4) carries three exemption sources: `prescription`, `knownEntities`, and `questEssentialLemmas`. The rule evaluates each exemption independently — a lemma is exempt if it's in ANY of them. The returned `exemptionsApplied` list records which exemption fired for which lemma (important for telemetry — we want to count how often each exemption saves the day)

**Tests Required:**

- Fixture test: in-envelope text passes
- Fixture test: text with 94.9% coverage fails (Krashen floor)
- Fixture test: text with a B2 lemma for an A1 learner fails (i+1 ceiling)
- Fixture test: text with 3 out-of-envelope lemmas not in prescription fails
- Fixture test: text with 3 out-of-envelope lemmas *all* in `prescription.introduce` passes (the introduction exemption)
- Fixture test: text with 2 out-of-envelope lemmas (under the `≤ 2` threshold) passes even without prescription
- Regression guard test: test asserts the literal values `0.95` and `2` from the rule, so any change requires updating the guard and thinking about it
- **Linguistic Deadlock regression guard — the Ethereal Altar test:** a text "*Investigue el altar etéreo*" for an A1 learner where `altar` and `etéreo` are both individually above A1+1, but both are in `options.questEssentialLemmas` → passes, with `exemptionsApplied: ["quest-essential", "quest-essential"]` — this is the canonical test of the Linguistic Deadlock fix from Proposal 001
- **Quest-essential exemption is honored independently of prescription:** same text, but `prescription.introduce` is empty and `questEssentialLemmas` contains `altar` and `etéreo` → still passes (the two exemptions are independent — a lemma can be exempt via quest-essential even if it's not in introduce)
- **Quest-essential exemption does NOT bypass the 95% coverage floor:** a text with 50% unknown tokens + quest-essential lemmas → still fails because coverage is below Krashen floor. Quest-essential only exempts the band check, not the coverage check.
- **Exemption telemetry attribution test:** a lemma in BOTH `prescription.introduce` AND `questEssentialLemmas` is exempted; the `exemptionsApplied` list records which exemption was evaluated first (deterministic priority order) so telemetry attribution is consistent

**API Documentation Update:**

- `docs/api/classifier.md`: document the rule with citations and the exhaustive test matrix reference

**Acceptance Criteria:**

- All rule tests pass
- Citations are embedded in source
- The regression guard test is present and passes

### Story 5.5: Implement `envelope-classifier.ts`

**Purpose:** The classifier facade — composes tokenize → lemmatize → coverage → rule into a single `check` call.

**Tasks:**

1. Implement the `EnvelopeClassifier` class with:
   - Constructor takes `atlas: LexicalAtlasProvider`, `morphology: MorphologyLoader`, and an `EnvelopeClassifierOptions` object
   - `check(text: string, learner: LearnerProfile, options?: { prescription?: LexicalPrescription; knownEntities?: Set<string>; questEssentialLemmas?: Set<string>; lang?: string }): EnvelopeVerdict`
   - `questEssentialLemmas` is the Linguistic Deadlock exemption (Proposal 001 § Quest-Essential Lemma Exemption). The Verify middleware (Epic 10 Story 10.4) populates it from `constraint.questEssentialLemmas` before calling `check`.
2. The method runs the four stages in order and returns a complete `EnvelopeVerdict`:
   - `withinEnvelope` (from rule)
   - `profile` (full coverage profile)
   - `worstViolation` (highest-band out-of-envelope lemma)
   - `rule` (the rule function result for audit)
3. Default `lang` from the learner's `targetLanguage` field
4. Handle the empty-text edge case gracefully

**Tests Required:**

- End-to-end fixture test: `check("Hola, buenos días", learnerA1, {lang: "es"})` returns `withinEnvelope: true` for a fresh learner where the atlas has these as A1 lemmas
- End-to-end fixture test: `check("El paralelogramo es equilátero", learnerA1, {lang: "es"})` returns `withinEnvelope: false` (the geometry terms are C1+ for a beginner)
- End-to-end fixture test: repair retry scenario — `check` returns `withinEnvelope: false` with a specific `worstViolation`; caller trims that lemma and re-checks; second call returns `withinEnvelope: true`
- Integration test: classifier loaded against real Spanish and Italian atlas data handles a variety of typical NPC reply lengths
- Performance test: 100 `check` calls on 80-token inputs complete in < 500ms total (target p95 ≤ 5ms)

**API Documentation Update:**

- `docs/api/classifier.md`: full API reference for `EnvelopeClassifier`, usage examples, expected latency budget, determinism guarantee

**Acceptance Criteria:**

- All unit and integration tests pass
- Performance budget met
- Classifier is deterministic (same input → same output)

### Story 5.6: Implement `auto-simplify.ts`

**Purpose:** The deterministic fallback for when the verifier's one retry still fails. Substitutes each violating lemma from `simplifications.json` to produce a guaranteed-in-envelope text. May be stilted, but never out-of-envelope.

**Tasks:**

1. Implement `autoSimplify(text: string, violations: LemmaRef[], learner: LearnerProfile, simplifications: SimplificationsLoader): { text: string; substitutionCount: number; fallbackGlosses: LemmaRef[] }`
2. For each violation:
   - Look up `simplifications[lemmaId]` in the loaded dictionary
   - Find the first substitution at a band ≤ learnerBand
   - If found, replace every inflection of the violation in the text with the corresponding inflection of the substitution (may require re-lemmatization; for simplicity in v1, replace surface form to surface form using the morphology index to find matching inflections, OR accept a stiff substitution in base form)
   - If no substitution exists at an acceptable band, replace the violation with the English gloss wrapped in italics: `*tariff*` (fallback code-switch)
3. Return the modified text plus a count of substitutions and a list of lemmas that fell through to gloss fallback
4. **Correctness invariant:** running `EnvelopeClassifier.check` on the returned text MUST return `withinEnvelope: true`. If it doesn't, the classifier and the simplifications data are inconsistent — throw loudly with a diagnostic.

**Tests Required:**

- Fixture test: text with one B2 violation → substituted with an A2 synonym → classifier now passes
- Fixture test: text with a violation that has no substitution → gloss fallback used → classifier passes
- Invariant test: 50 random out-of-envelope texts run through `autoSimplify` → every one is in-envelope after simplification
- Degradation test: measure the "naturalness loss" — count substitutions and gloss fallbacks per 100 sentences, log as a metric for later tuning

**API Documentation Update:**

- `docs/api/classifier.md`: "Auto-simplify fallback" section with the invariant and the substitution algorithm

**Acceptance Criteria:**

- All auto-simplify unit tests pass
- The correctness invariant holds across 50+ random test inputs
- The gloss fallback is never silent — it's always logged

## Risks and Open Questions

- **Morphology lookups for inflected substitutions.** If the morphology data only supports surface→lemma but not lemma→inflection, auto-simplify can only substitute at the base form, producing stiff text. For v1, accept this; a v1.1 improvement is to add inverse morphology (lemma → inflections) and substitute with agreement.
- **Determinism under unicode normalization.** Spanish and Italian use accents; make sure the tokenizer and lemmatizer normalize to the same Unicode form (NFC recommended) before lookup. A failing unit test on e.g. combined `é` vs precomposed `é` will surface this.
- **Named entity allowlist source.** The Classifier takes `knownEntities` as an input set. Who builds this set per conversation? Epic 6 (scene lexicon compile) produces `CompiledSceneLexicon.properNouns`, which is the per-scene source. Epic 10 (middleware) passes it into `check`. Document this contract clearly in the API reference.
- **Named entity false positives.** A player who uses a real English word that happens to match a named entity in a different language scene could get miscounted. Accept the false positive rate for v1; it's bounded and in the player's favor (over-counting as "known").
- **Performance at scale.** The classifier runs every turn. If any single lookup (atlas `getBand`, morphology trie walk) is slow, the whole budget explodes. Each individual stage test includes a performance assertion, and the full `check` performance test catches regressions.

## Exit Criteria

Epic 5 is complete when:

1. All six stories are complete
2. Every unit test and integration test passes
3. Performance budget (≤5ms p95 on 80-token input) is met in the benchmark test
4. The auto-simplify correctness invariant holds
5. `docs/api/classifier.md` is complete
6. `tsc --noEmit` passes
7. This file's `Status:` is updated to `Complete`
