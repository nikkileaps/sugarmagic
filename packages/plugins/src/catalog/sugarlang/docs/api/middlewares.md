# Middleware API

Status: Updated in Epic 11

Sugarlang contributes four `conversation.middleware` entries that run in a fixed
order:

1. `sugarlang.context` at stage `context`, priority `10`
2. `sugarlang.director` at stage `policy`, priority `30`
3. `sugarlang.verify` at stage `analysis`, priority `20`
4. `sugarlang.observe` at stage `analysis`, priority `90`

## Runtime Ownership

The plugin owns one runtime service graph in
`packages/plugins/src/catalog/sugarlang/runtime/runtime-services.ts`. The
middlewares share that service graph rather than constructing their own copies
of the atlas, classifier, budgeter, learner store, or director.

The authored placement tag still flows through:

`NPCDefinition.metadata` -> `ConversationSelectionContext.metadata` ->
`ConversationExecutionContext.selection.metadata`

## Annotation Contract

These middlewares write and read turn-scoped annotations using the shared keys
declared in
`packages/plugins/src/catalog/sugarlang/runtime/middlewares/shared.ts`.

Important keys written during Epic 10:

- `sugarlang.prescription`
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

`sugarlang.context` loads learner state, placement state, and scene lexicon
data, then writes the lexical prescription and prompt-facing learner snapshot.

`sugarlang.director` merges the prescription with a pedagogical directive and
produces the final `SugarlangConstraint` that SugarAgent reads.

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
- `sugarlang.director` skips work during the questionnaire phase.
- `sugarlang.observe` bypasses opening-dialog and questionnaire display turns,
  then applies placement completion plus quest proposals on the questionnaire
  submission turn.
