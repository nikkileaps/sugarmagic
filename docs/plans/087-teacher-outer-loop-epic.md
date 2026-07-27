# Plan 087 -- The Teacher Outer Loop (child epic E of Strategy 002)

Status: Locked (epic-review passed 2026-07-27, 2 rounds; round-2 fold-ins: trigger-off pin re-scoped to rendered text + separate enrichment pin, intent-key-only unification, ledger closeables + onversionchange, citation polish)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 -- child epic E, "the hinge"; the god-watcher IS the teacher grown to the standard two-loop tutor shape (VanLehn)
- Plan 085 (epic B) -- HARD dep: functions to schedule, scene/NPC function tags to read
- Plan 086 (epic C) -- HARD dep: the rendering ladder's live-render path to trigger into (086.5 ships it dormant; this epic turns it on)
- Plan 084 (epic H) -- the inner-loop realizer emits constraint + contribution surfaces through the one seam (post-084 shape)
- Plan 083 (epic D) -- drift telemetry (083.5) is an input to cadence decisions here; directive-cache lifetimes were explicitly left to this epic
- Ground truth: inner-loop anchors known from the 083 cycle (fallback-teacher-policy.ts posture table + directiveLifetime maxTurns 3; directive-cache.ts consumption; sugar-lang-teacher-middleware.ts constraint write) -- RE-VERIFIED 2026-07-27 (review round 1): all anchors hold. Corrections found in the same pass: the 086.1 intent pipeline shipped as code but is UNWIRED end to end (no production caller bakes intents, no runtime cache injection -- see 087.5 scope); the scripted path builds its constraint WITHOUT invoking SugarLangTeacher (sugar-lang-teacher-middleware.ts:218-259) -- see 087.1 schedule transport; the function inventory has NO prerequisite edges (contracts/function-inventory.ts:53-80) -- see 087.1/087.3

---

## What ships, experienced (added 2026-07-27, nikki ask)

Mostly orchestration -- little of this is visible in any single conversation; what changes is the shape of play ACROSS conversations and sessions. Concretely:

1. **Authored lines that teach, live** (087.5). When the player is due on a word and an authored line's intent can carry it, that line renders live at their level with the teachable woven in, instead of the generic pre-baked band variant. First personalization of the scripted path to the individual learner rather than the band. Gateway down = baked plays, no visible failure.
2. **Words stop vanishing after introduction** (087.2/087.3). An introduced word resurfaces from DIFFERENT NPCs in DIFFERENT scenes across days until ~10 diverse encounters. Learn queso from Rosa, the baker uses it too. Introduction-without-refeed becomes a tracked failure instead of the default outcome.
3. **The game notices struggle and backs off** (087.4). Missed probes / heavy hovering / slow replies = the next stretch stops introducing and serves review; deliberately-scheduled easy scenes appear (all known vocabulary, at ease -- the fluency strand). Peaks and valleys replace the constant new-word drip.
4. **New vocabulary arrives in a sane order** (087.3). Introductions follow band ordering + current learning progress, packed to a predicted comprehension rate per scene -- not whatever words the script happened to contain.
5. **Agent NPCs steer toward due words** (087.6). Retrieval bias drifts free-form conversation toward topics that exercise what the learner needs -- the tutor's note to the locals, working.
6. **Studio: intent auto-bakes** (087.5, inherited 086 debt). Saving a dialogue auto-extracts intent for unauthored lines; hand-authored fields win.

For QA the biggest new capability is EXPLAINABILITY: every scheduling decision logs its inputs, queryable via telemetry -- "why did Rosa teach comprar" gets a concrete answer (due-ness, debt balance, strain, match reason). The verification recipe is built around exactly that.

NOT expected: no new player-facing UI, no visible "teacher," no change to any story beat. If a player can tell the scheduler exists, we did it wrong -- the world should just happen to speak at exactly their level.

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

