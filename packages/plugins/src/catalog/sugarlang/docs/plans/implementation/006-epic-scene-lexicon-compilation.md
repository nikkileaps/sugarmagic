# Epic 6: Scene Lexicon Compilation

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Scene Lexicon Compilation](../../proposals/001-adaptive-language-learning-architecture.md#scene-lexicon-compilation-one-compiler-three-profiles-preview-first)
**Depends on:** Epic 1 (skeleton), Epic 3 (types), Epic 4 (CEFRLex + morphology loaders)
**Blocks:** Epic 8 (Budgeter uses `CompiledSceneLexicon` for scene gating), Epic 10 (middleware loads scene lexicons)

## Context

The scene lexicon compiler is **one semantic compiler, three profiles, content-hash cached, Preview-first**. It scans authored content per scene, lemmatizes every reachable text blob, looks up each lemma in CEFRLex, and emits a `CompiledSceneLexicon` JSON artifact that the Budgeter consumes. The compiler runs in five places:

1. Background authoring-time (Studio, debounced on `applyCommand`)
2. Preview start (handoff via `PREVIEW_BOOT` payload)
3. Lazy on scene-enter (Preview runtime, for cache misses)
4. Manual rebuild button (author-initiated forced recompile)
5. Publish (writes artifacts into the published bundle)

All five share the *exact same compiler function*. The only thing that differs is the compile profile (`authoring-preview` / `runtime-preview` / `published-target`) and the cache tier. This is the "single enforcer" rule from AGENTS.md — no editor-only fast path.

This epic is large because it touches runtime, Studio-side authoring, Preview handoff, and publish. It is also the most **architecturally load-bearing** epic: if the cache is wrong, every Preview iteration forces a full recompile, and the iteration loop degrades from "fast" to "awful." The user called this out explicitly; this epic is where we honor that.

## Prerequisites

- Epic 1 (skeleton)
- Epic 3 (types, especially `CompiledSceneLexicon`, `RuntimeCompileProfile`)
- Epic 4 (CEFRLex data + morphology loaders — the compiler needs both to lemmatize and classify)

## Success Criteria

- `compileSugarlangScene(scene, atlas, profile)` is a pure function that produces a `CompiledSceneLexicon`
- Content-hash-based cache keys work correctly across all three profiles
- IndexedDB-backed cache persists across Studio reloads
- Background authoring-time compile scheduler runs on debounced authoring events
- Preview handoff carries cached lexicons in `PREVIEW_BOOT`
- Lazy compile on scene-enter works as fallback
- Manual rebuild button invalidates the cache and triggers background recompile
- Publish path generates artifacts and writes them into the publish bundle
- Cache hit rate in normal authoring sessions is ≥95%
- Zero forks of compile logic across profiles

## Stories

### Story 6.1: Implement `scene-traversal.ts`

**Purpose:** Walk authored game content for a single scene and produce a normalized list of text blobs that the compiler will lemmatize.

**Tasks:**

1. Implement `collectSceneText(scene: SceneAuthoringContext): TextBlob[]` where `SceneAuthoringContext` is a shape that holds references to: the scene id, the NPCs present in the scene, the dialogues reachable in the scene, the quests whose active stages reference the scene, the items visible in the scene, the region and area definitions, and the lore pages referenced by any of the above
2. `TextBlob = { sourceKind: "dialogue" | "npc-bio" | "quest-objective" | "quest-objective-display-name" | "item-label" | "region-label" | "lore-page"; sourceId: string; sourceLocation: SourceLocation; text: string; weight: number; objectiveNodeId?: string; questDefinitionId?: string }`
3. Traverse in a deterministic order so the resulting list is stable — important for content hashing in the next story
4. The `weight` field is a hint used by the Budgeter later (e.g. dialogue text weighs more than distant lore). For v1, assign simple constants per source kind.
5. **Quest-essential blob tagging:** when walking quest definitions, emit two distinct blob kinds for each objective node: `"quest-objective-display-name"` for the objective's `displayName` (the text the player sees in the HUD) and `"quest-objective"` for its `description`. Both blobs include `objectiveNodeId` and `questDefinitionId` so `compileSugarlangScene` (Story 6.3) can tag the lemmas they contain as quest-essential. See Proposal 001 § Quest-Essential Lemma Exemption for why this distinction matters.

**Tests Required:**

- Fixture test: a minimal scene with one NPC + one dialogue + one quest returns the expected `TextBlob[]`
- Determinism test: running traversal twice on the same scene returns byte-identical output
- Edge case: a scene with zero authored content returns an empty array (not an error)

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: describe the traversal contract and the `SceneAuthoringContext` input shape

**Acceptance Criteria:**

- All tests pass
- Traversal is deterministic

### Story 6.2: Implement `content-hash.ts`

**Purpose:** Compute a stable content hash over the compiler's input fields. This hash is the cache key — if it changes, the cache misses; if it doesn't, we skip recompilation.

**Tasks:**

1. Implement `computeSceneContentHash(textBlobs: TextBlob[], atlasVersion: string, pipelineVersion: string): string`
2. Hash algorithm: concatenate sorted-by-sourceId TextBlob text + sourceKind + sourceId, include `atlasVersion` and `pipelineVersion` in the preamble, run SHA-256, return hex
3. The hash is **stable across runs** — same inputs, same hash. Use a deterministic text encoder (UTF-8).
4. Use the Web Crypto API (`crypto.subtle.digest`) which is available in both Node 18+ and browsers; fall back to a pure-JS SHA-256 implementation if the runtime is older
5. Publish the `pipelineVersion` as a constant in the file (e.g. `export const SUGARLANG_COMPILE_PIPELINE_VERSION = "1"`) that bumps whenever the compiler logic changes, forcing a global cache invalidation

**Tests Required:**

- Determinism test: `computeSceneContentHash(blobs, "v1", "1")` returns the same hex twice
- Sensitivity test: changing one character in one blob changes the hash
- Sensitivity test: changing atlasVersion changes the hash
- Sensitivity test: changing pipelineVersion changes the hash
- Length test: the returned hash is always 64 hex chars (SHA-256)

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: document the cache key schema and the pipelineVersion/atlasVersion bump rules

**Acceptance Criteria:**

- All hash tests pass
- The hash function is a pure function with no hidden state

### Story 6.3: Implement `compile-sugarlang-scene.ts`

**Purpose:** The actual compiler function — the single source of truth that every profile uses.

**Tasks:**

1. Implement `compileSugarlangScene(input: SceneAuthoringContext, atlas: LexicalAtlasProvider, morphology: MorphologyLoader, profile: RuntimeCompileProfile): CompiledSceneLexicon`
2. The function:
   - Calls `collectSceneText` to get text blobs
   - Computes the content hash
   - Tokenizes + lemmatizes every text blob using the same tokenizer/lemmatizer from Epic 5 (shared code, no duplication)
   - For each unique lemma found, queries the atlas for CEFR band, frequency rank, parts of speech
   - Builds `SceneLemmaInfo` entries
   - Identifies anchor lemmas (lemmas appearing in quest-critical text or in region/area labels — rules documented in JSDoc)
   - **Identifies quest-essential lemmas:** for every text blob with `sourceKind === "quest-objective-display-name"` or `sourceKind === "quest-objective"`, tokenize-and-lemmatize and emit a `QuestEssentialLemma` entry for each content lemma (strip stopwords, proper nouns, and function words — only content lemmas count). Each entry carries the `sourceQuestId`, `sourceObjectiveNodeId`, and `sourceObjectiveDisplayName` for runtime filtering and telemetry. Deduplicate across blobs if the same lemma appears in multiple objectives — keep one entry per (lemmaId, objectiveNodeId) pair, since a lemma can legitimately be essential to multiple objectives.
   - Identifies proper nouns (capitalized words that don't lemmatize successfully — add to `properNouns[]` for the classifier's NER allowlist)
   - Emits source-location and diagnostic data ONLY when the profile is `"authoring-preview"`; strips them for `"runtime-preview"` and `"published-target"`
   - **Emits `questEssentialLemmas: QuestEssentialLemma[]`** on the `CompiledSceneLexicon` (always present — empty array when no active quests reference this scene, not undefined)
   - Under `"authoring-preview"` profile, emits a diagnostic warning if a single objective has >5 quest-essential lemmas above the expected learner band (e.g. 5+ B2 lemmas in an objective that A2 learners will encounter) — this is the "author is creating a linguistic-deadlock-prone objective" warning from Proposal 001
   - Returns a full `CompiledSceneLexicon` object
3. Diagnostics to emit under `"authoring-preview"`:
   - "Scene has >3% unclassified tokens, consider reviewing morphology coverage"
   - "Scene has >30% lemmas at band > any learner's current band — authoring issue"
   - "Scene contains a lemma with `cefrPriorSource: 'frequency-derived'` at a narrative-critical location — confidence is lower"
4. The compiler is pure: no I/O, no side effects, no plugin-specific logic. It takes inputs and returns an artifact.

**Tests Required:**

- Fixture test: a minimal scene produces a `CompiledSceneLexicon` with the expected lemmas and bands
- Profile test: the same scene compiled under all three profiles produces lexicons that differ only in `sources` and `diagnostics` (the semantic fields are identical)
- Determinism test: same input produces byte-identical output (no timestamp, no uuid, no non-deterministic field)
- Proper noun test: a scene containing "Wordlark Hollow" lists it in `properNouns`
- Diagnostic test: a scene with 40% C1 lemmas under `"authoring-preview"` produces a diagnostic warning
- Diagnostic test: the same scene under `"runtime-preview"` produces no diagnostics (stripped)
- Performance test: compiling a ~500-lemma scene completes in <50ms
- **Quest-essential tagging test:** a scene where a quest's objective `displayName` is "Investigate the Ethereal Altar" → the compiled lexicon's `questEssentialLemmas` contains entries for `investigate`, `ethereal`, and `altar` (content lemmas only; stopwords like "the" are excluded), each with the correct `sourceObjectiveNodeId` and `sourceObjectiveDisplayName: "Investigate the Ethereal Altar"`
- **Quest-essential deduplication test:** two different objectives with overlapping vocabulary (e.g. two different quests both using the word "altar") produce two separate `QuestEssentialLemma` entries — one per (lemmaId, objectiveNodeId) pair — so runtime filtering can activate either independently
- **Quest-essential empty scene test:** a scene with no quests referencing it produces `questEssentialLemmas: []` (empty array, not undefined)
- **Diagnostic warning for deadlock-prone objectives:** an objective containing 5+ lemmas above B2 under `"authoring-preview"` profile produces a warning pointing at that specific objective and listing the high-band lemmas

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: document the compiler function contract, the per-profile output differences, and the diagnostic rules

**Acceptance Criteria:**

- All compiler tests pass
- Deterministic output
- Profile gating strips debug fields correctly
- Single implementation shared across all invocation sites

### Story 6.4: Implement `sugarlang-compile-cache.ts` + in-memory impl

**Purpose:** The cache interface and a simple in-memory implementation used by Published builds and as the fallback in the Preview runtime.

**Tasks:**

1. Define `SugarlangCompileCache` abstract class/interface with:
   - `get(sceneId: string, contentHash: string, profile: RuntimeCompileProfile): Promise<CompiledSceneLexicon | null>`
   - `set(lexicon: CompiledSceneLexicon): Promise<void>`
   - `has(sceneId: string, contentHash: string, profile: RuntimeCompileProfile): Promise<boolean>`
   - `invalidate(sceneId?: string): Promise<void>` — clear a single scene or the whole cache
   - `listEntries(): Promise<CacheEntryMeta[]>` — for the diagnostics panel
2. Implement `MemoryCompileCache` as a simple `Map<CacheKey, CompiledSceneLexicon>` with LRU eviction at a configurable size
3. Use the content-hash based cache key from Story 6.2

**Tests Required:**

- Unit test: set → get → returns the same artifact
- Unit test: get for an unset key returns `null`
- Unit test: LRU eviction kicks in when the cache exceeds its size limit
- Unit test: `invalidate(sceneId)` removes only that scene
- Unit test: `invalidate()` removes everything
- Concurrency test: parallel gets/sets on the same key don't corrupt the cache

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: cache interface documentation + in-memory impl behavior

**Acceptance Criteria:**

- All cache unit tests pass
- The in-memory impl is clean enough to serve as the reference for the IndexedDB impl in Story 6.5

### Story 6.5: Implement `cache-indexeddb.ts`

**Purpose:** IndexedDB-backed compile cache for Studio. Persists across Studio reloads so the first Preview after a clean browser session has a warm cache from the last authoring session.

**Tasks:**

1. Implement `IndexedDBCompileCache implements SugarlangCompileCache`
2. Open an IndexedDB database named `sugarlang-compile-cache` with an object store `scene-lexicons` keyed by the cache key string
3. Store each `CompiledSceneLexicon` as a plain object (IndexedDB handles the serialization)
4. Total cache size should be bounded by a configurable limit (default 100 MB — comfortably within IndexedDB quotas); when exceeded, LRU-evict
5. Handle IndexedDB unavailability gracefully (e.g. private browsing modes) — fall back to the `MemoryCompileCache` with a warning
6. Namespace the database by workspace ID so multi-workspace setups don't cross-contaminate

**Tests Required:**

- Integration test: write → reload → read returns the same lexicon (uses `fake-indexeddb` in the test environment)
- Integration test: LRU eviction at the size limit
- Integration test: IndexedDB unavailable → falls back to memory cache with warning
- Integration test: workspace namespacing — two workspaces cannot read each other's entries

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: IndexedDB cache implementation notes, fallback behavior, workspace isolation

**Acceptance Criteria:**

- IndexedDB cache persists across simulated reloads
- Fallback behavior is correct
- All integration tests pass

### Story 6.6: Implement the authoring-time compile scheduler

**Purpose:** Subscribe to the Studio's authoring command stream (the `applyCommand` flow), debounce on content changes, and recompile affected scenes in the background so the cache is warm by the time the user hits Preview.

> **Extension point for Epic 14 (Lexical Chunk Awareness):** The scheduler built in this story is the *tier-1* debounce for lemma-level compilation. Epic 14 Story 14.3 adds a *tier-2* debounce (longer interval, e.g. 5 seconds) that runs the LLM-based chunk extractor on scenes whose tier-1 compile just completed. Tier 2 runs entirely in background idle and never blocks tier 1 or Preview. Design this story's scheduler with a clear extension hook so Epic 14 can attach its tier-2 pass without reshaping the scheduler internals.

**Tasks:**

1. Implement `SugarlangAuthoringCompileScheduler` (Studio-side only — lives in the plugin's Studio entry point, not in the runtime)
2. Subscribe to the existing authoring command event bus (find the exact API during implementation — likely a `SessionEventBus` or similar)
3. On every command that affects scene-relevant content (dialogue text changed, NPC bio changed, quest objective text changed, item label changed, region label changed, lore page content changed, NPC added to scene, etc.), determine which scene(s) are affected and add them to a pending-compile set
4. Debounce pending compilation by ~250ms — if another command lands within 250ms, extend the debounce
5. On debounce fire: for each pending scene, compile with `profile = "runtime-preview"` (what Preview uses) in a background task and write the result to the IndexedDB cache
6. Also compile with `profile = "authoring-preview"` for the density-histogram UI and Studio diagnostics, if the Studio viewport is showing that surface
7. Log scheduler activity at debug level so authors can see it working if they want

**Tests Required:**

- Integration test: simulated authoring command → debounce → compile → cache entry exists for the expected scene
- Integration test: many rapid commands → debounce coalesces → only one compile per scene
- Integration test: command affecting two scenes → both scenes compile
- Integration test: the cache hit rate after a sustained simulated authoring session is ≥95% when Preview fires

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Background authoring-time compilation" section explaining the scheduler behavior and the debounce rationale

**Acceptance Criteria:**

- Scheduler runs in Studio only (never in Preview, never in Published)
- Cache hit rate target is met in simulated tests
- Scheduler activity is observable via logs

### Story 6.7: Preview handoff — carry cached lexicons in `PREVIEW_BOOT`

**Purpose:** When the user clicks Preview, the Studio-side plugin serializes its cached `CompiledSceneLexicon` entries into the `PREVIEW_BOOT` payload so the Preview window never has to recompile scenes that are already warm.

**Tasks:**

1. Locate the `PREVIEW_BOOT` message construction in `apps/studio/src/App.tsx` (found earlier in exploration — `handleStartPreview()`)
2. Have the sugarlang Studio plugin contribute a `previewBootContribution` that:
   - Reads the IndexedDB cache
   - Filters to entries with `profile === "runtime-preview"` and content hashes matching the current authored state
   - Serializes them as part of the boot payload under a reserved key like `pluginBootPayloads.sugarlang.compiledScenes`
3. On the Preview runtime side (the sugarlang plugin's `init(context)` hook), read the boot payload and populate the runtime cache with the pre-compiled lexicons before any scene loads
4. If a plugin boot contribution API doesn't exist today, extend the plugin system to support it (this is a small runtime-core change — add a new optional field to the `RuntimePluginInstance` or the boot flow). Flag this as a dependency on runtime-core.

**Tests Required:**

- Integration test: Studio writes cached lexicons → Preview receives them via the boot payload → Preview runtime cache has them populated before any scene loads
- Integration test: a lexicon in the Studio cache with a content hash that doesn't match the current authored state is NOT sent (drift protection)
- End-to-end test: boot a Preview session from a warm Studio session → no compilation happens during boot → first scene loads with a cached lexicon

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Preview handoff" section with the boot payload schema and the Studio→Preview cache transfer contract

**Acceptance Criteria:**

- Preview boot carries cached lexicons
- Drift protection works
- Cold-cache Preview boot still functions (falls through to lazy compile)

### Story 6.8: Lazy compile on scene-enter in Preview

**Purpose:** The safety net — when the Preview runtime encounters a scene whose compiled lexicon is not in the cache (because it was newly added, or the Studio cache was cleared, or drift happened), compile it on demand. Eagerly compile the start scene and its immediately adjacent scenes on Preview boot to avoid a stall at the first NPC interaction.

**Tasks:**

1. In `runtime/compile/compile-scheduler.ts`, add a runtime variant: `RuntimeCompileScheduler` (Preview-side)
2. On Preview `init(context)`:
   - Walk the scene graph from the start scene, breadth-first, to find all scenes reachable within the first ~60 seconds of play (definition of "reachable" = the scene OR scenes linked by direct quest transitions OR scenes spatially adjacent to the start region)
   - For each reachable scene, check the runtime cache (populated from the boot handoff); if missing, compile eagerly and cache
   - Non-reachable scenes are queued for lazy compilation on first scene-enter
3. On scene-enter at runtime: check the cache; if missing, compile synchronously before the scene becomes interactive (acceptable <50ms stall)
4. Log cache hits/misses at debug level so benchmarks can verify the target hit rate

**Tests Required:**

- Integration test: cold-cache Preview boot eagerly compiles the start scene + 1-hop neighbors
- Integration test: scene-enter with a cache miss compiles synchronously and the lexicon is available to the middleware
- Performance test: eager compile of 5 scenes during Preview boot completes in <250ms total
- Cache hit rate benchmark: a simulated Preview session with mostly-warm cache hits >95% (deferred to Epic 14 for the full scenario test, but a small smoke test is here)

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Lazy compile on scene-enter" section

**Acceptance Criteria:**

- Preview never stalls for more than ~50ms on scene-enter
- Eager boot compile completes under the budget
- Cache hit rate smoke test passes

### Story 6.9: Manual "Rebuild Sugarlang Lexicon" button

**Purpose:** The escape hatch — a Studio UI button that invalidates the whole cache and triggers a full background recompile. Useful when CEFRLex data updates, when the compiler `pipelineVersion` bumps, or when the author just wants to be sure.

**Tasks:**

1. Implement a `design.section` shell contribution named `SugarLangCompileStatusSection` that surfaces:
   - Current cache hit count vs. total
   - Number of scenes with stale lexicons
   - A "Rebuild All" button that calls `cache.invalidate()` and triggers the authoring scheduler to recompile every scene in the project
   - Per-scene status list showing compile state (stale / compiling / cached / error)
2. Running the rebuild is non-blocking — Studio stays responsive; the button shows progress
3. When rebuild completes, surface a toast notification ("Rebuilt lexicons for N scenes in M seconds")

**Tests Required:**

- Integration test: clicking the rebuild button invalidates the cache and triggers recompile of every scene
- Integration test: Studio remains responsive during rebuild
- Unit test: the progress display updates correctly during a simulated rebuild

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "Rebuild Sugarlang Lexicon" button documentation
- `docs/api/scene-lexicon-compilation.md`: cross-reference to the rebuild button as the "forced invalidation" escape hatch

**Acceptance Criteria:**

- Rebuild button works end-to-end
- Progress display is accurate
- Rebuild is non-blocking

### Story 6.10: Publish path — compile and write artifacts into the publish bundle

**Purpose:** When the author publishes the game, every scene gets compiled under `profile = "published-target"` and the results are gzipped into the publish bundle. The published runtime loads them directly without any compile step.

> **Extension point for Epic 14 (Lexical Chunk Awareness):** The publish path built in this story handles lemma-level compilation only. Epic 14 Story 14.4 extends the publish pipeline to run the LLM-based chunk extractor **synchronously** for every scene before writing the bundle — publish has no latency budget, so extraction is mandatory and blocking. Design this story's publish hook as a sequenced pipeline ("compile base lexicon" → "extract chunks" → "gzip and write") so Epic 14 can insert the extract step cleanly.

**Tasks:**

1. Locate the publish flow entry point (earlier exploration found minimal `PublishRequest`/`PublishResult` in `packages/io/src/publish/index.ts`)
2. Have the sugarlang plugin contribute a `publishPipelineContribution` that:
   - Iterates every scene in the project
   - Calls `compileSugarlangScene(scene, atlas, morphology, "published-target")` for each
   - Gzips the resulting JSON
   - Writes to the publish bundle under `compiled/sugarlang/scenes/<sceneId>.lexicon.json.gz`
3. The published runtime's sugarlang plugin `init(context)` hook checks if `context.boot.compileProfile === "published-target"`, and if so, loads the bundled artifacts directly instead of running the scheduler
4. Add a build verification step: after a publish, every scene should have a compiled artifact. Fail the publish loudly if any scene is missing one.

**Tests Required:**

- Integration test: publish a minimal project → compiled lexicons are present in the bundle
- Integration test: published runtime loads a bundled lexicon without compiling
- Integration test: a scene missing its compiled artifact fails publish (fast-fail discipline)

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Publish path" section documenting the bundle layout and the load-without-compile behavior

**Acceptance Criteria:**

- Publish bundle contains compiled lexicons for every scene
- Published runtime loads from the bundle
- Fail-fast on missing artifacts

### Story 6.11: Runtime lexicon store

**Purpose:** The `SugarlangSceneLexiconStore` interface that all downstream epics read from — a single abstraction hiding whether the lexicon came from the cache, was lazy-compiled, or was loaded from a published bundle.

**Tasks:**

1. Define `SugarlangSceneLexiconStore` interface:
   - `get(sceneId: string): CompiledSceneLexicon | undefined`
   - `ensure(sceneId: string): Promise<CompiledSceneLexicon>` — returns immediately if cached, triggers lazy compile otherwise
   - `onInvalidate(listener: (sceneId: string) => void): () => void`
2. Implement `DefaultSugarlangSceneLexiconStore` as a thin adapter over the compile cache + runtime scheduler
3. This is what downstream epics (Budgeter, middleware) import to read compiled lexicons — never the raw cache

**Tests Required:**

- Unit test: `get` returns cached entries
- Unit test: `ensure` lazy-compiles missing entries
- Unit test: `onInvalidate` fires when the cache invalidates a scene
- Unit test: the store is profile-transparent — downstream code doesn't know whether it's running in Preview, Published, or Studio

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: "Runtime lexicon store" section as the canonical consumer API

**Acceptance Criteria:**

- All unit tests pass
- Downstream epics (checked in later reviews) import `SugarlangSceneLexiconStore` and never import `SugarlangCompileCache` directly

## Risks and Open Questions

- **Runtime-core plugin boot payload extension.** If the plugin system doesn't support per-plugin boot payloads today (Story 6.7), this epic requires a small runtime-core change. Quantify the change during implementation; if it's significant, flag as a separate PR and defer.
- **IndexedDB in Preview window isolation.** The Preview window is a separate browser window opened via `window.open`. It has its own IndexedDB. The Studio→Preview handoff passes cached lexicons through `postMessage`, not IndexedDB sharing. Ensure the Preview runtime's `DefaultSugarlangSceneLexiconStore` writes to its own IndexedDB (or memory-only) and doesn't try to read from the Studio's IndexedDB.
- **Cache key drift if the authoring command stream misses a content-affecting command kind.** If an authoring command that changes scene content is not observed by the scheduler, the cache can silently serve stale data. Mitigation: the content hash is computed fresh on every compile; if the cache is consulted with the latest content hash and the entry matches, we're safe. The risk is if the *scheduler* uses a stale hash assumption to decide whether to compile. Defensive design: the scheduler always recomputes the hash from current authored state before deciding, never assumes its own pending-set is exhaustive.
- **Non-deterministic compile output from unstable iteration order.** Make sure every place that iterates (text blobs, lemmas, histograms) uses a deterministic order. A single `Map` iteration in insertion order is fine; a `Set` iteration order is implementation-defined and must be sorted before hashing or emitting.
- **pipelineVersion bump blast radius.** Bumping `SUGARLANG_COMPILE_PIPELINE_VERSION` invalidates every cached lexicon everywhere — including published bundles. The published bundles re-compile on next publish, so that's fine. The IndexedDB cache re-warms on next authoring session. Document this so the bump is a conscious act, not accidental.

## Exit Criteria

Epic 6 is complete when:

1. All eleven stories are complete
2. Every unit and integration test passes
3. Cache hit rate benchmark meets the ≥95% target in simulated authoring sessions
4. Publish path produces bundled artifacts
5. Manual rebuild button works
6. One compiler, three profiles — verified by a test that compiles the same scene under all three profiles and checks the semantic fields are identical
7. `docs/api/scene-lexicon-compilation.md` is complete
8. This file's `Status:` is updated to `Complete`
