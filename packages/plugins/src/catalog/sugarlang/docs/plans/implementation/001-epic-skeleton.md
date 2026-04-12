# Epic 1: Skeleton

**Status:** Awaiting Review
**Date:** 2026-04-09
**Derives from:** [Proposal 001: Adaptive Language Learning Architecture](../../proposals/001-adaptive-language-learning-architecture.md)
**Blocks:** every other epic in the roadmap

## Context

Before any real code is written, we need a directory layout we can live with. Previous attempts at sugarlang spent weeks refactoring file locations because the shape grew organically and kept drifting. This time we draw the skeleton up front, get a second pair of eyes on it, and THEN start filling it in. A skeleton that's wrong is cheap to fix. A half-built plugin that's wrong is expensive.

This epic creates every directory and every file sugarlang will ship with. Each file is empty (or near-empty) but carries a **top-of-file comment block** that explains:

1. **What this file is** (its purpose in one sentence)
2. **What it exports** (the public API it will own)
3. **How it relates to the rest of the plugin** (the other files it talks to)
4. **Which part of Proposal 001 it implements** (section reference)

The `AGENTS.md` "Documentation Rules" are explicit: *"Every file should have a comment block at the top explaining what that file does and how it relates to the rest of the program."* This epic makes those comment blocks the very first thing that gets written, so every subsequent epic is filling in a file whose purpose is already documented.

## Why This Epic Exists

- **Avoid drift.** Sugarlang past attempts had files like `policy.ts`, `curate.ts`, `observe.ts`, `recognize.ts`, `director.ts` that overlapped in meaning and fought each other. Drawing the skeleton from the proposal *and getting QA review before writing any logic* prevents that class of mistake.
- **Give QA a cheap review surface.** Reviewing a skeleton (directory tree + file headers) takes 30 minutes. Reviewing a half-built plugin takes days and finds problems late.
- **Lock the public API shape.** The file headers are a rough API contract. Once QA signs off on the skeleton, downstream epics know exactly where new symbols go.
- **Satisfy `AGENTS.md`.** "Every file should have a comment block at the top." Establish the habit on day one.

## Prerequisites

- Proposal 001 is approved and stable
- The sugarlang plugin directory `packages/plugins/src/catalog/sugarlang/` exists
- No previous epics (this is the first)

## Success Criteria

- Every file listed in the "Skeleton Tree" below exists
- Every file has a top-of-file comment block per the "File Header Template"
- The plugin directory compiles (no TypeScript errors) with the skeleton in place
- A `docs/api/README.md` index file lists the intended API documentation files for downstream epics to update
- A QA engineer has reviewed the full skeleton and signed off
- **No business logic exists yet.** Files are stubs only

## File Header Template

Every file created in this epic begins with the following comment block, filled in for that specific file:

```ts
/**
 * {{relative-path}}
 *
 * Purpose: {{one-sentence description of what this file is}}
 *
 * Exports: {{the public symbols this file will own — list form}}
 *
 * Relationships:
 *   - {{file or module this depends on}}
 *   - {{file or module that depends on this}}
 *
 * Implements: Proposal 001 §{{section reference}}
 *
 * Status: skeleton (no implementation yet; see Epic {{N}})
 */
```

For data files (JSON, JSON5, YAML), the equivalent header goes in a sibling `README.md` in the same directory.

For React/TSX shell contribution files, the header uses the same format with a JSX-compatible comment.

## Skeleton Tree

Target directory layout:

```
packages/plugins/src/catalog/sugarlang/
├── index.ts                                  # Plugin entry point + registration
├── manifest.ts                               # DiscoveredPluginDefinition manifest
├── config.ts                                 # SugarLangPluginConfig + normalization
├── README.md                                 # Plugin-level README
│
├── docs/                                     # (already exists)
│   ├── proposals/                            # (already exists)
│   ├── plans/                                # (already exists)
│   └── api/
│       ├── README.md                         # API doc index (what each doc covers)
│       ├── budgeter.md                       # Budgeter API reference
│       ├── classifier.md                     # Classifier API reference
│       ├── director.md                       # Director API reference
│       ├── learner-state.md                  # Learner state + persistence API
│       ├── scene-lexicon-compilation.md      # Compiler + cache API
│       ├── middlewares.md                    # Four middlewares + integration contract
│       ├── placement-contract.md             # Placement capability + quest integration
│       ├── editor-contributions.md           # Shell contributions reference
│       ├── telemetry.md                      # Telemetry sink + rationale traces
│       └── providers.md                      # ADR 010 provider interfaces
│
├── runtime/
│   ├── types.ts                              # Re-export of all contract types
│   ├── logger.ts                             # Namespaced debug logger
│   │
│   ├── contracts/
│   │   ├── pedagogy.ts                       # PedagogicalDirective, SupportPosture, ProbeTriggerReason, SugarlangConstraint (with prePlacementOpeningLine)
│   │   ├── learner-profile.ts                # LearnerProfile, LemmaCard (with productiveStrength + provisionalEvidence), CefrPosterior, lemmaCards: Record<string, LemmaCard>
│   │   ├── lexical-prescription.ts           # LexicalPrescription, LemmaRef, LemmaScore
│   │   ├── envelope.ts                       # EnvelopeVerdict, CoverageProfile, EnvelopeRuleOptions (with questEssentialLemmas?)
│   │   ├── scene-lexicon.ts                  # CompiledSceneLexicon, SceneLemmaInfo, LexicalChunk, QuestEssentialLemma
│   │   ├── observation.ts                    # LemmaObservation (8-kind union), FSRSGrade, ObservationOutcome
│   │   ├── providers.ts                      # LexicalAtlasProvider, LearnerPriorProvider, DirectorPolicy, DirectorContext, PendingProvisional, ProbeFloorState, ActiveQuestEssentialLemma
│   │   └── placement-questionnaire.ts        # PlacementQuestionnaire, PlacementQuestionnaireQuestion (discriminated), PlacementQuestionnaireResponse, PlacementScoreResult, SugarlangPlacementFlowPhase (see Epic 3 Story 3.7b)
│   │
│   ├── budgeter/
│   │   ├── lexical-budgeter.ts                # Main budgeter class/function
│   │   ├── scoring.ts                        # Priority score computation (transparent weights)
│   │   ├── observations.ts                   # LemmaObservation → FSRSGrade pure function
│   │   ├── fsrs-adapter.ts                   # Wrapper around ts-fsrs
│   │   └── rationale.ts                      # LexicalRationale builder
│   │
│   ├── classifier/
│   │   ├── envelope-classifier.ts             # Main classifier facade
│   │   ├── tokenize.ts                       # Intl.Segmenter-based tokenizer
│   │   ├── lemmatize.ts                      # Surface form → lemma trie lookup
│   │   ├── coverage.ts                       # CoverageProfile computation
│   │   ├── envelope-rule.ts                  # The in-envelope rule function (citation-backed)
│   │   └── auto-simplify.ts                  # Deterministic fallback substitution
│   │
│   ├── director/
│   │   ├── sugar-lang-director.ts              # Facade over DirectorPolicy
│   │   ├── claude-director-policy.ts           # Claude structured-output implementation
│   │   ├── fallback-director-policy.ts         # Deterministic fallback policy
│   │   ├── prompt-builder.ts                 # Context → prompt assembly
│   │   ├── schema-parser.ts                  # Strict JSON parse + validation
│   │   ├── directive-cache.ts                # ACTIVE_DIRECTIVE_FACT cache manager
│   │   └── calibration-mode.ts               # Post-placement calibration hint (minimal — placement itself lives in runtime/placement/)
│   │
│   ├── learner/
│   │   ├── learner-state-reducer.ts            # Single writer of LEARNER_PROFILE_FACT
│   │   ├── cefr-posterior.ts                 # Bayesian CEFR update math
│   │   ├── persistence.ts                    # Serialize + paged card store
│   │   ├── card-store.ts                     # IndexedDB-backed lemma card store
│   │   ├── fact-definitions.ts               # LEARNER_PROFILE_FACT, SUGARLANG_PLACEMENT_STATUS_FACT definitions
│   │   └── session-signals.ts                # Derived session signals (fatigue, hover rate)
│   │
│   ├── middlewares/
│   │   ├── sugar-lang-context-middleware.ts     # prepare()/context stage — budgets and placement activation
│   │   ├── sugar-lang-director-middleware.ts    # prepare()/policy stage — invokes director
│   │   ├── sugar-lang-verify-middleware.ts      # finalize()/analysis stage — envelope check + repair loop
│   │   └── sugar-lang-observe-middleware.ts     # finalize()/analysis stage — signal collection + state updates
│   │
│   ├── compile/
│   │   ├── compile-sugarlang-scene.ts          # Main compile function (pure)
│   │   ├── sugarlang-compile-cache.ts          # Cache interface + implementations
│   │   ├── content-hash.ts                   # Stable hash over compiler input fields
│   │   ├── scene-traversal.ts                # Walks authored content to collect reachable text
│   │   ├── compile-scheduler.ts              # Background authoring-time compile scheduler (Studio-only)
│   │   ├── cache-indexeddb.ts                # IndexedDB cache implementation
│   │   └── cache-memory.ts                   # In-memory cache implementation (Published builds)
│   │
│   ├── providers/
│   │   └── impls/
│   │       ├── cefr-lex-atlas-provider.ts       # Reads data/languages/<lang>/cefrlex.json
│   │       ├── fsrs-learner-prior-provider.ts   # FSRS-defaults learner prior impl
│   │       └── blackboard-learner-store.ts     # Blackboard-backed learner state store
│   │
│   ├── quest-integration/
│   │   ├── quest-adapter.ts                  # setFlag + notifyEvent wrappers (used by placement)
│   │   └── placement-completion.ts           # Placement-complete signal emitter
│   │
│   ├── placement/
│   │   ├── placement-score-engine.ts           # Deterministic scoring function for the plugin-owned questionnaire (Epic 11 Story 11.1)
│   │   ├── placement-questionnaire-loader.ts # Loads data/languages/<lang>/placement-questionnaire.json (Epic 4 Story 4.4)
│   │   └── placement-flow-orchestrator.ts    # Three-phase state machine: opening-dialog → questionnaire → closing-dialog (Epic 11 Story 11.3)
│   │
│   └── telemetry/
│       ├── telemetry.ts                      # Event logging sink interface
│       ├── rationale-trace.ts                # Per-turn rationale emission
│       └── debug-panel-data.ts               # Debug panel data aggregator
│
├── ui/
│   └── ui/shell/
│       ├── contributions.ts                  # All shell contribution declarations
│       ├── npc-inspector-role-dropdown.tsx      # "Sugarlang role" dropdown on NPC inspector
│       ├── scene-density-histogram.tsx         # Per-scene CEFR-band density histogram
│       ├── manual-rebuild-button.tsx           # "Rebuild Sugarlang Lexicon" button
│       ├── placement-question-bank-viewer.tsx   # Read-only placement bank view
│       └── quest-node-event-hint.tsx            # eventName autocomplete hint for quest nodes
│
├── data/
│   ├── languages/
│   │   ├── README.md                         # Language directory schema + adding a new language
│   │   ├── es/
│   │   │   ├── README.md                     # Spanish data provenance (ELELex source, license)
│   │   │   ├── cefrlex.json                  # Placeholder; populated in Epic 4
│   │   │   ├── morphology.json               # Placeholder; populated in Epic 4
│   │   │   ├── simplifications.json          # Placeholder; populated in Epic 4
│   │   │   └── placement-questionnaire.json  # Placeholder; populated in Epic 4 as plugin-shipped canonical questionnaire
│   │   └── it/
│   │       ├── README.md                     # Italian data provenance (OpenSubtitles, Kelly, Claude-batch)
│   │       ├── frequency.json                # Placeholder; populated in Epic 4
│   │       ├── kelly-subset.json             # Placeholder; populated in Epic 4
│   │       ├── cefrlex.json                  # Placeholder; populated in Epic 4 (merged view)
│   │       ├── morphology.json               # Placeholder; populated in Epic 4
│   │       ├── simplifications.json          # Placeholder; populated in Epic 4
│   │       └── placement-questionnaire.json  # Placeholder; populated in Epic 4 as plugin-shipped canonical questionnaire
│   └── schemas/
│       ├── README.md                         # Schema stub ownership + intended fill-in epic
│       ├── cefrlex.schema.json               # JSON schema for cefrlex.json files
│       ├── learner-profile.schema.json       # JSON schema for persisted learner profiles
│       ├── scene-lexicon.schema.json         # JSON schema for compiled scene lexicons
│       └── placement-questionnaire.schema.json  # JSON schema for the plugin-shipped placement questionnaire (matches placement-questionnaire.json data file name per the placement redesign in Proposal 001 § Cold Start Sequence).
│
└── tests/
    ├── README.md                             # Test layout + conventions
    ├── budgeter/
    │   ├── lexical-budgeter.test.ts           # Placeholder
    │   ├── scoring.test.ts                   # Placeholder
    │   └── observations.test.ts              # Placeholder
    ├── classifier/
    │   ├── envelope-classifier.test.ts        # Placeholder
    │   ├── lemmatize.test.ts                 # Placeholder
    │   ├── coverage.test.ts                  # Placeholder
    │   └── envelope-rule.test.ts             # Placeholder
    ├── director/
    │   ├── prompt-builder.test.ts            # Placeholder
    │   ├── schema-parser.test.ts             # Placeholder
    │   └── directive-cache.test.ts           # Placeholder
    ├── learner/
    │   ├── learner-state-reducer.test.ts       # Placeholder
    │   ├── cefr-posterior.test.ts            # Placeholder
    │   └── persistence.test.ts               # Placeholder
    ├── compile/
    │   ├── compile-sugarlang-scene.test.ts     # Placeholder
    │   ├── content-hash.test.ts              # Placeholder
    │   └── sugarlang-compile-cache.test.ts     # Placeholder
    ├── middlewares/
    │   ├── sugar-lang-context-middleware.test.ts     # Placeholder
    │   ├── sugar-lang-director-middleware.test.ts    # Placeholder (added in spec-drift fix — there are 4 middlewares, so there should be 4 test stubs)
    │   ├── sugar-lang-verify-middleware.test.ts      # Placeholder
    │   └── sugar-lang-observe-middleware.test.ts     # Placeholder
    ├── quest-integration/
    │   ├── placement-completion.test.ts      # Placeholder
    │   └── quest-adapter.test.ts             # Placeholder
    └── integration/
        ├── README.md                         # Integration test layout
        ├── cold-start-placement.test.ts      # Placeholder (Epic 11, 14)
        ├── preview-cache-hit-rate.test.ts    # Placeholder (Epic 14)
        └── end-to-end-conversation.test.ts   # Placeholder (Epic 14)
```

