# API 008: SugarAgent Quest-Aware NPCs

## Purpose

This document covers the developer-facing surface of SugarAgent's quest-aware
NPC system (Plan 077). It explains what quest-awareness means, where the seams
are, the firewall contract, and how world-narrative state flows without a
central director.

## Overview

SugarAgent agentified NPCs are quest-aware through three mechanisms that work
together, not a single authority:

1. **Quest-context middleware** -- resolves world-lore relevant to the active
   quest once per quest-state and splices it into the NPC's prompt as
   world-framed context (D3).
2. **World-narrative blackboard facts** -- a shared counter (`goalSurfacedCount`)
   that lets NPCs coordinate without communication: NPC A hints, the counter
   bumps, NPC B sees it and eases off (D4).
3. **Quest + world-event system** -- authored, deterministic scene changes (quest
   node actions, region-condition gates, presence/behavior activation). This
   already existed; 077 only closes small gaps (D5).

There is NO central narrative director. Per-NPC judgment ("should I mention
this in character right now?") is delegated to the NPC's own generate call,
informed by shared state in its prompt and its persona. This is both cheaper
and more in-character than a central brain deciding for each NPC.

## The Firewall: Secrets vs Nudges (D2)

The prompt-invariant that governs what quest information may and may not enter
the model prompt:

**MAY enter the prompt:**
- World-lore text retrieved using the objective as a seed query (e.g. "Travelers
  with lost luggage are directed to baggage claim.") -- this is world-framed
  context, not a private goal.
- The NPC framing instruction ("offer what you'd plausibly know in character;
  do not act as though you know the player's private business").
- The `goalSurfacedCount` (how many times the objective has been surfaced, as
  a number) and the ease-off hint when count > 0.

**MUST NOT enter the prompt:**
- The objective's `displayName` or `description` verbatim ("Find your lost
  suitcase", "Track down the missing suitcase from the luggage carousel").
  These are the player's private goal. They may be used internally to seed a
  retrieval query (a string never shown to the model), but must not be spliced
  into any part of the built prompt.
- The raw quest name as a "the player is on quest X" framing (removed in
  077.1). Only world-framed context replaces it.

This distinction: a secret (never revealed) stays out entirely; a nudge (we
WANT it optionally said) enters as world-framing. The invariant enforces the
seam between "private goal seeds retrieval" (internal) and "world lore enters
the prompt" (external).

## Quest-Context Middleware

**File:** `packages/plugins/src/catalog/sugaragent/runtime/quest/quest-context-middleware.ts`

A CONTEXT-stage `ConversationMiddleware` (priority 15, after the blackboard
middleware at -100) that:

- Runs only on `conversationKind === "free-form"` selections (agent NPCs, not
  scripted dialogue).
- When `runtimeContext.trackedQuest` is set, resolves world-lore via
  `vectorStoreProvider.searchLore` using the active objective's text as the
  retrieval query (private, never shown to the model).
- Memoizes the result in `execution.state` keyed by `questId::stageId` and
  re-resolves only when the quest state changes (stage advance, new quest).
- Publishes a `QuestContextAnnotation` to `execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY]`
  each turn (from the memoized value, so the vector search runs at most once
  per quest-state change).

**Key exports:**
- `QUEST_CONTEXT_MIDDLEWARE_ID` -- the middleware's stable id
- `QUEST_CONTEXT_ANNOTATION_KEY` -- annotation key for GenerateStage / PlanStage
- `createQuestContextMiddleware(options)` -- factory; options: `vectorStoreProvider`,
  `logger`, `maxWorldContextChars` (default 400)
- `MemoizedQuestContext` -- the per-quest-state memo shape
- `QuestContextAnnotation` -- `{ hasContext: boolean; worldContext: string | null }`

**Cost:** zero extra LLM calls per turn. The one allowed network call
(`vectorStoreProvider.searchLore`) fires at most once per quest-state change,
then is memo-served until the stage advances. See the 077.5 cost guard tests
in `quest-context-middleware.test.ts`.

**Config flag:** `questAwareNpcsEnabled` (default `true`). When `false`, the
middleware is not registered and NPCs behave as pre-077.

## World-Narrative Blackboard Facts (D4)

**File:** `packages/runtime-core/src/state/blackboard.ts`

Quest-awareness introduces a new blackboard owner (`"narrative-system"`) and
one fact:

```typescript
GOAL_SURFACED_COUNT_FACT: BlackboardFactDefinition<number>
// ownerSystem: "narrative-system", scope: "quest", lifecycle: "session"
// key: "narrative.goal-surfaced-count"
```

Helper functions (exported from `@sugarmagic/runtime-core`):
- `getGoalSurfacedCount(blackboard, questId): number` -- returns 0 when unset
- `bumpGoalSurfacedCount(blackboard, questId): void` -- increments by 1

**Write path (D4 firewall):** SugarAgent stages have no blackboard handle.
The write happens through the `ConversationActionProposal` channel:

1. `PlanStage` emits `{ kind: "bump-goal-surfaced", questId, stageId }` when
   the turn has quest world context and the response intent is not "redirect".
2. `handleConversationActionProposal` in `gameplay-session.ts` calls
   `bumpGoalSurfacedCount(blackboard, proposal.questId)`.

This keeps the blackboard write-firewall intact: runtime-core owns and writes
the fact; SugarAgent only emits a proposal describing intent.

**Coarse proxy note:** v1 counts PROMPTING, not saying. The count bumps when
PlanStage decided to voice quest context (i.e. we asked the model to steer);
the model may still decline in character. "Second NPC eases off" is therefore
best-effort emergent. Precise "was the hint delivered in character?" tracking
is deferred to epic E/075.

## `bump-goal-surfaced` Proposal

Defined in `ConversationActionProposal` (`packages/runtime-core/src/conversation/index.ts`):

```typescript
{ kind: "bump-goal-surfaced"; questId: string; stageId: string }
```

Handled by `handleConversationActionProposal` in `gameplay-session.ts`. This
is a WORLD-NARRATIVE FACT write, distinct from `set-conversation-flag` (which
writes a QUEST FLAG via `questManager.setFlag`).

## How It Reaches the Prompt

`BasePromptContext` carries:
- `questWorldContext: string | null` -- the world-lore text from the middleware
- `goalSurfacedCount: number | null` -- from `runtimeContext.goalSurfacedCount`
  (populated by the blackboard middleware before quest-context middleware runs)

`buildGeneratePrompt` (`prompt/builder.ts`) splices both into the UNCACHED user
half only (D7 -- the byte-stable system prompt is never touched by quest state):

1. When `questWorldContext` is set: emits the world-framed context block
   ("World context right now: ...") and the NPC framing instruction.
2. When `goalSurfacedCount > 0` and quest context is set: emits the ease-off
   hint ("This topic has been brought up N time(s) already...").

Neither the raw quest name (`activeQuestDisplayName`) nor the objective text
enters the prompt.

## Dev Inspection Handle

`window.__sugaragentQuestContext` is installed when `questAwareNpcsEnabled` is
`true`. From a devtools console or an automated browser session:

```javascript
// Dump last-seen quest context for all NPCs this session
__sugaragentQuestContext.dump()

// Dump for one NPC
__sugaragentQuestContext.dump("npc:finnick")
```

Each entry: `{ npcDefinitionId, questId, stageId, worldContext, goalSurfacedCount }`.
`worldContext` is the lore text injected into the prompt (or `null`).
`goalSurfacedCount` is the blackboard fact value at annotation time.

**File:** `packages/plugins/src/catalog/sugaragent/runtime/quest/quest-context-debug.ts`

## World Events: Compose Existing Machinery (D5)

Quest-gated scene changes use existing seams, not new infrastructure:

- **Flag set from agent turn:** PlanStage emits `set-conversation-flag` ->
  `questManager.setFlag` -> sets a world flag.
- **Compound AND gate:** `evaluateRegionQuestBinding({ questDefinitionId, questStageId, worldFlagEquals })`
  in `packages/runtime-core/src/region-conditions/index.ts` evaluates stage
  AND flag together. Used by behavior-task activation and collision volumes.
- **Presence gating (deferred):** `RegionNPCPresence` has no condition field;
  presence gates require task #418 (epic). Use behavior-task gating (NPC
  present, behavior changes) in the meantime.

The evaluator handles compound AND natively; no new engine is needed for
"appear only after arrival AND after NPC-1 conversation."

## SugarAgent Plugin Config

`questAwareNpcsEnabled: boolean` (default `true`) is the master switch.
When `false`:
- The quest-context middleware is not registered (no world lore in NPC prompts,
  no ease-off blackboard, pre-077 behavior).
- The `__sugaragentQuestContext` dev handle is not installed.

All other quest-system config (lore source, vector store ID) is unchanged.
