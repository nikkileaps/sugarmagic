# API 017: Sugarlang Scripted-Mode Rendering

## Purpose

The scripted-mode rendering pipeline adapts authored English NPC dialogue to
the learner's current level without unconditional LLM calls. The rendering
ladder has three tiers that compose: deterministic weave (always runs),
baked variants (compiled assets for deep-end learners), and directed live
render (wired in 087.5). Every tier
verifies output before it reaches the player; every tier degrades to the one
below it on any failure.

The zero-LLM floor is contractual: authored mode is playable offline with no
gateway present. Live render requires a gateway but caches aggressively.

## Files

| Role | Path |
|------|------|
| Scripted middleware | `packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-scripted-middleware.ts` |
| Diglot weave engine | `packages/plugins/src/catalog/sugarlang/runtime/classifier/diglot-weave.ts` |
| Bake-time variant generator | `packages/plugins/src/catalog/sugarlang/runtime/compile/generate-variant.ts` |
| Variant cache (memory + IDB) | `packages/plugins/src/catalog/sugarlang/runtime/compile/variant-cache.ts` |
| Live-render cache (memory) | `packages/plugins/src/catalog/sugarlang/runtime/compile/live-render-cache.ts` |
| Runtime live-render verifier | `packages/plugins/src/catalog/sugarlang/runtime/compile/verify-live-render.ts` |
| Intent artifact contracts | `packages/plugins/src/catalog/sugarlang/runtime/contracts/line-intent.ts` |
| Baked variant contracts | `packages/plugins/src/catalog/sugarlang/runtime/contracts/baked-variant.ts` |
| Compile scheduler | `packages/plugins/src/catalog/sugarlang/runtime/compile/compile-scheduler.ts` |
| Mixed-text envelope predicate | `packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-rule.ts` |
| Language ratio classifier | `packages/plugins/src/catalog/sugarlang/runtime/classifier/language-ratio.ts` |
| Studio exception report | `packages/plugins/src/catalog/sugarlang/ui/shell/variant-report.tsx` |
| Studio variants popover | `packages/plugins/src/catalog/sugarlang/ui/shell/variants-popover.tsx` |

## Rendering Ladder

### Tier A1: Deterministic diglot weave (anchored / supported postures)

The authored English text is used as the frame. Words that resolve via the
atlas to prescription-introduced lemmas are substituted with their citation
form (lemmaId bare, no glossing markup inline). Output is built
character-by-character with no model call.

Rules:
- Chunk constituent match takes priority over single-word substitution: if a
  resolved lemma is a constituent of an inventory chunk, the chunk's primary
  surface form is substituted instead.
- Each English word is substituted at every occurrence in the line.
- If no substitutions are possible, the original English is returned unchanged.
- The introduce list for the weave is built from TWO sources merged:
  (1) the prescription's `targetVocab.introduce` list; (2) a gloss scan of the
  authored English text itself (words with atlas resolutions, length >= 3,
  de-duplicated). This ensures the weave produces output even for lines with
  no compiled scene lexicon (new scenes, uncomped regions).

```typescript
// diglot-weave.ts
export interface DiglotWeaveResult {
  text: string;
  weavedForms: WeavedForm[];  // one entry per distinct substituted word
}

export interface WeavedForm {
  targetForm: string;    // citation form placed in the text
  lemmaId: string;       // target-lang lemma this represents
  englishGloss: string;  // original English word (for observe middleware)
}
```

After weaving, `constraint.targetVocab.introduce` is updated to contain only
the woven forms. The observe middleware then highlights exactly what was
substituted.

**Inflected-form substitution is deferred.** The atlas morphology data is
surface-to-lemma only; an inverse index (lemma + features -> surface form) does
not exist. Citation forms (e.g. `comer`, not `comiendo`) are placed as-is.
Revisit when citation-form output reads as grammatically wrong to a learner
past A2, or when a native reviewer flags weave grammar. (See deferred seam
comment in `diglot-weave.ts`.)

### Tier B1: Baked variants (target-dominant posture; B1/B2/C1/C2 bands)

Full-L2 variants are generated at Studio bake time by `generateVariant`, run
through four verification gates, and stored in the variant cache. At runtime
the scripted middleware reads from the cache -- zero LLM calls.

Variants are keyed by:

```typescript
type VariantCacheKey = {
  variantPromptVersion: string;  // VARIANT_PROMPT_VERSION constant
  lang: string;
  band: CEFRBand;
  contentHash: string;           // [nodeId, text, JSON.stringify(intent)].join("|")
};
```

