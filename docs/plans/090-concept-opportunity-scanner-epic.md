# Plan 090 -- Context Extraction + Teacher Judgment (proposed child epic I of Strategy 002)

Status: DRAFT -- NOT LOCKED. epic-review has run 4 rounds (2026-07-28). Rounds 1-3 audited the plan against the CODE and it held -- every citation survived. Round 4 audited it against the DOMAIN MODEL and it did not: the stories were producing better inputs to a decision the model relocates. Stories are revised accordingly; five decisions remain, listed at the end.

The model this plan must satisfy: `packages/plugins/src/catalog/sugarlang/docs/api/domain-model-after-epic-090.md`.

Restructured 2026-07-28 (nikki, whiteboard session). An earlier draft passed 4 review rounds, but those audited a DIFFERENT architecture: extraction was compile-only and the Teacher never read the situation, so it could only ever teach concepts an author wrote down -- which does not solve the motivating case (Finnick is an AGENT NPC). Code-level findings from those rounds are preserved inline and re-verified.
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

THE MOTIVATING CASE IS REACHABLE (measured round 3, and no earlier round had checked it): `queso` is band **A1**, frequencyRank 1350 in the shipped es atlas, so it passes an A1 learner's band+1 envelope filter (lexical-budgeter.ts:156-158). If it had been B1+ the entire epic would deliver nothing for the learner it is written about.

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

So this epic changes BEHAVIOR in exactly one cell -- runtime x agentified. It still WRITES code in the compile column (090.1's fourth pipeline), because the situation the runtime cell consumes is mostly compile-derived; that pipeline is new work, not a behavior change to the bake/variant cell, which it does not touch. Precise claim: no observable change to scripted output at either lifecycle. Sharpened round 1 -- the earlier "changes exactly one cell" read as "only one file region moves", which is false.

## The architecture (whiteboard, 2026-07-28)

`ContextExtractor` is ONE lifecycle-agnostic module. It takes context sources and returns a `SituationModel`. It does not know or care whether it is called from the compile scheduler or from a live conversation -- that is the caller's concern, exactly as `compileSugarlangScene(scene, atlas, morphology, profile)` is a pure function whose caching and debounce belong to `SugarlangAuthoringCompileScheduler`.

IT IS A SIBLING OF THE COMPILER, NOT A DEPENDENCY OF IT. `compileSugarlangScene` must NOT call the extractor: it is pure and synchronous and its output feeds `computeSceneContentHash`, while extraction is an async gateway call. Wiring it in would force the compiler async, make it require a gateway, break hash determinism, and break all eight of its direct callers (enumerated under 090.2 DELIVERY, where round 2 also establishes that the READ paths -- not the call sites -- are the seam that matters). This is exactly why chunks and intents are separate pipelines writing side fields post-hoc. It is also a SIBLING of the MultiWordExpressionExtractor, not an extension of it: that one is surface-bound (spots multi-word expressions appearing VERBATIM in authored text, prompt forbids inventing), this one is inferential (what the scene is ABOUT, usually a word appearing nowhere). Different linguistic objects, different consumers, no overlap -- MWEs are multi-word by definition, concepts are single-word by schema.

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

- NOT optimizing LLM call frequency AS A COST EXERCISE. But note the lifecycle in 090.3 makes one-call-per-conversation a structural property rather than a tuning target -- zero calls per turn and per rendered line falls out of the slate/realization split, it is not bought. Make the teaching work first. A teacher call per conversation start is the baseline and is acceptable; the player is already waiting on the NPC's first line, so it rides an existing wait. Situation-change reuse (083's `DirectiveCache` already provides the mechanism) is a cheap win to take where it falls out naturally, not a constraint to design around. Per-TURN calls would be felt and are worth avoiding, but that is a measurement question, not an architectural one.
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


## Stories

REVISED 2026-07-28 (round 4) against
`packages/plugins/src/catalog/sugarlang/docs/api/domain-model-after-epic-090.md`.

The round 1-3 findings were about whether the plan described the code
accurately. They did; every citation survived a line-by-line re-read. Round 4
asked a different question -- whether the plan is aligned with the domain model
-- and the answer was no, in one specific structural way:

> **Every story produced a better INPUT to a decision. The model relocates the
> decision.**

090.2 delivered to a consumer being dissolved. 090.4 reshaped a ranking that
stops being produced. 090.5 and 090.6 both fixed symptoms of a pre-truncation
the model removes. And the single most valuable story had not been written.

