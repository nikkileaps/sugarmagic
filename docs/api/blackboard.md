# API: The Blackboard

**Domain:** `packages/runtime-core/src/state/blackboard.ts`
**Charter:** [ADR 031](/Users/nikki/projects/sugarmagic/docs/adr/031-blackboard-is-a-projection-surface.md)

The blackboard answers one question for narrative systems: what is true in
the world right now? Sugaragent reads it for conversation context, the
teacher reads it when scanning for opportunities, the debug HUD renders it.

## The charter

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

## What this means in practice

**Deciding where new state lives.** If losing it loses the truth, it is not
blackboard state -- it belongs to an owning system and its save slice (a
`SaveParticipant`). If narrative consumers should be able to look it up, the
owner additionally projects it onto the blackboard. Both can be true at once;
that is the normal case, not a smell.

**Project at the rate the source changes.** Slow-changing and authored state
projects on change and on save restore -- quest flags work this way. Genuinely
per-frame state projects per frame: the spatial family writes player and NPC
position, area and movement facts every frame, which is correct. What is wrong
is a mismatch in either direction, and there is one in the codebase today --
`syncBlackboardQuestFacts` rewrites rarely-changing quest facts every frame.

**Who reads it, and for what.** Narrative consumers read it freely. Engine
internals -- behavior task selection, collision gates, NPC presence -- take
injected predicates for **authored** state (`hasWorldFlag`, `isNodeCompleted`,
`isPlayerInArea`), because that state has an owner who can hand over a function
and a per-frame system wants a call rather than a store query. They do read the
blackboard for globally-scoped derived world facts: behavior task selection
reads the time band from it every frame (`behavior/system.ts:595`). The rule is
about which store owns a fact, not a ban on reading in a loop.

**Facts have shapes, not just values.** A `BlackboardFactDefinition` declares
the key, the owning system (non-owner writes throw), the allowed scope kinds
(`global | region | entity | quest | conversation`), and the lifecycle
(`persistent | session | frame | ephemeral`). Frame facts clear every frame;
ephemeral facts expire on a timer; session facts die with the session.
"Persistent" means "lives until cleared" -- it does NOT mean saved to disk.
Nothing on the blackboard is saved to disk.
