# Proposal 001: Adaptive Language Learning Architecture

**Status:** Proposed
**Date:** 2026-04-09

## Summary

Sugarlang is the adaptive language-learning layer of Sugarmagic. Its job is to take an authored RPG (quests, NPCs, regions, items, dialogue, lore) and turn it into a personalized target-language learning experience that keeps the player in the *i+1* zone (Krashen, 1985) — comprehensible input just above current competence — while also scaffolding genuine *production* of the target language (Swain, 1985) across hundreds of hours of free-form play. Sugarlang treats receptive knowledge (can I understand this when I read it?) and productive knowledge (can I produce this when I need it?) as two distinct signals on every lemma, because they are — and conflating them is how adaptive-learning systems silently stall a learner's productive vocabulary while appearing to teach.

This proposal defines the architecture for the **third rebuild** of sugarlang. The previous two attempts both collapsed into the same failure mode: a combinatorial pile of hand-tuned policy heuristics, magic-number thresholds, and a manually authored lexicon and curriculum that did not scale with content. This proposal exists to make sure the third attempt does not have the same shape as the first two.

The architecture proposed here is a **hybrid**: a deterministic ML core (a per-lemma spaced-repetition scheduler plus a deterministic comprehension-envelope classifier plus a Bayesian CEFR estimator) is wrapped by a narrowly-scoped LLM director that runs *once per scene entry* to reshape the scheduler's raw prescription for narrative tone, NPC voice, and emotional arc. The constrained generator (the existing SugarAgent plugin) consumes the resulting `PedagogicalDirective` as immutable input and produces in-character prose under those constraints, which is then verified deterministically. A second, *offline* LLM role — LLM-as-metadata-author — runs at scene lexicon compile time to extract idiomatic multi-word chunks and assign them CEFR levels as communicative units, so the classifier does not stiffen on formulaic sequences like "*de vez en cuando*" that are individually high-band but functionally A2.

This proposal is intentionally:

- high level
- architecture-first
- independent of final TypeScript interfaces
- independent of file-by-file implementation tickets
- written so that the alternatives we *did not* pick are documented and findable in 12 months when the question comes up again

## Relationship to Existing Proposals and ADRs

This proposal builds directly on:

- [Proposal 005: Sugarmagic System Architecture](../../../../../../../docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 007: Execution and Concurrency Architecture](../../../../../../../docs/proposals/007-execution-and-concurrency-architecture.md)
- [Proposal 008: Command and Transaction Architecture](../../../../../../../docs/proposals/008-command-and-transaction-architecture.md)
- [ADR 010: Sugarlang Data Sources and Provider Boundaries](../../../../../../../docs/adr/010-sugarlang-data-sources-and-provider-boundaries.md) — the `LexicalAtlasProvider` / `LearnerPriorProvider` / `DirectorPolicy` separation is still authoritative and is honored by every component below

It supersedes the heuristic policy and runtime-pipeline portions of:

- [Plan 026: Sugarlang Director and Language Learning Orchestration Epic](../../../../../../../docs/plans/026-sugarlang-director-and-language-learning-orchestration-epic.md) — the six-system vision (Semantic Extractor, World-Language Map, Language Knowledge Layer, Director, Linguistic Realizer, Automatic Scaffold) is conceptually preserved but the *how* is replaced

## Why This Proposal Exists

Three previous attempts at sugarlang failed for the same structural reason. Each attempt produced a single process whose responsibility was to *simultaneously* answer two very different kinds of question:

1. **Math-shaped questions.** "How strong is this learner's hold on this lemma?" "When is it due for review?" "How much support does this learner need right now?" These have *measurable* answers and want *calibrated* models.
2. **Taste-shaped questions.** "Is this word tonally apt for the scene we're in?" "Does introducing this lemma right now break the dramatic arc?" "Does this NPC's personality justify a casual register here?" These have *judgment* answers and want *generative* models.

When one process tries to answer both, the math becomes brittle (because thresholds have to hedge against narrative concerns) and the taste becomes mechanical (because narrative decisions are made via numeric weights). The previous policy.ts had thresholds like `supportDependence > 0.85`, `supportDependence > 0.68`, `supportDependence > 0.42`, `affectiveLoad > 0.7` — all magic numbers, all hand-tuned, all entangled with each other and with the term scoring functions in `curate.ts`. Adding any new learner type, scene type, or pedagogical posture multiplied the cases. That is the combinatorial explosion the user keeps describing.

The fix is not "fewer levers." It is **separating concerns by epistemic type**. Math-shaped decisions go to calibrated models. Taste-shaped decisions go to a foundation model. Verification is deterministic. Each component owns a non-overlapping question.

A second persistent failure has been the **manual authoring of a lexicon and curriculum**. Past attempts assumed the plugin needed an authored atlas of "what words sugarlang knows about" and an authored "concept pool" of A1 communicative situations. This is unnecessary. The Centre for Natural Language Processing's CEFRLex family (ELELex for Spanish, FLELex for French, EFLLex for English, DAFlex for German, SVALex for Swedish, NL-Lex for Dutch) provides empirically-derived CEFR-graded lemma lists with frequency rank, all under research-permissive licenses. For Italian, the Kelly project plus OpenSubtitles-derived frequency ranks plus Claude-batch-classification at compile time fills the gap. Authoring an atlas in this code repository was solving a problem that academia already solved — and solving it worse, with thinner coverage and zero validation.

## Core Thesis

There are exactly three questions sugarlang needs to answer for every conversational turn, and each question is answered by exactly one component:

| Question | Owned by | Implementation type | Cost |
|---|---|---|---|
| *What should this learner be exposed to next?* | **Lexical Budgeter** | FSRS over per-learner lemma cards, scene-gated and envelope-gated | sub-millisecond |
| *Is this generated line within the learner's comprehension envelope?* | **Envelope Classifier** | Deterministic CEFRLex lookup + arithmetic | sub-millisecond |
| *How does the budgeter's raw prescription need to bend to fit the narrative tone, NPC voice, and dramatic moment of this specific scene?* | **Director** | Narrow Claude structured-output call, once per scene entry, cached with lifetime invalidation | ~700ms once per scene |

A fourth component, the **Constrained Generator**, is the existing SugarAgent plugin with a small extension hook: it reads the merged constraint from `execution.annotations` and weaves the target vocabulary into in-character prose. SugarAgent does not get redesigned. It gets a six-line splice in `GenerateStage`.

The crucial property of this decomposition: **no component hedges on another's behalf.** The Budgeter does not know about NPC personality. The Classifier does not know what is pedagogically urgent. The Director does not own learner state math. The Generator does not decide pedagogy. When something goes wrong, you can point at the responsible component and fix it without reasoning about the others.

## The Substrate (Untouched)

Sugarlang is built on top of existing Sugarmagic infrastructure that is *not* redesigned by this proposal:

- **SugarAgent** (`packages/plugins/src/catalog/sugaragent/`): the free-form NPC chat plugin, with its six-stage pipeline (Interpret → Retrieve → Plan → Generate → Audit → Repair). User-described as "dialed in." Sugarlang composes over it via middleware and adds exactly one read of `execution.annotations["sugarlang.constraint"]` in `GenerateStage`. Backwards-compatible: when sugarlang is disabled or absent, SugarAgent runs identically to today.
- **Blackboard** (`packages/runtime-core/src/state/blackboard.ts`): the scoped fact store with event subscriptions. Sugarlang owns a small set of new fact definitions (`LEARNER_PROFILE_FACT`, `LEMMA_OBSERVATION_FACT`, `ACTIVE_DIRECTIVE_FACT`) that follow the existing single-writer pattern.
- **ConversationMiddleware** (`packages/runtime-core/src/conversation/index.ts`): the priority-ordered, stage-grouped middleware system with `prepare()` and `finalize()` hooks. Sugarlang contributes four middlewares (context-stage prescriber, policy-stage director invoker, analysis-stage verifier, analysis-stage observer) — all through the existing `conversation.middleware` contribution kind. No new plugin contribution shapes are needed.
- **`ConversationSelectionContext` language fields**: `learnerBandOverride`, `targetLanguage`, `supportLanguage` already exist in the runtime types. Sugarlang reads them; we do not need to extend the interface.
- **Quest, NPC, dialogue, lore, region, and item authoring**: the existing domain types are sufficient. The plugin only *reads* authored content (at compile time) and never modifies it.

The seam is the existing `execution.annotations: Record<string, unknown>` extension point, plus a small set of `session.state["sugarlang.*"]` keys for cross-turn persistence that do not survive across sessions. The canonical authoritative list of every key sugarlang writes or reads — what owns it, what reads it, when it's valid, and what its payload shape is — lives in [§ Annotation Namespace Reference](#annotation-namespace-reference) below. **That reference is the single source of truth; any discrepancy between it and an individual epic story is a bug in the story.** No type-system enforcement of namespaces today; a v2 typed annotation registry is a candidate follow-up.

## Annotation Namespace Reference

This section is the **single authoritative inventory** of every `execution.annotations["sugarlang.*"]` key and every `session.state["sugarlang.*"]` key the plugin writes or reads. Every epic story that touches an annotation key must reference a key from this list. If an epic story describes a key that does not appear here, that story is wrong and should be fixed to match — not the other way around. Adding a new key requires updating this section in the proposal before the implementation lands.

The two stores are distinct:

- **`execution.annotations[...]`** — scoped to a single conversation turn. Wiped between turns. Used to pass data between middleware stages within a single turn and into the Generator splice.
- **`session.state[...]`** — scoped to the current conversation session. Persists across turns within the session. Wiped when the session ends. Used for cross-turn state that needs to survive between turns (e.g. "a probe was fired on the previous turn; watch for the response this turn").

Blackboard facts (`LEARNER_PROFILE_FACT`, `SUGARLANG_PLACEMENT_STATUS_FACT`, `ACTIVE_DIRECTIVE_FACT`, etc.) are *not* annotations — they live in the blackboard's own persistent store and follow the single-writer discipline enforced by `assertWriteAllowed`. Do not confuse the two.

### `execution.annotations[...]` — per-turn keys

| Key | Payload type | Writer | Reader(s) | Purpose |
|---|---|---|---|---|
| `sugarlang.prescription` | `LexicalPrescription` | `SugarLangContextMiddleware` (Epic 10 Story 10.1) | `SugarLangDirectorMiddleware` (Epic 10 Story 10.2) | The Budgeter's raw output: introduce/reinforce/avoid lemmas for this turn. |
| `sugarlang.learnerSnapshot` | `LearnerSnapshot` (compact summary type; see Epic 3 Story 3.2) | `SugarLangContextMiddleware` | `SugarLangDirectorMiddleware` (for prompt building) | Compact learner-state summary the Director's prompt-builder embeds in the Director's user prompt. Avoids re-reading `LEARNER_PROFILE_FACT` in the Director middleware. |
| `sugarlang.pendingProvisionalLemmas` | `PendingProvisional[]` | `SugarLangContextMiddleware` | `SugarLangDirectorMiddleware` | Per-turn view of lemmas with unconfirmed rapid-advance evidence. Drives the Director's decision about whether to trigger a comprehension probe this turn. See § Observer Latency Bias. |
| `sugarlang.probeFloorState` | `ProbeFloorState` | `SugarLangContextMiddleware` | `SugarLangDirectorMiddleware`, schema-parser (for hard-floor enforcement) | Current soft/hard floor state for the comprehension probe mechanism. |
| `sugarlang.forceComprehensionCheck` | `boolean` | `SugarLangContextMiddleware` (set `true` only when hard floor reached) | `SugarLangDirectorMiddleware` (adds hard-requirement line to prompt), schema-parser (rejects directives that ignore the flag) | Hard-floor enforcement signal. When present and `true`, the Director MUST trigger a comprehension check this turn. |
| `sugarlang.activeQuestEssentialLemmas` | `ActiveQuestEssentialLemma[]` | `SugarLangContextMiddleware` | `SugarLangDirectorMiddleware` (adds quest-essential section to prompt) | Lemmas from currently-active quest objectives that get the Linguistic Deadlock classifier exemption. See § Quest-Essential Lemma Exemption. |
| `sugarlang.questEssentialLemmaIds` | `Set<string>` | `SugarLangContextMiddleware` | `SugarLangVerifyMiddleware` (passes to the classifier as `EnvelopeClassifierOptions.questEssentialLemmas`) | Fast-lookup set of quest-essential lemma IDs for the classifier's new exemption clause. |
| `sugarlang.placementFlow` | `{ phase: SugarlangPlacementFlowPhase; questionnaireVersion?: string; scoreResult?: PlacementScoreResult }` | `SugarLangContextMiddleware` (detects placement tag + reads current phase from session state + advances phase) | Conversation host (decides whether to render the normal dialog UI or the placement questionnaire UI), `SugarLangObserveMiddleware` (recognizes questionnaire submissions) | Three-phase placement state machine marker. See § Cold Start Sequence. |
| `sugarlang.constraint` | `SugarlangConstraint` | `SugarLangDirectorMiddleware` (Epic 10 Story 10.2) | SugarAgent `GenerateStage` (the 6-line splice, Epic 10 Story 10.3), `SugarLangVerifyMiddleware` (Epic 10 Story 10.4) | The merged Director-output-plus-prescription that the Generator reads and the Verifier validates. Carries `comprehensionCheckInFlight` and `questEssentialLemmas` sub-fields when applicable. **This is the single integration point with SugarAgent.** |
| `sugarlang.directive` | `PedagogicalDirective` | `SugarLangDirectorMiddleware` | `SugarLangObserveMiddleware` (for telemetry + rationale trace) | The Director's raw output. Used for telemetry and the debug panel's rationale trace; the Generator does NOT read this — it reads the merged constraint instead. |
| `sugarlang.comprehensionCheckInFlight` | `boolean` | `SugarLangDirectorMiddleware` (set when `constraint.comprehensionCheckInFlight` is populated) | `SugarLangObserveMiddleware` (quickly detects probe-in-flight without having to dig through the full constraint) | Quick flag that the current turn is firing a comprehension probe. Used by the Observer middleware to store the probe spec in session state for next-turn response handling. |
| `sugarlang.prePlacementOpeningLine` | `{ text: string; lang: string; lineId: string }` | `SugarLangContextMiddleware` (Epic 10 Story 10.1, when placement phase is `"opening-dialog"`) | `SugarLangDirectorMiddleware` (propagates it into `constraint.prePlacementOpeningLine`) | Staging slot for the authored opening line the Context middleware selected from the NPC's content data. The Director middleware reads this, skips its Claude call, and propagates the line into the final `SugarlangConstraint.prePlacementOpeningLine` field so the Generator splice can speak it verbatim. See Proposal 001 § Pre-Placement Opening Dialog Policy for the full bypass rules. |

