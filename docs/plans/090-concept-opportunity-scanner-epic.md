# Plan 090 -- Context Extraction + Teacher Judgment (proposed child epic I of Strategy 002)

Status: DRAFT -- RESTRUCTURED 2026-07-28 (nikki, whiteboard session). The prior draft passed 4 adversarial review rounds, but those rounds audited a DIFFERENT architecture: extraction was compile-only, and the Teacher never read the situation. That draft could only ever teach concepts an author wrote down, which does not solve the motivating case (Finnick is an AGENT NPC). Code-level findings from those rounds are preserved inline and are still verified; the story structure is new and needs a fresh epic-review.
Owner: nikki + claude
Date: 2026-07-27 (restructured 2026-07-28)

Related:
- Strategy 002 -- proposed new child epic; the missing INPUT to epic E (Plan 087, teacher outer loop)
- Plan 087 (epic E) -- HARD dep, SHIPPED: `OuterLoopScheduler` + `SchedulerBoardView` + `LexicalBudgeter` are the gating and pacing half. This epic feeds them the thing they have never had: the SITUATION. 087 also explicitly assigns the function-chunk starvation fix here (087 "Outstanding at PR time")
- Plan 083 -- SHIPPED: `SugarLangTeacher` / `ClaudeTeacherPolicy` / `DirectiveCache`. The teacher LLM this epic re-feeds ALREADY EXISTS; 087.6 currently bypasses it (see 090.4)
- Plan 086 (epic C) -- SHIPPED: `MultiWordExpressionExtractor` (renamed from `extract-chunks` 2026-07-28) and `extract-intent` are the compile-pipeline precedent (gateway + Ajv + content-hash cache + fail-soft). NOTE: "bake" in this codebase means something narrower -- 086's scripted VARIANT baking (`BakedLineVariant`, `generateVariant`). This epic is COMPILE-time work, a fourth pipeline beside chunk/intent/variant. Do not call it baking.
- Plan 085 (epic B) -- SHIPPED: function inventory; concepts can resolve to functions, not only lemmas
- Plan 088 (epic F) -- NOT a dependency: 088 is Status DRAFT and its 088.3 defers probe-firing back to 087's slot, so any "088 decides" dependency is circular. 090.4 owns its own firing rule
- Plan 074 (world clock) -- CONFIRMED available: `getWorldDay` is already read at sugar-lang-context-middleware.ts:399 and `runtimeContext.timeOfDay` exists
- Plan 080 (NPC memory) -- structured topic salience lives in sugaragent and sugarlang must not import it (AGENTS.md one-way dependencies); deferred with a trigger below

---

## Why now

The teaching model is "the TEACHER decides, the model RENDERS, the verifiers CHECK." The teacher is supposed to look at everything that is context -- who is here, what this place is, what these characters are about, what is happening -- and decide what is worth teaching THIS learner right now.

It has never been given any of that -- and per the grid above, the gap is specifically the RUNTIME + AGENTIFIED cell. `SchedulerBoardView` carries learner cards, encounter debts, introduced functions, comprehension rate, and strain. There is no situation on it. The only source of teachable candidates is the compile-time lexical scrub: tokenize authored text, exact-match English surface forms against atlas glosses (compile-sugarlang-scene.ts "Strategy 2"). That scan needs the literal word -- "cheesemonger" and "cheeses" both miss "cheese" -> queso -- and it cannot know that a character IS about something.

Finnick, a cheese-obsessed agent NPC, taught `llegada` and `propietario` (quest words) and never `queso`, which is the canonical example the budgeter's own scoring comment promises.

## Where the Teacher actually lives (whiteboard, 2026-07-28)

Compile-vs-runtime and scripted-vs-agentified are TWO INDEPENDENT AXES. Conflating them is what made an earlier draft of this plan wrong, so the grid is stated before anything else. Verified against code, not inferred:

|  | scripted | agentified |
|---|---|---|
| **compile** | bake line variants (086) + extract line intent. **NO Teacher** -- `generateVariant` takes `authoredText, targetLang, band, intent, contentHash, dialogueDefinitionId, nodeId` and nothing teacher-shaped | nothing to bake; the line does not exist yet |
| **runtime** | teacher middleware runs but SHORT-CIRCUITS: band -> posture/ratio inline, `teacher.invoke()` is never called (sugar-lang-teacher-middleware.ts:226) | teacher middleware runs AND invokes the Teacher. **THIS CELL IS THE EPIC'S TARGET** |

Three consequences that the story set depends on:

1. **The Teacher is runtime-only, and that is forced, not an oversight.** Its job is "what is worth teaching THIS learner right now"; at compile time there is no learner -- variants are baked per BAND, not per person. The judgment the Teacher exists to make is structurally unavailable at compile.