File count summary: approximately **141 files** created in this epic, of which 86 are TypeScript stubs, 14 are JSON placeholders, 36 are Markdown docs/READMEs, and 5 are `.tsx` editor contributions. (This summary reflects the current checked-in tree, including the placement questionnaire contract and the fourth middleware test stub added during the cleanup pass.)

## Stories

### Story 1.1: Create the directory tree

**Purpose:** Create every subdirectory listed in the Skeleton Tree. This is pure filesystem work but worth its own story so the reviewer can see the shape in isolation before any files land.

**Tasks:**

1. Create `runtime/` with subdirectories: `contracts/`, `budgeter/`, `classifier/`, `director/`, `learner/`, `middlewares/`, `compile/`, `providers/impls/`, `quest-integration/`, `telemetry/`
2. Create `ui/shell/`
3. Create `data/languages/es/`, `data/languages/it/`, `data/schemas/`
4. Create `tests/` with subdirectories: `budgeter/`, `classifier/`, `director/`, `learner/`, `compile/`, `middlewares/`, `quest-integration/`, `integration/`
5. Create `docs/api/` (directory already exists empty; verify)
6. Ensure `docs/proposals/` and `docs/plans/` (already populated) are intact

**Tests Required:** none (filesystem only)

**API Documentation Update:** none yet