### `session.state[...]` — cross-turn session keys

| Key | Payload type | Writer | Reader(s) | Purpose |
|---|---|---|---|---|
| `session.state["sugarlang.lastTurnComprehensionCheck"]` | `{ targetLemmas: LemmaRef[]; probeStyle: "recall" \| "recognition" \| "production" }` | `SugarLangObserveMiddleware` (stores at end of a probe-firing turn) | `SugarLangObserveMiddleware` (reads at start of the next turn to detect probe responses) | Enables the "probe fired on turn N, response received on turn N+1" pattern. Cleared after the response is processed. |
| `session.state["sugarlang.placementPhase"]` | `SugarlangPlacementFlowPhase` | `SugarLangContextMiddleware` (advances on phase transitions) | `SugarLangContextMiddleware` (reads at next-turn start to compute the new phase) | Persists the placement flow's current phase across turns. Transitions: `"opening-dialog" → "questionnaire" → "closing-dialog" → "completed"`. Cleared after placement completes. |
| `session.state["sugarlang.turnsSinceLastProbe"]` | `number` | `SugarLangObserveMiddleware` (increments on non-probe turns, resets to 0 on probe-firing turns) | `SugarLangContextMiddleware` (reads for computing `probeFloorState.turnsSinceLastProbe`) | Counter driving the soft/hard floor logic for comprehension check triggering. |

### Namespace discipline rules

1. **Every sugarlang-owned key starts with `sugarlang.`**. No other namespace is legal. Epic 15 Story 15.11 (Annotation namespace architectural test) enforces this via grep.
2. **Every key has exactly one writer**. The writer is listed in the table above and is enforced at code-review time. Two middlewares writing the same key is a bug.
3. **Keys in `execution.annotations` do not survive across turns**. If you need cross-turn state, use `session.state[...]`. If you need persistent state, use a blackboard fact.
4. **Writers must emit the key BEFORE any reader runs in the pipeline**. Middleware stage ordering matters: context-stage writes are visible to policy-stage readers; policy-stage writes are visible to analysis-stage readers; analysis-stage writes are NOT visible to context-stage readers (because the next turn is a new turn with wiped annotations).
5. **Readers must tolerate missing keys gracefully**. Early-exit or default to a sensible no-op. Never throw on a missing annotation; that breaks backwards compatibility when sugarlang is partially enabled.
6. **Adding a new key requires updating this section first**, then the Epic story that uses it. Do it in that order — proposal first, story second — so the source of truth is never behind the implementation.

### Deprecated and forbidden keys

These keys were mentioned in earlier drafts of the plan but are **not part of v1**. Do not implement them. If a story still references one of these, it is a bug in the story:

- `sugarlang.observation` (earlier draft) — observations flow through the reducer event system, not through annotations
- `sugarlang.sceneProperNouns` (earlier draft) — proper nouns are read directly from `CompiledSceneLexicon.properNouns`, not staged in annotations
- `sugarlang.placementQuestionBank` (earlier draft) — placement no longer goes through the Director, so no such annotation exists
- `sugarlang.isPlacementTurn` (earlier draft) — superseded by `sugarlang.placementFlow.phase`

## The Four Components

### 1. Lexical Budgeter

**Owns the question:** *What should this learner be exposed to next?*

The Budgeter is the **ML core** of sugarlang. It is a per-learner FSRS scheduler over a per-lemma `LemmaCard` ({difficulty, stability, retrievability, lastReviewedAt, reviewCount, lapseCount, cefrPriorBand, priorWeight}). FSRS (Free Spaced Repetition Scheduler) is the current state-of-the-art memory model, empirically ~30% more efficient than SM-2 on the public Anki/MaiMemo dataset, with mature TypeScript implementations.

When the Budgeter is asked to produce a prescription for an upcoming turn, it runs a three-stage funnel. **Set arithmetic, not a model — the model is *inside* FSRS.**

1. **Scene gate.** The current scene's `CompiledSceneLexicon` (see "Scene Lexicon Compilation" below) provides the candidate set: lemmas that are textually reachable in this scene given the authored dialogue, NPC bios, quest objectives, lore pages, items, and region labels. Typically a few hundred lemmas. The compiled artifact is content-hash-cached and shared between Preview and Publish — same artifact, same loader, no fork.
2. **Envelope gate.** Drop any lemma whose `cefrPriorBand` is more than one band above the learner's current `estimatedCefrBand`. The learner is never asked to comprehend material more than one CEFR band above their own — this is the i+1 principle expressed as a hard floor.
3. **FSRS priority score.** For each surviving lemma, compute a transparent linear score:
   ```
   score =
     + w_due     * (1 - retrievability)        // higher if overdue
     + w_new     * priorWeight                  // higher if fresh and prior-strong
     + w_anchor  * (isSceneAnchor ? 1 : 0)      // pivot lemmas central to the scene
     - w_lapse   * (lapseCount > 2 ? 1 : 0)     // punish thrashing lemmas
   ```
   Weights are configuration constants, transparent in the rationale trace. Top-K by score, partitioned by role (`introduce` if `reviewCount === 0`, otherwise `reinforce`). The `avoid` list is the union of lemmas dropped by the envelope gate.

The Budgeter's output is a `LexicalPrescription`:

```ts
interface LexicalPrescription {
  introduce: LemmaRef[];   // ≤ levelCap, brand new to learner
  reinforce: LemmaRef[];   // ≤ 4, due for review
  avoid: LemmaRef[];       // hard floor: above envelope
  anchor?: LemmaRef;       // optional scene-pivot lemma
  budget: { newItemsAllowed: number };
  rationale: LexicalRationale;  // why each pick, for telemetry and debugging
}
```

Per-lemma observation events (`LemmaObservation`) come from the analysis-stage observer middleware and are translated to FSRS grades via a *pure function* — a total observation→grade rule table. No magic thresholds. The rule table is defined in the "Receptive vs. Productive Knowledge" subsection below so the weightings live next to their theoretical justification.

Cold start is handled inside the FSRS card: each lemma is seeded with `difficulty` and `stability` derived from its CEFRLex band relative to the learner's current band. A1 lemmas for a B1 learner start with high stability (assumed comfortable). B2 lemmas for an A2 learner do not enter the budgeter at all until the envelope lifts.

#### Receptive vs. Productive Knowledge

Krashen's Input Hypothesis says that comprehensible input at *i+1* drives acquisition. Swain's Output Hypothesis (1985, with substantial empirical follow-up) says that being *required to produce* the language forces deeper processing than mere comprehension — noticing gaps in one's interlanguage, testing hypotheses about form-meaning mappings, and building retrieval pathways that reading alone does not. Receptive vocabulary (words you can understand when you see them) is typically **2–3x larger than productive vocabulary** (words you can produce from scratch) for the same learner at the same CEFR level.

An FSRS scheduler that treats all evidence as interchangeable will silently conflate these. A learner who has "read *llave* many times without hovering" may have high FSRS stability on *llave* and yet be completely unable to produce the word when asked to ask for a key. The Budgeter will then stop surfacing *llave* as a useful reinforce target, and the learner's productive vocabulary stalls invisibly.

Sugarlang fixes this by carrying **two strength signals per lemma** on the `LemmaCard`:

1. **`stability`** — the standard FSRS memory-model field. Represents **receptive** knowledge: the probability the learner will recognize the lemma when they see it in context. Updated by every relevant observation — recognition and production alike.
2. **`productiveStrength: number` in [0, 1]** — a separate scalar representing **productive** knowledge: the probability the learner can produce the lemma when asked. Updated *only* by production-related observations. Decays independently of FSRS stability, and typically decays more slowly (production knowledge is stickier than recognition once it exists at all).

The `LemmaObservation.kind === "produced"` case is a discriminated sub-union that captures the nature of the production act:

- **`produced-typed`** — the player typed the lemma in free-text input. Strong productive evidence.
- **`produced-chosen`** — the player selected the lemma from a multiple-choice or suggestion UI. Moderate productive evidence (recognition-assisted retrieval).
- **`produced-unprompted`** — the player used the lemma voluntarily when the directive did not specifically require it. Strongest productive evidence — the player reached for it on their own.
- **`produced-incorrect`** — the player attempted production but used the wrong form (wrong conjugation, wrong agreement, wrong sense). Counts as negative production evidence.

The observation → grade and production-strength rule table:

| Observation | Receptive grade (FSRS) | productiveStrength Δ | Notes |
|---|---|---|---|
| `encountered` (lemma appeared in NPC turn, no interaction) | `null` (no update) | 0 | Not evidence — we need a signal |
| `rapid-advance` (player read past without hover in <3s) | `null` (provisional) | 0 | **Does not commit to FSRS.** Adds to `provisionalEvidence` weighted by dwell time, awaits a comprehension probe to commit or discard. See § Observer Latency Bias below. |
| `hovered` (player clicked for translation) | `"Hard"` | −0.05 | Hovering on a previously-produced lemma weakens productive confidence slightly |
| `quest-success` (lemma appeared in a completed objective's text) | `"Good"` | 0 | Receptive only — the player may have completed the objective without actually knowing the lemma |
| `produced-chosen` | `"Good"` | +0.15 | Recognition-assisted retrieval |
| `produced-typed` | `"Easy"` | +0.30 | Strong productive evidence |
| `produced-unprompted` | `"Easy"` | +0.50 | Strongest — voluntary reach |
| `produced-incorrect` | `"Again"` | −0.20 | Production attempt that failed — reset both signals |

`productiveStrength` is clamped to [0, 1]. The deltas above are the v1 defaults and are exported as named constants in the scoring module so they can be tuned against telemetry later.

**How the Budgeter uses the gap.** The scoring function includes a *productive-gap* term:

```
score =
  + w_due      * (1 - retrievability)                       // receptive due-ness
  + w_new      * priorWeight
  + w_anchor   * (isSceneAnchor ? 1 : 0)
  + w_prodgap  * max(0, stability - productiveStrength)     // recognized but not producible
  - w_lapse    * (lapseCount > 2 ? 1 : 0)
```

A lemma the learner *recognizes* (high stability) but *cannot produce* (low productiveStrength) scores high as a reinforce target — specifically, as a candidate for a production-prompting turn where the NPC invites the player to use the word. The Director is aware of the gap too and can pick `interactionStyle: "elicitation_mode"` — a new style added explicitly for this purpose — when multiple high-gap lemmas exist in the scene's candidate set.

**Why separate productive strength instead of two separate FSRS cards?** Two cards per lemma (a "recognition card" and a "production card") is theoretically cleaner but doubles the card-store size, doubles the update cost, and forces the scheduler to make arbitrary choices about which card owns the "next due" semantics. The one-card-plus-productive-scalar design keeps FSRS as the authoritative memory model (well-studied, calibrated) and treats production as an orthogonal property that modifies the scheduler's reinforce priorities. The gap is learnable as a v2 DKT signal without requiring a data migration.

**Where the Welcome to Wordlark Hollow placement scene fits.** The placement interaction asks the player to type responses to Orrin. Those responses produce `produced-typed` observations — the strongest evidence the system accepts. Placement convergence is therefore grounded in genuine production from turn one, not just recognition. This was implicit in the earlier spec and is now explicit in the observation model.

#### Observer Latency Bias and In-Character Comprehension Checks

Sugarlang runs in a 3D RPG. Players skip dialogue because they're in a hurry, because they're bored, because they're mentally in the next quest, because they're looking at the map — not because they understood the words. Treating "read past in 3 seconds without a hover" as positive evidence of comprehension is a **type confusion**: it conflates *engagement behavior* with *learning*. An FSRS scheduler that treats skim-past as "Good" will silently inflate a learner's stability scores for lemmas they may never have actually processed. Weeks later, the classifier marks those lemmas as "known," stops reinforcing them, and the learner hits harder content unprepared and drops out. This is the silent-corruption failure mode that kills adaptive-learning systems in production — you don't see it until telemetry shows the bodies.

Sugarlang fixes this by **separating provisional evidence from committed evidence**, and by making **comprehension probes** a first-class mechanism for converting one into the other. The probing happens *in character* with whichever NPC is speaking — not necessarily in-narrative with the current scene. A bouncer musing about cheese can non-sequitur into "*¿entiendes?*" or "*y tú, ¿cómo lo ves?*" without breaking character. The character's voice is the vehicle; the specific target lemmas are the payload.

**The provisional evidence model.**

Every `LemmaCard` carries **two signals**:

1. **`stability`** (existing FSRS field) — committed memory state. Only real evidence updates this.
2. **`provisionalEvidence: number`** in [0, 5] — *unconfirmed* receptive exposure accumulated from rapid-advance observations, weighted by dwell time. Does not affect `stability` until a comprehension probe confirms it.

When a `rapid-advance` observation fires, the reducer does NOT apply an FSRS grade. Instead, it adds a small amount to `provisionalEvidence` proportional to dwell time: `f(dwellMs) = clamp(dwellMs / 10000, 0, 0.3)`. A 3-second read adds 0.3; a 1-second read adds 0.1; a half-second skim adds 0.05. The evidence accumulates cheaply but never crosses into FSRS stability on its own.

**Committing provisional evidence.** When a comprehension probe fires and the player's response demonstrates comprehension of the target lemmas, the reducer calls `commitProvisionalEvidence(targetLemmaRefs)` which converts the provisional evidence into an FSRS "Good" grade and zeroes the provisional field. When the probe *fails* (player's response does not demonstrate comprehension), the reducer calls `discardProvisionalEvidence(targetLemmaRefs)` which zeroes the provisional field without any FSRS update. The learner's state is protected from false-positive mastery.

**Decay.** Provisional evidence that has been sitting for more than 30 turns without a probe decays to zero. The signal is stale — if nothing has confirmed it in 30 turns, the learner may have forgotten even if they did once read past it comfortably. This is a simple cliff in v1; v1.1 may introduce a smoother exponential decay based on telemetry.

**Who decides when to probe: the Director + soft and hard floors.**

The Director's `PedagogicalDirective.comprehensionCheck` field already exists. This proposal makes it load-bearing by giving the Director the context it needs to decide when to fire one, plus a safety-net floor that guarantees probes eventually happen when the Director defers too long.

`DirectorContext` gains a new field:

```ts
pendingProvisionalLemmas: Array<{
  lemmaRef: LemmaRef;
  evidenceAmount: number;
  turnsPending: number;
}>;
```

The Director's prompt includes a dedicated section showing this list and the following guidance:

> The learner has skimmed past these lemmas without hovering or producing them. Their FSRS stability has not been updated because the evidence is unconfirmed. If the current scene and this NPC's character voice allow it, consider triggering a `comprehensionCheck` to verify understanding before more evidence accumulates.
>
> A comprehension probe does NOT need to be narratively tied to the current scene or quest. It needs to stay IN CHARACTER for the NPC speaking. A non-sequitur probe is fine — a merchant musing about cheese can naturally ask "*¿entiendes?*" or "*y tú, ¿también te gusta el queso?*" as a natural character tic, without breaking immersion. The character's bio and voice in your context is the input. Use it.
>
> Good probe phrasings are short, conversational, and elicit a response that would demonstrate comprehension of specific lemmas: "*¿entiendes?*", "*¿qué piensas?*", "*¿a ti también te gusta?*", "*dime, ¿cómo lo ves tú?*". Avoid clinical phrasings like "Now tell me what this word means" — those break the illusion that this is a conversation, not a test.

**Soft floor.** The Context middleware computes `totalProvisionalPending` and `turnsSinceLastProbe`. When `turnsSinceLastProbe ≥ 15` AND at least 5 lemmas have pending provisional evidence, the middleware writes a soft-recommendation annotation. The Director sees it and is strongly encouraged — but not required — to trigger a probe this turn.

**Hard floor.** When `turnsSinceLastProbe ≥ 25` OR any single lemma has ≥25 turns of pending evidence, the middleware writes `execution.annotations["sugarlang.forceComprehensionCheck"] = true`. The Director's prompt changes to: "you MUST set `comprehensionCheck.trigger: true` this turn and pick appropriate target words from the pending provisional list." The schema-parser rejects directives that ignore this flag, falling back to `FallbackDirectorPolicy` which always honors the requirement. This is the safety net that prevents a Director from indefinitely deferring and letting provisional evidence rot.

**The Generator turn.** When a probe is fired, the `sugarlang.constraint` annotation the Generator reads gains a `comprehensionCheckInFlight` sub-field:

```ts
comprehensionCheckInFlight?: {
  active: true;
  probeStyle: "recall" | "recognition" | "production";
  targetLemmas: LemmaRef[];
  characterVoiceReminder: string;  // a short reminder of the current NPC's voice
};
```

The Generator's prompt gains a strict instruction: "this turn MUST include a natural in-character question that elicits a comprehension response for [targetLemmas]. Stay in [currentNPC]'s voice. The question can be a non-sequitur from the current topic — it just needs to feel like something this character would naturally say." The rest of the Generator's behavior (tone, length, language ratio) is unchanged.

**The Observer turn.** When the player responds to a probe, the Context middleware's `execution.annotations["sugarlang.comprehensionCheckInFlight"]` flag is still set from the prior turn. The Observer middleware sees it, knows the player's response is a probe answer, and:

1. Lemmatizes the response
2. Determines if the response demonstrates comprehension of the target lemmas. Simple v1 rule: if the response contains any of the target lemmas in a correct form, probe passes. If the response is in the support language only, the probe has ambiguous outcome — v1 treats this as a fail with a "language fallback" telemetry note; v1.1 may use a cheaper Claude call to judge.
3. Calls `reducer.commitProvisionalEvidence(targetLemmas)` on pass, or `reducer.discardProvisionalEvidence(targetLemmas)` on fail
4. Emits the full lifecycle telemetry (see below)

**Visibility and observability (first-class requirement).**

Comprehension checks are the single most important new surface in this proposal for debuggability. Developers must have high-resolution visibility into:

- That a probe fired at all
- WHY it fired (Director's discretion, soft floor, hard floor)
- Which NPC fired it and which character voice was used
- What the target lemmas were
- What the player actually typed in response
- What the classifier's decision was (passed, failed, ambiguous) and why
- How much provisional evidence was committed or discarded and for which lemmas
- How often probes are firing per session (rate metric)
- How often probes are passing (pass rate metric)
- Per-NPC probe activity (is one NPC probing too much?)
- Per-lemma probe history (is one lemma being repeatedly probed without resolution?)

Every one of these is a discrete telemetry event under the `comprehension.*` and `fsrs.provisional-*` namespaces. The debug panel in Studio gains a dedicated "Comprehension Check Monitor" view that shows live probe activity during Preview sessions. Each probe appears as a row with reason, NPC, target lemmas, player response, classifier decision, and the FSRS deltas applied. Developers can filter by session, conversation, NPC, or lemma. This is the "lots of visibility" discipline — without it, tuning the probe mechanism is guesswork, and the whole adaptive loop depends on probes working well.

See Epic 13 (Telemetry and Debug Panel) for the concrete event kinds, the debug view, and the session-level rollup metrics.

#### Quest-Essential Lemma Exemption (the Linguistic Deadlock fix)

The envelope rule as stated ("no lemma may exceed learnerBand + 1") creates a **deadlock** for quest-critical vocabulary. Consider an A1 learner with an active quest whose objective is "*Investigate the Ethereal Altar*." Both *ethereal* (C1) and *altar* (B2 in most CEFR-graded atlases) are individually above the A1 learner's envelope. The classifier flags the NPC's description of the quest. Auto-simplify can't rescue it — *altar* has no A1 synonym that preserves the quest meaning. The Generator either refuses to describe the quest (failing the player) or produces semantically empty substitutes ("go to the… religious building? thing? place?") that don't tell the player where to go. **The game deadlocks on its own narrative.**

The fix: **quest-essential lemmas are exempt from the envelope rule, but the Generator must use a heavy glossing strategy when they appear.** A quest-essential lemma is one that appears in the display text of a currently-active quest objective — it's the vocabulary the player *must understand* to know what to do. The classifier exempts these words unconditionally (they're always in-envelope regardless of CEFR band), and the Director is required to set `glossingStrategy: "parenthetical"` or `"inline"` so the player sees an immediate translation when the word appears.

**Compile-time tagging.** `compileSugarlangScene` (Epic 6) walks every quest objective's `displayName` and `description` text reachable from the scene. For each lemma found, it emits an entry in `CompiledSceneLexicon.questEssentialLemmas`:

```ts
interface CompiledSceneLexicon {
  // ... existing fields ...
  anchors: string[];                              // narratively pivotal lemmas (existing)
  questEssentialLemmas: QuestEssentialLemma[];    // NEW — objective text lemmas
}

interface QuestEssentialLemma {
  lemmaId: string;
  lang: string;
  cefrBand: CEFRBand;                    // for debugging/telemetry only — does not affect exemption
  sourceQuestId: string;
  sourceObjectiveNodeId: string;
  sourceObjectiveDisplayName: string;
}
```

`anchors` and `questEssentialLemmas` are **distinct concepts** with different semantics:

- **Anchors** are narratively pivotal lemmas — the NPC's name's kind, region names, item labels. They give the Budgeter a scoring boost (`w_anchor`). Soft preference.
- **Quest-essential lemmas** are *specifically* those that appear in active-objective display text. They get a hard classifier exemption and a forced glossing requirement. Not a preference — a rule.

Every quest-essential lemma is probably also an anchor, but not every anchor is quest-essential.

**Runtime filtering.** The Context middleware (Epic 10) reads `activeQuestObjectives` from the blackboard — the list of objectives currently visible in the quest HUD. It filters the scene lexicon's `questEssentialLemmas` to only those whose `sourceObjectiveNodeId` is in the active set. The result is `activeQuestEssentialLemmas` — the set of lemmas the Generator might legitimately need to use this turn to convey the current objective.

**The classifier exemption.** The envelope rule gains a new exemption clause:

```
withinEnvelope ⇔
  coverageRatio ≥ 0.95                                       (Krashen 95%)
  AND no lemma exceeds learnerBand + 1                       (CEFR i+1 ceiling)
  AND |outOfEnvelopeLemmas| ≤ 2
       OR all out-of-envelope lemmas ∈ prescription.introduce
       OR all are named entities
       OR all are in activeQuestEssentialLemmas              (NEW — Linguistic Deadlock fix)
```

`EnvelopeClassifierOptions.questEssentialLemmas?: Set<string>` is a new option parallel to `knownEntities`. The Verify middleware populates it from the constraint before calling `classifier.check`.

**Forced heavy glossing.** When `activeQuestEssentialLemmas` is non-empty, the Director prompt gains a hard requirement line: *"The following lemmas are quest-essential and may appear in your reply if the player needs to understand the active objective. If you use any of them, you MUST set glossingStrategy to 'parenthetical' (preferred) or 'inline' so the player sees an immediate translation."* The schema-parser (Epic 9 Story 9.2) rejects directives that contain quest-essential lemmas in their `targetVocab` but use `glossingStrategy: "hover-only"` or `"none"`; the `FallbackDirectorPolicy` defaults to `"parenthetical"` whenever the quest-essential set is non-empty.

**The Generator instruction.** When `SugarlangConstraint.questEssentialLemmas` is non-empty, the Generator splice injects an additional instruction: *"The following words are essential to the currently active quest objective: [lemmas]. If your reply needs to reference the objective at all, you MUST use the appropriate quest-essential word(s) and MUST provide an inline parenthetical translation in [supportLanguage] immediately after the first use in this turn. Example: 'Ve al altar (the altar) y toca la piedra.'"*

**Verify middleware check.** After generation, if the turn's text includes *any* quest-essential lemma, the verifier confirms the surrounding text contains a parenthetical translation pattern in the support language (simple regex match: `lemma \(.*?\)` where the content inside parens contains at least one support-language token). If the gloss is missing, the verifier triggers a repair with an explicit instruction to add the parenthetical. If the Generator failed to use any quest-essential lemma at all AND the Director flagged the active objective as being in focus, the verifier also triggers a repair — the NPC can't leave the player without quest-critical context.

**Telemetry.** Three new event kinds (defined in Epic 13):

- `quest-essential.classifier-exempted-lemma` — fires every time the classifier exempts a lemma via the quest-essential clause, with the lemma, its CEFR band, and the sourceObjectiveNodeId
- `quest-essential.director-forced-glossing` — fires when the schema-parser or fallback forced `glossingStrategy` to parenthetical/inline because of quest-essential content
- `quest-essential.generator-missed-required` — fires when the Generator failed to use a required quest-essential lemma and a repair was triggered

These events let developers audit: how often are quest-essential exemptions firing? Which objectives are producing the most deadlock pressure? Is any single objective responsible for a spike?

**What this does NOT solve.** Quest-essential lemmas are still *hard* for the learner. The exemption prevents deadlock but doesn't make *altar* suddenly comprehensible. The parenthetical gloss is the learner's only path to understanding. If the quest text uses too many quest-essential words at once, the parenthetical glosses will crowd the NPC turn. The v1 mitigation is authorial discipline — authors should try to write quest objectives with minimal high-band vocabulary — combined with a diagnostic warning at scene compile time ("this objective contains 5+ quest-essential lemmas above A2; consider revising"). The v1.1 option is a per-objective CEFR budget that the scene density histogram (Epic 12) can warn on.

### 2. Envelope Classifier

**Owns the question:** *Is this generated line within the learner's comprehension envelope right now?*

The Classifier is **deterministic**. No LLM. Ever. That is a firm architectural commitment, because an LLM at the verification layer reintroduces nondeterminism exactly where we need byte-identical reproducibility for unit tests and bug reproductions.

Given a text string and a learner profile, the Classifier:

1. Tokenizes with a language-aware `Intl.Segmenter`.
2. Lemmatizes each token via `morphologyIndex[lang]` (a precomputed surface-form-to-lemma trie built at compile time).
3. Looks up each lemma in `cefrLex[lang]` (the imported CEFRLex data file for this language).
4. Allowlists named entities and proper nouns against `sceneLexicon.properNouns` and `game.entities[].displayName`.
5. Computes a `CoverageProfile`: total tokens, known tokens, in-band tokens, unknown tokens, band histogram, out-of-envelope lemmas.
6. Applies the envelope rule (this is the only "policy" in the entire Classifier):

```
withinEnvelope ⇔
  coverageRatio ≥ 0.95                                       (Krashen 95% comprehension floor)
  AND no lemma exceeds learnerBand + 1                       (CEFR i+1 ceiling)
  AND |outOfEnvelopeLemmas| ≤ 2
       OR all out-of-envelope lemmas are in prescription.introduce
       OR all are named entities
```

The 0.95 is empirically supported (Nation 2001, repeatedly confirmed). The "+1 band" is the CEFR realization of i+1. Both are citations, not magic numbers — they are anchored to published research.

The Classifier returns an `EnvelopeVerdict { withinEnvelope, profile, worstViolation, rule }`. Performance budget: ≤10ms; in practice ~2ms at typical 50–80-token NPC reply lengths.

### 3. Director

**Owns the question:** *How does the Budgeter's raw prescription need to bend to fit the narrative tone, NPC voice, and dramatic moment of this specific scene?*

