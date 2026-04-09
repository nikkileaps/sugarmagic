# Placement Contract API

Status: Updated in Epic 2; expanded further in Epic 11

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
