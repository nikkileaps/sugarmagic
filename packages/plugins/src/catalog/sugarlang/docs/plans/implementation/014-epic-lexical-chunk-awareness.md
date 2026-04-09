# Epic 14: Lexical Chunk Awareness

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Lexical Chunk Awareness (LLM-as-Metadata-Author)](../../proposals/001-adaptive-language-learning-architecture.md#lexical-chunk-awareness-llm-as-metadata-author)
**Depends on:** Epic 3 (LexicalChunk type + CompiledSceneLexicon.chunks field), Epic 5 (Envelope Classifier base layer), Epic 6 (compile cache + authoring scheduler + publish path), Epic 9 (Director schema-parser pattern), Epic 13 (telemetry sink + event schema)
**Blocks:** Epic 15 (E2E tests cover the chunk feedback loop)

## Context

The lemma-based classifier from Epic 5 silently stiffens on formulaic sequences — multi-word idioms and common collocations whose meaning as a unit is different from the sum of their parts. The canonical example: *"de vez en cuando"* ("from time to time") is a functional A2 chunk even though *vez* is individually B1/B2 in CEFR-graded atlases. The lemma classifier sees *vez*, flags the turn as out-of-envelope, the verify middleware triggers a repair, and the NPC ends up saying something blander.

For noir dialogue — which the user has identified as the register the game actually runs in — this is a dialect-ruining problem. Three previous attempts at sugarlang hit the same wall. This epic fixes it by adding a **lexical chunk awareness layer** over the existing lemma classifier, without introducing a curated static dataset and without breaking the deterministic runtime discipline from Epic 6.

The approach is **LLM-as-metadata-author**. At scene lexicon compile time, an offline extractor pass sends the scene's authored text to Claude with a focused prompt that asks for multi-word idiomatic sequences and their CEFR band as communicative units. The LLM produces a per-scene chunk manifest. The classifier reads that manifest deterministically at runtime via a pre-pass that runs before lemmatization. The chunks are treated as virtual tokens with their own CEFR band. The human writes noir; the LLM writes metadata; the runtime stays byte-identical.

This is explicitly *not* a global static chunk dataset. Static wordlists go stale. Every chunk in the manifest is one that actually appears in this scene's authored text. The "dataset" is exactly as big as the game.

## Why This Epic Exists

Three previous sugarlang attempts ran into the idiom problem and each time the author tried to solve it with either (a) hand-curated chunk lists (which immediately went stale and required ongoing manual maintenance) or (b) runtime LLM chunk detection (which killed performance). This epic is the first proposal that threads the needle: LLM does the work at bake time (where determinism is cheap and latency doesn't matter), cached by content hash, classifier reads a static manifest at runtime (where determinism is mandatory and performance is tight).

The architectural rules from Proposal 001 § Lexical Chunk Awareness are:

1. **`compileSugarlangScene` stays pure.** No LLM calls inside it. Ever.
2. **Chunk extraction is a separate module** that runs after the base compile.
3. **Extraction is async in Preview and sync in Publish.**
4. **The classifier degrades gracefully** when chunks are absent.
5. **The cache key is the same content hash** used by the base scene lexicon.
6. **Drift is surfaced via telemetry** when re-extraction produces different chunks.

This epic is the place those rules become code.

## Prerequisites

- **Epic 3** — `LexicalChunk` type and `CompiledSceneLexicon.chunks?: LexicalChunk[]` field already defined in `contracts/scene-lexicon.ts` per Story 3.5
- **Epic 5** — base envelope classifier exists (`coverage.ts`, `envelope-classifier.ts`, `tokenize.ts`, `lemmatize.ts`) and the tokenize→lemmatize→coverage pipeline is structured as discrete steps so a pre-pass can be inserted cleanly
- **Epic 6** — scene lexicon compile cache, content-hash keys, authoring scheduler (tier 1), and publish path all exist
- **Epic 9** — Director's `schema-parser.ts` pattern is in place; this epic reuses it for the extractor's JSON validation
- **Epic 13** — telemetry sink and event schema are in place; this epic adds new event kinds

## Success Criteria

- `extractChunks(sceneText, lang, atlas, llmClient)` produces a deterministic `LexicalChunk[]` via Claude structured output
- Chunk extraction is cached by the same content hash as the base scene lexicon (IndexedDB in Studio, in-memory elsewhere)
- The authoring-time scheduler runs chunk extraction as a tier-2 debounce that never blocks tier-1 compile or Preview
- The publish path runs chunk extraction synchronously for every scene before writing the bundle
- The envelope classifier's coverage pass scans for chunks before lemmatizing, treating matches as virtual tokens
- Classifier performance stays within the Epic 5 budget (≤5ms p95 on 80-token input) with or without chunks present
- When `sceneLexicon.chunks` is absent or empty, the classifier behaves identically to Epic 5 (graceful degradation verified by regression test)
- When `sceneLexicon.chunks` is populated, idiomatic sequences like "*de vez en cuando*" are treated as A2 units rather than being flagged by individual constituent lemma bands
- Drift events are logged when cache eviction produces different chunks from a prior cached entry
- Telemetry events for extraction lifecycle are emitted into the existing sink
- API documentation covers the extractor, the cache, the classifier integration, and the failure modes

## Stories

### Story 14.1: Implement `extract-chunks.ts` — the LLM-based extractor

**Purpose:** The core extractor module. Calls Claude with a structured-output prompt, parses the result, returns a `LexicalChunk[]`.

**Tasks:**

1. Module location: `runtime/compile/extract-chunks.ts`
2. Signature: `async function extractChunks(input: ExtractChunksInput): Promise<ExtractChunksResult>` where:
   - `ExtractChunksInput = { sceneText: TextBlob[]; lang: string; atlas: LexicalAtlasProvider; llmClient: AnthropicClient; promptVersion: string }`
   - `ExtractChunksResult = { chunks: LexicalChunk[]; tokenCost: { input: number; output: number }; latencyMs: number; model: string }`
3. Build a focused prompt instructing Claude to:
   - Read the provided scene text (concatenated from authored content blobs)
   - Identify multi-word idiomatic sequences, fixed collocations, and formulaic chunks
   - For each chunk, output: the normalized form, surface form variants observed in the text, the CEFR band *as a communicative unit* (not the max of its constituents), and its constituent lemmas
   - Use a JSON-schema-enforced output format
   - Include a short rationale per chunk for audit (discarded from the runtime manifest but logged to telemetry)
4. Use Claude Sonnet 4.5 by default; allow override to Haiku for cost-reduction scenarios via config
5. Use `temperature: 0` for maximum determinism within a single model version
6. Parse the response via the same schema-parser pattern as the Director (Epic 9 Story 9.2) — strict JSON validation, structured error reporting, best-effort repair
7. On any failure: return `{ chunks: [], ... }` and log via telemetry. Do not throw.
8. Tag every emitted chunk with `extractedByModel`, `extractedAtMs`, `extractorPromptVersion`, `source: "llm-extracted"`
9. Export the prompt template as a named constant so reviewers can inspect what Claude actually sees
10. Export `EXTRACTOR_PROMPT_VERSION` as a named constant (bumps when the prompt changes, forcing cache re-extraction everywhere)

**Tests Required:**

- Unit test with mocked Claude: valid response → populated `LexicalChunk[]` with correct shape
- Unit test with mocked Claude: malformed JSON → repair attempts → if successful, return chunks; if not, return empty array and log failure
- Unit test with mocked Claude: Claude API error → empty array + logged failure, does not throw
- Unit test: every returned chunk has `cefrBand` that is a valid `CEFRBand` value
- Unit test: every returned chunk's `extractedByModel` and `extractedAtMs` are set
- Unit test: `EXTRACTOR_PROMPT_VERSION` is exported and auditable
- Snapshot test: a fixture scene input produces a stable prompt string (reviewer can see exactly what Claude sees)
- Fixture test: a prompt containing "*de vez en cuando*" in the scene text, with a fixture response, produces a chunk with `cefrBand: "A2"` and the correct constituent lemmas
- Integration test (gated, optional): real Claude call with a fixture scene, assert the returned chunks pass schema validation. Skipped by default in CI to avoid API costs; enabled via `RUN_LIVE_CLAUDE_TESTS=1`

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: new "Lexical Chunk Extraction" top-level section documenting the extractor function, its inputs/outputs, and the prompt version contract

**Acceptance Criteria:**

- Extractor produces valid chunks from fixture inputs
- Failure paths return empty arrays and never throw
- Prompt template is exported and reviewable
- `tsc --noEmit` passes

### Story 14.2: Implement `chunk-cache.ts` — content-hash-based cache with drift detection

**Purpose:** Cache chunk extraction results by the same content hash used for the base scene lexicon. Detect and log drift when re-extraction produces different chunks from a prior cached entry.

**Tasks:**

1. Module location: `runtime/compile/chunk-cache.ts`
2. Define `ChunkCacheKey` = content hash (same as Epic 6 Story 6.2), plus `lang` and `extractorPromptVersion` as part of the key
3. Define `ChunkCacheEntry` = `{ key: ChunkCacheKey; chunks: LexicalChunk[]; extractedAtMs: number; extractedByModel: string }`
4. Define `SugarlangChunkCache` abstract class/interface with:
   - `get(key: ChunkCacheKey): Promise<ChunkCacheEntry | null>`
   - `set(entry: ChunkCacheEntry): Promise<void>` — writes the entry and checks for drift vs. any previous entry at the same content hash
   - `has(key: ChunkCacheKey): Promise<boolean>`
   - `invalidate(contentHash?: string): Promise<void>` — clear one or all
   - `listEntries(): Promise<ChunkCacheEntryMeta[]>`
5. Implement `MemoryChunkCache` backed by a `Map<string, ChunkCacheEntry>` with LRU eviction (default size 200 scenes × 2 languages = 400 entries)
6. Implement `IndexedDBChunkCache` backed by a dedicated `IDBObjectStore` named `sugarlang-chunks`, namespaced by workspace id, with an LRU total-size cap (default 10 MB)
7. **Drift detection:** on `set`, before writing the new entry, check if an entry already exists at the same content hash. If yes, compare the new chunks against the old:
   - If chunk counts differ → log a `"chunk.extraction-drift-detected"` telemetry event with `{ previousChunkCount, newChunkCount, previousExtractorModel, newExtractorModel }`
   - If chunk counts match but the normalized forms differ → log the same event with a detail field listing the changed chunks
   - If chunks are byte-identical → no event
   - In all cases, the new entry replaces the old
8. Handle IndexedDB unavailability gracefully — fall back to `MemoryChunkCache` with a warning log

**Tests Required:**

- Unit test per cache impl: set → get → returns the same entry
- Unit test: get on an unset key returns null
- Unit test: `has` returns correct boolean for set/unset keys
- Unit test: LRU eviction at the size limit
- Unit test: namespace isolation between workspaces
- **Drift test:** set an entry, then set a different entry at the same content hash → a drift event is emitted
- **Drift test:** set an entry, then set a byte-identical entry at the same content hash → no drift event
- Unit test: IndexedDB unavailable → falls back to memory cache with warning

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Chunk cache" subsection documenting the cache interface, the drift detection behavior, and the two implementations
- `docs/api/telemetry.md`: reference the drift event kind (full definition in Story 14.6)

**Acceptance Criteria:**

- Both cache impls work against real fixture data
- Drift detection works for both change-of-count and change-of-content
- Cache eviction is bounded
- All tests pass

### Story 14.3: Tier-2 background authoring chunk extraction

**Purpose:** Integrate the chunk extractor into the Studio authoring compile scheduler as a second-tier debounce that runs after the base tier-1 compile completes. Tier 2 runs entirely in background idle and never blocks Preview.

**Tasks:**

1. Extend `SugarlangAuthoringCompileScheduler` from Epic 6 Story 6.6 with a tier-2 pipeline:
   - Tier 1: existing 250ms debounce compiles base scene lexicon (lemma-only) and writes to the base scene lexicon cache
   - Tier 2: new 5-second debounce picks up scenes whose tier-1 compile just completed and runs chunk extraction on them
2. Tier-2 execution flow:
   - Read the base scene lexicon from the cache
   - Compute the content hash (reuse from Epic 6)
   - Check `chunkCache.get(contentHash, lang, EXTRACTOR_PROMPT_VERSION)`
   - If cache hit: no work needed; the cached chunks are already associated with this content hash
   - If cache miss: call `extractChunks(...)`, write the result to the cache, then write the chunks back into the base scene lexicon entry via `sceneLexiconCache.updateChunks(sceneId, contentHash, chunks)`
   - Emit a blackboard event `sugarlang.scene-chunks-updated` so any subscribers (e.g. the classifier cache invalidation hook) can react
3. **Concurrent edit safety:** if the scene content changes during tier-2 extraction (detected via content hash mismatch on write-back), discard the stale result and log a `chunk.extraction-stale-discarded` event
4. Tier-2 runs on a low-priority task queue — it must never starve tier-1 work or affect Preview responsiveness
5. Expose tier-2 progress in the design workspace (Epic 12 compile status section) so authors can see when extraction is running

**Tests Required:**

- Integration test: simulated authoring command → tier-1 compile completes → tier-2 fires 5s later → chunk cache is populated
- Integration test: many rapid authoring commands → tier-1 compiles settle → tier-2 fires once per affected scene after its own debounce
- Concurrency test: content changes during tier-2 extraction → stale result discarded → next tier-2 run handles the new content
- Performance test: tier-2 extraction of 20 scenes runs in background without affecting tier-1 latency or Preview responsiveness
- Cache behavior test: tier-2 hits the chunk cache when the content hash matches a prior extraction — no Claude call

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Tier-2 background chunk extraction" subsection documenting the scheduler behavior and the concurrent-edit safety guarantee
- Cross-reference Epic 6 Story 6.6 for the tier-1 scheduler

**Acceptance Criteria:**

- Tier-2 runs on background idle
- Tier-1 latency is not affected
- Concurrent edits are handled safely
- Cache hits skip the Claude call
- All tests pass

### Story 14.4: Synchronous chunk extraction in the publish path

**Purpose:** The publish pipeline runs chunk extraction for every scene synchronously before writing the bundle. The published runtime loads complete chunk manifests from the bundle without any extraction step.

**Tasks:**

1. Extend the publish pipeline from Epic 6 Story 6.10:
   - Existing sequence: "compile base lexicon" → "gzip and write"
   - New sequence: "compile base lexicon" → **"extract chunks"** → "gzip and write"
2. The chunk extraction step is mandatory and synchronous. Publish blocks on it.
3. Extraction is performed in parallel across scenes (bounded parallelism, e.g. 4 concurrent Claude calls) to keep total publish time reasonable
4. Chunks are written into the same gzipped artifact as the base lexicon — the published file at `compiled/sugarlang/scenes/<sceneId>.lexicon.json.gz` contains the full `CompiledSceneLexicon` including the `chunks` field
5. **Fast-fail on extraction failure:** if any scene's chunk extraction fails (Claude error, invalid JSON, timeout), the publish fails loudly with a clear error pointing at the offending scene. No silent fallback to empty chunks in the publish path — we want the bundle to be complete.
6. Publish progress reporting shows chunk extraction as a distinct phase so the author can see how far along it is
7. **Cost cap:** publish documentation warns about the cost of a full publish (~$1.20 per language at typical project size). Authors should know what they're triggering.

**Tests Required:**

- Integration test: publish a fixture project → chunks are present in every scene's bundled lexicon
- Integration test: forced extraction failure on one scene → publish fails with a clear error
- Integration test: published runtime loads a bundled lexicon with chunks and passes to the classifier without any extraction call
- Performance test: publish of 20 scenes completes in reasonable time (<60s total with ~4-way parallelism)

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: update the "Publish path" section with the chunk extraction phase, the fast-fail discipline, and the cost note

**Acceptance Criteria:**

- Published bundles always contain complete chunk manifests
- Fast-fail on extraction failure works
- Published runtime loads and uses chunks without any Claude call
- Cost note is documented

### Story 14.5: Envelope classifier chunk-scan pre-pass

**Purpose:** Extend the envelope classifier's coverage computation with a pre-pass that matches chunks in the input text before lemmatization. Matched chunks become virtual tokens with their own CEFR band. The classifier's runtime behavior changes only when chunks are present; when absent, it behaves identically to Epic 5.

**Tasks:**

1. Modify `runtime/classifier/coverage.ts` from Epic 5 Story 5.3 to add a new first stage:
   - **Stage 0: Chunk scan.** Read `sceneLexicon.chunks` (may be undefined or empty). If present and non-empty, scan the input text for chunk surface form matches using a multi-pattern matcher.
   - Matched spans are removed from the text for subsequent lemma processing and added to a `virtualTokens: VirtualChunkToken[]` buffer.
   - `VirtualChunkToken = { chunkId, surfaceMatched, start, end, cefrBand, constituentLemmaIds }`
   - **Stage 1: Lemma tokenize/lemmatize** runs on the remaining text (with chunk-matched spans excised)
   - **Stage 2: Coverage computation** treats virtual chunk tokens identically to lemma tokens — looks up their band, adds them to the histogram, checks them against the envelope rule
2. The multi-pattern matcher:
   - Build an Aho-Corasick trie at classifier instantiation time from `sceneLexicon.chunks` (or per-check if chunks change)
   - Cache the trie per scene lexicon entry (keyed by content hash) so repeated classifications for the same scene don't rebuild it
   - Longest-match-wins when multiple chunks could match the same position
   - Case-insensitive matching, but original case is preserved in the matched surface for rationale output
3. **Backwards compatibility:** when `sceneLexicon.chunks` is `undefined` or empty, stage 0 returns an empty `virtualTokens` buffer and the classifier runs identically to Epic 5. No regression possible.
4. **Performance:** the chunk scan must complete in <1ms on typical inputs. The trie is a straightforward implementation; performance is bounded by the number of chunks in the scene (~50-100) and the input length (~80 tokens)
5. Update `CoverageProfile` to include `matchedChunks: LexicalChunk[]` so the classifier's rationale trace records which chunks fired

**Tests Required:**

- **Regression test:** a scene lexicon with no chunks produces classifier output byte-identical to Epic 5 on a fixture input
- **Chunk match test:** a scene lexicon containing a `"de_vez_en_cuando"` chunk at CEFR A2 → input text "*Voy de vez en cuando al mercado*" → the chunk scan matches, the virtual token is A2, the classifier verdict is `withinEnvelope: true` for an A2 learner (where without chunks it would have flagged `vez` as out of envelope)
- **Longest-match test:** two chunks could match overlapping spans → the longer one wins
- **Case test:** input "*De Vez En Cuando*" matches a lowercase `"de vez en cuando"` surface form
- **Performance test:** a 100-token input against a 100-chunk scene lexicon classifies in < 3ms
- **Trie cache test:** repeated classifications for the same scene lexicon reuse the cached trie
- **Graceful degradation test:** scene lexicon where the `chunks` field is literally `undefined` (not just empty array) works without throwing
- **Rationale test:** `CoverageProfile.matchedChunks` is populated correctly and appears in the rationale trace

**API Documentation Update:**

- `docs/api/classifier.md`: update the coverage algorithm section to describe the chunk-scan pre-pass
- `docs/api/classifier.md`: document the `VirtualChunkToken` intermediate type and the backwards-compatibility guarantee
- Cross-reference Epic 5 Story 5.3 as the base layer

**Acceptance Criteria:**

- Chunk scan pre-pass runs before lemmatization
- Virtual tokens flow through coverage computation identically to lemmas
- Backwards compatibility is provable by the regression test
- Performance budget is met
- Rationale trace records matched chunks

### Story 14.6: Telemetry event kinds for chunks

**Purpose:** Extend the Epic 13 telemetry event schema with five new chunk-related event kinds.

**Tasks:**

1. Extend `TelemetryEvent` union (from Epic 13 Story 13.1) with:
   - `"chunk.extraction-started"` — `{ sceneId, contentHash, lang, extractorModel, extractorPromptVersion, timestamp }`
   - `"chunk.extraction-completed"` — `{ sceneId, contentHash, lang, chunkCount, latencyMs, tokenCost: { input, output }, extractorModel, timestamp }`
   - `"chunk.extraction-failed"` — `{ sceneId, contentHash, lang, error: { code, message }, extractorModel, timestamp }`
   - `"chunk.extraction-drift-detected"` — `{ sceneId, contentHash, previousChunkCount, newChunkCount, previousExtractorModel, newExtractorModel, changedChunks: string[], timestamp }`
   - `"chunk.hit-during-classification"` — `{ conversationId, turnId, sceneId, matchedChunks: { chunkId, cefrBand }[], timestamp }`
   - `"chunk.extraction-stale-discarded"` — `{ sceneId, contentHash, reason, timestamp }` (for the concurrent-edit safety case from Story 14.3)
2. Each new event kind has `schemaVersion: 1` and the common fields from Epic 13 Story 13.1
3. Bump the event schema version if adding these kinds requires a schema-level change (it should not — discriminated unions are additive)
4. Wire the new event emissions into Stories 14.1, 14.2, 14.3, 14.4, 14.5:
   - Extractor emits `chunk.extraction-started` / `chunk.extraction-completed` / `chunk.extraction-failed`
   - Cache emits `chunk.extraction-drift-detected` on drift
   - Scheduler emits `chunk.extraction-stale-discarded` on stale writes
   - Classifier emits `chunk.hit-during-classification` when chunks are matched during coverage computation (throttled — not every match, but a sampled summary per turn so high-frequency matches don't flood the sink)
5. Extend Epic 13's `RationaleTraceBuilder` (Story 13.4) to include matched chunks from `chunk.hit-during-classification` events in the per-turn trace

**Tests Required:**

- Type-level test: all new event kinds are part of the `TelemetryEvent` union
- Exhaustiveness test: a switch over event kinds still produces a `never` default when all kinds (including new ones) are handled
- Unit test: each event kind has the correct payload shape
- Integration test: a full extraction run emits the expected sequence of events in order
- Integration test: a drift-triggering cache update emits the drift event
- Integration test: a classifier run with chunk matches emits the hit event
- Rationale trace test: a turn with matched chunks shows them in the rationale

**API Documentation Update:**

- `docs/api/telemetry.md`: add six new event kind definitions with example payloads
- `docs/api/telemetry.md`: update the "Event timing and order" diagram to show the chunk pipeline events
- `docs/api/scene-lexicon-compilation.md`: cross-reference the telemetry events emitted by the extractor and cache

**Acceptance Criteria:**

- Six new event kinds defined and emitted
- Exhaustiveness checks pass
- Rationale traces include matched chunks
- All tests pass

## Risks and Open Questions

- **LLM hallucination of chunks.** The LLM may over-eagerly identify normal word sequences as "chunks" that aren't really formulaic. Worst case: the chunk gets the LLM's band label instead of the individual lemmas' bands, which is a slight grading difference and not a safety issue. Mitigation: the prompt explicitly asks for *formulaic/idiomatic* sequences, not arbitrary collocations, and includes a few-shot examples. Drift telemetry catches when this changes over time.
- **LLM missing chunks.** Under-eager extraction means the classifier stiffens on genuine idioms the LLM didn't flag. Telemetry on repair rate for chunk-less scenes lets us see when this is happening and tune the prompt.
- **Prompt version bump blast radius.** Bumping `EXTRACTOR_PROMPT_VERSION` forces re-extraction across every cached entry — every scene in every language gets a fresh Claude call on next access. For a 200-scene × 2-language project, that's 400 Claude calls ≈ $2.40. Not expensive, but worth a warning log and a confirmation in the Studio when bumping.
- **Cache drift across model versions.** When Anthropic ships Sonnet 4.7, the same prompt may produce different chunks. The drift telemetry surfaces this. Mitigation: treat model version bumps as an intentional full-reseed with telemetry monitoring for a few days afterward.
- **Concurrent extraction in parallel scenes during publish.** Running 4+ parallel Claude calls during publish respects rate limits but should be configurable. Default to 4; allow override in the plugin config.
- **Chunk trie memory overhead.** Each scene's Aho-Corasick trie is small (~100 chunks × ~5 bytes per node ≈ a few KB). Across 200 scenes, total memory is ~1 MB. Acceptable. Cache tries per scene; evict with LRU if memory pressure ever becomes a real concern (unlikely).
- **Interaction with the Director's existing exemption.** The Director can put a chunk's normalized form or its constituent lemmas into `prescription.introduce`. The classifier's existing exemption rule handles this — verify in a test that a Director-introduced chunk bypasses the envelope check even if its band is above learnerBand+1.
- **Auto-simplify fallback on chunks.** If a chunk is flagged out-of-envelope and the auto-simplify path runs (Epic 5 Story 5.6), should it substitute the whole chunk or its constituent lemmas? For v1, substitute at the chunk level if a simplification entry exists for the chunk's normalized form; otherwise fall back to lemma-level substitution. Document this in Story 14.5's API doc.

## Exit Criteria

Epic 14 is complete when:

1. All six stories are complete
2. The extractor produces valid chunks from real fixture scenes
3. The cache persists across Studio sessions and detects drift
4. The tier-2 authoring scheduler runs without blocking tier-1 or Preview
5. The publish path produces complete chunk manifests in the bundle
6. The classifier's chunk-scan pre-pass is implemented and the Epic 5 regression test still passes (backwards compatibility)
7. All six new telemetry event kinds are emitted correctly
8. `docs/api/scene-lexicon-compilation.md`, `docs/api/classifier.md`, and `docs/api/telemetry.md` are updated
9. `tsc --noEmit` passes across the plugin
10. This file's `Status:` is updated to `Complete`
11. Epic 15's chunk golden scenario (see Epic 15 Story 15.3b or equivalent) passes end-to-end
