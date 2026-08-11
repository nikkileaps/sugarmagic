# API 017: Sugarlang Scripted-Mode Rendering

## Purpose

The scripted-mode rendering pipeline adapts authored English NPC dialogue to
the learner's current level, making ZERO LLM calls at runtime.

**This document described a three-tier ladder until 2026-07-31 and the shape has
changed.** What actually runs now is two tiers, and one of them is on its way
out:

1. **Baked variants (primary, every band A1-C2).** The line is pre-rendered per
   band at authoring time in Studio and read from cache at runtime. Baking is
   where the LLM call happens; the runtime only reads.
2. **No fallback.** A line with no baked variant serves the AUTHORED ENGLISH,
   unchanged. It is untaught but correct and readable, which beats a line
   half-rewritten by a mechanism that made no pedagogical decision.

CORRECTED 2026-08-01. This document described a cache-miss fallback called
`applyWeave` that substituted target words into the authored line. It was
deleted in rf6.5.2 and no such function exists. Its removal also fixed an
inversion where the FALLBACK line highlighted and the correctly BAKED line did
not.

Item text follows the same rule, via `display-text-resolver`: a baked variant
for the band, else the authored English. Nothing in the system rewrites finished
text.

DELETED, despite appearing below: the standalone diglot-weave module, the
citation-form substitution that replaced it (`markGradedText`), and the
directed live-render tier (unwired in 090.8c -- `live-render-cache.ts` and
`verify-live-render.ts` still exist as files but nothing in the middleware
imports them).

The zero-LLM floor is contractual: authored mode is playable offline with no
gateway present.

## Files

| Role | Path |
|------|------|
| Scripted middleware | `packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-scripted-middleware.ts` |
| Display-text resolver (item text -> baked variant, else authored English) | `packages/plugins/src/catalog/sugarlang/runtime/grading/display-text-resolver.ts` |
| Bake-time variant generator | `packages/plugins/src/catalog/sugarlang/runtime/compile/generate-variant.ts` |
| Variant cache (memory + IDB) | `packages/plugins/src/catalog/sugarlang/runtime/compile/variant-cache.ts` |
| Live-render cache (memory) -- UNWIRED, no middleware imports it | `packages/plugins/src/catalog/sugarlang/runtime/compile/live-render-cache.ts` |
| Runtime live-render verifier -- UNWIRED | `packages/plugins/src/catalog/sugarlang/runtime/compile/verify-live-render.ts` |
| Intent artifact contracts | `packages/plugins/src/catalog/sugarlang/runtime/contracts/line-intent.ts` |
| Baked variant contracts | `packages/plugins/src/catalog/sugarlang/runtime/contracts/baked-variant.ts` |
| Compile scheduler | `packages/plugins/src/catalog/sugarlang/runtime/compile/compile-scheduler.ts` |
| Mixed-text envelope predicate | `packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-rule.ts` |
| Language ratio classifier | `packages/plugins/src/catalog/sugarlang/runtime/classifier/language-ratio.ts` |
| Studio exception report | `packages/plugins/src/catalog/sugarlang/ui/shell/variant-report.tsx` |
| Studio variants popover | `packages/plugins/src/catalog/sugarlang/ui/shell/variants-popover.tsx` |

## Rendering Ladder

### Citation-form substitution (deleted)

There is no substitution tier. Nothing splices target-language words into
authored English, on either the scripted path or the display-text path.

WHY, since "it taught a few words for free" is a real argument: for a verb the
citation form is the INFINITIVE, so the mechanism deterministically wrote
`necesitar` where the sentence needed `necesitas` -- ungrammatical output on
every verb it touched, with no model involved and no verdict recording it.

Beginner bands are not left untaught. They read baked variants like every other
band, generated at the anchored ratio their posture directs.

Generating an inflected form would need an inverse morphology index (lemma +
features -> surface form), which does not exist and is not planned -- nothing
generates forms from features. Recognizing a conjugated form for MATCHING is a
separate open question; see `sugarmagic-morphology-2z1`.

