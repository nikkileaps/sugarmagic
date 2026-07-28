# Plan 090 -- Concept-Opportunity Scanner (proposed child epic I of Strategy 002)

Status: DRAFT (drafted 2026-07-27 from the queso/Finnick diagnosis; pending epic-review)
Owner: nikki + claude
Date: 2026-07-27

Related:
- Strategy 002 -- proposed new child epic; the missing upstream organ of epic E (Plan 087, teacher outer loop)
- Plan 087 (epic E) -- HARD dep, SHIPPED: the scheduler/budgeter/realizer machinery this epic feeds; the SchedulerBoardView is the seam new candidates enter through
- Plan 085 (epic B) -- SHIPPED: function inventory; concepts can resolve to functions, not just lemmas
- Plan 086 (epic C) -- SHIPPED: the extract-chunks / extract-intent bake-time-LLM precedent (gateway + Ajv validation + content-hash cache + fail-soft) this epic's extraction pass follows
- Plan 088 (epic F) -- consumer, not overlap: 088.3's move policy decides HOW to check; this epic widens WHAT is checkable and adds the probe-opportunity input. Verified 2026-07-27: nothing in 088 sources candidates
- Plan 074 (world clock) + Plan 080 (NPC memory) -- runtime context sources the opportunity signals read
- docs/api/sugarlang-middlewares.md "The Teaching Decision Model" -- the gating ladder this epic completes
- Ground truth (2026-07-27): the compile pipeline resolves English authored text to target lemmas via the atlas gloss reverse index (compile-sugarlang-scene.ts Strategy 2); the activeScene compose bug that silently excluded ALL overlay NPCs from that pipeline was fixed the same day (preview-boot.ts / editor-support.ts; regression pinned in preview-boot-active-scene.test.ts)
- Ground truth (2026-07-27, second Finnick session): the prescription STALL diagnosed live -- introduce slots only vacate when a word is actually encountered (reviewCount > 0), and never-seen-word scores are static per (scene, npc), so words the generator never works in occupy the top slots indefinitely and everything ranked below the cap never surfaces, no matter how long the conversation runs (lexical-budgeter.ts prescribe(): introduce = top-cap survivors with reviewCount === 0). Nikki directed: no hotfix, fix it for good here (090.4)

---

## Why now

The teaching model is "the TEACHER decides, the model RENDERS, the verifiers CHECK" -- the teacher scans everything that is context for opportunities to teach a CONCEPT, gates each against learner state, and directs rendering. The gating machinery shipped across epics B/E (cards, band envelope, introduce/reinforce, probe floors). But the candidate pool it gates comes ONLY from the compile-time lexical scrub: tokenize authored text, exact-match English surface forms against atlas glosses. That scan is the right AMBIENT layer (hover glosses) and the wrong sole source of active teaching candidates: it needs the literal word ("cheesemonger" and "cheeses" both miss "cheese" -> queso), and it cannot see that a character IS about a concept. Finnick the cheese-obsessed NPC taught llegada and propietario (quest words) and never queso -- the canonical example the budgeter's own scoring comment promises.

Nothing reads an NPC's character and concludes "CHEESE is central here -- queso is a teachable." Nothing reads the blackboard, the world clock, NPC memory, or recent events for teaching opportunities. This epic builds that organ and points it at the machinery already waiting for it.

## Invariant (nikki, 2026-07-27)

Authors write English. NEVER require target-language words in lore, bios, dialogue, or any authored surface to make a concept teachable. The system derives target vocabulary from English concepts; the atlas is the bridge.

## Non-goals

- No changes to the gating machinery itself: budgeter scoring shape, band envelope, FSRS, probe floors stay as-is (weight tuning is a story here, structure is not).
- No runtime LLM calls added to the turn path: concept extraction is bake-time only (extract-chunks posture); runtime opportunity signals are deterministic reads of existing state.
- No authored concept-tagging UI as a requirement: extraction is automatic; a Studio review surface shows results but hand-editing is a deferred ceiling.
- No replacement of the lexical scrub: it remains the ambient/gloss layer and a candidate source; extraction ADDS candidates, never removes.
- No move-policy or negotiation behavior: that is 088's scope; this epic only widens its inputs.

## Design principles

- Floor first: NPC-level concept extraction alone fixes the Finnick class of failure and ships value; runtime context breadth is the ceiling, built after the floor proves out.
- Same bake-time mold every time: gateway call, Ajv-validated JSON, content-hash cache keyed to the source text, fail-soft to today's behavior on outage (extract-chunks precedent, third use).
- Concepts are support-language, resolution is atlas-validated: the LLM emits English concepts ("cheese", "trade", "boats"); each maps to target lemma ids via the atlas (gloss lookup or direct id validation). A concept with no atlas resolution is dropped with telemetry, never invented.
- Attribution is the currency: extracted lemmas enter the scene lexicon with npcSourceIds and a distinct source kind, so the existing w_npc affinity boost and provenance surfaces work unchanged.
- Opportunity beats schedule, bounded: an in-context opportunity may promote a seen-not-due item to reinforce or a likely-known item to probe, but pacing caps (087.4 strain curve) always win. The scheduler stays the pacer; the scanner only nominates.

