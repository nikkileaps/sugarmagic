# Backlog: Write an epic for a Studio Build contribution surface

**Source:** Fell out of Plan 090.1e while tracing what "compile time" actually means. Nikki's framing: a `Build` menu entry under `Save`, which plugins register with, and whose individual units of work stay independently callable (the Generate Variants popover button).

**Date opened:** 2026-07-29

**Status:** needs an epic written. Nothing here is designed to locked-plan depth.

---

## Why this needs an epic rather than a fix

Three findings converged, and they are the same problem seen from different sides:

1. **"Compile" has no automatic trigger at all.** `notifySceneChanged` and `scheduleDialogue` -- the debounce entry points on `SugarlangAuthoringCompileScheduler` -- have ZERO callers repo-wide. The only real triggers are the manual Rebuild button (`manual-rebuild-button.tsx:92` -> `rebuildSugarlangCompileCache`) and lazy per-scene compile (`scene-lexicon-store.ts:82` -> `ensureScene`). Not on save, not on a timer. The class named Scheduler has no scheduling.

2. **The same job is implemented twice at two granularities, and the bulk one was dead.** `rebuildSugarlangCompileCache` (build everything, wires chunk + intent) and `generateVariantsForNode` (build one node, own content hash, own cache, own per-band loop) share NOTHING. The scheduler's `variantPipeline` -- the only path that would have baked variants in bulk -- was never constructed outside tests and was deleted 2026-07-29. **So bulk variant baking has never existed in production.**

3. **Dead debounce machinery invited a fourth copy.** Adding scene context as written meant a fourth `pending*Ids` set, `flush*()` method, `*Timer`, and `*DebounceMs` -- generalizing machinery nothing calls.

## The shape to design toward

The house pattern is already there: `DiscoveredPluginDefinition` (sdk/index.ts:313-317) carries optional, typed, discovered slots -- `runtime`, `shell`, `hostMiddleware`. Its own comment states the convention. `build` is the fourth slot.

The load-bearing decision is GRANULARITY, because the two invocation sites want different scopes. A `build(): Promise<void>` contribution cannot serve the popover. So Build must be an ENUMERATOR, not a doer:

```ts
interface PluginBuildContribution {
  taskId: string;                            // "sugarlang.variants"
  displayName: string;
  enumerate(project): BuildItem[];           // what needs building right now
  run(item, ctx): Promise<BuildItemResult>;  // exactly one item
}
```

- Build button -> enumerate all, run each, aggregate progress.
- Generate Variants popover -> construct one item, call `run`. Same code path.

Patterns: **Command** (the item; multiple invokers of one operation -- this is what removes the duplication), **Registry** (the contribution slot, house pattern), **Composite** (optional, so `taskId` can nest and "rebuild just this scene" costs nothing later), **Observer** for progress (`rebuildSugarlangCompileCache` already takes `onProgress`).

NOT Strategy (interchangeable algorithms for one job -- wrong shape). NOT Pipeline (nothing flows between these passes; they are independent).

## What enumerate/run buys

- Real progress -- "47 of 320", because the count is known before starting.
- Cancellation and resume between items.
- Per-item retry on a failed gateway call instead of failing the whole build.
- **Cache-skip stops being special.** Each pass currently has its own skip-if-warm branch; with an enumerator, warm items are simply not enumerated.
- **Bulk variant baking exists** as a consequence, not as separate work.

## Decisions the epic has to make

- **Save vs Build split.** Save should stay instant and deterministic. `compileSugarlangScene` is pure, synchronous and needs no gateway, so the vocabulary scan could run on save; the model-backed passes (MWE, intent, concepts, variants) cannot -- they cost money, vary run to run, and would fire on half-written content. Proposal: cheap deterministic work on save, paid work on Build.
- **Does the debounce machinery come back or stay deleted?** It is dead now. If Build is explicit, it stays deleted. If anything auto-triggers, "wait until the author stops typing" becomes load-bearing again. Decide before deleting further.
- **Where derived-but-authored output lives.** See the sibling problem below.

## Adjacent, and probably its own plan

**Authored data has no transport.** Variants / chunks / intents / concepts persist ONLY in browser IndexedDB, per workspace, per machine (`sugarlang-{compile,chunk,intent,variant}-cache:{workspaceId}`). Nothing serializes to project files, and `publishSugarlangArtifacts` has no importer outside its own test. So a fresh clone has none, another machine has none, and **a deployed game has none**. The only seeding path is `sceneLexiconStore.seed(previewLexicons)` (runtime-services.ts:734), which is the seam any transport would land on.

Classification settled 2026-07-29 (nikki): these ARE authored data -- same class as quests and dialogue -- because they are hand-editable (`saveVariant`, editor-support.ts:605-616) and static per game release, identical across players. The LLM is a drafting tool. Packaging differs from project JSON for size reasons, the way assets already do; classification does not.

Which surfaces three bugs of the "authored data stored in a cache" species, all worth naming in whatever plan owns this:

- **Prompt version is in the variant key** (`{lang, band, contentHash, variantPromptVersion}`). Bumping `VARIANT_PROMPT_VERSION` orphans every hand-edited variant; the lookup misses and the game silently renders authored English. Correct for machine drafts, indefensible for authored text.
- **Hand edits skip verification.** `saveVariant` stamps `verdict: { envelopePasses: true, ratioPasses: true, voiceRetentionScore: 1, fidelityPasses: true, overallPasses: true }, reviewFlag: false` unconditionally, so a typed variant claims four gates it never ran.
- **No provenance.** A machine draft and an author's edit are byte-identical in the store, so the rule you actually want -- regenerate drafts freely, never touch edits -- cannot be written.

## Not in scope for Plan 090

090.1e wires scene context into the existing `rebuildSugarlangCompileCache`. Under this design that later becomes one `enumerate`/`run` pair and the extractor itself does not change, so 090 does not need to wait on this.
