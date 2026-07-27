# API 013: Sugarlang Conversation Middlewares

## Purpose

This document covers Sugarlang's five conversation middlewares: their stages
and priorities, what each does, the turn-path guard that decides whether
Sugarlang runs at all, the `sugarlang.constraint` annotation seam, and the
honest scope of what the verify middleware actually enforces.

## Pipeline Ordering

Middlewares are sorted by the conversation host
(`sortMiddlewares` in `packages/runtime-core/src/conversation/index.ts`):
stage order `context -> policy -> generic -> analysis`, then ascending
`priority` within a stage. The SAME sorted order is used for both `prepare`
(before the provider generates) and `finalize` (after).

The five Sugarlang middlewares (registered via `SUGARLANG_MIDDLEWARE_FACTORIES`
in `packages/plugins/src/catalog/sugarlang/manifest.ts`):

| Middleware id | Stage | Priority | Hook | File (runtime/middlewares/) |
|---|---|---|---|---|
| `sugarlang.context` | `context` | 10 | `prepare` | `sugar-lang-context-middleware.ts` |
| `sugarlang.teacher` | `policy` | 30 | `prepare` | `sugar-lang-teacher-middleware.ts` |
| `sugarlang.scripted` | `analysis` | 15 | `finalize` | `sugar-lang-scripted-middleware.ts` |
| `sugarlang.verify` | `analysis` | 20 | `finalize` | `sugar-lang-verify-middleware.ts` |
| `sugarlang.observe` | `analysis` | 90 | `finalize` | `sugar-lang-observe-middleware.ts` |

Effective per-turn order: context and teacher run in `prepare`; then the
provider generates the turn; then scripted, verify, and observe run in
`finalize`, in that order. (The header comment in
`sugar-lang-scripted-middleware.ts` says "after verify at 20"; the sort says
otherwise -- 15 runs before 20. In practice the two never touch the same
turn: scripted only handles `scripted-dialogue` turns and verify skips them.)

## What Each Middleware Does

**`sugarlang.context` (context, 10).** Loads the learner profile and scene
lexicon, drives the placement flow state machine (opening-dialog ->
questionnaire -> closing-dialog), and runs the lexical budgeter. Writes the
per-turn annotations everything downstream reads: `sugarlang.prescription`,
`sugarlang.learnerSnapshot`, `sugarlang.pendingProvisionalLemmas`,
`sugarlang.probeFloorState`, `sugarlang.activeQuestEssentialLemmas`,
`sugarlang.placementFlow`, and the pre-placement opening line. Emits
`budgeter.prescription-generated` and `pre-placement.opening-dialog-turn`.

**`sugarlang.teacher` (policy, 30).** Invokes the Director
(`runtime/teacher/sugar-lang-teacher.ts`): directive cache first, then the
Claude policy via the gateway, then the deterministic fallback policy. Merges
the resulting `PedagogicalDirective` with the context-stage prescription into
the final `sugarlang.constraint` annotation (including the
`generatorPromptOverlay` string the NPC generator splices verbatim), decides
comprehension-probe triggering against the probe floor, and short-circuits
with a fixed pre-placement directive during the opening dialog.

**`sugarlang.scripted` (analysis, 15).** Scripted-dialogue turns only. Takes
the authored English line, scans it for teaching candidates via the
gloss index (`atlas.resolveFromGloss`), and calls the LLM
(`scriptedAdaptationModel` config, default `claude-haiku-4-5-20251001`) to
adapt the line to the learner's level using the constraint's prompt overlay,
preserving meaning and quest content. Replaces `turn.text` with the adapted
line; on any LLM failure it falls back to the authored text. Narrator,
player-VO, and excerpt speakers are never adapted.

**`sugarlang.verify` (analysis, 20).** Free-form turns only (skips scripted
mode and player-spoken turns). Runs the envelope classifier over the
generated text against the learner profile + prescription; on violations,
attempts one LLM repair, re-checks it, and if that fails applies the
deterministic `autoSimplify` substitution fallback. See "Verify Enforcement
Scope" below.

**`sugarlang.observe` (analysis, 90).** The single place raw turn/input
context becomes learner observations: hover events, choice selections,
free-text production, and rapid-advance signals are converted to
`ObservationEvent`s and routed to the `LearnerStateReducer`. Also owns the
probe lifecycle back half (classifying the player's probe response into
passed/failed/mixed, language fallback detection, committing or discarding
provisional evidence) and emits `placement.completed` when the questionnaire
scores out.

## Turn-Path Guard

**File:** `packages/plugins/src/catalog/sugarlang/runtime/middlewares/shared.ts`

Every middleware calls `shouldRunSugarlangForExecution(execution)` first.
The gate is on `execution.selection.conversationKind` -- NOT on
`interactionMode`:

```typescript
switch (kind) {
  case "scripted-dialogue":
    return true;
  case "free-form":
    return typeof execution.selection.npcDefinitionId === "string" &&
           execution.selection.npcDefinitionId.length > 0;
  default: {
    const _exhaustive: never = kind;   // compile error on new kinds
    return false;
  }
}
```

