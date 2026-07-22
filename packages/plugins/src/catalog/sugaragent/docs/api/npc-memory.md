# SugarAgent — NPC Memory

How an agentified NPC remembers a player across conversations and sessions, and
recalls it in-character. Companion to `npc-knowledge-model.md` (identity /
knowledge / voice); this doc covers the per-player memory layer.

## What is remembered, and where it lives

One compact record per **NPC per playthrough per user**, stored device-locally
in the browser (`IndexedDB`, with an in-memory fallback) — see
`runtime/memory/npc-memory-store.ts`. Nothing memory-related goes to the server:
the shared game save and the gateway both exclude it (per-plugin per-user data
is owned by the plugin, per ADR 020). The record holds a met-count, a monotonic
conversation counter, a truncated last exchange, and an LLM-distilled summary
(relationship, salient facts, promises, emotional beats, last-conversation
summary).

### Keying and identity

The store key is `userId :: playthroughId :: npcDefinitionId`.

- `userId` comes from `getActiveUserId()` (runtime-core identity registry).
- `playthroughId` comes from `getActivePlaythroughId()` (runtime-core). It is
  minted on `deserialize(null)` by the `playthrough.identity` SaveParticipant
  (`runtime-core/src/save/playthroughIdentitySaveParticipant.ts`) — i.e. at
  boot whenever no slice is stored, which is exactly what **New Game** produces.
  A fresh playthroughId means every key misses, so a New Game starts with empty
  memories while sugarlang's learner store (keyed differently) is untouched.

`resolveNpcMemoryStore()` (`runtime/memory/store-registry.ts`) returns the one
shared store for the active `(userId, playthroughId)`, so the writer (dispose)
and reader (middleware) serialize on a single promise chain. It returns `null`
until identity resolves; callers treat that as "memory unavailable this turn".

## Write path — end of conversation (two phases)

At session `dispose` (`runtime/provider.ts` →
`runtime/memory/conversation-summarizer.ts`):

1. **Deterministic merge, awaited.** `metCount++`, `conversationCounter++`,
   truncated last exchange. Always lands (a millisecond IndexedDB write), so an
   immediate re-talk sees "we met" before any LLM returns.
2. **LLM summary, fire-and-forget.** A cheap model distills the transcript into
   a structured JSON delta (parsed by an AJV schema, tolerant of code fences),
   merged with **counter gating**: a summary for conversation N never overwrites
   a record already advanced past N. Any failure leaves the deterministic-only
   record.

The summary model is chosen **server-side** — the browser sends
`purpose: "summary"` (never a model id); the gateway maps it to
`SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL` (config: "Anthropic Summary Model"),
separate from the dialogue model.

## Read path — the digest + recall

A **context-stage conversation middleware** (`runtime/memory/memory-middleware.ts`,
SugarAgent's first middleware contribution) loads the record **once** per
conversation, memoizes it in `execution.state`, and republishes a per-turn
annotation `execution.annotations["sugaragent.memory"]` =
`{ metCount, firstMeeting, hasMemory }`.

- **Digest** (`runtime/memory/digest.ts`): a compact, hard-capped block built
  once from the memoized record, injected into the **cached system prefix**
  (after core knowledge, before the voice directive — see `builder.ts`). It is
  byte-stable within a session (a previous conversation's summarizer landing
  mid-session does NOT change it), and changes only between conversations, which
  invalidates the prompt cache exactly when it should. First meeting ⇒ empty
  digest.
- **First-meeting semantics** live here, not in any language plugin: when
  `metCount > 0` the digest carries an explicit "greet them as an acquaintance;
  do not re-introduce yourself" line. First meetings get no special cue — the
  persona greets in character.
- **Recall** (`runtime/stages/planning.ts`): a `session_recall` question ("do
  you remember me?") and a repeat-visit opening greeting are treated as
  *grounded* when memory exists (`hasMemory`), so they route to the LLM with the
  digest instead of abstaining or staying generic. Memory IS evidence for those
  intents.

## Configuration (SugarAgent plugin settings)

| Field | Key | Default | Effect |
|---|---|---|---|
| NPC Memory | `memoryEnabled` | on | Master switch. Off ⇒ middleware + summarizer are no-ops; every conversation starts fresh. |
| Memory Digest Size Cap | `memoryDigestMaxChars` | 800 | Hard cap on the digest injected into the cached system prefix (200–2000). |
| Anthropic Summary Model | `anthropicSummaryModel` | haiku | Server-side model for the summary pass. |

## Reset + dev inspection

- **New Game** resets memory by construction (new `playthroughId`). No explicit
  clear needed.
- **Dev handle** (`runtime/memory/memory-debug.ts`): a browser-only
  `window.__sugaragentMemory` for inspecting/resetting memory in preview without
  UI archaeology:
  - `await __sugaragentMemory.dump()` — every NPC record this playthrough
  - `await __sugaragentMemory.dump("npc:finnick")` — one NPC
  - `await __sugaragentMemory.forget("npc:finnick")` — re-test the first meeting
  - `await __sugaragentMemory.forget()` — forget every NPC this playthrough

## Deferred (seams)

- **Cross-device / server-side sync.** Memory is device-local by design. The
  store API is the seam; revisit when accounts play across devices in the wild.
- **Consolidation** (merge/forget/compress across many conversations). The merge
  functions are the seam; revisit when records approach the digest cap in real
  play.