Execution order: **090.1, 090.2, 090.8, 090.4, 090.3, 090.5, 090.7.**

### 090.1 ContextExtractor + SituationModel

Unchanged from round 3 except for one addition. Re-read the round-3 text for
the cache hazard, the POS enum, the presence-condition trap and the gateway
scoping -- all still stand.

ADDITION -- MUST-COMPREHEND FLAGS. A concept carries an optional
must-comprehend flag alongside its POS and provenance. This is where
quest-essential vocabulary lives under the new model: not as its own channel
into the Teacher, but as a property of a concept the Situation already carries.
Without it 090.4 has nowhere to read the obligation from and quest-essential
stays a private road (see 090.4).

### 090.2 Concept resolution

The resolver half of the old 090.2, unchanged: union-gather over primary AND
secondary gloss, POS membership filter, rank by `frequencyRank` first, drop with
telemetry when empty. The four pinned rows (dock/trade/boat/cheese) and the
provider-contract change all stand.

DELIVERY IS NO LONGER THIS STORY'S JOB. The old text called projection into
`sceneLexicon.lemmas` "the single link the whole epic exists to build". It is
not, and round 4 falsified it:

- Every reader of `sceneLexicon.lemmas` was enumerated. The budgeter's candidate
  sourcing (lexical-budgeter.ts:130) is the only one that needs membership;
  the rest are the scheduler board (context-middleware.ts:400), the prompt's
  capped scene snapshot (prompt-builder.ts:247), a gloss lookup (:354) and debug
  logs. **Nothing downstream of the Directive requires it** -- `applyWeave`
  reads `constraint.targetVocab.introduce`, and the observe middleware gates on
  `targetLemmaSet` union existing cards (sugar-lang-observe-middleware.ts:450-454).
- So a Teacher handed `queso` via the Situation, naming it in `targetVocab`,
  reaches both the weave and the observe loop with no projection at all.
- The actual blocker is one prompt line:
  `"Only output targetVocab lemmas that already appear in the prescription."`
  (prompt-builder.ts:99). That sentence, not a missing projection, is what stops
  the motivating case.

The projection as previously specced also cost an atlas dependency bolted onto
the declared single read surface (scene-lexicon-store.ts:39 takes only a
scheduler) plus the whole dedup/merge apparatus, which existed solely to
preserve the `w_npc` boost (scoring.ts:149-154) -- a RANKING mechanism the model
gives to the Teacher.

KEEP the storage side: `conceptLemmas?` as a side field written through the
scheduler like chunks. It is the compile artifact. Drop the read-time projection
into `lemmas` unless the budgeter-deletion order (below) proves it is needed as
a transition scaffold.

- Exit: concepts resolve to the four pinned lemma ids; `partsOfSpeech` always
  contains the concept POS; empty pool drops with telemetry; the side field is
  persisted and survives a cache-hit recompile.

### 090.8 Realization -- NEW, and the most valuable story here

**Given one piece of authored text, which of the slate's items does it teach.**

This story did not exist, and it is where the bug the epic exists to fix
actually lives. Two divergent implementations of it are already in the codebase:

| Call site | Pool it uses |
|---|---|
| `sugar-lang-scripted-middleware.ts:134` | `constraint.targetVocab.introduce` -- the slate, **pre-truncated to `levelCap`** (3 at A1) |
| `grading/display-text-resolver.ts:247` | `atlas.listLemmasAtBand(...)` for every band at or below -- **the whole lexicon, no slate, no teacher** |

Both call the same primitive. `diglotWeave(text, pool, chunks, atlas, target,
support)` (diglot-weave.ts:170-177) **already is the intersection** -- it
substitutes only tokens present in the text (:191-237). The algorithm exists and
is shared. What does not exist is a single owner of the POOL question. That
absence is the realization boundary.

`display-text-resolver.ts:78-114` is the workaround written because there was no
such seam; its own diagnosis at :96-101 is this finding stated in advance, and
:107-113 schedules the revisit. **This story is what lands on that comment.**

SCOPE:

- One pure `realize(slate, standing, text, posture)`. Zero LLM. Per narrative
  unit. Total in the same sense as `createDisplayTextResolver` -- absent inputs
  yield authored text, never a throw.
