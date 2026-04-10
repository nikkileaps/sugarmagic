# Epic 3: Contracts and Types

**Status:** Complete
**Date:** 2026-04-09
**Derives from:** [Proposal 001](../../proposals/001-adaptive-language-learning-architecture.md)
**Depends on:** Epic 1 (skeleton with type files stubbed)
**Blocks:** Epics 5–11 (every component that uses these types)

## Context

Epic 1 created empty stubs for every contract file under `runtime/contracts/`. This epic fills them in with the actual TypeScript type definitions — the real interfaces that downstream epics will implement and consume. This is type-level work only: no functions, no classes with bodies, no runtime logic. Just well-documented type definitions and the re-export surface from `runtime/types.ts`.

Writing the full type surface in one epic, before any implementation, forces us to reconcile type decisions up front. When the Budgeter, Classifier, and Director are implemented in later epics, they will import from a stable, already-reviewed type surface. Type drift across epics is one of the most common causes of rework; this epic prevents it.

## Prerequisites

- Epic 1 complete and QA-signed-off
- Epic 2 is *not* strictly required to start — type work in this epic does not depend on the domain-model changes in Epic 2, though the two epics may run in parallel

## Success Criteria

- Every type declared in Proposal 001 has a concrete TypeScript definition in the right contracts file
- Every type has JSDoc describing its purpose, linked to the proposal section it implements
- `runtime/types.ts` re-exports every public type as a single import surface
- `tsc --noEmit` passes across the plugin
- Type-only tests (if any) pass
- API documentation for the contracts is written

## Stories

### Story 3.1: Define pedagogical types in `contracts/pedagogy.ts`

**Purpose:** Write every type related to pedagogical posture, interaction style, glossing, and the Director's output contract.

**Tasks:**

1. Define `CEFRBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2"`
2. Define `SupportPosture = "anchored" | "supported" | "target-dominant" | "target-only"`
3. Define `InteractionStyle = "listening_first" | "guided_dialogue" | "natural_dialogue" | "recast_mode" | "elicitation_mode"` — where `elicitation_mode` is the Swain-aligned style the Director picks when the scene's candidate set has multiple high receptive-productive-gap lemmas (i.e. lemmas the learner can recognize but not produce). See Proposal 001 § Receptive vs. Productive Knowledge
4. Define `GlossingStrategy = "inline" | "parenthetical" | "hover-only" | "none"`
5. Define `SentenceComplexityCap = "single-clause" | "two-clause" | "free"`
6. Define `PedagogicalDirective` interface with all fields per Proposal 001 § The Director — targetVocab, posture, ratio, style, glossing, sentenceComplexityCap, comprehensionCheck, directiveLifetime, citedSignals, rationale, confidenceBand, isFallbackDirective
7. Define supporting types: `ComprehensionCheckSpec`, `DirectiveLifetime`, `ProbeTriggerReason`
8. `ComprehensionCheckSpec` is extended to carry the full probe specification needed by Epic 10's middleware pipeline and Epic 13's telemetry (per Proposal 001 § Observer Latency Bias):
   ```ts
   type ProbeTriggerReason =
     | "director-discretion"       // Director chose to probe based on scene context + pending evidence
     | "soft-floor"                // ≥15 turns since last probe AND ≥5 lemmas pending → Director strongly encouraged
     | "hard-floor-turns"          // ≥25 turns since last probe → Director forced
     | "hard-floor-lemma-age"      // any single lemma has ≥25 turns pending → Director forced
     | "director-deferred-override" // Director ignored the hard-floor flag; FallbackDirectorPolicy kicked in
     ;
   
   interface ComprehensionCheckSpec {
     trigger: boolean;                                 // fire a probe this turn?
     probeStyle: "recall" | "recognition" | "production" | "none";
     targetLemmas: LemmaRef[];                         // which lemmas the probe covers
     triggerReason?: ProbeTriggerReason;               // why this probe fired (for telemetry + debug)
     characterVoiceReminder?: string;                  // short reminder of the NPC's voice for the Generator prompt
     acceptableResponseForms?: "any" | "single-word" | "short-phrase" | "full-sentence";
   }
   ```
