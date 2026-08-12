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

## Retrieval Score Observability

`window.__sugaragentRetrieval` is installed unconditionally at session start
(Plan 078.1). It exposes the per-chunk similarity scores from the most recent
turn for each NPC, so you can see what the vector search actually returned
before tuning the relevance floor (Plan 078.2).

From a devtools console or an automated browser session:

```javascript
// Dump last-seen retrieval snapshot for all NPCs this session
__sugaragentRetrieval.dump()

// Dump for one NPC
__sugaragentRetrieval.dump("npc:finnick")
```

Each entry: `{ npcDefinitionId, loreScores, loreSearchPerformed, broadenedBeyondLorePage, ownPageExcluded, noSearchReason }`.

`noSearchReason` is null when a search ran. Otherwise it names why one did not:
`social-fast-turn` (a greeting, which skips retrieval), `no-vector-store-provider`,
`no-proxy-base-url` (the gateway is not configured), or `search-failed`. Without
it, all four look identical from outside: `loreSearchPerformed` false and no scores.

`loreScores` is an array of `{ score, source, pageId, fileId }`, one entry per
chunk in the final `loreContext` for that turn. The `source` tag says why the
chunk is there:

- **`retrieved`** -- came back from the OpenAI vector search. The player's
  message was embedded and the gateway returned semantically similar wiki chunks.
  These are relevance-ranked and could be anything in the lore.

- **`pinned`** -- the stage fired a second search specifically for the NPC's own
  lore page (`npcLorePageId`) as an identity anchor. This happens when the
  primary search targets a different page (e.g. a location-anchored turn). The
  pinned chunk got into the context by identity, not by relevance ranking. A low
  score on a pinned chunk is expected and should not be treated as noise: it
  means the NPC's page happened to score low against this particular query, not
  that the chunk is irrelevant to the NPC.

- **`synthetic-location`** -- not from the vector DB at all. It is a string
  assembled at runtime from the blackboard: current area, NPC task, proximity to
  the player, etc. Always given `score: 1` (authoritative fact, not a similarity
  estimate). The threshold never applies to it.

Only `retrieved` chunks pass through the threshold, because it is applied by the
vector store during the search. `pinned` and `synthetic-location` chunks are
added afterward and are unaffected.

Every score in a dump is a score that already cleared the threshold. A result
below it never comes back, so it cannot appear here.

**File:** `packages/plugins/src/catalog/sugaragent/runtime/stages/retrieval-debug.ts`

## The Relevance Threshold

### What it is

`loreRelevanceFloor` is the minimum similarity score a lore chunk must reach to
be returned by a search at all. Range 0..1, where 0 means no filtering and 1
means nothing passes.

### Where it lives

One value, set per project in **Studio > SugarAgent > NPC Behavior > Lore
Relevance Floor**.

It is handed to `SugarAgentGatewayVectorStoreProvider` at construction
(`runtime/provider.ts`) and travels on every search request as `scoreThreshold`.
The gateway passes it to the vector store as `ranking_options.score_threshold`
(`deployment/gateway/core.ts`). A request that omits the field gets the
gateway's own fallback.

Both search paths are covered because both go through that one provider: the
per-turn `RetrieveStage` search and the quest-context world block. Neither one
knows the threshold exists, which is deliberate -- there is no call site that
can forget to apply it.

**Nothing in the game filters by score.** The vector store does it. A chunk
below the threshold is never returned, never sent over the wire, and cannot
appear in any debug dump. If you are trying to measure the low end of a score
distribution, set the threshold to 0 first or you will be measuring through a
filter.

The bounds and the shipped default live in
`catalog/sugaragent/runtime/lore-relevance.ts`. The gateway carries the same
default as its fallback; the two sit on opposite sides of an HTTP call and have
to be kept in step by hand.

### What it does not affect

Only searched chunks pass through it. `pinned` chunks (the NPC's own lore page,
fetched by identity) and `synthetic-location` entries (assembled from the
blackboard, always scored 1) are added after the search returns.

### Why it is 0.3

Because that is what the gateway had been applying all along, as a hardcoded
fallback, before the setting was wired through to it. 0.3 is inherited, not
chosen. No measurement supports it, and no measurement supports anything else
either.

