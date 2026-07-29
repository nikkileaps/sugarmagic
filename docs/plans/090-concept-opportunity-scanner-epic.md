# Plan 090 -- Context Extraction + Teacher Judgment (proposed child epic I of Strategy 002)

Status: DRAFT -- NOT LOCKED. epic-review has run 7 rounds (2026-07-28, -29). Rounds 1-3 audited against the CODE and it held. Round 4 audited against the DOMAIN MODEL and it did not. Rounds 5-7 each audited the PREVIOUS round's new text and each found real defects in it -- that is the standing pattern and it has not damped yet. Round 5: the Teacher LLM is already off the live path for every learner with one lemma card (sugar-lang-teacher-middleware.ts:333). Round 6: the weave has no English lemmatization, so 090.8's exit fixture could never have passed; and "unify the band+1 predicates" would have caused a regression. Round 7: 090.8's rewritten exit PASSED TODAY (the item path already draws the whole band, display-text-resolver.ts:247-249); the two genuinely unowned authorities are sugar-lang-scripted-middleware.ts:251-257 and :426-431, not the live-render local round 6 named; and item bodies are NOT among the broken surfaces. All applied.

Round 7 WRAP, and it is the finding no review round produced: the demolition itself was never a story. `prescribe()`'s deletion lived in a prose section with no exit line and landed in ceiling 090.5, so the floor would have shipped with the budgeter and the slate both authoritative -- the exact condition this epic exists to remove. **090.10 Delete the prescriber** is new, is in the floor, and has grep exits. The gate was auditing claims about code; the gap was a missing acceptance line, which is a different class of defect and argues the rounds had stopped paying for themselves.

Not locked. The ARCHITECTURE is stable -- seven rounds, four reviewers, zero challenges to situation -> slate -> realization or to standing-vs-action. What kept churning was the demolition inventory and the prose. 090.1 and 090.2 are untouched by every finding in rounds 5-7 and can be built now; 090.3 / 090.4 / 090.8 / 090.10 scope is explicitly provisional and will be finished by opening the files.

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
| **runtime** | teacher middleware runs but SHORT-CIRCUITS: band -> posture/ratio inline, `teacher.invoke()` is never called (sugar-lang-teacher-middleware.ts:226) | teacher middleware runs and invokes the Teacher **only on a cold-start learner** -- see below. **THIS CELL IS THE EPIC'S TARGET** |

**THE TEACHER LLM IS ALREADY OFF THE LIVE PATH, AND NO EARLIER ROUND CAUGHT IT.**
Round 5 finding, verified at the producing line. `sugar-lang-teacher-middleware.ts:333`
reads `} else if (schedule && !schedule.isColdStart) {` and builds the directive
deterministically from `prescription.introduce` (:356-361), never reaching
`services.teacher.invoke` (:402). And `isColdStart` is false as soon as the
learner has **one** lemma card or one introduced function
(outer-loop-scheduler.ts:101-103).

So in steady state -- every learner past their first taught word -- the Teacher
LLM does not run at all, for scripted OR agentified NPCs. The prescription IS
the directive. That is not a tuning detail; it is the reason the teaching feels
generic, and it means **090.4's exit is unreachable until this branch is dealt
with**. 090.4 now owns that decision explicitly.

An earlier draft of this row asserted the agentified cell "invokes the Teacher".
That was OVERSTATED and it propagated: probe 6 was baselined against it.

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

Execution order: **090.1, 090.2, 090.9, 090.3, 090.8, 090.4, 090.10, 090.5, 090.7.**
Revised round 5: 090.3 moves ahead of 090.8 because the slate needs a
situation-keyed home before realization can read it, and 090.8 stays ahead of
090.4 because its prompt cap must exist before 090.4 de-truncates the slate.
Round 7 wrap: 090.10 (delete the prescriber) is NEW and sits immediately after
090.4 -- it is the closing edge of the deletion order, and putting it any later
means the floor ships with two authorities alive.

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

DO NOT WIDEN `resolveFromGloss` TO GET THE SECONDARY GLOSSES. Round 5 finding.
The primary-gloss-only restriction is a deliberate, documented guard
(cefr-lex-atlas-provider.ts:148-153):

> "Only index the PRIMARY (first) gloss word for reverse lookup. Secondary
> glosses after the comma are for tooltip display, not for compiling English
> authored content to target-language lemmas. This prevents 'claim' -> afirmar
> when afirmar's gloss is 'affirm, claim'."

`resolveFromGloss` is shared by the compile scrub
(`compile-sugarlang-scene.ts:302`) and the weave (`diglot-weave.ts:72`), so
widening it silently changes both. Concept resolution is a SEPARATE pass over
atlas entries with its own index; the guard on the shared reverse lookup stays.
Pin it: `claim -> afirmar` must still be absent from the scrub after this story.

DELIVERY IS NO LONGER THIS STORY'S JOB. The old text called projection into
`sceneLexicon.lemmas` "the single link the whole epic exists to build". It is
not, and round 4 falsified it:

- Every reader of `sceneLexicon.lemmas` was enumerated. The budgeter's candidate
  sourcing (lexical-budgeter.ts:130) is the only one that needs membership;
  the rest are the scheduler board (context-middleware.ts:400), the prompt's
  capped scene snapshot (prompt-builder.ts:247), a `cefrPriorBand` lookup (:354), two
  Studio read-only surfaces (ui/shell/scene-density-histogram.tsx:90,
  ui/shell/editor-support.ts:188,194 -- missed by the round-4 enumeration, found
  round 5; they will under-report if concepts live only in a side field, which
  090.7 must account for) and debug
  logs. **Nothing downstream of the Directive requires it** -- `applyWeave`
  reads `constraint.targetVocab.introduce`, and the observe middleware gates on
  `targetLemmaSet` union existing cards (sugar-lang-observe-middleware.ts:450-454).
- So a Teacher handed `queso` via the Situation, naming it in `targetVocab`,
  reaches both the weave and the observe loop with no projection at all.
- The blocker is one prompt line:
  `"Only output targetVocab lemmas that already appear in the prescription."`
  (prompt-builder.ts:99). That sentence, not a missing projection, is what stops
  the motivating case **on the validated path**. Round 5 correction: calling it
  "the actual blocker" was OVERSTATED, because the REPAIRED path
  (`llm-teacher-policy.ts:267`) enforces the same membership in code --
  `repairDirective` filters against `getPrescriptionSet(...)` and defaults back
  to the prescription's own lists (schema-parser.ts:658-672, :695-698). Both must
  go; 090.4 owns the second.

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

REALIZATION IS STRATEGY-DEPENDENT. This is the correction that matters most in
this story, and an earlier draft of it got this wrong by assuming one shape.

The Teacher sets POSTURE. Posture selects a RENDERER. The two renderers realize
a slate in fundamentally different ways:

| Posture / surface | Renderer | How the slate is realized | Is "what got taught" knowable in advance? |
|---|---|---|---|
| anchored (A1), supported (A2), any authored text | `diglotWeave` | INTERSECTION -- you can only teach words physically present in the authored English, so selecting and substituting are one operation | **Yes.** Deterministic, before rendering. |
| target-dominant (B1+), authored ITEM text | baked variant cache read | PRE-RENDERED at compile, keyed `{lang, band, contentHash, promptVersion}` -- **no learner in the key, so the slate does not reach it** | Only by classifying the output. |
| target-dominant (B1+), authored DIALOGUE line, due teachable in the line's intent facts | **087.5 live render** -- runtime LLM | the schedule decides whether to SPEND the call and what the verifier will tolerate; it does not shape the text | Only by classifying the output. |
| **any band, AGENT-GENERATED turn** | sugaragent, via the generator prompt overlay | PROMPT-SHAPING -- there is no authored text to intersect and no baked variant to read; the slate becomes instructions | **No.** Only knowable AFTER. |

