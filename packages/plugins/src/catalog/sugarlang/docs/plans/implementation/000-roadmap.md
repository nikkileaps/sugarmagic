# Sugarlang Implementation Roadmap

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001: Adaptive Language Learning Architecture](../../proposals/001-adaptive-language-learning-architecture.md)

## Purpose

This roadmap enumerates the 15 implementation epics required to ship the sugarlang plugin v1 per Proposal 001. Each epic lives in its own plan file in this directory. Each epic contains child stories. Each story that does work includes a tests-required and api-documentation-update step. The roadmap defines the ordering, the dependency graph, and the points where parallel work is possible.

**This roadmap is the authoritative sequencing document.** If an epic plan file and this roadmap disagree, fix the disagreement — don't quietly let them drift.

## Gating Rule

**Epic 1 (Skeleton) ends with a mandatory stop-and-review by QA before any other epic begins.** This is a hard gate, not a suggestion. The skeleton is cheap to reshape before any real code lands and expensive to reshape after. The QA review catches directory-layout and naming mistakes while they're still free to fix.

No epic after Epic 1 may begin until the skeleton review is signed off by a QA engineer.

## The 15 Epics

| # | Epic | One-line purpose | Blocks | Parallelizable with |
|---|---|---|---|---|
| 1 | [Skeleton](001-epic-skeleton.md) | Directory tree, file stubs with header comments, plugin registration, **stop-for-QA gate** | All | — |
| 2 | [Domain Prerequisites](002-epic-domain-prerequisites.md) | `NPCDefinition.metadata` field + propagation into `ConversationSelectionContext.metadata` | 10, 11 | 3, 4 |
| 3 | [Contracts and Types](003-epic-contracts-and-types.md) | All TypeScript interfaces; ADR 010 provider interfaces; `LexicalChunk` type shipped for Epic 14 | 5–11, 14 | 2, 4 |
| 4 | [Language Data Foundation](004-epic-language-data-foundation.md) | ELELex import (Spanish); Italian derived frequency; morphology; placement banks; simplifications | 5, 6, 8, 9, 11 | 2, 3 |
| 5 | [Envelope Classifier](005-epic-envelope-classifier.md) | Deterministic tokenize → lemmatize → coverage → envelope rule (chunk-scan pre-pass added in Epic 14) | 10, 14 | 6, 7, 8 (partial) |
| 6 | [Scene Lexicon Compilation](006-epic-scene-lexicon-compilation.md) | `compileSugarlangScene`, cache, content hashing, **Preview-first incremental pipeline** (chunk extractor integrates in Epic 14) | 8, 10, 14 | 5, 7 |
| 7 | [Learner State and Persistence](007-epic-learner-state-and-persistence.md) | `LearnerProfile`, Bayesian CEFR posterior, reducer, blackboard facts, card paging | 8, 9, 10, 11 | 5, 6 |
| 8 | [Lexical Budgeter](008-epic-lexical-budgeter.md) | FSRS scheduler, scene→envelope→priority funnel, observation→grade mapping | 9, 10 | — |
| 9 | [Director](009-epic-director.md) | Claude structured-output wrapper, prompt builder, cache, fallback, minimal post-placement calibration hint | 10, 14 | — |
| 10 | [Middleware Pipeline and SugarAgent Integration](010-epic-middleware-pipeline-and-sugaragent-integration.md) | Four middlewares + 6-line `GenerateStage` splice | 11, 13, 14, 15 | — |
| 11 | [Cold Start and Placement Capability](011-epic-cold-start-and-placement-capability.md) | Plugin-owned questionnaire UI, deterministic scoring engine, three-phase flow orchestrator, `QuestManager` integration, replay inertness | 15 | 12 |
| 12 | [Editor UX Contributions](012-epic-editor-ux-contributions.md) | NPC inspector dropdown, manual rebuild button, density histogram, placement bank viewer | 15 | 11, 13 |
| 13 | [Telemetry and Debug Panel](013-epic-telemetry-and-debug-panel.md) | Event logging sink, rationale trace emitter, debug panel data, v2 training data readiness (chunk events added in Epic 14) | 14, 15 | 11, 12 |
| 14 | [Lexical Chunk Awareness](014-epic-lexical-chunk-awareness.md) | LLM-as-metadata-author at bake time: extractor, cache, tier-2 scheduler, publish integration, classifier chunk-scan pass | 15 | — |
| 15 | [End-to-end Integration Tests](015-epic-end-to-end-integration-tests.md) | Golden scenarios (placement, steady state, Swain, chunks, probe, deadlock), Preview cache hit rate benchmark, cost/latency measurements | — | — |