That is not for lack of looking. The failure that prompted this work -- a
Spanish-language podcast page presented to an NPC as the state of the world --
turned out not to be a relevance failure. The player asked about a lost
suitcase; the podcast narrates a character packing one and leaving for a
station. Scored against that query, it was a genuinely good match, and it lost
to the correct page by 0.019.

A threshold separates relevant results from irrelevant ones. It cannot separate
results that are relevant and wanted from results that are relevant and
unwanted. Raising it to exclude that podcast would have excluded the correct
page on the next phrasing.

So the value stays where it is until an actual irrelevant result is observed --
something unrelated to the query, scoring low, reaching an NPC. None has been
seen yet.

### What would justify changing it

Evidence of noise, not evidence of a bad ranking. Concretely:

1. Set the threshold to 0 so nothing is hidden.
2. Ask an NPC several questions, on and off topic. After each turn read
   `__sugaragentRetrieval.dump()` and look at `searchQuery` alongside
   `loreScores.filter(s => s.source === "retrieved")`.
3. Look for results that are unrelated to the query that was actually sent --
   not results that are related in a way you did not want.
4. Repeat a question unchanged to see how far scores move. Run-to-run drift of
   0.05-0.10 on the same query is normal, so any threshold needs more margin
   than that to be stable.

If the unwanted results turn out to be correct matches, the lever is the lore
set or how it is indexed, not this number.

The quest-context path deserves its own check, because it uses a single result
and keeps it for a whole quest stage:

```javascript
__sugaragentQuestContext.dump("npc:your-npc-id")
```

`worldContextScore` is the score of the text that reached the prompt.
`worldContext` of null means nothing cleared the threshold and the NPC is
running without world context, which is the intended outcome when the lore has
no answer.

## Indexing Depth: `canon_level`

A lore page's metadata may carry `canon_level`, which decides how much of the
page enters the search index.

```
---
id: lore.media.podcasts.archivado.episode_01
title: Archivado -- Episodio 1
canon_level: soft
---
```

**`hard`** (the default, and what a page without the key gets) -- one chunk per
section. The page's contents are searchable.

**`soft`** -- one chunk carrying the page's id and title and nothing else. A
search can discover that the page EXISTS. It cannot reach anything described
inside it.

### Why this exists

For in-world media: a documentary, a book, a broadcast. Such a page is as true
as any other, so excluding it would be wrong, and filtering by page kind would
be wrong for the same reason.

The problem is not truth, it is distance. The world contains the podcast; the
podcast contains a suitcase. Index its contents and every noun inside somebody
else's story competes with the same noun in the world itself. Asked about a
lost suitcase, a page narrating a character packing one scores about as well as
the station where the luggage actually is -- a correct match, and the wrong
answer.

Indexing only the identity removes the competition without removing the page. A
player asking about the Handbook for the Recently Transported still finds it,
because that query matches its title. A player asking about a suitcase no
longer finds a scene inside it.

### What it does not do

The full text is untouched. `pages[]` keeps every section and `lore/resolve`
returns the whole page by id. Only the search index is shallow, so "know that
it exists, fetch the contents when something warrants it" remains open.

`## Secrets` exclusion is unaffected and applies to both levels.

### Changing a page's level

Chunks are addressed by page plus section, and the ingest removes any indexed
address the source no longer has. Flip a page to `soft` and its section chunks
are deleted on the next Update Lore; flip it back and they return. Nothing to
migrate.

A soft page's chunk is addressed `<pageId>#_page`. Generated section slugs are
`[a-z0-9-]` only, so the underscore cannot collide with a real section.

An unrecognized value is reported in the ingest warnings and treated as `hard`.
Indexing too much is recoverable by fixing the page; indexing too little looks
like the lore is simply missing.

Chunks also carry `canon_level` as a vector store attribute, so it is visible on
search results. Because `content_hash` covers embedding text only, that
attribute lands on an existing chunk the next time its text changes, or on
everything after a full Ingest Lore.

**Files:** `readCanonLevel`, `chunkAttributes` in
`packages/plugins/src/deployment/gateway/core.ts`.

## NPC Identity Fallback (no lore page)

When an agentified NPC has no lore page attached (or the lore API is
unavailable), `buildStableSystemLines` injects the NPC's `description` field
from `NPCDefinition` as a minimal identity anchor:

```
Who you are: <npcDefinition.description>
```