The `never`-typed default makes the switch exhaustive: adding a new
`conversationKind` to runtime-core fails compilation here until Sugarlang
decides how to handle it. `isScriptedMode` uses the same discriminator
(`conversationKind === "scripted-dialogue"`) and is deliberately not fooled
by `interactionMode: "scripted"` on a free-form selection.

The structural guard test
(`tests/middlewares/execution-gates.test.ts`) pins all five entry paths:
interact-agent (free-form + npcDefinitionId), interact-scripted, and the
followup / quest / spell `.start` paths (scripted-dialogue with no
interactionMode), plus the negative cases.

## The `sugarlang.constraint` Annotation Seam

**Key:** `SUGARLANG_CONSTRAINT_ANNOTATION = "sugarlang.constraint"`
(`runtime/middlewares/shared.ts`)
**Type:** `SugarlangConstraint` (`runtime/contracts/pedagogy.ts`)

Written once per turn by the teacher middleware; read by scripted, verify,
observe, and the NPC generator. It is the merged, final form of the
Director's directive + the budgeter's prescription:

- `targetVocab` (introduce / reinforce / avoid lemma lists)
- `supportPosture`, `targetLanguageRatio`, `interactionStyle`,
  `glossingStrategy`, `sentenceComplexityCap`
- `targetLanguage`, `learnerCefr`
- `comprehensionCheckInFlight` (probe style, target lemmas, voice reminder)
- `questEssentialLemmas` (exempt from envelope enforcement, must be glossed)
- `prePlacementOpeningLine` (generator bypass: return the authored line
  verbatim)
- `rawPrescription` (the unmerged `LexicalPrescription` for the classifier)
- `generatorPromptOverlay` (pre-formatted prompt string; the generator
  splices it without interpreting fields -- this keeps sugarlang and
  sugaragent composable but independent)
- `minimalGreetingMode`

## Verify Enforcement Scope

**File:** `packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-verify-middleware.ts`

What verify actually checks today is the **lexical envelope only**: the
`EnvelopeClassifier` lemmatizes the generated text and flags lemmas whose
CEFR band falls outside the learner's envelope (with proper nouns, scene
lexicon entries, and quest-essential lemmas exempted). Enforcement ladder on
a violating turn:

1. **LLM repair** -- one `attemptRepair` call (`claude-sonnet-4-6`, max 220
   tokens) asking for a same-meaning rewrite with the violating lemmas
   removed. The repaired text is re-run through the classifier; it is only
   accepted if it now passes (`verify.repair-triggered`).
2. **Deterministic fallback** -- `autoSimplify`
   (`runtime/classifier/auto-simplify.ts`) substitutes the violating lemmas
   from the language's simplifications table (`verify.auto-simplify-triggered`).
3. **Fail-open** -- if autoSimplify throws, the original turn is returned
   unchanged.

**Repair skip conditions.** Two turn types skip the repair ladder entirely
(classifier still runs, telemetry still emits `verify.deterministic-bypass`):

- **Deterministic-backend turns** -- `turn.diagnostics?.llmBackend === "deterministic"`.
  These are canned/fallback replies where re-prompting an LLM makes no sense.
- **Moderation-deflected turns** -- `turn.diagnostics?.moderationDeflected === true`.
  The moderation middleware (stage `policy`, runs before `sugarlang.verify`
  at stage `analysis`) replaces the original NPC reply with a safe canned line
  and stamps this diagnostic. Attempting LLM repair on a moderation replacement
  is wasteful and potentially unsafe.

The `moderationDeflected` key is also exported from
`packages/plugins/src/catalog/sugaragent/runtime/moderation/moderation-middleware.ts`
as `MODERATION_DEFLECTED_DIAG_KEY` for consumers that want to inspect the diagnostic
without hard-coding the string.

**LLM repair prompt hygiene.** The repair system prompt includes an explicit
instruction against inline glosses and parenthetical translations:
`"Do NOT add inline glosses, parenthetical translations, or line-by-line word
pairings. The NPC speaks naturally -- never write a word followed by its
translation on the next line."` This prevents the model from "helping" by
adding `(adiós = goodbye)` annotations to the repaired reply.

The repair prompt also correctly strips LLM markdown code fences before
JSON.parse (`/^```(?:json)?\\s*([\\s\\S]*?)```$/s`), so a model that wraps its
JSON response in a ` ```json ` fence does not fail the best-of-N scorer.

Honest scope notes:

- **Language-ratio conformance is NOT verified.** The constraint's
  `targetLanguageRatio`, `supportPosture`, `sentenceComplexityCap`, and
  `interactionStyle` reach the generator only as prompt guidance via
  `generatorPromptOverlay`; nothing measures the generated turn's actual
  target/support language mix after the fact. Verify checks vocabulary level
  only.
- Verify is gated on the `verifyEnabled` config
  (`packages/plugins/src/catalog/sugarlang/config.ts`): it must be enabled
  explicitly via plugin config or `SUGARMAGIC_SUGARLANG_VERIFY_ENABLED`;
  when off, every generated turn passes through unchanged (with a logged
  bypass notice). The config comment frames this as a temporary debugging
  escape hatch.
- Scripted-dialogue turns are never verified -- adaptation quality there is
  owned by the scripted middleware's prompt, with no post-check.
- Pre-placement opening-dialog turns bypass verification
  (`verify.pre-placement-bypass`).