The outer loop as a deterministic component with explicit inputs: learner model (due-ness derived from persisted cards' retrievability -- there is no queue structure, fsrs-adapter.ts:130-145 + card-store; CEFR posterior; strain floor = the existing fatigueScore from session signals, learner-state-reducer.ts:549-557 / session-signals.ts:87-98 -- the fuller strain estimate is BUILT in 087.4, not read here: probe failures currently emit telemetry but touch no rolling estimate, retryRate is permanently 0 because `produced-incorrect` has no producers, and true response latency exists only for probe responses (review round 1)), curriculum state (functions not yet introduced; ordering is BAND-DERIVED -- the 085 inventory has NO prerequisite edges (contracts/function-inventory.ts:53-80, review round 1); band ordering is the floor, prerequisite edges are a schema bump + data authoring decided in 087.3, with a revisit-trigger code comment at the ordering site), and the whole board as neutral published facts (quest graph lookahead, scene contents/NPC roster, dialogue-graph neighborhood via the bound definitions already held by runtime-services (runtime-services.ts:243-247); player-character facts + world events via blackboard facts; sugaragent.memory firstMeeting when present -- NOTE this is the per-current-NPC annotation (MEMORY_ANNOTATION_KEY), not roster-wide met-state (review round 1)). Sugarlang-alone mode reads quest/scene/dialogue state only.

NAMING PIN (nikki, 2026-07-27): "the board" is the strategy doc's metaphor, NOT the runtime-core Blackboard -- the board is a superset (blackboard facts + bound definitions + plugin-owned learner state). The code artifact that aggregates these reads gets a distinct, qualified name (e.g. `SchedulerBoardView`); nothing in this epic's code, telemetry prefixes, or annotation keys may use "blackboard" for the aggregate, and doc/comment text says "board (not the Blackboard)" on first use.

Execution point + transport (review round 1 -- previously unspecified, and load-bearing because the scripted path never invokes SugarLangTeacher, sugar-lang-teacher-middleware.ts:218-259): the schedule is owned by a scheduler service on SugarlangExecutionServices, computed lazily at conversation start (context-stage prepare), and published as a `sugarlang.schedule` annotation. The scripted middleware (087.5's trigger site) reads the annotation; SugarLangTeacher consumes the service in 087.6. "One name, one enforcer" holds at the service level -- one scheduler, two consumers.

Output: a SCHEDULE artifact (teachables with priorities, per-scene/per-NPC affinity from 085.4 tags -- function-tag-resolver.ts exists with zero production callers; wiring it is this story's work). Persistence (review round 1 -- corrected): schedule state is NOT a SaveParticipant slice -- participant.ts:10-15 explicitly excludes plugin domain data (ADR 020), and the recipe's own "debts survive New Game" requires learner-keyed storage. The schedule artifact is DERIVED state, recomputed from board + ledger on load, never persisted (LiveRenderCache precedent, 086 plan). Durable outer-loop state (the 087.2 ledger) lives in a plugin-owned IDB store beside card-store/teach-record-store under the same learner-keyed prefix, so the existing reset enforcer clears it. No wall-clock in stored values (day/turn indices only, house rule).

- Exit: skeleton produces a schedule from fixture board state; every decision logged with inputs (telemetry); absent-input degradation pinned (no schedule = today's behavior); boundary tests (reads only published facts; nothing crosses the plugin boundary that did not before); the schedule annotation is readable from the scripted middleware in a fixture turn.

### 087.2 The encounter-debt ledger

Introducing an item creates a DEBT of ~10 diverse re-encounters (diversity key: NPC, scene, day); the ledger tracks debt paydown from observe events and the scheduler prioritizes debt service over new introductions. Introduction-without-refeed becomes a visible, tracked failure (anti-metric from the strategy).

Paydown signal gap, named (review round 1): "encounters already flow" holds for CHUNKS only (chunk-encountered fires for any matched inventory chunk, sugar-lang-observe-middleware.ts:568-644). For LEMMAS it is structurally absent: the observe middleware emits `encountered` only for lemmas in `constraint.targetVocab.introduce` (observe-middleware:549-566), and a previously-introduced lemma sits in the REINFORCE list (lexical-budgeter.ts:180-183 routes reviewCount>0 there), producing no observation when the NPC says it. This story therefore includes the observe-middleware change: emit encounter events for reinforce/card-holding lemmas found in turn text. FSRS side-effect policy is decide-in-story -- the paydown signal must not distort grades (options: a ledger-only event kind that bypasses the reducer, or reuse `encountered` whose grade weight is already exposure-shaped; pin whichever with tests).

Day axis (review round 1): ObservationContext carries sceneId + conversationId but no day (contracts/observation.ts:93-99); the ledger stamps day from WORLD_DAY_FACT (blackboard.ts:297-302) at consumption. Day advances only via quest `advance-day` actions, so the ledger treats day as optional-when-static -- diversity degrades gracefully to NPC x scene when authored content never advances the day, and telemetry notes the degraded axis.

Store lifecycle follow-through (round 2): the ledger DB rides the `CARD_STORE_DB_NAME_PREFIX` so the reset enforcer's prefix enumeration auto-clears it (reset-learner-data.ts:131-138), but the live-connection closeables list is HARDCODED (runtime-services.ts:336-339: cardStore, teachRecordStore) -- add the ledger store there, and give it card-store's `onversionchange` yield (card-store.ts:283-289) so resets do not hit the blocked timeout.

- Exit: unit tests pin debt creation/paydown/diversity counting (including the static-day degradation); reinforce-lemma encounters produce paydown in a fixture conversation (the new observe path, pinned); scheduler prefers due-debt items in fixture scenarios; telemetry exposes debt balance per item; the "introduced but never re-fed" report exists (telemetry query via TelemetrySink.query -- confirmed real, telemetry.ts:668-682 -- not UI); reset clears the ledger store (prefix + closeables pin).

### 087.3 Selection + packing (ZPDES-shaped floor)

WHAT to schedule: prefer items/functions currently yielding learning progress within the curriculum ordering (learning-progress estimate from observation history; ordering is band-derived per 087.1 -- this story DECIDES whether band ordering suffices for the floor or the inventory schema gains hand-authored prerequisite edges, and pins the decision), packed to a TARGET COMPREHENSION RATE for the upcoming scene (predicted from the learner model against the scene's lexicon) rather than a raw introduce count. The band+1 ceiling becomes a STRETCH ALLOWANCE the scheduler spends deliberately (unusually good opportunity = one slightly-beyond-level teachable rendered in known terms).

Functions-as-chunks realization (review round 1 -- picks up 085's named deferral to this epic): a scheduled FUNCTION realizes in the prescription as its chunks via the `chunk:{id}` pseudo-lemma convention inside the LemmaRef-typed targetVocab (note `computePendingProvisionalLemmas` filters chunk cards, middlewares/shared.ts:166 -- the realization path must keep that filter coherent). The contract decision is pinned here; 087.6 consumes it.

The scheduler BIASES the prescription inputs; it does not replace the budgeter -- per-turn introduce caps (cap table lexical-budgeter.ts:48-61; reinforce cap 4 at :182) run upstream in the context stage and still bind (review round 1: this is why "still bind downstream" is coherent).

- Exit: packing tests pin the comprehension-rate target (fixture learner x scene lexicon); progress-based preference pinned; stretch allowance fires only under the pinned opportunity conditions; per-turn introduce caps (existing budgeter) still bind downstream; function-to-chunks realization pinned (scheduled function -> chunk: refs in the prescription).

### 087.4 Pacing: strain curve + fluency valleys

WHEN: teach-peaks alternate with consolidation valleys keyed off the rolling strain estimate (L4D shape); FLUENCY-RECYCLING scenes -- only well-known material, at ease -- are scheduled deliberately (the four-strands strand games forget). Strain rising = the scheduler backs off introductions and services debt/fluency instead.

The strain estimate is BUILT here, extending the existing fatigueScore -- not a parallel estimator (review round 1). Scope: fold probe failures into the rolling estimate (today the probe-fail path discards provisional evidence -- a card mutation -- but touches no strain state; the telemetry-only emission is observe-middleware:341-362); decide-in-story the latency source (true player response latency exists only for probe responses today) and whether `produced-incorrect` gets producers or retryRate is dropped from the formula (it is permanently 0 -- no producers repo-wide).

- Exit: strain-curve unit tests (rising strain suppresses introductions; valley scheduling recycles known items); a 12+ conversation fixture sequence shows the alternation in telemetry; no-strain-signal degradation = 087.3 behavior.

### 087.5 "Is this line the moment" -- the live-render trigger

The scheduler's per-line decision for scripted content: when an authored line's intent can carry a due teachable AND the scene context makes it the moment, trigger 086.5's directed live render (which verifies and falls back to baked on failure). Trigger policy is deterministic (due teachable x line-intent match x strain headroom); cost is bounded by the cache key (line, band, posture, teachables).

Prerequisite wiring, named (review round 1 -- the 086.1 intent pipeline shipped as CODE but is unwired end to end; without this scope the trigger fires and nothing matches). Provenance, for the record: item 1 is INHERITED 086 SCOPE DEBT -- the 086 post-lock amendment promised "auto-bake on dialogue save via the existing compile scheduler (086.3)" and that wiring never shipped (the 071.8 executed-vs-locked pattern: tests exercised the code directly, so diff review looked green). It lands here rather than reopening 086 because its only consumers (runtime intent enrichment + this story's trigger matching) also land here. This story includes:
1. Bake-side: wire `intentPipeline` into the Studio authoring compile scheduler so intent artifacts auto-bake on dialogue save (editor-support.ts:322 constructs the scheduler with chunkPipeline only; `extractIntent` and both intent-cache impls have zero production callsites). Hand-authored intent fields win over extracted, per the 086.1 rule.
2. Runtime-side: inject `intentCache` and `liveRenderCache` into SugarlangExecutionServices via the studioWorkspaceId boot-payload pattern (variantCache precedent, runtime-services.ts:464-479 -- both fields are declared optional today and never assigned; both scripted-middleware intent reads are dead code at runtime).
3. Key parity -- the INTENT-cache key only (round 2): the runtime lookup hashes with `JSON.stringify({})` (buildVariantContentHash, sugar-lang-scripted-middleware.ts:78-79) while the intent bake pipeline keys on `JSON.stringify(node.intent ?? {})` (compile-scheduler.ts:417) -- any node with hand-authored intent (the popover's whole purpose) misses at runtime. Extract ONE shared intent-key builder both sides import; the runtime side resolves `node.intent` from the bound dialogueDefinitions (runtime-services.ts:246). Do NOT touch the VARIANT key -- it uses `{}` on both sides deliberately (compile-scheduler.ts:495-502 comment) and changing it would orphan every baked variant.
4. `dialogueDefinitionId` for the live-render cache key comes from `execution.selection.dialogueDefinitionId`, NOT the `sugarlang.dialogueDefinitionId` annotation (read at scripted-middleware:239, written nowhere -- repo-wide).
5. API doc correction: sugarlang-scripted-rendering.md currently claims runtime code reads the intent cache -- true only after this story; fix the doc when the wiring lands.

Story-size note (round 2, advisory): with the wiring items this story is roughly double its siblings. Each item has its own exit pin so it is executable as written; if it strains in practice, the natural split is wiring (items 1-5) then trigger policy -- flag at execution time, no re-gate needed.

Match vocabulary, pinned at plan level (review round 1 -- previously the trigger's match predicate had nothing typed to match on): `mustConveyFacts` entries are teachable identifiers -- atlas lemmaIds or `chunk:{id}` refs -- validated against the scene lexicon + function inventory. The extractor prompt/schema (extract-intent.ts) and the popover help text are updated to say so. Entries that fail validation are kept for the fidelity gate (free text is fine there) but are EXCLUDED from teachable matching. This amends the 086.1 contract deliberately; the runtime code that already maps facts verbatim into LemmaRefs (scripted-middleware:202-204, 338-339) becomes correct instead of coincidental.

- Exit: fixture quest playthrough triggers live renders only at matching lines (pinned); trigger-off RENDERED TEXT byte-identical to 086.4 (round 2 -- "behavior" is not: once item 2 wires intentCache, the previously-dead enrichment reads (scripted-middleware:191-217, :330-351) go live with the trigger still off, mutating introduce lists / highlights / encounter observations for intent-bearing nodes; that now-live enrichment path is pinned SEPARATELY, with validated facts only per the match-vocabulary rule); cache bounds re-render cost (second identical moment = cache hit); telemetry names the teachable + the match reason per trigger; a node with hand-authored intent gets a cache HIT at runtime (key-parity pin); intent bake round-trips through Studio (authored intent -> extractor -> IDB -> runtime read, integration test).

### 087.6 Inner loop refactored to realizer + teachable-biased retrieval

The teacher policy becomes the REALIZER of scheduled teachables: directives derive from the schedule (fallback to today's reactive derivation when no schedule), emitted through the constraint + the 084 contribution surfaces unchanged in seam. Directive-cache lifetimes are re-examined HERE (the 083-era note deferred them to this epic): lifetime should follow schedule beats, not a flat maxTurns 3 -- decide-in-story with telemetry from 083.5's drift measurements.

Teachable-biased retrieval, mechanism named (review round 1 -- "rides the existing 077 seam" overstated: the quest-context middleware builds its retrieval query internally from activeQuestObjectives with no external bias input, and the 084 contribution contract has no retrieval field, contributions.ts:43-64). The route: a new optional `retrieveBiasTerms?: string[]` field on SugaragentContribution, merged like judgeDirectives, consumed by sugaragent's retrieve path. This is a NAMED SUGARAGENT-SIDE CHANGE (contract field + merge + consumption) shipped in this story -- small, 084-consistent, and keeps pedagogy out of sugaragent's internals (sugarlang publishes terms; sugaragent decides how to use them). Never a sugarlang reach-in.

- Exit: schedule-fed directives pinned (fixture schedule -> expected constraint); no-schedule fallback pinned as a mock-gateway golden against the deterministic fallback policy (review round 1: "byte-identical" is only meaningful there -- the LLM path is nondeterministic); retrieval bias arrives via the contribution field (boundary test, both plugins); zero-contribution invariant still holds when no schedule exists (084 contract); directive-lifetime decision recorded + pinned.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Board probe: debug dump of one outer-loop decision -- inputs and chosen teachables readable and explainable (why greetings, why now).
3. Debt probe: introduce a word (talk until one is introduced), then visit other NPCs/scenes across a few sessions -- telemetry shows the debt paying down across DIFFERENT speakers/scenes, and the item resurfacing until ~10 diverse encounters. Include at least one quest `advance-day` beat so the day diversity axis is exercised (review round 1: day is static otherwise).
4. Pacing probe: a long play session shows teach-peaks and valleys in telemetry, not a constant introduction drip; after a struggle-heavy stretch (miss probes on purpose), introductions visibly back off.
5. Moment probe: play a scripted quest with a due teachable that matches a line's intent -- that line (and only lines like it) renders live with the teachable woven in; gateway-down = baked/woven plays.
6. New Game probe: learner knowledge and debts survive New Game (by design); schedule state restores sanely after reload (no wall-clock tripwires).

## Epic wrap

docs/api: teacher page rewritten (two loops, board inputs, schedule artifact, debt ledger, trigger policy); telemetry page (schedule/debt/strain/trigger events); scripted-rendering page intent-cache claims corrected (087.5 item 5). Strategy 002 epic E status. Directive-lifetime decision promoted to the middlewares page. Backlog sweep of DEFERRED SEAM comments (086.5 stub comment closes here). Naming-drift decision (review round 1): telemetry writers still emit `director.*` events (SUGARLANG_DIRECTOR_WRITER) -- decide keep-for-continuity vs rename to scheduler/teacher, record the decision.

## Deferred / out of scope (with revisit triggers)

- Negotiation-move policy in the scheduler's "whether to check" slot: epic F fills it (code comment at the slot).
- FSRS parameter refitting from telemetry: strategy watchlist; revisit at real data volume.
- Strain-driven adaptation of non-language difficulty (full L4D idiom): strategy watchlist.
- Content-aware modality probes (newspaper knows about milk prices): strategy stretch goal; the board-read architecture here is its seam (code comment at the board reads).
- Multi-day itinerary planning (the "immersion trip" ceiling -- which places, which people, per day): floor here is per-scene scheduling; revisit when episodes span enough content for itineraries to matter.
- Mentor-line delivery timing (strategy line ~185 deferred it to epic E; review round 1 found it neither included nor re-deferred): explicitly re-deferred -- the scheduler's teach-peak/valley pacing (087.4) is the natural seam; revisit when a mentor NPC ships in authored content (code comment at the pacing decision point).
