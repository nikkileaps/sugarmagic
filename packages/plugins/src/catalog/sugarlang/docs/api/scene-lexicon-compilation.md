# Scene Lexicon Compilation API

Status: Completed in Epic 6

This document records the compiler, cache, and store surface for compiled
sugarlang scene lexicons.

## Core Inputs

- `SceneAuthoringContext`
  - `sceneId`
  - `targetLanguage`
  - `region`
  - `npcs`
  - `dialogues`
  - `quests`
  - `items`
  - `lorePages`
- `createSceneAuthoringContext(...)`
  - Filters the authored project down to the content reachable from one scene
  - Keeps traversal deterministic by sorting every collected slice

## Traversal Output

- `TextBlob`
  - `sourceKind`
  - `sourceId`
  - `sourceLocation`
  - `text`
  - `weight`
  - optional `objectiveNodeId`
  - optional `questDefinitionId`
  - optional `objectiveDisplayName`
- `collectSceneText(context)`
  - Emits dialogue, NPC bio, quest objective display name, quest objective body, item label, region label, and lore-page blobs
  - Returns a stable order suitable for hashing

## Content Hash

- `SUGARLANG_COMPILE_PIPELINE_VERSION`
  - Explicit cache-bust constant for compiler logic changes
- `computeSceneContentHash(textBlobs, atlasVersion, pipelineVersion?)`
  - Stable SHA-256 hex digest
  - Includes:
    - atlas version
    - pipeline version
    - normalized blob content
    - source identity fields

## Compiler

- `compileSugarlangScene(scene, atlas, morphology, profile)`
- Shared across all profiles:
  - `authoring-preview`
  - `runtime-preview`
  - `published-target`
- Returned `CompiledSceneLexicon` always includes:
  - `sceneId`
  - `contentHash`
  - `pipelineVersion`
  - `atlasVersion`
  - `profile`
  - `lemmas`
  - `properNouns`
  - `anchors`
  - `questEssentialLemmas`
- `authoring-preview` additionally includes:
  - `sources`
  - `diagnostics`

## Quest-Essential Tagging

- Objective `displayName` and `description` text both contribute quest-essential candidates
- The compiler emits one `QuestEssentialLemma` per `(lemmaId, objectiveNodeId)` pair
- Stopwords and clearly functional parts of speech are excluded from quest-essential emission
- Authoring diagnostics warn when one objective carries five or more quest-essential lemmas above `B2`

## Proper Nouns

- Proper nouns are collected from capitalized spans whose component words do not reliably resolve through morphology
- Multi-word spans are preserved for the classifier allowlist
- Component words and contiguous subphrases are also emitted so downstream allowlists can match either token-level or phrase-level forms

## Diagnostics

`authoring-preview` emits warnings for:

- more than 3% unclassified word tokens
- more than 30% high-band (`C1`/`C2`) lemmas in one scene
- frequency-derived CEFR priors on anchor lemmas
- deadlock-prone quest objectives with dense high-band essential vocabulary

## Cache Surface

- `createCompileCacheKey(sceneId, contentHash, profile)`
- `SugarlangCompileCache`
  - `get(sceneId, contentHash, profile)`
  - `set(lexicon)`
  - `has(sceneId, contentHash, profile)`
  - `invalidate(sceneId?)`
  - `listEntries()`
- `MemoryCompileCache`
  - in-memory reference implementation
  - LRU eviction by entry count and byte budget
- `IndexedDBCompileCache`
  - persistent browser-backed implementation
  - workspace-scoped database
  - falls back to `MemoryCompileCache` when IndexedDB is unavailable

## Scheduler Surface

- `SugarlangAuthoringCompileScheduler`
  - debounced background compiler for warm-cache authoring flows
  - compiles both `runtime-preview` and `authoring-preview` artifacts
- `RuntimeCompileScheduler`
  - lazy on-demand compiler for runtime cache misses

## Runtime Store

- `SugarlangSceneLexiconStore`
  - `get(sceneId)`
  - `ensure(sceneId)`
  - `onInvalidate(listener)`
- `DefaultSugarlangSceneLexiconStore`
  - thin consumer-facing adapter over the runtime scheduler
  - downstream epics should import this store abstraction, not raw caches

## Preview Boot Payload

- `SugarlangPreviewBootPayload`
  - `compiledScenes: CompiledSceneLexicon[]`
- `buildSugarlangPreviewBootPayload(...)`
  - extracts cache-warm preview lexicons for handoff into Preview
- `extractSugarlangPreviewBootLexicons(...)`
  - runtime-side parser for the plugin boot payload slice

## One Compiler Rule

- There is exactly one semantic compiler: `compileSugarlangScene`
- Profiles differ only in:
  - debug fields (`sources`, `diagnostics`)
  - storage tier
  - downstream loading path
- All later epics should treat the compiled lexicon artifact as the one source of truth for scene vocabulary