THE THIRD ROW IS THE EPIC'S OWN TARGET CELL AND AN EARLIER DRAFT OMITTED IT.
Round 5 finding. `diglotWeave` is gated on scripted mode
(`sugar-lang-scripted-middleware.ts:189` -> `shared.ts:132`), and
`GradedTextService` has no agent-turn call site. An agent turn is realized in
exactly one place: `constraint.generatorPromptOverlay`
(`sugar-lang-teacher-middleware.ts:521`), built by `buildGeneratorPromptOverlay`.
Finnick is an agent NPC, so the motivating case of this entire epic is realized
by row three and only row three.

**That line is currently UNCAPPED.** `generator-prompt-overlay.ts:54` emits every
lemma in `targetVocab.introduce` while its immediate neighbour caps
(`avoid.slice(0, 12)`, :55). Today the pre-truncation to 3 is what keeps it sane.
090.4 removes that truncation. **Therefore the prompt-shaping cap must land in
the same change that removes the pre-truncation, or the floor makes the
agentified cell strictly worse** -- an untruncated slate straight into a prompt.
This is the one hard ordering constraint in the epic.

ROW FOUR SPENDS AN UNBUDGETED PER-LINE LLM CALL. `sugar-lang-scripted-middleware.ts:295-393`
fires when `nodeId && schedule && !schedule.strainSuppressed && services.intentCache`
and a due teachable matches the line's intent facts (:304-309), then calls
`services.llmClient.generate` at `:343` on a cache miss.

CORRECTION (round 7): a round-6 draft said `:309` "overwrites the introduce set"
and that "the renderer decides what gets taught". **Both were OVERSTATED and are
struck.** `liveRenderIntroduce` is a LOCAL (`:293 let liveRenderIntroduce =
constraint.targetVocab.introduce`), never written back -- the only writers of
`constraint.targetVocab` in that file are `:159`, `:252` and `:427` -- and
`introduce` appears nowhere in the render prompt (`:345-357`). Its real effects
are three: trigger the path, key the live-render cache, and supply the envelope
exemption to `verifyLiveRender` (`:366`). That is the same "asserted from the
shape of the design rather than the producing line" error this gate keeps
catching, and I made it while writing the fix for it.

The deletion recommendation survives on the LLM call alone; the authority
argument does not.

**THE REAL UNOWNED AUTHORITIES ARE TWO LINES ROUND 6 WALKED PAST**, both writing
`constraint.targetVocab` from the intent artifact's `mustConveyFacts`, which is
an **uncapped `string[]`** (compile/extract-intent.ts:51) gated only by an
atlas-existence check:

| Line | Path | What it does |
|---|---|---|
| `:251-257` | **anchored/supported -- THE FLOOR CELL** | APPENDS validated facts to `introduce`. No slate, no standing, no band envelope, no cap. |
| `:426-431` | target-dominant baked variant | REPLACES `introduce` wholesale. |

`:251-257` is the more serious: it is on the A1/A2 path this epic calls its
floor, and it is the LAST writer before observe. `buildTargetLemmaSet`
(sugar-lang-observe-middleware.ts:87-93) is built from `introduce` union
`reinforce` and gates card creation at `:450-455` -- so this block decides which
lemmas the learner gets CARDS for.

Two consequences: 090.4 owns both lines (same decision as the 087.6 branch), and
**090.8's cap must be enforced at the LAST writer of `constraint.targetVocab`,
not the first.** Capping the Teacher's output alone does not bound what reaches
observe.

DO NOT ADD A *NEW* LLM CALL TO THE REALIZATION PATH. `GradedTextService.adapt` is
two gateway calls (generate at graded-text-service.ts:317, fidelity judge at
:457) and its only call sites today are authoring-side
(`ui/shell/editor-support.ts`, `compile/generate-variant.ts`). Keep it there.

The model budgets **zero** LLM per rendered line or item
(domain-model-after-epic-090.md:210). **That invariant is already false today**
-- row four is a live per-line call. An earlier draft asserted it as an untouched
property; it is a property this epic must either restore (delete row four) or
consciously except (keep it, and amend the model). Say which. Recommend deleting
row four: it is the only thing standing between this epic and a true zero-LLM
realization layer, and it is **production-reachable but never tested** -- 087
turned it on (087:21, :113) and its own outstanding list records that "no test
ever FIRES the live-render trigger" (087:143). A round-6 draft read that as
"unfired path", which is backwards and made deletion sound safer than it is:
deleting it is a behavior change to a live path, just an untested one.

The honest consequence for row two, stated plainly because an earlier draft
asserted both halves at once: **the slate does not shape B1+ authored item
text.** The variant was baked without a learner. Classification-after-the-fact is
the only slate-relevant output there is. Do not "fix" this by calling `adapt` at
runtime.

THE WEAVE HAS NO ENGLISH-SIDE LEMMATIZATION, AND THE OLD EXIT FIXTURE COULD NOT
HAVE PASSED. Round 6 finding; I re-measured it directly against the shipped
`data/languages/es/cefrlex.json` primary-gloss index:

| English surface in the fixture | resolves to |
|---|---|
| `traveler` | viajero (A1) |
| `traveller`, `travellers`, `travelers` | **nothing** |
| `head` | cabeza (A1) |
| `heads` | **nothing** |
| `fly` | volar (A1) |
| `flying` | volador (**A2** -- outside an A1 pool) |
| `cheese` | queso (A1) |
| `cheeses` | **nothing** |

`diglotWeave` resolves each raw token through `atlas.resolveFromGloss`
(diglot-weave.ts:72), which is an exact lowercased lookup
(cefr-lex-atlas-provider.ts:210) over a tokenizer that only lowercases
(tokenize.ts:77). So the previous exit -- "fixture item body about
travellers/heads/flying ... substitutions land" -- **fails for a reason no change
to the POOL can fix**, and would have been debugged as a slate bug. Exactly the
class of confusion this story exists to remove.

This is the same mechanism as line 27's "'cheesemonger' and 'cheeses' both miss
'cheese'", which the plan had filed only against the compile scrub. It bites the
weave identically, and no story owned it.

Decision: **English-side normalization is OUT of 090.8's scope** -- it is a
separate concern (an English lemmatizer or a widened gloss index) with its own
risk surface, and folding it in would make the floor's most valuable story
unbounded. Instead: the fixture uses BASE FORMS, and the gap goes to Deferred
with a trigger. The floor still shows a beginner Spanish words; it shows them for
base-form English only.

Consequences the story must honour:

- There is no single "realize" that fits all three. The weave path answers the
  question up front; the other two answer it by observation. Model them as
  strategies behind one seam, not one function with a branch. The discriminated
  union in `graded-text-source.ts:26-52` already argues this exact design and
  gives the property that pays for it here: adding a kind is a compile error at
  every consumer. Cite that file; do not re-derive the pattern.
- **The A1/A2 path is where the epic's bug lives** and where the deterministic
  intersection belongs. That is the floor.
- For target-dominant, "what got taught" is a CLASSIFICATION of generated text.
  Machinery for this already exists -- `computeCoverage` + the classifier facade
  -- and the observe middleware already tokenizes every turn. Do not build a
  second one.