9. Every field has JSDoc linking to Proposal 001 § Observer Latency Bias
10. Define `SugarlangConstraint` — the merged Director-output-plus-prescription object written to `execution.annotations["sugarlang.constraint"]` by the Director middleware and read by the Generator splice (Epic 10). Carries the full probe-in-flight instruction when a comprehension check is active:
    ```ts
    interface SugarlangConstraint {
      targetVocab: {
        introduce: LemmaRef[];
        reinforce: LemmaRef[];
        avoid: LemmaRef[];
      };
      supportPosture: SupportPosture;
      targetLanguageRatio: number;
      interactionStyle: InteractionStyle;
      glossingStrategy: GlossingStrategy;
      sentenceComplexityCap: SentenceComplexityCap;
      targetLanguage: string;
      learnerCefr: CEFRBand;
      
      // Comprehension check in flight — set when a probe is firing this turn
      comprehensionCheckInFlight?: {
        active: true;
        probeStyle: "recall" | "recognition" | "production";
        targetLemmas: LemmaRef[];
        characterVoiceReminder: string;
        triggerReason: ProbeTriggerReason;
      };
      
      // Quest-essential lemmas that are tied to currently-active objectives.
      // MUST be used by the Generator if the player needs to understand the current
      // objective, MUST have parenthetical/inline glossing when used, and are
      // classifier-exempt regardless of their CEFR band.
      // See Proposal 001 § Quest-Essential Lemma Exemption.
      questEssentialLemmas?: Array<{
        lemmaRef: LemmaRef;
        sourceObjectiveDisplayName: string;
        supportLanguageGloss: string;   // the translation the Generator should use in the parenthetical
      }>;
      
      // Pre-placement opening-dialog bypass field. When present, the Generator splice
      // MUST skip all normal prompt assembly and LLM invocation and return the text
      // field verbatim as the NPC turn. This is the Pre-Placement Opening Dialog
      // Policy from Proposal 001 — the pipeline is deliberately bypassed during the
      // opening-dialog phase because the learner's level is unknown and there is no
      // meaningful pedagogical decision for the Director to make.
      //
      // When this field is set, the Verify middleware also short-circuits (no envelope
      // check needed — the text is in the support language with no target-language
      // lemmas to validate).
      //
      // See Proposal 001 § Pre-Placement Opening Dialog Policy (canonical) for the full
      // ruleset.
      prePlacementOpeningLine?: {
        text: string;                   // the authored line, verbatim — no templating, no paraphrase
        lang: string;                   // always the support language (e.g. "en")
        lineId: string;                 // for telemetry and debug
      };
      
      rawPrescription: LexicalPrescription;  // for telemetry, not used by Generator
    }
    ```

**Additional tests for comprehension-check types:**

- Type-level test: `ComprehensionCheckSpec` with every field set type-checks
- Type-level test: `SugarlangConstraint.comprehensionCheckInFlight` is optional (absent = no probe this turn)
- Type-level test: `ProbeTriggerReason` is an exhaustive string-literal union — a switch over it produces `never` default
- Type-level test: `PendingProvisional.evidenceAmount` and `turnsPending` are required fields

**Additional tests for quest-essential exemption types:**

- Type-level test: `QuestEssentialLemma` with every field set type-checks
- Type-level test: `CompiledSceneLexicon.questEssentialLemmas` is a required array (empty is valid, undefined is not)
- Type-level test: `ActiveQuestEssentialLemma` has a required `supportObjectiveNodeId` and is distinct from `SceneLemmaInfo` (not the same type)
- Type-level test: `SugarlangConstraint.questEssentialLemmas` is optional (absent = no active quest objectives in focus)
- Type-level test: every `ActiveQuestEssentialLemma` has a `sourceObjectiveNodeId` that links back to a quest objective
- Invariant: no test-time assertion because the exemption is tested in Epic 5's classifier tests, but the types enforce the contract

**Tests Required:**

- Type-level test: a hand-constructed `PedagogicalDirective` value type-checks without errors
- Type-level test: a directive missing a required field fails type-checking (use `@ts-expect-error` to assert)

**API Documentation Update:**

- `docs/api/director.md`: full public surface of the director's output contract with JSDoc examples

**Acceptance Criteria:**

- All types compile
- JSDoc on every exported type links to the proposal section
- Re-exported from `runtime/types.ts`

### Story 3.2: Define learner state types in `contracts/learner-profile.ts`

**Purpose:** Write the learner state model types, including the receptive/productive knowledge split from Proposal 001 § Receptive vs. Productive Knowledge.

**Tasks:**

