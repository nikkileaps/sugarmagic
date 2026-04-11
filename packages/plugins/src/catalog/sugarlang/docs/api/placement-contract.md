# Placement Contract API

Status: Updated in Epic 11

This document describes the full v1 Sugarlang placement capability: how a
placement-tagged NPC is detected, how the questionnaire is rendered and scored,
how completion is persisted, and where the v1 boundaries stop.

## Placement NPC Tag

Sugarlang activates placement through authored NPC metadata:

```ts
npc.metadata = {
  sugarlangRole: "placement"
};
```

The metadata path is:

`NPCDefinition.metadata` -> `ConversationSelectionContext.metadata` ->
`ConversationExecutionContext.selection.metadata`

That makes authored NPC tags the single source of truth for placement
activation. Placement is not enabled by NPC id lists or per-project runtime
tables.

## Runtime Phases

Placement is a four-state runtime contract:

- `not-active`
- `opening-dialog`
- `questionnaire`
- `closing-dialog`

State transitions are owned by
`runtime/placement/placement-flow-orchestrator.ts` and used by the Context
middleware.

Rules:

- `not-active -> opening-dialog` when the selected NPC has
  `metadata.sugarlangRole === "placement"` and the placement fact is not
  completed.
- `opening-dialog -> questionnaire` after
  `config.placement.openingDialogTurns` turns.
- `questionnaire -> closing-dialog` when the player submits the form.
- `closing-dialog -> not-active` after
  `config.placement.closingDialogTurns` turns.

The phase is exposed per turn through
`execution.annotations["sugarlang.placementFlow"]`.

## Pre-Placement Opening Dialog

Opening-dialog turns bypass the normal adaptive language pipeline.

- No Budgeter work
- No Teacher'scall
- No LLM call
- No learner observation extraction

Instead, Sugarlang stages an authored support-language line in
`constraint.prePlacementOpeningLine`, and SugarAgent returns that line verbatim
as the NPC turn.

## Questionnaire Ownership

The plugin owns one canonical questionnaire per supported language, shipped at:

- `data/languages/es/placement-questionnaire.json`
- `data/languages/it/placement-questionnaire.json`

The single runtime loader is
`runtime/placement/placement-questionnaire-loader.ts`.

V1 rule: projects do not replace or mutate these banks. They can choose which
NPC is the placement NPC, but not the underlying questionnaire content.

## Questionnaire UI

Placement uses a plugin-owned form primitive, not a normal dialogue turn.

- Runtime host renderer:
  `packages/runtime-core/src/dialogue/DialoguePanel.ts`
- Shell-side reusable React primitive:
  `ui/shell/placement-questionnaire-panel.tsx`

When `execution.annotations["sugarlang.placementFlow"]?.phase === "questionnaire"`,
SugarAgent returns a deterministic envelope with `inputMode:
"placement_questionnaire"` and the questionnaire payload in turn metadata. The
conversation host switches to the form renderer and submits a
`ConversationPlayerInput` carrying a `PlacementQuestionnaireResponse`.

## Placement Scoring

`runtime/placement/placement-score-engine.ts` is the single enforcer of scoring.
It is pure and deterministic.

Per-question rules:

- `multiple-choice`: correct when the selected option is marked `isCorrect`
- `yes-no`: correct when the submitted answer matches `correctAnswer`
- `fill-in-blank`: correct when the raw answer matches an accepted form or the
  lemmatized answer matches an accepted lemma
- `free-text`: correct when at least one expected lemma appears in the
  lemmatized response, or the whole response matches an accepted form

Band determination:

- Find the highest CEFR band where `correct / total >= 0.7`
- If A1 itself is below `0.5`, clamp the result to `A1`

Confidence:

- Confidence is derived from `answeredCount / totalCount`
- The value is clamped to `[0.3, 0.95]`

Free-text seeding:

- Correct `free-text` and `fill-in-blank` answers contribute
  `lemmasSeededFromFreeText`
- Stopwords are excluded
- Only atlas-known lemmas are seeded

## Completion Contract

Placement completion happens in the Observe middleware on the submission turn.

Effects:

- Apply `PlacementCompletionEvent` through the learner reducer
- Write `SUGARLANG_PLACEMENT_STATUS_FACT`
- Append quest action proposals for:
  - `setFlag("sugarlang.placement.status", "completed")`
  - `notifyEvent("sugarlang.placement.completed")`

The reducer is also where FSRS seeding from placement free-text happens. Each
seeded lemma receives a synthetic `produced-typed` outcome.

## Placement Status Fact

Persistent placement state lives in `SUGARLANG_PLACEMENT_STATUS_FACT` with the
payload:

```ts
{
  status: "not-started" | "in-progress" | "completed";
  cefrBand?: CEFRBand;
  confidence?: number;
  completedAt?: number;
}
```

If nothing has been written yet, Sugarlang treats the value as:

```ts
{ status: "not-started" }
```

## Replay Inertness

Placement is one-shot in v1.

If `SUGARLANG_PLACEMENT_STATUS_FACT.status === "completed"`, the placement tag
becomes inert:

- `sugarlang.placementFlow` is not activated again
- No questionnaire UI is shown
- The normal Budgeter -> Teacher's-> Verify -> Observe path runs
- The NPC behaves like a normal Sugarlang conversational NPC

## Configuration

`config.ts` owns the placement configuration surface:

```ts
placement: {
  enabled: boolean;
  minAnswersForValid: number | "use-bank-default";
  confidenceFloor: number;
  openingDialogTurns: number;
  closingDialogTurns: number;
}
```

Defaults:

- `enabled: true`
- `minAnswersForValid: "use-bank-default"`
- `confidenceFloor: 0.3`
- `openingDialogTurns: 2`
- `closingDialogTurns: 2`

Behavior:

- `enabled: false` disables placement entirely; the placement NPC tag is ignored
- `minAnswersForValid` overrides the bank default shown in the questionnaire UI
- `confidenceFloor` does not reject results; it is a warning threshold
- `openingDialogTurns` and `closingDialogTurns` tune the wrapper pacing

## Teacher'sBoundary

Placement is not Director-owned.

The Teacher'sis bypassed during `opening-dialog` and skipped entirely during the
`questionnaire` phase. It only re-enters for normal closing-dialog turns after a
known CEFR estimate exists.

## v1 Scope Boundaries

### Supported in v1

- One canonical plugin-shipped questionnaire per supported language
- Any NPC can be the placement NPC via `metadata.sugarlangRole = "placement"`
- Three active runtime phases: opening-dialog, questionnaire, closing-dialog
- Deterministic scoring with CEFR estimate and confidence
- FSRS seeding from correct free-text production
- Replay inertness after completion
- Quest integration through `setFlag` and `notifyEvent`
- A global plugin-config disable switch

### Explicitly not supported in v1

- Per-NPC custom questionnaire overrides
- Per-project custom questionnaires
- Re-placement after initial completion
- Adaptive or branching question selection
- Multi-session placement persistence
- Audio or image-based questions
- Per-learner questionnaire customization
- Partial-credit scoring