2. **The right split is by VERB, not by time.** TEACHER decides -> always runtime. Model RENDERS -> precomputable when the output space is finite (a scripted line is bounded by line x band x posture x teachables, so 086 bakes it; an agentified line is unbounded, so it renders live). Verifiers CHECK -> both (four gates at bake, three at runtime). Compile time is not "the Teacher working early" -- it is the RENDERING half, precomputed where precomputation is possible. 086.5's live-render path is the seam where a runtime decision outruns a precomputed rendering.

3. **The scripted short-circuit is CORRECT and must not be "improved".** For a fixed authored line the text is already decided; the only levers are posture, ratio, and which already-present words the weave substitutes. A band lookup genuinely suffices, and wiring an LLM into that path would add cost and latency for no decision. Leave it.

So this epic changes exactly one cell. The other three are either correct as-is or structurally empty.

## The architecture (whiteboard, 2026-07-28)

`ContextExtractor` is ONE lifecycle-agnostic module. It takes context sources and returns a `SituationModel`. It does not know or care whether it is called from the compile scheduler or from a live conversation -- that is the caller's concern, exactly as `compileSugarlangScene(scene, atlas, morphology, profile)` is a pure function whose caching and debounce belong to `SugarlangAuthoringCompileScheduler`.

IT IS A SIBLING OF THE COMPILER, NOT A DEPENDENCY OF IT. `compileSugarlangScene` must NOT call the extractor: it is pure and synchronous and its output feeds `computeSceneContentHash`, while extraction is an async gateway call. Wiring it in would force the compiler async, make it require a gateway, break hash determinism, and break every direct caller (editor-support.ts:180, preview-boot.ts:79, compile-scheduler.ts:297/343, publish-sugarlang-artifacts.ts:86). This is exactly why chunks and intents are separate pipelines writing side fields post-hoc. It is also a SIBLING of the MultiWordExpressionExtractor, not an extension of it: that one is surface-bound (spots multi-word expressions appearing VERBATIM in authored text, prompt forbids inventing), this one is inferential (what the scene is ABOUT, usually a word appearing nowhere). Different linguistic objects, different consumers, no overlap -- MWEs are multi-word by definition, concepts are single-word by schema.

NO SECOND TRAVERSAL OF AUTHORED CONTENT. The extractor consumes the SAME `SceneAuthoringContext` the compiler does (scene-traversal.ts:76-95: region, `regionContents` composed presences, npcs, dialogues, quests, items, lorePages). `collectSceneText` already walks every authored source; a parallel walk inside the extractor would drift the first time a source kind is added. On the authored side the "source" is a thin PROJECTION of that existing object -- structured presences / roles / place description for the model, rather than the compiler's weight-tagged text blobs. Same sources, same traversal, different projection. A source INTERFACE earns its place only on the runtime side, where live facts (met/unmet, quest stage, time) have no home in `SceneAuthoringContext`; it must never become a second way to read authored content.

```
  SceneAuthoringContext        <- built ONCE by createSceneAuthoringContext
        |
        +--> compileSugarlangScene()  -> CompiledSceneLexicon  (pure, sync)
        +--> MultiWordExpressionExtractor -> MWEs (LexicalChunk[])  (LLM, async)
        +--> extractIntent()          -> intent artifacts      (LLM, async)
        +--> ContextExtractor         -> SituationModel        (LLM, async)  <- new
                                          - prose description
                                          - concept list (English + POS)
                                          - provenance per concept

CALLERS decide which sources they hold and when they call:

  compile scheduler          SceneAuthoringContext     cached on content hash
  (4th pipeline beside    -> (authored projection)  -> reused until authoring
   chunk/intent/variant)                                changes

  conversation start /       cached model + live       composed situation
  situation change        -> runtime sources:
                             met/unmet, quest stage,
                             time of day, turns so far
                                    |
                                    v
                     TEACHER JUDGMENT (LLM)
       "A1, no history, nothing met yet. Of cargo, cheese, greeting,
        travel, introductions, baggage, delivery -- what serves this
        learner now, and how?"
                                    |
                                    v
              PedagogicalDirective (targetVocab + posture + probe)
                                    |
                                    v
              PROVIDER generates the line   <- the model RENDERS
                                    |
                                    v
              OBSERVE -> observations -> cards  <- the verifiers CHECK
```

Most of the situation is COMPILE-derivable. Sorting nikki's own example: NPC titles/roles, who is placed at the dock (scene overlay), what the dock is, its passenger and cargo sections -- all authored. Only "has the player met them", quest stage, and time of day are runtime, and all three are cheap deterministic reads. The dynamic layer is a thin film over a rich static model.

## Invariants

