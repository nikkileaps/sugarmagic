# How A Conversation Works

Status: active
Last verified against code: 2026-07-31 (end of Epic 090)

One NPC conversation, end to end, in domain language. Written for someone who
has not seen this codebase before. Read
[domain-model.md](./domain-model.md) alongside it for how the entities relate,
and keep [domain-terms.md](./domain-terms.md) open as a glossary.

If this document and the code disagree, the code is right and this is stale.

---

## First: two things happen before the player exists

A common early misreading is that the runtime compiles what it needs when a
conversation starts. It does not. Two expensive things happen in **Studio, at
build time**, and the runtime only ever *reads* their output:

**Scene context extraction.** `SceneContextExtractor`
(`runtime/compile/scene-context-extractor.ts`) reads a scene's authored prose --
NPC bios, dialogue, quest objectives, lore, item labels -- and asks a model what
that content is *about*. The result is a `SceneContextModel`: a list of
**concepts**, cached against the scene's content hash. This is a gateway call
and a Studio-only pass.

**Variant baking.** Authored dialogue lines are pre-rendered per band, so an A1
player and a B2 player read different versions of the same authored line
(`runtime/compile/generate-variant.ts` -> `runtime/grading/graded-text-service.ts`,
driven from `ui/shell/editor-support.ts`). Neither of these has a runtime call
site.

At runtime, scene context arrives **seeded from the boot payload**
(`manifest.ts` -> `seedSugarlangRuntimeSceneContext`) into an in-memory map
keyed by `sceneId`. The IndexedDB scene-context cache is a Studio build cache
and the runtime never reads it.

> **The consequence you will hit.** Editing any authored content in a scene
> changes its content hash, so the seeded model no longer matches and the scene
> context is simply *absent*. The conversation still runs, the NPC still talks,
> and it quietly teaches nothing the scene is about -- because concepts are
> where all vocabulary comes from. Competencies keep appearing, since those come
> from a static inventory file, which makes the failure look like a tuning
> problem rather than a stale cache. If an NPC is teaching oddly generic words,
> check this first.

---

## The turn

### 1. The player walks up to an NPC and presses interact

`gameplay-session.ts` resolves which conversation this is
(`resolveNpcConversationSelection`) and branches on the NPC's
`interactionMode`:

- **scripted** -- authored dialogue, an authored `dialogueDefinitionId`
- **free-form** -- an agent-driven NPC whose lines are generated

That branch matters for the rest of the flow, so hold onto it.

`DialogueManager.startConversation` then hands the selection to the
**conversation host**, which is the piece a new reader usually pictures as "the
sugarlang controller". It is not sugarlang-specific: it is runtime-core's
generic conversation pipeline, and sugarlang participates in it as a set of
middlewares.

### 2. Middlewares run in a fixed order

The host sorts middlewares by stage (`context`, `policy`, `generic`,
`analysis`) and then by numeric priority. `prepare` runs before the text is
produced; `finalize` runs after, in the **same** order (there is no reversal).

| # | middleware | stage / priority | hook | what it does |
|---|---|---|---|---|
| 1 | `runtime.blackboard-context` | context / -100 | prepare | attaches `runtimeContext`: tracked quest, stage, objectives, where everyone is, time of day, known facts, world events |
| 2 | `sugarlang.context` | context / 10 | prepare | loads the learner profile, placement phase, scene vocabulary, teaching schedule |
| 3 | `sugarlang.teacher` | policy / 30 | prepare | composes the situation, asks the Teacher, produces the constraint |
| 4 | `sugarlang.scripted` | analysis / 15 | finalize | realizes authored lines |
| 5 | `sugarlang.verify` | analysis / 20 | finalize | re-checks generated text against the envelope |
| 6 | `sugarlang.observe` | analysis / 90 | finalize | folds the turn back into the learner |

Middleware 1 runs at priority -100 for a reason: everything downstream reads
`execution.runtimeContext`, and it is what puts it there.

### 3. The situation is composed

`sugarlang.teacher` calls `composeSituation` (`runtime/situation/compose.ts`),
which assembles one **situation** -- what is true in the world right now:

- `sceneContext` -- the seeded `SceneContextModel` for this `sceneId`, i.e. what
  this scene is *about* (step 0's output)
- `runtime` -- quest objectives, quest stage, tracked quest, time of day, known
  facts, world events, each wrapped in a `RuntimeFact`
- the conversational surface -- the NPC, the last few turns,
  `turnsSinceLastProbe`

`composeSituation` is **total**: it always returns a situation. Missing data is
represented *inside* it as `unavailable()`, never by returning null. And a
`RuntimeFact` distinguishes "there is no active quest" from "we could not read
the quest system" -- these render as `(none)` and `(unknown)` in the prompt, and
collapsing them is a real bug.

### 4. The Teacher decides

The Teacher receives exactly two content doors -- the **situation** and the
**learner** -- plus plumbing (`TeacherContext`,
`runtime/contracts/providers.ts`). There is no third door. Everything the
Teacher knows about pacing is derived from the learner profile on the spot
(`computePacingSignals`, `getLearningStatus`) rather than stored beside it.

It returns a `PedagogicalDirective`:

- a **slate** -- what to introduce, reinforce, avoid
- a **posture** and target-language ratio
- a sentence complexity cap
- whether to run a comprehension probe

Two policies can answer: an LLM policy through the gateway, and a deterministic
`FallbackTeacherPolicy` for when it is unavailable. If no gateway client is
configured at all, the LLM policy is a stub that always throws and the runtime
is permanently in fallback mode -- worth knowing, because it looks like the
Teacher is running.

One directive is held in memory by `DirectiveCache`, keyed on `situationKey` +
`learnerKey` and shared by every NPC in the region. Neither key has an NPC axis,
so one decision is the right answer for all of them; the cache is not world
state and does not live in the blackboard. The key deliberately excludes recent
turns and volatile world facts; including them would mean never getting a cache
hit. It stops applying when the situation changes, when the learner changes, or
after a maximum number of turns as a backstop.

Because the entry is shared, everything written into it is planned WITHOUT an
NPC, without recent turns, and without a per-conversation probe count — a cache
value has to be a function of its key, and the key carries none of those.

**A turn does not wait for the Teacher.** A directive that has stopped applying
is still served for the turn that found it, and one replacement is planned in
the background and written back when it lands. The cost is that the Teacher
picks what to teach from a slightly old read of the situation for as long as
the replacement takes — usually a turn or three. The directive is never shown
to the player; it biases which words the NPC's line leans on.

The exception is bounded: after three Teacher calls have COMPLETED with a
failure in a row, the next turn stops being served a stale directive and waits
for a real plan. A call still running has not failed, so turns taken during a
slow-but-healthy re-plan never trip it. A turn otherwise waits only when nothing
is cached at all.

Warming keeps that from happening on the first conversation: the region's
directive is planned once at boot, after the save is restored and before the
first frame, and re-planned whenever the situation key moves.

Two paths skip the Teacher entirely: **scripted mode**, which builds a
lightweight constraint straight from the band, and the **pre-placement opening
line**, which uses a fixed directive.

### 5. The directive becomes a constraint

The directive is re-expressed as a `SugarlangConstraint` -- where a directive is
a *decision*, a constraint is *instructions to whatever writes the text* -- and
written onto the turn's annotations, along with a generator prompt overlay
built by `generator-prompt-overlay.ts`.

Both of the following are **realization**: turning a directive into text. Which
one runs depends on step 1's branch.

### 6a. Agent NPCs: the text is generated

SugarAgent's `GenerateStage` reads the sugarlang contribution off the
annotations and folds the overlay into its prompt. The overlay tells the model
what to teach and -- via `describeLanguageMix` -- how much target language to
write. The target language is *written by the generator*, not substituted in
afterwards.

`sugarlang.verify` then re-checks the produced text against the envelope and
attempts one repair.

### 6b. Scripted NPCs: the baked variant is served

`sugarlang.scripted` looks up the variant baked for this line at this learner's
band and serves it. No model call.

On a **cache miss** it serves the authored English unchanged (`applyWeave` was deleted in rf6.5.2)
and assigns the result back to the turn text -- substituting target-language
words into the authored English. This is the last survival of the old "diglot
substitution" design, and it is the one place where finished text still gets rewritten
rather than generated. Expect it to go.

### 7. The text is marked up and presented

`sugarlang.observe` builds a `dialogueHighlight` annotation carrying the slate
terms and their glosses. The dialogue entry decorator adds `celebrateTerms` for
player turns, and `turn-text.ts` in runtime-core turns all of it into spans --
the gold/blue styling, the hover gloss, and the celebrate animation when the
player types a taught word.

The player can select any span to get a translation (`lookupSelection`), which
resolves the raw selected text through the atlas and returns `null` for every
expected miss rather than guessing.

Ambient spans -- target language in the line that nobody asked to teach -- are
computed and written here too, but `readDialogueHighlight` does not currently
copy the field through, so nothing reads them yet.

### 8. The turn folds back into the learner

Still in `sugarlang.observe`. What the player did becomes observations against
the learner state reducer:

- lemmas and chunks the player *typed* -> `produced-typed`, `chunk-produced`
- a dialogue choice they picked -> `produced-chosen`
- a word they hovered -> `hovered-introduce`
- lemmas the NPC's line introduced -> `encountered`
- a completed quest objective -> `quest-success`

Each updates the `LemmaCard` for that word -- review count, stability,
retrievability -- which is exactly what `getLearningStatus` will read the next
time the Teacher runs.

That closes the loop. The profile the Teacher read at the start of this
conversation is the profile this turn just changed.

---

## The shortest version

```
BUILD TIME (Studio)
  authored prose -> concepts        (SceneContextExtractor -> SceneContextModel)
  authored lines -> variants        (per band, cached)

RUNTIME, per turn
  1. player interacts               -> scripted or free-form?
  2. context middlewares            -> world facts + learner profile
  3. composeSituation               -> SITUATION (total, never null)
  4. Teacher(situation, learner)    -> DIRECTIVE (slate + posture)
  5. directive                      -> constraint on the turn
  6. realization                    -> generated text | baked variant
  7. markup                         -> highlighted, hoverable, selectable
  8. observation                    -> learner cards updated
                                        \_ read by the next step 4
```
