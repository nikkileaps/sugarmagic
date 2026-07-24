# Plan 074 -- World Clock + Context Completion (child epic D of Strategy 001)

Status: COMPLETE 2026-07-24. All stories shipped.
Owner: nikki + claude
Date: 2026-07-19

Related:
- Strategy 001 -- child epic D. Independent of B/C in the strategy graph; feeds both. Prompt-side stories land in the post-072.4 user-message world block if 072 has shipped, or today's system-side block if not -- the stories name the seam, not the half.
- Plans 023 (blackboard -- the minimal fact registry this epic extends), 024/025 (spatial + schedules -- the systems that gain time-awareness), 055/056 (SaveParticipant pattern for persistables).
- Ground truth: 2026-07-18 audit, corrected in review round 1. No clock/time-of-day concept exists ANYWHERE in the engine (zero hits for timeOfDay/worldClock/gameClock across runtime-core + plugins + targets). `activeQuestObjectives` reaches ConversationRuntimeContext but no SUGARAGENT stage reads it (sugarlang middlewares do). `ENTITY_AFFECT` has zero production WRITERS but is NOT reader-free: sugarlang's teacher directive-cache invalidates on its change events, and the testing package exercises the getter/setter -- dead-in-practice, but deletion crosses plugin boundaries (see 074.7). No player-known-facts store exists.

---

## AMENDMENT 2026-07-22 -- pure beat-driven time-of-day + quest-context firewall (re-gate required before build)

User-directed, from the Find-the-Suitcase design conversation. Two changes to the locked plan. The lock is SUSPENDED for the affected parts (D1-D3, 074.1, 074.2, 074.6); this epic must re-pass epic-review before any amended story is built. Everything else (074.3, 074.4, 074.5, 074.7) stands as originally written and reviewed.

### Change 1 -- the clock is PURE BEAT-DRIVEN, not an ambient real-time ratio (supersedes D1-D3)

Time-of-day is not a running system; it is a FACT the narrative sets. There is no advance loop, no authored scale/ratio, and no game-pause or dialogue-pause semantics -- the entire "first pause consumer" apparatus in the original D1 is moot and removed. Rationale: Wordlark is a cozy, author-paced narrative game. Ambient time creates pressure and incoherence ("why is it suddenly night?") for no benefit; author control of pacing IS the feature. This also deletes most of 074.1's complexity.

- D1' -- `world.time-of-day` (band: dawn/morning/midday/afternoon/dusk/evening/night) and `world.day` (integer) are blackboard facts SET by quest actions only (`set-time-of-day` / `advance-day` as new `QuestActionDefinition` types on quest nodes' `onEnterActions` / `onCompleteActions`). No passive tick; nothing advances time except the story. Narrative and clock state live in the quest graph, not in dialogue nodes.
- D2' -- SaveParticipant slice stores `{ day, band }` -- never wall-clock, never minutes (there are no minutes). Restores exactly; there is no elapsed-real-time catch-up because there is no elapsed time.
- D3' -- the BAND is the primary fact, set directly (not derived from minutes). `world.clock`/minutes is dropped. Prompts + schedules consume the band exactly as 074.3/074.4 describe; the band just changes on a beat instead of on a timer. setFact still emits on write; subscribers (sugarlang's directive-cache) invalidate on the event.

Story deltas:
- 074.1' -- Time-of-day state + the authored set-action + persistence. NO clock system / advance loop / pause. Domain: `set-time-of-day` (band) + `advance-day` as new `QuestActionDefinition` types, QUEST ACTIONS ONLY (no dialogue node surface); a small runtime store that writes the facts; SaveParticipant slice `{ day, band }` per D2'. Exit: unit tests (set band; advance day; night->dawn wraps increment day; save/restore exactness; no-wallclock asserted).
- 074.2' -- unchanged in spirit: register `world.time-of-day` + `world.day` fact defs; the set-action store is the sole writer (023's ownership intent). Exit: facts visible in the debug handle; unit test for band-set emit-on-change.
- 074.3 / 074.4 / 074.5 / 074.7 -- SURVIVE. 074.3/074.4 consume the band identically (the resolver does not care that the band now changes on a beat; 074.4's exit reads "switches tasks when the narrative sets the band boundary"). 074.5 (known-facts) and 074.7 (affect delete) are independent of the clock mechanism.

### Change 2 -- quest-objectives grounding LEAVES this epic (re-scopes 074.6)

The original 074.6 forwarded the player's `activeQuestObjectives` into every NPC's prompt as grounding. That makes NPCs OMNISCIENT about the player's private quest -- Finnick would know a priori that Mim lost a suitcase -- the exact fourth-wall break the game must avoid. That half moves to the NEW **Narrative Director** epic (backlog #416), where quest state is mediated by a director into an in-character NUDGE, never the raw objective (the firewall principle: an NPC's prompt never receives the player's objective).

- 074.6' -- RETAINED here: ONLY the recent-events block (D5) -- a compact derived feed of PUBLIC world transitions this session (quest stage/completion + day changes). Public world news (a passenger's socks went missing) is fine for any NPC to know; the player's private objective is not. REMOVED here (-> #416): forwarding `activeQuestObjectives` into the prompt, and the PlanStage objectives-as-grounding policy change.
- Verification recipe item 6 (quest-objective question names the objective) moves to #416.