- It owns the POOL (slate ∩ text), the PER-TEXT CAP, and the band split.
- Consume `GradedTextUnit` (grading/graded-text-source.ts). The repo already has
  the narrative-unit abstraction with a documented Strategy + discriminated-union
  design. Do not invent a second notion of "a piece of text".
- Wrap `diglotWeave`; do not rewrite it.

THE CAP HAS NO HOME TODAY, AND THAT IS THE REAL GAP.
`TARGET_LANGUAGE_RATIO_BY_POSTURE` exists (teacher/band-envelope.ts:36-41) but
`computeLanguageRatioVerdict` is only ever a VERIFIER on generated text
(graded-text-service.ts:404, verify-live-render.ts:108,
envelope-classifier.ts:236). It has never governed the weave. So "the cap applies
at realization, per text, per posture" currently has no implementation anywhere
-- which is exactly why display-text-resolver had to argue that dense
substitution is a feature: the system cannot presently express any other answer.
This story gives the ratio table its second role, as a governor.

DUPLICATE ENFORCER TO FOLD IN: `display-text-resolver.ts:63-65` defines
`isWeaveBand` with a comment saying it "MIRRORS the scripted dialogue split
exactly" -- while `postureForBand` (band-envelope.ts:65-71) already returns
anchored/supported/target-dominant for exactly that input. A copied constant, in
a file that exists *because* an 087.6 review caught this same divergence once
already. Delete `isWeaveBand`; derive from `postureForBand`.

