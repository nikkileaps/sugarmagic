# Plan 080 -- NPC Memory Accumulation and Salience

Status: Draft (pre-epic-review; NOT locked -- stories are not built until the
epic-review gate passes and this header is stamped Locked).
Owner: nikki + claude
Date: 2026-07-24

Related:
- Backlog #415 (DEFERRED (073): NPC memory consolidation -- merge/forget/compress).
  This epic's origin. The 073 Deferred section says "revisit when records approach the
  digest cap in real play; the merge function is the seam."
- Plan 073 (Sugaragent NPC Memory) -- MERGED. Built the durable per-NPC-per-player
  IndexedDB store, the two-phase dispose write (deterministic + async LLM summary), the
  digest injection into the cached system prefix, and the `__sugaragentMemory` dev
  handle. This epic changes the record SHAPE and the MERGE behavior inside that store;
  it does not add storage infrastructure.
- Plan 074 (World Clock + Context Completion) -- shipped `player-known-facts` (074.5),
  a BLACKBOARD concept (facts the player has learned). Deliberately kept separate from
  NPC memory (see D8). Do not conflate.
- Deferred comment `packages/plugins/src/catalog/sugaragent/runtime/memory/npc-memory-store.ts:425-428`
  -- the literal in-code DEFERRED SEAM marking `mergeSummary` as where consolidation
  belongs.
- Task #414 (DEFERRED (073): server-side / cross-device NPC memory sync) -- the
  transport-layer follow-on; out of scope here (see Non-goals).

---

## Why now

Every conversation with an NPC starts from a wholesale-overwritten summary of roughly
the LAST conversation, so characters have no durable, growing memory of the player. The
felt symptom is REPETITION: Finnick re-introduces his wife Maggie and re-tells his
gouda-obsession story every single time Mim talks to him, because a fresh session has no
record that he already shared those things with her. Relationship is the product -- the
player's bond with characters who are secretly their teachers is the emotional engine of
the game -- and repetition is the thing that most visibly breaks the illusion of a
character who knows you.

073 deliberately deferred accumulation/consolidation until there was a concrete driver.
The gouda/Maggie repetition is that driver, and it is cheap to build and test NOW while
records are small (kilobytes), before real play makes them big and before the next large
body of work (sugarlang) lands. The store, the dispose-time LLM call, the digest
injection, and the dev handle all already exist -- this epic accumulates instead of
overwrites, scores for salience, and adds the one new signal (self-disclosure) that
directly kills the repetition.

## The decision, and why (read this first)

The 073 ticket framed this as "compaction" -- shrink the record to save tokens. Discovery
(three parallel research + code-audit agents, 2026-07-24) found that framing is wrong on
two counts, and the correct framing changes the whole design:

1. **There is nothing to compact today.** `mergeSummary`
   (`npc-memory-store.ts:442-453`) REPLACES the summary fields wholesale every
   conversation. Facts do not accumulate, so the record cannot grow, so the 800-char
   digest cap effectively only ever truncates a single conversation's summary.
   "Records approach the cap" (the 073 revisit trigger) basically cannot happen until we
   first make memory ACCUMULATE. The real feature is accumulation; compaction is a
   downstream consequence of it.

2. **At kilobyte scale this does not save money -- it is a QUALITY feature.** The digest
   injected per conversation is capped at ~800 chars (~250 tokens); that injection is
   already negligible. Compressing a larger record saves no meaningful prompt tokens, and
   a consolidation LLM call spends OUTPUT tokens (5x input price on Sonnet). Every
   measured "90% savings" result in the literature comes from 26k-token-plus contexts or
   50+ tool-call agent runs -- none at our scale. So we build this for believable,
   non-repetitive characters, NOT for cost. If we sell it internally as a token saver we
   will be disappointed. (Full cost reasoning in Research Q5.)

Given that, the chosen approach is **accumulate structured, importance-scored memory
items with reconciliation on write, and rank them deterministically to fill the digest
budget at render time** -- the mem0/Zep "structured facts + upsert" pattern plus the
Generative Agents retrieval score, adapted to a small local store. The genuinely
expensive piece (an LLM reflection pass that re-reads the whole pile to merge and distill)
is DEFERRED behind a size trigger, because the accumulation + code-level dedup + salience
ranking gets the golden use case with NO new per-conversation LLM call.

