# Epic 8: Lexical Budgeter

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Lexical Budgeter](../../proposals/001-adaptive-language-learning-architecture.md#1-lexical-budgeter)
**Depends on:** Epic 1, Epic 3, Epic 4, Epic 6, Epic 7
**Blocks:** Epic 9 (Director reshapes the budgeter's prescription), Epic 10 (middleware invokes the budgeter)

## Context

The Lexical Budgeter is the **ML core** of sugarlang. For every conversation turn it answers: *what should this learner be exposed to next?* Its output is a `LexicalPrescription` — a set of lemmas to introduce, reinforce, or avoid — that flows into the Director for narrative shaping and then into the Generator as a constraint.

The Budgeter is **set arithmetic plus an FSRS scheduler**. There are no hand-tuned thresholds in its decision layer; the ML is inside FSRS (a calibrated memory model) and the Bayesian CEFR posterior (real probability). Everything else is transparent set filtering and a linear scoring function with explicit named weights.

This epic depends on most of the earlier work: it uses the compiled scene lexicon from Epic 6, the learner state from Epic 7, the atlas from Epic 4, and the types from Epic 3.

## Prerequisites

- Epic 1, Epic 3, Epic 4, Epic 6, Epic 7

## Success Criteria

- `LexicalBudgeter.prescribe(input)` returns a deterministic `LexicalPrescription`
- FSRS cards update correctly in response to observations
- The three-stage funnel (scene gate → envelope gate → priority score) is implemented
- Observation → FSRS grade mapping is a pure, total function
- Transparent, named scoring weights
- Every prescription carries a complete `LexicalRationale` for debugging
- Integration with the `ts-fsrs` library
- Comprehensive unit tests

## Stories

### Story 8.1: Integrate `ts-fsrs` and productive-strength tracking in `fsrs-adapter.ts`

**Purpose:** Wrap the external `ts-fsrs` library in a thin adapter so the rest of the plugin uses sugarlang's own `LemmaCard` shape and does not import `ts-fsrs` directly. The adapter also owns the `productiveStrength` update logic since receptive (FSRS) and productive strength update together in response to observation outcomes.

**Tasks:**

1. Add `ts-fsrs` as a dependency of the sugarlang plugin (verify license is compatible)
2. Implement `createFsrsEngine(options?: { retention?: number })` returning a configured FSRS instance
3. Implement `lemmaCardToFsrsCard(card: LemmaCard): FsrsCard` and the inverse. The inverse preserves `productiveStrength`, `lastProducedAtMs`, `provisionalEvidence`, and `provisionalEvidenceFirstSeenTurn` verbatim; none of them are FSRS-library fields
4. Implement `applyOutcome(card: LemmaCard, outcome: ObservationOutcome, now?: number, sessionTurn?: number): LemmaCard`:
   - If `outcome.receptiveGrade` is non-null, apply it via the FSRS engine to update `stability`, `difficulty`, `retrievability`, `lastReviewedAt`, `reviewCount`, `lapseCount`
   - Apply `outcome.productiveStrengthDelta` to `productiveStrength`: `clamp01(card.productiveStrength + delta)`
   - Apply `outcome.provisionalEvidenceDelta` (new field on `ObservationOutcome`) to `provisionalEvidence`: `clamp(card.provisionalEvidence + delta, 0, PROVISIONAL_EVIDENCE_MAX)`. If the card had `provisionalEvidenceFirstSeenTurn === null` and the delta is positive, set it to `sessionTurn`.
   - If the delta is positive (a production event), update `lastProducedAtMs = now`
5. Implement `decayProductiveStrength(card: LemmaCard, now: number, config: ProductiveDecayConfig): LemmaCard` — applies time-based decay to productive strength on a longer half-life than FSRS's receptive decay. Default half-life is 60 days at full strength; decays slower from lower starting points. Decay is computed lazily on read, not on a tick — the Budgeter calls `decayProductiveStrength` when it reads a card for scoring
6. Implement `seedCardFromAtlas(lemmaId, lang, atlasEntry, learnerBand): LemmaCard` — produces an initial card with CEFR-derived `priorWeight`, initial FSRS parameters (difficulty/stability) from the `LearnerPriorProvider`, **`productiveStrength = INITIAL_PRODUCTIVE_STRENGTH` (always 0)**, and **`provisionalEvidence = INITIAL_PROVISIONAL_EVIDENCE` (always 0), `provisionalEvidenceFirstSeenTurn = null`**
7. Export the productive-strength decay constants as named constants (`PRODUCTIVE_DECAY_HALF_LIFE_DAYS = 60`, etc.) so they are tunable and auditable
8. Implement `commitProvisionalEvidence(card: LemmaCard): LemmaCard` — applies a single FSRS "Good" grade to the card (as if the player had just successfully produced the lemma in a recognition context), then zeros `provisionalEvidence` and `provisionalEvidenceFirstSeenTurn`. Returns a new card. This is the function the reducer calls when a comprehension probe passes for this lemma (per Epic 7 Story 7.5).
9. Implement `discardProvisionalEvidence(card: LemmaCard): LemmaCard` — zeros `provisionalEvidence` and `provisionalEvidenceFirstSeenTurn` without applying any FSRS grade. Returns a new card. Called by the reducer when a comprehension probe fails for this lemma.
10. Implement `decayProvisionalEvidence(card: LemmaCard, currentSessionTurn: number): LemmaCard` — if `provisionalEvidenceFirstSeenTurn !== null` and `(currentSessionTurn - firstSeenTurn) > PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`, zero both fields. Otherwise return the card unchanged. Pure function with a clear threshold.
11. Export `PROVISIONAL_EVIDENCE_MAX = 5` and `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD = 30` as named constants (duplicates of Epic 3's exports, re-exported here for the module boundary convenience — both modules import from a shared source of truth)

**Tests Required:**

- Unit test: applying an outcome with `receptiveGrade: "Good"` to a fresh card advances stability
- Unit test: applying `receptiveGrade: "Again"` to a reviewed card resets stability and increments `lapseCount`
- Unit test: applying an outcome with `productiveStrengthDelta: 0.3` (e.g., `produced-typed`) to a card with strength 0.2 yields strength 0.5 and updates `lastProducedAtMs`
- Unit test: applying a negative delta (e.g., `produced-incorrect`) to a card with strength 0.4 yields strength 0.2
- Unit test: clamping — delta that would push strength above 1 clamps to 1; delta that would push below 0 clamps to 0
- Unit test: seeding a card from an A1 atlas entry for an A1 learner produces a high-stability card with `productiveStrength = 0` and `provisionalEvidence = 0`
- Unit test: seeding an A1 entry for a C1 learner produces an even higher-stability card (still with `productiveStrength = 0` AND `provisionalEvidence = 0` — receptive priors don't imply productive knowledge OR provisional exposure)
- Unit test: `decayProductiveStrength` applied to a card whose `lastProducedAtMs` was 60 days ago yields strength ≈ half the original
- Unit test: immutability — `applyOutcome`, `decayProductiveStrength`, `commitProvisionalEvidence`, `discardProvisionalEvidence`, and `decayProvisionalEvidence` all return new cards, don't mutate input
- Determinism test: same inputs, same outcome, same output (given fixed `now`)
- **Provisional accumulation test:** applying an outcome with `provisionalEvidenceDelta: 0.3` to a card with `provisionalEvidence: 0, provisionalEvidenceFirstSeenTurn: null` at sessionTurn 10 yields a card with `provisionalEvidence: 0.3` AND `provisionalEvidenceFirstSeenTurn: 10`
- **Provisional accumulation test (clamp):** a card already at `provisionalEvidence: 4.9` receiving a delta of 0.3 yields `provisionalEvidence: 5.0` (clamped to PROVISIONAL_EVIDENCE_MAX)
- **Provisional commit test:** `commitProvisionalEvidence` on a card with `provisionalEvidence: 2.5, stability: 1.0` yields a card with `provisionalEvidence: 0, provisionalEvidenceFirstSeenTurn: null, stability > 1.0` (FSRS Good grade applied)
- **Provisional commit on empty test:** `commitProvisionalEvidence` on a card with `provisionalEvidence: 0` is a no-op — returns the same stability and same zero provisional
- **Provisional discard test:** `discardProvisionalEvidence` on a card with `provisionalEvidence: 2.5, stability: 1.0` yields a card with `provisionalEvidence: 0, stability: 1.0 unchanged`
- **Provisional decay test:** `decayProvisionalEvidence(card, sessionTurn = 50)` where `card.provisionalEvidenceFirstSeenTurn = 10` (40 turns ago) → card has `provisionalEvidence: 0, provisionalEvidenceFirstSeenTurn: null`
- **Provisional decay no-op test:** `decayProvisionalEvidence(card, sessionTurn = 15)` where `firstSeenTurn = 10` (5 turns ago) → card unchanged

**API Documentation Update:**

- `docs/api/budgeter.md`: "FSRS adapter" section explaining the wrapper, the seed-from-atlas logic, and the productive-strength update model
- `docs/api/learner-state.md`: cross-reference the productive-strength decay constants

**Acceptance Criteria:**

- All tests pass
- The rest of the plugin never imports `ts-fsrs` directly
- Productive-strength updates only happen through `applyOutcome` — no other code path mutates `productiveStrength`
- Productive-strength decay constants are exported and testable

### Story 8.2: Implement `observations.ts`

**Purpose:** The pure-function rule table mapping `LemmaObservation` to `ObservationOutcome` (receptive grade + productive strength delta). This is the entire "learning signal interpretation" layer and the single place where the receptive/productive distinction from Proposal 001 § Receptive vs. Productive Knowledge is codified.

**Tasks:**

1. `ObservationOutcome` is extended to carry three fields:
   ```ts
   interface ObservationOutcome {
     receptiveGrade: FSRSGrade | null;       // null = do not touch FSRS stability
     productiveStrengthDelta: number;         // delta to apply to productiveStrength
     provisionalEvidenceDelta: number;        // delta to apply to provisionalEvidence
   }
   ```
2. Implement `observationToOutcome(obs: LemmaObservation): ObservationOutcome` as an exhaustive switch over all eight observation kinds per Proposal 001 § Receptive vs. Productive Knowledge and § Observer Latency Bias:

   | Observation kind | Receptive grade | Productive delta | Provisional delta |
   |---|---|---|---|
   | `encountered` | `null` | 0 | 0 |
   | `rapid-advance` | `null` *(was "Good", corrected)* | 0 | `computeProvisionalEvidenceDelta(obs.dwellMs)` — typically 0.05–0.30 |
   | `hovered` | `"Hard"` | −0.05 | 0 |
   | `quest-success` | `"Good"` | 0 | 0 |
   | `produced-chosen` | `"Good"` | +0.15 | 0 |
   | `produced-typed` | `"Easy"` | +0.30 | 0 |
   | `produced-unprompted` | `"Easy"` | +0.50 | 0 |
   | `produced-incorrect` | `"Again"` | −0.20 | 0 |

   **Note on `rapid-advance`:** the Swain retrofit earlier in the plan incorrectly mapped this to `"Good"` receptive grade. That was wrong — a speed-read is indistinguishable from an ignored turn, and committing FSRS stability based on it corrupts the scheduler. The corrected mapping routes rapid-advance into the provisional-evidence system. See Proposal 001 § Observer Latency Bias and In-Character Comprehension Checks. **Epic 15 Story 15.5 (Speed-reader probe feedback loop golden scenario) is the canonical behavioral regression guard for this correction** — it asserts that a series of rapid-advance observations leaves FSRS stability exactly at its seed value. Do not delete or weaken that test; it is the guard against silent reverts.

3. Export the productive deltas AND the provisional-evidence function as named constants at the top of the file so they are tunable and auditable:
   ```ts
   export const PRODUCTIVE_DELTAS = {
     encountered: 0,
     rapidAdvance: 0,
     hovered: -0.05,
     questSuccess: 0,
     producedChosen: 0.15,
     producedTyped: 0.30,
     producedUnprompted: 0.50,
     producedIncorrect: -0.20,
   } as const;
   
   /**
    * Compute provisional evidence delta from dwell time on a rapid-advance observation.
    * Short skims add almost nothing; longer reads add more, but clamped.
    * Exported as a function rather than a constant so the formula is auditable.
    */
   export function computeProvisionalEvidenceDelta(dwellMs: number): number {
     // 0ms → 0, 1000ms → 0.1, 3000ms → 0.3, >=3000ms → 0.3 (capped)
     return Math.min(0.3, Math.max(0, dwellMs / 10000));
   }
   
   export const PROVISIONAL_DELTA_CAP = 0.3;  // max single-observation delta for audit
   ```
3. Every case has a JSDoc comment with a one-sentence rationale linking to:
   - Proposal 001 § Receptive vs. Productive Knowledge for the theoretical grounding
   - The specific SLA literature (Krashen 1985 for input signals; Swain 1985 for production signals)
   - Why the delta has the specific magnitude it does (e.g., `produced-unprompted` is stronger than `produced-typed` because unprompted voluntary production indicates the learner *reached for* the word rather than being cued to it)
4. Exhaustiveness enforcement via `never` type on the default branch — any new observation kind added to Epic 3 Story 3.6 forces a code update here before the plugin compiles

**Tests Required:**

- Exhaustive test: every `ObservationKind` maps to the documented outcome
- Exhaustiveness test: adding a new `ObservationKind` at the type level fails compilation until `observationToOutcome` handles it
- Invariant test: every `produced-*` subkind (except `produced-incorrect`) has a non-negative productive delta
- Invariant test: `produced-unprompted` has the strictly highest productive delta of the positive cases
- Invariant test: `produced-incorrect` has a negative productive delta (failed production degrades both signals)
- Invariant test: observations with productive deltas ≥ +0.15 also produce a non-null receptive grade (production implies recognition)
- Transparency test: `PRODUCTIVE_DELTAS` is exported and its values are auditable
- **Observer Latency Bias regression guard:** `observationToOutcome({ kind: "rapid-advance", dwellMs: 2000 })` returns `{ receptiveGrade: null, productiveStrengthDelta: 0, provisionalEvidenceDelta: 0.2 }`. This is a literal assertion — if someone "fixes" it back to "Good", this test fires immediately.
- **Provisional delta function test:** `computeProvisionalEvidenceDelta(0) === 0`, `computeProvisionalEvidenceDelta(1000) === 0.1`, `computeProvisionalEvidenceDelta(3000) === 0.3`, `computeProvisionalEvidenceDelta(10000) === 0.3` (capped)
- **Provisional delta is the ONLY nonzero provisional delta:** no other observation kind produces a nonzero `provisionalEvidenceDelta` — production, quest success, hover, and encountered all produce 0 for provisional
- **FSRS-is-untouched test:** an outcome with `receptiveGrade: null` AND `productiveStrengthDelta: 0` AND `provisionalEvidenceDelta > 0` (the rapid-advance case) results in zero changes to `stability`, `difficulty`, `retrievability`, `lastReviewedAt`, `reviewCount`, or `lapseCount` when applied via `applyOutcome`

**API Documentation Update:**

- `docs/api/budgeter.md`: "Observation → Outcome Mapping" with the full rule table, the `PRODUCTIVE_DELTAS` constants, and the SLA citations
- Cross-reference Proposal 001 § Receptive vs. Productive Knowledge

**Acceptance Criteria:**

- Total function — every input kind has a mapping
- Exhaustiveness enforced
- Constants exported and auditable
- All invariant tests pass

### Story 8.3: Implement `scoring.ts`

**Purpose:** The linear scoring function that ranks candidate lemmas for prescription. Includes the **productive gap** term from Proposal 001 § Receptive vs. Productive Knowledge so lemmas the learner recognizes but cannot produce score higher as reinforce targets.

**Tasks:**

1. Implement `scoreLemma(lemma: LemmaCard, scene: CompiledSceneLexicon, context: ScoringContext): LemmaScore` per Proposal 001:
   ```
   score =
     + w_due      * (1 - retrievability)                          // receptive due-ness
     + w_new      * priorWeight
     + w_anchor   * (isSceneAnchor ? 1 : 0)
     + w_prodgap  * max(0, stability - productiveStrength)        // recognized but not producible
     - w_lapse    * (lapseCount > 2 ? 1 : 0)
   ```
2. Before scoring, apply `decayProductiveStrength` AND `decayProvisionalEvidence` (from Story 8.1) to each card so both the productive gap and the provisional evidence state reflect current truth, not stale values
2a. **Provisional evidence is NOT part of the scoring formula.** A lemma with high provisional evidence is not "due" or "mastered" — it's *unconfirmed*. The scoring function deliberately does not weight provisional evidence, because doing so would let unconfirmed skim-past signals influence the Budgeter's prescriptions. The provisional evidence is available on the card for the *Director's* use (via `pendingProvisionalLemmas` context from Epic 9), not for the Budgeter's. This is an intentional architectural split: the Budgeter ranks based on committed evidence; the Director sees the gap between committed and pending and decides when to probe.
3. Export the weights as named constants (not magic numbers):
   ```ts
   export const SCORING_WEIGHTS = {
     w_due: 1.0,
     w_new: 0.7,
     w_anchor: 0.5,
     w_prodgap: 0.6,
     w_lapse: 0.3,
   } as const;
   ```
4. Each weight has a JSDoc comment explaining its rationale. The `w_prodgap` comment specifically cites Swain 1985 and Proposal 001 § Receptive vs. Productive Knowledge — this is the scoring term that makes the receptive/productive split observable in the Budgeter's output
5. `LemmaScore = { lemmaId, score, components: { due, new, anchor, prodgap, lapse }, reasons: string[] }` — every component is exposed for the rationale trace, including the productive gap contribution
6. `scoreBatch(lemmas, scene, context): LemmaScore[]` for efficient bulk scoring

**Tests Required:**

- Unit test: a freshly-due lemma scores higher than a just-reviewed one
- Unit test: an anchor lemma scores higher than a non-anchor of the same due-ness
- Unit test: a thrashing (high lapseCount) lemma scores lower than a clean one
- **Unit test: a lemma with stability=0.9 and productiveStrength=0.1 (big productive gap) scores higher than a lemma with stability=0.9 and productiveStrength=0.9 (no gap), all else equal** — this is the Swain feedback test
- Unit test: a lemma the learner has never produced (productiveStrength=0) but recognizes well (stability=0.8) shows `components.prodgap === 0.48` (= 0.6 × 0.8)
- Unit test: a lemma with productiveStrength > stability (theoretically impossible but guard anyway) contributes 0 to `prodgap` (max with 0)
- Unit test: batch scoring matches single-lemma scoring for each entry
- Transparency test: the `SCORING_WEIGHTS` constant is exported and testable, and `w_prodgap` is present and non-zero

**API Documentation Update:**

- `docs/api/budgeter.md`: "Scoring" section with the formula, the weights, and the rationale for each weight
- `docs/api/budgeter.md`: specifically document the productive-gap contribution with an example — "a learner who recognizes *llave* (stability 0.85) but has never produced it (productiveStrength 0.0) will have `prodgap = 0.51`, making *llave* a high-priority reinforce target for a production-prompting turn"

**Acceptance Criteria:**

- All tests pass, including the Swain feedback test
- Weights are named and exported
- Formula matches Proposal 001
- Productive gap contribution is visible in the `LemmaScore.components`

### Story 8.4: Implement `lexical-budgeter.ts`

**Purpose:** The main budgeter. Runs the three-stage funnel and produces a `LexicalPrescription`.

**Tasks:**

1. Implement `LexicalBudgeter` class with:
   - Constructor: `{ atlas, learnerStore, sceneLexiconStore, learnerPriorProvider }`
   - `async prescribe(input: LexicalPrescriptionInput): Promise<LexicalPrescription>`
2. The prescribe method runs:
   - **Stage 0: Quest-essential exclusion.** Before the scene gate, identify the set of lemma IDs that appear in the input's `activeQuestEssentialLemmas` list (passed in from the Context middleware's runtime filtering — see Epic 10 Story 10.1). These lemmas are handled through a separate channel and MUST be excluded from the Budgeter's normal candidate set — they should not consume introduce/reinforce/avoid slots. See Proposal 001 § Quest-Essential Lemma Exemption for why.
   - **Stage 1: Scene gate.** Read the `CompiledSceneLexicon` from the scene lexicon store. Its `lemmas` dictionary is the candidate set. **Filter out any lemma already in the quest-essential exclusion set from Stage 0.**
   - **Stage 2: Envelope gate.** For each candidate, fetch or seed the `LemmaCard`. Drop any card whose `cefrPriorBand > learnerBand + 1`.
   - **Stage 3: Priority scoring.** Score remaining candidates with `scoreBatch`. Sort descending.
   - **Stage 4: Partition.** Top scores become `introduce` (if `reviewCount === 0`, cap at `levelCap`) or `reinforce` (otherwise, cap at 4). `avoid` is the envelope-gate rejects, limited to the worst 12 by score.
   - **Stage 5: Anchor.** If any top-scored lemma is a scene anchor, it becomes the optional `anchor` field.
   - **Stage 6: Rationale.** Build a `LexicalRationale` capturing candidate set size, envelope survivors, per-lemma scores, reasons, **and the quest-essential exclusion list (for debugging why certain high-priority lemmas didn't appear in the output)**.
3. `levelCap` per CEFR band (from Proposal 001):
   ```
   A1 → 1 new word per turn
   A2 → 2
   B1 → 3
   B2+ → 4
   ```
4. The budgeter reads but never writes learner state. Writes happen in the reducer (Epic 7), triggered by middleware observations (Epic 10).

**Tests Required:**

- End-to-end test: a fresh A1 learner + a scene with 300 lemmas produces a prescription with 1 introduce, 0 reinforce, 12 avoid
- End-to-end test: an A1 learner with 10 lemmas already mastered produces a prescription with reinforce items
- End-to-end test: an A2 learner in a B1-dense scene produces a prescription respecting the envelope gate
- Determinism test: same inputs → same prescription
- Scaling test: a scene with 1,000 candidate lemmas prescribes in <10ms
- **Quest-essential exclusion test:** a scene where a B2 lemma (e.g. `altar`) is in both the normal candidate set AND in `activeQuestEssentialLemmas` → the resulting prescription does NOT include `altar` in any of `introduce`/`reinforce`/`avoid` (it's handled separately via the quest-essential channel). The rationale explicitly lists `altar` under `questEssentialExclusions` so debug reviewers can see why it was skipped.
- **Quest-essential doesn't leak test:** a scene where `activeQuestEssentialLemmas` is empty → the Budgeter behavior is byte-identical to pre-Linguistic-Deadlock behavior (regression guard)

**API Documentation Update:**

- `docs/api/budgeter.md`: full `prescribe` API reference with the three-stage funnel diagrammed

**Acceptance Criteria:**

- All tests pass
- Budgeter is a read-only consumer of learner state
- Performance budget met

### Story 8.5: Implement `rationale.ts`

**Purpose:** The `LexicalRationale` builder that captures every decision for the debug panel.

**Tasks:**

1. Implement `buildLexicalRationale(input, funnelResult): LexicalRationale`
2. Fields:
   - `candidateSetSize: number` — lemmas in the scene gate
   - `envelopeSurvivors: number` — after envelope gate
   - `perLemmaScores: LemmaScore[]` — every survivor's score with components
   - `levelCap: number`
   - `chosenIntroduce: LemmaRef[]`
   - `chosenReinforce: LemmaRef[]`
   - `droppedByEnvelope: LemmaRef[]`
3. Include a `summary: string` field that's a human-readable 2-sentence explanation (generated by a template, not an LLM)

**Tests Required:**

- Unit test: rationale captures a complete decision trace for a fixture scenario
- Unit test: the `summary` string is generated deterministically from the rationale data

**API Documentation Update:**

- `docs/api/budgeter.md`: "Rationale" section showing the shape and how to consume it in the debug panel

**Acceptance Criteria:**

- Every prescription carries a complete, accurate rationale

## Risks and Open Questions

- **Scoring weight tuning.** The v1 weights are reasonable defaults, not optimized. Tuning requires real session data — park this for v2. The transparency test ensures the weights are findable when it's time to revisit.
- **LevelCap vs. scene constraints.** A scene with only 1 A1 lemma cannot produce 3 "introduce" picks at B1. The budgeter returns whatever the scene actually allows — shorter is fine. Document this in the API reference.
- **Budgeter performance with large learner card stores.** A learner with 10,000 cards should not slow down prescription. The scene gate limits candidates to ~300, and `bulkGet` paging from Epic 7 handles the card fetch. Performance test catches regressions.
- **Interaction with the Director's reshape.** The Director can veto or re-rank the prescription. The budgeter's job is to produce the *unshaped* prescription; the Director's job is to reshape it. No coupling.

## Exit Criteria

Epic 8 is complete when:

1. All five stories are complete
2. All tests pass
3. `docs/api/budgeter.md` is complete
4. `tsc --noEmit` passes
5. This file's `Status:` is updated to `Complete`
