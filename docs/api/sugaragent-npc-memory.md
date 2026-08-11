# API 009: SugarAgent NPC Memory

## Purpose

This document covers the NPC memory system (Plan 073, extended by Plan 080).
It explains the memory model, the accumulating record shape and its salience-
ranked digest, what persists and when, the plugin config surface, first-
meeting semantics, and the dev inspection handle.

## Overview

NPC memory gives agentified NPCs cross-conversation continuity. A returning
player is greeted as an acquaintance, not a stranger, and characters
accumulate durable memory of the player rather than only recalling the last
conversation. Memory has two tiers:

1. **Durable record** -- a per-NPC, per-playthrough JSON record stored in
   the browser's IndexedDB (`<gameId>:sugaragent-npc-memory:${userId}`).
   Every name a game creates on a player's device leads with the game id, so
   two projects previewed on one origin cannot read each other's memory.
   Written once per conversation end (conversation summarizer). Survives game
   restarts. Keyed by `(userId, playthroughId, npcDefinitionId)`. As of Plan
   080 the list fields **accumulate scored items across conversations**
   (they no longer replace wholesale); see Record Shape below.

2. **Session digest** -- a capped, human-readable text summary derived from
   the durable record at conversation start and injected into the NPC's
   byte-stable system-prompt prefix. Byte-stable within a conversation;
   never re-derived mid-conversation. As of Plan 080 the digest is
   **salience-ranked** (importance x recency) and budget-packed, so the most
   relevant memories survive the `memoryDigestMaxChars` cap rather than
   whatever sorts last.

Plan 080 is on by default: it reuses the existing `memoryEnabled` master
switch (no new flag). Disabling `memoryEnabled` is the rollback to pre-073
stateless behavior.

## NPC memory vs. the runtime blackboard (do not conflate)

Two separate "fact" systems exist, deliberately:

- **Runtime blackboard** -- objective, authoritative world/quest state that
  game logic branches on (quest stage, time-of-day, `player-known-facts`
  from Plan 074.5). Deterministic and trustworthy.
- **NPC memory** (this system) -- a character's SUBJECTIVE, LLM-extracted
  recollection of its conversations with the player. Fallible; it only
  flavors dialogue.

They must not cross-feed. A quest gate never reads NPC memory (it is not
reliable enough to drive logic); if a quest must react to something the
player did, use a `learn-fact` quest action writing the blackboard, not a
memory item. `player-known-facts` (what the PLAYER knows) is a distinct
concept from NPC memory (what an NPC remembers ABOUT the player).

## Memory Middleware

**File:** `packages/plugins/src/catalog/sugaragent/runtime/memory/memory-middleware.ts`

A CONTEXT-stage `ConversationMiddleware` (priority 10) that runs once per
conversation (load-once, not per-turn):

- Resolves the durable record from the store.
- Builds the digest from the record.
- Memoizes both in `execution.state` under `MEMORY_STATE_KEY`.
- Publishes a `MemoryAnnotation` to `execution.annotations[MEMORY_ANNOTATION_KEY]`
  each turn (from the memoized value -- the IDB read happens at most once).

The middleware runs on `conversationKind === "free-form"` agent-NPC selections
only. Scripted dialogues do not read or write memory.

**Load-once is a hard rule:** the digest is byte-stable within a session so
the system prompt stays cache-friendly. A summarizer write from a *previous*
conversation landing mid-session does not re-load or mutate the live digest.

**Key exports:**
- `NPC_MEMORY_MIDDLEWARE_ID` -- the middleware's stable id (`"sugaragent.memory"`)
- `MEMORY_ANNOTATION_KEY` -- annotation key for downstream stages
- `MEMORY_STATE_KEY` -- state key for the memoized record
- `MemoryAnnotation` -- `{ hasMemory: boolean; metCount: number; isFirstMeeting: boolean }`
- `MemoizedNpcMemory` -- `{ record: NpcMemoryRecord | null; digest: string }`
- `createNpcMemoryMiddleware(options)` -- factory

## Conversation Summarizer

**File:** `packages/plugins/src/catalog/sugaragent/runtime/memory/conversation-summarizer.ts`

Runs at conversation dispose (two-phase: synchronous deterministic merge
first, then an async LLM upgrade). One gateway call per conversation, routed
to a small/fast model server-side via `purpose: "summary"` ->
`SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL`.

- **Deterministic merge** always lands (no LLM needed): bumps `metCount` and
  `conversationCounter` and stores the truncated last exchange. If the LLM
  call fails, this is the persisted result. (A session in which the player
  never spoke is skipped entirely -- no `metCount` bump.)