- The per-text CAP therefore means different things per strategy: a substitution
  count on the weave path, a ratio target in the prompt on the generated path.
  This is open decision C, and it is now clearly two answers rather than a
  choice between two.

THE WEAVER IS A RENDERER, NOT A DECIDER. `diglotWeave` makes no judgment -- it
tokenizes, resolves through the atlas, and substitutes what it is handed. It
belongs to *the model RENDERS*, not *the Teacher decides*, and it should not be
folded into the Teacher: that would pull tokenization and citation forms into a
decision boundary.

But it currently makes two decisions that are not its to make, and this story
takes both away:

1. **The pool** -- unowned, so each call site improvised. Fixed below.
2. **The strategy choice** -- `isWeaveBand` (display-text-resolver.ts:63-65)
   duplicates `postureForBand` (band-envelope.ts:65-71), so the renderer picks
   its own strategy instead of reading the posture the Teacher set. The Teacher
   decides posture; the renderer obeys it.

Strip those two and what remains is a pure substitution function that cannot
decide anything. That is the correct shape.

---

Two divergent implementations of the pool question are already in the codebase:

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

- A `realize(slate, standing, text, posture)` seam with TWO strategies behind
  it, selected by posture -- substitution for anchored/supported, generation for
  target-dominant. Not one function with a branch.
- **The substitution strategy is the floor.** Pure, zero LLM, per narrative
  unit, total in the same sense as `createDisplayTextResolver` -- absent inputs
  yield authored text, never a throw. It owns the POOL (slate ∩ text) and the
  per-text substitution count.
- **The prompt-shaping strategy caps `constraint.targetVocab` ITSELF -- both
  `introduce` AND `reinforce` -- not the overlay string.** In the floor, and in
  the same change as 090.4's de-truncation. Round 6 correction: round 5 named one
  of FOUR uncapped renderings of the slate, and not the one that reaches the
  player. Capping at the constraint covers all four at once, which is why it is
  the right seam:

  | Rendering | Line | Today |
  |---|---|---|
  | agent prompt, introduce | generator-prompt-overlay.ts:54 | uncapped |
  | agent prompt, reinforce | generator-prompt-overlay.ts:53 | uncapped (budgeter caps at 4 today, lexical-budgeter.ts:180-183) |
  | repair prompt, both | sugar-lang-verify-middleware.ts:161-165 | uncapped |
  | **`dialogueHighlight` focusTerms + glosses** | sugar-lang-observe-middleware.ts:913-924 | uncapped, and **PLAYER-VISIBLE** |

  The last one is player-visible, but NOT in the way a round-6 draft claimed.
  Corrected round 7: there is no "40-term highlight bar", and glosses attach only
  to terms actually found in the turn (`findTermMatches`,
  runtime-core/src/dialogue/highlight.ts:76-125; turn-text.ts:41-45). The real
  risk is FALSE highlights: the matcher is a case-insensitive `\b<term>\w{0,4}\b`
  at `MIN_TERM_LENGTH = 3` (highlight.ts:86-97), so a 40-term slate in a mixed
  English/Spanish turn lights up English words -- `come` matches "comes", `pan`
  matches "panel". The cap and the exit pin stand; the reason is different.

  ALSO CORRECTED: a round-6 draft said the scripted path is "protected by
  accident" because `applyWeave` narrows `introduce` to the woven forms
  (scripted-middleware.ts:159-163, priority 15, before observe at 90 -- the
  priorities are right, `runtime-core/src/conversation/index.ts:312-322` sorts
  stage-then-ascending). **That protection is WRONG.** The narrowing is
  conditional on a substitution having landed (`:149 if
  (weaveResult.weavedForms.length > 0)`), and zero woven forms is the common A1
  case today. Worse, `:251-257` then APPENDS uncapped intent facts in the same
  branch, after the narrowing. There is no accidental protection.

  The design hint survives both corrections and is the real conclusion:
  **realization output, not the slate, is what should feed the highlight.** That
  makes observe (:905-935) a READER of realization rather than a second matcher,
  which also settles a latent disagreement -- `findTermMatches` is a fuzzy regex
  over target forms while `diglotWeave` is an exact lookup over English glosses,
  so the two will not agree about "which slate terms are in this text".

  Reports what got taught by CLASSIFYING the turn, reusing `computeCoverage` and
  the observe middleware's existing tokenization. `compile/verify-live-render.ts`
  (:89, :108) already composes `computeCoverage` + the envelope predicate +
  `computeLanguageRatioVerdict` for a runtime-generated line -- that is the
  existing composition to reuse, not the loose parts.
- The cache-read strategy is unchanged behaviour, named here only so the seam is
  total. It classifies its output; it does not consult the slate.
- **The slate needs a home that is not a conversation.** `DirectiveCache` is keyed
  on `conversationId` (`sugar-lang-teacher.ts:60`, `directive-cache.ts:70`) and
  item views deliberately run before any conversation exists
  (`runtime-services.ts:392-402`). This story's own exit and probe 4 are both item
  bodies, so without this they cannot pass. Key the slate on the SITUATION, and
  state the key in the exit. Round 5 finding -- the floor as previously written
  could not satisfy its own acceptance test.
- **Posture on the item path comes from the BAND, not the Directive.** Round 6
  caught a contradiction round 5 introduced: the bullet above says the slate
  cannot live on a conversation, while an earlier bullet said "posture comes from
  the Directive" -- and the Directive is conversation-scoped
  (`directive-cache.ts:70`), with `DisplayTextResolverDeps`
  (`display-text-resolver.ts:132-144`) deliberately carrying no directive at all.
  Both cannot hold. Resolution: posture is `postureForBand(band)` everywhere, and
  deleting `isWeaveBand` is a **de-duplication, not a re-homing**. The Teacher
  does not decide posture today and this story does not make it start; the claim
  that it does was wrong and is struck. What the Teacher decides is the SLATE.
- The situation-keyed artifact carries the slate. It does not need to carry
  posture, because posture is a pure function of band.
- Consume `GradedTextUnit` (grading/graded-text-source.ts). The repo already has
  the narrative-unit abstraction with a documented Strategy + discriminated-union
  design. Do not invent a second notion of "a piece of text".
- Wrap `diglotWeave`; do not rewrite it. It is a renderer and it stays one.

THE CAP HAS NO HOME TODAY, AND THAT IS THE REAL GAP.
`TARGET_LANGUAGE_RATIO_BY_POSTURE` exists (teacher/band-envelope.ts:36-41) but
`computeLanguageRatioVerdict` is only ever a VERIFIER on generated text
(graded-text-service.ts:404, verify-live-render.ts:108,
envelope-classifier.ts:236). It has never governed the weave. So "the cap applies
at realization, per text, per posture" currently has no implementation anywhere
-- which is exactly why display-text-resolver had to argue that dense
substitution is a feature: the system cannot presently express any other answer.
This story gives the ratio table its second role, as a governor.

THREE DUPLICATE ENFORCERS TO FOLD IN -- not two. An earlier draft named only the
first. Round 5 found the third, and it DIVERGES:

| Where | Band split | Ratio table |
|---|---|---|
| `band-envelope.ts:65-71` / `:36-41` | `postureForBand` -- the source of truth | 0.3 / 0.65 / 0.85 |
| `display-text-resolver.ts:63-65` | `isWeaveBand`, copied | (none) |
| `sugar-lang-teacher-middleware.ts:229-232` | inlined ternary | **:233-236 -- 0.2 / 0.5 / 0.8** |