The Director is the **hybrid layer**. It is a single Claude structured-output call, invoked **once per scene entry** (or when the active directive's invalidation conditions trigger), that takes the Budgeter's raw prescription and reshapes it into a `PedagogicalDirective` that downstream stages consume as immutable input.

The Director does *not* own learner state math. It does *not* run every turn. It does *not* generate prose. Its job is narrow: read the scene's tone and arc, look at the scheduler's proposal, and tell the rest of the system how to *bend* that proposal to feel narratively right.

**Director input (the prompt context, ~2,400 tokens, of which ~2,100 are cacheable per scene):**

| Slice | Tokens | Content |
|---|---|---|
| System preamble | 100 | Role, goal, operating constraints |
| Pedagogical rubric | 450 | CEFR level descriptors, comprehensible-input principle, posture definitions, glossing-strategy taxonomy |
| Output schema reminder | 300 | JSON schema fragment + hard no-gos |
| Learner profile | 150 | CEFR estimate, posterior confidence, mastered count, recently struggling lemmas, session-derived affective state |
| Lemma summary | 200 | Top-12 due, last-8 introduced, top-5 struggling — *not* the full lexicon |
| Scene teachable index | 600 | The Budgeter's raw prescription + the per-scene `CompiledSceneLexicon` slice (top 20 core + 20 optional lemmas with CEFR level, gloss, example) |
| NPC bio + game moment | 380 | NPC persona (first 120 words from lore page), location, area, quest stage, companions present |
| Recent dialogue | 220 | Last 4 turns, capped |

**Director output (`PedagogicalDirective`, strict JSON):**

```ts
interface PedagogicalDirective {
  // WHAT — the Director can veto scheduler picks and re-rank, but not invent
  targetVocab: {
    introduce: LemmaRef[];   // subset of prescription.introduce, or [] to defer
    reinforce: LemmaRef[];   // subset of prescription.reinforce, possibly re-ordered
    avoid: LemmaRef[];       // unchanged from scheduler
  };

  // HOW — the Director picks posture and presentation
  supportPosture: "anchored" | "supported" | "target-dominant" | "target-only";
  targetLanguageRatio: number;            // 0..1
  interactionStyle: "listening_first" | "guided_dialogue" | "natural_dialogue" | "recast_mode" | "elicitation_mode";
  glossingStrategy: "inline" | "parenthetical" | "hover-only" | "none";
  sentenceComplexityCap: "single-clause" | "two-clause" | "free";

  // WHEN — comprehension probe trigger
  comprehensionCheck: {
    trigger: boolean;
    probeStyle: "recall" | "recognition" | "production" | "none";
    targetWords: LemmaRef[];
  };

  // LIFETIME — caching and invalidation
  directiveLifetime: {
    maxTurns: number;
    invalidateOn: ("player_code_switch" | "quest_stage_change" | "location_change" | "affective_shift")[];
  };

  // TELEMETRY — required, audited, becomes training data
  citedSignals: string[];                 // structured: ["cefrEstimate=A2", "perder.errRate=0.67"]
  rationale: string;                      // 1-3 sentences free-form
  confidenceBand: "high" | "medium" | "low";
  isFallbackDirective: boolean;
}
```

**Hard architectural constraint: the Director can never *expand* the candidate set.** It can only veto, re-rank, or defer items the Budgeter already proposed. If the Director hallucinates a target word, the verifier middleware drops it before it ever reaches `GenerateStage`. This makes Director hallucinations a non-issue at the safety level (worst case is a slightly suboptimal directive).

**Cache and invalidation.** The active directive lives on the conversation-scoped blackboard as `ACTIVE_DIRECTIVE_FACT`. The cache hits as long as the player stays in the same scene, the same quest stage, the same location, the same affective regime, and within `maxTurns`. Typical hit rate: 70–85%, giving an amortized rate of ~0.15–0.30 Director calls per turn.

**Cold-start mode.** During the diegetic placement scene (see "Cold Start Sequence"), the Director runs in a calibration variant: same context schema, but the prompt asks it to probe one CEFR band boundary per turn and report `calibrationVerdict=stayA1|tryA2|dropToA0` in `citedSignals`. After ~8 exchanges the Beta posterior has sharpened enough to commit.

**Fallback when the Director call fails or times out:** a deterministic fallback policy synthesizes a `PedagogicalDirective` directly from the Budgeter's prescription using sensible defaults (anchored posture for cold-start, supported posture for low confidence, target-dominant for high confidence; inline glossing for new lemmas). The directive is marked `isFallbackDirective: true` and the system runs unimpaired.

### 4. Constrained Generator

**Owns the question:** *Given a fixed pedagogical directive, what does this NPC actually say?*

This is the existing SugarAgent plugin, with **one** modification: in `packages/plugins/src/catalog/sugaragent/runtime/stages/GenerateStage.ts`, before assembling the system and user prompts, read `execution.annotations["sugarlang.constraint"]` and splice approximately six lines into the existing prompt builders when present:

```
Language constraint: Reply primarily in ${targetLanguage}.
Must-use vocabulary (weave naturally): ${reinforce.join(", ")}.
New vocabulary to introduce this turn (use once, clearly in context): ${introduce.join(", ")}.
Forbidden vocabulary (use simpler synonyms): ${avoid.slice(0, 12).join(", ")}.
CEFR envelope: learner is ${learnerCefr}; keep ≥95% of lemmas at or below ${learnerCefr}+1 band.
${additionalPostureGuidance}
```

That is the only SugarAgent change. Zero other modifications to the six-stage pipeline. When sugarlang is disabled or the annotation is absent, SugarAgent runs identically to today.

After generation, the analysis-stage `SugarLangVerifyMiddleware` runs the Envelope Classifier against the generated text. If the verdict is in-envelope, the turn passes. If not, the middleware triggers exactly one repair call: a focused rewrite prompt that says "rewrite this keeping the same meaning but remove these violating words and use simpler synonyms." If the second attempt also fails verification, the deterministic auto-simplify fallback substitutes each violating lemma from a precompiled `simplifications[lemma]` dictionary (CEFR-higher → CEFR-lower paraphrases compiled from CEFRLex alignments at build time). The result is guaranteed in-envelope, possibly stilted in pathological cases. **Never serve a line above envelope.**

Honest retry rate (extrapolated from the LLM-control research summarized in "Cost and Latency"): ~70% pass first try, ~25% need one repair, ~5% fall through to auto-simplify. Average ~1.30 LLM Generate calls per turn.

## End-to-End Turn Flow

```
Player input
    │
    ▼
ConversationHost.submitInput
    │
    ▼ ───────────────────────────────────────────────────────────────────
    │   middleware prepare() chain — stage = "context"
    │   ─ SugarLangContextMiddleware (priority 10)
    │       reads LEARNER_PROFILE_FACT
    │       loads CompiledSceneLexicon for current scene
    │       calls LexicalBudgeter.prescribe(scene, learner) → LexicalPrescription
    │       writes execution.annotations["sugarlang.prescription"]
    │
    ▼ ───────────────────────────────────────────────────────────────────
    │   middleware prepare() chain — stage = "policy"
    │   ─ SugarLangDirectorMiddleware (priority 30)
    │       checks ACTIVE_DIRECTIVE_FACT cache validity
    │       if hit: reuse cached directive
    │       if miss: call Director.invoke(prescription, learner, sceneCtx)
    │                store in ACTIVE_DIRECTIVE_FACT with lifetime
    │       merges directive ∩ prescription → final constraint
    │       writes execution.annotations["sugarlang.constraint"]
    │
    ▼ ───────────────────────────────────────────────────────────────────
    │   SugarAgent.advance(input, execution)
    │   ─ Interpret      (unchanged)
    │   ─ Retrieve       (unchanged)
    │   ─ Plan           (unchanged)
    │   ─ Generate       (reads sugarlang.constraint, splices prompt)
    │   ─ Audit          (unchanged)
    │   ─ Repair         (unchanged)
    │   returns ConversationTurnEnvelope
    │
    ▼ ───────────────────────────────────────────────────────────────────
    │   middleware finalize() chain — stage = "analysis"
    │   ─ SugarLangVerifyMiddleware (priority 20)
    │       classifier.check(turn.text, learner) → verdict
    │       if out-of-envelope:
    │           call llm.repair(turn, verdict.violations) → retry
    │           re-verify; if still bad, autoSimplify(turn)
    │   ─ SugarLangObserveMiddleware (priority 90)
    │       extract LemmaObservations from turn + player input
    │       reduce → LearnerStateReducer.apply(observations)
    │       update LEARNER_PROFILE_FACT (single writer)
    │
    ▼
Player sees turn
```

## Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First

The previous attempt scanned authored content at runtime to build a "live lexicon view." This conflated *what is reachable in this scene* with *what the runtime currently has loaded* and burned cycles on every turn for data that does not change between player inputs.

The replacement is **one semantic compiler** (`compileSugarlangScene(scene, atlas, profile) → CompiledSceneLexicon`) that runs across **all three existing runtime compile profiles** and is cached by **content hash**, not invocation time. There is exactly one implementation of the compiler. Edit-time, Preview, and Publish all call the same function. This is the "single enforcer" rule from `AGENTS.md`, and it follows the precedent already set by the material system in [Proposal 009](../../../../../../../docs/proposals/009-material-compilation-and-shader-pipeline.md).

### What the compiler does

For each scene, the compiler:

1. Walks the authored content reachable from the scene: `DialogueDefinition` nodes (text + speaker templates), `NpcDefinition` display names and bios, `QuestDefinition` objectives and stage descriptions, `ItemDefinition` labels and descriptions, `RegionDefinition` area labels, and lore pages (markdown).
2. Tokenizes and lemmatizes each text blob via the language-specific morphology index.
3. Looks up each lemma in `cefrLex[lang]` for CEFR band, frequency rank, parts of speech, and gloss.
4. Records source locations for every lemma (debugging).
5. Identifies anchor lemmas — words central to the scene's quest objectives, NPC role, or region label.
6. Emits a `CompiledSceneLexicon`:

```ts
interface CompiledSceneLexicon {
  sceneId: string;
  contentHash: string;                         // stable hash of all input fields read
  pipelineVersion: string;                     // bumps when compiler logic changes
  atlasVersion: string;                        // bumps when CEFRLex data changes
  profile: RuntimeCompileProfile;
  lemmas: Record<string, SceneLemmaInfo>;     // dense, frequency-ordered
  properNouns: string[];                       // for envelope NER allowlist
  anchors: string[];                           // pivotal lemmas
  sources?: Record<string, SourceLocation[]>;  // present only under "authoring-preview"
  diagnostics?: SceneAuthorWarning[];          // present only under "authoring-preview"
}
```

### Compile profile policies

The compiler reuses the existing `RuntimeCompileProfile` enum (`packages/runtime-core/src/materials/index.ts`):

| Profile | Used by | Sugarlang behavior |
|---|---|---|
| `authoring-preview` | Studio editor viewport | Full output: `sources` source-location map, `diagnostics` (e.g. "scene `marketplace` is 40% C1-band — consider simplifying"), slow-but-thorough lemmatization, asserts on author errors |
| `runtime-preview` | Studio Preview window | Stripped of `sources` and `diagnostics`, production-like, fast. **This is the profile the player actually experiences in Preview.** |
| `published-target` | Published builds | Same as `runtime-preview` plus the artifact is gzipped and bundled into the publish output for zero-compile load at runtime |

The semantic core — what counts as a lemma, how anchors are picked, how the `cefrLex` lookup works — is identical across profiles. The profile only gates debug features, output verbosity, and where the artifact lives. This mirrors how `compileProfilePolicies` works for materials (Proposal 009 §4) and is the *one-source-of-truth* discipline `AGENTS.md` requires.

### The compile cache

A `SugarlangCompileCache` keys each `CompiledSceneLexicon` by:

```
cacheKey = (sceneId, contentHash, profile, atlasVersion, pipelineVersion)
```

Where `contentHash` is a stable hash over the *exact set of fields* the compiler reads from the scene (dialogue text, NPC bios, quest objective text, item labels, region labels, hashed lore page contents). This is the dependency graph: there is no separate dependency tracker. **If the inputs change, the hash changes, the cache misses, the compiler runs.** If the inputs do not change, the cache hits and nothing recompiles.

Cache storage tier depends on profile:

- **`authoring-preview` and `runtime-preview` (Studio):** persisted to IndexedDB under the workspace key, survives reloads of the studio. A `clear` command in the design-section UI nukes it for forced rebuild.
- **`published-target` (Published builds):** in-memory only, populated once at build time, written into the publish bundle as static JSON files alongside the rest of the published artifacts.

Cache size budget at typical scale (~200 scenes × 2 languages × ~30KB compiled lexicon each) is ~12 MB — comfortably within IndexedDB quotas and gzip-friendly.

### Trigger points: Preview-first, incremental, never full rebuild

The compiler runs in five contexts. The user should never wait for a full re-compile of every scene when hitting Preview.

**1. Background authoring-time compilation (Studio idle).** When the user is editing, the existing authoring command stream (`applyCommand` flow) emits change events. A new `SugarlangAuthoringCompileScheduler` subscribes to these events, debounces ~250ms, and recompiles only the scenes whose dependencies actually changed. Cache writes are best-effort and run on idle. This means **the cache is almost always warm by the time the user hits Preview** — most scenes were already compiled in the background while the user was typing.

**2. Preview start (the Studio → Preview window handoff).** When `handleStartPreview()` in `apps/studio/src/App.tsx` runs, the `PREVIEW_BOOT` payload now includes the cached `CompiledSceneLexicon` for every scene where the studio's authoring cache has a valid (matching content hash) entry. The Preview window receives them as part of the boot snapshot — no recompilation crosses the postMessage boundary. For scenes that *don't* have a cached entry (newly added, hash drift, atlas version bumped), the boot payload includes the raw scene content and a flag asking the runtime to compile lazily.

**3. Preview runtime lazy compile (the safety net).** Inside the Preview window, the sugarlang plugin's `init(context)` hook reads `context.boot.compileProfile` (= `"runtime-preview"` for Preview) and walks the boot snapshot. For every scene the studio cache could not satisfy, it compiles on-demand:
   - Eager: scenes reachable in the first ~60 seconds of play (the start scene + immediately adjacent scenes)
   - Lazy: every other scene compiles on first scene-enter
   This ensures "click Preview → game starts immediately" even if the cache is cold, while keeping the cold-start cost bounded to "what the player actually walks into."

**4. Manual rebuild button (the escape hatch).** A `design.section` contribution under the existing sugarlang design workspace adds a "Rebuild Sugarlang Lexicon" button. Clicking it calls `cache.invalidateAll(profile)` and triggers a full background recompile under `authoring-preview`. Useful when:
   - A new version of CEFRLex is loaded
   - The lemmatizer/morphology table is updated
   - The compiler `pipelineVersion` is bumped
   - The user just wants to be sure everything is fresh
   The button shows progress per scene and is non-blocking — the studio remains responsive.

**5. Publish path.** A publish-time hook invokes `compileSugarlangScene(scene, atlas, "published-target")` over every scene in the project, gzips the outputs, and writes them into the publish bundle. The published runtime loads them directly from the bundle without invoking the compiler. **Same compiler function, same cache key schema, just a different storage tier.**

### What the runtime sees

In all three profiles, the runtime side of sugarlang reads `CompiledSceneLexicon` artifacts via a single `SugarlangSceneLexiconStore` interface:

```ts
interface SugarlangSceneLexiconStore {
  get(sceneId: string): CompiledSceneLexicon | undefined;
  ensure(sceneId: string): Promise<CompiledSceneLexicon>;  // lazy compile path
}
```

The Budgeter, Director, Classifier, and Verifier never know which compile profile produced the artifact. They never know whether it was cached, lazily compiled in Preview, or loaded from a published bundle. That is the entire point of the single-enforcer pattern: edit-view truth and play-view truth are not just *similar*, they are *literally the same artifact*.

### Lexical Chunk Awareness (LLM-as-Metadata-Author)

A lemma-based classifier silently stiffens on **formulaic sequences** — multi-word idioms and common collocations whose meaning is less than the sum of their parts. The canonical example: *"de vez en cuando"* ("from time to time") is a functional A2 chunk every learner picks up early, even though one of its constituent lemmas (*vez*) is individually B1/B2 in most CEFR-graded atlases. A pure lemma-level classifier sees *vez*, flags the turn, triggers a repair, and the NPC ends up saying something blander. For noir dialogue — which lives and dies by idiom — this is a dialect-ruining problem.

The fix is to teach the compile pipeline about chunks, without adding a curated chunk dataset. Sugarlang uses **the LLM as a metadata author at bake time**: during scene lexicon compilation, an offline extractor pass sends the scene's authored text to Claude with a focused prompt that asks for multi-word idiomatic sequences and their CEFR band as communicative units. The LLM produces a per-scene chunk manifest. The classifier reads that manifest deterministically at runtime. The human writes noir; the LLM writes metadata; the runtime stays byte-identical.

This is explicitly *not* a global static chunk dataset. Static wordlists go stale the moment they ship, and no academic CEFRLex-style list covers the specific genre-and-character-voice surface area of a given game. Every chunk in the manifest is one that *actually appears in this scene's authored text*. The "dataset" is exactly as big as the game.

#### Architectural rules

Chunks are a strictly **additive** layer over the existing scene lexicon. The base compile function `compileSugarlangScene` does not change — it remains pure, deterministic, and byte-identical over (text, atlas, profile). Chunks arrive later via a *separate* extractor step that runs asynchronously, caches its results by the same content hash as the base compile, and writes chunks back onto the cached `CompiledSceneLexicon` as an optional field.

The discipline is:

1. **`compileSugarlangScene` stays pure.** No LLM calls inside it. Ever. Same inputs → byte-identical lemma-level lexicon.
2. **Chunk extraction is a separate module** (`runtime/compile/extract-chunks.ts`) that runs after the base compile, never inside it.
3. **Extraction is async in Preview and sync in Publish.** Preview never blocks on chunk extraction; at worst the first Preview of a freshly-edited scene runs with lemma-only classification until the background extractor catches up. Publish always extracts synchronously because the publish pipeline has no latency budget.
4. **The classifier degrades gracefully.** When a scene lexicon has no chunks (cold cache, newly-edited content, extraction failed), the classifier runs lemma-only and behaves identically to a chunk-unaware system. When chunks are present, they contribute as virtual tokens.
5. **The cache key is the same content hash.** Same scene content → same cache entry. The LLM runs once per content-hash bump per language, not per compile pass.
6. **Drift is surfaced via telemetry.** If cache eviction forces re-extraction and the LLM returns different chunks than the prior cached entry, the system logs a `chunk-extraction-drift` event. The new chunks replace the old, but the drift is visible to anyone investigating "why did this turn feel different after I cleared the cache."

#### The runtime data shape

`CompiledSceneLexicon` gains one optional field:

```ts
interface CompiledSceneLexicon {
  // ... existing fields ...
  chunks?: LexicalChunk[];  // populated asynchronously; absent means lemma-only classification
}

interface LexicalChunk {
  chunkId: string;
  normalizedForm: string;          // "de_vez_en_cuando" — stable lookup key
  surfaceForms: string[];           // ["de vez en cuando", "De vez en cuando"] — trie match targets
  cefrBand: CEFRBand;               // the chunk's level as a communicative unit
  constituentLemmas: string[];      // ["de", "vez", "en", "cuando"] — for audit and debugging
  extractedByModel: string;         // "claude-sonnet-4-6" — for drift and telemetry
  extractedAtMs: number;            // when the extraction ran
  extractorPromptVersion: string;   // bumps when the extraction prompt changes, forcing re-extraction
  source: "llm-extracted";
}
```

#### The classifier integration

`runtime/classifier/coverage.ts` gains a **chunk-scan pass** that runs *before* lemmatization. For each chunk in the scene lexicon, it scans the input text using a simple multi-pattern trie matcher (Aho-Corasick or equivalent) to find occurrences. Matched spans become "virtual tokens" that carry the chunk's CEFR band. The remaining unmatched text is tokenized and lemmatized as today. Coverage computation treats virtual chunk tokens identically to lemma tokens — same band lookup, same envelope rule, same exemption logic.

The chunk scan is **deterministic** and **sub-millisecond**. A 100-token NPC reply against a per-scene manifest of ~50 chunks completes in under 1ms on a modest machine. The classifier's latency budget (≤5ms p95) is unchanged.

When `sceneLexicon.chunks` is absent or empty, the chunk-scan pass is a no-op and the classifier runs exactly as today. This means the chunk feature can be delivered incrementally: the classifier code exists, chunks just don't exist yet, and when they arrive they plug in without any additional runtime changes.

#### Reusing the Director's existing exemption

Proposal 001's envelope rule already has an exemption clause: *"all out-of-envelope lemmas ∈ `prescription.introduce`"*. If the Director wants to green-light a specific chunk or its constituent lemmas for a turn — say, introducing "de vez en cuando" as a teachable unit for an A2 learner — it puts the chunk (or its normalized form) into `targetVocab.introduce`. No new Director annotation kind is needed. The existing contract handles runtime chunk exemptions transparently.

This is important because it means the Director's prompt and schema do not change. The Director sees chunks in the scene's teachable index (because the extractor pass contributes them), can reference them in its output, and can exempt them via the same mechanism it uses for any introduce-slot lemma.

#### Where extraction runs

| Context | Extraction mode | Latency impact |
|---|---|---|
| Studio authoring (tier-1 base compile) | Not run | None — compile stays pure |
| Studio authoring (tier-2 background task, 5s debounce) | Async, best-effort | None visible — runs idle |
| Preview boot handoff | Not run | None — uses whatever the Studio cache has |
| Preview runtime lazy compile (first scene enter) | Not run for scenes with missing chunks — lemma fallback | None; chunks become available asynchronously |
| Publish path | Sync, mandatory | Blocks publish (acceptable — offline) |
| Manual "Rebuild Sugarlang Lexicon" button | Sync, forced | Explicit — user requested it |

#### Cost accounting

- **Per scene per content-hash bump:** ~1,000 input tokens + ~200 output tokens ≈ **$0.006** per Claude Sonnet call
- **Typical project (200 scenes, full bake):** ~$1.20 per atlas version bump or pipeline version bump
- **Per-turn runtime cost:** $0 — classifier reads the static manifest
- **Publish build cost:** ~$1.20 one-time per build, amortized across player sessions

The extraction cost is bounded by the content's size and updates, not by player count or turn volume. It does not affect the unit economics per player at all.

#### Failure modes

| Failure | Behavior |
|---|---|
| Claude API unavailable during extraction | Log failure, leave `chunks` field absent, classifier falls back to lemma-only. Extraction retries on the next authoring change or cache miss. |
| LLM returns malformed JSON | Schema-parser repair pattern (same as the Director in Epic 9) attempts to salvage valid chunks; unrecoverable responses are discarded and the extraction is logged as failed. |
| LLM returns over-eager chunks (normal words labeled as chunks) | Classifier still treats them as in-band tokens; worst case is the chunk's band label is slightly off, which is corrected on the next cache bump. |
| LLM returns under-eager extraction (misses obvious idioms) | Classifier stiffens on the missed idiom, behaves as today; telemetry records repair events for investigation. |
| Cache drift on re-extraction | Logged as `chunk-extraction-drift` with previous/new chunk counts so the source of gameplay changes is visible. |
| Extraction prompt version changes | Forces re-extraction across all scenes on next cache lookup; treated as an intentional global invalidation. |

### Dynamic content

NPC names interpolated at runtime, quest names generated from templates, and other dynamic strings are handled by a session-scoped runtime extension layer that appends generated lemmas onto the compiled index without overwriting it. The extension is per-conversation, never persisted, and never written back to the cache.

### What this replaces

This pattern explicitly replaces the old `runtime/live-lexicon.ts` runtime scanning, the previous "compile only at publish" implicit assumption, and any notion of an editor-only fast path. It honors the `AGENTS.md` rules verbatim:

- **One source of truth** — `CompiledSceneLexicon` keyed by content hash, owned by `SugarlangCompileCache`
- **Single enforcer** — exactly one `compileSugarlangScene` function
- **One-way dependencies** — runtime reads cache, studio writes cache, publish writes cache; no back-edges
- **Edit view = play view** — Preview and Publish use the same compiled artifact format and the same loader
- **No editor-only fake render path** — there is no "live lexicon" in the editor that diverges from what the runtime sees

### Plugin contribution surface

The compiler integrates with the existing plugin system without inventing new contribution kinds:

- `RuntimePluginInstance.init(context)` reads `context.boot.compileProfile` and either (a) sets up the lazy compile path for Preview, or (b) loads bundled artifacts for Published
- `design.workspace` + `design.section` contributions surface the per-scene density histogram and the "Rebuild" button in the studio
- The studio-side `SugarlangAuthoringCompileScheduler` subscribes to the existing authoring command stream — no new "onContentChange" plugin hook needed today

If, after building this, we find that *other* future plugins need the same incremental-compile-on-authored-content pattern, we should propose a new `compile.scene-derivation` contribution kind in a follow-up ADR. For sugarlang alone, the existing seams are sufficient.

## Learner State Model

Fresh design — does not inherit field-by-field from the previous `SugarlangLearnerState`.

```ts
interface LearnerProfile {
  profileId: string;
  targetLanguage: "es" | "it" | ... ;
  supportLanguage: "en" | ... ;

  // Bayesian CEFR posterior — Beta distribution per band
  cefrPosterior: Record<CEFRBand, { alpha: number; beta: number }>;
  estimatedCefrBand: CEFRBand;             // argmax of posterior
  cefrConfidence: number;                  // max posterior mass

  // Per-lemma FSRS state (paged to keep blackboard fact small)
  lemmaCards: Record<string, LemmaCard>;

  // Session history
  sessionHistory: SessionRecord[];

  // Session-derived signals (no magic numbers — pure functions of events)
  currentSession: {
    sessionId: string;
    startedAt: number;
    turns: number;
    avgResponseLatencyMs: number;          // rolling
    hoverRate: number;                     // hovers / lemmas-seen
    retryRate: number;                     // verifier retries / turns
    fatigueScore: number;                  // f(turns, hoverRate, retryRate) — transparent
  };
}
```

**Fresh learner:** uniform Beta(1, 1) over all bands; `estimatedCefrBand = "A1"`; empty `lemmaCards`; lemma cards populated lazily on first encounter, seeded from CEFRLex priors.

**Bayesian CEFR update:** each turn that succeeds or fails moves the posterior — `alpha[observedBand] += 1` on success, `beta[observedBand] += 1` on failure. The "observed band" is the highest band in the in-envelope lemmas the player handled successfully. Five turns is enough to shift the mode meaningfully.

**Persistence:** `LearnerProfile.core` lives on the blackboard as `LEARNER_PROFILE_FACT` (entity scope, persistent lifetime). `lemmaCards` are paged to a separate `LearnerCardStore` adapter (because thousands of cards in one fact is heavy). `currentSession` lives in session scope. `sessionHistory` keeps the last 20 sessions; older sessions archive. The single-writer pattern for `LEARNER_PROFILE_FACT` is enforced by the existing blackboard `assertWriteAllowed` mechanism — only `LearnerStateReducer` writes.

## Cold Start Sequence

The first 10 minutes of play, with zero learner data. Placement is **a deterministic plugin-owned questionnaire wrapped in dialog** — not an LLM-driven calibration loop.

1. **Player boots in.** `LearnerProfile` initialized: uniform CEFR posterior, `estimatedCefrBand = "A1"`, empty cards.
2. **Diegetic arrival.** The first authored scene places the player arriving at a station (or equivalent entry point — dockyard, airship terminal, portal chamber) where a plugin-tagged NPC — the station manager archetype — greets them. The author provides the visual scene, the NPC card, and the transport metaphor. The plugin provides the interaction flow.
3. **Dialog wrapper (opening).** The station manager speaks 2 lines of **authored character dialog in the player's support language** — NOT the target language. The full sugarlang pipeline is BYPASSED for this phase per the Pre-Placement Opening Dialog Policy (see below). No Claude calls. No Budgeter, no Director, no envelope check. The NPC's authored opening lines (written by the author as normal content in the support language) are selected deterministically by the Context middleware and spoken verbatim by the Generator. The dialog is warm, in-character, and establishes that the manager is about to ask for the player's arrival papers. In the Wordlark Hollow build this is Orrin Lark; in another game it could be anyone.
4. **Questionnaire hand-off.** The station manager hands the player an in-world arrival form — the UI switches from the conversation panel to a dedicated questionnaire UI. The form contains the plugin-shipped standard placement questions for the current target language (~10–15 questions spanning A1 through B2, authored once, ships as plugin data in `data/languages/<lang>/placement-questionnaire.json`).
5. **Player fills out the form all at once.** The player sees every question simultaneously and answers at their own pace. Mixed question types: multiple-choice recognition, short free-text production, yes/no, fill-in-the-blank. No LLM calls during form completion. No turn-by-turn calibration loop. The player submits the form when they're done.
6. **Deterministic scoring.** On submission, a pure scoring function walks the responses, evaluates each against the question's expected-answer pattern (matching CEFR band), and produces a final CEFR estimate with confidence. No Claude calls. No Bayesian posterior per response — the questionnaire is controlled and the scoring is a known-good function. Budget: ~5ms.
7. **Dialog wrapper (closing).** The station manager speaks 2–3 more lines of authored dialog acknowledging the form, making a small in-character comment about the traveler, and sending the player into the village proper. These lines are generated by the normal SugarAgent pipeline but constrained by the now-known placement result: the target language ratio, glossing strategy, etc. for this brief closing turn match the learner's just-determined level.
8. **Placement completes.** Sugarlang writes `SUGARLANG_PLACEMENT_STATUS_FACT = { status: "completed", cefrBand, confidence, completedAt }`, calls `questManager.setFlag("sugarlang.placement.status", "completed")`, and calls `questManager.notifyEvent("sugarlang.placement.completed")`. The active quest's placement objective closes; the next stage activates.
9. **FSRS seeding.** The scoring engine ALSO emits per-lemma seed observations for every lemma the player produced correctly in the form's free-text fields. These flow through the reducer as `produced-typed` observations and seed the learner's FSRS state with a small amount of real productive evidence — better than cold-start zero.
10. **From this point forward**, every conversation is budget-prescribed via the normal Budgeter → Director → Generator → Verify → Observe pipeline. The station manager becomes a normal agent NPC if the player returns to him later — his `sugarlangRole: "placement"` tag is observed as inert because `PLACEMENT_STATUS_FACT.status === "completed"`.

### Placement Interaction Contract

The Cold Start sequence is plugin-owned, not per-project-authored. Sugarlang ships the questionnaire UI primitive, the question bank per language, and the scoring engine. The author provides the diegetic wrapper: which NPC, which region, what the "station" looks like, what the transport metaphor is, how the manager's character voice feels. The contract between the plugin and authored game content is:

**1. Author tags an NPC with the sugarlang placement role.**

`NPCDefinition.metadata.sugarlangRole = "placement"` marks the NPC as the placement handoff point. Any NPC can be tagged this way. Exactly one NPC per game is expected to carry the tag (multiple is legal but authors should lint against it). The author writes 4–6 lines of dialog for the NPC — two to three for the opening greeting, two to three for the closing acknowledgment — and the rest of the character voice is for the NPC's *post-placement* behavior as a normal agent NPC.

**2. Sugarlang detects the tag and activates the placement flow.**

When `SugarLangContextMiddleware.prepare()` runs with a selection whose `metadata.sugarlangRole === "placement"` AND `SUGARLANG_PLACEMENT_STATUS_FACT.status !== "completed"`, the middleware writes a marker annotation `execution.annotations["sugarlang.placementFlow"] = { phase: "opening-dialog" | "questionnaire" | "closing-dialog" }`. The marker is what drives the UI state machine — the conversation host reads it to decide whether to show the normal dialog panel, the questionnaire UI, or the closing dialog panel.

The placement flow is a three-phase sub-state of the normal conversation pipeline, with **asymmetric LLM usage** (opening dialog and questionnaire phases are LLM-free; closing dialog uses the full pipeline):

- **Phase `opening-dialog`**: **the full pipeline is BYPASSED** per the Pre-Placement Opening Dialog Policy (see below). The Budgeter is NOT called. The Director is NOT called. The Classifier runs trivially against support-language text. The Observer middleware does NOT emit any observations. The Context middleware writes a synthetic empty prescription and a synthetic directive with `targetLanguageRatio: 0`, and the Generator reads a `prePlacementOpeningLine` sub-field on the constraint and speaks the author's line verbatim — no Claude call. Lasts `placement.openingDialogTurns` turns (default 2). **Zero LLM calls during this phase.**
- **Phase `questionnaire`**: the normal pipeline is also bypassed. The UI renders the plugin's questionnaire primitive from `data/languages/<lang>/placement-questionnaire.json`. The Director does not run. The Budgeter does not run. The Classifier does not run. The player fills out the form, submits, and the scoring engine produces a result. **Zero LLM calls during this phase.**
- **Phase `closing-dialog`**: normal SugarAgent pipeline resumes in full. Budgeter, Director, Classifier, Verifier, Observer all run, now with the known CEFR estimate from the scoring engine. The Director is given a fresh `DirectorContext` where the learner's `assessment.evaluatedCefrBand` is populated, and it makes a real pedagogical decision about how the NPC should react to the placement result. The Generator produces a personalized in-character comment at the learner's level. Lasts `placement.closingDialogTurns` turns (default 2). **This is the only phase of placement that uses LLM calls.**

### Pre-Placement Opening Dialog Policy (canonical — authoritative)

This subsection exists to answer the question "what runs during the opening dialog phase?" with ONE explicit rule that every epic story implements consistently. Before this subsection existed, different parts of the proposal gave different answers; this section is the tiebreaker.

**The rule:** during the `opening-dialog` phase, the full sugarlang pipeline is bypassed. No LLM calls. No pedagogical processing. The NPC speaks author-provided warm greeting lines in the support language, verbatim.

**Mechanics, step by step:**

1. **Authored opening lines.** The author of the placement NPC provides a small set (1–3) of opening dialog lines as part of the NPC's content data. These are written in the player's support language (English for most English-native learners), NOT in the target language. They are warm, in-character, and establish the customs / arrival framing — e.g., *"Welcome to Wordlark Hollow. First time through here, I take it?"* Authors write these as ordinary string content; they are NOT subject to target-language lemmatization, CEFR grading, or compile-time scene lexicon analysis.

2. **Context middleware behavior.** When `execution.annotations["sugarlang.placementFlow"]?.phase === "opening-dialog"`, the Context middleware:
   - Does NOT call the Budgeter
   - Writes a **synthetic empty prescription** to `sugarlang.prescription`: `{ introduce: [], reinforce: [], avoid: [], budget: { newItemsAllowed: 0 }, rationale: { summary: "Pre-placement opening dialog — no prescription needed." } }`
   - Picks one of the NPC's authored opening lines (v1 behavior: pick the first line; v1.1 can randomize or rotate)
   - Writes the line into a new sub-field on the constraint: `constraint.prePlacementOpeningLine: { text: <line>, lang: <supportLanguage> }`

3. **Director middleware behavior.** When the prescription is the synthetic empty one AND the placement flow phase is `"opening-dialog"`, the Director middleware:
   - Does NOT call Claude
   - Does NOT call `ClaudeDirectorPolicy.invoke`
   - Writes a **synthetic directive** with:
     - `targetVocab: { introduce: [], reinforce: [], avoid: [] }`
     - `supportPosture: "anchored"`
     - `targetLanguageRatio: 0`
     - `glossingStrategy: "none"`
     - `interactionStyle: "listening_first"`
     - `sentenceComplexityCap: "single-clause"`
     - `comprehensionCheck: { trigger: false, probeStyle: "none", targetLemmas: [] }`
     - `isFallbackDirective: false` (this is not a fallback — it's a deliberate bypass)
     - `citedSignals: ["pre-placement-opening-dialog"]`
     - `rationale: "Pre-placement opening dialog — pipeline bypassed. Learner level unknown; speaking in support language from authored line."`
   - Propagates `constraint.prePlacementOpeningLine` through to the final constraint
   - Writes `sugarlang.directive` with the synthetic directive so the Observer middleware can see it for telemetry

4. **Generator splice behavior.** The SugarAgent `GenerateStage` reads the constraint and checks for `constraint.prePlacementOpeningLine`. **If present**:
   - SKIP all normal prompt assembly
   - SKIP the LLM call entirely
   - Return a `ConversationTurnEnvelope` whose `text` is the authored line verbatim, whose `speakerId` is the NPC, and whose `inputMode` is `"advance"` (tap-to-continue)
   - Do NOT run the Audit or Repair stages (nothing to audit; the text is authored content the engineer/author already reviewed)
   - Emit a telemetry event `pre-placement.opening-line-served` with the line id and the player's current session info

5. **Verifier behavior.** The Verify middleware runs but takes a short path: the text is in the support language, has no target-language lemmas, and trivially passes the envelope check. No classifier call is strictly necessary — the middleware can early-exit when it sees `constraint.prePlacementOpeningLine` is set.

6. **Observer behavior.** The Observer middleware detects `phase === "opening-dialog"` and short-circuits its observation extraction:
   - Does NOT lemmatize the player's input (there's nothing to lemmatize — the player is tapping to advance)
   - Does NOT emit any `LemmaObservation` events
   - Does NOT update any FSRS state
   - Does NOT update session signals (fatigue, hover rate, retry rate)
   - Does NOT check for probe responses (no probe is in flight during opening dialog)

7. **Phase advancement.** After `placement.openingDialogTurns` turns in the opening dialog phase (default 2), the Context middleware's next-turn logic advances `session.state["sugarlang.placementPhase"]` from `"opening-dialog"` to `"questionnaire"`. On the next turn, the UI switches to the questionnaire panel.

**What this explicitly is not:**

- Not "the Director runs with A1 defaults." The Director is not called at all.
- Not "the Budgeter prescribes against the authored opening lines." The authored opening lines are support-language text with no target-language lemmas to prescribe against.
- Not "anchored posture with inline glossing" — those fields exist in the synthetic directive but they have no practical effect because `targetLanguageRatio: 0` means the Generator speaks the support language, so there is nothing to gloss or anchor.
- Not "everything works as usual." The pipeline is explicitly, intentionally, and deterministically bypassed.

**Why this asymmetry with the closing dialog:** during the closing dialog, the learner's CEFR is known (the scoring engine just ran), and the Director has a real decision to make about how the NPC should react to that specific result. That's genuine LLM work and justifies the cost. During the opening dialog, the learner's CEFR is unknown by definition, so there is no real decision for the Director to make; any output it produces would be calibrated to a placeholder default (A1) which is likely wrong. Using the support language and authored lines is the honest, cheap, deterministic option. This asymmetry is deliberate.

**LLM call count per placement:**
- Opening dialog: **0 calls**
- Questionnaire: **0 calls**
- Closing dialog: **2 calls** (1 Director + 1 Generator)
- **Total: 2 LLM calls per placement**, ~$0.015 at Claude Sonnet pricing.

(Earlier drafts of this proposal stated 4 LLM calls per placement. That was based on the incorrect assumption that opening dialog ran the full pipeline. The correct count under this policy is 2.)

**3. The questionnaire is plugin-owned, not project-authored.**

The plugin ships `data/languages/<lang>/placement-questionnaire.json` — one canonical bank per supported language, authored once, shared by every project. Projects cannot override it in v1. Per-NPC or per-project question customization is a v1.1 feature with a clear extension point: an optional `NPCDefinition.metadata.sugarlangPlacementQuestionnaireOverrideId` pointing at an alternate questionnaire. In v1 this field is ignored.

**4. Scoring is deterministic.**

The `PlacementScoreEngine` is a pure function over `(responses, questionnaire): PlacementScoreResult`. It walks each response, checks against the question's expected-answer pattern (which is tagged with a CEFR band), and accumulates a score per band. The final `cefrBand` is the highest band at which the learner demonstrated competence (no partial credit rules; v1.1 can refine). The `confidence` is a simple function of how many questions were answered vs. skipped. There is no Bayesian posterior update — the posterior is *replaced* by the scoring result because the questionnaire is by construction the most authoritative signal we'll ever have.

**5. Completion signals are unchanged.**

On scoring, the reducer applies a `PlacementCompletionEvent` that:
- Writes `SUGARLANG_PLACEMENT_STATUS_FACT` with the scoring result
- Updates the learner's `assessment` field (`evaluatedCefrBand`, `cefrConfidence`)
- Calls `questManager.setFlag("sugarlang.placement.status", "completed")` and `questManager.notifyEvent("sugarlang.placement.completed")`
- Seeds the learner's `lemmaCards` with `produced-typed` observations for any target-language lemmas the player typed in the form's free-text fields (so placement leaves the learner with real productive evidence, not just a level estimate)

**6. Once completed, the tag is inert.**

If the player re-enters a conversation with an NPC tagged `sugarlangRole: "placement"` after the fact is set to `"completed"`, sugarlang skips the placement flow entirely and treats the NPC as a normal agent NPC. The opening dialog / closing dialog NPC becomes a conversational character for the rest of the game. Placement does not re-run on replay unless the learner profile is explicitly reset (v1.1 may add a "re-evaluate me" affordance, but v1 is first-visit-only).

**7. The author gates their quest on the completion signal.**

Unchanged from the earlier design: the author's "welcome" quest has a first-stage objective that completes on `eventName: "sugarlang.placement.completed"` or gates on `{ type: "hasFlag", key: "sugarlang.placement.status", value: "completed" }`. No sugarlang imports in the quest definition.

### Why a questionnaire instead of an LLM-driven calibration loop

The earlier draft of this proposal described a calibration-mode Director that probed the player's CEFR band turn-by-turn via a free-form dialog. That approach had three problems:

1. **Cost**: every placement turn was a full Claude call (Director + Generate + Verify). A 10-turn placement was ~10 LLM calls minimum.
2. **Nondeterminism**: a Director driven by Claude is stochastic. Two different learners with identical profiles could get different probe questions, different convergence trajectories, and different final estimates. This made placement hard to test and debug.
3. **Free-text evaluation was fragile**: classifying a player's free-form response as "demonstrates A2 comprehension" required either another Claude call or a rigid rule. Neither scaled.

A plugin-owned questionnaire avoids all three: zero LLM calls during the form phase, deterministic scoring, testable with frozen fixtures. The cost of "less warmth than free-form dialog" is paid back by the dialog wrapper phases (opening and closing) which are still agent-driven and in-character. The player experiences: warm greeting → hand me your papers → fill out form → warm acknowledgment → off you go. That's a realistic customs interaction, and the evaluation is genuinely invisible to the player.

### Why this separation matters

The plugin owns the *capability* (questionnaire UI, question bank, scoring engine, completion signal). The author owns the *content* (NPC card, region, transport metaphor, character voice in the dialog wrapper). Neither imports the other. Swapping the Wordlark station manager for an innkeeper in a different game is a data-only change with zero sugarlang code. Deleting the placement concept entirely is a matter of not tagging any NPC — nothing else changes.

A derived implementation plan documents the specific authored experience built on top of this contract: see `packages/plugins/src/catalog/sugarlang/docs/plans/001-welcome-to-wordlark-hollow-station-manager-placement-experience.md`.

### First turn walkthrough

The first player experience (Italian, absolute beginner), with phase annotations:

> **Phase: opening-dialog** (normal SugarAgent pipeline)
>
> Orrin: *"Welcome to Wordlark Hollow. First time here, I take it? Good — good. Every traveler has to fill in a form. Harbor rules. It's just a few questions, won't take a moment."*
>
> Player taps to continue.
>
> Orrin: *"Here, take this. Answer what you can. If you don't understand a question, skip it — no one's keeping score. Well, I am, but only a little."*  *(Orrin hands the player a clipboard.)*
>
> **Phase: questionnaire** (plugin UI — no LLM calls)
>
> The UI transitions from the conversation panel to an arrival form. The form shows ten questions in the target language plus five optional free-text fields. Each question has its expected-answer pattern and CEFR band. The player fills in what they can, leaves others blank, and hits "Submit."
>
> Scoring engine runs: tallies correct answers per band, computes the final `cefrBand: "A2"` with `confidence: 0.72`. Writes the placement fact, fires the quest event, seeds FSRS cards for lemmas the player produced correctly in free-text fields.
>
> **Phase: closing-dialog** (normal SugarAgent pipeline, now with known CEFR level)
>
> Orrin: *"All done? Let's have a look. ...Mm. You've got a bit of Italian in you, I can see. Not fluent, but you'll get by. The village is through the gate there. Ask for the innkeeper first — she'll know you."*
>
> Player taps to continue.
>
> Orrin: *"Oh — and welcome to Wordlark Hollow. Try not to get lost."*
>
> Player walks out of the station. Placement complete. Welcome quest's first stage closes, second stage activates. Normal gameplay begins.

Total wall time: ~3–5 minutes. Total LLM calls: **2** (both during the closing-dialog phase only — one Director call and one Generate call, using the now-known CEFR estimate). Opening dialog runs zero LLM calls under the Pre-Placement Opening Dialog Policy (pipeline is bypassed; authored support-language lines are spoken verbatim). Questionnaire runs zero LLM calls (deterministic scoring). Total cost at Claude Sonnet pricing: ~$0.015 per placement.

## Implicit Signal Collection

The RPG provides signals Duolingo and Anki do not have. The plugin captures them at two places:

| Signal | Captured by | Emits observation | Receptive / Productive |
|---|---|---|---|
| Word hover (player clicks for translation) | UI middleware → blackboard event `sugarlang.lemma-hover` | `hovered` | Receptive ("Hard") + mild productive penalty |
| Response latency | `SugarLangObserveMiddleware.finalize` measures display→submit | Not per-lemma; raises `fatigueScore` | n/a |
| Free-text production — target word present, correct form | Observe middleware lemmatizes player text against directive targets | `produced-typed` | Both — strong |
| Free-text production — target word present, wrong form | Observe middleware + grammar check | `produced-incorrect` | Both — negative |
| Free-text production — player used a lemma that was NOT required by the directive | Observe middleware discovers voluntary use | `produced-unprompted` | Both — strongest positive |
| Multiple-choice or suggestion selection | UI emits `sugarlang.lemma-chosen` with the selected lemma | `produced-chosen` | Both — moderate |
| Quest objective success | Existing quest system blackboard event → observer subscriber | `quest-success` for every lemma in the objective text | Receptive only |
| NPC reply re-read | UI event → `sugarlang.turn-rereviewed` | `hovered` for lemmas viewed during re-read | Receptive ("Hard") |
| Rapid advance without interaction (<3s reading) | Turn pacing middleware | `rapid-advance` for all in-envelope lemmas in the turn | Receptive only, **provisional** — accumulates to `LemmaCard.provisionalEvidence` and awaits a comprehension probe to commit or discard. Does NOT directly update FSRS. |
| Verifier retry triggered | Verify middleware | Not per-lemma; raises `retryRate` | n/a |

**Where captured:** two pipes feed a single `LearnerStateReducer` (the only writer of `LEARNER_PROFILE_FACT`):

1. The analysis-stage observer middleware (primary) — anything derivable from the just-completed turn envelope.
2. Blackboard event subscribers (secondary) — signals from outside the conversation pipeline (quest progress, inventory changes, spatial events).

The observation→FSRS-grade mapping is a *pure function*, ~20 lines, total over `LemmaObservation` kinds. Not a model. Not a heuristic with thresholds. A rule table that documents itself.

**Anti-troll guard.** A learner who hovers every word can game the difficulty-down signal. The reducer dampens hover-derived grades when `hoverRate > 0.4` — the point at which "hover means I didn't know it" stops being statistically meaningful. The 0.4 is derived, not magic: it's the ratio above which the signal saturates and provides no information.

## Multi-Language Handling

The architecture is **language-parameterized**, not language-specific. Each supported language is a directory under `data/languages/<lang>/` containing exactly four data files:

- `cefrlex.json` — CEFR-graded lemma frequency list
- `morphology.json` — surface form → lemma trie
- `simplifications.json` — pre-derived lower-band substitutions
- `placement-questionnaire.json` — the plugin-shipped canonical placement questionnaire for this language (see § Cold Start Sequence)

Adding a language is adding a directory. The runtime code never branches on language identity. Bumping any of these files bumps the language's `atlasVersion`, which invalidates the scene-lexicon cache for that language and triggers background recompilation through the same Preview-first pipeline as authored content changes.

**Spanish (es):** ELELex provides ~11k+ CEFR-graded lemmas. ~400KB gzipped. Loaded directly.

**Italian (it):** CEFRLex coverage is thinner. The strategy is **derived proxy frequency** with Claude-batch CEFR classification at compile time:

1. Compute a frequency list from open Italian corpora (OpenSubtitles-it + Wikipedia-it). Few hours of one-time offline processing.
2. Use the Kelly project's Italian subset (~6000 lemmas, frequency-ranked, rough CEFR bands) where available.
3. For lemmas in the corpus-derived list but not in Kelly, **assign CEFR band by frequency quantile** (top-1000 → A1, 1000–2000 → A2, 2000–4000 → B1, 4000–8000 → B2, 8000+ → C1). Flag these as `cefrPriorSource: "frequency-derived"` so diagnostics can show "lower confidence" for these lemmas. This frequency-quantile approximation correlates with human CEFR assignment at ~0.78 and is academic-standard practice (Kilgarriff 2001).
4. For lemmas where the frequency quantile is ambiguous (band straddling the boundary), invoke Claude in compile-time batch mode: 100 lemmas per call, single classification per lemma, cached permanently by lemma ID.
5. A `review-queue.yaml` lists the lowest-confidence assignments for human override.

**Future languages.** French (FLELex), German (DAFlex), Swedish (SVALex), Dutch (NL-Lex), English (EFLLex) all have CEFRLex resources and slot in directly. Japanese, Chinese, and other non-Indo-European languages are out of scope for v1 — they need different morphology and different graded resources (JLPT, HSK), which are tractable but not on the critical path.

## Verification, Failure Modes, and Guardrails

| Failure | Guardrail | Cost |
|---|---|---|
| Director hallucinates a target word not in the scene | Verifier intersects `directive.targetVocab` against `prescription` (which is itself scene-gated) before the constraint reaches `GenerateStage` | Negligible |
| Director CEFR judgment wrong | Frequency sanity check pre-Generate; rolling drift detection vs. classifier verdicts; force recalibration if drift > 1 band over 20 turns | Low |
| Director picks too many new words at A1 | Hard schema constraint pre-call (`introduce.length ≤ levelCap`); post-filter enforces it again | Zero |
| LLM drift from vocabulary constraints in generated prose | Two-layer defense: prompt-tail checklist + verifier middleware. Hard violations (avoid words present) trigger one repair retry; soft misses (reinforce words missed) logged but not regenerated | Low–Medium |
| Director call fails or times out entirely | Deterministic fallback policy synthesizes a directive from the prescription with sensible defaults; marked `isFallbackDirective: true` | Zero |
| Verifier retry budget exhausted | Single retry hard cap; deterministic `autoSimplify` from precompiled substitution dictionary; never serve a line above envelope | Low |
| Author adds content with a lemma missing from CEFRLex | Authoring-time compile pass under `authoring-preview` profile flags it in scene diagnostics; for Italian, falls back to frequency-quantile assignment with a `cefrPriorSource: "frequency-derived"` flag; `review-queue.yaml` for human override | Low |
| Learner trolls the budgeter (hovers everything) | Anti-troll guard: hover-grade dampened when `hoverRate > 0.4` (the saturation point) | Zero |
| Two middlewares fighting over the annotations bag | Namespaced annotations (`sugarlang.*`); reviewable convention; v2 candidate for typed annotation registry | Low |
| Grammatical correctness (subjunctive misuse, agreement errors) | **Out of scope for v1.** LanguageTool integration is a v1.1 follow-up. Documented gap. | n/a |

**Debuggability is a first-class feature.** Every turn produces a complete rationale trace: the Budgeter's candidate set, the FSRS priority scores, the Director's `citedSignals` and `rationale`, the verifier's verdict. A debug panel can replay any turn and show "this is exactly why this lemma was taught right now." Compare this to a pure LLM-Director architecture, where the answer to "why did it teach me this" is "it's in Claude's weights somewhere."

## Why This Is Real ML at the Core

A brutal honest accounting of every component:

| Component | Type |
|---|---|
| FSRS per-lemma memory model | **Fitted model** (FSRS optimizer fits 17 parameters on observed review data; ~30% better than SM-2 on the public Anki/MaiMemo dataset) |
| Bayesian CEFR posterior | **Probabilistic model** (proper Bayesian inference with calibrated uncertainty) |
| CEFRLex band lookup | Frequency lookup (rule, but the data itself is ML-derived from corpora) |
| Envelope rule (0.95 / +1 band) | Rule (citation-backed: Krashen 1985, Nation 2001) |
| Lemma priority score | Linear combination, fixed transparent weights (rule) |
| Observation → FSRS grade mapping | Pure function, total over observation kinds (rule) |
| Director (Claude structured-output) | **Foundation model** used narrowly for taste-shaped judgment |
| Constrained Generator (Claude/SugarAgent) | **Foundation model** used narrowly for prose under constraints |
| Envelope Classifier | Deterministic algorithm |
| Auto-simplify dictionary | Compiled lookup |
| Scene lexicon compilation | Deterministic analysis |

**Two fitted models. Two foundation models. Eight rules.**

Is this "ML at the core"? Yes — but the *honest* kind. The learner model is a calibrated per-lemma memory model, not vaporware. The CEFR estimator is a real Bayesian posterior with uncertainty. The Director is a foundation model used for the *one* thing foundation models are uniquely good at (contextual taste judgment). The rules in the system are explicit, citation-backed, and auditable in isolation — not magic numbers tuned by trial and error.

**The previous failures had it backwards.** The old `policy.ts` had the LLM (or hand-tuned heuristics) trying to make math-shaped decisions (when is this lemma due, how strong is this learner) while having no real model for the taste-shaped decisions (what tone fits this scene). This proposal inverts both: math-shaped decisions get math models (FSRS, Bayes); taste-shaped decisions get a taste model (Claude); each rule in the seam is an explicit citation, not a tuning knob.

A real limitation worth naming: FSRS treats every lemma as independent. It does not learn that mastering Spanish *-ar* verb conjugations should generalize to *-er* verbs, or that knowing *avere* unlocks all the composite tenses. A DKT (Deep Knowledge Tracing) model with cross-lemma structure would fix this — and it is the headline v2 ML upgrade (see "v2 Training Path"). But even the v1 architecture has *real* models doing *real* inference. It is not heuristics in disguise.

## Cost and Latency

**Per-turn LLM call budget:**

- Director: ~0.15–0.30 calls/turn amortized (cached per scene with lifetime invalidation)
- Generator (SugarAgent): 1 call/turn (existing baseline)
- Verifier repair: ~0.25 calls/turn (for the ~25% of turns that need a single retry)

**Total: ~1.40–1.55 LLM calls/turn average.**

**Token budget per call (Claude Sonnet 4.5 at $3/MTok input, $15/MTok output, 90% prompt-cache hit rate within a scene):**

- Director: ~2,400 input (~2,100 cacheable) + ~400 output ≈ $0.0081 warm, $0.0132 cold
- SugarAgent Generate: ~1,650 input + ~250 output ≈ $0.0087
- Verifier repair: ~600 input + ~200 output ≈ $0.0050

**Per turn (short-conversation baseline): ~$0.012.**
**Per turn (power-user, long single-conversation, context grows): ~$0.018.**

The power-user figure reflects that later turns in a long conversation carry a much bigger history window — the Generate call's input token count grows roughly linearly with conversation depth. A player doing 50 turns with a single NPC in one sitting will hit per-turn costs 1.5× the baseline by the end of the conversation. A player doing 5 × 10-turn conversations with different NPCs stays near the baseline because each new conversation resets the history.

Not counted in the figures above but real in production: OpenAI embeddings for SugarAgent's Retrieve stage (~$0.0002/turn, small but nonzero), infrastructure overhead (hosting, Postgres/IndexedDB sync, Stripe fees, support tools) — budget another ~10–15% on top of raw LLM cost for a fully-loaded operating cost. The unit economics section below uses a blended **$0.015/turn** estimate that splits the difference between short and power-user conversations, then loads infra on top.

**Latency targets:**

- Classifier: ≤10ms (in practice ~2ms)
- Budgeter: <1ms
- Director (when fired, ~15-30% of turns): ~600–1,200ms (Sonnet, with prompt caching)
- Generate: ~800–1,200ms (existing)
- Verifier check: ~5ms; repair (when triggered): ~700ms

**Common case (cached directive, no repair): ~1.3s p50.**
**Worst case (Director fires + repair): ~2.6s p95.**

These are well under the 3-second user-perceived chat latency threshold. If latency or cost become binding constraints at scale, the Director can degrade to Haiku (3× faster, 15× cheaper, ~80–85% accuracy on CEFR judgment — sufficient for the narrow taste-shaping role).

## Unit Economics and Pricing

The "Cost and Latency" section above gives raw infrastructure costs. This section builds a unit-economics model on top of them so there is a durable answer to the question "what should I charge and does it pencil out." Snapshot all prices as of Claude Sonnet 4.5 pricing ($3/MTok input, $15/MTok output, 90% prompt-cache hit within a scene); update this section when upstream pricing changes.

### Usage cap

A hard per-player daily turn cap is the load-bearing assumption of the whole business model. Without it, a single obsessive player can do 500+ turns/day and cost more in LLM calls than any reasonable subscription covers. The recommended v1 cap is **50 turns/day per player**. This is enough to support long productive sessions (a 30–45 minute play session typically produces 30–50 NPC turns) without letting worst-case usage blow up unit economics.

### Per-player LLM cost at the cap

Using the blended **~$0.015/turn** figure from the Cost and Latency section:

| Usage pattern | Cost per day | Cost per month (30 days) |
|---|---|---|
| 50 turns/day, short conversations (cheap) | $0.60 | $18.00 |
| 50 turns/day, realistic mix | $0.75 | **$22.00** |
| 50 turns/day, all long single-NPC (expensive) | $0.90 | $27.00 |

Load infrastructure (~15% on top of the realistic mix) → **fully-loaded max-cap cost per player ≈ $25/month.**

This is the worst-case cost for a *single* paying subscriber if they play to the cap every single day of the month. Most subscribers will not.

### Monthly LLM cost at scale (worst case: every subscriber maxed every day)

| Daily active subscribers | Optimistic ($18/user) | Realistic ($22/user) | Power-user ($27/user) |
|---|---|---|---|
| 10 | $180 | $220 | $270 |
| 100 | $1,800 | $2,200 | $2,700 |
| 1,000 | $18,000 | $22,000 | $27,000 |
| 10,000 | $180,000 | $220,000 | $270,000 |

### Pricing for break-even and margin

Per paying subscriber at worst-case max usage, fully-loaded ~$25/month:

| Pricing goal | Formula | Price per user per month |
|---|---|---|
| Break even at max usage | cost × 1.00 | **~$25** |
| 20% markup (profit = 20% of cost) | cost × 1.20 | **~$30** |
| 20% margin (profit / revenue = 20%) | cost / 0.80 | **~$31** |

### The realistic model: blended engagement

Worst-case pricing is how you avoid going underwater on power users. But most subscribers do not max out the cap. Educational and subscription-app telemetry consistently shows blended engagement in the 30–50% range of theoretical max over a 30-day window. Using **40% average engagement** as a reasonable planning assumption:

| DAU engagement | Actual cost per paying subscriber/month | Gross margin at $20 price | Gross margin at $25 price |
|---|---|---|---|
| 100% (the cap) | ~$25 | -$5 (underwater) | 0% (break-even) |
| 60% (engaged) | ~$15 | 25% | 40% |
| 40% (blended realistic) | ~$10 | **50%** | **60%** |
| 20% (casual) | ~$5 | 75% | 80% |

**What this means operationally:** price for the worst case, profit on the blended reality. Power users are bounded by the cap; casual users heavily subsidize them; that is how usage-capped SaaS economics works across the industry. The cap is the insurance policy that lets you price in the $20–25 range without a single heavy user breaking unit economics.

### Market context

| Product | Monthly price | Model type |
|---|---|---|
| Duolingo Super | ~$14/mo | Gamified flashcards, no LLM |
| Babbel | ~$14/mo | Traditional curriculum |
| Rosetta Stone | ~$12/mo | Traditional curriculum |
| Pimsleur | ~$20/mo | Audio-first curriculum |
| ChatGPT Plus | $20/mo | General LLM assistant |
| Claude Pro | $20/mo | General LLM assistant |
| Character.AI c.ai+ | $10/mo | LLM roleplay (no pedagogy) |

Sugarlang at **$20–25/mo** is above the flashcard tier and at parity with general-purpose LLM subscriptions. That positioning is defensible *if* the product genuinely delivers something neither a flashcard app nor a general LLM can: a narrative RPG you learn inside of, with measurable CEFR-level-appropriate input and personalized spaced-repetition baked into the story. The pricing gap over Duolingo is the pitch-and-prove burden of the product, not a cost problem.

### Cost-reduction levers

Real options if the fully-loaded per-user cost needs to come down:

| Lever | Impact on per-turn cost | Product risk |
|---|---|---|
| **Haiku for the Director** (keep Sonnet for Generate) | Saves ~$0.001/turn, tiny | Minimal — Director only reshapes a prescription, narrow task |
| **Haiku for the Generator** | Saves ~$0.006/turn → per-turn drops to ~$0.006 → max-cap cost drops to ~$9/user/month | Significant — NPC voice quality is the product's core experience; Haiku is measurably less natural for long-form character dialogue |
| **Tiered plans** — Sonnet "Premium" at $25, Haiku "Standard" at $12 | Two price points, optimizes per tier | Engineering complexity, two prompts to maintain, clearer marketing burden |
| **Tighter turn cap** (30/day instead of 50) | 40% cost reduction | Product risk — may feel stingy for engaged players; bounds session length |
| **Aggressive prompt caching + shorter history windows** | 10–20% reduction | Bounded context may hurt continuity in very long conversations |
| **Longer Director lifetime** (maxTurns = 10 instead of 3) | Director calls drop ~40% → saves ~$0.0007/turn | Director lags behind fast affective shifts |
| **Distilled small Director** (v2, see below) | Director call ~5× cheaper | Requires 10k+ sessions of training data first — not a launch lever |
| **Distilled small Generator** (long-term v2) | Generate call ~3–5× cheaper | Requires significant training data, eval infra, quality validation — multi-quarter project |

The single biggest lever in v1 is the **Generator model choice** (Sonnet vs Haiku), because Generate runs on every turn. Director optimization is rounding error by comparison. The v2 training path (next section) is the structural path to meaningful cost reduction without sacrificing quality — the distilled Director is a reliable 5× reduction and the distilled Generator is the long-tail structural unlock.

### Recommendation

Launch at **$20/month** subscription with a **50-turn daily cap** and Sonnet in both Director and Generate. This:

- Covers fully-loaded cost at ~80% average engagement (conservative)
- Yields ~50% gross margin at 40% blended engagement (realistic)
- Bounds worst-case power-user cost so no single subscriber goes underwater
- Positions above Duolingo but at parity with ChatGPT Plus — defensible given the product category
- Leaves room to introduce a $12 Haiku-backed Standard tier later if free-tier conversion proves the audience exists
- Keeps the v2 distillation path as the strategic cost lever for year two

Price to the model in the section above, not to this recommendation; the recommendation is the current best guess and the math above is the authoritative source. Revisit whenever (a) upstream LLM pricing changes, (b) 10k sessions of real engagement data exist so the 40% blended assumption can be validated, or (c) a v2 distilled model ships and changes the per-turn cost floor.

## v2 Training Path

The architecture is designed so every component upgrades behind the ADR 010 provider boundaries without rewriting the rest. After ~10k sessions of `(scene_context, prescription, directive, turn_outcome, learner_progression)` traces collected by the existing telemetry hooks, four upgrades become possible:

| Upgrade | Data needed | Approach | Replaces |
|---|---|---|---|
| **Director distillation** | High-quality directives (correlated with positive learning outcomes, no code-switch-to-L1, low frustration) | Fine-tune Haiku or open-source 7B (Qwen-2.5, Llama-3.1) on (context → directive) pairs; offline A/B held-out eval | The Sonnet Director call (3–5× cost reduction) |
| **Cross-lemma DKT** | All `LemmaObservation` traces with scene context | Standard LSTM DKT or small Transformer-based knowledge tracer; emits per-lemma knowledge probabilities | The independent FSRS card per lemma |
| **Context-aware CEFR classifier** | Human-labeled in-level/out-of-level turn pairs | Fine-tune small bi-encoder (~5M params) | Augments (does not replace) the deterministic CEFRLex classifier |
| **Reward model on directives** | (directive, next 5 turns, learner progression) → scalar | Train reward model; fine-tune Director with RLHF/DPO to optimize for learner progression | Prompt-engineering iteration on the Director |

The most valuable v2 upgrade is the **DKT cross-lemma model**, because it removes the v1 architecture's largest limitation (lemma independence). The most pragmatic v2 upgrade is the **Director distillation**, because it directly cuts cost and latency.

The data-collection hooks for all four upgrades exist in v1 — every `LemmaObservation`, `LexicalRationale`, and Director output is logged with session and turn context. The training pipeline is a v2 task; the production system is a training data factory from day one.

## File Structure

(Sketch — exact filenames are an implementation-ticket concern.)

```
packages/plugins/src/catalog/sugarlang/
├── index.ts                         # plugin registration, contributions, deployment requirements
├── docs/
│   └── proposals/
│       └── 001-adaptive-language-learning-architecture.md   # this file
├── runtime/
│   ├── types.ts                     # LemmaRef, LemmaCard, LearnerProfile, LexicalPrescription, PedagogicalDirective, EnvelopeVerdict
│   ├── budgeter/                    # Lexical Budgeter — the FSRS-driven scheduler
│   ├── classifier/                  # Envelope Classifier — deterministic
│   ├── director/                    # Director — Claude structured-output call + cache + fallback
│   ├── learner/                     # LearnerStateReducer, Bayesian CEFR posterior, persistence
│   ├── middlewares/                 # SugarLangContext / Director / Verify / Observe middlewares
│   ├── compile/                     # CompiledSceneLexicon build step
│   └── providers/                   # ADR 010 boundaries: LexicalAtlasProvider, LearnerPriorProvider, DirectorPolicy
├── data/
│   └── languages/
│       ├── es/                      # ELELex + morphology + simplifications + placement questionnaire
│       └── it/                      # Kelly + frequency-derived + morphology + placement questionnaire
└── (no top-level compiled/ directory — see "Compiled artifacts live outside the plugin" note below)
```

**Compiled artifacts live outside the plugin source tree.** The plugin source tree does NOT contain a `compiled/` directory. Compiled scene lexicons live in exactly three places, none of which are inside the plugin source tree:

1. **Studio and Preview runtime cache** — browser IndexedDB, managed by `IndexedDBCompileCache` (Epic 6 Story 6.5). Keyed by content hash. Survives Studio reloads. Scoped per-workspace.
2. **Preview runtime fallback cache** — in-memory `Map`, managed by `MemoryCompileCache` (Epic 6 Story 6.4). Used when IndexedDB is unavailable. Scoped per-preview-session.
3. **Published game bundle** — at publish time the publish pipeline (Epic 6 Story 6.10) writes per-scene compiled lexicons into the *published game's* bundle at the path `compiled/sugarlang/scenes/<sceneId>.lexicon.json.gz`. Critically, this `compiled/` directory is **inside the published game's output**, NOT inside the sugarlang plugin source tree. It's a per-project artifact produced at publish time and shipped with the published game.

The plugin itself does not precompile anything at its own build time. The `data/languages/<lang>/*.json` files are already in their runtime-ready form — they are loaded and parsed on demand at runtime. Scene lexicons are per-project content by definition (they're derived from the project's authored scenes), so they cannot live inside the plugin source tree.

**If during implementation you see code writing to `packages/plugins/src/catalog/sugarlang/compiled/`, that is a bug.** The plugin has no such directory in any storage tier.

The single SugarAgent modification site is `packages/plugins/src/catalog/sugaragent/runtime/stages/GenerateStage.ts`, ~6 lines to read `execution.annotations["sugarlang.constraint"]`.

## Alternatives Considered

Two other architectures were seriously planned and rejected. Both are documented here so this question does not need to be re-litigated from scratch in 12 months.

### Alternative A: Pure Scheduler + Classifier + LLM-as-Prose-Generator

**What it is.** The same Lexical Budgeter and Envelope Classifier from this proposal, but **no Director**. The Budgeter's raw prescription flows directly into SugarAgent's `GenerateStage` constraint splice. Posture and glossing strategy are derived from a small set of rules over the learner state (cold-start → anchored, low confidence → supported, high confidence → target-dominant).

**Strongest argument for.** It is the cheapest, fastest-to-ship, most deterministic, most debuggable option. ~$0.010/turn, p50 ~1.5s, ~1 LLM call/turn average. Real unit tests are possible — given a learner state and a scene, the prescription is byte-identical across runs. A solo dev could ship it in a week. The ML in this version (FSRS, Bayesian CEFR, Krashen-anchored envelope rule) is already real, calibrated, citation-backed.

**Why rejected.** It loses the *narrative-pedagogy coupling* that is the unique reason to build this in an RPG instead of in Anki. The Budgeter cannot know that "peligroso" — even if it's the highest-priority due lemma — is tonally wrong for a gentle family scene. It cannot know that "espada" should be re-ranked to the top in a battle scene because it's the dramatic anchor. Pure-scheduler turns are pedagogically optimal but narratively flat. After enough hours, players notice that the language teacher has no sense of story. The user explicitly asked to "dream big but reasonable" and to push the envelope of what an RPG-as-language-teacher can be — pure scheduler is 80% of the value at 10% of the runtime cost, but it's the wrong 80%. It optimizes a game you could already buy. The hybrid keeps almost all of pure scheduler's wins (debuggability, cost, determinism in the core) and adds the one thing pure scheduler cannot do (narrative-shaped pedagogy) for a small marginal cost.

### Alternative B: Pure LLM-as-Director

**What it is.** A single Claude structured-output call drives all pedagogy decisions per scene (or per N turns) — `targetVocab`, posture, style, glossing, comprehension check — given a curated context window of learner state, scene, and authored teaching material. There is no scheduler doing math under it. FSRS may exist as a downstream "where in the timeline" helper, but it is not the source of truth on what to teach. A deterministic verifier runs on generated prose. ~$0.012/turn amortized, p50 ~1.9s, ~1.4 LLM calls/turn.

**Strongest argument for.** It is the boldest expression of "ML at the core," because it places foundation-model judgment at the very center of pedagogy. It handles every scene, learner type, language, and pedagogical situation through the same mechanism — there is no language-specific code path, no per-band rule table, no posture decision tree. It gracefully handles cold start, affective shifts, and narrative arcs with no special-case code. The Director's outputs are structured training data from day one, enabling a clean v2 distillation path to a smaller learned policy.

**Why rejected.** The honest risk is that the combinatorial mess simply *migrates* from if-statements into prompt clauses. The team will spend months tuning the Director prompt — adjusting rubric phrasing, fiddling with which signals to include, hedging against new failure modes — exactly like they did with the old `policy.ts`. The "magic numbers" of the previous attempt become "magic prompt incantations" of this attempt, and prompts degrade silently on model upgrades. There is no way to write a real unit test for "given learner state X and scene Y, the directive must contain Z" — the best you can do is run the LLM ten times and hope the average behavior is right. Latency and cost are higher than the hybrid for marginal pedagogical gain (the hybrid already has Director judgment per scene). And critically: the Director with no scheduler underneath has no source of truth on lemma due-ness — it relies on the LLM to "remember" which words the learner has seen and how recently, which is a place LLMs are documented to be unreliable. The hybrid keeps Director judgment exactly where it adds value (narrative shaping per scene) and offloads the math to a math model (FSRS) where the model already exists, is calibrated, and has been peer-reviewed.

## Open Questions and Out-of-Scope for v1

- **Grammatical correctness validation.** The classifier checks vocabulary in-envelope; it does not check that the player's free-text production is grammatically well-formed. LanguageTool integration is the v1.1 plan (open-source, rule-based, ~92% recall on ES/IT/FR/DE).
- **Cross-lemma transfer.** FSRS treats lemmas independently. The DKT-based v2 upgrade is the right fix; v1 ships with the limitation acknowledged.
- **Narrative-overlay rewriting if turns feel flat.** If post-launch data shows learners bouncing off mechanically-correct-but-emotionally-flat turns, an optional narrative-overlay middleware can rewrite an in-envelope turn for tonal lift without changing vocabulary. This is a small (~200 line) addition to a working system, not a v1 commitment.
- **Annotation registry.** The `execution.annotations` namespace convention is a reviewable convention today, not type-system enforced. A v2 typed annotation registry is a candidate cleanup once more plugins use the seam.
- **Out-of-scope languages.** Japanese, Chinese, Korean, Arabic — all tractable but require non-CEFRLex graded resources and different morphology. Not on the v1 critical path.
- **Migration of existing learner data.** This is a clean rebuild; there is no production user data to migrate. If this were an upgrade in production, a separate migration ADR would be required.

## Verification and Acceptance

The architecture is acceptable when:

1. A learner can complete a 20-turn conversation with an NPC entirely in the target language at their CEFR level, with at most 2 hover-required words per turn, and with at least 1 new lemma introduced and 2 reinforced per scene.
2. The Envelope Classifier verdict on every turn shown to the player is `withinEnvelope = true`. (This is a hard invariant, not a target metric.)
3. Cold-start placement converges to within ±1 CEFR band of true level by turn 8 of the diegetic placement scene, on a synthetic test corpus of learner-response simulations.
4. The total amortized cost per turn at the recommended Sonnet pricing is ≤ $0.015.
5. Every turn produces a complete rationale trace consumable by the debug panel: budgeter inputs, FSRS scores, director rationale and `citedSignals`, verifier verdict.
6. Adding a new language (English, French, German) to the v1 plugin is a data-directory addition with zero changes to runtime code, validated end-to-end by a smoke test.
7. The plugin can be disabled (or simply not installed) without affecting any other Sugarmagic plugin or breaking any test.
8. **Hitting Preview never triggers a full rebuild of all scene lexicons.** With a warm authoring cache (the common case after a few minutes of editing), Preview start is bounded by the postMessage handoff plus lazy compile of any scenes whose hash actually drifted. With a cold cache (first-ever Preview after a clone), Preview start is bounded by eager compile of the start scene and its immediate neighbors only — every other scene compiles on first scene-enter. Cache hit rate during normal authoring sessions should be ≥95%.
9. The same `compileSugarlangScene` function is the only entry point used by `authoring-preview`, `runtime-preview`, and `published-target` profiles. There are zero forks of compile logic across profiles.