This fires only when both `personaCard` AND `coreKnowledge` are empty (i.e.
no real persona was loaded). It prevents the model from adopting retrieved
world-context (e.g. another character's lore page returned by the
quest-context middleware) as its own identity.

**Author action:** always fill in the NPC's Description field in the NPC
editor. It is the fallback floor and costs nothing. A lore page with a
`## Persona` section overrides it completely when loaded.

The **judge** applies the same fallback: when `persona.digest` is empty,
`JudgeStage` passes `"NPC description: <value>"` as the persona anchor. If
neither is set, the judge skips with `skipReason: "no-persona"` (no basis for
consistency evaluation).

**Files:** `ConversationSelectionContext.npcDescription` (runtime-core),
`buildStableSystemLines` in `prompt/builder.ts`, `JudgeStage.ts`.

## World Events: Compose Existing Machinery (D5)

Quest-gated scene changes use existing seams, not new infrastructure:

- **Flag set from scripted NPC dialogue:** Put a `setFlag` action in the quest
  Talk node's `onCompleteActions`. When the player finishes the scripted
  dialogue, `questManager.notifyDialogueFinished` auto-completes the Talk node,
  which fires `onCompleteActions`, which calls `questManager.setFlag(targetId, value)`.
  The Talk node's `targetId` is the flag key; `value` is the flag value.
- **Flag set from agentified NPC turn:** PlanStage emits
  `{ kind: "set-conversation-flag", key, value }` -> `handleConversationActionProposal`
  -> `questManager.setFlag`. This is for runtime-emergent flag writes from AI
  NPC turns, not scripted dialogue.
- **Compound AND gate:** `evaluateRegionQuestBinding({ questDefinitionId, questStageId, worldFlagEquals })`
  in `packages/runtime-core/src/region-conditions/index.ts` evaluates stage
  AND flag together. Used by behavior-task activation, collision volumes, and
  NPC presence gating (Plan 079).
  Authored in Studio via the Behavior inspector (behavior tasks) or the Quest
  stage inspector (NPC presence gating, Plan 079).
