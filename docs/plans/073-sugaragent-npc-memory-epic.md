# Plan 073 -- SugarAgent NPC Memory (child epic C of Strategy 001)

Status: Locked (re-gate passed 2026-07-21, 1 round, vs merged Plan 072; originally epic-review passed 2026-07-19, 3 rounds) -- stories execute as written in the stated EXECUTION ORDER; deviations need STOP + amendment + re-gate.

Re-gate note (2026-07-21, vs merged 072): CONVERGED, no blocking drift. Every load-bearing citation verified against merged code -- 072's changes (prompt builder halves, session-start persona load, gateway systemBlocks/cache contract, claude-haiku-4-5 default) all SUPPORT 073's design. Two precision amendments applied: (F2b) D6/073.3/073.4 wording -- the load-bearing ordering fact is "context stage runs before sugarlang's POLICY-stage teacher middleware" (which computes minimalGreetingMode), not "before sugarlang's context middleware"; (F3) 073.3 pins the digest slot in the system prefix. No scope/ordering/exit changes.
Owner: nikki + claude
Date: 2026-07-19

Related:
- Strategy 001 -- child epic C. Depends on Plan 072 (persona card + prompt structure: memory feeds the same cached system prefix and rides 072.3's session-start load). Cross-epic ordering constraint with 075 (review round 2): 073.2 consumes the gateway structured-output contract that 075.1 OWNS -- either 075.1 lands before 073.2, or 073.2 extracts the structured-output mechanics into the shared spot and 075.1 ratifies it when it lands; pick at build time, but do not invent two contracts.
- Plan 071 (foundation repair) transitively required.
- Ground truth: 2026-07-18 audit. Key producing facts: conversation state is created FRESH per startSession (`state: {}` in runtime-core conversation host) and discarded on end -- an NPC forgets a conversation the moment it closes, even within one play session. No SaveParticipant exists for sugaragent; runtime-core's save contract EXPLICITLY reserves this slot out-of-band: "Per-plugin per-user state (sugarlang learner blackboard, sugaragent conversation memory) does NOT live here. Each plugin ... owns its own store, keyed on userId" (packages/runtime-core/src/save/index.ts, ~L17-22). Interpret already has the vocabulary (`session_recall` intent, `memory` lane, RECALL patterns "remember me|have we met|last time") with no source to answer from.

---

## Why now

Relationship is the product. The player's bond with characters who are secretly their teachers is the emotional engine of the game, and today every conversation starts from zero. "Have we met?" is already classified as a recall query by the Interpret stage and is unanswerable. Research consensus (Strategy 001 sweep): two-tier memory -- a durable per-NPC profile plus session context -- is the shipped-game standard; simple recency/relevance stores with periodic summarization are competitive with anything fancier, and consolidation policy is unsolved everywhere, so a bespoke store is not debt.

## Non-goals

Cross-device/server-side memory sync (device-local first; watchlist). NPC-to-NPC gossip (an NPC does not learn what happened in another NPC's conversations). Memory-driven behavior/schedule changes (epic D territory). Vector/graph memory stores (a flat summarized store is the researched v1). In-game-time awareness of memories ("yesterday") beyond ordering -- arrives when epic D's clock exists.

## Design decisions (epic-review ratifies)

- D1 -- Storage is a plugin-owned browser-side store (IndexedDB), keyed by `userId + playthroughId + npcDefinitionId`. NOT a SaveParticipant slice (the save contract explicitly excludes it) and NOT gateway-side (the gateway is stateless by design). Two mechanisms this epic must CREATE, ratified here because no producer exists for either (review round 1 -- zero hits for any playthrough-identity concept; the identity registry exposes only the access token, not the user): (a) a `playthroughId` (uuid) minted ON DESERIALIZE(NULL) -- i.e. at boot whenever the slice is absent, which is exactly what New Game produces (it deletes the save row and the serialized store is FROZEN before the reload, so click-time minting cannot persist; review round 2) -- persisted in a small runtime-core-owned SaveParticipant slice and exposed to plugin runtime via a registry getter (the access-token-registry mold). One path uniformly covers New Game, first-ever boot, and pre-073 saves; hostStartNewGame needs zero new code. New Game detection for ANY plugin store is then "playthroughId changed", which is the architectural precedent this decision sets; (b) `getActiveUserId` added beside `getActiveAccessToken` on the identity registry. Both are runtime-core + targets/web work and belong to 073.1's scope honestly. Behavioral requirement unchanged: New Game starts with empty memories, Continue retains them.
- D1b -- Precedent honesty (review round 1): sugarlang's learner store is the IDIOM precedent only (IndexedDB store class, memory fallback, db-per-key naming) -- its KEYING is deliberately different (player definition + language pair, NOT userId, NOT playthrough-scoped) because learner knowledge SHOULD survive New Game. The asymmetry is intentional and explicit: New Game resets NPC memory, never learner knowledge; 073.1 must not copy sugarlang's keying and must not touch sugarlang's store.
- D2 -- Two tiers, one record shape. Tier 1 (durable): a compact structured memory record per NPC -- relationship summary, salient facts learned about the player, promises/undertakings, emotional beats, met-count, last-conversation summary. Tier 2 (continuity): the most recent conversation's summary is simply the freshest part of the same record; no separate mechanism.
- D3 -- Two-phase write at dispose (review round 1 -- a pure fire-and-forget races the very next conversation): the DETERMINISTIC delta (metCount++, conversation counter++, truncated last exchange) merges SYNCHRONOUSLY at dispose (an IndexedDB write, milliseconds), so an immediate re-talk always sees "we met" even before any LLM returns. The LLM summarization is then an ASYNC UPGRADE, fire-and-forget through the gateway (small model, explicit id; structured verdict per the contract 075.1 owns -- do not invent a second one; sugarlang's teacher schema-parser is the validation idiom to mold from): transcript in, memory-delta out, merged when it lands. The store serializes all operations on a single promise chain (the serialized-save-store idiom) so loads order behind in-flight merges, and stale LLM deltas are gated by the monotonic counter (a delta from conversation N never overwrites a record already advanced past N). Failure-tolerant: no LLM summary means the record holds the deterministic delta only.
- D4 -- Memory enters the prompt in the CACHED system half, after core knowledge. Load-once-memoized-per-session is a hard rule: the record is read ONCE per conversation (see D6's middleware) and held in execution state -- a previous conversation's summarizer completing mid-session must NOT mutate the digest, or 072.4's byte-stability breaks. It changes BETWEEN conversations, which invalidates the cache exactly when it should (new prefix bytes); the epic wrap re-runs 072.7's cache break-even note under this reality (every conversation now pays one cache write since memory advanced). A compact digest, hard-capped in size; the full record never goes in.
- D5 -- No raw wall-clock timestamps in the persisted record (house rule: restored wall-clocks trip every recency heuristic). Ordering uses met-count and a monotonic conversation counter; "when" language waits for epic D's in-game clock.
- D6 -- First-meeting truth comes from memory, delivered by a NEW sugaragent CONVERSATION MIDDLEWARE (review round 1 -- the ordering fact that shapes this epic: sugarlang's teacher middleware computes the minimal-greeting decision in its `prepare`, and ALL middleware prepares run BEFORE `provider.startSession`, so a startSession-time load can never feed the only turn a greeting decision exists on). Sugaragent contributes a context-stage middleware (re-gate 2026-07-21: the load-bearing ordering is that the CONTEXT stage runs before sugarlang's POLICY-stage teacher middleware -- the one that actually computes `minimalGreetingMode` -- so any context-stage sugaragent middleware's annotation is visible to it regardless of priority) that loads the memory record ONCE, memoizes it in `execution.state` (which persists across turns), and annotates `metCount`/first-meeting on the execution. The provider and stages read the memoized record from state -- there is NO separate startSession load. This is sugaragent's first `conversation.middleware` contribution (the kind exists; sugaragent contributes only a provider today) -- named here so it is not a mid-story surprise. Sugarlang consumes the annotation; no cross-plugin import in either direction.

## Stories (EXECUTION ORDER)

### 073.1 Playthrough identity + memory store

Two halves, both ratified in D1: (a) runtime-core/host work -- mint `playthroughId` on deserialize(null) (one path covers New Game / first boot / pre-073 saves, per D1) into a runtime-core-owned SaveParticipant slice, expose via a registry getter (access-token-registry mold), add `getActiveUserId` to the identity registry; (b) the plugin-owned IndexedDB store (IndexedDBCardStore idioms: db naming, request/transaction helpers, in-memory fallback when indexedDB is undefined), keyed per D1, record shape per D2, versioned for migration, all operations serialized on one promise chain per D3. API: load(npcId), mergeDeterministic(delta), mergeSummary(delta, counter), reset(playthroughId change detected on load). Exit: unit tests for keying, both merge paths, ordering (load behind in-flight merge), stale-delta rejection, version migration; a New Game integration test proves empty memories AND proves sugarlang's learner store is untouched (D1b).

### 073.2 End-of-conversation summarizer

On session dispose: synchronous deterministic merge FIRST (D3), then the async LLM upgrade -- assemble the transcript (provider state history is capped at 12 entries; decide in-story whether to accumulate a fuller transcript in session state for summarization), call the gateway with a structured summarization request per the 075.1-owned contract (small model, explicit model id -- not the NPC-dialogue default; validation molded on sugarlang's teacher schema-parser idiom), merge with counter gating. Budget: one call per conversation, capped tokens. Outcome reporting via the plugin-event logger + the 073.5 dev handle (turn diagnostics cannot carry a post-session event). Exit: unit tests with mock gateway (deterministic merge always lands, LLM delta merge, failure leaves deterministic-only, stale delta dropped).

### 073.3 Memory middleware + prompt + recall answers

The D6 middleware (sugaragent's first conversation.middleware contribution): load-once, memoize in execution state, annotate metCount. Digest per D4 into the system prefix (the stages read the memoized record). Slot to pin in-story (re-gate 2026-07-21): `buildStableSystemLines` (builder.ts) emits identity -> grounding -> persona card -> core knowledge -> voice directive; "after core knowledge" means the memory digest slots between core knowledge and the voice directive (or immediately after voice) -- either preserves the cached-half byte-stability; choose one and keep it. Plan/Interpret integration: `session_recall` and memory-lane queries get answered from the digest instead of abstaining ("last time you told me...", "yes, we've met"); the Plan abstain-without-evidence policy learns that memory IS evidence for recall intents. Exit: integration test -- second conversation with the same NPC references the first (against mock gateway with canned summary); byte-stability test from 072.4 still passes within a session (including a summarizer completing mid-session: digest must not change).

### 073.4 First-meeting semantics (D6)

Sugarlang's minimal-greeting decision composes the metCount annotation (its own story-level change, annotation-only seam). Composition honesty (review round 1): minimal-greet today requires a conservative-beginner constraint state (anchored posture, listening-first, zero target vocab) -- it is NOT every first conversation. metCount==0 becomes an additional conjunct into that decision (exact composition decided in-story); metCount>0 suppresses re-introduction regardless. Exit: integration test that CONSTRUCTS the eligible learner state -- first conversation minimal-greets, second conversation greets as an acquaintance; a non-eligible learner state greets normally both times but never re-introduces on the second.

### 073.5 Reset, inspection, config

Config: memory enable flag + digest size cap in plugin settings. Reset surfaces: New Game (073.1), plus a dev-only reset + inspection handle (window handle, house debug-tooling style) so Claude/nikki can dump an NPC's memory record in preview without UI archaeology. Exit: settings render via the schema auto-renderer; dev handle documented in the epic wrap notes.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Preview -> New Game: talk to an NPC (with a minimal-greet-eligible learner state they greet as a stranger), tell them something personal, say goodbye. Talk to them AGAIN in the same session: they IMMEDIATELY know you have met (deterministic merge is synchronous); detailed recall of what you told them lands once the async summarizer completes -- give it a few seconds before probing "do you remember what I said?"
3. Reload/Continue the save: same recall works (memory survived the session).
4. New Game again: the NPC is a stranger once more (no bleed between playthroughs).
5. Kill the network mid-goodbye (or force the summarizer to fail): conversation closes normally; next conversation still knows you met (fallback), just with less detail.

## Epic wrap

docs/api: memory store contract + the first-meeting annotation. Dev inspection handle documented. Backlog sweep of DEFERRED SEAM comments.

## Deferred (with revisit triggers)

- Server-side/cross-device memory: revisit when accounts play across devices in the wild; the store API is the seam (code comment at the store).
- Consolidation policy (merge/forget/compress across many conversations): revisit when records approach the digest cap in real play; the merge function is the seam.
- NPC-to-NPC gossip + memory-driven schedules: a design epic after D; would compose memory records with the blackboard.
- In-game-time-stamped memories ("yesterday morning"): epic D clock integration; the record's conversation counter is the placeholder ordering.