**Table notation:** "Blocks" lists epics that must wait for this one. "Parallelizable with" lists epics that CAN run concurrently (though they may also have other dependencies of their own). An epic blocked by Epic 1 may still be listed as "parallelizable" with another epic if both depend on Epic 1 but not on each other.

## Dependency Graph

```
Epic 1 (Skeleton)
    │ STOP FOR QA REVIEW
    ▼
    ├─ Epic 2 (Domain Prereqs) ──┐
    │                            │
    ├─ Epic 3 (Contracts) ───────┤
    │                            │
    └─ Epic 4 (Lang Data) ───────┤
                                 ▼
                    ┌─────── Epic 5 (Classifier)
                    ├─────── Epic 6 (Scene Compile)
                    ├─────── Epic 7 (Learner State)
                    └─────── Epic 8 (Budgeter) ──┐
                                                 │
                                    Epic 9 (Director) ─┐
                                                       │
                            Epic 10 (Middleware + Integration) ──┐
                                                                 │
                                    Epic 11 (Placement) ─────────┤
                                    Epic 12 (Editor UX) ─────────┤
                                    Epic 13 (Telemetry) ─────────┤
                                                                 │
                                    Epic 14 (Chunk Awareness) ───┤
                                                                 ▼
                                                  Epic 15 (E2E Tests)
```

## Suggested Execution Order

The dependency graph permits several valid serializations. The recommended order:

1. **Epic 1** → QA review → proceed
2. **Epics 2, 3, 4 in parallel** (a single-dev branch per epic is fine) — these are independent groundwork
3. **Epics 5, 6, 7 in parallel** — the three deterministic-layer components that don't depend on each other
4. **Epic 8 (Budgeter)** — depends on 3, 4, 7; consumes Classifier results from 5 and scene lexicons from 6
5. **Epic 9 (Director)** — depends on 3, 4, 7, 8; the heaviest LLM-integration work
6. **Epic 10 (Middleware)** — integrates everything and splices into SugarAgent. This is the riskiest epic; expect iteration
7. **Epics 11, 12, 13 in parallel** — placement, editor UX, and telemetry are independent surfaces over the now-assembled middleware
8. **Epic 14 (Chunk Awareness)** — depends on 3, 5, 6, 9, 13; the offline LLM-as-metadata-author layer. Reuses Epic 9's schema-parser pattern and Epic 6's content-hash cache discipline. Runs after the core pipeline is stable so the regression baseline is clear.
9. **Epic 15 (E2E Tests)** — validates the full stack with golden scenarios including the chunk feedback loop

## What "Done" Means for an Epic

An epic is done when **every one of its stories is done**. A story is done when **all three** of the following are true:

1. **Implementation is complete** — the code matches the story's acceptance criteria
2. **Tests are written and passing** — per the story's "Tests Required" subsection, usually including unit tests, integration tests where applicable, and (for Epic 14) end-to-end scenario tests
3. **API documentation is updated** — the relevant file(s) under `docs/api/` are updated with implementation details for other developers consuming or extending the sugarlang plugin

If any one of these three is incomplete, the story is not done and the epic is not done. No exceptions.

## Cross-cutting concerns

Some architectural concerns touch multiple epics. Listed here so they are findable as a single thread when reviewing.

### Receptive vs. productive knowledge (Swain's Output Hypothesis)

Sugarlang carries two strength signals per lemma: the FSRS `stability` (receptive, Krashen input) and a separate `productiveStrength: number` (Swain output). This distinction cuts across:

- **Epic 3 Story 3.2** — `LemmaCard.productiveStrength` field and `INITIAL_PRODUCTIVE_STRENGTH` constant
- **Epic 3 Story 3.1** — the `InteractionStyle` enum includes `elicitation_mode` for production-prompting turns
- **Epic 3 Story 3.6** — `ObservationKind` splits production into four subkinds: `produced-typed`, `produced-chosen`, `produced-unprompted`, `produced-incorrect`
- **Epic 8 Story 8.1** — `fsrs-adapter.ts` owns `applyOutcome` and `decayProductiveStrength`
- **Epic 8 Story 8.2** — `observations.ts` has the eight-kind rule table with `PRODUCTIVE_DELTAS` constants
- **Epic 8 Story 8.3** — `scoring.ts` includes `w_prodgap` term so recognized-but-not-producible lemmas rank as reinforce targets
- **Epic 10 Story 10.5** — `SugarLangObserveMiddleware` classifies input context into the correct production subkind (prompted vs voluntary, typed vs chosen vs incorrect form)
- **Epic 15 Story 15.3** — the Swain feedback loop golden scenario that exercises the full loop end-to-end and functions as the single canonical behavioral regression guard for the split

