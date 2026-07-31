# Middleware API

Status: Updated in Epic 090

Sugarlang contributes five `conversation.middleware` entries that run in a fixed
order:

1. `sugarlang.context` at stage `context`, priority `10`
2. `sugarlang.teacher` at stage `policy`, priority `30`
3. `sugarlang.scripted` at stage `analysis`, priority `15`
4. `sugarlang.verify` at stage `analysis`, priority `20`
5. `sugarlang.observe` at stage `analysis`, priority `90`

## Runtime Ownership

The plugin owns one runtime service graph in
`packages/plugins/src/catalog/sugarlang/runtime/runtime-services.ts`. The
middlewares share that service graph rather than constructing their own copies
of the atlas, classifier, learner store, or director.

The authored placement tag still flows through:

`NPCDefinition.metadata` -> `ConversationSelectionContext.metadata` ->
`ConversationExecutionContext.selection.metadata`

## Annotation Contract

These middlewares write and read turn-scoped annotations using the shared keys
declared in
`packages/plugins/src/catalog/sugarlang/runtime/middlewares/shared.ts`.

Important keys:

- `sugarlang.learnerSnapshot`
- `sugarlang.pendingProvisionalLemmas`
- `sugarlang.probeFloorState`
- `sugarlang.forceComprehensionCheck`
- `sugarlang.activeQuestEssentialLemmas`
- `sugarlang.questEssentialLemmaIds`
- `sugarlang.placementFlow`
- `sugarlang.prePlacementOpeningLine`
- `sugarlang.directive`
- `sugarlang.constraint`
- `sugarlang.comprehensionCheckInFlight`

## Stage Responsibilities

`sugarlang.context` loads learner state, placement state, and scene vocabulary
data, and writes the prompt-facing learner snapshot.

`sugarlang.teacher` composes the situation, asks the Teacher for a
`PedagogicalDirective`, and produces the final `SugarlangConstraint` that
SugarAgent reads. There is no prescription to merge -- the Teacher decides from
the situation and the learner directly.

`sugarlang.scripted` serves authored dialogue lines, reading the variant baked
for the learner's band rather than generating text.

`sugarlang.verify` re-checks the generated text against the envelope classifier,
attempts one repair call, and falls back to deterministic auto-simplification.

`sugarlang.observe` turns completed turns plus player input into learner-state
events and probe lifecycle updates.

## SugarAgent Integration

SugarAgent's `GenerateStage` reads
`execution.annotations["sugarlang.constraint"]` before prompt assembly.

Two behaviors are now live:

- Normal turns append the Sugarlang constraint block to the system prompt.
- Pre-placement opening dialog turns bypass prompt assembly entirely and return a
  direct `ConversationTurnEnvelope`, which skips LLM generation, audit, and
  repair.
- Placement questionnaire turns also bypass LLM generation. SugarAgent returns a
  deterministic envelope with `inputMode: "placement_questionnaire"` and the
  questionnaire payload in turn metadata so the conversation host can render the
  form UI directly.

## Placement Flow Ownership

Epic 11 tightens the phase split:

- `sugarlang.context` computes and annotates the placement phase, stages the
  questionnaire metadata, and keeps replay inertness authoritative.
- `sugarlang.teacher` skips work during the questionnaire phase.
- `sugarlang.observe` bypasses opening-dialog and questionnaire display turns,
  then applies placement completion plus quest proposals on the questionnaire
  submission turn.