**Acceptance Criteria:**

- `find packages/plugins/src/catalog/sugarlang -type d` returns every directory in the skeleton tree
- `git status` shows only directory additions (no committed files yet)

### Story 1.2: Write the plugin-level entry files

**Purpose:** Create the three plugin-root files (`index.ts`, `manifest.ts`, `config.ts`) and the top-level `README.md`. These are the outermost layer of the plugin and define how it is discovered and registered.

**Tasks:**

1. Write `index.ts` with header block; exports `createSugarlangPlugin` (signature only, returns TODO stub that throws)
2. Write `manifest.ts` with header block and a skeleton `DiscoveredPluginDefinition` carrying plugin id, display name, and empty capability list
3. Write `config.ts` with header block and `SugarLangPluginConfig` interface + `normalizeSugarLangPluginConfig` function signature
4. Write top-level `README.md` summarizing the plugin's purpose, directing developers to Proposal 001 and to `docs/api/README.md`

**Tests Required:**

- `tsc --noEmit` passes on the plugin directory with these three files in place (verifies imports resolve and types align)
- No runtime test needed — every function body is a `throw new Error("TODO: Epic N")` stub

**API Documentation Update:**

- Create `docs/api/README.md` as an index of what each API doc file will cover (see Story 1.8)

**Acceptance Criteria:**

- All three files compile without error
- All three files have the header comment block per the template
- `README.md` references Proposal 001 and the API doc index

### Story 1.3: Write the `runtime/contracts/` files

**Purpose:** Create every contract file under `runtime/contracts/`. These are type-only files — no logic. They declare the interfaces every downstream epic will implement. Writing them first gives the reviewer a clean view of the plugin's type surface.

**Tasks:**

1. `pedagogy.ts` — `SupportPosture`, `InteractionStyle` (including `elicitation_mode`), `GlossingStrategy`, `SentenceComplexityCap`, `ProbeTriggerReason`, `ComprehensionCheckSpec`, `DirectiveLifetime`, `PedagogicalDirective`, `SugarlangConstraint` (with `prePlacementOpeningLine?`, `comprehensionCheckInFlight?`, `questEssentialLemmas?` fields)
2. `learner-profile.ts` — `CEFRBand`, `LearnerProfile` (with `lemmaCards: Record<string, LemmaCard>` — keyed map, NOT an array — and an `assessment` field), `LemmaCard` (with `productiveStrength`, `provisionalEvidence`, `provisionalEvidenceFirstSeenTurn`, `lastProducedAtMs`), `CurrentSessionSignals`, `SessionRecord`, `CefrPosterior`
3. `lexical-prescription.ts` — `LemmaRef`, `LexicalPrescription`, `LexicalRationale`, `LemmaScore`
4. `envelope.ts` — `EnvelopeVerdict`, `CoverageProfile`, `EnvelopeRule`, `EnvelopeRuleOptions` (with optional `questEssentialLemmas`, `prescription`, `knownEntities` fields)
5. `scene-lexicon.ts` — `CompiledSceneLexicon` (with optional `chunks?: LexicalChunk[]`, required `questEssentialLemmas: QuestEssentialLemma[]`), `SceneLemmaInfo`, `SourceLocation`, `SceneAuthorWarning`, `LexicalChunk`, `QuestEssentialLemma`. **Import** `RuntimeCompileProfile` from `@sugarmagic/runtime-core/materials` — do NOT redefine it
6. `observation.ts` — `LemmaObservation` (8-kind discriminated union: `encountered`, `rapid-advance`, `hovered`, `quest-success`, `produced-typed`, `produced-chosen`, `produced-unprompted`, `produced-incorrect`), `FSRSGrade`, `ObservationKind`, `ObservationOutcome` (with `receptiveGrade`, `productiveStrengthDelta`, `provisionalEvidenceDelta`)
7. `providers.ts` — `LexicalAtlasProvider`, `LearnerPriorProvider`, `DirectorPolicy` (the ADR 010 boundaries), `DirectorContext` (with `pendingProvisionalLemmas`, `probeFloorState`, `activeQuestEssentialLemmas` fields), `PendingProvisional`, `ProbeFloorState`, `ActiveQuestEssentialLemma`
8. **`placement-questionnaire.ts`** (added in spec-drift fix pass — this file was missing from earlier drafts of Epic 1) — `PlacementQuestionnaire`, `PlacementQuestionnaireQuestion` (discriminated union over `multiple-choice`, `free-text`, `yes-no`, `fill-in-blank` kinds), `PlacementQuestionnaireResponse`, `PlacementAnswer`, `PlacementScoreResult`, `SugarlangPlacementFlowPhase`. See Epic 3 Story 3.7b for the canonical type definitions.

**For every file in this story, the header comment block includes `Implements: Proposal 001 §The Four Components / §Learner State Model / §Scene Lexicon Compilation / §Cold Start Sequence / §Placement Interaction Contract` as appropriate.**

For this story, the files contain *only* type definitions and JSDoc. No function bodies, no classes. The bodies of these interfaces reference types from each other, so a reviewer can read them as a self-consistent type universe.

