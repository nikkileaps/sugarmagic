# Placement Contract API

Status: Updated in Epic 2; cross-referenced in Epic 9; expanded further in Epic 11

This document describes the authoring metadata seam that lets sugarlang identify
the placement NPC before the full placement runtime lands in Epic 11.

## Placement NPC tag

Sugarlang identifies the placement NPC through authored NPC metadata, not
through plugin config and not through hardcoded NPC ids.

Author an NPC with:

```ts
npc.metadata = {
  sugarlangRole: "placement"
};
```

The source field is `NPCDefinition.metadata?: Record<string, unknown>` in
[`packages/domain/src/npc-definition/index.ts`](/Users/nikki/projects/sugarmagic/packages/domain/src/npc-definition/index.ts).

## Propagation path

When runtime-core opens a conversation from an NPC, metadata flows through this
path:

`NPCDefinition.metadata` -> `ConversationSelectionContext.metadata` ->
`ConversationExecutionContext.selection.metadata`

That means sugarlang middlewares can read authored placement tags directly from
the execution context without reaching back into domain data.

If selection metadata already exists from another source, runtime-core performs a
shallow merge and NPC metadata wins on key conflicts. That keeps authored NPC
tags authoritative for sugarlang keys while preserving unrelated metadata.

## Metadata namespace reservation

Plugin-owned keys on domain entities must reserve a plugin prefix to avoid
collisions. Sugarlang currently reserves the `sugarlang` prefix and uses keys
such as:

- `sugarlangRole`
- `sugarlangPlacementQuestionOverrideId`

Future plugins should follow the same convention with their own prefix.

## Placement Questionnaire Types

Epic 3 defines the plugin-owned questionnaire contract used by placement:

- `PlacementQuestionnaire`
- `PlacementQuestionnaireQuestion`
- `MultipleChoiceQuestion`
- `FreeTextQuestion`
- `YesNoQuestion`
- `FillInBlankQuestion`
- `PlacementQuestionnaireResponse`
- `PlacementAnswer`
- `PlacementScoreResult`
- `SugarlangPlacementFlowPhase`

V1 discipline: the plugin owns the questionnaire bank. The types define the
shape, but the actual question sets ship from
`data/languages/<lang>/placement-questionnaire.json`. Projects do not customize
that bank in v1.

## Placement Status Fact

Epic 7 adds `SUGARLANG_PLACEMENT_STATUS_FACT` as the persistent runtime fact for
placement progress and completion state. Its payload shape is:

```ts
{
  status: "not-started" | "in-progress" | "completed";
  cefrBand?: CEFRBand;
  confidence?: number;
  completedAt?: number;
}
```

When no value has been written yet, sugarlang reads the default as
`{ status: "not-started" }`.

## Runtime Loader

Epic 4 adds `runtime/placement/placement-questionnaire-loader.ts` as the single
runtime loader for the canonical question bank. It fails fast on missing or
malformed data and currently ships Spanish and Italian plugin-owned banks.

Generic plugin questionnaires remain the fallback source of truth in v1. If a
future project-level character-voiced override exists, it should override the
generic bank explicitly rather than partially mutate it in place.

## Director Boundary

Placement is not Director-owned. Epic 9 keeps only a tiny post-placement
calibration hint for low-confidence learners after placement completes. The
questionnaire flow itself remains under `runtime/placement/` and the pre-placement
opening dialog still bypasses the Director pipeline entirely.