- Authors write English. NEVER require target-language words in any authored surface. The system derives target vocabulary from English concepts; the atlas is the bridge.
- ONE extractor module owns context mining, and it is LIFECYCLE-AGNOSTIC (nikki, 2026-07-28). You hand it context sources, it extracts context. Where and when it is called -- compile, conversation start, mid-conversation -- is the caller's concern and must never leak into its API. Authored documents and live game state satisfy the same `ContextSource` interface. This follows the existing repo pattern, not a new one: `compileSugarlangScene` is pure and the scheduler owns lifecycle.
- Entry points split by CAPABILITY, not lifecycle: turning prose into concepts needs a model; composing live facts onto an existing situation does not. Name them for what they do, so a caller without a client cannot make the expensive call by accident. The split is for clarity and cost-visibility, NOT because model calls are forbidden.
- The teacher LLM makes the pedagogical judgment. Deterministic scoring supplies FACTS (known / due / too hard / frequency), the model supplies JUDGMENT (what serves this learner here). Neither replaces the other.

## Non-goals

- NOT optimizing LLM call frequency. Make the teaching work first. A teacher call per conversation start is the baseline and is acceptable; the player is already waiting on the NPC's first line, so it rides an existing wait. Situation-change reuse (083's `DirectiveCache` already provides the mechanism) is a cheap win to take where it falls out naturally, not a constraint to design around. Per-TURN calls would be felt and are worth avoiding, but that is a measurement question, not an architectural one.
- No changes to FSRS, the band envelope, or the observation grade table.
- No authored concept-tagging UI as a requirement; a Studio review surface is read-only in this epic.
- No replacement of the lexical scrub: it stays as the ambient/gloss layer and a candidate source. Extraction ADDS.
- No move-policy / negotiation behavior: that is 088.

## Design principles

- Compile as much as possible, overlay as little as necessary. Every fact that can be derived from authored content is derived once and cached; runtime adds only what authoring cannot know.
- Concepts are support-language; resolution is atlas-validated. The LLM emits English concepts + POS; the resolver maps them to target lemma ids. A concept with no atlas resolution is dropped with telemetry, never invented.
- LLM output is STORED in a side field and PROJECTED into `lemmas` at read. `computeSceneContentHash` covers text + atlasVersion + pipelineVersion only (content-hash.ts:139-147), so persisted LLM output must not sit inside `lemmas`. But the budgeter only ever iterates `lemmas` (lexical-budgeter.ts:130), so a side field alone never reaches the consumer. BOTH are mandatory -- see 090.2.
- Facts vs judgment: the budgeter FILTERS (binding) and RANKS (advisory). It already publishes per-candidate scores for every survivor in `rationale.priorityScores`; the teacher reads those facts and reshapes the ORDER. Never ask a model to infer a fact the budgeter already computed, and never let it override a filter.
- Strain is a CONSUME, not a build: `TeachSchedule.strainSuppressed` (teach-schedule.ts:85) is computed and written at sugar-lang-context-middleware.ts:408, BEFORE `prescribe()` at :449, and `fatigueScore` rides the learner profile (contracts/learner-profile.ts:117). Consume the boolean; never re-threshold `fatigueScore` (single enforcer).

## Stories (EXECUTION ORDER)

### 090.1 ContextExtractor + SituationModel

One lifecycle-agnostic module. Define a `ContextSource` interface that authored documents AND live game state both satisfy; `ContextExtractor` takes a set of sources and returns a `SituationModel` (prose description of the situation, plus a concept list of English word + POS + provenance). The module never asks where it is in the game lifecycle.

Entry points split by CAPABILITY: concept extraction over prose requires an LLM client; situation composition over already-structured facts does not. A caller holding no client can only do the latter -- cost is visible at the call site rather than hidden inside the module.

This story wires the FIRST caller: the compile scheduler, projecting the EXISTING `SceneAuthoringContext` (scene-traversal.ts:76-95) into extractor sources -- presences from `regionContents`, NPC bios / roles, resolved lore pages, region + area lore, item and document lore, quest text. No new traversal of authored content: `collectSceneText` already walks all of it, and a second walk would drift. 090.3 wires the second caller with live sources.

Runs as a FOURTH pipeline in `SugarlangAuthoringCompileScheduler` beside `chunkPipeline` / `intentPipeline` / `variantPipeline` (compile-scheduler.ts:45-99) -- same debounce, cache-hit skip, stale-hash discard. Cached like chunks (`chunk-cache.ts` shape, key `lang:promptVersion:contentHash`; model is NOT in the key, so prompt version must be bumped deliberately).