- **LLM delta merge** (async): the summarizer returns a structured delta
  whose list fields are scored objects `{ text, importance (1-10) }`,
  including a `disclosures` list (things the NPC told the player about
  itself). The delta is validated (AJV; tolerant of bare strings and bad
  importance) and merged. **Staleness guard:** the delta is tagged with the
  `conversationCounter` it reflects; if that counter is behind the record's
  `summaryCounter` (a later conversation already summarized), the delta is
  dropped wholesale. As of Plan 080 the merge **accumulates** (upsert) rather
  than replacing -- see Record Shape.

The client sets the output token ceiling generously (`DEFAULT_SUMMARY_MAX_TOKENS`)
so a rich importance + disclosures payload cannot truncate mid-JSON (a
truncated response fails validation and drops the whole summary).

## NPC Memory Store

**File:** `packages/plugins/src/catalog/sugaragent/runtime/memory/npc-memory-store.ts`

IndexedDB-backed store on the player's device only -- NPC memory does not yet
follow a player to another machine. It is a per-player record in every sense
except that one, and converting it to the shared mechanism
([per-player data](/docs/api/per-player-data.md)) is the outstanding work;
the mechanism was designed with this store as its second customer.

Scoped per user (database name) and keyed by
`(userId, playthroughId, npcDefinitionId)`. All operations serialize on a
single promise chain (a load issued after a merge observes it).

```typescript
class NpcMemoryStore {
  load(npcDefinitionId: string): Promise<NpcMemoryRecord | null>;
  // Phase 1 (sync at dispose): bumps metCount + conversationCounter, stores
  // the truncated last exchange. Returns the new conversationCounter.
  mergeDeterministic(delta: DeterministicMemoryDelta): Promise<{ conversationCounter: number }>;
  // Phase 2 (async): accumulates the scored delta (upsert), counter-gated.
  mergeSummary(delta: SummaryMemoryDelta, counter: number): Promise<boolean>;
  // New Game / playthrough change: prunes other playthroughs' rows.
  reset(): Promise<void>;
  // Dev-only:
  debugListRecords(): Promise<NpcMemoryRecord[]>;
  debugForget(npcDefinitionId?: string): Promise<void>;
}
```

The store is a process singleton registered via `resolveNpcMemoryStore`
(store-registry.ts). It is null until `playthroughId` is available (boot
completes and a save slot is active).

### Record Shape (v2, Plan 080)

`NPC_MEMORY_SCHEMA_VERSION` is `2`. The list fields hold **scored, accumulating
items**, not plain strings:

```typescript
interface ScoredMemoryItem {
  text: string;
  importance: number;   // 1-10 (Generative Agents "poignancy")
  lastUpdated: number;  // conversationCounter at last add/refresh (recency)
}

interface NpcMemoryRecord {
  key; userId; playthroughId; npcDefinitionId; schemaVersion;
  metCount: number;              // distinct conversations (monotonic)
  conversationCounter: number;   // monotonic; staleness clock
  lastExchange: string;          // deterministic continuity floor
  relationshipSummary: string;   // prose (replaced each summary)
  salientFacts: ScoredMemoryItem[];
  promises: ScoredMemoryItem[];
  emotionalBeats: ScoredMemoryItem[];
  disclosures: ScoredMemoryItem[]; // things the NPC told the player about ITSELF
  lastConversationSummary: string; // prose (replaced each summary)
  summaryCounter: number;          // which conversation the summary reflects
}
```

**Accumulation + reconciliation.** `mergeSummary` upserts each incoming scored
item into the existing list: a near/exact match refreshes recency and lifts
importance (max); a novel item is appended. Near-match is a code-level test
(no embeddings in v1): normalized-text equality or heavy word-set overlap
(Jaccard >= 0.6). It is deliberately conservative and does NOT treat substring
containment as a match (that would false-merge a fact with its negation, e.g.
"married" vs "not married anymore"). The two prose fields
(`relationshipSummary`, `lastConversationSummary`) replace, not accumulate.

**No eviction (deferred).** Lists grow across conversations by design; there is
no hard cap on the stored record. The digest render bounds what is injected.
Soft-forget eviction and an LLM reflection/compaction pass are deferred (Plan
080 §D6) until records grow large in real play.

**Migration.** `migrateNpcMemoryRecord` reads the RAW stored `schemaVersion`
before stamping current, and branches: a v1 record's plain-string lists convert
losslessly into scored items (default importance, timestamped to the record's
`conversationCounter`); `disclosures` starts empty. metCount/counters are
preserved exactly.

### Disclosures and the repetition mechanism (Plan 080 §D4)

`disclosures` is the lever that stops cross-conversation repetition (a character
re-introducing their spouse or re-telling a favorite-food story every session).
The summarizer records what the NPC SHARED ABOUT ITSELF; the digest injects a
"You have already told this player about: ..." line followed by a POSITIVE-framed
directive:

> You can refer to these naturally as things already shared between you; you
> needn't introduce or explain them again as if for the first time.

Positive framing is intentional (Anthropic's "tell it what to do, not what not
to do"): a hard prohibition risks the NPC clamming up and avoiding the topic
entirely. The NPC stays free to mention the thing; it just stops re-introducing
it as new.

### Digest salience ranking (Plan 080 §D5)

`buildMemoryDigest` ranks items by `importance x recency-decay`
(`RECENCY_DECAY_BASE^age`, age in conversations off `lastUpdated`) and packs the
highest-scored into the `memoryDigestMaxChars` budget. Disclosures get a reserved
sub-budget and render first so they are never starved by higher-scored facts;
`lastConversationSummary` is prioritized above detail facts (a returning player's
freshest continuity is no longer the first thing truncated). The render is a pure
function of the record (byte-stable for the cached prompt slot); recency keys off
`lastUpdated`, never a read-time mutation.

## First-Meeting Semantics

`metCount` tracks how many conversations this player has had with this NPC
(incremented by the deterministic merge on every conversation end).

- `metCount === 0` (or no record): first meeting. `MemoryAnnotation.isFirstMeeting = true`.
- `isFirstMeeting` is consumed by sugarlang's `minimalGreetingMode` policy
  (Plan 073.4): on first meeting the NPC skips the placement questionnaire
  and uses a shorter greeting path so the player isn't interrogated immediately.

The digest injected into the system prompt includes the `metCount` so the NPC
can greet a returning player naturally ("Good to see you again").

## Persistence and New Game

Memory records survive game restarts and page reloads within the same
playthrough. The `playthroughId` is what scopes them -- all IDB queries
include it as a key component.

**New Game** generates a new `playthroughId` (minted whenever the playthrough-
identity `SaveParticipant` deserializes with no usable stored id -- New Game,
first boot, or a legacy save without the slice). This clears memory two ways:
the new id's keys miss every prior record (instant clean slate), and the
store's `reset()` prunes the prior playthrough's rows so the device-local
database doesn't grow across New Games. Guarded by an integration test (073.1c):
New Game -> empty memories, sugarlang's vocab store untouched.

Note memory is device-local (browser IndexedDB), so it also does not follow a
save to another device, and clearing site data wipes it independently of the
saved `playthroughId`. Cross-device sync is a named non-goal (backlog).

## Plugin Config

Two config fields in the SugarAgent plugin settings:

| Key | Type | Default | Description |
|---|---|---|---|
| `memoryEnabled` | boolean | `true` | Master switch. Off = no record reads or writes, every conversation starts fresh. |
| `memoryDigestMaxChars` | number | `800` | Hard cap on the digest injected into the system prompt. Range 200-2000. |

Both are live in the Studio plugin settings panel via the schema auto-renderer.

When `memoryEnabled` is `false`, the middleware `prepare` is a no-op, the
summarizer skips the IDB write, and `isFirstMeeting` stays `false` (the
minimal-greeting policy does not activate either).

## Dev Inspection Handle

`window.__sugaragentMemory` is installed at plugin init (always, regardless
of `memoryEnabled` -- the handle is useful for debugging the disabled state
too). From a devtools console or automated browser session:

```javascript
// Every NPC's record for the current playthrough
await __sugaragentMemory.dump()

// One NPC's record
await __sugaragentMemory.dump("npc:finnick")

// Re-test first-meeting: forget one NPC for this playthrough
await __sugaragentMemory.forget("npc:finnick")

// Forget all NPCs for this playthrough
await __sugaragentMemory.forget()
```

`dump(npcId)` returns the raw `NpcMemoryRecord` (see Record Shape) -- inspect
`disclosures`, the scored `salientFacts`/`promises`/`emotionalBeats`,
`metCount`, and the counters. `dump()` with no argument returns every record
for the current playthrough. Returns `null` when no record exists yet (NPC not
yet talked to this playthrough).

**File:** `packages/plugins/src/catalog/sugaragent/runtime/memory/memory-debug.ts`

## Files

| File | Role |
|---|---|
| `memory/memory-middleware.ts` | CONTEXT-stage middleware: load-once, annotate each turn |
| `memory/npc-memory-store.ts` | IndexedDB store (per playthrough, per NPC) |
| `memory/store-registry.ts` | Process-wide store singleton + resolver |
| `memory/conversation-summarizer.ts` | Post-conversation record update (deterministic + LLM) |
| `memory/digest.ts` | Digest builder + DEFAULT_MEMORY_DIGEST_MAX_CHARS |
| `memory/memory-debug.ts` | `__sugaragentMemory` dev handle |