- **Presence gating (Plan 079):** `RegionNPCPresence` carries
  `condition: RegionBehaviorQuestBinding | null` and `placementLabel: string | null`.
  A null condition means always present (existing behavior). A populated condition
  makes the NPC physically absent until the condition holds -- no mesh, no E prompt,
  no collision agent. Authored in Studio > Design > Quest: select a quest and a
  stage; the "NPCs visible in this stage" section lists every placed NPC presence
  with a checkbox. Checking a box sets that presence's condition to the selected
  quest + stage (`worldFlagEquals: null`). `placementLabel` is set in Build >
  Layout, NPC inspector; it overrides the NPC definition's `displayName` in the
  picker when the same NPC definition is placed more than once (e.g. "Finnick at
  the docks" vs "Finnick at the tavern"). The condition is evaluated per-frame;
  the NPC appears or disappears without a region reload. The three.js group stays
  resident (instant return).

**Choosing: behavior-task gating vs presence gating**

Both use the same compound-AND evaluator. Pick by what "absent" means:

| | Behavior-task gating | Presence gating (079) |
|---|---|---|
| NPC is physically in the scene | Yes (always) | No (absent until condition) |
| Mesh rendered | Yes | No |
| E prompt shown | Yes | No |
| Collision agent active | Yes | No |
| Behavior changes on condition | Yes | N/A (NPC appears/disappears) |
| Use for | "NPC is here but acts differently" | "NPC is not here yet" |

**Authoring pattern -- "NPC B appears upset only after player talked to NPC A":**

1. NPC A is scripted. Its dialogue is bound to a quest Talk objective node.
2. On that Talk node's `onCompleteActions`: add `setFlag`, targetId =
   `talkedToNpcA`, value = `true`.
3. NPC B is agentified. Place it in the region (always present).
4. Add a behavior task for NPC B with activation: quest stage = the relevant
   stage AND world flag = `talkedToNpcA` = `true`.
5. NPC B's task description drives their behavior when the compound condition
   holds; without the task active they are behaviorally neutral.

**Authoring pattern -- "NPC B only appears after player talked to NPC A":**

1. NPC A is scripted with a Talk dialogue node bound to a quest objective.
   Completing the dialogue auto-advances the quest to the next stage (e.g.
   "talked-to-npc-a").
2. NPC B is placed in the region (Build > Layout). Optional: add a Placement
   label in the NPC inspector (e.g. "Finnick post-talk") to identify it clearly
   in the picker if the same NPC definition is placed elsewhere.
3. In Studio > Design > Quest, select the quest and the "talked-to-npc-a" stage.
   In the "NPCs visible in this stage" panel, check the box next to NPC B.
4. NPC B is absent (no mesh, no E prompt) until the quest reaches that stage;
   appears without a region reload.

The evaluator handles compound AND natively. For a flag-only condition (no stage
requirement), set `RegionNPCPresence.condition.worldFlagEquals` directly via
`SetNPCPresenceCondition` -- the quest stage picker sets `worldFlagEquals: null`.

## SugarAgent Plugin Config

`questAwareNpcsEnabled: boolean` (default `true`) is the master switch.
When `false`:
- The quest-context middleware is not registered (no world lore in NPC prompts,
  no ease-off blackboard, pre-077 behavior).
- The `__sugaragentQuestContext` dev handle is not installed.

`worldPremise: string` (default `""`) -- a short paragraph describing your game
world. Sent to the judge as the grounding source for the WORLD-GROUNDED rubric
check. Without it the judge grades against generic RPG assumptions. Example:
`"Wordlark Hollow is a cozy village where everyone is an anthropomorphic animal."`

Set in Studio > SugarAgent > NPC Behavior > World Premise.

`loreRelevanceFloor: number` (default `0.3`) -- minimum vector similarity score
for a lore chunk to be returned at all. Range: 0..1 (0 = no filter, 1 = nothing
passes). Sent with every search as `scoreThreshold` and applied by the vector
store, so a chunk below it never reaches the game. Governs both the per-turn
retrieval search and the quest-context world block. See The Relevance Threshold
above for where the value comes from and why it has not been changed.

Set in Studio > SugarAgent > NPC Behavior > Lore Relevance Floor.

---

## Plan 075: Judge, Regen, and Safety

### JudgeStage (semantic rubric evaluation)

**File:** `packages/plugins/src/catalog/sugaragent/runtime/stages/JudgeStage.ts`

JudgeStage runs AFTER GenerateStage and BEFORE AuditStage. It calls the
gateway judge route (`/api/sugaragent/generate/judge`) to evaluate the NPC
reply against a semantic rubric via the Anthropic tool-use API
(`SUGARMAGIC_SUGARAGENT_JUDGE_MODEL`, default: `claude-haiku-4-5`).

**Skip conditions** (no LLM call, `skipped: true`):
- `generate.usedLlm === false` (deterministic/envelope-override turn)
- No judge provider (proxy URL missing)
- No NPC identity: both `persona.digest` and `npcDefinition.description` are empty (`no-persona`)

**Internal regex short-circuit:** calls `findMetaLeakViolations` on the
generated text before any LLM call. If structural violations are found,
returns `passed: false` immediately (saves a vendor round-trip).

**Fail-open on error:** any provider exception returns
`{ passed: true, errorOccurred: true }` and `fallbackReason: "judge-error"`.
This never triggers `isStalledTurn` (judge errors are excluded from the
stall governor).

**`JudgeResult` type:**
```typescript
interface JudgeResult {
  passed: boolean;
  violations: string[];
  repairHint: string | null;
  skipped: boolean;
  errorOccurred: boolean;
}
```

**Gateway route:** `POST /api/sugaragent/generate/judge`
Body: `{ replyText, personaDigest, responseIntent, worldContext, loreContextSummary, worldPremise }`
Uses Anthropic `tool_use` with `score_reply` tool and `tool_choice: { type: "tool", name: "score_reply" }`.

### RegenerateStage (bounded LLM regen + 3-strike governor)

**File:** `packages/plugins/src/catalog/sugaragent/runtime/stages/RegenerateStage.ts`

Replaces RepairStage. Decision tree (priority order):

1. Both `audit.passed && judge.passed` -> passthrough, no regen
2. `!audit.passed` -> structural violation -> deterministic fallback
3. `judge.errorOccurred` -> fail-open passthrough
4. `judge.skipped` -> passthrough
5. `consecutiveJudgeFailures >= 3` -> 3-strike governor -> deterministic fallback
6. No LLM provider -> deterministic fallback
7. Attempt one LLM regen (max 200 tokens). Re-lint with regex. Pass or fallback.

**Cost cap:** at most 2 generate invocations + 1 judge call per turn. No
second judge call after regen (latency/cost constraint per plan D2).

**3-strike governor:** `SugarAgentProviderState.consecutiveJudgeFailures` is
incremented when the judge fails (non-error, non-skip). Reset on any passing
judge verdict. After 3 consecutive failures, `RegenerateStage` skips regen
entirely and returns a deterministic reply.

### Content Moderation (075.3)

**File:** `packages/plugins/src/catalog/sugaragent/runtime/moderation/moderation-middleware.ts`

`ConversationMiddleware` with `stage: "policy"`. Two checkpoints per turn:

**`prepare` (player input check):**
- Extracts `free_text` player input.
- POSTs to `/api/sugaragent/generate/moderate` (gateway route).
- If flagged: annotates `sugaragent.moderationInputFlagged` on the execution
  context. The NPC pipeline sees this annotation; the `finalize` hook replaces
  the output with an in-character deflection.
- Fail-open: moderation outage never gates conversation flow.

**`finalize` (NPC output check):**
- If the input was already flagged, replaces the NPC reply with a deflection
  drawn from the `INPUT_DEFLECTIONS` pool.
- Otherwise moderates the NPC output text; replaces with `OUTPUT_DEFLECTIONS`
  pool if flagged.

Gated by `moderationEnabled` config (default `false`). Enable in the SugarAgent
studio settings under Safety > Content Moderation.

**Gateway route:** `POST /api/sugaragent/generate/moderate`
Body: `{ text: string }`
Response: `{ flagged: boolean, categories: string[], blocklisted: boolean }`

The gateway calls the OpenAI `/v1/moderations` endpoint using the same API key
as vector retrieval (`SUGARMAGIC_OPENAI_API_KEY`). Override the vendor base URL
for testing via `SUGARMAGIC_MODERATION_BASE_URL`.

### Topic Blocklist (075.4)

**Config key:** `blocklist` (comma-separated terms, default `""`)
**Gateway env:** `SUGARMAGIC_SUGARAGENT_BLOCKLIST`

Applied at two layers:
1. `/api/sugaragent/generate/moderate` pre-check: if any term matches the
   player input (case-insensitive substring), returns `{ flagged: true, blocklisted: true }`
   immediately (no OpenAI call).
2. `/api/sugaragent/generate` defense-in-depth: if any term matches the
   composed user prompt, returns a canned safe reply without calling Anthropic.

**Hotfix procedure (no image rebuild):**
Use Studio > SugarDeploy > `/__sugardeploy/update-blocklist`. This calls
`gcloud run services update --update-env-vars SUGARMAGIC_SUGARAGENT_BLOCKLIST=<terms>`
against each gateway service. The running container picks up the new env var
immediately (Cloud Run zero-downtime update). The config value in the Studio
settings panel is the initial-deploy value; hot-updates bypass it.

### Safety Observability (075.5)

Structured log events emitted by the gateway:

| Event | Where | Fields |
|---|---|---|
| `sugaragent.judge` | Judge handler | `passed`, `violations`, `durationMs`, `model` |
| `sugaragent.moderation-flagged` | Moderate handler | `categories`, `durationMs` |
| `sugaragent.blocklist-hit` | Moderate + Generate handlers | `term` |
| `sugaragent.moderation-error` | Moderate handler | `text` (40-char prefix) |
| `sugaragent.generate-blocklist-hit` | Generate handler | `term` |

All emitted via `logInfo` / `logError` (structured JSON to stdout; Cloud Run
routes to Cloud Logging). Filter by message prefix in Cloud Logging:
`jsonPayload.message =~ "sugaragent.judge|sugaragent.moderation"`.

### Pipeline Order (post-075)

```
Interpret -> Retrieve -> Plan -> Generate -> Judge -> Audit -> Regenerate
```

Diagnostics keys in `lastTurnDiagnostics`:
`Interpret`, `Retrieve`, `Plan`, `Generate`, `Judge`, `Audit`, `Regenerate`

The `Retrieve` payload includes `loreScores` (see Retrieval Score Observability
above) and is also mirrored to `window.__sugaragentRetrieval` for live
inspection without devtools archaeology into `lastTurnDiagnostics`.

All other quest-system config (lore source, vector store ID) is unchanged.