**CRITICAL — canonical type shape source of truth.** The type shapes in these contract files are defined by **Proposal 001** and refined by **Epic 3** stories 3.1 through 3.7b. Do NOT invent simplified or alternative shapes for the main types. Specifically:

- `PedagogicalDirective.targetVocab` is a three-bucket object `{ introduce: LemmaRef[]; reinforce: LemmaRef[]; avoid: LemmaRef[] }`, NOT a flat `LemmaRef[]` array. This shape mirrors `SugarlangConstraint.targetVocab` in the same file.
- `PedagogicalDirective.confidenceBand` is `"high" | "medium" | "low"` (the Director's self-reported confidence in its directive), NOT a `CEFRBand`. Learner CEFR level is stored on `LearnerProfile.estimatedCefrBand`, which is a different concept.
- `DirectiveLifetime` is `{ maxTurns: number; invalidateOn: ("player_code_switch" | "quest_stage_change" | "location_change" | "affective_shift")[] }`. Do NOT simplify it to a `kind` discriminator — the Director cache and invalidation logic depend on both `maxTurns` and the invalidateOn triggers.
- `LearnerProfile.lemmaCards` is `Record<string, LemmaCard>` (a map keyed by lemma id for O(1) lookup), NOT `LemmaCard[]` (which forces O(n) lookups and doesn't match the Budgeter's `bulkGet(lemmaIds[])` access pattern).
- `LearnerProfile.assessment` is a required nested object with `status`, `evaluatedCefrBand`, `cefrConfidence`, `evaluatedAtMs` fields per Proposal 001 § Learner State Model.
- `SugarlangConstraint.prePlacementOpeningLine?` is required per Proposal 001 § Pre-Placement Opening Dialog Policy and carries `{ text: string; lang: string; lineId: string }`.

If any of these shapes look different in the engineer's implementation from what this story specifies, the correct answer is always: match Proposal 001's canonical definition.

**Tests Required:**

- `tsc --noEmit` passes
- No unit tests yet (types only — tests land when Epic 3 materializes the types and the functions that use them)

**API Documentation Update:**

- `docs/api/providers.md` stubbed with the ADR 010 separation rules and a list of the three provider interfaces (implementation details come in Epic 3)

**Acceptance Criteria:**

- All eight contract files exist with headers and type definitions (seven original files plus `placement-questionnaire.ts` added in the spec-drift fix pass)
- `runtime/types.ts` re-exports every type from the contract files (single import surface for consumers)
- `tsc --noEmit` passes for the whole plugin directory

### Story 1.4: Write the `runtime/budgeter/`, `runtime/classifier/`, and `runtime/director/` file stubs

**Purpose:** Create the function/class stubs for the three "core components" of the Proposal 001 architecture. Every file has the header block. Every exported function body is `throw new Error("TODO: Epic N")` where N is the epic that implements it.

**Tasks:**

Budgeter (`runtime/budgeter/`):

1. `lexical-budgeter.ts` — class or factory; `prescribe(input)` signature returning `Promise<LexicalPrescription>`; throws TODO (Epic 8)
2. `scoring.ts` — `computeLemmaPriority(lemma, learner, scene)` signature; throws TODO (Epic 8)
3. `observations.ts` — `observationToFsrsGrade(obs: LemmaObservation): FSRSGrade | null` signature; throws TODO (Epic 8)
4. `fsrs-adapter.ts` — `updateCard(card, grade)` signature; throws TODO (Epic 8)
5. `rationale.ts` — `buildLexicalRationale(...)` signature; throws TODO (Epic 8)

Classifier (`runtime/classifier/`):

1. `envelope-classifier.ts` — `check(text, learner): EnvelopeVerdict` signature; throws TODO (Epic 5)
2. `tokenize.ts` — `tokenize(text, lang)` signature; throws TODO (Epic 5)
3. `lemmatize.ts` — `lemmatize(token, lang, morphologyIndex)` signature; throws TODO (Epic 5)
4. `coverage.ts` — `computeCoverage(lemmas, learner, atlas)` signature; throws TODO (Epic 5)
5. `envelope-rule.ts` — `applyEnvelopeRule(profile, prescription)` signature; throws TODO (Epic 5)
6. `auto-simplify.ts` — `autoSimplify(text, violations, lang)` signature; throws TODO (Epic 5)

Director (`runtime/director/`):

1. `sugar-lang-director.ts` — facade class; `invoke(context)` signature; throws TODO (Epic 9)
2. `claude-director-policy.ts` — implements `DirectorPolicy`; throws TODO (Epic 9)
3. `fallback-director-policy.ts` — implements `DirectorPolicy`; throws TODO (Epic 9)
4. `prompt-builder.ts` — `buildDirectorPrompt(context)` signature; throws TODO (Epic 9)
5. `schema-parser.ts` — `parseAndValidateDirective(json)` signature; throws TODO (Epic 9)
6. `directive-cache.ts` — `DirectiveCache` class; throws TODO (Epic 9)
7. `calibration-mode.ts` — `isInPostPlacementCalibration(learner)` + `buildPostPlacementCalibrationHint()` signatures; throws TODO (Epic 9 Story 9.6). Note: this module is minimal. The old placement-variant logic was removed when Epic 11 was redesigned around the questionnaire model; the only remaining responsibility is a soft hint for the Director during the first few conversations after placement completes.

**Tests Required:**

- `tsc --noEmit` passes
- No functional tests — every function throws; logic lands in later epics

**API Documentation Update:**

- `docs/api/budgeter.md` stub outlining the Budgeter's public API (the interfaces that other epics will consume)
- `docs/api/classifier.md` stub outlining the Classifier's public API
- `docs/api/director.md` stub outlining the Director's public API and the ADR 010 policy boundary

**Acceptance Criteria:**

- All 18 files exist with header comment blocks
- Every exported symbol has a TypeScript signature and an explicit epic-reference TODO in the body
- `tsc --noEmit` passes

### Story 1.5: Write the `runtime/learner/`, `runtime/compile/`, and `runtime/providers/` file stubs

**Purpose:** Stub the three remaining runtime subsystems: learner state, scene-lexicon compilation, and ADR 010 provider implementations.

**Tasks:**

Learner state (`runtime/learner/`):

1. `learner-state-reducer.ts` — class; `apply(observation)` signature; throws TODO (Epic 7)
2. `cefr-posterior.ts` — `updatePosterior(posterior, observation)` signature; throws TODO (Epic 7)
3. `persistence.ts` — `serializeLearnerProfile(profile)`, `deserializeLearnerProfile(json)` signatures; throws TODO (Epic 7)
4. `card-store.ts` — `CardStore` interface + `IndexedDBCardStore` class stub; throws TODO (Epic 7)
5. `fact-definitions.ts` — exports `LEARNER_PROFILE_FACT`, `SUGARLANG_PLACEMENT_STATUS_FACT`, `LEMMA_OBSERVATION_FACT`, `ACTIVE_DIRECTIVE_FACT` BlackboardFactDefinition constants as TODO-marked stubs (Epic 7)
6. `session-signals.ts` — `computeFatigueScore`, `computeHoverRate` signatures; throws TODO (Epic 7)

Compile (`runtime/compile/`):

1. `compile-sugarlang-scene.ts` — `compileSugarlangScene(scene, atlas, profile)` signature; throws TODO (Epic 6)
2. `sugarlang-compile-cache.ts` — `SugarlangCompileCache` interface + abstract class; throws TODO (Epic 6)
3. `content-hash.ts` — `computeSceneContentHash(scene)` signature; throws TODO (Epic 6)
4. `scene-traversal.ts` — `collectSceneText(scene)` signature; throws TODO (Epic 6)
5. `compile-scheduler.ts` — `SugarlangAuthoringCompileScheduler` class stub (Studio-side); throws TODO (Epic 6)
6. `cache-indexeddb.ts` — `IndexedDBCompileCache implements SugarlangCompileCache`; throws TODO (Epic 6)
7. `cache-memory.ts` — `MemoryCompileCache implements SugarlangCompileCache`; throws TODO (Epic 6)

Providers (`runtime/providers/impls/`):

1. `cefr-lex-atlas-provider.ts` — `implements LexicalAtlasProvider`; throws TODO (Epic 4/5)
2. `fsrs-learner-prior-provider.ts` — `implements LearnerPriorProvider`; throws TODO (Epic 7/8)
3. `blackboard-learner-store.ts` — learner-state reader/writer backed by blackboard; throws TODO (Epic 7)

Quest integration (`runtime/quest-integration/`):

1. `quest-adapter.ts` — thin wrapper around `QuestManager.setFlag` and `notifyEvent`; throws TODO (Epic 11)
2. `placement-completion.ts` — `emitPlacementCompleted(estimate, confidence)` signature; throws TODO (Epic 11)

Telemetry (`runtime/telemetry/`):

1. `telemetry.ts` — `TelemetrySink` interface; throws TODO (Epic 13)
2. `rationale-trace.ts` — `buildRationaleTrace(...)` signature; throws TODO (Epic 13)
3. `debug-panel-data.ts` — `DebugPanelDataSource` class; throws TODO (Epic 13)

**Tests Required:**

- `tsc --noEmit` passes
- No functional tests

**API Documentation Update:**

- `docs/api/learner-state.md` stub outlining the state model
- `docs/api/scene-lexicon-compilation.md` stub outlining the compiler and cache API
- `docs/api/placement-contract.md` stub outlining the placement integration contract (referencing Proposal 001 § Placement Interaction Contract)
- `docs/api/telemetry.md` stub outlining the TelemetrySink interface

**Acceptance Criteria:**

- All 21 files exist with header blocks
- Every exported symbol has a signature and a TODO
- `tsc --noEmit` passes

### Story 1.6: Write the `runtime/middlewares/` file stubs

**Purpose:** Stub the four sugarlang middlewares. These are the integration points with the existing `ConversationMiddleware` system.

**Tasks:**

1. `sugar-lang-context-middleware.ts` — exports a `createSugarLangContextMiddleware(config)` factory returning a `ConversationMiddleware` with `prepare()` TODO (Epic 10)
2. `sugar-lang-director-middleware.ts` — factory returning `ConversationMiddleware` with `prepare()` TODO (Epic 10)
3. `sugar-lang-verify-middleware.ts` — factory returning `ConversationMiddleware` with `finalize()` TODO (Epic 10)
4. `sugar-lang-observe-middleware.ts` — factory returning `ConversationMiddleware` with `finalize()` TODO (Epic 10)

Each middleware's header block includes:

- The pipeline stage it belongs to (context | policy | analysis)
- The priority it runs at (per Proposal 001 §End-to-End Turn Flow)
- Which annotation keys it reads/writes in `execution.annotations` — the exhaustive list lives in Proposal 001 § Annotation Namespace Reference, which is the **single authoritative source**. Do not duplicate the key list in the header comment — reference the proposal section. Any discrepancy between a middleware's header comment and the proposal is a bug in the header comment.
- Which `session.state["sugarlang.*"]` keys it reads/writes (same discipline — see Proposal 001 § Annotation Namespace Reference)

**Tests Required:**

- `tsc --noEmit` passes
- `runtime/middlewares/index.ts` (or the plugin `manifest.ts`) exports a list of four factory functions that match the `ConversationMiddleware` shape from `packages/runtime-core/src/conversation`

**API Documentation Update:**

- `docs/api/middlewares.md` stub containing the priority-ordered middleware list, the annotation namespace reservations (`sugarlang.prescription`, `sugarlang.constraint`, `sugarlang.directive`, `sugarlang.observation`), and the integration contract with SugarAgent

**Acceptance Criteria:**

- All four middleware files exist with header blocks
- Each file's TypeScript signature matches the `ConversationMiddleware` interface
- `tsc --noEmit` passes

### Story 1.7: Write the `ui/shell/`, `data/`, and `tests/` placeholder files

**Purpose:** Create all remaining placeholder files so Epic 1's output is literally the complete skeleton.

**Tasks:**

UI / Shell:

1. `ui/shell/contributions.ts` — header block + empty contribution list; TODO (Epic 12)
2. `ui/shell/npc-inspector-role-dropdown.tsx` — header block + empty functional component; TODO (Epic 12)
3. `ui/shell/scene-density-histogram.tsx` — header block + empty component; TODO (Epic 12)
4. `ui/shell/manual-rebuild-button.tsx` — header block + empty component; TODO (Epic 12)
5. `ui/shell/placement-question-bank-viewer.tsx` — header block + empty component; TODO (Epic 12)
6. `ui/shell/quest-node-event-hint.tsx` — header block + empty component; TODO (Epic 12)

Data:

1. `data/languages/README.md` — directory schema doc + "how to add a new language" walkthrough
2. `data/languages/es/README.md` — Spanish provenance (ELELex source, license notes, file listing)
3. `data/languages/it/README.md` — Italian provenance (OpenSubtitles, Wikipedia, Kelly project, Claude-batch classification workflow)
4. Create placeholder `{}` JSON files for every data file in Skeleton Tree (seven placeholder files total across ES and IT)
5. `data/schemas/README.md` — documents schema-stub ownership and the epic that will fill each schema in
6. `data/schemas/*.schema.json` — four JSON Schema stubs (cefrlex, learner-profile, scene-lexicon, placement-questions) each with `"$schema"`, a title, and a description; no JSON comments
7. `data/languages/README.md` — adds "adding a language" walkthrough that Epic 4 will update

Tests:

1. `tests/README.md` — test layout documentation: unit tests sit under tests/<component>/, integration tests under tests/integration/, cross-plugin tests live in `packages/testing/`
2. `tests/integration/README.md` — describes the golden-scenario test pattern that Epic 14 will fill in
3. For each test file in the Skeleton Tree, write a placeholder that imports the target module and has a single `describe("TODO: Epic N", () => { it.todo("implement in Epic N"); });` block. **Make sure you create one test stub per middleware source file — there are FOUR middlewares (context, director, verify, observe), so `tests/middlewares/` must contain FOUR stub files: `sugar-lang-context-middleware.test.ts`, `sugar-lang-director-middleware.test.ts`, `sugar-lang-verify-middleware.test.ts`, `sugar-lang-observe-middleware.test.ts`.** Earlier drafts of this story accidentally listed only three stubs; the skeleton tree and this task list have been corrected in the spec-drift fix pass.

**Tests Required:**

- `tsc --noEmit` passes
- The test runner discovers every placeholder test file and reports them as "todo" (not failing)

**API Documentation Update:**

- `docs/api/editor-contributions.md` stub outlining the five shell contribution kinds the plugin adds

**Acceptance Criteria:**

- All shell, data, and test placeholder files exist with headers
- Test runner passes with every placeholder marked "todo"
- `tsc --noEmit` passes
- `data/languages/<lang>/*.json` placeholder files are empty JSON objects or empty arrays as appropriate, not missing

### Story 1.8: Populate the `docs/api/README.md` index

**Purpose:** Create the API documentation index that every subsequent epic will reference when updating a specific doc file. The index names every `docs/api/*.md` file, lists what it will document, and names which epic is responsible for populating each section.

**Tasks:**

1. Write `docs/api/README.md` as a Markdown index table:
   - Column 1: API doc file name
   - Column 2: What the file documents (one sentence)
   - Column 3: Which epic(s) populate it
   - Column 4: Status (always `Stub` at the end of Epic 1)
2. Ensure every other story in this epic (1.2 through 1.7) creates its listed API doc stub

**Tests Required:** none (documentation only)

**API Documentation Update:** this story IS an API documentation update — it's the index that binds the rest together

**Acceptance Criteria:**

- `docs/api/README.md` exists and lists all ten API doc files
- Every listed doc file exists as a stub
- The README table is accurate

### Story 1.9: Plugin registration smoke test

**Purpose:** Before the QA gate, prove that the skeleton plugin can be *discovered and loaded* by the plugin registry without throwing. This is the "does the plumbing even connect" sanity test.

**Tasks:**

1. Write `tests/plugin-registration.test.ts` that:
   - Imports `createSugarlangPlugin` from `packages/plugins/src/catalog/sugarlang/index.ts`
   - Instantiates the plugin with a minimal boot model
   - Asserts the returned `RuntimePluginInstance` has `pluginId === "sugarlang"`, has `displayName` set, has an empty `contributions` array (capabilities come in later epics), has `init`, `dispose` methods defined
   - Does NOT call `init()` (that would hit a TODO stub)
2. Wire the test into the package test runner so it runs as part of the sugarlang test suite

**Tests Required:**

- The registration test passes
- No other test may need to pass in this epic — this is the only live test

**API Documentation Update:**

- `docs/api/README.md` adds a "Registration smoke test" subsection pointing to `tests/plugin-registration.test.ts` as the canonical "plugin is importable" check

**Acceptance Criteria:**

- Running `pnpm test --filter sugarlang` (or equivalent) executes the registration test and it passes
- All other test files are discovered and reported as "todo"
- `tsc --noEmit` passes for the entire plugin directory

## STOP: QA Engineer Review Gate

**This is a hard gate. No epic after Epic 1 may begin until a QA engineer has reviewed the complete skeleton and signed off.**

The review's job is to catch cheap-to-fix mistakes before they become expensive-to-fix mistakes. The QA engineer should:

1. **Walk the directory tree** and ask: "Is there a file missing that the proposal implies should exist? Is there a file here that doesn't map to anything in the proposal?"
2. **Read every top-of-file comment block** and ask: "Does this file's purpose make sense? Does it conflict with another file's purpose? Is there duplication that should be collapsed?"
3. **Cross-reference the Skeleton Tree with Proposal 001** and confirm each of the four components (Budgeter, Classifier, Director, Generator), the learner state model, the compile pipeline, the placement capability, and the ADR 010 provider boundaries are all represented.
4. **Check namespace discipline** — annotation keys (`sugarlang.*`), blackboard fact names (`LEARNER_PROFILE_FACT`, `SUGARLANG_PLACEMENT_STATUS_FACT`, etc.), plugin id, are consistent across files.
5. **Flag any file whose top comment block mentions an implementation detail that contradicts the proposal** (e.g., a file claiming to use SM-2 instead of FSRS).
6. **Run the registration smoke test** and `tsc --noEmit` themselves.
7. **Sign off in writing** by updating the `Status:` line in this file from `Proposed` to `Complete` with a date and reviewer initials, and adding a short review note at the bottom of this file under a new `## QA Sign-off` section.

The review should take ~30 minutes. If it's taking longer, something is wrong with the skeleton — pause Epic 2 and iterate.

### Review Checklist

- [ ] Every directory in the Skeleton Tree exists
- [ ] Every file in the Skeleton Tree exists
- [ ] Every file has a top-of-file comment block matching the template
- [ ] `tsc --noEmit` passes
- [ ] The plugin registration smoke test passes
- [ ] `docs/api/README.md` lists every planned API doc file
- [ ] Annotation namespace, blackboard fact names, and plugin id are consistent across files
- [ ] No file's purpose contradicts Proposal 001
- [ ] No file's purpose duplicates another file
- [ ] No file is missing that the proposal implies should exist
- [ ] Review signed off by updating this file's Status and adding the QA Sign-off section below

## Risks and Open Questions

- **Shell contribution file format.** The Skeleton Tree assumes `.tsx` files for UI contributions, following the pattern used elsewhere in the plugins catalog. If Studio has a different convention (e.g., contributions declared via JSON manifest, not React components), Story 1.7 may need to adjust. This is a QA-review-time question.
- **Test runner integration.** The sugarlang plugin may need its own `vitest` config or may inherit from a workspace-level config. Story 1.9 assumes the workspace-level config already discovers tests under `packages/plugins/src/catalog/sugarlang/tests/`. If not, an additional task to wire up the config is needed.
- **Placeholder JSON content.** Story 1.7 creates placeholder JSON files. Whether these are `{}` or an empty array `[]` depends on the schema each file will eventually have. Prefer `{}` for object-shaped files and `[]` for array-shaped files, and document intended ownership/shape in sibling README files rather than JSON comments.
- **ADR 010 provider location.** Proposal 001 §14 shows providers under `runtime/providers/` with interfaces in `contracts/providers.ts` and implementations in `runtime/providers/impls/`. Some reviewers might prefer the interfaces to live in `runtime/providers/` directly rather than `contracts/`. Flag this as a reviewer-preference question.

## Exit Criteria

Epic 1 is complete when:

1. All nine stories are complete
2. `tsc --noEmit` passes
3. The plugin registration smoke test passes
4. `docs/api/README.md` is accurate
5. A QA engineer has reviewed and signed off (see the gate above)
6. This file's `Status:` has been updated to `Complete`
7. A `## QA Sign-off` section has been added to the bottom of this file with the reviewer's name and date

## QA Sign-off

_To be filled in by the QA engineer reviewing this skeleton. Replace this paragraph with a short review note and update the `Status:` field at the top of this file._
