# Plan 074 -- World Clock + Context Completion (child epic D of Strategy 001)

Status: Locked (epic-review passed 2026-07-19, 3 rounds) -- stories execute as written in the stated EXECUTION ORDER; deviations need STOP + amendment + re-gate.
Owner: nikki + claude
Date: 2026-07-19

Related:
- Strategy 001 -- child epic D. Independent of B/C in the strategy graph; feeds both. Prompt-side stories land in the post-072.4 user-message world block if 072 has shipped, or today's system-side block if not -- the stories name the seam, not the half.
- Plans 023 (blackboard -- the minimal fact registry this epic extends), 024/025 (spatial + schedules -- the systems that gain time-awareness), 055/056 (SaveParticipant pattern for persistables).
- Ground truth: 2026-07-18 audit, corrected in review round 1. No clock/time-of-day concept exists ANYWHERE in the engine (zero hits for timeOfDay/worldClock/gameClock across runtime-core + plugins + targets). `activeQuestObjectives` reaches ConversationRuntimeContext but no SUGARAGENT stage reads it (sugarlang middlewares do). `ENTITY_AFFECT` has zero production WRITERS but is NOT reader-free: sugarlang's teacher directive-cache invalidates on its change events, and the testing package exercises the getter/setter -- dead-in-practice, but deletion crosses plugin boundaries (see 074.7). No player-known-facts store exists.

---

## Why now

Nikki's stated context list for NPCs -- "the time of day (in game), the state of the quest, things that are known about the player, events that have happened" -- is half missing. Schedules (025) exist but have no clock to feel real against ("I'm heading to the market" means more at dawn). Epic C's memories have no "when". And quest-objective questions get vague redirects (or misclassified abstains) while their answers sit unread in the runtime context. This epic finishes the world-context story the 023/024/025 line started.

## Non-goals

Visual response to time (lighting/sky/ambience changes are an environment-authoring epic -- the clock exposes the signal; consuming it visually is deferred). NPC sleep/home simulation. Weather. Calendar/seasons. Memory content (epic C). Affect SIMULATION (we wire-or-delete the existing dead fact; we do not build an emotion system).

## Design decisions (epic-review ratifies)