WHERE THE DIVERGENCE ACTUALLY BITES -- corrected round 6. An earlier draft said
"an A1 scripted line is rendered at 0.2 while everything else says 0.3." That was
OVERSTATED, and I asserted it from the table rather than from the readers:

- **At anchored/supported (A1/A2) it is currently INERT.** `applyWeave`
  (scripted-middleware.ts:123-173) never reads `targetLanguageRatio`; the scripted
  branch returns at teacher-middleware.ts:259-267, before
  `buildGeneratorPromptOverlay`; and verify skips scripted mode
  (verify-middleware.ts:256-258). Nothing consumes 0.2.
- **At target-dominant it is LIVE:** `verifyLiveRender` gets
  `directedRatio: constraint.targetLanguageRatio` (scripted-middleware.ts:365), so
  B1+ live renders are judged at 0.8 against a repo that says 0.85.
- **At A1 it goes live the moment THIS STORY LANDS**, because making the ratio
  govern realization is precisely what 090.8 does. The constant is inert only
  because the thing it should govern does not exist yet.

That last point is the reason to fold it here rather than defer it again: 090.8
converts a dormant duplicate into a load-bearing one.

`band-envelope.ts:30-34` is the deferred-trigger comment that scheduled exactly
this cleanup -- "revisit when scripted rendering next changes, and delete its
inline table then." **090.8 is that change.**

The comment names the WRONG FILE (it says `sugar-lang-scripted-middleware.ts`;
the table is in `sugar-lang-teacher-middleware.ts:233-236`). The SAME wrong
attribution is in plan 087 at docs/plans/087-teacher-outer-loop-epic.md:151. Fix
both pointers, or the next reader greps the wrong file twice.

Probe 5 is blocked by something simpler than the divergence: nothing has ever
governed the weave. An earlier draft claimed the two ratios blocked it; at A1
neither is read, so that rationale is struck.

- Exit: **the slate must DISCRIMINATE, not merely substitute.** Fixture item body
  containing `cheese` and `traveler` (both A1 in the shipped atlas) + an A1
  learner + a slate of `{queso}` ONLY -> `cheese` substitutes AND `traveler`
  does **not**. Round 7 correction, and this is the second time this one exit has
  been wrong: the round-6 version ("base forms -> substitutions land, fails
  against today's code") **PASSES TODAY**. The item path draws its pool from
  `bandsUpTo(band)` -- the entire 3217-lemma A1 band
  (display-text-resolver.ts:247-249) -- so every base form substitutes already,
  with no slate involved. A pin that passes before the work is done falsifies
  nothing, which is exactly the defect round 6 caught round 5 committing. The
  discriminating form fails today, because today nothing can exclude `traveler`.
  Fixture injects the constraint, since nothing produces an untruncated slate
  until 090.4.
- Pin `fly -> volar`, not `mosca`: `fly` resolves to two entries (volar A1,
  mosca B1) and `resolveSubstitution` takes the first whose lemmaId is in the
  pool (diglot-weave.ts:105-115). Narrowing the pool changes which one wins,
  so this is a real regression surface.
- **The slate is fetched by SITUATION key, with no conversation in scope** (pin --
  the item surface has no conversation).
- Slate/text disjoint -> authored English AND a trace saying so, not "extraction
  failed" (pin -- the failure mode must be legible, which is what cost hours on
  2026-07-28).
- Posture ratio governs density: an anchored A1 paragraph does not come back
  mostly target-language (pin -- no implementation exists today).
- ONE band split AND ONE ratio table, asserted by grep for `isWeaveBand` and for
  a second `0.2`/`0.5`/`0.8` triple, both returning nothing (pin).
- **An agent turn with a 40-item slate produces a capped overlay line AND a
  capped `dialogueHighlight`** (integration -- fails today at
  generator-prompt-overlay.ts:53-54 and observe-middleware.ts:913-924; the
  highlight is the player-visible half and the one an earlier draft missed).
- The SAME item body at A1 and at B1 takes different strategies and both report
  what they taught, in the same trace shape (pin -- the strategy seam).
- Inflected English (`cheeses`, `heads`) is NOT expected to substitute, asserted
  explicitly (pin -- so the deferred gap is recorded as a known limit rather than
  rediscovered as a bug).

### 090.4 Teacher judgment: two doors in, a slate out

WHAT THE TEACHER PRODUCES CHANGES. Not a per-turn answer -- a **slate**: what
this learner should be working on in this situation. Stable until the situation
key moves or standing changes materially. 090.8 applies it per text.

FIRST, PUT THE TEACHER BACK ON THE PATH. This story cannot be verified at all
until the 087.6 schedule-driven branch is resolved, because that branch bypasses
`services.teacher.invoke` for every learner with one lemma card
(`sugar-lang-teacher-middleware.ts:333`, `outer-loop-scheduler.ts:101-103` -- see
the grid section). Two options, and 090.4 must pick one and say so:

- **Delete the branch.** The directive comes from the slate, and the outer loop's
  pacing arrives as LEARNER capacity (090.5) instead of as a competing directive
  builder. This is the model-aligned answer.
- **Gate it on slate absence** as a fail-soft, the way the pre-placement bypass
  above it is gated.

THE SAME DECISION COVERS 087.5's LIVE RENDER. `sugar-lang-scripted-middleware.ts:304-309`
sets `liveRenderIntroduce` from `schedule.teachables` filtered to
`teachReason === "due"`, overwriting the introduce set at render time. It is the
same mechanism as the 087.6 branch -- the scheduler reaching past the Teacher --
and it does not touch the prescription, so no budgeter deletion reaches it.
Decide both together or the epic ships with one authority deleted and its twin
alive. Round 6 finding.

What it must NOT do is stay as-is, because as-is it is a second system answering
"what should be taught" -- the exact condition the epic's closing invariant
forbids. Recommend deletion; the branch exists only because the Teacher was
expensive per turn, and the slate makes it once per situation.

THE SLATE MUST NOT BE PRE-TRUNCATED. It is a working set, not a teaching quota.
A slate cut to the top N almost never intersects a specific paragraph, which is
the mechanism behind both the item-description bug and the A1 dialogue bug. The
cap belongs at realization.

**ORDERING CONSTRAINT, HARD.** De-truncating here is only safe once 090.8's
prompt-shaping cap exists, because `generator-prompt-overlay.ts:54` renders
`targetVocab.introduce` uncapped into the agent prompt. Ship the cap first or in
the same change. Round 5 finding.

TWO DOORS, NOT ELEVEN. `TeacherContext` (contracts/providers.ts:128-146) carries
learner, scene, prescription, npc, recentTurns, lang, calibrationActive,
pendingProvisionalLemmas, probeFloorState, activeQuestEssentialLemmas,
selectionMetadata. Adding `situation` as a twelfth field is the shape the model
forbids. Target: `{ situation, learner, lang, telemetry }` plus two permitted
NON-CONTENT fields -- `conversationId` (the cache key, `directive-cache.ts:70`)
and `calibrationActive` (read at `llm-teacher-policy.ts:157` and
`fallback-teacher-policy.ts:68`). Naming them keeps the structural pin from
failing for the wrong reason. `scene`, `npc`, `recentTurns` and
`activeQuestEssentialLemmas` fold INTO situation; `probeFloorState` and
`pendingProvisionalLemmas` fold into learner. `selectionMetadata` (providers.ts:144)
is the thirteenth field and it is READ -- `prompt-builder.ts:300-301` stringifies
it into `formatGameMoment` -- so name its fate too: fold into situation, or delete
that prompt use. Round 7 finding; the same paragraph that says "naming them keeps
the structural pin from failing for the wrong reason" had itself left one
unnamed. (`situation` would therefore be the fourteenth field, not the twelfth.)