See Proposal 001 § Receptive vs. Productive Knowledge for the theoretical justification and the rule table.

### Lexical chunk awareness (LLM-as-metadata-author)

The envelope classifier stiffens on idiomatic multi-word sequences when individual constituent lemmas look high-band even though the chunk as a whole is simple. Sugarlang solves this with an offline LLM extractor that runs at scene lexicon compile time, produces a per-scene chunk manifest, and is cached by content hash. The classifier reads the manifest deterministically at runtime via a pre-pass that runs before lemmatization. This concern cuts across:

- **Epic 3 Story 3.5** — `LexicalChunk` type and `CompiledSceneLexicon.chunks?: LexicalChunk[]` field (shipped in Epic 3 so downstream code can reference it from day one)
- **Epic 5 Story 5.3** — coverage pipeline is structured as discrete steps to allow Epic 14's chunk-scan pre-pass to be inserted cleanly without refactoring
- **Epic 6 Story 6.6** — authoring scheduler is designed with a tier-2 extension hook for Epic 14's background extraction
- **Epic 6 Story 6.10** — publish path is designed as a sequenced pipeline so Epic 14 can insert the synchronous extraction step
- **Epic 13 Story 13.1** — telemetry event schema is designed with additive discriminated unions so Epic 14 can add chunk-related event kinds
- **Epic 14 Story 14.1** — `extract-chunks.ts` (LLM-based extractor)
- **Epic 14 Story 14.2** — `chunk-cache.ts` (content-hash cache + drift detection)
- **Epic 14 Story 14.3** — tier-2 background authoring chunk extraction (scheduler integration)
- **Epic 14 Story 14.4** — synchronous chunk extraction in the publish path
- **Epic 14 Story 14.5** — envelope classifier chunk-scan pre-pass
- **Epic 14 Story 14.6** — telemetry event kinds for chunks
- **Epic 15 Story 15.4** — dedicated golden scenario test for the chunk feedback loop
- *These all work together: Epic 3 defines the types, Epic 14 implements the full pipeline (extractor + cache + scheduler + publish + classifier integration), and Epic 15 validates the end-to-end behavior.*

See Proposal 001 § Lexical Chunk Awareness (LLM-as-Metadata-Author) for the architectural rules, the failure modes, the cost model, and the discipline that keeps the runtime deterministic while allowing LLM flexibility at bake time.

### Observer Latency Bias and comprehension checks

In a 3D RPG, "read past without hovering" is not reliable evidence of comprehension — it could mean the player skimmed, was in a hurry, or was mentally in the next quest. Committing FSRS stability updates on that signal silently inflates a learner's mastery scores and corrupts downstream scheduling. Sugarlang separates committed evidence from provisional evidence: `rapid-advance` observations accumulate to `LemmaCard.provisionalEvidence` without touching FSRS, and an in-character comprehension probe (driven by the Director or enforced by a hard middleware floor) converts provisional to committed on pass, or discards it on fail. Visibility into this mechanism is first-class — every probe's full lifecycle (triggered → fired → response → passed/failed → committed/discarded) is captured in dedicated telemetry events and surfaced in a Studio-side debug panel so developers can audit and tune without guesswork.

This concern cuts across:

- **Epic 3 Story 3.1** — `ComprehensionCheckSpec` and `ProbeTriggerReason` types; `SugarlangConstraint.comprehensionCheckInFlight` sub-field for the Generator splice
- **Epic 3 Story 3.2** — `LemmaCard.provisionalEvidence` and `provisionalEvidenceFirstSeenTurn` fields; `PROVISIONAL_EVIDENCE_MAX` and `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD` constants
- **Epic 3 Story 3.7** — `DirectorContext.pendingProvisionalLemmas` and `probeFloorState` fields
- **Epic 7 Story 7.5** — reducer events for `CommitProvisionalEvidenceEvent`, `DiscardProvisionalEvidenceEvent`, `DecayProvisionalEvidenceEvent`; the rapid-advance path in `ObservationEvent` handling
- **Epic 8 Story 8.1** — FSRS adapter gains `commitProvisionalEvidence`, `discardProvisionalEvidence`, `decayProvisionalEvidence` methods; `applyOutcome` handles the new `provisionalEvidenceDelta` field on `ObservationOutcome`
- **Epic 8 Story 8.2** — `rapid-advance` observation rule changed from "Good" receptive grade to `null` receptive + provisional evidence delta; `computeProvisionalEvidenceDelta(dwellMs)` helper; regression guard tests against silent revert
- **Epic 9 Story 9.1** — Director prompt gains the comprehension-check guidance block and the dynamic `pendingProvisionalLemmas` + `probeFloorState` section; character-voice-not-in-narrative framing
- **Epic 9 Story 9.2** — schema-parser enforces the hard-floor flag and target-lemma validation against the pending list
- **Epic 9 Story 9.4** — `FallbackDirectorPolicy` honors soft and hard floors unconditionally
- **Epic 10 Story 10.1** — Context middleware computes `pendingProvisionalLemmas` and `probeFloorState`, runs the decay reducer event, tracks `turnsSinceLastProbe`
- **Epic 10 Story 10.2** — Director middleware builds the extended `DirectorContext` and populates `SugarlangConstraint.comprehensionCheckInFlight`
- **Epic 10 Story 10.3** — SugarAgent `GenerateStage` splice injects the probe instruction block when `comprehensionCheckInFlight` is present
- **Epic 10 Story 10.5** — Observer middleware recognizes probe-in-flight, classifies player responses, calls commit/discard reducer events
- **Epic 13 Story 13.1** — 11 new telemetry event kinds under `comprehension.*` and `fsrs.provisional-*` namespaces, all sharing a `probeId` for lifecycle joins
- **Epic 13 Story 13.5b** — Comprehension Check Monitor debug panel with live probe feed, session rollup metrics, rate/silence alerts, per-NPC and per-lemma drill-downs
- **Epic 15 Story 15.5** — speed-reader probe feedback loop golden scenario: the canonical behavioral regression guard that proves rapid-advance never touches FSRS, that commit/discard both work, and that the hard floor enforces itself even when the Director LLM ignores the instruction

See Proposal 001 § Observer Latency Bias and In-Character Comprehension Checks for the theoretical justification, the rule table, the probe trigger state machine, the character-voice framing (probes stay in character, not in narrative), and the visibility-first discipline that makes this mechanism tunable post-launch.

**Historical correction:** earlier drafts of this plan (during the Swain retrofit) incorrectly mapped `rapid-advance` observations to an FSRS `"Good"` receptive grade. That was a silent-corruption bug because speed-reading is indistinguishable from ignored dialog, and committing FSRS stability based on it inflates the learner's perceived mastery. The corrected rule routes `rapid-advance` into the provisional-evidence system (null receptive grade + provisional delta weighted by dwell time), and Epic 15 Story 15.5 (Speed-reader probe feedback loop golden scenario) is the canonical behavioral regression guard against accidental reverts. Do not weaken or delete that test.

### Quest-Essential Lemma Exemption (the Linguistic Deadlock fix)

The envelope classifier's "no lemma above learnerBand + 1" rule creates a deadlock for quest-critical vocabulary: an A1 learner with an active "Investigate the Ethereal Altar" objective cannot be told what to do because *altar* and *ethereal* are both individually above A1+1 and cannot be simplified without losing the quest meaning. Sugarlang fixes this with a classifier-level exemption scoped to lemmas from currently-active quest objective text, paired with a forced parenthetical-glossing requirement so the player still understands what they're seeing. The exemption is driven entirely by existing authored content (quest objective display text) — no manual curation, no static allowlist. This concern cuts across:

- **Epic 3 Story 3.5** — `QuestEssentialLemma` type, `CompiledSceneLexicon.questEssentialLemmas` field
- **Epic 3 Story 3.4** — `EnvelopeRuleOptions.questEssentialLemmas` and `CoverageProfile.questEssentialLemmasMatched` fields; `EnvelopeVerdict.exemptionsApplied` field so telemetry can attribute which exemption saved which lemma
- **Epic 3 Story 3.7** — `DirectorContext.activeQuestEssentialLemmas` and `ActiveQuestEssentialLemma` type
- **Epic 3 Story 3.1** — `SugarlangConstraint.questEssentialLemmas` sub-field the Generator splice reads
- **Epic 5 Story 5.4** — envelope rule gains the new exemption clause; Linguistic Deadlock regression guard test using the canonical Ethereal Altar fixture
- **Epic 5 Story 5.5** — `EnvelopeClassifier.check` accepts `questEssentialLemmas` as an option
- **Epic 6 Story 6.1** — `scene-traversal` emits `"quest-objective-display-name"` and `"quest-objective"` blob kinds for quest text
- **Epic 6 Story 6.3** — `compileSugarlangScene` tags content lemmas from quest objective display text as quest-essential and emits them; authoring-preview diagnostic for deadlock-prone objectives (5+ high-band lemmas in one objective)
- **Epic 8 Story 8.4** — `LexicalBudgeter` excludes quest-essential lemmas from its normal candidate set (they flow through a separate channel, don't consume introduce/reinforce slots)
- **Epic 9 Story 9.1** — Director prompt gains the static quest-essential guidance block (cacheable) and the dynamic `activeQuestEssentialLemmas` section with examples of good/bad parenthetical glossing
- **Epic 9 Story 9.2** — schema-parser enforces `glossingStrategy` must be `"parenthetical"` or `"inline"` when quest-essential lemmas are present; strips quest-essential lemmas from `targetVocab` contamination
- **Epic 9 Story 9.4** — `FallbackDirectorPolicy` defaults to `glossingStrategy: "parenthetical"` when quest-essential is non-empty
- **Epic 10 Story 10.1** — Context middleware filters scene-level `questEssentialLemmas` to currently-active objectives via `runtimeContext.activeQuestObjectives`, writes two annotations (`activeQuestEssentialLemmas` and `questEssentialLemmaIds`)
- **Epic 10 Story 10.2** — Director middleware propagates quest-essential into `DirectorContext` and the final `SugarlangConstraint`
- **Epic 10 Story 10.3** — SugarAgent Generator splice injects the mandatory parenthetical-glossing instruction block when `constraint.questEssentialLemmas` is non-empty
- **Epic 10 Story 10.4** — Verify middleware passes `questEssentialLemmas` to the classifier, checks the generated text for missing parenthetical glosses, and triggers a repair for missing-gloss or missing-required-lemma cases
- **Epic 13 Story 13.1** — six new telemetry event kinds under `quest-essential.*` namespace (classifier-exempted-lemma, director-forced-glossing, director-targetvocab-contamination, generator-missed-gloss, generator-missed-required, compile-diagnostic-deadlock-prone)
- **Epic 13 Story 13.4** — `RationaleTrace.questEssentialState` field joins quest-essential events per turn for the debug panel
- **Epic 15 Story 15.6** — Ethereal Altar linguistic deadlock golden scenario with 11 phases covering compile-time tagging, runtime filtering, Budgeter exclusion, Director glossing enforcement, schema-parser rejection of weak glossing, Generator parenthetical production, classifier exemption, Verify gloss check, missing-gloss repair, missing-required-lemma repair, and graceful degradation when no active objectives

See Proposal 001 § Quest-Essential Lemma Exemption (the Linguistic Deadlock fix) for the problem statement, the architectural rules, the separate-channel discipline, and why the fix lives in the classifier exemption clause rather than in auto-simplify or a runtime rewrite.

## Conventions for All Epic Files

Every epic plan in this directory follows the same structure:

- **Header** with status, date, epic number, and the proposal it derives from
- **Context / Why This Epic Exists**
- **Prerequisites** — which previous epics must be complete
- **Success Criteria** — how we know the epic is done
- **Stories** — child stories with:
  - Purpose
  - Tasks (when non-obvious)
  - Tests Required (unit + integration as appropriate)
  - API Documentation Update (path + what to document)
  - Acceptance Criteria
- **Risks and Open Questions** — things that might bite us
- **Exit Criteria** — how to know the epic is truly done

## Where Things Live

| Concern | Path |
|---|---|
| Implementation plans (this directory) | `packages/plugins/src/catalog/sugarlang/docs/plans/implementation/` |
| Content plans (derived from the arch) | `packages/plugins/src/catalog/sugarlang/docs/plans/` |
| Architecture proposals | `packages/plugins/src/catalog/sugarlang/docs/proposals/` |
| API documentation updates | `packages/plugins/src/catalog/sugarlang/docs/api/` |
| Plugin source code | `packages/plugins/src/catalog/sugarlang/` (runtime, contracts, data, etc.) |
| Plugin tests | `packages/plugins/src/catalog/sugarlang/tests/` (unit) plus `packages/testing/` (integration where cross-plugin) |
| Domain model changes (Epic 2 only) | `packages/domain/` (outside the plugin; separate PR discipline) |

## Status Tracking

Each epic file's header carries a `Status:` field. Valid values:

- `Proposed` — plan written, not yet started
- `In Progress` — work has begun
- `Blocked` — waiting on an external dependency or unresolved question
- `Awaiting Review` — work complete, waiting on QA sign-off
- `Complete` — QA signed off, epic is done

All epic files ship at `Status: Proposed`. Epic 1 specifically has the `Awaiting Review` phase baked into its exit criteria (the QA gate).