---

## Why now

Nikki's stated context list for NPCs -- "the time of day (in game), the state of the quest, things that are known about the player, events that have happened" -- is half missing. Schedules (025) exist but have no clock to feel real against ("I'm heading to the market" means more at dawn). Epic C's memories have no "when". And quest-objective questions get vague redirects (or misclassified abstains) while their answers sit unread in the runtime context. This epic finishes the world-context story the 023/024/025 line started.

## Non-goals

Visual response to time (lighting/sky/ambience changes are an environment-authoring epic -- the clock exposes the signal; consuming it visually is deferred). NPC sleep/home simulation. Weather. Calendar/seasons. Memory content (epic C). Affect SIMULATION (we wire-or-delete the existing dead fact; we do not build an emotion system).

## Design decisions (epic-review ratifies)

- D1 -- The clock is authored, not real-time: in-game minutes advance at an authored ratio during active play (scale + start-time on the game-project settings mold), pause when the game is paused. Plumbing honesty (review round 1): NO tick suspension exists today -- the host calls session.update unconditionally every frame and the pause selectors have zero production consumers -- so this epic introduces the FIRST pause consumer. Decision: a paused flag flows into the CLOCK specifically (host passes lifecycle state down; the clock alone respects it); global simulation behavior (NPCs keep simulating while paused) is deliberately unchanged. The dialogue toggle (default PAUSED -- a long conversation should not skip the market's closing time out from under its own context) keys off `dialogueManager.isDialogueActive()`, which review round 2 verified covers BOTH scripted dialogue and free-form agent sessions (every conversation routes through DialogueManager; the host's active session spans start to end across turns).
- D2 -- Persistence via the house SaveParticipant pattern (Plan 055 memento + registry): the slice stores in-game minutes + day count -- NEVER wall-clock (house rule). Clock state restores exactly; no elapsed-real-time catch-up.
- D3 -- Time reaches consumers as blackboard facts, like every other world signal: `world.time-of-day` (a small banded enum -- dawn/morning/midday/afternoon/dusk/evening/night -- for prompts and schedules) plus `world.clock` (day + minutes for systems that need precision). Prompts consume the BAND, not minutes: LLMs handle "early evening" better than "17:42", and bands keep prompt lines and logs diff-stable (the world block is user-half post-072, so there is no cache effect -- the rationale is legibility and stable observation, corrected in review round 1). Write the band fact on band CHANGE only: setFact emits on every write with no equality check, and subscribers (e.g. sugarlang's directive-cache) invalidate on every event.
- D4 -- Player-known-facts are authored-event-driven, not inferred: quest actions declare "the player now knows X" (a fact id + display text on a quest node's `onEnterActions` / `onCompleteActions`), QUEST ACTIONS ONLY. Facts land as persistent blackboard facts AND a SaveParticipant slice, and flow into the conversation prompt as a compact "the player already knows" block. No LLM inference of knowledge (that way lies drift); authored-only in v1. Narrative state lives in the quest graph.
- D5 -- World events feed = derived, SESSION-ONLY in v1 (review round 1 -- transitions do NOT persist; only current quest state does, so recency/ordering are not derivable after a restore): a compact recent-events block from live transition observation this session (quest stage/completion transitions, day changes), honestly empty right after a load. The named upgrade path if play shows the gap: quest-slice transitions gain IN-GAME clock stamps (legal under the no-wallclock rule -- in-game day/minutes are exactly the sanctioned timestamp), making events restore-safe; the derivation function is the seam either way.
- D6 -- `ENTITY_AFFECT`: DELETE (recommended). Zero production writers; the one reader (sugarlang directive-cache's affective_shift invalidation branch) can never fire and dies with it, as does the testing-package coverage -- the deletion is CROSS-PLUGIN (runtime-core + sugarlang + testing), scoped honestly in 074.7. A real affect signal should be designed WITH memory (epic C's emotional beats) and barks (epic F), not pre-allocated as a dead fact. DEFERRED SEAM comment at the registry pointing at the F/C confluence.

## Stories (EXECUTION ORDER)

### 074.1' Time-of-day state + authored set-actions + persistence (AMENDED -- replaces original 074.1)

Beat-driven only -- NO advance loop, NO pause semantics, NO authored ratio. QUEST ACTIONS ONLY -- no dialogue node surface.

Domain changes (quest actions only):
- Add `set-time-of-day` and `advance-day` to `QuestActionDefinition.type` (`domain/src/quest-definition/index.ts`). `set-time-of-day` uses `targetId` as the band value; `advance-day` needs no value. These dispatch through the existing `executeActions` -> `onAction` fallthrough in `QuestManager` to `gameplay-session.setActionHandler` -- same chain as `giveItem` / `removeItem`, no new dispatch mechanism needed.

Runtime time store: a small runtime-core module holding `{ day: number; band: TimeOfDayBand }` with an EQUALITY GATE before calling `setFact` (`setFact` emits unconditionally per blackboard.ts; the gate belongs in the store). Exposes `setTimeBand(band)` and `advanceDay()`. `TimeOfDayBand` is the band enum exported from here -- 074.4 depends on it.

SaveParticipant slice `{ day, band }` per D2'. Never wall-clock. Follow `QuestManagerSaveParticipant` as the reference implementation.

Exit: unit tests -- set band; advance day; night->dawn wraps increment day; same-band write does NOT emit (equality gate); save/restore exactness; no-wallclock asserted.

### 074.2' Time facts on the blackboard (AMENDED -- replaces original 074.2)

Register `world.time-of-day` (band) + `world.day` (integer) fact definitions -- NOT `world.clock` (dropped in the amendment). The time store (074.1') is the SOLE WRITER via its equality-gated `setTimeBand` / `advanceDay` methods. Follow `GOAL_SURFACED_COUNT_FACT` (blackboard.ts) as the reference for global-scoped fact registration.

Export getter helpers (`getTimeOfDayBand`, `getWorldDay`) analogous to `getGoalSurfacedCount`. These are the only read paths -- consumers never call `getFact` directly.

Exit: facts visible in the debug handle after 074.2 is wired; unit test for band-change emit AND no-emit on same-band write (confirming the equality gate from 074.1' holds at the fact level).

### 074.3 Time in conversations

RuntimeContext gains timeOfDay (band); the blackboard conversation middleware forwards it; the prompt world block gains one line ("It is early evening."). NPC schedule/task lines already in the prompt gain their time coherence for free. Exit: integration test -- prompt contains the band; band matches the clock fact.

### 074.4 Time-aware schedules

Behavior/schedule system (025) accepts optional time-window conditions on tasks -- authored on the REGION document's NPC behavior tasks (the actual schedule home: `RegionNPCBehaviorTask`; the NPC definition carries no schedule).

Domain design (SETTLED -- do NOT extend `RegionBehaviorQuestBinding`): add an optional `timeWindow?: { bands: TimeOfDayBand[] } | null` field DIRECTLY on `RegionNPCBehaviorTask`. `RegionBehaviorQuestBinding` is also used for volume `condition` (region-authoring/index.ts:281) -- extending it would leak time semantics into volumes, which is wrong. The time-window is NPC-task-only.

Extend: the `taskMatchesActivation` evaluator (npc-behavior-system.ts, calls `evaluateRegionQuestBinding`) to also check `timeWindow` -- when set, the task is only active if the current band is in the array. Read the band via the `getTimeOfDayBand` getter from 074.2'. Update the domain normalizer (`createRegionNPCBehaviorTask` in `domain/src/region-authoring/index.ts`) and the region behavior editor (Studio) for the new field. There is no separate io-layer normalizer for region authoring; the domain factory is the only one. `TimeOfDayBand` is exported from 074.1'.

Scope tightly: window-gating of EXISTING task selection only, no new behavior kinds. Exit: an NPC with a two-window schedule demonstrably switches tasks at the band boundary in preview; unit tests on the resolver (in-window, out-of-window, no-window pass-through).

### 074.5 Player-known-facts

Authoring per D4 (QUEST ACTIONS ONLY -- no dialogue node surface): a new `learn-fact` quest action type on quest nodes' `onEnterActions` / `onCompleteActions`, carrying a fact id + display text. A runtime store + blackboard facts + SaveParticipant slice, runtimeContext + prompt block ("The player already knows: ..."), capped count with most-recent-wins. Persistence honesty: the blackboard's `persistent` lifecycle tag is INERT machinery (it only survives session-clear; nothing persists blackboard facts across restart) -- the SaveParticipant deserialize re-writes the facts into the blackboard on load, explicitly. Retrieval hint: known-fact ids optionally bias the Retrieve query (decide in-story; do not overbuild). Internal sequencing pre-agreed: (a) domain + editors, (b) store + facts + slice, (c) middleware + prompt -- one story, three checkpoints. Exit: integration test -- a fact granted by a quest action appears in a later conversation's prompt and survives save/restore.

### 074.6' Recent-events block (AMENDED -- objectives forwarding REMOVED, moved to backlog #416)

Derive a compact session-only feed of PUBLIC world transitions ("quest stage X completed", "day advanced to N") to inject into the conversation's world block. Scope: recent events only; `activeQuestObjectives` and any PlanStage policy changes are #416.

Hook mechanism: a new session-level `RecentEventCollector` in runtime-core that:
1. Attaches as a SECONDARY tap on gameplay-session's quest event handler chain -- gameplay-session wraps its existing `QuestManager.setEventHandler` call to ALSO forward `QuestRuntimeEvent` (stage changes, quest completions) to the collector. The existing handler is not replaced; this is an additive fan-out.
2. Receives a callback from the time store's (074.1') `advanceDay` path for day-change events.

The collector maintains a session-ordered list of recent transitions (capped, most-recent-wins). Empty right after a load/restore (session-only in v1 per D5 -- transitions do not persist; the derivation function is the named upgrade seam if play proves the gap).

Events are formatted as compact human-readable lines ("Quest 'Find the Luggage' stage 2 completed.", "Day advanced to 2.") and surfaced in `ConversationRuntimeContext.recentWorldEvents: string[]`, forwarded by the blackboard middleware to the prompt world block.

Exit: integration test -- triggering a quest stage change populates the events block; a subsequent NPC conversation's prompt includes the event line; the block is empty on a fresh load/restore.

### 074.7 ENTITY_AFFECT delete (D6)

Cross-plugin scope per corrected D6, deletion list completed review round 2: the fact definition + getter/setter (runtime-core); the directive-cache affective_shift invalidation branch + InvalidationReason member AND the two surviving contract mentions -- the `affective_shift` member of DirectiveLifetime.invalidateOn (contracts/pedagogy.ts) and its INVALIDATION_TRIGGERS entry feeding the Director schema enum + normalizer (teacher/schema-parser.ts) (sugarlang); the getter/setter test coverage (testing). The grep-clean exit greps BOTH `ENTITY_AFFECT` and `affective_shift` across the three packages' `src/` (a historical sugarlang proposal doc mentions the trigger; docs are not in scope). DEFERRED SEAM comment per D6. Exit: grep-clean across all three packages; typecheck; sugarlang directive-cache tests still green.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Preview: author a quest action that sets time-of-day to "evening"; trigger it; check the debug handle shows band = "evening". Save, quit, Continue: still "evening".
3. Talk to an NPC after the band is set to "evening": the conversation naturally reflects the time ("Good evening"). Same NPC at "dawn" reads differently.
4. Author an NPC with a morning task and an evening task: watch the switch at the band boundary.
5. Trigger a dialogue that grants a known-fact; later, a DIFFERENT conversation shows the NPC aware the player knows it (and it survives reload).
6. Trigger a quest stage change then talk to any NPC: the prompt's recent-events block contains the stage-change line (visible via `__sugaragentPrompts`).

## Epic wrap

docs/api: clock system, time facts, known-facts authoring contract, SaveParticipant slices. Backlog sweep of DEFERRED SEAM comments (affect).

## Deferred (with revisit triggers)

- Visual time-of-day (lighting/sky/ambience react to the clock): environment epic; the band fact is the seam.
- Weather/seasons/calendar: same seam, larger design.
- Event log as a first-class persistable: revisit if the derived block proves too thin in play; the derivation function is the seam.
- Affect: revisit at the C+F confluence per D6.
- LLM-inferred player knowledge (from what NPCs actually said): revisit post-epic-E when a judge exists to audit inferences; authored-only until then.