THE FALLBACK POLICY NEEDS REWRITING, NOT JUST REWIRING.
`FallbackTeacherPolicy.decide` is built entirely from `context.prescription`
(fallback-teacher-policy.ts:124-127, :145-146). Removing `prescription` from
`TeacherContext` breaks it, and its exit below depends on it working. Re-source
it from situation + standing in this story.

`repairDirective` IS A SECOND PRESCRIPTION-MEMBERSHIP ENFORCER. It filters
`targetVocab` against `getPrescriptionSet(...)` (schema-parser.ts:658-672) and
DEFAULTS to the prescription's own lists when the filter empties (:695-698). So
the round-3 claim carried into 090.2 -- "the actual blocker is one prompt line" --
is **OVERSTATED**: true on the validated path, false on the repaired path
(`llm-teacher-policy.ts:267`). Widening the pool without touching this function
means any directive that needs repair silently snaps back to the old pool.

QUEST-ESSENTIAL STOPS BEING A CHANNEL. It is currently both a TeacherContext
field (providers.ts:143) and a `prescribe()` input (lexical-prescription.ts:108).
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
321-337) never renders the wider pool; `DIRECTOR_HARD_CONSTRAINTS_PROMPT` (:97-104)
contradicts any widening and is cache-marked; any rendered list needs an explicit
cap constant like its neighbours (:44-48); and a mock-gateway exit cannot falsify
prompt content, so assert the prompt text directly.

- Exit: the Teacher's slate contains the cheese concept for an A1 learner with no
  history, given a situation naming a cheese NPC (integration, mock gateway);
  **the same holds for a learner WITH lemma-card history** (integration -- fails
  today, the schedule branch bypasses the Teacher entirely; this is the pin that
  proves the 087.6 branch was actually resolved); the slate is NOT truncated to a
  band cap (pin -- the regression that produces both known bugs); TeacherContext
  has two content doors plus the two named non-content fields, asserted
  structurally (pin); a repaired directive does not snap back to a prescription
  pool (pin -- schema-parser.ts:695-698);
  a quest-essential lemma reaches the Teacher only via situation, asserted by the
  absence of a separate field (pin); gateway down falls back to
  `FallbackTeacherPolicy` with nothing surfaced to the player (pin --
  `SugarLangTeacher.invoke` catches `TeacherInvocationError` at :100-108 and never
  rethrows, so the 087.6 path is unreachable from here).

### 090.10 Delete the prescriber -- NEW (round 7 wrap), IN THE FLOOR

**Why this is a story and not a cleanup.** Every prior revision described the
demolition in the "Budgeter deletion order" prose below and assigned its pieces
to other stories' tables. Nothing owned the deletion itself, so no exit anywhere
asserted that `prescribe()` was gone -- and the deletion landed with 090.5, which
is ceiling. That meant the FLOOR shipped with the budgeter and the slate both
authoritative, which the epic's own closing invariant forbids. Seven review
rounds did not catch this, because they were auditing claims about code and this
gap was a missing acceptance line. It is now a story with falsifiable exits.

THE PRESCRIPTION IS NOT AN INPUT TO THE TEACHER. IT IS THE DECIDER.
State it plainly here because it is the thing that makes this story load-bearing
rather than tidy-up. Four mechanisms keep the Teacher from overriding it:

1. Steady state, the Teacher does not run at all -- `teacher-middleware.ts:333`
   copies `prescription.introduce/reinforce/avoid` into the directive.
2. Scripted mode, likewise -- `:246-248`.
3. Cold start, when the Teacher DOES run, it is fenced by
   `DIRECTOR_HARD_CONSTRAINTS_PROMPT` (prompt-builder.ts:99-101): *"Only output
   targetVocab lemmas that already appear in the prescription. Never invent new
   target vocabulary. Your targetVocab.introduce output should contain only 1-2
   items from the prescription."*
4. If the output needs repair it snaps back -- `repairDirective` filters against
   the prescription set and defaults to it (schema-parser.ts:658-672, :695-698).

So the Teacher's entire freedom today is picking 1-2 items from the 3 a lexical
scan already chose. **That chain is the motivating bug, end to end:** Finnick is
an agent NPC, so his lines do not exist at compile time; the scrub needs the
literal English word to map "cheese" -> `queso`; it is not in authored text; so
`queso` never enters `sceneLexicon.lemmas` (the sole candidate source,
lexical-budgeter.ts:130), never enters the prescription -- and constraint 1 above
then FORBIDS the Teacher from naming it. The Teacher did not fail to think of
cheese. It was structurally prohibited from saying it.

DELETING `prescribe()` IS THE EASY HALF. The fence and the repair default must go
in the SAME change, or the Teacher gets a real slate and is still instructed not
to use it -- a state strictly worse than today, because it looks fixed.

SCOPE -- this story is the closing edge of the deletion order below, and it runs
only after every owner named there has landed:

- Delete `prescribe()` and `LexicalBudgeter`; remove the call at
  `sugar-lang-context-middleware.ts:449`.
- Strip the fence: the three prescription sentences in
  `DIRECTOR_HARD_CONSTRAINTS_PROMPT` (prompt-builder.ts:99-101). Note the prompt
  is cache-marked, so the directive cache must be invalidated on prompt version
  change or cold-start learners read stale directives.
- Remove `rawPrescription` from `SugarlangConstraint`; the envelope exemption
  reads `directive.targetVocab.introduce` (job 5 in the deletion order).
- Delete the two remaining pre-truncation caps -- `getLevelCap`
  (lexical-budgeter.ts:48-61) and `getIntroduceLevelCap`
  (fallback-teacher-policy.ts:33-45) -- with the module.
- Delete the transition scaffold from 090.2 (the read-time projection) in this
  same change, per the deletion order's own instruction.

- Exit (all greps, all falsifiable, all fail today):
  - `prescribe(` returns no hits outside git history (pin).
  - `DIRECTOR_HARD_CONSTRAINTS_PROMPT` contains neither "already appear in the
    prescription" nor "items from the prescription", asserted against the prompt
    STRING, not through a mock gateway -- a mock cannot falsify prompt content
    (pin, carried from round 3).
  - `rawPrescription` returns no hits (pin).
  - `constraint.targetVocab` has exactly ONE writer in
    `sugar-lang-scripted-middleware.ts`, down from three (pin -- :159 survives,
    :251-257 and :426-431 are resolved by 090.4).
  - A cold-start A1 learner in a situation naming a cheese NPC gets `queso` in
    the directive, with no authored English "cheese" anywhere in the scene
    (integration -- the motivating case, and the single test that proves the
    whole chain above is broken rather than merely rerouted).

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

090.3 OWNS THE SITUATION-KEYED SLATE STORE. Round 7 finding: 090.8 specifies the
key and 090.4 produces the slate, but no story owned the store, so 090.3's pin
landed two stories before any producer existed. 090.3 builds it, and **absent
slate is a legal state** -- its pin is that the read path returns "no slate"
LEGIBLY with no conversation in scope, not that the slate has content. Content is
090.4's pin.

