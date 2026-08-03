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
`finalize`, in that order. Scripted at 15 runs BEFORE verify at 20 -- lower
priority sorts first. (The header comment in `sugar-lang-scripted-middleware.ts`
claimed "after verify at 20" until 2026-07-31; it was backwards, and harmless
only because the two never touch the same turn: scripted only handles
`scripted-dialogue` turns and verify skips them.)

## What Each Middleware Does

**`sugarlang.context` (context, 10).** Loads the learner profile and scene
vocabulary, and drives the placement flow state machine (opening-dialog ->
questionnaire -> closing-dialog). Writes the per-turn annotations everything
downstream reads: `sugarlang.learnerSnapshot`,
`sugarlang.pendingProvisionalLemmas`, `sugarlang.probeFloorState`,
`sugarlang.activeQuestEssentialLemmas`, `sugarlang.placementFlow`, and the
pre-placement opening line. Emits `pre-placement.opening-dialog-turn`.

It also THROWS `SugarlangMissingTargetLanguageError` when no target language
resolves. That is deliberate and is the runtime's rule only: Studio tolerates a
null language (a freshly installed plugin has none) and preview refuses to
launch with a visible error. Reaching this middleware without one means a built
game shipped misconfigured, and the previous behaviour -- returning early --
ran every conversation with sugarlang silently inert.

**`sugarlang.teacher` (policy, 30).** Composes the `Situation` and invokes the
Teacher (`runtime/teacher/sugar-lang-teacher.ts`): directive cache first, then
the Claude policy via the gateway, then the deterministic fallback policy. Turns
the resulting `PedagogicalDirective` into the `sugarlang.constraint` annotation
(including the `generatorPromptOverlay` string the NPC generator splices
verbatim), decides comprehension-probe triggering against the probe floor, and
short-circuits with a fixed pre-placement directive during the opening dialog.

There is no prescription to merge. The Lexical Budgeter was deleted in Epic 090
-- the Teacher reads the situation and the learner directly and decides for
itself. See the plugin-local
`docs/api/domain-model.md` for why (a concept is demand, a teachable is supply).

The Director system prompt includes `DIRECTOR_PRAGMATIC_FEEDBACK_BLOCK`
(085.6): when the player uses or attempts a communicative function the NPC has
modeled, the NPC reacts with in-fiction warmth (correct use) or gentle
confusion (misuse). Explicit correction-as-correction is prohibited. The NPC
never breaks the fourth wall to comment on grammar or pragmatic errors.

The `interpretLexicon` contribution (084.5, now inventory-sourced in 085.6)
is built from `buildInterpretLexiconFromInventory(targetLanguage)` instead
of a hardcoded constant. Only the four categories consumed by
`interpretation.ts` (farewell, greeting, gratitude, acknowledgement) are
populated; functions without `interpretLexiconCategory` (including item-zero
meta-language chunks) do not contribute.

**`sugarlang.scripted` (analysis, 15).** Scripted-dialogue turns only, and it
makes ZERO LLM calls. It reads the VARIANT baked for this line at the learner's
band (`runtime/compile/variant-cache.ts`) and replaces `turn.text` with it.
Baking happens at authoring time in Studio, not here.

On a cache miss it serves the AUTHORED ENGLISH, unchanged. CORRECTED
2026-08-01: this described a fallback called `applyWeave` that substituted
target words into the authored line. It was deleted in rf6.5.2 and no such
function exists -- an untaught but correct line beats one half-rewritten by a
mechanism that made no pedagogical decision.

Item text follows the same rule, via `display-text-resolver`: a baked variant
for the band, else the authored English. No code in the system rewrites
finished text.

Narrator, player-VO, and excerpt speakers are never adapted.

**`sugarlang.verify` (analysis, 20).** Free-form turns only (skips scripted
mode and player-spoken turns). Runs the envelope classifier over the
generated text against the learner profile and the directive's slate; on
violations, attempts one LLM repair and re-checks it. If that fails the original
turn ships unchanged. See "Verify Enforcement Scope" below.

**`sugarlang.observe` (analysis, 90).** The single place raw turn/input
context becomes learner observations: hover events, choice selections,
free-text production, and rapid-advance signals are converted to
`ObservationEvent`s and routed to the `LearnerStateReducer`. Also owns the
probe lifecycle back half (classifying the player's probe response into
passed/failed/mixed, language fallback detection, committing or discarding
provisional evidence) and emits `placement.completed` when the questionnaire
scores out.