1. Define `LearnerProfile` interface (Proposal 001 § Learner State Model)
2. Define `CefrPosterior` as a `Record<CEFRBand, { alpha: number; beta: number }>`
3. Define `LemmaCard` interface with:
   - FSRS fields: `difficulty`, `stability`, `retrievability`, `lastReviewedAt`, `reviewCount`, `lapseCount`
   - Seed fields: `cefrPriorBand`, `priorWeight`
   - **Productive knowledge field: `productiveStrength: number`** (clamped [0, 1]) — tracks productive (Swain) knowledge separately from the FSRS receptive (Krashen) stability
   - `lastProducedAtMs: number | null` — last time the player actually produced this lemma (used for productive-decay calculations)
   - **Provisional evidence field: `provisionalEvidence: number`** (clamped [0, 5]) — unconfirmed receptive exposure accumulated from `rapid-advance` observations, weighted by dwell time. Does NOT affect `stability` until a comprehension probe commits it. See Proposal 001 § Observer Latency Bias and In-Character Comprehension Checks.
   - `provisionalEvidenceFirstSeenTurn: number | null` — the session-turn index when provisional evidence first started accumulating for this card. Used for age-based decay (>30 turns → zero) and for the Director's `pendingProvisionalLemmas` context.
   - **Note on `PendingProvisional` and `ProbeFloorState` type ownership:** These two types wrap *runtime-computed views* of the provisional-evidence state (not stored on the card itself), and they are used by the Director context. They are defined in `contracts/providers.ts` as part of `DirectorContext` (see Story 3.7), NOT here in `contracts/learner-profile.ts`. Don't define them twice — Story 3.7 owns them. This note exists specifically to prevent an engineer from defining them in both files and ending up with a circular import or a duplicated type.
4. Define `CurrentSessionSignals` (sessionId, startedAt, turns, avgResponseLatencyMs, hoverRate, retryRate, fatigueScore)
5. Define `SessionRecord` for `sessionHistory`
6. Define `LearnerId` as a branded type for type safety
7. Export a named constant `INITIAL_PRODUCTIVE_STRENGTH = 0` — new cards always start with zero productive knowledge, regardless of the FSRS seed (the learner has never produced a word they just encountered for the first time, even if they might recognize it from a cognate)
8. Export named constants for the provisional-evidence mechanics:
   - `INITIAL_PROVISIONAL_EVIDENCE = 0`
   - `PROVISIONAL_EVIDENCE_MAX = 5` (clamp ceiling)
   - `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD = 30` (after 30 turns with no commit, decays to 0)

**Tests Required:**