MOVE THE OVERLAY TO SCENE LOAD. Round 3 proposed composing at the policy stage to
dodge the `sugarlang.context` / `sugaragent.memory` tie at stage `context`
priority 10. Composing at scene load sidesteps the race entirely and gives
pre-warming somewhere to hang.

- Exit: met/unmet correct on first meeting and on return (integration); a
  quest-stage advance moves the situation key and re-slates within one turn
  (integration); an unchanged situation across five turns produces **exactly ONE
  teacher call, on a learner WITH lemma-card history** (pin -- the lifecycle
  claim. Round 6 correction: the old exit said ZERO, which for any non-cold-start
  learner passes TODAY for the wrong reason, because the 087.6 branch never
  reaches `teacher.invoke` at all. A pin that passes before the work is done
  falsifies nothing); the slate is keyed on the situation, readable with no
  conversation in scope (pin -- 090.8 depends on it); store-failure met/unmet is
  distinguishable from a real first
  meeting (pin); no sugaragent import in sugarlang (pin).

### 090.9 Standing -- NEW, small, unblocks 090.4

Extract STANDING as a named fact on the learner: for a given lemma,
*unseen · learning · due · known · out-of-reach*. It is implicit today, spread
across the band-envelope filter (lexical-budgeter.ts:157), the reviewCount split
(:177, :181) and the FSRS adapter. 090.4's simplification depends on it existing
as a thing the Teacher can read.

BIND TO THE EXISTING CONSTANTS; DO NOT RE-DECLARE THEM. Round 5 finding -- an
exhaustiveness pin cannot catch a duplicated threshold, so name the sources:

| Standing | Existing source |
|---|---|
| `due` | `DUE_RETRIEVABILITY_FLOOR = 0.7` (outer-loop-scheduler.ts:52) |
| `known` | `FLUENCY_RETRIEVABILITY_FLOOR = 0.90` (outer-loop-scheduler.ts:68) |
| `unseen` / `learning` | `reviewCount === 0` (lexical-budgeter.ts:177, :181) |
| `out-of-reach` | `getBandIndex(lemma.cefrPriorBand) <= learnerBandIndex + 1`, negated (lexical-budgeter.ts:156-157) |

DO NOT UNIFY THE BAND COMPARISONS. Round 6 correction, and this one was a real
hazard: an earlier draft of this table claimed band+1 "has three implementations"
and told the story to fold them into one function. They are **three different
predicates doing three different jobs**, and unifying them is a behavior change
disguised as a cleanup:

| Site | Predicate | Job |
|---|---|---|
| lexical-budgeter.ts:156-157 | `bandIdx <= learnerIdx + 1` | in-reach, on LEMMAS |
| outer-loop-scheduler.ts:194-195 | `fnBandIdx > learnerIdx` (**delta 0**) | stretch gate, on FUNCTIONS |
| coverage.ts:176 | `isBandAbove(band, learnerBand, 1)` = `> learnerIdx + 1` | ceiling-exceeded, on rendered text |

The first and third are complements of one boundary and may share a primitive.
The second is a different threshold on a different entity and **stays put** --
folding it into the first would admit every band+1 function unconditionally.

`out-of-reach` binds to the first. State that, and state that the other two are
out of scope, or the next reader repeats my error.

There IS a real single-enforcer problem here, and it is band ORDER, not band
comparison: **six** separate CEFR order declarations exist
(classifier/cefr-band-utils.ts:22, learner/cefr-posterior.ts:27,
scheduler/outer-loop-scheduler.ts:73, grading/display-text-resolver.ts:67,
placement/placement-score-engine.ts:33, and -- found round 7 --
ui/shell/editor-support.ts:90), and `lexical-budgeter.ts:39` imports
`CEFR_BAND_ORDER` from `learner/cefr-posterior` rather than from
`classifier/cefr-band-utils`, whose own header (:5) already declares it "the
classifier's single CEFR band ordering helper". So 090.9's fold is RESTORING a
documented invariant, not inventing one. Pure refactor, no behavior change --
unlike the predicates above.

- Exit: standing is derivable for any (learner, lemma) without invoking the
  budgeter (pin); the five values are exhaustive and total (pin); standing
  declares no threshold constant of its own, asserted by grep for `0.7` / `0.90`
  in the new module (pin); ONE ORDER-DEPENDENT CEFR band declaration repo-wide --
  scoped to literals used with `indexOf` / `slice` / comparison, explicitly
  exempting the two validation-only literals (`config.ts:106` `VALID_DEBUG_BANDS`,
  a Set; `compile/multi-word-expression-extractor.ts:122`, an Ajv enum), because
  an unscoped grep pin is unsatisfiable after a correct refactor (pin, scoped
  round 7); the scheduler's stretch gate
  still uses delta 0, asserted by a test that a band+1 function is still gated
  (pin -- the regression the round-5 draft would have caused).

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

090.8 is IN the floor. Without it the epic can produce a perfect slate and still
render English.

WHICH SURFACES ACTUALLY RENDER ENGLISH -- corrected round 7, by measurement.
An earlier draft said "both item bodies and A1 dialogue" and called it "a floor
that cannot show a single Spanish word to a beginner". **Item bodies are not
broken.** Measured against the shipped es atlas, the whole-band pool at
display-text-resolver.ts:247-249 substitutes roughly 70% of tokens in a
representative item body at A1. The 2026-07-28 fix landed and it works.

The surfaces still rendering English are:
- **A1 scripted dialogue** -- `constraint.targetVocab.introduce` is
  `prescription?.introduce` (sugar-lang-teacher-middleware.ts:246), the scene-wide
  top 3 (lexical-budgeter.ts:178), which almost never intersects one line.
- **Agent turns** -- realized only through the prompt overlay, with no weave.

Both are fixed by untruncated-slate + realization. That is the floor's real
justification and it is narrower than the old one.

IT ALSO CUTS THE OTHER WAY, AND THE PLAN MUST SAY SO. Replacing the whole-band
pool with slate ∩ text is a deliberate, player-visible **density REDUCTION** on
item views. The claim at the top of this plan -- "no observable change to
scripted output at either lifecycle" -- does not cover item views, and this is
that exception. It is the right trade: the whole-band pool has no POS filter, so
it currently produces semantically wrong swaps (measured on the same fixture:
`left -> izquierda`, the direction rather than past-of-leave; `mark -> marcar`,
a verb for a noun; `smell -> oler`, likewise). A slate narrows to what was
actually chosen and fixes those incidentally. Say it out loud so the density drop
is not later filed as a regression -- and note it is the concrete answer to open
decision D.

090.5 (capacity) and 090.7 (visibility) are the ceiling.

**090.3 MOVES INTO THE FLOOR** (round 5). The slate has to live somewhere, and
the only key that works is the SITUATION key -- `DirectiveCache` keys on
`conversationId` (`directive-cache.ts:70`) while item views deliberately render
before any conversation exists (`runtime-services.ts:392-402`). 090.8's own exit
and probe 4 are item bodies, so a floor without 090.3 cannot pass its own
acceptance tests. Round 4 called 090.3 "the first ceiling story" for the
staleness rule; round 5 found a harder reason it is not ceiling at all.

**Floor, corrected: 090.1 + 090.2 + 090.9 + 090.3 + 090.8 + 090.4 + 090.10.**

090.10 IS IN THE FLOOR AND THAT IS THE ROUND-7-WRAP CHANGE. Every prior floor
ended at 090.4 and left `prescribe()` alive, with the deletion attached to 090.5
(ceiling). A floor that leaves two systems answering "what should be taught" is
not a floor -- it is the exact condition this epic exists to remove, shipped
under the epic's own name. The deletion is now a story with greps for exits.

