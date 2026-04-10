# Classifier API

Status: Updated in Epic 14

This document records the deterministic classifier API owned by
`packages/plugins/src/catalog/sugarlang/runtime/classifier/`.

## Determinism Contract

- The classifier is fully deterministic. No LLM calls. Same inputs produce the same verdict.
- Tokenization uses built-in `Intl.Segmenter`, so there is no extra tokenizer dependency to drift out of sync.
- Missing morphology, atlas, or simplification data throws loudly instead of silently degrading.

## Tokenization

- `Token`
  - Shape: `{ surface, start, end, kind }`
  - `kind` is one of `"word" | "punct" | "number" | "whitespace"`
  - The exported `tokenize()` result only contains `"word"` and `"number"` tokens
- `tokenize(text, lang)`
  - Lowercases word tokens for later morphology lookup
  - Preserves `start` and `end` offsets for diagnostics and rewrite passes
  - Uses `Intl.Segmenter(lang, { granularity: "word" })`

## Lemmatization

- `lemmatize(token, lang, morphology?)`
  - Primary Epic 5 path: `Token -> LemmaRef | null`
  - Compatibility path kept for Epic 4 smoke tests: `string -> string | null`
- The lookup flow is:
  1. normalize to NFC
  2. lowercase by language
  3. look up in `data/languages/<lang>/morphology.json`
  4. preserve the original token surface in the returned `LemmaRef.surfaceForm`

## Coverage Profile

- `computeCoverage(tokens, learner, atlas, knownEntities, morphology?, questEssentialLemmas?)`
- `CoverageProfile` includes:
  - `totalTokens`
  - `knownTokens`
  - `inBandTokens`
  - `unknownTokens`
  - `bandHistogram`
  - `outOfEnvelopeLemmas`
  - `ceilingExceededLemmas`
  - `questEssentialLemmasMatched`
  - `matchedChunks`
  - `matchedChunkTokens`
  - `coverageRatio`
- Coverage rules:
  - lexical chunks are scanned first when a scene lexicon provides `chunks`
  - matched chunk spans are removed from lemma processing and replaced by virtual chunk tokens
  - numbers count as known and in-band
  - allowlisted named entities count as known and in-band
  - learner cards with `stability > 0` count as known even if the lemma band is above the learner band
  - `outOfEnvelopeLemmas` means atlas-known lemmas above the learner band
  - `ceilingExceededLemmas` means atlas-known lemmas above `learnerBand + 1`
  - empty text returns `coverageRatio = 1.0`

## Virtual Chunk Tokens

- `VirtualChunkToken`
  - `chunkId`
  - `normalizedForm`
  - `surfaceMatched`
  - `start`
  - `end`
  - `cefrBand`
  - `constituentLemmaIds`
- The chunk pre-pass uses a cached trie matcher.
- Longest-match wins when chunks overlap.
- Matching is case-insensitive, while `surfaceMatched` preserves the original text span for rationale output.
- Backwards-compatibility guarantee:
  - if `sceneLexicon.chunks` is `undefined` or empty, the classifier behaves identically to the Epic 5 lemma-only path

## Envelope Rule

- `applyEnvelopeRule(profile, learnerBand, options)`
- Guard constants:
  - `ENVELOPE_KRASHEN_FLOOR = 0.95`
  - `ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE = 2`
- Exemption priority is deterministic:
  1. `prescription-introduce`
  2. `named-entity`
  3. `quest-essential`
- A lemma is exempt if it matches any exemption channel, but attribution always records the first matching channel in that fixed order.
- Quest-essential lemmas exempt the band checks, not the 95% coverage floor.

## Envelope Classifier

- `new EnvelopeClassifier(atlas?, morphology?, options?)`
- `check(text, learner, options?) -> EnvelopeVerdict`
- `EnvelopeClassifierCheckOptions`:
  - `prescription`
  - `knownEntities`
  - `questEssentialLemmas`
  - `lang`
  - `sceneLexicon`
  - optional `conversationId` / `turnId` / `sessionId` for chunk-hit telemetry
- The facade runs:
  1. `tokenize`
  2. chunk-scan pre-pass
  3. lemma coverage on unmatched tokens
  4. `applyEnvelopeRule`
  5. violation ranking and `worstViolation` selection
- Default language comes from `learner.targetLanguage`
- Chunk-hit telemetry:
  - emits `chunk.hit-during-classification` when matched chunks are present and turn context is provided
- Performance target from Epic 5:
  - p95 at or below ~5ms for a typical 50-80 token NPC reply

## Auto-Simplify Fallback

- `autoSimplify(text, violations, learner, simplifications?)`
- Returns:
  - `text`
  - `substitutionCount`
  - `fallbackGlosses`
- Behavior:
  - prefers the first simplification substitution whose replacement band is at or below the learner band
  - falls back to an italicized gloss when no acceptable substitution exists
  - re-runs the classifier on the final text and throws if the result is still out of envelope

## Real Data Dependencies

- Spanish:
  - real ELELex-backed atlas
  - real morphology index
  - simplifications dictionary generated from the shipped atlas
- Italian:
  - real Kelly-backed atlas with frequency-derived backfill
  - real morphology index
  - simplifications dictionary generated from the shipped atlas

## Regression Coverage

- Unit tests cover every rule clause individually.
- The Ethereal Altar quest-essential regression case is locked in.
- Performance checks run for tokenization, coverage, and full-classifier loops.
- Auto-simplify re-verification is tested repeatedly so classifier and simplification data stay aligned.
