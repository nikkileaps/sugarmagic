# API 009: SugarAgent NPC Memory

## Purpose

This document covers the NPC memory system (Plan 073). It explains the
two-tier memory model, what persists and when, the plugin config surface,
first-meeting semantics, and the dev inspection handle.

## Overview

NPC memory gives agentified NPCs cross-conversation continuity. A returning
player is greeted as an acquaintance, not a stranger. Memory has two tiers:

1. **Durable record** -- a per-NPC, per-playthrough JSON record stored in
   the browser's IndexedDB (`sugaragent-npc-memory` database). Written once
   per conversation end (conversation summarizer). Survives game restarts.
   Keyed by `(playthroughId, npcDefinitionId)`.

2. **Session digest** -- a capped, human-readable text summary derived from
   the durable record at conversation start and injected into the NPC's
   byte-stable system-prompt prefix. Byte-stable within a conversation;
   never re-derived mid-conversation. Controlled by `memoryDigestMaxChars`.

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
to a small/fast model via the `SUMMARY_MODEL` env var on the gateway side
(`anthropicSummaryModel` plugin config on the client side).

- **Deterministic merge** always lands (no LLM needed): updates `metCount`
  and appends a minimal transcript-derived note. If the LLM call fails, this
  is the persisted result.
- **LLM delta merge** (async): generates a richer digest and merges it.
  Staleness guard: if `metCount` changed between when the call was issued and
  when it returns (another conversation completed in parallel), the delta is
  dropped.

## NPC Memory Store

**File:** `packages/plugins/src/catalog/sugaragent/runtime/memory/npc-memory-store.ts`

IndexedDB-backed store. All reads and writes are scoped to the current
`playthroughId` (a `SaveParticipant`-owned UUID from Plan 055).

```typescript
interface NpcMemoryStore {
  load(npcDefinitionId: string): Promise<NpcMemoryRecord | null>;
  save(npcDefinitionId: string, record: NpcMemoryRecord): Promise<void>;
  // Dev-only:
  debugListRecords(): Promise<NpcMemoryRecord[]>;
  debugForget(npcDefinitionId?: string): Promise<void>;
}
```

The store is a process singleton registered via `resolveNpcMemoryStore`
(store-registry.ts). It is null until `playthroughId` is available (boot
completes and a save slot is active).

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

**New Game** generates a new `playthroughId`, making all previous records
invisible without deleting them. This is correct: a fresh playthrough is a
genuinely fresh start; the prior records are still there if you Continue.

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

`dump()` returns the raw `NpcMemoryRecord` shape: `{ npcDefinitionId,
playthroughId, metCount, digest, lastUpdated }`. Returns `null` when no
record exists yet (NPC not yet talked to this playthrough).

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