Ordering inside the floor is not free. 090.8's prompt-shaping cap must land
before or with 090.4's de-truncation (`generator-prompt-overlay.ts:54` is
uncapped); 090.4 must resolve the 087.6 schedule bypass or nothing in it is
observable; and 090.10 runs last, because every owner in the deletion order must
have landed before the module can go.

## Budgeter deletion order

The model dissolves the budgeter; the plan treated it as the consumer. No story
owned the transition, so it is named here.

The budgeter is **five** jobs, not four. An earlier draft named four; round 5
found the fifth by grepping the prescription's consumers rather than reasoning
from the model. They leave in this order:

1. **Eligibility -> LEARNER** (090.9). Standing becomes readable without the
   budgeter.
2. **Ranking -> TEACHER** (090.4). The slate is produced from situation +
   standing, not from `priorityScores`.
3. **Sourcing -> SITUATION** (090.2 + 090.4). Concepts reach the Teacher through
   the situation, not through `lemmas` membership.
4. **Rationing -> LEARNER capacity** (090.5), applied at realization (090.8).
5. **Verifier exemption -> DIRECTIVE `targetVocab`** (090.4). This is the one
   that was missed, and it is a SAFETY job, not a pacing one:
   `sugar-lang-verify-middleware.ts:333,478` passes `constraint.rawPrescription`
   into the classifier (and `:354` into telemetry, a third read), and
   `classifier/envelope-rule.ts:71-88` turns it into the `"prescription-introduce"`
   exemption. Re-source the exemption from the directive's own
   `targetVocab.introduce`.

   SCOPED CORRECTLY (round 6): an earlier draft said losing this makes "every
   word the Teacher just chose to introduce" a violation. OVERSTATED. The
   exemption is only consulted for `outOfEnvelopeLemmas` /
   `ceilingExceededLemmas` (coverage.ts:169-178), so an in-band introduce word --
   `queso` at A1 for an A1 learner, the motivating case -- is unaffected. It bites
   at the band+1 MARGIN, which is exactly where a Teacher reaching past the
   comfortable set operates. Still must be owned; the stakes are narrower than
   stated.

Three more consumers exist that are not "jobs" but still block the delete, each
needing a named owner before `prescribe()` can go:

| Consumer | Producing line | Owner |
|---|---|---|
| `FallbackTeacherPolicy` builds its whole directive from it | fallback-teacher-policy.ts:124-127, :145-146 | 090.4 rewrites it onto situation + standing |
| `repairDirective` filters against it AND defaults to it | schema-parser.ts:658-672, :695-698 | 090.4 |
| scripted constraint reads it with no Teacher at all | sugar-lang-teacher-middleware.ts:246-248 | 090.8 |
| **087.5 live render spends an unbudgeted per-line LLM call** | sugar-lang-scripted-middleware.ts:295-393 | **090.4** -- same decision as the 087.6 branch (it bypasses the prescription entirely, so no budgeter deletion reaches it) |
| **intent-fact enrichment APPENDS uncapped facts to `introduce` on the FLOOR path** | sugar-lang-scripted-middleware.ts:251-257 | **090.4** (round 7) -- last writer before observe, so it decides which lemmas get cards |
| **intent-fact enrichment REPLACES `introduce` on the baked path** | sugar-lang-scripted-middleware.ts:426-431 | **090.4** (round 7) |
| `verifyLiveRender`'s own `introduce` exemption -- a SECOND prescription-introduce exemption channel parallel to envelope-rule.ts:82-89 | sugar-lang-scripted-middleware.ts:366 | same story as job 5, or the epic breaks its own single-enforcer rule |

The `avoid` LIST HAS NO OWNER EITHER. The model flags it as "a live conflation,
not a proposed change" (domain-model-after-epic-090.md:332-343): `avoid` means
both *too hard right now* and *deliberately withheld*, and those are different
facts. Producer `lexical-budgeter.ts:184-186`; consumers
`generator-prompt-overlay.ts:55`, `sugar-lang-verify-middleware.ts:161`,
`schema-parser.ts:672`/`:698`, and (round 7) `fallback-teacher-policy.ts:146`
which copies it straight into the directive, plus the emptiness gates at
`generator-prompt-overlay.ts:108` and `prompt-builder.ts:185` and the prompt
render at `prompt-builder.ts:327`. The two telemetry reads
(`sugar-lang-teacher-middleware.ts:586`, sugaragent `GenerateStage.ts:586`) are
diagnostic only -- the cross-plugin one is read-only and does NOT violate the
seam, noted so a later reader does not flag it. Under the model *too hard* is STANDING
(`out-of-reach`, 090.9) and *withheld* is a TEACHER decision. 090.9 owns the
split; 090.4 owns re-sourcing the consumers. Round 6 finding -- no story named it.

THERE IS A THIRD INTRODUCE CAP, IN THE PROMPT. `prompt-builder.ts:101` says
"should contain only 1-2 items from the prescription that fit this turn
naturally", alongside `getLevelCap` (lexical-budgeter.ts:48-61, 3 at A1) and
`getIntroduceLevelCap` (fallback-teacher-policy.ts:33-45, **1 at A1**). The
round-4 table named two. All three go with the pre-truncation; 090.4 owns the
prompt one.

Only after all five jobs and all three consumers have owners is `prescribe()`
unreferenced and the module deletable. **That final step is 090.10, and it is a
story in the floor** -- see above. Until step 2 lands the old path must keep
working, so the side field from 090.2 may need the read-time projection as a
transition scaffold; 090.10 deletes it in the same change.

DO NOT LEAVE BOTH PATHS ALIVE PAST THE FLOOR. Round 6 weakened this to "past the
epic" because the floor as then written violated it -- nothing in
090.1/2/9/3/4/8 removed the `prescribe()` call at
`sugar-lang-context-middleware.ts:449`, and rationing sat in ceiling 090.5. That
was fixing the invariant to match the plan rather than the plan to match the
invariant, and it is exactly the move this epic exists to stop. **Reverted:**
the rule stands as written, and 090.10 is what makes the floor satisfy it.