**Chunk detection (085.3/085.5).** Observe also runs the chunk matcher
(`createChunkMatcher`) over the scene lexicon's chunk list. NPC turn text is
scanned for chunk matches and emits `chunk-encountered` observations that
create/update chunk cards (`lemmaId = "chunk:<chunkId>"`). Player free-text
input and scripted player lines emit `chunk-produced`. First encounter of a
chunk tied to a communicative function (the function has no existing teach
record) triggers the explicit teach beat: one `TeachRecord` is written via
`TeachRecordStore` and one `dialogueTeachLine` annotation (`{ label, text }`)
is written onto the turn. `DialoguePanel` renders the annotation below the
turn text in the enrichment slot (`enrichmentContainer`, CSS class
`sm-dialogue-teach-line`). Only one teach-line annotation is written per turn
(earliest new function wins). Chunk cards are excluded from the probe and
teacher-summary systems.

## The Teaching Decision Model (Concept-Opportunity Gating)

The teaching architecture in one sentence: **the TEACHER decides, the model
RENDERS, the verifiers CHECK.** The teacher looks at the full context of the
moment (the quest, the NPC being talked to, the scene, the learner's state)
for opportunities to teach a CONCEPT -- which may surface as vocabulary, a
communicative function, or pragmatics -- then gates each opportunity against
what the learner already knows. The generation LLM is directed to work the
chosen concepts into the target language; the observe loop expects the target
forms back and converts encounters into learner evidence.

The gating ladder, and where each rung lives in the machinery:

| Gating question | Outcome | Machinery |
|---|---|---|
| Already learned it? | Skip, next opportunity | Lemma cards + FSRS review state, read through `getLearningStatus` (`runtime/learner/learning-status.ts`): `known` and `learning` are neither introduced nor reinforced |
| Due for review? | Reinforce | `getLearningStatus` returns `due` below `DUE_RETRIEVABILITY_FLOOR` |
| Too hard, not ready? | Skip, next opportunity | `getLearningStatus` returns `out-of-reach`; the band envelope caps candidates at learner band + 1 |
| How many at once? | Cap the slate | `getIntroduceCapForBand` (`runtime/teacher/band-envelope.ts`): A1 3, A2 4, B1/B2 5, C1/C2 6 |
| Brand new? | Fresh introduction | Prescription `introduce` list; scheduler `TeachReason: "introduction"` (`runtime/scheduler/teach-schedule.ts`) |
| Seen before? | Reinforce -- an in-context opportunity can beat the schedule | Prescription `reinforce` list; scheduler `due` / `debt-service` reasons. (The "great chance even if not quite due" opportunistic case is not yet modeled.) |
| Probably understood? | Probe for comprehension | Probe floors + `comprehensionCheck` on the directive (`runtime/middlewares/sugar-lang-teacher-middleware.ts`); observe owns probe response classification |

Scope note on candidate sourcing: today the pool of teachable candidates
comes from the compiled scene lexicon
(`runtime/compile/compile-sugarlang-scene.ts`), which tokenizes authored text
and resolves English words to target lemmas via the atlas gloss index
(`resolveFromGloss`). That lexical scan is the AMBIENT layer -- it powers
hover glosses and gives the classifier a deterministic candidate pool -- but it
only sees literal word matches in authored text. Concept-level opportunity
detection (an NPC whose character is about cheese making "queso" teachable
without the literal word "cheese" appearing in a scanned blob) is not part of
this pipeline.

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
observe, and the NPC generator. It is the Teacher's `PedagogicalDirective`
re-expressed for the renderer -- where a directive is a DECISION, a constraint
is INSTRUCTIONS to whatever produces the text:

- `targetVocab` (introduce / reinforce / avoid). These hold `TeachableRef`s, not
  bare lemmas: a teachable is `{kind: "vocabulary", lemmaId}` or
  `{kind: "competency", competencyId}`.
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
2. **The original ships.** If no candidate beats the original, that is the end
   of the ladder. The turn goes out as written -- out of envelope, but
   grammatical and meaningful -- and the verdict records the violation.

   There is no second, deterministic fallback. One existed until 2026-08-02:
   it rewrote the finished line, swapping each out-of-band lemma for a
   lower-band one chosen by band and part of speech with no notion of meaning.
   It produced text that passed the band check and said nothing. Untaught but
   correct beats rewritten into nonsense.

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