The IDB database name is `sugarlang-variant-cache:${workspaceId}` where
`workspaceId = "sugarlang-studio:${gameProject.identity.id}"`. The object store
is `"sugarlang-variants"`. `MemoryVariantCache` is used in tests and server-side
bake runs.

The runtime variant cache is wired through the preview boot payload. Studio
includes `studioWorkspaceId` in `SugarlangPreviewBootPayload`; the plugin `init`
reads it via `extractSugarlangStudioWorkspaceId` and calls
`services.wireStudioVariantCache(studioWorkspaceId)`, which instantiates an
`IndexedDBVariantCache` against the Studio origin's IDB (shared because Studio
and Preview run on the same origin). If `studioWorkspaceId` is absent from the
boot payload, `variantCache` is undefined and the middleware degrades silently.

On a cache miss at runtime, the middleware degrades to the diglot weave (Tier
A1) so the turn always completes.

### Tier C: Directed live render (wired in 087.5)

The live-render trigger is deterministic: a scheduled due teachable whose id
appears in the line's `mustConveyFacts` AND `!schedule.strainSuppressed`. When
triggered, the middleware calls the LLM with the due word as the introduce
target, verifies with three deterministic gates (no LLM fidelity judge at
runtime), and caches the result in `LiveRenderCache`. On any verify failure
the baked variant plays instead. Gateway down = baked variant plays, no
visible failure.

The trigger reads the `sugarlang.schedule` annotation (written by the context
middleware) and the intent artifact from `intentCache` (baked by the compile
pipeline on dialogue save). Both must be present for the trigger to fire;
absence of either degrades gracefully to the baked variant.

`LiveRenderCache` is in-memory only (Map-backed), keyed by:

```typescript
type LiveRenderCacheKey = {
  nodeId: string;
  dialogueDefinitionId: string;
  lang: string;
  band: CEFRBand;
  posture: SupportPosture;
  teachablesKey: string;  // sorted lemmaIds joined, from buildTeachablesKey()
};
```

## Intent Format

Intent is authored on each dialogue node in Studio via the Variants popover.
It is the ground truth for what the line must communicate; it drives variant
generation and fidelity verification.

```typescript
interface LineIntentFields {
  mustConveyFacts?: string[];  // discrete English fact strings, one per item
  beat?: string;               // dramatic beat label, e.g. "reluctant reveal"
  voiceNote?: string;          // voice direction, e.g. "warm but guarded"
}
```

At bake time, `extractIntent` (compile-scheduler intent pipeline, wired in
`rebuildSugarlangCompileCache` in 087.5) extracts a structured
`LineIntentArtifact` from the authored English text and the authored intent
fields, stored in `IndexedDBIntentCache`. Runtime reads the intent cache to
populate `constraint.targetVocab.introduce` from `mustConveyFacts` when a
baked variant is used, and to match against due teachables for the live-render
trigger.

The intent content hash is computed by `buildIntentContentHash(nodeId, text,
intent?)` (intent-cache.ts), shared between the bake pipeline and the runtime.
Do not use `buildVariantContentHash` for intent keys -- that function uses
`JSON.stringify({})` on both sides deliberately (intent does not factor into
variant cache hits).

```typescript
interface LineIntentArtifact {
  mustConveyFacts: string[];  // facts this line must convey (lemmaId strings)
  beat: string | null;
  voiceNote: string | null;
}
```

## Verification Gates

### Bake-time (four gates -- all must pass for `overallPasses: true`)

Run by `generateVariant` on every LLM-generated variant before caching.

| Gate | Implementation | What it checks |
|------|---------------|----------------|
| 1. Mixed-text envelope | `applyMixedTextEnvelopePredicate` | Non-exempt violations <= allowance; zero non-exempt ceiling exceedances. No coverage floor (the floor fails English-frame text by design). |
| 2. Language ratio | `computeLanguageRatioVerdict` | Target-language token share meets the directed ratio for the posture. |
| 3. Voice retention | `computeVoiceRetentionScore` | Score >= 1.0 (no NPC voice spec at bake time -> always 1.0; score becomes meaningful when a voice spec is available). |
| 4. Fidelity | LLM judge call (`runFidelityCheck`) | All `mustConveyFacts` are present in the generated line. Skipped (passes) when `mustConveyFacts` is empty. On LLM failure: gate fails conservatively. |