## Stories (EXECUTION ORDER)

### 090.1 Bake-time NPC concept extraction (the floor)

Per present NPC: LLM reads bio + resolved lore page + bound dialogue text and emits ranked teachable concepts (support-language words/phrases with a one-line why). Each concept resolves through the atlas to target lemma ids (primary-gloss lookup first, then a bounded synonym pass decided in-story); resolved lemmas merge into the CompiledSceneLexicon with the NPC's npcSourceIds, a new source kind (concept-derived, distinct from the token-scan kinds), and a scene weight that puts them on par with heavily-mentioned scanned words. Content-hash cached alongside chunks/intents; extraction failure or gateway absence degrades to the scanned lexicon exactly as today.

- Exit: fixture NPC described as "obsessed with cheese" (no literal target words anywhere) yields queso in the compiled lexicon attributed to that NPC (integration, real atlas); unresolvable concepts drop with telemetry, never fabricate lemma ids (pin); cache-hit second compile makes zero gateway calls (pin); gateway-down compile equals today's lexicon byte-for-byte (pin).

### 090.2 Scene + quest concept extraction

Same mold over region/area labels, quest stage text, and item/document lore: setting-level concepts (docks -> barco, mercado) enter without NPC attribution but with anchor-equivalent weight where the source kind warrants it. Decide-in-story whether this is one combined extraction call per scene or per-source calls (cost vs cache granularity).

- Exit: a dock-setting fixture with no literal "boat" token in any scanned blob still yields barco (integration); concept-derived lemmas visible in the density histogram like any other (no special-casing downstream); per-source provenance in the authoring sourceMap.

### 090.3 Runtime opportunity signals (context breadth)

Deterministic, zero-LLM board enrichment: the SchedulerBoardView gains opportunity signals read from existing state -- active quest stage (which concept-derived lemmas are quest-adjacent right now), world clock band (074), NPC memory salience (080: topics this NPC has discussed with this player), and recent-turn topics (session history). Signals raise the effective priority of matching teachables for THIS conversation only; they never add candidates the compiled lexicon does not contain.

- Exit: talking to the cheese NPC ranks its concept-derived teachables above setting-level ones (unit, board fixture); a quest-stage change re-ranks within one turn (integration); signals are pure reads -- no new stores, no persistence (pin); absent sources (no clock, no memory) degrade to no signal (pin).

### 090.4 Prescription slot dynamics: depth ramp + stall rotation

The stall fix, done for good (nikki, 2026-07-27: no interim hotfix). Two mechanisms on the budgeter's introduce queue:

(a) DEPTH RAMP -- the effective introduce cap grows with conversation depth: the band cap (A1: 3 ... B2+: 6) is the opening posture, earning +1 every few turns of the SAME conversation up to a bounded ceiling (~2x base). First-exchange restraint stays; a long conversation digs deeper into the pool. Decide-in-story the turn source: the budgeter currently reads SESSION-level turns (resolveCurrentSessionTurn / learner.currentSession.turns) -- the ramp needs per-CONVERSATION depth, so the conversationState contract likely grows a per-conversation turn counter (or derives it from the conversationId's history).

(b) STALL ROTATION -- a word prescribed N consecutive turns without ever being encountered (no card created, no observation) yields its slot: deprioritized with a decaying penalty, not banned, so it re-enters ranking later. Requires prescribed-but-unencountered tracking per conversation (the pendingProvisional turnsPending shape is the precedent). Rotation decides who LEAVES a slot; opportunity signals (090.3) and score order decide who ENTERS it. Together with the ramp this guarantees the queue always moves: a stubborn top-3 the generator ignores cannot block the rest of the lexicon indefinitely.

Both stay subordinate to pacing: 087.4 strain suppression caps the effective budget before either mechanism applies.

- Exit: same-conversation depth raises the effective cap on schedule and never past the ceiling (unit); a word prescribed N turns and never encountered rotates out and a new word enters (integration -- the direct pin of the Finnick stall); rotated words return after the penalty decays (unit); strain-suppressed turns clamp the budget regardless of depth (pin, 087.4 interplay); budget.newItemsAllowed reports the effective cap so downstream consumers and telemetry see the truth (pin).

### 090.5 Opportunistic gating: the missing ladder rungs

The two gating outcomes the ladder documents but nothing models: (a) reinforce-ahead-of-due -- a seen-not-due card whose concept matches a live opportunity may enter the prescription's reinforce list, capped per turn and subordinate to the strain curve; (b) probe-opportunity -- a provisional/likely-known card whose concept matches promotes a probe candidate into the teacher's comprehensionCheck slot (088.3's policy still decides whether to fire it). Both emit teach reasons distinct from due/introduction so telemetry can measure whether opportunism helps. Opportunity matches are the preferred fillers for slots 090.4's rotation vacates.

- Exit: seen-not-due + matching opportunity -> reinforce list (integration); strain-suppressed turns never opportunistically reinforce (pin, 087.4 interplay); probe-opportunity surfaces through the existing comprehensionCheck wire without new fields (pin); new teach reasons in telemetry; a rotation-vacated slot prefers an opportunity match over the next score-order word when one exists (integration).

### 090.6 Visibility: Studio concepts panel + preview concept trace (nikki ask, 2026-07-27)

Two surfaces, one data spine.

STUDIO: per-NPC extracted-concepts view (which concepts, which lemmas they resolved to, which were dropped unresolvable) riding an existing inspector surface; telemetry rollup: concept-derived vs scan-derived share of introductions, opportunistic-reinforce outcomes vs scheduled ones. UI copy minimal.

PREVIEW CONCEPT TRACE (the debug-HUD ask): when the runtime debug HUD is on, each NPC dialogue entry gets a small icon at the end of the row; hovering it shows what CONCEPTS the teacher is teaching with THIS response -- each entry as concept -> resolved lemma/function -> gating outcome (introduce / reinforce / probe / opportunistic), plus the candidate source (concept-derived vs scan-derived). Data spine: the teacher middleware writes a per-turn concept-trace annotation alongside the constraint (the directive already knows its targetVocab and teach reasons; 090.1 adds the concept provenance to close the loop); DialoguePanel renders the icon from the annotation in the per-turn row, gated on the debug HUD's visible state (the 085.5 teach-line enrichment is the rendering precedent; the HUD's plugin-card contribution surface is the toggle-state seam). Dev/preview only -- the annotation is cheap and always written, the UI never ships in a published artifact (same guard as __sugarlangDebug).

- Exit: the fixture NPC's Studio panel lists cheese -> queso with provenance; dropped concepts visible with reason; telemetry distinguishes candidate source on every introduction event; in preview with the HUD on, a turn that introduces queso shows the icon and hover reveals "cheese -> queso (introduce, concept-derived)" (integration); HUD off = no icon (pin); published-artifact build contains neither the icon nor the HUD gate (pin).

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Finnick probe (the one that started this): fresh A1 learner, talk to the cheese NPC -- queso is prescribed within the first turns, glossed on first NPC use, carded on encounter. No Spanish anywhere in his authored content.
3. Extraction probe: Studio compile with gateway up -- the NPC's concept panel shows extracted concepts; recompile unchanged -- zero new gateway calls; kill gateway and recompile -- lexicon still builds, panel shows extraction skipped.
4. Opportunity probe: learn queso, come back next session mid-quest at the docks -- boat/dock vocabulary outranks cheese with a dock NPC; return to the cheese NPC -- queso resurfaces as reinforce or probe, not re-introduction.
5. Stall probe (the second Finnick session, pinned): keep talking to the same NPC 8-10 turns -- new introductions keep arriving as the cap ramps, and a prescribed word the NPC never actually says rotates out of the prescription after a few turns while a new word takes its place (telemetry shows the rotation with its reason).
6. Restraint probe: high-strain session (per 087.4 telemetry) -- no opportunistic additions on suppressed turns; depth ramp clamped too.
7. Concept-trace probe: debug HUD on in preview -- every NPC turn shows the trace icon; hover one -- the concepts behind that exact response, with their gating outcome and source. HUD off -- icons gone.

## Epic wrap

docs/api: extend the middlewares doc's Teaching Decision Model section (candidate sourcing gains the concept layer; ladder rungs a/b no longer marked unmodeled); compile page for the extraction artifact + cache; telemetry page. Strategy 002: add child epic I status. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Author hand-editing of extracted concepts (add/remove/pin): revisit on playtest evidence that extraction misses or over-includes; the Studio view (090.6) is the read-only floor (code comment at the panel).
- Budgeter weight rebalance (w_anchor 0.8 vs w_npc 0.7 lets quest words structurally edge out character words): revisit with 090.6's telemetry in hand rather than guessing now -- note 090.4's rotation reduces the stakes (a mis-ranked word is delayed, no longer permanently blocked) (code comment at SCORING_WEIGHTS).
- Cross-NPC concept graphs (Finnick's cheese relates to Rosa's market): revisit if single-NPC extraction proves out and telemetry shows concept clustering value.
- Dynamic mid-session extraction (LLM turns surface new concepts at runtime): violates the zero-runtime-LLM posture; revisit only with a product decision.
- Function-concept extraction (an NPC whose character implies teaching REQUESTS): the function inventory (085) is the resolution target; revisit once lemma-concept extraction is measured (code comment at the extractor output schema).