- D1 -- The clock is authored, not real-time: in-game minutes advance at an authored ratio during active play (scale + start-time on the game-project settings mold), pause when the game is paused. Plumbing honesty (review round 1): NO tick suspension exists today -- the host calls session.update unconditionally every frame and the pause selectors have zero production consumers -- so this epic introduces the FIRST pause consumer. Decision: a paused flag flows into the CLOCK specifically (host passes lifecycle state down; the clock alone respects it); global simulation behavior (NPCs keep simulating while paused) is deliberately unchanged. The dialogue toggle (default PAUSED -- a long conversation should not skip the market's closing time out from under its own context) keys off `dialogueManager.isDialogueActive()`, which review round 2 verified covers BOTH scripted dialogue and free-form agent sessions (every conversation routes through DialogueManager; the host's active session spans start to end across turns).
- D2 -- Persistence via the house SaveParticipant pattern (Plan 055 memento + registry): the slice stores in-game minutes + day count -- NEVER wall-clock (house rule). Clock state restores exactly; no elapsed-real-time catch-up.
- D3 -- Time reaches consumers as blackboard facts, like every other world signal: `world.time-of-day` (a small banded enum -- dawn/morning/midday/afternoon/dusk/evening/night -- for prompts and schedules) plus `world.clock` (day + minutes for systems that need precision). Prompts consume the BAND, not minutes: LLMs handle "early evening" better than "17:42", and bands keep prompt lines and logs diff-stable (the world block is user-half post-072, so there is no cache effect -- the rationale is legibility and stable observation, corrected in review round 1). Write the band fact on band CHANGE only: setFact emits on every write with no equality check, and subscribers (e.g. sugarlang's directive-cache) invalidate on every event.
- D4 -- Player-known-facts are authored-event-driven, not inferred: quest events and dialogue nodes can declare "the player now knows X" (a fact id + display text authored where quests/dialogues are authored). Facts land as persistent blackboard facts AND a SaveParticipant slice, and flow into the conversation prompt as a compact "the player already knows" block. No LLM inference of knowledge (that way lies drift); authored-only in v1.
- D5 -- World events feed = derived, SESSION-ONLY in v1 (review round 1 -- transitions do NOT persist; only current quest state does, so recency/ordering are not derivable after a restore): a compact recent-events block from live transition observation this session (quest stage/completion transitions, day changes), honestly empty right after a load. The named upgrade path if play shows the gap: quest-slice transitions gain IN-GAME clock stamps (legal under the no-wallclock rule -- in-game day/minutes are exactly the sanctioned timestamp), making events restore-safe; the derivation function is the seam either way.
- D6 -- `ENTITY_AFFECT`: DELETE (recommended). Zero production writers; the one reader (sugarlang directive-cache's affective_shift invalidation branch) can never fire and dies with it, as does the testing-package coverage -- the deletion is CROSS-PLUGIN (runtime-core + sugarlang + testing), scoped honestly in 074.7. A real affect signal should be designed WITH memory (epic C's emotional beats) and barks (epic F), not pre-allocated as a dead fact. DEFERRED SEAM comment at the registry pointing at the F/C confluence.

## Stories (EXECUTION ORDER)

### 074.1 World clock system + persistence

Runtime-core clock system: authored scale/start (D1), advance in the update loop, pause semantics (game pause + the dialogue toggle), SaveParticipant slice per D2. Exit: unit tests (advance, pause, band boundaries, save/restore exactness); the no-wallclock rule asserted in a test.

### 074.2 Time facts on the blackboard

Register `world.time-of-day` + `world.clock` fact definitions; clock system is the sole writer (023's ownership intent). Exit: facts visible in the debug HUD/handle; unit test for band transitions.

### 074.3 Time in conversations

RuntimeContext gains timeOfDay (band); the blackboard conversation middleware forwards it; the prompt world block gains one line ("It is early evening."). NPC schedule/task lines already in the prompt gain their time coherence for free. Exit: integration test -- prompt contains the band; band matches the clock fact.

### 074.4 Time-aware schedules

Behavior/schedule system (025) accepts optional time-window conditions on tasks -- authored on the REGION document's NPC behavior tasks (the actual schedule home: RegionNPCBehaviorTask activation bindings; the NPC definition carries no schedule): extend the activation predicate + its evaluator + io parse + the region behavior editor; task resolution consults `world.time-of-day`. Plan 025 explicitly deferred temporal overlays -- this is the sanctioned revisit. Scope tightly: window-gating of EXISTING task selection, no new behavior kinds. Exit: an NPC with a two-window schedule demonstrably switches tasks at the band boundary in preview; unit tests on the resolver.

### 074.5 Player-known-facts

Authoring per D4 (quest event + dialogue node "player learns" declarations -- both authoring surfaces verified real: quest action definitions + the dialogue node/event mold), a runtime store + blackboard facts + SaveParticipant slice, runtimeContext + prompt block ("The player already knows: ..."), capped count with most-recent-wins. Persistence honesty: the blackboard's `persistent` lifecycle tag is INERT machinery (it only survives session-clear; nothing persists blackboard facts across restart) -- the SaveParticipant deserialize re-writes the facts into the blackboard on load, explicitly. Retrieval hint: known-fact ids optionally bias the Retrieve query (decide in-story; do not overbuild). Internal sequencing pre-agreed: (a) domain + editors, (b) store + facts + slice, (c) middleware + prompt -- one story, three checkpoints. Exit: integration test -- a fact granted by a dialogue node appears in a later conversation's prompt and survives save/restore.

### 074.6 Recent-events block + quest objectives grounding

Corrected mechanism (review round 1 -- the original claim was wrong: `quest_guidance` NEVER abstains; it redirects vaguely because objectives are absent from the prompt, and objective questions misclassified into knowledge intents abstain on the no-evidence policy): (a) forward `activeQuestObjectives` into the prompt's quest block; (b) PlanStage policy change, with the intent boundary pinned (review round 2 -- the only quest-flavored intent, quest_guidance, NEVER abstains; the misclassified case by definition arrives under a knowledge intent): runtimeContext quest objectives count as grounding for the surviving KNOWLEDGE intents (identity_self / lore_world / lore_other / session_recall, post-071.2) when objectives exist -- gated by lexical overlap between the query and objective text so unrelated lore questions do not stop abstaining -- and the flag feeds BOTH the abstain branch and the specificity computation (answer + no-evidence must not emit generic-only when objectives ground it). Derive the recent-events lines per D5. Exit, restated falsifiably: a quest-objective question in preview yields an answer that NAMES THE CURRENT OBJECTIVE TEXT; prompt shows objectives + recent events.

### 074.7 ENTITY_AFFECT delete (D6)

Cross-plugin scope per corrected D6, deletion list completed review round 2: the fact definition + getter/setter (runtime-core); the directive-cache affective_shift invalidation branch + InvalidationReason member AND the two surviving contract mentions -- the `affective_shift` member of DirectiveLifetime.invalidateOn (contracts/pedagogy.ts) and its INVALIDATION_TRIGGERS entry feeding the Director schema enum + normalizer (teacher/schema-parser.ts) (sugarlang); the getter/setter test coverage (testing). The grep-clean exit greps BOTH `ENTITY_AFFECT` and `affective_shift` across the three packages' `src/` (a historical sugarlang proposal doc mentions the trigger; docs are not in scope). DEFERRED SEAM comment per D6. Exit: grep-clean across all three packages; typecheck; sugarlang directive-cache tests still green.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Preview: watch the debug handle -- time advances at the authored ratio, pauses in pause menu (and in dialogue if toggled). Save mid-afternoon, quit, Continue: still mid-afternoon.
3. Talk to an NPC in the evening: the conversation can reference the time of day naturally; the same NPC at dawn reads differently.
4. Author an NPC with a morning task and an evening task: watch the switch at the boundary.
5. Trigger a dialogue that grants a known-fact; later, a DIFFERENT conversation shows the NPC aware the player knows it (and it survives reload).
6. Ask an NPC about your current quest objective: the answer names the current objective text (not a vague redirect).

## Epic wrap

docs/api: clock system, time facts, known-facts authoring contract, SaveParticipant slices. Backlog sweep of DEFERRED SEAM comments (affect).

## Deferred (with revisit triggers)

- Visual time-of-day (lighting/sky/ambience react to the clock): environment epic; the band fact is the seam.
- Weather/seasons/calendar: same seam, larger design.
- Event log as a first-class persistable: revisit if the derived block proves too thin in play; the derivation function is the seam.
- Affect: revisit at the C+F confluence per D6.
- LLM-inferred player knowledge (from what NPCs actually said): revisit post-epic-E when a judge exists to audit inferences; authored-only until then.