Why this over the alternatives:
- **vs. keep wholesale-replace + just fix the truncation bug:** cheapest, but leaves
  memory shallow (only the last conversation) -- it does not fix repetition across many
  conversations, which is the whole point.
- **vs. full LLM consolidation now (the 073 "compaction" reading):** most believable, but
  the most moving parts, the trickiest to get right (nikki's prior attempt stalled here),
  and it buys no cost win at this scale. Premature. Deferred as D6 behind a trigger.

## Non-goals

- **No cross-device / server-side sync.** Memory stays in the local per-browser
  IndexedDB store 073 built (`sugaragent-npc-memory:${userId}`). Cross-device sync is
  task #414 and layers a transport on top of the same record shape later; it does not
  block this epic and this epic does not start it.
- **No new LLM reflection/consolidation pass in v1.** The append-then-distill LLM call is
  D6, deferred behind a size trigger. v1 accumulates + dedups in code and ranks
  deterministically.
- **No change to the two-phase dispose contract or the gateway summary routing.** We
  extend the EXISTING dispose summary call's schema (D3); we do not add a second call,
  change `purpose:"summary"` routing, or touch `SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL`.
- **No feeding NPC memory into the blackboard or into game logic.** NPC memory is
  subjective and LLM-extracted (fallible); it drives dialogue tone only. Quest gates read
  the blackboard, never memory (D8). A quest that must react to something the player did
  uses a `learn-fact` quest action (074.5) writing the blackboard, not a memory item.
- **No sugarlang changes.** Verified independent (D7); this epic must not touch
  sugarlang's store, and must preserve the deterministic met/not-met signal it relies on
  indirectly.

## Current behavior (ground truth, verify at the gate)

All paths under `packages/plugins/src/catalog/sugaragent/` unless noted. Every claim below
was read from producing code during discovery; re-verify at the gate.

- **The record.** `NpcMemoryRecord` (`runtime/memory/npc-memory-store.ts:70-96`) holds:
  `key`/`userId`/`playthroughId`/`npcDefinitionId`/`schemaVersion`; `metCount` and
  `conversationCounter` (both bumped by `mergeDeterministic` `:411-412`); `lastExchange`
  (truncated, deterministic); and the LLM-written `relationshipSummary` (string),
  `salientFacts`/`promises`/`emotionalBeats` (string[]), `lastConversationSummary`
  (string), `summaryCounter` (which conversation the summary reflects). Schema version
  const `NPC_MEMORY_SCHEMA_VERSION = 1` (`:52`).
- **Wholesale replace (the core thing this epic changes).** `mergeSummary(delta, counter)`
  (`:429-458`) REPLACES each list field with the incoming delta's list -- there is NO
  accumulation and NO dedup across conversations. The incoming delta is itself capped by
  the summarizer to 8 items/list and 200 chars/fact. So the durable record has NO growth
  bound today; it just holds the latest summary. (Verified: no `slice`/`shift`/evict on
  the store's record lists except the reset-prune.)
- **Staleness gate (must preserve).** `mergeSummary` drops a summary whose `counter <
  record.summaryCounter` (`:434-438`) -- a late async summary from an earlier conversation
  never regresses a newer record. `mergeDeterministic` bumps `conversationCounter` and
  returns it; that value tags the async summary.
- **Serialized promise-chain (the store's concurrency idiom).** Every public op wraps its
  body in `enqueue(work)` (`:373-380`); a load issued after a merge orders behind it with
  no callsite coordination. Preserve this -- new ops must go through `enqueue`.
- **Two-phase dispose write.** `summarizeConversationAtDispose`
  (`runtime/memory/conversation-summarizer.ts:268-298`): guard (skip the ENTIRE write if
  no user-turn, `:277-287`), then Phase 1 `await mergeDeterministic(...)` (sync), then
  Phase 2 `runAsyncSummary(...)` fire-and-forget (`:296`). Call site `runtime/provider.ts`
  dispose `:590-624`, gated on `config.memoryEnabled`, `void summaryComplete.catch(...)`
  so dispose never blocks on the gateway.
- **The extraction call (we extend this, D3).** `runAsyncSummary` (`:202-252`) already
  calls `deps.llmProvider.generateStructuredTurn({ model:"", purpose:"summary",
  systemPrompt: SUMMARY_SYSTEM_PROMPT, userPrompt: <transcript>, maxTokens: 400 })`
  (`:216-224`), model chosen server-side from `purpose`. Response validated by
  `parseSummaryDelta` (`:104-144`): tolerant JSON extraction, AJV against `summarySchema`
  (`additionalProperties:false`), per-field coercion, caps `MAX_SUMMARY_CHARS=600` /
  `MAX_FACT_CHARS=200` / `MAX_LIST_ITEMS=8` (`:37-39`). Then `mergeSummary(parsed.delta,
  counter)`. This is the existing fact-extraction call -- accumulation rides it.
- **The digest cap (a CHARACTER cap, not tokens).** `DEFAULT_MEMORY_DIGEST_MAX_CHARS = 800`
  (`runtime/memory/digest.ts:35`, config-overridable `memoryDigestMaxChars`, clamped
  200-2000 in `index.ts:256-259`). `buildMemoryDigest(record, maxChars)` (`digest.ts:70-102`)
  assembles fields in FIXED order (relationship -> facts -> promises -> beats ->
  last-conversation), joins, then `truncate(...)` (`:56-58,101`) blunt-chops with an
  ellipsis. GOTCHA: because `lastConversationSummary` sorts LAST, overflow drops the
  FRESHEST continuity content first -- backwards from what we want.
- **Where the digest enters the prompt.** Middleware memoizes `{record, digest, metCount}`
  under `MEMORY_STATE_KEY` (`digest.ts:30`) in `execution.state`; `GenerateStage`
  (`runtime/stages/generate/GenerateStage.ts:411-413`) reads `.digest`; builder slots it
  at `runtime/stages/generate/prompt/builder.ts:104` (between core knowledge and voice
  directive). The digest text is headed "What you remember about this player..." and
  hardcodes the acquaintance line when `metCount > 0` (`digest.ts:84`, 073.4 first-meeting).
- **Dev handle.** `__sugaragentMemory` (`runtime/memory/memory-debug.ts:20`) exposes
  `dump(npcDefinitionId?)` and `forget(npcDefinitionId?)`. Our test loop: `dump()` before/
  after, `forget()` to reset, drive conversations to observe accumulation + ranking.
- **Sugarlang independence (verified, D7).** Separate store
  (`sugarlang-card-store:${profileId}`, object store `lemma-cards`) vs
  (`sugaragent-npc-memory:${userId}`, object store `npc-memory`). Sugarlang never reads
  any sugaragent memory field; the `minimalGreetingMode` flag is deliberately decoupled
  from `metCount` (explicit comment `sugar-lang-teacher-middleware.ts:392-395`). The only
  dataflow is the reverse (sugaragent reads sugarlang's greeting flag).

## Research (2026-07-24 sweep; citations are primary sources, quoted)

Full brief in the discovery transcript; the load-bearing findings and their sources:

- **Two things get called "compaction."** (A) Context compaction = shrink a live
  transcript to survive the window. (B) Memory consolidation = distill durable facts into
  an external store. Our records are (B); most published trigger numbers ("70%") come from
  (A) and do not transfer.
- **Frameworks split prose-summary vs structured-facts.** MemGPT recursively summarizes
  evicted messages into prose. mem0 extracts structured facts and reconciles against
  existing ones -- "ADD for creation... UPDATE for augmentation... DELETE for removal of
  memories contradicted by new information; and NOOP" (arxiv 2504.19413v1). Zep/Graphiti
  extract facts into temporal graph edges and invalidate contradicted edges rather than
  deleting (arxiv 2501.13956v1). LangMem does hot-path + background "reflect on a
  conversation after it occurs" consolidation (langchain-ai.github.io/langmem). We follow
  the STRUCTURED-FACTS + UPSERT camp (mem0/Zep), not prose (MemGPT), because facts dedup,
  survive re-compaction without drift, and are inspectable for a game.
- **OpenAI has no memory/consolidation API primitive.** Assistants API is sunset
  ("deprecated... shut down on August 26, 2026", developers.openai.com). Responses/
  Conversations store transcript STATE and re-bill all tokens; `truncation:"auto"` DROPS
  middle items, does not summarize. ChatGPT "memory" is consumer-only, no API. We build
  consolidation ourselves.
- **Anthropic states the standard technique.** "Compaction is the practice of taking a
  conversation nearing the context window limit, summarizing its contents, and
  reinitiating a new context window with the summary"; the art "lies in the selection of
  what to keep versus what to discard"; tune by "maximizing recall... then iterate to
  improve precision" (anthropic.com/engineering/effective-context-engineering-for-ai-agents).
  Now also a Messages API primitive (`compact_20260112`, trigger on `input_tokens`,
  default 150k, min 50k) -- but that is for a LIVE context window, min 50k tokens; our KB
  records are 100x too small to use it. The PATTERN transfers, the primitive does not.
- **Trigger policy: "70%" is cargo-cult; async off-hot-path is the real consensus.** The
  70% figure traces to one "e.g." in the MemGPT paper; shipping agents fire at 75-95%;
  nobody has benchmarked trigger thresholds. Strong consensus is that heavy consolidation
  runs in the BACKGROUND, and naive LRU eviction of FACTS is a documented anti-pattern
  (the "penicillin allergy pruned after 6 months" failure).
- **Cost (Q5): does not pay for itself at our scale.** Consolidation's recurring saving is
  (raw - digest) CHEAP input tokens per future injection; its one-time cost is EXPENSIVE
  output tokens to write the digest. Break-even studies put it at 9-13 reuses and only as
  context grows to 30k-500k tokens (arxiv 2603.04814); vendor "90%+" headlines exclude the
  consolidation call's own cost (mem0's own paper caveat). And prompt caching a stable
  digest (Anthropic cache reads "0.1 times the base input tokens price") usually beats
  paying an LLM to shrink it. Our 800-char digest is already tiny -- so the lever here is
  SALIENCE (which 800 chars), not token reduction.
- **Keep-vs-forget: Generative Agents (Park et al. 2023).** Retrieval score =
  "recency + importance + relevance" (all weights 1). Recency = exponential decay
  (factor 0.995) over time since LAST RETRIEVED (recalled memories stay warm). Importance
  = LLM-scored 1-10 ("poignancy") at creation. Relevance = embedding similarity.
  Reflection (episodic -> semantic distillation) fires "when the sum of the importance
  scores for the latest events... exceeds a threshold (150)". They NEVER hard-delete --
  they soft-forget by ranking. We adopt importance-scored ranking; we defer reflection
  (D6) and embedding-relevance (start with importance x recency; see Deferred).

Honest uncertainty: no trigger threshold is empirically validated; the specific
break-even numbers are 2026 preprints (single-source); "reversible structured facts beat
irreversible prose under repeated compaction" is plausible theory, not benchmarked. We
lean on it as a design heuristic, not a proven law.

## Design decisions (epic-review ratifies)

- **D1 -- This is a quality feature, framed as killing cross-conversation repetition, not
  a token/cost optimization.** Acceptance is behavioral (the gouda/Maggie test), not a
  token-count delta. We explicitly do NOT promise cost savings at this scale (Research
  Q5). The 800-char digest is a SALIENCE budget, not a cost lever.

- **D2 -- Accumulate structured, importance-scored memory items with reconciliation on
  write (mem0/Zep pattern), replacing wholesale-overwrite.** The record's list fields
  become accumulating collections of scored items rather than last-conversation snapshots.
  On each dispose summary, new items are UPSERTED against existing ones (add new;
  update/refresh recency on a near-match; noop on exact dup) rather than replacing the
  list. Near-match dedup is code-level (normalized-text similarity), NOT an LLM call in
  v1. This is the reconciliation camp from Research Q1; facts dedup and stay inspectable.

- **D3 -- Piggyback importance scoring AND the self-disclosure signal on the EXISTING
  dispose summary call; add NO new per-conversation LLM call.** Extend
  `SUMMARY_SYSTEM_PROMPT` + `summarySchema` (`conversation-summarizer.ts`) so the one call
  we already make also returns (a) an `importance` 1-10 per item (Generative Agents
  poignancy) and (b) a new `disclosures` list -- things the NPC TOLD the player this
  conversation (see D4). Same call, same round-trip, a few more output tokens. This is the
  crux of why accumulation is cheap: the fact-extraction call already runs; we ask it for
  more, not again.

- **D4 -- Capture SELF-DISCLOSURE as a first-class facet -- this is the repetition lever.**
  The current schema captures what the NPC learned about the PLAYER
  (`salientFacts`/`promises`/`emotionalBeats`). It does NOT capture what the NPC has
  already SHARED ABOUT ITSELF. That is exactly what drives the gouda/Maggie loop: Finnick
  re-discloses stable bio as if new. Add a `disclosures` list ("told player: wife is
  Maggie", "told player: loves aged gouda"), accumulated and deduped like other items.
  Distinguish clearly: stable bio (Maggie, gouda) lives in the persona/definition;
  `disclosures` records the ACT of having shared it with THIS player. The digest injects a
  "you have already shared with this player:" line, and D5's directive tells the model to
  not reintroduce them.

- **D5 -- Deterministic salience ranking at digest render; NO LLM at render; fix the
  freshest-first truncation bug.** Replace `buildMemoryDigest`'s fixed-order-join +
  blunt-truncate with: rank all memory items by `importance x recency-decay`
  (Generative Agents, minus embedding-relevance for v1 -- see Deferred), then fill the
  800-char budget highest-first, dropping the lowest-ranked. This IS the "compaction" for
  the digest, and it is pure deterministic code -- cheap, debuggable, no drift. It fixes
  the current bug where overflow drops the freshest content (`digest.ts:101`). Recency
  decay keys off last-updated/last-retrieved per item (warm items survive). Rendering
  stays byte-stable enough for the cached-prefix slot 073.3 established (the digest is a
  stable slot; ranking is deterministic given the record).

- **D6 -- Defer the LLM reflection/consolidation pass behind a size trigger (Strategy
  pattern seam).** The append-then-distill LLM call (re-read the whole item pile, merge
  near-duplicates, promote episodic -> semantic, prune) is the expensive/tricky piece
  (Research Q6; nikki's prior attempt). It is NOT needed for the golden use case: D2 dedup
  + D5 ranking bound the DIGEST regardless of pile size, and the stored pile stays small
  for a long time. Structure the merge (D2) and render (D5) as strategies behind stable
  seams so reflection drops in later as a new strategy WITHOUT touching call sites.
  Revisit trigger (code comment + Deferred): when the stored item count per record crosses
  a threshold in real play (start ~50 items, tune), or when dedup quality visibly degrades
  (near-duplicates the code matcher misses accumulate). Reflection must respect the
  staleness gate and reversibility caution (prefer merging structured items over collapsing
  to prose).

- **D7 -- Preserve the sugaragent invariants; do not touch sugarlang.** Compaction/
  accumulation must keep `metCount` MONOTONIC (never zero it) and honor the
  `summaryCounter` staleness gate on any new write path (`npc-memory-store.ts:434-438`).
  Sugarlang is a separate store and reads no memory field (verified, Current behavior); the
  only indirect coupling is the deterministic met/not-met signal, which accumulation
  preserves by construction. New-Game reset (`store.reset()`) must continue to clear the
  accumulated pile for a fresh playthrough (073.1c invariant: empty memories + sugarlang
  store untouched).

- **D8 -- Two fact systems stay separate; give NPC memory items a distinct name.** The
  runtime BLACKBOARD holds objective, authoritative world/quest state that game logic
  branches on (quest stage, time-of-day, `player-known-facts` 074.5). NPC MEMORY holds
  subjective, LLM-extracted, per-NPC-per-player recollection that only flavors dialogue.
  They must not cross-feed: no quest gate reads memory; `player-known-facts` (what the
  player knows) is not the same as memory (what an NPC remembers about the player). To
  avoid the "facts" collision in code/docs, name the NPC-memory items distinctly (e.g.
  "recollections" / keep `disclosures` explicit) and reserve "facts" for the blackboard in
  new surfaces. (Existing `salientFacts` field name may stay for compatibility but the
  docs draw the line.)

## Design patterns in use

- **Reconciliation / upsert (mem0 ADD/UPDATE/NOOP)** -- D2 merge, replacing wholesale
  overwrite.
- **Generative Agents retrieval scoring (importance x recency [x relevance])** -- D5
  render ranking; relevance deferred.
- **Strategy pattern behind stable seams** -- D5 ranking and D6 reflection are policies
  behind the digest-build and merge seams, so the deferred LLM pass is a localized drop-in.
- **Structured output + schema validation (AJV)** -- D3 extends the existing
  `summarySchema`/`parseSummaryDelta` contract rather than inventing a parser.
- **Serialized promise-chain + monotonic staleness counter** -- existing store idioms
  (`enqueue`, `summaryCounter`); all new writes go through them (D7).
- **Byte-stable cached-prefix slot** -- 073.3's digest slot; D5 keeps render deterministic
  so the cache slot stays stable.

## Gotchas (verified; carry into stories)

- **The cap is CHARACTERS, not tokens or bytes** (`digest.ts:35`, `String.length`). Do not
  design around token accounting.
- **Today overflow drops the FRESHEST content first** (fixed-order join, `lastConversationSummary`
  last). D5 must fix this, not preserve it.
- **Wholesale-replace is load-bearing current behavior.** Switching to accumulate is the
  central change and the main regression risk -- the migration must not lose or duplicate
  existing single-summary records.
- **Migration is NOT version-gated.** `migrateNpcMemoryRecord` (`:169-189`) unconditionally
  coerces every read to defaults regardless of stored `schemaVersion`. Adding fields needs
  the defensive coerce updated AND a real `NPC_MEMORY_SCHEMA_VERSION` bump with a genuine
  upgrade branch (old records: existing single-summary lists become the initial accumulated
  items, importance defaulted).
- **Two constants share the string `"sugaragent.memory"`** (`MEMORY_STATE_KEY` and
  `MEMORY_ANNOTATION_KEY`, `digest.ts:30,32`) in different namespaces. Do not merge them.
- **LLM importance scores are noisy.** Never let game logic branch on them (D8). Ranking
  tolerates noise; a quest gate would not.
- **Memory alone will not stop repetition -- the prompt must USE it.** D5's injected
  "already shared" line needs a directive (D4/story 080.5) telling the model not to
  reintroduce disclosed items, or the model has the info and still rambles.
- **Do not zero `metCount`** in any accumulation/dedup path (D7) -- it gates first-meeting
  semantics and, indirectly, sugarlang's greeting.

## Stories (EXECUTION ORDER -- proposed; ratified/renumbered at epic-review)

### 080.1 Record shape v2: accumulating scored items + disclosures + migration
Extend `NpcMemoryRecord` so list fields carry scored, timestamped items (item = text +
importance + last-updated counter) and add the `disclosures` list. Bump
`NPC_MEMORY_SCHEMA_VERSION` and give `migrateNpcMemoryRecord` a real v1->v2 branch: an old
record's existing `salientFacts`/etc. become initial items with a default importance and
the current `conversationCounter` as their timestamp; `disclosures` starts empty. Preserve
`metCount`/counters exactly. Exit: unit tests -- v1 record loads and upgrades losslessly to
v2 (no dropped content, metCount/counters intact); a fresh record has empty accumulating
lists; the in-memory and IndexedDB backends both round-trip the new shape.

### 080.2 Extraction upgrade: importance + disclosures on the existing dispose call (D3)
Extend `SUMMARY_SYSTEM_PROMPT` and `summarySchema` so `runAsyncSummary`'s single existing
call also returns per-item `importance` (1-10) and a `disclosures` list (things the NPC
told the player this conversation). Extend `parseSummaryDelta` coercion/caps accordingly
(clamp importance to 1-10; cap disclosures like other lists). NO new call, NO routing
change. Exit: unit tests with a mock gateway -- a summary response with importance +
disclosures parses and validates; out-of-range importance clamps; a response missing the
new fields still parses (back-compat) with importance defaulted.

### 080.3 Accumulating merge with reconciliation (D2) -- replaces wholesale overwrite
Rewrite `mergeSummary` to UPSERT the incoming scored items into the record's accumulating
lists (add new; refresh recency/importance on a code-level near-match; noop on exact dup)
instead of replacing. Same for `disclosures`. Keep the `summaryCounter` staleness gate and
the `enqueue` serialization (D7). Exit: unit tests -- two consecutive summaries accumulate
(not replace); a repeated fact dedups and refreshes recency rather than duplicating; a
stale-counter summary is still dropped; `metCount` never regresses; New-Game `reset()`
clears the pile.

### 080.4 Salience-ranked digest render (D5) -- fixes freshest-first truncation
Replace `buildMemoryDigest`'s fixed-order-join+truncate with importance x recency-decay
ranking that fills the 800-char budget highest-first. Inject a distinct "you have already
shared with this player:" line sourced from `disclosures`. Keep render deterministic for
the cached-prefix slot. Exit: unit tests -- over-budget records keep the highest-ranked
items and drop lowest (NOT freshest); the disclosures line renders and is bounded; two
renders of the same record are byte-identical; a null/empty record renders as today
(first-meeting path unchanged).

### 080.5 Prompt directive: use disclosures to suppress re-disclosure (D4)
Wire the builder so the disclosures block carries a directive instructing the NPC not to
reintroduce things already shared with this player. Minimal copy per house norm. Exit: the
directive appears in the assembled prompt when disclosures exist and is absent when empty;
a prompt-builder unit test asserts the block placement/stability.

### 080.6 Wrap: docs, dev-handle tests, golden acceptance, deferred reflection trigger
Update `docs/api/sugaragent-npcs.md`: the accumulating-memory model, the blackboard-vs-
memory boundary (D8), the disclosures/repetition mechanism, and the record shape v2. Add
the golden acceptance test (below) via `__sugaragentMemory`. File D6 (LLM reflection pass)
as a backlog task with the size-count revisit trigger AND a code comment at the merge seam.
Retire/close #415 in favor of this epic; keep #414 (server sync) and the new reflection
task as the live deferred items. Exit: docs updated, `pnpm test` green, deferred task +
code comment filed.

## Golden use case (primary acceptance criteria)

The feature works iff cross-conversation repetition stops:

1. New Game. As Mim, talk to Finnick. In conversation he shares that his wife is Maggie and
   that he is obsessed with aged gouda. End the conversation. Give the async summarizer a
   few seconds (it is fire-and-forget at dispose).
2. `__sugaragentMemory.dump("npc:finnick")` shows a `disclosures` list containing the
   Maggie and gouda disclosures, each with an importance score, accumulated (not blank).
3. Talk to Finnick AGAIN in the same playthrough. He does NOT reintroduce Maggie or
   re-tell the gouda story as if new -- he speaks as someone who already told her, and can
   build on it ("as I mentioned...").
4. Over several more conversations, `dump()` shows the item lists ACCUMULATING and
   deduping (a fact mentioned twice does not appear twice; its recency refreshes), and the
   rendered digest stays within the 800-char budget by keeping the highest importance x
   recency items -- never blank-truncating the freshest content.
5. Regression guards: an NPC never spoken to has empty memory; New Game clears all
   accumulated memory; sugarlang vocab/greeting behavior is unchanged (separate store);
   `metCount` first-meeting semantics still hold.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Run the golden use case above in preview. The pass/fail signal is step 3 (Finnick does
   not repeat himself) plus step 4 (`dump()` shows accumulation + dedup, digest within
   budget).
3. Force compaction early to stress-test salience: set `memoryDigestMaxChars` low (e.g.
   300) via config so ranking fires constantly; confirm the NPC still "remembers the right
   things" (high-importance disclosures survive; trivia drops) -- the quality signal that
   matters, independent of cost.
4. Confirm no cost regression in the per-conversation path: still exactly one dispose
   summary call, no new call added.

## Deferred (with revisit triggers)

- **LLM reflection/consolidation pass (D6).** Re-read the accumulated pile to merge near-
  duplicates the code matcher misses, promote episodic -> semantic, and prune. Revisit
  trigger: stored item count per record crosses a threshold in real play (start ~50, tune),
  or dedup quality visibly degrades. Must respect the staleness gate and prefer merging
  structured items over collapsing to prose (reversibility, Research Q6). Code comment at
  the merge seam.
- **Embedding-relevance term in the ranking.** D5 ships importance x recency only.
  Revisit trigger: when the digest budget forces dropping items that ARE relevant to the
  current conversation topic but rank low on importance x recency -- add a relevance term
  (embedding similarity of item vs current topic), completing the Generative Agents triad.
  Needs an embedding source in the runtime path.
- **Server-side / cross-device memory sync (#414).** Push records server-side so memory
  follows the player across devices. Revisit trigger: real accounts + multi-device play.
  The v2 record shape is designed so this is a transport change, not a redesign.
- **Importance-decay tuning + soft-forget policy.** v1 never hard-deletes stored items
  (they only drop from the DIGEST via ranking). Revisit trigger: stored piles grow large
  enough that even with D6 reflection the IndexedDB record size matters -- add a soft-forget
  eviction on lowest importance x recency (never naive LRU; Research Q4).