### Tier B1: Baked variants -- NOW EVERY BAND, NOT JUST B1+

`DIALOGUE_VARIANT_BANDS` is A1 through C2 (`runtime/contracts/baked-variant.ts`).
A1/A2 joined the baked set in 090.11; the blocker had been `GradedTextService`
defaulting posture to target-dominant, so a beginner bake was verified against a
B1+ ratio. `generateVariant` now passes posture and directed ratio explicitly.

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

ONE SOURCE PER HOST, and never a fallback chain between them.

In **Studio** the live workspace database wins, so a variant edited in the
popover appears in Preview without saving first.

In a **deployed game** the variants come from the file the game shipped with
(`assets/sugarlang/variants.json`), loaded once at plugin init into an
in-memory cache and served from there. Both places that look up a variant --
scripted dialogue lines and item or document text -- read the same one.

A chain, where the deployed game tried the database and fell back to the file,
is how the absence of the file went unnoticed for months: a working source
covers for a broken one and nothing reports the difference. Until Plan 092.4 a
deployed game had no variants at all, so every scripted line and every item
description rendered the authored English at every band, with the graded text
sitting unread in a file the player had already downloaded.

The in-memory cache is sized from the shipped set rather than left at its
default, which evicts least-recently-used silently -- a line would render
graded text one moment and English the next with nothing in the log. That
ceiling is a workaround for the file not being scoped per episode
(`sugarmagic-boot-scoping-j24`).

On a cache miss at runtime, the middleware serves authored English -- there is no substitution fallback (Tier
A1) so the turn always completes.

### Tier C: Directed live render -- DELETED (unwired in 090.8c)

Kept below for the record only. Nothing in the scripted middleware imports the
live-render cache or its verifier any more.

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

Authored intent is read directly off the dialogue node. Nothing extracts a
separate artifact from it.

A bake pass used to: it called the gateway per line, built a
`LineIntentArtifact`, and cached it for the live-render trigger to match
against. That trigger was deleted (Tier C above), which left a pass that spent
money every rebuild and wrote a cache nothing read -- including variant
generation, whose only caller passes `intent: null`. Removed in Plan 092.7.

Variants are keyed by `buildDialogueNodeContentHash(nodeId, text)`
(dialogue-node-source.ts), which puts `JSON.stringify({})` in the intent slot
deliberately: intent goes into the LLM prompt, not the key, so a cache hit
survives a hand-authored intent edit. There is no second hash -- the separate
intent hash went with the extraction pass.

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
| 1. Mixed-text envelope | `applyEnvelopeRule` | Non-exempt violations <= allowance; zero non-exempt ceiling exceedances. The coverage floor gates nowhere any more (latency epic, 2026-08-06), so this is the ONE envelope rule for every path. |
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

### One envelope rule

`applyMixedTextEnvelopePredicate` was deleted when the coverage floor stopped
gating (latency epic, 2026-08-06): with the floor demoted to a metric, it and
`applyEnvelopeRule` were the same rule. Every path -- bake, live render, and
the runtime verify instrument -- now calls `applyEnvelopeRule`.

## Degradation Order

At runtime, for each scripted NPC turn:

Every band takes the same path -- there is no posture fork and no substitution
step.

1. If `liveRenderTriggered` (currently always false): attempt live render. On
   success -> use rendered text, cache in `LiveRenderCache`. On any failure ->
   fall through to step 2.
2. If `variantCache` is wired: attempt `variantCache.get` for this band. On hit
   -> use the baked text and attach its baked `highlight`. On miss or error ->
   fall through to step 3.
3. (Degradation) Serve the authored English UNCHANGED. Untaught but correct and
   readable, which beats a line half-rewritten by a mechanism that made no
   pedagogical decision.

Beginner postures used to fork at step 1 into a substitution path that spliced
citation forms into the authored English. That path is deleted; anchored and
supported now read a baked variant like every other band, generated at the
ratio their posture directs.

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
