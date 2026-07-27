# Plan 087 -- The Teacher Outer Loop (child epic E of Strategy 002)

Status: DRAFT (pre-drafted 2026-07-26 ahead of pickup; pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 -- child epic E, "the hinge"; the god-watcher IS the teacher grown to the standard two-loop tutor shape (VanLehn)
- Plan 085 (epic B) -- HARD dep: functions to schedule, scene/NPC function tags to read
- Plan 086 (epic C) -- HARD dep: the rendering ladder's live-render path to trigger into (086.5 ships it dormant; this epic turns it on)
- Plan 084 (epic H) -- the inner-loop realizer emits constraint + contribution surfaces through the one seam (post-084 shape)
- Plan 083 (epic D) -- drift telemetry (083.5) is an input to cadence decisions here; directive-cache lifetimes were explicitly left to this epic
- Ground truth: inner-loop anchors known from the 083 cycle (fallback-teacher-policy.ts posture table + directiveLifetime maxTurns 3; directive-cache.ts consumption; sugar-lang-teacher-middleware.ts constraint write) -- re-verify at pickup; this doc was written ahead of time

---

## Why now

Everything below the teacher is (or will be, after B/C/D) built: a learner model with due scheduling, a function inventory, a rendering ladder, verified level control. What is missing is the "someone wise watching the whole board": today's teacher is a per-conversation REACTOR -- the inner loop realizes a directive from the current conversation's context and caches it for ~3 turns; nothing schedules across scenes and days, nothing enforces the encounter contract (~8-10 diverse re-encounters per introduced item -- introduction without re-feeding is wasted budget), nothing paces teach-peaks against consolidation valleys, and nothing ever decides "this authored line is the moment to teach comprar."

The literature is unambiguous that this layer must be deterministic and interpretable: ITS outer loop (VanLehn) + learning-progress bandits (ZPDES) + Duolingo's assembler pattern + L4D's director. LLM-improvised pedagogy loses to an interpretable orchestrator that CONSTRAINS generation. The Strategy 001 "no director" ruling does not transfer: that was about narrative; this loop never writes narrative and never picks story beats -- it only constrains language rendering.

## Non-goals

- No LLM in the outer loop. Deterministic, explainable, tunable, free. (The inner loop keeps its existing LLM-backed realizer with deterministic fallback.)
- No narrative authority: the loop reads the board and constrains rendering; it never changes what a scene means (decoupling invariant -- the learner portrait moves, the story does not).
- No negotiation-move decisions in this epic beyond the WIRE (epic F owns move selection policy; this epic's scheduler exposes the "whether to check" slot F fills).
- No new UI beyond debug/telemetry surfaces (Claude-drivable; no HUD asks).
- No changes to FSRS internals or the observation grade table (instrument, don't retune -- refitting is a strategy watchlist item).

## Design principles

- Two loops, one owner: SugarLangTeacher stays the single owner of "what to teach when"; the outer loop is new code in the same component, the inner loop is today's policy refactored to a realizer. One name, one enforcer.
- MEASURE the board, then act: every outer-loop decision is a pure function of readable published state (learner model, curriculum state, neutral world facts) and is logged with its inputs -- every schedule is explainable after the fact from telemetry.
- Floors first: a due-queue + debt-ledger scheduler that packs to a target comprehension rate is the floor; strain curves and stretch allowances are ceilings layered on it.
- Fail-soft: no schedule (cold start, missing artifacts) degrades to today's reactive behavior exactly.
- No wall-clock in persisted slices: day/scene indices and turn counts, never Date.now() (house rule).

## Stories (EXECUTION ORDER)

### 087.1 The board reads + outer-loop skeleton

The outer loop as a deterministic component with explicit inputs: learner model (FSRS due queue, CEFR posterior, rolling comprehension-strain estimate from session signals -- hovers, probe failures, slow replies), curriculum state (functions not yet introduced, prerequisite graph from the 085 inventory), and the whole board as neutral published facts (quest graph lookahead, scene contents/NPC roster, dialogue-graph neighborhood, player-character facts, blackboard world events, sugaragent.memory firstMeeting when present). Sugarlang-alone mode reads quest/scene/dialogue state only. Output: a SCHEDULE artifact (teachables with priorities, per-scene/per-NPC affinity from 085.4 tags) consumed by the inner loop. Persistence: schedule state is a SaveParticipant slice (house rule), skip/offset-safe.

- Exit: skeleton produces a schedule from fixture board state; every decision logged with inputs (telemetry); absent-input degradation pinned (no schedule = today's behavior); boundary tests (reads only published facts; nothing crosses the plugin boundary that did not before).

### 087.2 The encounter-debt ledger

Introducing an item creates a DEBT of ~10 diverse re-encounters (diversity key: NPC, scene, day); the ledger tracks debt paydown from observe events (encounters already flow; 085.3 adds chunk encounters) and the scheduler prioritizes debt service over new introductions. Introduction-without-refeed becomes a visible, tracked failure (anti-metric from the strategy).

- Exit: unit tests pin debt creation/paydown/diversity counting; scheduler prefers due-debt items in fixture scenarios; telemetry exposes debt balance per item; the "introduced but never re-fed" report exists (telemetry query, not UI).

### 087.3 Selection + packing (ZPDES-shaped floor)

WHAT to schedule: prefer items/functions currently yielding learning progress inside the prerequisite graph (learning-progress estimate from observation history), packed to a TARGET COMPREHENSION RATE for the upcoming scene (predicted from the learner model against the scene's lexicon) rather than a raw introduce count. The band+1 ceiling becomes a STRETCH ALLOWANCE the scheduler spends deliberately (unusually good opportunity = one slightly-beyond-level teachable rendered in known terms).

- Exit: packing tests pin the comprehension-rate target (fixture learner x scene lexicon); progress-based preference pinned; stretch allowance fires only under the pinned opportunity conditions; per-turn introduce caps (existing budgeter) still bind downstream.

### 087.4 Pacing: strain curve + fluency valleys

WHEN: teach-peaks alternate with consolidation valleys keyed off the rolling strain estimate (L4D shape); FLUENCY-RECYCLING scenes -- only well-known material, at ease -- are scheduled deliberately (the four-strands strand games forget). Strain rising = the scheduler backs off introductions and services debt/fluency instead.

- Exit: strain-curve unit tests (rising strain suppresses introductions; valley scheduling recycles known items); a 12+ conversation fixture sequence shows the alternation in telemetry; no-strain-signal degradation = 087.3 behavior.

### 087.5 "Is this line the moment" -- the live-render trigger

The scheduler's per-line decision for scripted content: when an authored line's intent can carry a due teachable AND the scene context makes it the moment, trigger 086.5's directed live render (which verifies and falls back to baked on failure). Trigger policy is deterministic (due teachable x line-intent match x strain headroom); cost is bounded by the cache key (line, band, posture, teachables).

- Exit: fixture quest playthrough triggers live renders only at matching lines (pinned); trigger-off = 086.4 behavior byte-identical; cache bounds re-render cost (second identical moment = cache hit); telemetry names the teachable + the match reason per trigger.

### 087.6 Inner loop refactored to realizer + teachable-biased retrieval

The teacher policy becomes the REALIZER of scheduled teachables: directives derive from the schedule (fallback to today's reactive derivation when no schedule), emitted through the constraint + the 084 contribution surfaces unchanged in seam. Directive-cache lifetimes are re-examined HERE (the 083-era note deferred them to this epic): lifetime should follow schedule beats, not a flat maxTurns 3 -- decide-in-story with telemetry from 083.5's drift measurements. Teachable-biased retrieval for agent NPCs rides the existing 077 quest-aware-retrieve seam pointed at pedagogy (bias terms from the schedule, never a sugarlang reach-in).

- Exit: schedule-fed directives pinned (fixture schedule -> expected constraint); no-schedule fallback = today's directives byte-identical; retrieval bias arrives via the constraint (boundary test); directive-lifetime decision recorded + pinned.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Board probe: debug dump of one outer-loop decision -- inputs and chosen teachables readable and explainable (why greetings, why now).
3. Debt probe: introduce a word (talk until one is introduced), then visit other NPCs/scenes across a few sessions -- telemetry shows the debt paying down across DIFFERENT speakers/scenes, and the item resurfacing until ~10 diverse encounters.
4. Pacing probe: a long play session shows teach-peaks and valleys in telemetry, not a constant introduction drip; after a struggle-heavy stretch (miss probes on purpose), introductions visibly back off.
5. Moment probe: play a scripted quest with a due teachable that matches a line's intent -- that line (and only lines like it) renders live with the teachable woven in; gateway-down = baked/woven plays.
6. New Game probe: learner knowledge and debts survive New Game (by design); schedule state restores sanely after reload (no wall-clock tripwires).

## Epic wrap

docs/api: teacher page rewritten (two loops, board inputs, schedule artifact, debt ledger, trigger policy); telemetry page (schedule/debt/strain/trigger events). Strategy 002 epic E status. Directive-lifetime decision promoted to the middlewares page. Backlog sweep of DEFERRED SEAM comments (086.5 stub comment closes here).

## Deferred / out of scope (with revisit triggers)

- Negotiation-move policy in the scheduler's "whether to check" slot: epic F fills it (code comment at the slot).
- FSRS parameter refitting from telemetry: strategy watchlist; revisit at real data volume.
- Strain-driven adaptation of non-language difficulty (full L4D idiom): strategy watchlist.
- Content-aware modality probes (newspaper knows about milk prices): strategy stretch goal; the board-read architecture here is its seam (code comment at the board reads).
- Multi-day itinerary planning (the "immersion trip" ceiling -- which places, which people, per day): floor here is per-scene scheduling; revisit when episodes span enough content for itineraries to matter.