- Exit: fixture item body about travellers/heads/flying + A1 learner + a slate
  containing those lemmas -> substitutions land (integration -- fails against
  today's code); the inverse -> authored English AND a trace saying
  "slate/text disjoint", not "extraction failed" (pin -- the failure mode must be
  legible, which is what cost hours on 2026-07-28); posture ratio governs
  density, so an anchored A1 paragraph does not come back mostly target-language
  (pin -- no implementation exists today); one band-split enforcer, asserted by
  grep (pin).

### 090.4 Teacher judgment: two doors in, a slate out

WHAT THE TEACHER PRODUCES CHANGES. Not a per-turn answer -- a **slate**: what
this learner should be working on in this situation. Stable until the situation
key moves or standing changes materially. 090.8 applies it per text.

THE SLATE MUST NOT BE PRE-TRUNCATED. It is a working set, not a teaching quota.
A slate cut to the top N almost never intersects a specific paragraph, which is
the mechanism behind both the item-description bug and the A1 dialogue bug. The
cap belongs at realization.

TWO DOORS, NOT ELEVEN. `TeacherContext` (contracts/providers.ts:128-146) carries
learner, scene, prescription, npc, recentTurns, lang, calibrationActive,
pendingProvisionalLemmas, probeFloorState, activeQuestEssentialLemmas,
selectionMetadata. Adding `situation` as a twelfth field is the shape the model
forbids. Target: `{ situation, learner, lang, telemetry }`. `scene`, `npc`,
`recentTurns` and `activeQuestEssentialLemmas` fold INTO situation;
`probeFloorState` and `pendingProvisionalLemmas` fold into learner.

QUEST-ESSENTIAL STOPS BEING A CHANNEL. It is currently both a TeacherContext
field (providers.ts:144) and a `prescribe()` input (lexical-prescription.ts:108).
Under the model it is a must-comprehend flag on a Situation concept (090.1), and
its ENFORCEMENT stays where it already is -- `enforceDirectiveRequirements`
(schema-parser.ts:526-590) and the strip in `repairDirective`. Judgment about
relevance is the Teacher's; enforcement of the obligation is a check on the way
out, not an arrow in.

THE BINDING HALF GETS SIMPLER, NOT RELOCATED. Band envelope and out-of-reach
become STANDING facts (090.9), so they never enter the eligible set and need no
post-hoc enforcer against a budgeter output. The three-returns enforcer designed
in round 3 was a correct fix to a machine being deleted; carry over only the
prompt work.

CARRY OVER FROM ROUND 3, still valid: `formatPrescription` (prompt-builder.ts:
322-334) never renders the wider pool; `DIRECTOR_HARD_CONSTRAINTS_PROMPT` (:97-104)
contradicts any widening and is cache-marked; any rendered list needs an explicit
cap constant like its neighbours (:44-48); and a mock-gateway exit cannot falsify
prompt content, so assert the prompt text directly.

- Exit: the Teacher's slate contains the cheese concept for an A1 learner with no
  history, given a situation naming a cheese NPC (integration, mock gateway); the
  slate is NOT truncated to a band cap (pin -- the regression that produces both
  known bugs); TeacherContext has two content doors, asserted structurally (pin);
  a quest-essential lemma reaches the Teacher only via situation, asserted by the
  absence of a separate field (pin); gateway down falls back to
  `FallbackTeacherPolicy` with nothing surfaced to the player (pin --
  `SugarLangTeacher.invoke` catches `TeacherInvocationError` at :100-108 and never
  rethrows, so the 087.6 path is unreachable from here).

### 090.3 Runtime overlay + situation lifecycle

Overlay content unchanged: met/unmet, quest stage, time of day, turns so far.
The round-3 findings all stand -- `evaluateRegionQuestBinding` fails closed on
world flags, and the met/unmet ambiguity is the store-failure path, not the
disabled path.

REFRAMED AS LIFECYCLE. The model's table says when each thing runs; this story
owns making that true:

| Moment | Produces | LLM |
|---|---|---|
| compile | concepts + prose, cached by content hash | yes, per content change |
| scene load | situation overlay | no |
| NPC proximity | optional pre-warm of situation and slate | hidden behind footsteps |
| conversation start / situation change | the slate | yes, once |
| per turn | nothing | **no** |
| per narrative unit | realization | **no** |

TURNS ARE NOT AN INVALIDATION AXIS. `DirectiveCache.get()` expires on
`turnsConsumed >= lifetime.maxTurns` (directive-cache.ts:78-81), default 3
(schema-parser.ts:517), incremented as a side effect of a read (:83-92). Steady
state today is one teacher call every 3-4 turns, and 090.4's old exit ratified
that. Under the model the situation key is the only axis; `maxTurns` becomes a
long safety net or goes. The round-3 "digest-vs-maxTurns precedence" question is
settled by this, not still open.

THE STALENESS TABLE HAS NO IMPLEMENTATION TODAY. `handleBlackboardEvent` calls
`invalidateAll` on any quest/location event, comparing nothing (:139-147), and
`directiveLifetime.invalidateOn` is parsed and normalized
(schema-parser.ts:341-344, :766-774) and read by nothing. Adding a digest is a
redesign of the invalidation model. It is now on the critical path, not a cost win.

MOVE THE OVERLAY TO SCENE LOAD. Round 3 proposed composing at the policy stage to
dodge the `sugarlang.context` / `sugaragent.memory` tie at stage `context`
priority 10. Composing at scene load sidesteps the race entirely and gives
pre-warming somewhere to hang.

- Exit: met/unmet correct on first meeting and on return (integration); a
  quest-stage advance moves the situation key and re-slates within one turn
  (integration); an unchanged situation across five turns produces ZERO teacher
  calls (pin -- the lifecycle claim, and it fails against today's maxTurns
  behaviour); store-failure met/unmet is distinguishable from a real first
  meeting (pin); no sugaragent import in sugarlang (pin).

### 090.9 Standing -- NEW, small, unblocks 090.4

Extract STANDING as a named fact on the learner: for a given lemma,
*unseen · learning · due · known · out-of-reach*. It is implicit today, spread
across the band-envelope filter (lexical-budgeter.ts:157), the reviewCount split
(:177, :181) and the FSRS adapter. 090.4's simplification depends on it existing
as a thing the Teacher can read.

- Exit: standing is derivable for any (learner, lemma) without invoking the
  budgeter (pin); the five values are exhaustive and total (pin).

### 090.5 Learner capacity

Rehomed from "effective cap accounting". This is how LEARNER answers *how many
new items can this person take right now* -- fatigue, session depth,
conversation depth, against the band allowance. Not a budget the Teacher is
handed; a number the Learner reports, applied at realization.

- (a) DEPTH RAMP: per-conversation counter. The round-3 finding stands --
  `conversationState` is `Record<string, unknown>` (lexical-prescription.ts:107),
  so "export a counter on it" is convention, not contract. Type it.
- (c) STRAIN CONSUME: read `schedule.strainSuppressed`; never re-derive from
  `fatigueScore`. NOTE the round-3 correction: suppression fires at
  `fatigueScore >= 0.70` (outer-loop-scheduler.ts:62), and the turn term is only
  `0.30 * (turns/50)` (session-signals.ts:98-101), so turns alone reach it near
  117, not 35. The stale source comment at outer-loop-scheduler.ts:59 still says
  35 and should be fixed here.
- (b) FUNCTION-CHUNK RESERVE: **probably dissolves.** The injection cap is
  `newItemsAllowed - introduce.length` (context-middleware.ts:483-490), zero
  whenever the budgeter fills `introduce` to `levelCap` -- the same
  pre-truncation as the old 090.6. Stop pre-truncating and the starving
  arithmetic goes away. Marked probable rather than certain because function
  teachables come from the scheduler, not the lexicon, so a non-truncated slate
  does not automatically admit them. Decide in-story; do not build the reserve
  before checking whether it still starves.

### 090.6 Stall rotation -- DELETED

Verified dissolution. `introduce` is survivors filtered `reviewCount === 0` then
`.slice(0, levelCap)` (lexical-budgeter.ts:176-179); `reviewCount` increments
only when `receptiveGrade !== null` (fsrs-adapter.ts:173-174) while the
`encountered` observation returns null (observations.ts:91-96). Words stalled
because there were fixed slots to stall in. Remove the pre-truncation and there
are none.

This deletion invalidates the old shippable-floor argument, which justified
including 090.6 on the premise that "the first `levelCap` score winners hold the
introduce slots permanently". That premise is gone. Floor re-derived below.

### 090.7 Visibility

Plumbing unchanged -- the annotation spine (observe writes, reader beside
`readTeachLine`, both presentations render), the HUD state seam, hostKind gating.

RETARGET THE TRACE. Its spec is slate-shaped only. It must show BOTH the slate
and the realization, or the exact bug class this epic exists for stays
invisible: "the slate was right and nothing in this text matched it" and "the
slate was wrong" look identical from the outside, and telling them apart by hand
is what cost hours on 2026-07-28.

- Exit: the trace distinguishes slate from realization; a turn where slate and
  text are disjoint says so explicitly (pin).

## The shippable floor

RE-DERIVED round 4. The old floor (090.1, 090.2, 090.4, 090.5a, 090.6) rested on
a premise the model removes -- that introduce slots are permanently held, so
nothing is visible until they turn over. With no pre-truncation there are no
slots, and 090.6 is deleted.

**Floor = 090.1 + 090.2 + 090.9 + 090.4 + 090.8.**

That is: extract concepts, resolve them to lemmas, give the learner a readable
standing, let the Teacher produce an untruncated slate from situation + learner,
and apply that slate to a specific piece of text.

090.8 is IN the floor and this is the change from every prior revision. Without
it the epic can produce a perfect slate and still render English, which is
precisely the observed 2026-07-28 failure on both item bodies and A1 dialogue.
A floor that cannot show a single Spanish word to a beginner is not a floor.

090.3 (lifecycle), 090.5 (capacity) and 090.7 (visibility) are the ceiling.
Note 090.3 becomes load-bearing sooner than its position suggests: without a
situation key the slate has no staleness rule, so it is the first ceiling story.

## Budgeter deletion order

The model dissolves the budgeter; the plan treated it as the consumer. No story
owned the transition, so it is named here.

The budgeter is four jobs (sourcing, eligibility, ranking, rationing). They leave
in this order:

1. **Eligibility -> LEARNER** (090.9). Standing becomes readable without the
   budgeter.
2. **Ranking -> TEACHER** (090.4). The slate is produced from situation +
   standing, not from `priorityScores`.
3. **Sourcing -> SITUATION** (090.2 + 090.4). Concepts reach the Teacher through
   the situation, not through `lemmas` membership.
4. **Rationing -> LEARNER capacity** (090.5), applied at realization (090.8).

`prescribe()` is then unreferenced and the module is deleted. Until step 2 lands
the old path must keep working, so the side field from 090.2 may need the
read-time projection as a transition scaffold -- decide when 090.4 lands, and
delete it in the same change that deletes `prescribe()`.

DO NOT leave both paths alive past the floor. Two systems answering "what should
be taught" is the condition that produced every bug in this epic.

## Verification recipe (nikki)

Revised round 4: probe 6 dropped with 090.6, and probes for realization and for
call frequency added -- both are things that were untestable before and are the
two properties most likely to regress.

1. `pnpm test` green, `pnpm lint` clean.
2. **Situation probe** -- compile a scene with Horace, Finnick and Pennygale at
   the dock. The Studio panel shows a situation description naming them and a
   concept list including cheese, cargo, travel, greeting.
3. **Finnick probe** -- fresh A1 learner, no history, talk to the cheese NPC.
   `queso` is taught within the first turns, glossed on first use, carded on
   encounter. No Spanish anywhere in his authored content.
4. **Realization probe (NEW)** -- open an item whose Examine body is about
   something the slate covers: target words appear woven into the English. Then
   open one it does not cover: authored English, and the trace says
   "slate/text disjoint". Those two outcomes must be distinguishable without
   reading code.
5. **Density probe (NEW)** -- at A1, a paragraph-length item body comes back
   mostly English with a few target words, not mostly target language. This is
   the posture ratio governing realization, which has no implementation today.
6. **Call-frequency probe (NEW)** -- talk for ten turns without changing scene,
   NPCs, quest stage or time. Telemetry shows exactly ONE teacher call. Today it
   shows three or four, because the directive cache expires on turn count.
7. **Situation-change probe** -- advance the quest stage mid-conversation. One
   new teacher call, and the slate changes.
8. **Restraint probe** -- high-strain session: fewer new items, depth ramp
   clamped.
9. **Offline probe** -- kill the gateway. Conversations still work on the
   deterministic fallback; nothing surfaces to the player.
10. **Trace probe** -- debug HUD on. Every NPC turn shows the trace icon; hover
    reveals the slate, what realization selected from it, and whether the slate
    was LLM-judged or a fallback.

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


## Open at gate exit (epic-review round 4, 2026-07-28, NOT converged)

Round 4 reviewed the plan against
`packages/plugins/src/catalog/sugarlang/docs/api/domain-model-after-epic-090.md`
rather than against the code. Its findings are applied above. The plan is not
Locked; these need decisions first.

Round 4 also settled several of the round-3 questions:

| Round-3 decision | Now |
|---|---|
| 1. Gateway `purpose` for the Teacher | **RESOLVED and shipped.** `PURPOSE_MODELS` (deployment/gateway/core.ts:833-843) routes `teacher` -> `SUGARMAGIC_SUGARLANG_TEACHER_MODEL`, default claude-sonnet-4-6; `DEFAULT_DIRECTOR_MODEL` deleted. Struck. |
| 2. POS enum: union vs per-language | **Still open.** es emits 12, it emits 14 (adds abbreviation, formula). Unaffected by the model. |
| 3. Which introduce cap governs | **Settled by the model.** Both pre-truncation caps (`newItemsAllowed`=3, `getIntroduceLevelCap`=1 at A1) are deleted; capacity is one number the Learner reports, applied at realization. |
| 4. World-flag-gated presences | **Still open, higher stakes.** `evaluateRegionQuestBinding` fails closed without a flag predicate, and Situation is now one of only TWO Teacher inputs -- a wrongly dropped presence has no other channel to compensate. Raised in priority. |
| 5. Is `publishSugarlangArtifacts` alive? | **Verified dead** -- no importer outside its own test. Not a design decision; a deletion. Downgraded. |
| 6. Which "have they met" signal governs | **Still open, sharper.** Whichever wins must compose INTO situation. Note `isProbableFirstMeeting` is derived inside prompt-builder.ts:169-171 from `recentTurns` -- the prompt builder deriving a situation fact is itself a layering violation under the model. |

New decisions the model raises:

**A. Does the budgeter survive this epic, and in what order does it go?**
The deletion order above is a proposal, not a decision. This is the biggest one:
everything else is downstream of whether `prescribe()` still exists at the end.

**B. What bounds the slate?**
The model says "everything relevant and in-reach here" and gives no number.
Against an 11,000-entry atlas that is unbounded, and if "in-reach" collapses to
the band envelope then the slate IS the band pool and realization degenerates to
what `display-text-resolver` already does today. Needs a concrete rule.

**C. Is the realization cap a count or a ratio?**
`newItemsAllowed` is a count; `TARGET_LANGUAGE_RATIO_BY_POSTURE` is a ratio.
They are not interconvertible per text -- six substitutions is dense in one
sentence and sparse in a paragraph. Pick one, or say which governs where.

**D. Do items consult the slate at all?**
`display-text-resolver.ts:107-113` argues the answer may legitimately stay "no"
-- an examined item is a browsing moment with no pacing to protect. The model
asserts realization is uniform across "one line / one item body / one
description". The plan is silent. These three positions cannot all hold.

**E. Non-goals now contradicts the lifecycle.**
"NOT optimizing LLM call frequency" was written when per-call cost was the only
concern. The model makes one-call-per-conversation a structural property, not an
optimization. Reword or drop.