A variant with `overallPasses: false` is still cached and still served at
runtime -- `reviewFlag` is an authoring signal only, not a runtime gate. Studio
surfaces flagged variants in the exception report so authors can review and
manually correct them.

### Runtime (three gates -- deterministic only, no LLM fidelity judge)

Run by `verifyLiveRender` on every live-rendered line before caching.

| Gate | What it checks |
|------|----------------|
| 1. Mixed-text envelope | Same predicate as bake gate 1. |
| 2. Language ratio | Same ratio check as bake gate 2. |
| 3. Voice retention | Same voice retention check as bake gate 3. |

A fourth deterministic fidelity floor substitutes for the LLM judge: at least
half the introduce lemmaIds must appear as substrings in the rendered text. This
is a weak floor (substring match, not morphological analysis); it catches
completely wrong renderings without a model call.

### `applyMixedTextEnvelopePredicate` vs `applyEnvelopeRule`

Mixed-text lines (diglot weave, baked variants) MUST use
`applyMixedTextEnvelopePredicate`, NOT `applyEnvelopeRule`.

`applyEnvelopeRule` has an unconditional `coverageRatio >= 0.95` floor.
English-frame tokens fail target-language lemmatization into `unknownTokens`,
collapsing coverage below the floor for any weaved line. The mixed-text
predicate has two legs only: violation allowance and ceiling exceedances.

## Degradation Order

At runtime, for each scripted NPC turn:

1. Posture check:
   - `anchored` or `supported` -> go to step 2 (weave path)
   - `target-dominant` -> go to step 3 (variant path)
2. (Weave path) Run `diglotWeave`. If weavedForms.length > 0, update turn text
   and introduce list. Return turn.
3. (Variant path) If `liveRenderTriggered` (currently always false): attempt
   live render. On success -> use rendered text, cache in `LiveRenderCache`.
   On any failure -> fall through to step 4.
4. (Variant path) If `variantCache` wired: attempt `variantCache.get`. On hit
   -> use baked text. On miss or error -> fall through to step 5.
5. (Degradation) Run `diglotWeave` on the authored English. Produces introduce
   highlights at minimum; turn text is weave output or unchanged English.

Every step fails safe: a JavaScript error anywhere in steps 3-5 falls through
to the next step.

## Studio Exception Report

The exception report (`variant-report.tsx`) surfaces baked variants with
`reviewFlag: true`. It is registered as a workspace section for
`workspaceKind: "sugarlang"`, `sectionId: "variant-report"`.

The report shows: node ID, authored English text, band, generated variant text,
which gates failed and their scores. Authors can read the report without
speaking the target language (English text is always the reference column).

## Studio Variants Popover

The Variants popover (`variants-popover.tsx`) is registered in the dialogue
inspector for each node. It exposes:

- **Intent fields**: Must-Convey Facts (textarea, one fact per line), Dramatic
  Beat (text input), Voice Note (text input). Edited on blur; persists to the
  node's `intent` field via `onUpdateNode`.
- **Generate button**: Triggers bake-time variant generation for all DISPLAY_BANDS
  (`["B1", "B2", "C1", "C2"]`). Shows a spinner while running.
- **Band variant fields**: One textarea per display band. Shows the cached variant
  text; shows a `Flagged` badge in red when `variant.reviewFlag` is true. Editable
  for manual correction via `onUpdateVariant`.
- **Skeleton loading**: While generating, band variant textareas show a skeleton
  placeholder.

## Configuration

No sugarlang config fields are needed for the scripted rendering pipeline.
The deleted `scriptedAdaptationModel` config field (pre-086) was removed when
the unconditional runtime LLM call was deleted.

The compile scheduler picks up variant pipeline options via
`SugarlangAuthoringVariantPipelineOptions` when Studio wires the bake trigger.

## Key Constants

| Constant | File | Value |
|----------|------|-------|
| `VARIANT_PROMPT_VERSION` | `generate-variant.ts` | `"086.3.0"` |
| `INTENT_EXTRACTOR_PROMPT_VERSION` | `extract-intent.ts` | set at 086.1 bake |
| `DISPLAY_BANDS` | `variants-popover.tsx` | `["B1", "B2", "C1", "C2"]` |
| IDB db name | `variant-cache.ts` | `"sugarlang-variant-cache:${workspaceId}"` |
| IDB store name | `variant-cache.ts` | `"sugarlang-variants"` |