PREREQUISITE: dialogue text carries no NPC attribution today -- `collectDialogueBlobs` sets `sourceKind: "dialogue"` and never `npcDefinitionId` (scene-traversal.ts:204-213) though the binding is in scope at `createSceneAuthoringContext` (:466-470). Fixing it is required here and independently fixes today's `w_npc` boost, which currently ignores an NPC's own authored lines.

GATEWAY: the gateway resolves the model server-side from `purpose` and ignores client model ids -- asserted by test ("073.2 -- resolves the model server-side by purpose", plugins/src/deployment/gateway/gateway.test.ts:282). `DEFAULT_CHUNK_EXTRACTOR_MODEL` (extract-chunks.ts:78) is dead and its `extractorModel` telemetry field records a model that was not used. Add a `purpose` + env var for extraction; correct the chunk-side telemetry claim.

EXTRACTOR SCHEMA: a concept is a SINGLE WORD plus its part of speech. Phrases belong in the prose description, not the concept list -- 090.2's resolver matches concepts against atlas gloss parts, and phrase concepts would leave the match predicate undefined.

- Exit: a scene fixture with Finnick (bio "obsessed with cheese", no target-language words anywhere) produces a SituationModel naming him, his role, the place, and a concept list containing "cheese" (integration); concepts carry provenance back to their source; cache-hit second compile makes zero gateway calls (pin); gateway-down compile degrades to today's lexicon with the situation absent, never a hard failure in authoring (pin); dialogue-blob NPC attribution pinned separately.

### 090.2 Concept resolution + the delivery link

Resolve concepts to target lemma ids, and get them where the budgeter can see them. This story is the single link the whole epic exists to build.

RESOLVER (pure function, no LLM). UNION GATHER: (1) gather primary-gloss AND secondary-gloss matches into one pool; (2) filter by POS as a MEMBERSHIP TEST on `partsOfSpeech` (first-listed POS is not authoritative; all 11,000 es entries carry the field); (3) rank by lower `frequencyRank` FIRST, primary-gloss preference only as tie-break; (4) drop with telemetry if empty -- never guess. Match predicate: EXACT whole comma-separated gloss part, case-folded (not token-containment, which would match "shop" to `escaparate`).

Rank order is load-bearing. Verified against the shipped es atlas:

| concept | primary (post-POS) | secondary | primary-first | freq-first (LOCKED) |
|---|---|---|---|---|
| dock | (empty -- `atracar` is verb-only) | `embarcadero` 7134 | `embarcadero` | `embarcadero` |
| trade | `oficio` 2374 | `comercio` **1098** | `oficio` (wrong) | `comercio` |
| boat | `barca` 2493 | `barco` **764** | `barca` (wrong) | `barco` |
| cheese | `queso` 1350 | -- | `queso` | `queso` |

THE TRADE, MEASURED: 8198 resolvable (concept, POS) keys; 2086 ambiguous; 486 resolve differently under frequency-first (23% of ambiguous), splitting roughly 40% better / 25% wash / 35% near-miss. Frequency-first buys learner utility (`comercio`, `barco`, `trabajo`, `gustar`, `equipaje`) at the cost of near-miss senses (`forge` -> `falsificar`; `tool` -> `instrumento`; `fog` -> `bruma`; `match` -> `partido`). `match` -> `partido` is INDUCED BY THE FREQUENCY KEY -- primary-first resolves it correctly -- not inherent polysemy. This is the right trade for a teaching system; telemetry records chosen lemma AND runners-up so 090.7 can surface it.