Two systems answering "what should be taught" is the condition that produced
every bug in this epic. The floor does not ship with two.

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
   NPCs, quest stage or time. Telemetry shows exactly ONE teacher call.
   BASELINE CORRECTED round 5: an earlier draft said "today it shows three or
   four, because the directive cache expires on turn count." For any learner
   with one lemma card it shows **zero** -- the 087.6 schedule branch bypasses
   the Teacher entirely (sugar-lang-teacher-middleware.ts:333). Run this probe on
   BOTH a fresh learner and one with history; before 090.4 they give 3-4 and 0,
   after it they must both give 1. The with-history run is the real test.
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
- **English-side inflection on the WEAVE path (round 6, NEW and the highest-value one here).** `diglotWeave` resolves raw tokens through an exact lowercased gloss lookup (diglot-weave.ts:72 -> cefr-lex-atlas-provider.ts:210) over a tokenizer that only lowercases (tokenize.ts:77). Measured against the shipped es atlas: `traveler` -> viajero but `travellers`/`travelers`/`traveller` -> nothing; `head` -> cabeza but `heads` -> nothing; `cheese` -> queso but `cheeses` -> nothing. So authored English in natural prose substitutes far less than it appears to, and the failure is SILENT and indistinguishable from an empty slate. This is the same mechanism as the compile scrub's known gap (line 27), which the plan had filed only against the scrub. Options in cost order: an English lemmatizer in front of `resolveFromGloss`; a plural/inflection index built at atlas load; authoring guidance to use base forms. Trigger: 090.7 telemetry showing weave attempt-vs-substitution rate per item body -- if base-form-only substitution reads as sparse in playtest, this is the first thing to fix (code comment at `resolveSubstitution`, diglot-weave.ts).
- Multiword-gloss unreachability: 973 atlas entries (91 in the top-3000) have only multiword gloss parts and cannot be reached by single-word concepts + exact match. Same trigger; a phrase-concept mode needs the match predicate redesigned.
- Author hand-editing of extracted concepts / situation: revisit on playtest evidence of misses or over-inclusion; 090.7 is the read-only floor.
- NPC memory salience as a signal: needs a NEW sugaragent contribution carrying STRUCTURED topic ids across the plugin seam; free-text `salientFacts` is not deterministically matchable. Pinning context-middleware ordering (both plugins sit at stage `context` priority 10, unpinned) is a prerequisite.
- Budgeter weight rebalance: revisit with 090.7 telemetry. Note for never-seen lemmas the largest absolute term is `w_prodgap * stability` (~1.44, scoring.ts:163/173), not `w_anchor` vs `w_npc`; it is near-constant across same-band candidates, so any rebalance starts from prodgap.
- Cross-NPC concept graphs: revisit if single-scene extraction proves out.
- Post-turn capture of concepts the NPC emitted unprompted (Finnick said `familia`, `tía` with nothing prescribing them): the observe middleware already tokenizes every turn and runs chunk matching, so noticing "target-language lemma with no card" is deterministic and cheap. Deliberately out of this epic to keep it one loop; revisit immediately after the floor ships, since it is the natural completion of "the verifiers CHECK" (code comment at the observe chunk matcher).


## Open at gate exit (epic-review round 4, 2026-07-28)

Round 4 reviewed the plan against
`packages/plugins/src/catalog/sugarlang/docs/api/domain-model-after-epic-090.md`
rather than against the code. Its findings are applied above. Nothing here
blocks the floor; every remaining item is decided inside the story that owns it.

Round 4 also settled several of the round-3 questions:

| Round-3 decision | Now |
|---|---|
| 1. Gateway `purpose` for the Teacher | **RESOLVED and shipped.** `PURPOSE_MODELS` (deployment/gateway/core.ts:833-843) routes `teacher` -> `SUGARMAGIC_SUGARLANG_TEACHER_MODEL`, default claude-sonnet-4-6; `DEFAULT_DIRECTOR_MODEL` deleted. Struck. |
| 2. POS enum: union vs per-language | **Still open.** es emits 12, it emits 14 (adds abbreviation, formula). Unaffected by the model. |
| 3. Which introduce cap governs | **Settled by the model.** Both pre-truncation caps (`newItemsAllowed`=3, `getIntroduceLevelCap`=1 at A1) are deleted; capacity is one number the Learner reports, applied at realization. |
| 4. World-flag-gated presences | **Still open, higher stakes.** `evaluateRegionQuestBinding` fails closed without a flag predicate, and Situation is now one of only TWO Teacher inputs -- a wrongly dropped presence has no other channel to compensate. Raised in priority. |
| 5. Is `publishSugarlangArtifacts` alive? | **Verified dead** -- no importer outside its own test. Not a design decision; a deletion. Downgraded. |
| 6. Which "have they met" signal governs | **Still open, sharper.** Whichever wins must compose INTO situation. Note `isProbableFirstMeeting` is derived inside prompt-builder.ts:169-171 from `recentTurns` -- the prompt builder deriving a situation fact is itself a layering violation under the model. |

New questions the model raises -- and three of the four it already answers.
Listing them as "open" in the first draft of this section was wrong; the model
had settled them and this document had not caught up.

**A. Does the budgeter survive? -- PARTLY ANSWERED. Corrected round 5.**
The model settles that the budgeter is **not a domain boundary**: it is in "What
deliberately is not in the model" and its jobs reassign. It does NOT settle that
the module is deleted, and the same section says so in as many words
(domain-model-after-epic-090.md:152-156):

> "Cut here means **cut from the domain model** -- not cut from the codebase.
> FSRS, the band envelope and the pacing rules are all real code that continues
> to exist. They simply do not appear at this level, because at this level
> nothing talks to them directly."

An earlier draft of this section read that as authorization to delete
`prescribe()` and stamped it ANSWERED. That was my error, and it is the same
error twice: attributing a plan decision to the model to avoid making it.

The decision, made here: **`prescribe()` goes, but it is this plan's call, not
the model's**, and it is contingent on the five-jobs-plus-three-consumers sweep
in "Budgeter deletion order" above. If any of those eight lacks an owner when
090.5 lands, the module stays and the plan says why.

**B. What bounds the slate? -- ANSWERED BY CONSTRUCTION.**
An earlier draft worried the slate was unbounded against an 11,000-entry atlas.
That is only true if the slate is drawn FROM the atlas. It is not: it is drawn
from the SITUATION, which names a bounded concept list, plus the scrub's
scene-derived candidates -- both scene-sized (tens), not atlas-sized.

  slate = (situation concepts + scrub candidates) ∩ in-reach

That is bounded by construction, and it is why the demo shortcut in
`display-text-resolver.ts` had to reach for the whole level lexicon: there was no
situation layer to draw from, so the only bounded-ish set available was the band.

State it explicitly in 090.4 so nobody re-derives the atlas-sized version. The
residual tuning question -- whether "in-reach" means the band envelope or
something tighter -- is an in-story decision, not a blocker.

**C. Is the realization cap a count or a ratio?** -- PARTLY SETTLED.
The strategy split in 090.8 answers most of this: substitution is naturally
capped by a COUNT (how many words to swap), generation by a RATIO (how much
target language to ask the prompt for). They are not interconvertible per text
-- six substitutions is dense in one sentence and sparse in a paragraph -- and
that is fine, because they now govern different strategies.

What remains open is narrower: whether the two must AGREE for the same learner
at the same posture, so an item body and a dialogue line at A1 feel like the
same game. Probably yes, which means the count is derived from the ratio and the
text length, not authored independently.

**D. Do items consult the slate? -- ANSWERED: YES.**
The model scopes realization to "one line / one item body / one description" --
uniform. Items are not special.

The apparent conflict with `display-text-resolver.ts:107-113` is a stale
framing, not a disagreement. That comment argues items should ignore the
BUDGETER, and under the model there is no budgeter for anything to ignore --
its reasoning (an examined item is a browsing moment with no pacing to protect)
was about pacing, which is now one number the Learner reports rather than a
slate the Teacher is handed. Consulting the SLATE is a different question, and
the answer is yes.

090.8 must update that comment when it lands, or it will read as a live
objection to the thing 090.8 just built.

**E. Non-goals wording.** -- APPLIED, not a decision. The non-goal now reads that
one-call-per-conversation is a structural property of the slate/realization
split rather than a tuning target.

---

**What is actually still open: one tuning question (C's residue) and the four
round-3 carryovers (POS enum, world-flag presences, `publishSugarlangArtifacts`
deletion, "have they met" authority).** None of them blocks the floor. The POS
enum is decided inside 090.1; world-flag presences inside 090.3; the artifacts
deletion is a chore; "have they met" is decided inside 090.3.