- Type-level test: a default learner state value type-checks
- Type-level test: a CefrPosterior missing a band fails type-checking
- Type-level test: a `LemmaCard` must have `productiveStrength` (it's not optional)
- Type-level test: a `LemmaCard` must have `provisionalEvidence` (it's not optional; default value 0 is an explicit value, not undefined)
- Invariant test: `INITIAL_PRODUCTIVE_STRENGTH === 0` (guards against accidental defaults drifting upward later)
- Invariant test: `INITIAL_PROVISIONAL_EVIDENCE === 0` and `PROVISIONAL_EVIDENCE_MAX === 5` (guards against accidental drift)

**API Documentation Update:**

- `docs/api/learner-state.md`: full public surface of the learner state model
- `docs/api/learner-state.md`: "Receptive vs. Productive" section explaining the two strength signals and cross-referencing Proposal 001 § Receptive vs. Productive Knowledge

**Acceptance Criteria:**

- All types compile, re-exported, JSDoc present
- `productiveStrength` is a required field on `LemmaCard`
- `INITIAL_PRODUCTIVE_STRENGTH` is exported and tested

### Story 3.3: Define lexical prescription types in `contracts/lexical-prescription.ts`

**Purpose:** Write the types the Budgeter produces.

**Tasks:**

1. Define `LemmaRef` — `{ lemmaId: string; surfaceForm?: string; lang: string }`
2. Define `LexicalPrescription` interface (Proposal 001 § Lexical Budgeter) — introduce, reinforce, avoid, anchor?, budget, rationale
3. Define `LexicalRationale` interface — candidate set size, envelope survivors, per-lemma priority scores, reason strings
4. Define `LexicalBudget` — `{ newItemsAllowed: number; turnSeconds?: number }`
5. Define `LexicalPrescriptionInput` — the input to `LexicalBudgeter.prescribe` (learner, scene lexicon, conversation state)

**Tests Required:**

- Type-level test: a hand-constructed prescription type-checks

**API Documentation Update:**

- `docs/api/budgeter.md`: input/output type documentation

**Acceptance Criteria:**

- Types compile, re-exported, JSDoc present

### Story 3.4: Define envelope and coverage types in `contracts/envelope.ts`

**Purpose:** Write the types the Classifier produces.

**Tasks:**

1. Define `CoverageProfile` interface — totalTokens, knownTokens, inBandTokens, unknownTokens, bandHistogram, outOfEnvelopeLemmas, **questEssentialLemmasMatched**, coverageRatio
2. Define `EnvelopeVerdict` interface — withinEnvelope, profile, worstViolation, rule, **exemptionsApplied** (list of exemption kinds that fired: `"prescription-introduce" | "named-entity" | "quest-essential"`)
3. Define `EnvelopeRule` as a type describing the rule function: `(profile: CoverageProfile, options: EnvelopeRuleOptions) => boolean`
4. Define `EnvelopeRuleOptions` — `{ prescription?: LexicalPrescription | null; knownEntities?: Set<string>; questEssentialLemmas?: Set<string> }` (the new quest-essential set is the Linguistic Deadlock exemption from Proposal 001 § Quest-Essential Lemma Exemption)
5. Define `EnvelopeViolation` for per-lemma violation detail

**Tests Required:**

- Type-level test: a verdict value type-checks

**API Documentation Update:**

- `docs/api/classifier.md`: verdict and profile type documentation

**Acceptance Criteria:**

- Types compile, re-exported, JSDoc present

### Story 3.5: Define scene lexicon types in `contracts/scene-lexicon.ts`

**Purpose:** Write the compile artifact type and supporting types, including the `LexicalChunk` type that Epic 14 (Lexical Chunk Awareness) populates asynchronously. The type surface ships in Epic 3 so downstream code can read `chunks` from day one without a schema migration later.

**Tasks:**

1. Define `CompiledSceneLexicon` interface (Proposal 001 § Scene Lexicon Compilation) — sceneId, contentHash, pipelineVersion, atlasVersion, profile, lemmas, properNouns, anchors, **questEssentialLemmas**, sources?, diagnostics?, **chunks?**
2. Define `SceneLemmaInfo` interface — lemmaId, cefrPriorBand, frequencyRank, partsOfSpeech, isQuestCritical
3. Define `QuestEssentialLemma` interface (Proposal 001 § Quest-Essential Lemma Exemption — the Linguistic Deadlock fix):
   ```ts
   interface QuestEssentialLemma {
     lemmaId: string;
     lang: string;
     cefrBand: CEFRBand;                    // for telemetry/debug; does NOT affect exemption
     sourceQuestId: string;                  // the quest definition this lemma comes from
     sourceObjectiveNodeId: string;          // the specific objective node
     sourceObjectiveDisplayName: string;     // the human-readable name of the objective
   }
   // NOTE: Entries in CompiledSceneLexicon.questEssentialLemmas are uniqued per (lemmaId, sourceObjectiveNodeId)
   // tuple, NOT per lemmaId alone. A lemma can legitimately be essential to multiple objectives — keep one
   // entry per (lemma, objective) pair so runtime filtering can activate or deactivate each independently
   // based on which objectives are currently in the blackboard's activeQuestObjectives set.
   // Deduplication rule is enforced by compileSugarlangScene in Epic 6 Story 6.3.
   ```
4. Define `SourceLocation` interface — file, lineStart, lineEnd, snippet
5. Define `SceneAuthorWarning` interface — severity, message, sceneId, lemmaId?, suggestion?
5. Re-import `RuntimeCompileProfile` from `@sugarmagic/runtime-core/materials` (the existing enum) — do NOT redefine it
6. Define `CompileCacheKey` type — the string form of (sceneId, contentHash, profile, atlasVersion, pipelineVersion)
7. **Define `LexicalChunk` interface** (Proposal 001 § Lexical Chunk Awareness):
   ```ts
   interface LexicalChunk {
     chunkId: string;
     normalizedForm: string;              // stable lookup key, e.g. "de_vez_en_cuando"
     surfaceForms: string[];               // literal text variants to match, e.g. ["de vez en cuando", "De vez en cuando"]
     cefrBand: CEFRBand;                   // the chunk's level as a communicative unit
     constituentLemmas: string[];          // individual lemmas the chunk contains, for audit
     extractedByModel: string;             // "claude-sonnet-4-6" or similar, for drift detection
     extractedAtMs: number;                // when extraction ran
     extractorPromptVersion: string;       // bumps when the extraction prompt changes
     source: "llm-extracted";              // reserved for future non-LLM sources
   }
   ```
8. Add `chunks?: LexicalChunk[]` to `CompiledSceneLexicon` — **optional field**, absent means the classifier runs lemma-only (Epic 5 Story 5.3's coverage pass handles both cases identically, per the "graceful degradation" discipline in Proposal 001)
9. JSDoc on the `chunks` field explicitly notes: "populated asynchronously by Epic 14; absent on freshly-compiled scenes, present after the background chunk extractor runs"

**Tests Required:**

- Type-level test: a `CompiledSceneLexicon` value type-checks across all three profiles
- Type-level test: a `CompiledSceneLexicon` without `chunks` type-checks (the field is optional)
- Type-level test: a `CompiledSceneLexicon` with `chunks: []` type-checks (empty array is valid)
- Type-level test: a `CompiledSceneLexicon` with a populated `chunks` array type-checks
- Type-level test: `LexicalChunk.source` is a string-literal `"llm-extracted"` — adding a new source kind requires a type-level update
- Type-level test: the `RuntimeCompileProfile` type is the exact import from runtime-core, not a duplicate

**API Documentation Update:**

- `docs/api/scene-lexicon-compilation.md`: compile artifact schema with examples for each profile
- `docs/api/scene-lexicon-compilation.md`: "Lexical chunks" subsection introducing `LexicalChunk` (full implementation details live in Epic 14's API doc updates)

**Acceptance Criteria:**

- Types compile, re-exported, JSDoc present
- `LexicalChunk` is defined in this file and re-exported from `runtime/types.ts`
- `CompiledSceneLexicon.chunks` is optional and its JSDoc references Epic 14
- The proposal's "one compiler, three profiles" discipline is enforced: `RuntimeCompileProfile` is imported, not redefined

### Story 3.6: Define observation types in `contracts/observation.ts`

**Purpose:** Write the types for implicit signals flowing from gameplay into the learner state. The production observation family is split into subkinds to distinguish receptive from productive evidence per Proposal 001 § Receptive vs. Productive Knowledge.

**Tasks:**

1. Define `ObservationKind` as a string-literal union:
   ```ts
   type ObservationKind =
     | "encountered"
     | "rapid-advance"
     | "hovered"
     | "quest-success"
     | "produced-typed"
     | "produced-chosen"
     | "produced-unprompted"
     | "produced-incorrect";
   ```
2. Define `LemmaObservation` as a discriminated union over `kind`, with per-kind fields:
   - `{ kind: "encountered" }` — passive exposure
   - `{ kind: "rapid-advance"; dwellMs: number }` — read past without hover
   - `{ kind: "hovered"; dwellMs?: number }` — clicked for translation
   - `{ kind: "quest-success"; objectiveNodeId: string }` — lemma was in a completed objective's text
   - `{ kind: "produced-typed"; inputText: string }` — typed in free-text input
   - `{ kind: "produced-chosen"; choiceSetId: string }` — selected from a UI suggestion list
   - `{ kind: "produced-unprompted" }` — voluntary use when not required by directive
   - `{ kind: "produced-incorrect"; attemptedForm: string; expectedForm: string }` — wrong form attempted
3. Define `FSRSGrade` as `"Again" | "Hard" | "Good" | "Easy"`
4. Define `ObservationContext` interface — sessionId, turnId, sceneId, lang, conversationId
5. Define `ObservationEvent` as `{ observation: LemmaObservation; lemma: LemmaRef; context: ObservationContext }`
6. Define a helper type `ProducedObservationKind = Extract<ObservationKind, \`produced-${string}\`>` so downstream code can narrow to production subkinds with one import
7. Define `ObservationOutcome` shape that the observation→grade rule table in Epic 8 produces:
   ```ts
   interface ObservationOutcome {
     receptiveGrade: FSRSGrade | null;
     productiveStrengthDelta: number;
   }
   ```
   Both fields are required; `receptiveGrade` is `null` for observations that provide no receptive evidence (`encountered` alone)

**Tests Required:**

- Type-level test: exhaustive switch over `ObservationKind` produces an `ObservationOutcome` — ensures the discriminated union is exhaustive across all eight kinds
- Type-level test: a new kind added to `ObservationKind` fails compilation until the observation→grade mapping handles it
- Type-level test: `ProducedObservationKind` correctly narrows to only the four `produced-*` kinds
- Type-level test: a `hovered` observation without the optional `dwellMs` still type-checks

**API Documentation Update:**

- `docs/api/budgeter.md`: "Observation → grade mapping" section with the full eight-kind discriminated union and the `ObservationOutcome` schema
- Cross-reference to Proposal 001 § Receptive vs. Productive Knowledge

**Acceptance Criteria:**

- Discriminated union is exhaustive across all eight kinds
- `ProducedObservationKind` helper narrows correctly
- Types compile, re-exported, JSDoc present

### Story 3.7: Define ADR 010 provider interfaces in `contracts/providers.ts`

**Purpose:** Write the three provider interfaces that Proposal 001 and ADR 010 require to be separable. This is the single most important story in this epic — it locks in the architectural boundaries.

**Tasks:**

1. Define `LexicalAtlasProvider` interface:
   - `getLemma(lemmaId: string, lang: string): Atlas LemmaEntry | undefined`
   - `getBand(lemmaId: string, lang: string): CEFRBand | undefined`
   - `getFrequencyRank(lemmaId: string, lang: string): number | undefined`
   - `listLemmasAtBand(band: CEFRBand, lang: string): LemmaRef[]`
   - `getAtlasVersion(lang: string): string`
2. Define `AtlasLemmaEntry` supporting type — lemmaId, lang, cefrPriorBand, frequencyRank, partsOfSpeech, gloss?, examples?, cefrPriorSource?
3. Define `LearnerPriorProvider` interface:
   - `getInitialLemmaCard(lemmaId: string, lang: string, learnerBand: CEFRBand): LemmaCard`
   - `getCefrInitialPosterior(selfReportedBand?: CEFRBand): CefrPosterior`
4. Define `DirectorPolicy` interface:
   - `invoke(context: DirectorContext): Promise<PedagogicalDirective>`
5. Define `DirectorContext` supporting type — learner, prescription, scene, npc, recentTurns, lang, calibrationActive, **pendingProvisionalLemmas**, **probeFloorState**, **activeQuestEssentialLemmas**:
   ```ts
   interface DirectorContext {
     // ... existing fields ...
     pendingProvisionalLemmas: PendingProvisional[];   // lemmas with provisional (unconfirmed) evidence
     probeFloorState: ProbeFloorState;                 // current soft/hard floor status
   }
   
   interface PendingProvisional {
     lemmaRef: LemmaRef;
     evidenceAmount: number;        // 0..5, current provisional evidence on the card
     turnsPending: number;           // session-turns since this card first accumulated provisional evidence
   }
   
   interface ProbeFloorState {
     turnsSinceLastProbe: number;
     totalPendingLemmas: number;
     softFloorReached: boolean;       // set when the Context middleware recommends a probe
     hardFloorReached: boolean;       // set when the Context middleware forces a probe
     hardFloorReason?: "turns-since-probe" | "lemma-age";
   }
   
   /**
    * Lemmas from the scene's questEssentialLemmas that are tied to currently-active
    * quest objectives. Populated by the Context middleware by filtering
    * CompiledSceneLexicon.questEssentialLemmas against activeQuestObjectives from the
    * blackboard. The Director treats these as a separate mandatory channel that MUST
    * use heavy (parenthetical or inline) glossing if referenced.
    * 
    * See Proposal 001 § Quest-Essential Lemma Exemption (the Linguistic Deadlock fix).
    */
   interface ActiveQuestEssentialLemma {
     lemmaRef: LemmaRef;
     sourceObjectiveNodeId: string;
     sourceObjectiveDisplayName: string;
     sourceQuestId: string;
     cefrBand: CEFRBand;               // for telemetry; classifier ignores this
   }
   ```
6. `pendingProvisionalLemmas` is populated by the Context middleware (Epic 10) before the Director is invoked. Both fields are cross-referenced in Proposal 001 § Observer Latency Bias.
7. `activeQuestEssentialLemmas: ActiveQuestEssentialLemma[]` is populated by the Context middleware from `CompiledSceneLexicon.questEssentialLemmas` filtered by active objectives from `ConversationRuntimeContext.activeQuestObjectives`. See Proposal 001 § Quest-Essential Lemma Exemption.
6. Add a file-header JSDoc section explicitly citing ADR 010 and listing the three non-crossing directions of dependency: `LexicalAtlasProvider` never imports from the other two; `LearnerPriorProvider` never imports from `DirectorPolicy`; `DirectorPolicy` may import from both of the above but never writes to them

**Tests Required:**

- Type-level test: a mock implementation of each provider type-checks
- Architectural test (grep-based, not runtime): `contracts/providers.ts` has no `import` from `runtime/director/`, `runtime/budgeter/`, or `runtime/learner/` — the boundary is one-way
- Lint/check: add an ESLint rule or a `packages/testing/` architectural test that fails if any file under `runtime/providers/impls/` imports from `runtime/director/` or `runtime/middlewares/`

**API Documentation Update:**

- `docs/api/providers.md`: the three interfaces, the ADR 010 one-way-dependency rules, and a diagram of how a v1 impl sits in the hierarchy

**Acceptance Criteria:**

- Three provider interfaces compile and re-export
- ADR 010 one-way dependency discipline is documented and enforced by the architectural test
- `docs/api/providers.md` is complete and cross-linked to ADR 010

### Story 3.7b: Define placement questionnaire types in `contracts/placement-questionnaire.ts`

**Purpose:** Write the types for the plugin-owned placement questionnaire. These types describe the questionnaire data shape that ships in `data/languages/<lang>/placement-questionnaire.json`, the player's filled-in response, and the deterministic scoring result. Per Proposal 001 § Cold Start Sequence, placement is a plugin-owned questionnaire, NOT an LLM-driven dialog, so these types are load-bearing: they define the data contract between the plugin's shipped questions, the UI primitive that renders them, and the scoring engine that turns responses into a CEFR estimate.

**Tasks:**

1. Define `PlacementQuestionnaire` interface — the top-level shape of the shipped questionnaire per language:
   ```ts
   interface PlacementQuestionnaire {
     schemaVersion: 1;
     lang: string;                        // "es" | "it" | ...
     targetLanguage: string;              // same as lang; explicit for clarity
     supportLanguage: string;             // "en" — used for glosses and instructions
     formTitle: string;                   // "Arrival Form" in the support language
     formIntro: string;                   // "Please fill out what you can. Leave blanks for anything you don't understand." in support language
     questions: PlacementQuestionnaireQuestion[];
     minAnswersForValid: number;          // e.g. 6 — below this the scoring is low-confidence
   }
   ```

2. Define `PlacementQuestionnaireQuestion` as a discriminated union over question kinds:
   ```ts
   type PlacementQuestionnaireQuestion =
     | MultipleChoiceQuestion
     | FreeTextQuestion
     | YesNoQuestion
     | FillInBlankQuestion;
   
   interface PlacementQuestionKindBase {
     questionId: string;                  // stable id, used in telemetry and debugging
     targetBand: CEFRBand;                // the CEFR band this question probes
     promptText: string;                  // shown to the player, in the target language
     supportText?: string;                // optional explanation in the support language (shown as a hint)
   }
   
   interface MultipleChoiceQuestion extends PlacementQuestionKindBase {
     kind: "multiple-choice";
     options: Array<{
       optionId: string;
       text: string;                      // shown in the target language
       isCorrect: boolean;                // the expected-answer pattern
     }>;
   }
   
   interface FreeTextQuestion extends PlacementQuestionKindBase {
     kind: "free-text";
     expectedLemmas: string[];            // any of these lemmas present in a correct form = pass
     acceptableForms?: string[];          // optional explicit acceptable surface forms (fallback if lemmatizer struggles)
     minExpectedLength?: number;          // chars; helps reject empty or one-word answers
   }
   
   interface YesNoQuestion extends PlacementQuestionKindBase {
     kind: "yes-no";
     correctAnswer: "yes" | "no";
     yesLabel: string;                    // in the target language ("sí", "no")
     noLabel: string;
   }
   
   interface FillInBlankQuestion extends PlacementQuestionKindBase {
     kind: "fill-in-blank";
     sentenceTemplate: string;            // "Me ___ Sam" where ___ is the blank
     acceptableAnswers: string[];         // ["llamo"]
     acceptableLemmas?: string[];         // ["llamar"] — used when the player types an inflection
   }
   ```

3. Define `PlacementQuestionnaireResponse` — the player's filled-in form:
   ```ts
   interface PlacementQuestionnaireResponse {
     questionnaireId: string;             // references the PlacementQuestionnaire.schemaVersion + lang for audit
     submittedAtMs: number;
     answers: Record<string, PlacementAnswer>;   // keyed by questionId; missing = skipped
   }
   
   type PlacementAnswer =
     | { kind: "multiple-choice"; optionId: string }
     | { kind: "free-text"; text: string }
     | { kind: "yes-no"; answer: "yes" | "no" }
     | { kind: "fill-in-blank"; text: string }
     | { kind: "skipped" };
   ```

4. Define `PlacementScoreResult` — the deterministic scoring output:
   ```ts
   interface PlacementScoreResult {
     cefrBand: CEFRBand;                  // the final estimate
     confidence: number;                  // [0, 1]
     perBandScores: Record<CEFRBand, { correct: number; total: number }>;
     lemmasSeededFromFreeText: LemmaRef[];  // lemmas the player produced in free-text fields; seed these as produced-typed observations
     skippedCount: number;
     totalCount: number;
     scoredAtMs: number;
     questionnaireVersion: string;        // links back to the shipped bank for audit
   }
   ```

5. Define a new `SugarlangPlacementFlowPhase` string-literal union for the placement sub-state machine:
   ```ts
   type SugarlangPlacementFlowPhase =
     | "opening-dialog"    // NPC speaks the welcome; normal pipeline runs
     | "questionnaire"     // form UI active; normal pipeline bypassed
     | "closing-dialog"    // NPC speaks the handoff; normal pipeline runs with known CEFR
     | "not-active";       // placement already completed or NPC is not a placement NPC
   ```

6. This story does NOT change `ConversationInteractionMode`. Placement continues to use `interactionMode: "agent"` for the NPC — it's the placement flow PHASE that switches the UI, not the NPC's mode. The placement NPC is a normal agent NPC; the plugin just intercepts the conversation host when the questionnaire phase is active.

7. Document the "plugin owns this" discipline: the types define the SHAPE of the data, but the specific questions are shipped as plugin data in `data/languages/<lang>/placement-questionnaire.json` (Epic 4 Story 4.5). Projects cannot customize the questionnaire in v1; per-NPC override is a v1.1 extension point via an optional `NPCDefinition.metadata.sugarlangPlacementQuestionnaireOverrideId` that v1 ignores.

**Tests Required:**

- Type-level test: a valid `PlacementQuestionnaire` with all four question kinds type-checks
- Type-level test: the discriminated union exhaustiveness holds — a switch over `question.kind` produces a `never` default
- Type-level test: `PlacementQuestionnaireResponse` discriminated union is exhaustive across all four question kinds plus "skipped"
- Type-level test: `PlacementScoreResult.perBandScores` is a full `Record<CEFRBand, ...>` (all six bands required)
- Fixture validation: a hand-crafted fixture questionnaire (3 questions, one of each kind) passes JSON schema validation (schema file lives in Epic 4 Story 4.1)

**API Documentation Update:**

- `docs/api/placement-contract.md`: new subsection "Placement Questionnaire Types" documenting the four question kinds, the response shape, the score result shape, and the v1 plugin-owns-the-bank discipline
- Cross-reference Proposal 001 § Cold Start Sequence and § Placement Interaction Contract

**Acceptance Criteria:**

- All five new types (`PlacementQuestionnaire`, `PlacementQuestionnaireQuestion` union, `PlacementQuestionnaireResponse`, `PlacementScoreResult`, `SugarlangPlacementFlowPhase`) compile and are re-exported from `runtime/types.ts`
- JSDoc on every type links to Proposal 001
- The plugin-owns-the-bank discipline is documented in the API reference

### Story 3.8: Populate `runtime/types.ts` as the single import surface

**Purpose:** Re-export every public type from the contracts folder through `runtime/types.ts` so downstream code imports `from "../types"` once instead of importing individual files.

**Tasks:**

1. `runtime/types.ts` re-exports every type from `contracts/pedagogy.ts`, `contracts/learner-profile.ts`, `contracts/lexical-prescription.ts`, `contracts/envelope.ts`, `contracts/scene-lexicon.ts`, `contracts/observation.ts`, `contracts/providers.ts`
2. Update the header block to reflect the new exports
3. Fix any circular-import issues surfaced by the re-export pattern (unlikely for type-only files, but check)

**Tests Required:**

- Type-level test: `import type { LearnerProfile, PedagogicalDirective, CompiledSceneLexicon, EnvelopeVerdict } from "../types"` in a fresh `.ts` file type-checks

**API Documentation Update:**

- `docs/api/README.md`: add a "Import surface" note — always prefer `runtime/types` for consumers

**Acceptance Criteria:**

- Every exported contract type is reachable via `runtime/types`
- `tsc --noEmit` passes
- No direct imports from `contracts/*` outside of `runtime/types.ts` itself and the contracts files (enforced by a grep-based architectural test in Epic 14 later, but not this epic)

## Risks and Open Questions

- **Branded types vs. plain strings.** Some identifiers (LearnerId, LemmaId, SceneId) may benefit from branded types for type safety, but branded types add import friction and sometimes confuse JSDoc generators. Default to plain `string` with JSDoc comments, escalate to branding only if confusion arises.
- **Discriminated union exhaustiveness across epics.** If a later epic adds a new `ObservationKind`, the observation→grade mapping in Epic 8 must handle it. The type-level exhaustiveness test guards this, but a reviewer should flag it in future contracts PRs.
- **Scene lexicon schema vs. runtime type drift.** The `CompiledSceneLexicon` TypeScript type and the `data/schemas/scene-lexicon.schema.json` must stay in sync. Epic 6 owns the compile pipeline and should add a test that validates the runtime type against the JSON schema. Flag as a future concern.

## Exit Criteria

Epic 3 is complete when:

1. All eight stories are complete
2. Every type from Proposal 001 is implemented in the correct contracts file
3. `runtime/types.ts` re-exports the full type surface
4. Type-level tests pass
5. `tsc --noEmit` passes
6. Each `docs/api/*.md` file has been updated with the types it owns
7. The ADR 010 architectural test is wired up and passing
8. This file's `Status:` is updated to `Complete`