DELIVERY -- TWO CONSTRAINTS, BOTH MANDATORY:
- STORAGE: `conceptLemmas?: ConceptDerivedLemma[]` as an optional side field mirroring `chunks?` (contracts/scene-lexicon.ts:154), written through the scheduler like chunks (`writeChunksIntoCompileCache`, compile-scheduler.ts:221-237). Storing inside `lemmas` would make two artifacts with the same contentHash differ by whether extraction ran.
- PROJECTION: the read-time composer PROJECTS `conceptLemmas` INTO `lemmas` as ordinary `SceneLemmaInfo` entries (band / frequencyRank / partsOfSpeech from the atlas, `npcSourceIds` from the concept's sources, `sceneWeight` from concept weight), side field retained for provenance.

DEDUP WITH THE SCRUB (no owner before this; found 2026-07-28): the two layers OVERLAP by design. The scrub already yields `queso` if any authored line contains the literal word "cheese", and the extractor yields `cheese -> queso` from Finnick's bio. Both target the same key in `lemmas`. The projection must MERGE, not overwrite: union `npcSourceIds`, take the greater `sceneWeight`, and retain BOTH provenances so 090.7 can show a lemma was found twice and by which path. Last-write-wins is the dangerous default here -- dropping the scrub's `npcSourceIds` (or the concept's) silently costs the `w_npc` affinity boost, which is the exact mechanism that ranks Finnick's cheese above quest vocabulary.

WHY THE CHUNKS PRECEDENT MISLEADS: chunks are consumed by a DIFFERENT consumer and never enter `lemmas`. The budgeter iterates `Object.values(input.sceneLexicon.lemmas)` (lexical-budgeter.ts:130), band-filters on `cefrPriorBand` (:157), and the w_npc boost reads `npcSourceIds` (scoring.ts:149-154). Mirror chunks literally and queso is never a candidate -- the original bug, shipped through its own fix. ONE composer serves all read paths: authoring compile (editor-support.ts:180), preview boot (preview-boot.ts:79), scheduler (:297/:343), publish (publish-sugarlang-artifacts.ts:86). `mergeChunks` (scene-lexicon-store.ts:59-74) is a SHAPE precedent only -- it has no production caller.

PUBLISH POSTURE: authoring compile is fail-soft; PUBLISH THROWS on extraction failure and attaches `conceptLemmas` inline, matching chunks (publish-sugarlang-artifacts.ts:93-106). A published game silently missing its concept layer teaches the wrong vocabulary with no author present to notice.

- Exit: the composed lexicon's `lemmas` map contains queso with `npcSourceIds` including the fixture NPC AND `prescribe()` returns it as a candidate (pin -- THE delivery link; a test asserting only that `conceptLemmas` is populated would pass while the epic fails); dock -> `embarcadero` and trade -> `comercio` (pin -- the ids the locked rank order produces, which primary-first gets wrong); resolved lemma's `partsOfSpeech` always CONTAINS the concept POS (pin -- note 37 entries are tagged both noun and verb, so `hope` -> `esperar` is legal; a stricter "never a verb" pin is NOT deliverable); empty pool drops with telemetry (pin); a lemma found by BOTH the scrub and the extractor appears ONCE with unioned npcSourceIds, the greater sceneWeight, and both provenances retained (pin -- last-write-wins here silently costs the w_npc boost); first-ever preview of never-extracted content degrades to scan-only and surfaces "extraction pending", never a silent empty (pin).

### 090.3 ContextExtractor: the runtime overlay + situation-change detection

The thin dynamic film. `ContextExtractor.overlay(situationModel, runtimeState)` -- zero LLM, pure reads: has the player met each present NPC (encounter state), current quest stage, time of day (`WORLD_TIME_OF_DAY_FACT` / `runtimeContext.timeOfDay` already exist), and what has been said so far this conversation.

Also owns SITUATION-CHANGE DETECTION -- a stable situation key over (scene, present NPC set, quest stage, time band). Its primary job is CORRECTNESS: when the quest advances or an NPC leaves mid-conversation, the teacher's directive is stale and must be re-judged. Reusing the directive while the key is unchanged is a cost win that falls out of the same mechanism, but it is not the reason the key exists.

NPC memory salience is CUT: structured topic salience lives in sugaragent (`NpcMemoryRecord.salientFacts` etc., free English text) and sugarlang must not import it. The only memory published across the seam is `{metCount, firstMeeting, hasMemory}` -- which is exactly the "have they met" fact this story needs, so the useful part is already available. Deferred below.

- Exit: the composed situation reflects met/unmet correctly on first meeting and on return (integration); a quest-stage advance changes the situation key and invalidates the cached directive within one turn (integration); an unchanged situation reuses the cached directive rather than re-judging (pin -- correctness: the directive must not silently change under a stable situation; the call saving is a side benefit); absent sources (no clock) degrade to no signal (pin); no sugaragent import appears in sugarlang (pin -- guards the boundary).

### 090.4 Teacher judgment: feed the situation, re-default the LLM path

The pedagogical call. The teacher receives the composed situation (prose + concepts) ALONGSIDE the learner facts it already gets, and decides what to teach and how: which concepts, in what order, as introduce / reinforce / probe.

WHAT ALREADY EXISTS: `SugarLangTeacher` + `ClaudeTeacherPolicy` + `DirectiveCache` shipped in 083. `TeacherContext` today carries learner, scene lexicon, prescription, npc, recentTurns, probe floors -- but NO situation. This story adds the situation to that context and makes the LLM path the default again.

DIRECT TENSION WITH 087.6 (stated plainly): 087.6 added a schedule-driven path that BYPASSES the teacher LLM entirely whenever a schedule exists, for cost and determinism. This story flips the default: LLM judgment on situation change, deterministic realization otherwise. The 087.6 path becomes the FALLBACK -- gateway down, situation unchanged, or strain-suppressed -- not the primary. That is a deliberate reversal of a decision made 2026-07-27, justified because the bypass was chosen when the teacher had nothing worth reading.

FACTS VS JUDGMENT -- DECIDED. The rule is: **the budgeter's FILTERING is binding; its RANKING is advisory.**

- BINDING (the teacher may not violate): the band envelope (never above learner band + 1, lexical-budgeter.ts:157), the `avoid` list and quest-essential exclusions, and the effective budget from 090.5. These are facts about the learner and the content, not opinions.
- ADVISORY: the ORDER. `introduce` stops being "the answer" and becomes "the default recommendation". The teacher may prefer a lower-scored candidate when the situation justifies it -- which is the entire point, since the scoring function cannot see that the learner is standing in front of a cheesemonger.

THE FACT CHANNEL ALREADY EXISTS -- this is not new plumbing. `LexicalRationale` (contracts/lexical-prescription.ts:72-83) already carries `priorityScores: LexicalPriorityScore[]` for EVERY survivor, each with `lemmaRef`, `score`, per-term `components` (due / new / anchor / prodgap / lapse) and `reasons`, plus `candidateSetSize`, `envelopeSurvivorCount`, `droppedByEnvelope`, `questEssentialExclusionLemmaIds` and `levelCap`. The budgeter already scores the whole in-band set and publishes the ranking; it merely ALSO slices the top N into `introduce`, and today the teacher reads only that slice. The advisory data is already riding along unread.

This story adds to each score entry: whether the learner holds a card and its `reviewCount`, and (after 090.2) the candidate's provenance -- concept-derived vs scan-derived, and via which NPC. Those are the facts the situational judgment needs.

PRECEDENT, IN THE CONTRACT'S OWN WORDS: `LexicalPrescription`'s doc comment reads "Raw Budgeter output that the Director reshapes but does not replace" (lexical-prescription.ts:85-86; "Director" is the former name of the Teacher). The architecture always intended reshape-not-replace; the code simply never reshaped, it consumed a pre-sliced list. This story honors the stated contract rather than changing the budgeter's role.

LADDER RUNGS: docs/api/sugarlang-middlewares.md marks ONE rung unmodeled (opportunistic reinforce); the probe rung is modeled (floors + `comprehensionCheck`). Expressing "reinforce ahead of due" and "probe this now" requires extending two closed unions -- `TeachReason` (teach-schedule.ts:31) and `ProbeTriggerReason` (pedagogy.ts:71-76) -- plus a telemetry taxonomy row. Not "no new fields".

FIRING RULE OWNED HERE: an opportunity may only promote a probe candidate INTO the existing floor-gated slot (middlewares/shared.ts soft/hard floors); it never fires a probe the floors would block. 088 may supersede this later; that is a one-way upgrade, not a dependency.

- Exit: given a situation naming a cheese NPC and an A1 learner with no history, the teacher's directive introduces the cheese concept (integration, mock gateway); the directive is reused across turns until the situation key changes, and IS re-judged when it does (pin -- jointly with 090.3); gateway down falls back to the deterministic 087.6 path with no error surfaced to the player (pin); strain-suppressed turns never opportunistically reinforce (pin); the new TeachReason / ProbeTriggerReason variants appear in telemetry with a docs/api row (pin); the teacher never selects a lemma outside the band envelope, from `avoid`, or beyond the effective budget (pin -- the BINDING half; judgment reshapes order, never filtering); the teacher CAN select a candidate ranked below the budgeter's top-N when the situation justifies it (pin -- the ADVISORY half, and the pin that proves `introduce` is no longer the answer); `priorityScores` entries carry reviewCount and provenance so the judgment has its facts (pin).

### 090.5 Effective-cap accounting: strain consume + depth ramp + function reserve

Three mechanisms on ONE quantity -- the effective introduce cap. Pure accounting.

(a) DEPTH RAMP: the band cap (A1: 3 ... B2+: 6, lexical-budgeter.ts:48-61) is the opening posture, earning +1 every few turns of the SAME conversation to a bounded ceiling. The budgeter reads SESSION turns today (`resolveCurrentSessionTurn`); the ramp needs per-CONVERSATION depth, so conversationState grows a counter. Ramp constants must be CHOSEN in-story before the exit is writable.

(b) FUNCTION-CHUNK RESERVE: scope 087 assigned here. The injection cap is `newItemsAllowed - introduce.length` (sugar-lang-context-middleware.ts:483-490); since the budgeter fills `introduce` to exactly `levelCap` in content-rich scenes, that cap is 0 every turn and scheduled function teachables are never realized. Reserve BEFORE the budgeter fills, not subtract after.

(c) STRAIN CONSUME: read `schedule.strainSuppressed`; never re-derive suppression from `fatigueScore`.

CLOCK MISMATCH (decide in-story): the ramp is per-conversation while `fatigueScore` is per-session and rises with session turns (session-signals.ts:92-102; suppress threshold ~35 turns). A conversation-depth ramp widens the cap exactly as session fatigue climbs.

- Exit: this story EXPORTS the per-conversation counter on the conversationState contract for 090.6 (pin); depth raises the effective cap on the chosen schedule and never past the ceiling (unit); a scheduled function chunk is realized in a content-rich scene where `introduce` is full (integration -- fails against today's code); `schedule.strainSuppressed === true` clamps the cap regardless of depth (pin); the budgeter derives SUPPRESSION from the boolean and never re-derives it from `fatigueScore`, though reading `fatigueScore` as a graded ramp ceiling is allowed (pin); `budget.newItemsAllowed` reports the effective cap (pin).

### 090.6 Stall rotation

`introduce` is the top-`levelCap` survivors with `reviewCount === 0` (lexical-budgeter.ts:176-179), and `reviewCount` increments ONLY when `receptiveGrade !== null` (fsrs-adapter.ts:156, increment :174) while the `encountered` observation returns `receptiveGrade: null` (budgeter/observations.ts:91-96). So a word the NPC SAYS EVERY TURN never leaves `introduce`; only a hover, production, or probe frees the slot. Scores are static for never-seen candidates (`lastProducedAtMs: null`, initial productive strength -> decay terms are no-ops, fsrs-adapter.ts:213-214, 288-296).

A word prescribed N consecutive turns that remains UNGRADED yields its slot, with a decaying penalty rather than a ban. Keys on `reviewCount === 0` -- the budgeter's own filter -- NOT on exposure.

TRACK EXPOSURE ALONGSIDE GRADEDNESS: `reviewCount === 0` cannot distinguish "the NPC said it every turn and the learner ignored it" from "the realizer never rendered it". Only the first deserves a penalty; the `encountered` observation tells them apart.

CYCLING VS GRADUATION (decide in-story): nothing here graduates an exposed-but-uninteracted word, so a rotated word's penalty decays and it returns indefinitely. Decide whether repeated rotation eventually demotes to reinforce-only.

PERSISTENCE: per-conversation counters are ephemeral by default. If they must survive a session they ship as a `SaveParticipant<TSlice>` with no wall-clock values persisted. `pendingProvisional` / `turnsPending` is the tracking precedent.

- Exit: this story consumes 090.5's exported counter and does not define its own (pin); a word prescribed N turns and still `reviewCount === 0` rotates out and a new word enters EVEN WHEN the NPC said it every turn (integration -- the direct Finnick pin); a word the realizer NEVER rendered is not penalised (pin); rotated words return after decay (unit); the cycling decision is pinned whichever way it goes.

### 090.7 Visibility: Studio situation panel + preview concept trace

STUDIO: per-scene view of the SituationModel -- the prose description, the concept list, what each concept resolved to, what was dropped and why. Host on `ui/shell/sugarlang-turn-inspector.tsx` (already telemetry-backed, renders `RationaleTrace` + `PanelSection`); reconcile placement with the InspectorToolbar backlog. Telemetry rollup: concept-derived vs scan-derived share of introductions; teacher-judged vs deterministic-fallback share of directives.

PREVIEW CONCEPT TRACE: each NPC dialogue entry gets a small icon; hovering shows what the teacher was teaching with THIS response -- concept -> resolved lemma -> gating outcome -> source, plus whether the directive came from LLM judgment or the deterministic fallback.

DATA SPINE: the teacher writes `execution.annotations`; the panel reads `turn.annotations` -- distinct objects with no copy step. The 085.5 precedent writes from the OBSERVE middleware at finalize: `normalizedTurn.annotations!["sugarlang.teachLine"]` (sugar-lang-observe-middleware.ts:723), read via `readTeachLine` (dialogue/highlight.ts:55) at DialoguePanel.ts:585 and ScriptedDialogueBox.ts:130. So: teacher computes -> observe copies onto the turn -> reader beside `readTeachLine` -> BOTH presentations render it. `turn-text.ts` is NOT an alternative (it composes text + highlight spans only).

HUD STATE: no seam exists -- `hudOpen` is a function-local (DebugHud.ts:116) and `RuntimeDebugHud` exports only `update` / `dispose` (:53-56). This story adds one. The HUD is NOT hidden during dialogue; `.sm-debug-hud--dialogue-active` sets only `pointer-events: none` (:472-474).

Dev/preview only, gated on `adapter.boot.hostKind === "studio"` (targets/web/src/runtimeHost.ts:2794) -- DialoguePanel ships to published web and cannot be excluded by build.

- Exit: the fixture scene's Studio panel shows the situation prose, cheese -> queso, and any drops with reasons; the trace annotation survives teacher -> observe -> `turn.annotations` (pin); with the HUD open, a turn introducing queso shows the icon and hover reveals "cheese -> queso (introduce, concept-derived, LLM-judged)" (integration); the icon renders in BOTH the chat panel and the scripted box (pin -- separate presentations since 2026-07-28); HUD closed = no icon (pin); non-studio hostKind renders no icon (behavior pin).

## The shippable floor

090.1 + 090.2 + 090.4 gets a situation to the teacher and a judged directive out. But 090.6 is required for it to be OBSERVABLE: in a content-rich scene the first `levelCap` score winners hold the introduce slots permanently, so a widened pool changes nothing visible until slots can turn over. Floor = 090.1, 090.2, 090.4, 090.6. 090.3 (runtime overlay) is needed for anything that depends on met/unmet or quest state; 090.5 and 090.7 are the ceiling.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Situation probe: compile a scene with Horace, Finnick, Pennygale at the dock -- the Studio panel shows a situation description naming them and their roles, and a concept list including cheese, cargo, travel, greeting.
3. Finnick probe: fresh A1 learner, no history, talk to the cheese NPC -- queso is taught within the first turns, glossed on first use, carded on encounter. No Spanish anywhere in his authored content.
4. Stability probe: keep talking without changing scene, NPCs, quest stage, or time -- the teaching directive stays consistent turn to turn (telemetry also shows the call being reused rather than repeated).
5. Situation-change probe: advance the quest stage mid-conversation -- one new teacher call, and the directive changes.
6. Stall probe: keep talking 8-10 turns -- new introductions keep arriving as the cap ramps, and a prescribed word the NPC HAS been saying but you never hover or use rotates out after a few turns. A word the NPC never said is deliberately NOT rotated.
7. Restraint probe: high-strain session -- no opportunistic additions, depth ramp clamped.
8. Offline probe: kill the gateway -- conversations still work on the deterministic fallback; nothing surfaces to the player.
9. Concept-trace probe: debug HUD on -- every NPC turn shows the trace icon; hover reveals the concepts, their outcomes, and whether the directive was LLM-judged.

## Epic wrap

docs/api: extend the middlewares doc's Teaching Decision Model (candidate sourcing gains the situation layer; the one rung marked unmodeled is now modeled); a NEW compile page for the SituationModel artifact + cache (none exists today); telemetry page rows for the new events and TeachReason / ProbeTriggerReason variants, plus a `SERVER_BOUND_PII_FIELDS` check on any payload carrying situation prose or player text. Correct 087's teacher page for the re-defaulted LLM path. Strategy 002: add child epic I status. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Synonym-gap drops (~6% of plausible game concepts): a concept drops when no gloss part names it exactly though a good lemma exists under a near-synonym -- `shop` (tienda glosses "store"), `morning` (mañana glosses "tomorrow"), `net` (red glosses "network"), `pier`, `smith`. A shopkeeper NPC is the second-most-obvious Finnick case and the epic no-ops on it. Dropping is SAFE, so this is deferred, but it caps reach. Options in cost order: have the extractor emit 2-3 synonym candidates per concept and resolve the union; an English synonym table for the top ~50 game concepts; or rely on the deferred author override. Trigger: 090.7 telemetry showing real drop rate (code comment at the resolver drop path).
- Multiword-gloss unreachability: 973 atlas entries (91 in the top-3000) have only multiword gloss parts and cannot be reached by single-word concepts + exact match. Same trigger; a phrase-concept mode needs the match predicate redesigned.
- Author hand-editing of extracted concepts / situation: revisit on playtest evidence of misses or over-inclusion; 090.7 is the read-only floor.
- NPC memory salience as a signal: needs a NEW sugaragent contribution carrying STRUCTURED topic ids across the plugin seam; free-text `salientFacts` is not deterministically matchable. Pinning context-middleware ordering (both plugins sit at stage `context` priority 10, unpinned) is a prerequisite.
- Budgeter weight rebalance: revisit with 090.7 telemetry. Note for never-seen lemmas the largest absolute term is `w_prodgap * stability` (~1.44, scoring.ts:163/173), not `w_anchor` vs `w_npc`; it is near-constant across same-band candidates, so any rebalance starts from prodgap.
- Cross-NPC concept graphs: revisit if single-scene extraction proves out.
- Post-turn capture of concepts the NPC emitted unprompted (Finnick said `familia`, `tía` with nothing prescribing them): the observe middleware already tokenizes every turn and runs chunk matching, so noticing "target-language lemma with no card" is deterministic and cheap. Deliberately out of this epic to keep it one loop; revisit immediately after the floor ships, since it is the natural completion of "the verifiers CHECK" (code comment at the observe chunk matcher).
