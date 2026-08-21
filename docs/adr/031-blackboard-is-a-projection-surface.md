# ADR 031: The blackboard is a projection surface, not a store

## Status

Accepted.

## Context

Two stores answer "what is true in the world right now", and the boundary
between them had never been written down:

- `RuntimeBlackboard` (`runtime-core/src/state/blackboard.ts`): typed fact
  definitions with an owning system, scope kinds, and a lifecycle. Never
  persisted. Read by narrative consumers -- sugaragent conversation context,
  the teacher, the debug HUD.
- `QuestManager.runtimeFlags` plus the rest of the quest save slice
  (`activeQuests`, `completedQuestIds`, `completedNodeIds`): authored,
  persisted, written by quest actions, volume triggers, mechanics effects and
  conversation proposals.

Epic #206 (flag registry) forced the question: do registered flags move into
the blackboard, or stay in `QuestManager`? Answering it required saying what
the blackboard IS, because both "one store for everything" and "two stores
that each hold some truth" lead somewhere bad -- the first to a junk drawer
nobody can reason about, the second to readers that must know every owner.

Other engines split the same way. Unreal's Blackboard is ephemeral AI working
memory, with persistent quest state kept in save-driven world-state systems.
CD Projekt's Facts Database is the opposite pole: authored, persistent story
facts checked by dialog and quest conditions -- but it is a free-string bag
with no owner and no expiry, the junk drawer. Firewatch unified story state on
a blackboard and shipped; it is the exception, and it shipped without the
write-discipline problem because one small team held the whole vocabulary in
their heads.

## Decision: the charter

1. The blackboard is the current-state read surface for narrative systems.
   O(1), typed, queryable.
2. It holds projections only. Every fact has an owning system that can
   republish it; the blackboard is never persisted and never the only copy of
   anything.
3. Facts about the past are welcome as current facts ("the offering was
   made"); records of the past live with their owners, in save slices.
4. Nothing goes on it without a `BlackboardFactDefinition` -- owner, scope,
   lifecycle. That is the junk-drawer guard: how a fact got there is its
   owner; how it leaves is its lifecycle.

"Now versus history" is a consequence of rule 2, not the rule itself. The
blackboard carries no timeline because a projection has no reason to keep one.
"Quest X is complete" is a legitimate blackboard fact -- it describes the
world as it is now -- but the record of it lives in the quest save slice,
and the blackboard copy is rebuilt from that record on boot.

## Consequences

- **Registered flags stay in `QuestManager`** (the write and persistence
  home) **and are projected onto the blackboard as a quest-system-owned fact
  family, unconditionally.** The projection is the point, not a nicety: the
  blackboard is the one surface every narrative consumer queries, and the
  flag registry makes the projection typed.
- **Projection is event-driven, never per-frame.** Flags change a few times a
  minute; the projection hooks the flag write path and save restore. A
  per-frame re-sync of N flags would be N map writes and N listener
  notifications per frame for data that almost never changes.
- **Engine internals do not read the blackboard.** Behavior task selection,
  collision gates and NPC presence take injected predicates
  (`hasWorldFlag`, `isNodeCompleted`, `isPlayerInArea`) -- per-frame systems
  want a function call, not a store query. The blackboard serves conversation,
  teaching, dialogue selection and debugging.
- Two pre-existing per-frame costs are noted for #206's debugging work, since
  a bigger fact population will magnify them: `advanceFrame()` sweeps the
  whole store per frame-lifecycle definition (`blackboard.ts:433-446`) instead
  of indexing by key, and `syncBlackboardQuestFacts` re-sets the tracked-quest
  facts every frame with fresh allocations rather than on change.

## Enforcement

- The blackboard has no serialize path; adding one for anything other than a
  debug snapshot is a violation of rule 2 and should be caught in review.
- `assertWriteAllowed` already throws on non-owner writes; author-named state
  therefore cannot live natively on the blackboard, because authors are not a
  system. Anything author-named reaches the blackboard through a projection
  owned by the system that persists it.
