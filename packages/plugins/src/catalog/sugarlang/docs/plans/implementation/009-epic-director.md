# Epic 9: Director

**Status:** Complete
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Director](../../proposals/001-adaptive-language-learning-architecture.md#3-director)
**Depends on:** Epic 1, Epic 3, Epic 4, Epic 6, Epic 7, Epic 8
**Blocks:** Epic 10 (middleware invokes director). (Note: Epic 11 placement was previously blocked by this epic's `calibration-mode.ts`, but the questionnaire redesign decoupled placement from the Director — Epic 11 no longer depends on Epic 9 for placement flow. The Director is still used for the opening and closing dialog phases of placement, but those run the normal pipeline with no calibration-variant.)

## Context

The Director is the **hybrid layer** — the one LLM call per scene entry that takes the Budgeter's raw prescription and reshapes it for narrative tone, NPC voice, and dramatic moment. It runs rarely (~0.15–0.30 calls/turn amortized), is cached by conversation scope with lifetime invalidation, and its output is a strict `PedagogicalDirective` JSON schema.

The Director can only *reshape*, never *invent*: its output is constrained to subsets of the prescription the Budgeter already produced. This hard constraint is what makes Director hallucinations safe — the worst case is a slightly suboptimal directive, never a completely wrong target word.

This epic is the heaviest LLM-integration work in the plugin. It requires prompt engineering, schema validation, caching, and fallback logic. It is also where the most cost and latency can hide, so performance instrumentation is part of the scope.

## Prerequisites

- Epic 1, Epic 3, Epic 4, Epic 6, Epic 7, Epic 8

## Success Criteria

- `SugarLangDirector.invoke(context)` returns a valid `PedagogicalDirective`
- Claude structured-output is parsed and validated
- Cache hit rate ≥70% in typical conversation flow
- Fallback policy produces a usable directive when Claude fails
- Calibration-mode variant exists for cold-start placement
- Per-turn cost is bounded by the lifetime-based caching
- Full telemetry for (context → directive → outcome) traces

## Stories

### Story 9.1: Implement `prompt-builder.ts`

**Purpose:** Assemble the Director's prompt from the learner state, prescription, scene context, NPC bio, recent dialogue, the pedagogical rubric, **and the pending provisional evidence + probe floor state** that drive comprehension check decisions per Proposal 001 § Observer Latency Bias.

**Tasks:**

1. Implement `buildDirectorPrompt(context: DirectorContext): DirectorPrompt` where `DirectorPrompt = { system: string; user: string; cacheMarkers: string[] }`
2. The system prompt contains: role definition + pedagogical rubric (~450 tokens, cacheable) + CEFR level descriptors + output schema + hard constraints + **comprehension-check guidance block** (~150 tokens, cacheable, detailed below). This part is **static per scene** and flagged for prompt caching.
3. The user prompt contains: learner profile summary + lemma summary (top 12 due, last 8 introduced, top 5 struggling) + scene teachable index + NPC bio + game moment + recent dialogue + Budgeter prescription + **pending provisional evidence section (dynamic, ~100-150 tokens depending on pending lemma count)** + **probe floor state flags**. This is the dynamic portion.
4. Budget targets: ~2,250 cacheable tokens + ~400 dynamic tokens per call (up slightly from the original ~2,100 + ~300 because of the probe-related context).
5. For each context slice, write a dedicated formatter function that produces a readable sub-string (e.g. `formatLemmaSummary`, `formatSceneTeachableIndex`, `formatRecentDialogue`, `formatPendingProvisional`, `formatProbeFloorState`).
6. Every formatter is pure — no LLM calls, no state.
7. Prompt strings are defined as exported constants at the top of the file so a reviewer (or a golden test) can see exactly what the Director sees.
8. **Comprehension check guidance block** (cacheable, in the system prompt):
   ```
   COMPREHENSION CHECKS:
   
   The player's scheduler has two kinds of evidence per word: committed (real FSRS progress)
   and provisional (unconfirmed read-past exposure that has not yet been converted into
   mastery). Provisional evidence comes from the player skimming past a word in dialogue
   without hovering for a translation or producing the word themselves — behavior that might
   mean they know it, or might mean they're in a hurry. It is not reliable evidence on its
   own.
   
   When provisional evidence is accumulating (see the "pending provisional" section in the
   user prompt), you may choose to trigger a comprehension check to convert provisional
   evidence into committed mastery. Set `comprehensionCheck.trigger: true` in your output,
   pick 1–3 target lemmas from the pending list, and include `triggerReason:
   "director-discretion"` in your rationale.
   
   IMPORTANT RULES FOR COMPREHENSION CHECKS:
   
   1. A probe does NOT need to be narratively tied to the current scene or quest.
      It can be a total non-sequitur from whatever the NPC was just talking about.
   
   2. A probe MUST stay IN CHARACTER for the NPC speaking. The character's voice is the
      vehicle; the specific target lemmas are the payload. A stationmaster musing about
      cheese can naturally ask "¿entiendes?" or "y tú, ¿también te gusta el queso?" without
      breaking character. A noir bouncer would ask differently. Use the NPC bio you've been
      given to calibrate.
   
   3. Good probes are short, conversational, and elicit a response that demonstrates
      comprehension of the target lemmas:
        "¿entiendes?"
        "¿qué piensas tú?"
        "y tú, ¿cómo lo ves?"
        "¿a ti también te gusta?"
        "dime, ¿qué harías?"
   
   4. BAD probes sound clinical or classroom-like:
        "Now tell me what this word means"
        "Can you use 'llave' in a sentence?"
        "What does 'vez' mean?"
      These break the illusion that this is a conversation, not a test.
   
   5. Do not overuse probes. Each probe interrupts the conversational flow, and the floor
      state tells you when probes are over-frequent vs. under-frequent. If you see
      `probeFloorState.softFloorReached: true`, you should probe this turn. If you see
      `probeFloorState.hardFloorReached: true`, you MUST probe this turn — the system
      requires it.
   
   ELICITATION MODE (Swain Output Hypothesis hint):
   
   One of the interaction styles you can pick is `elicitation_mode` — a Swain-aligned
   style where the NPC invites the player to produce specific lemmas rather than just
   exposing them. Consider picking this style when the prescription contains 3 or more
   lemmas with a high receptive-productive gap (high `stability` but low `productiveStrength`).
   These are words the learner recognizes but cannot produce — good targets for a
   production-prompting turn. This is not a hard threshold — use your judgment based on
   the scene context and the NPC's character voice — but if the gap signal is strong,
   elicitation_mode is often the right choice. Do not use elicitation_mode when no
   high-gap lemmas exist; it would feel contrived.
   
   QUEST-ESSENTIAL LEMMAS (Linguistic Deadlock fix):
   
   The classifier exempts certain lemmas from the CEFR envelope when they appear in
   currently-active quest objective text. These "quest-essential" lemmas are the
   vocabulary the player MUST encounter to understand their current goal — even if
   those words are above their CEFR band. They are marked in the user prompt's
   "QUEST-ESSENTIAL LEMMAS" section.
   
   Rules:
   
   1. If the current scene references an active quest objective, you are expected to use
      at least one quest-essential lemma in your reply.
   2. When quest-essential lemmas appear in the user prompt, you MUST set glossingStrategy
      to "parenthetical" (preferred) or "inline". Never "hover-only" or "none".
   3. The Generator is instructed to provide an inline parenthetical translation after
      the first use of each quest-essential lemma. Your job as the Director is to make
      sure the glossingStrategy field authorizes it.
   4. Do not add quest-essential lemmas to `targetVocab.introduce`, `reinforce`, or
      `avoid`. They flow through a separate channel. Pretend they do not exist for the
      purposes of targetVocab.
   ```
9. **Dynamic section: pending provisional evidence** (in the user prompt), formatted by `formatPendingProvisional`:
   ```
   PENDING PROVISIONAL EVIDENCE:
   
   The following lemmas have accumulated unconfirmed exposure. The player has read past
   them quickly without hovering or producing them. Their FSRS stability has NOT been
   updated because the evidence is unconfirmed. A comprehension check on any of these
   lemmas would convert the evidence to mastery (on pass) or discard it (on fail).
   
   {{for each pending}}
   - {{lemmaId}} ({{cefrBand}}): {{evidenceAmount}} units, pending for {{turnsPending}} turns
   {{/for each}}
   
   Total pending: {{totalPendingLemmas}} lemmas, {{turnsSinceLastProbe}} turns since last probe.
   Probe floor state: {{softFloorReached ? "SOFT FLOOR — probe recommended" : ""}} {{hardFloorReached ? "HARD FLOOR — probe REQUIRED this turn (reason: " + hardFloorReason + ")" : ""}}
   ```
10. When `probeFloorState.hardFloorReached === true`, the prompt builder adds an **additional hard-requirement line** at the top of the user prompt: `"REQUIREMENT: This turn MUST trigger a comprehension check. Set comprehensionCheck.trigger = true in your output. Pick target lemmas from the pending provisional list. Do not defer."`
11. **Quest-essential lemmas section** (dynamic, in the user prompt, formatted by `formatQuestEssentialLemmas`). When `context.activeQuestEssentialLemmas` is non-empty:
    ```
    QUEST-ESSENTIAL LEMMAS (Linguistic Deadlock fix — Proposal 001):
    
    The player's currently-active quest objectives contain vocabulary that is ABOVE their
    CEFR envelope but cannot be simplified without losing the quest meaning. These words
    are classifier-exempt — you may use them freely, regardless of learner level. However,
    because the player cannot understand them natively, you MUST provide an inline
    parenthetical translation in {{supportLanguage}} immediately after the first use of
    each such word this turn.
    
    {{for each active quest-essential lemma}}
    - {{lemmaId}} ({{cefrBand}}) — from objective "{{sourceObjectiveDisplayName}}"
      gloss: "{{supportLanguageGloss}}"
    {{/for each}}
    
    REQUIREMENT: If any of your reply references the current objective at all, you MUST
    use at least one of these lemmas. You MUST set glossingStrategy to "parenthetical"
    (preferred) or "inline". You may NOT set glossingStrategy to "hover-only" or "none"
    when quest-essential lemmas are present — the player needs immediate translations.
    
    Example of correct output for "altar" in Spanish with English support:
      "Ve al altar (the altar) detrás del templo."
    
    Example of INCORRECT output (no parenthetical):
      "Ve al altar detrás del templo."  ← player has no idea what "altar" means
    ```
12. The quest-essential section is in the USER prompt (not system), because the specific active objectives change scene-to-scene. The rubric *about* quest-essential lemmas is in the system prompt (cacheable).

**Tests Required:**

- Fixture test: given a hand-crafted `DirectorContext`, the prompt contains the expected sub-strings
- Token budget test: the assembled prompt is within budget (±10%)
- Cache marker test: the static portion is identified correctly for prompt caching
- Formatter test per slice: each formatter produces expected output for a fixture input
- **Comprehension guidance block test:** the system prompt contains the static comprehension-check guidance block verbatim — this is a snapshot test that forces the reviewer to re-approve the guidance if it changes
- **Pending provisional formatter test:** given a `DirectorContext` with 3 pending lemmas, `formatPendingProvisional` produces the expected readable output with all 3 lemmas, their evidence amounts, and turnsPending values
- **Soft floor prompt test:** a context with `softFloorReached: true` produces a user prompt containing "SOFT FLOOR — probe recommended"
- **Hard floor prompt test:** a context with `hardFloorReached: true` produces a user prompt containing "HARD FLOOR — probe REQUIRED this turn" AND the hard-requirement line at the top: "REQUIREMENT: This turn MUST trigger a comprehension check"
- **No-pending formatter test:** a context with no pending provisional lemmas produces a formatPendingProvisional output that reads "No pending provisional evidence." instead of an empty list — so the LLM isn't confused by blank sections

**API Documentation Update:**

- `docs/api/director.md`: "Prompt structure" section with the budget breakdown and the cacheable vs dynamic split

**Acceptance Criteria:**

- Prompt assembly is deterministic
- Token budget is respected
- Formatters are unit-tested

### Story 9.2: Implement `schema-parser.ts`

**Purpose:** Parse and strictly validate Claude's JSON output against the `PedagogicalDirective` schema. Reject or repair malformed output.

**Tasks:**

1. Implement `parseDirective(json: string): ParseResult` where `ParseResult = { directive: PedagogicalDirective } | { error: DirectiveParseError }`
2. Use a JSON schema validator (e.g. `ajv` or `zod`) to validate the parsed JSON against the `PedagogicalDirective` shape
3. On validation failure: return a structured error with per-field detail, do not throw
4. Implement `repairDirective(partial: unknown, prescription: LexicalPrescription, context: DirectorContext): PedagogicalDirective` — best-effort repair: fill in missing required fields with defaults from the prescription (e.g. `targetVocab.introduce` defaults to `prescription.introduce`); drop unknown fields; clamp numeric fields to valid ranges
5. The repair function is deterministic — never invokes Claude again, never makes up content beyond defaulting to the prescription
6. **Hard floor enforcement (Observer Latency Bias):** if `context.probeFloorState.hardFloorReached === true` AND the parsed directive has `comprehensionCheck.trigger === false`, the parser treats this as a **rejected directive** — returns an error that causes the caller to fall back to `FallbackDirectorPolicy`. Log a `comprehension.director-hard-floor-violated` telemetry event so we can see when the Director LLM is ignoring the hard-floor instruction.
7. **Target lemma validation for comprehension checks:** if the parsed directive has `comprehensionCheck.trigger === true` but `comprehensionCheck.targetLemmas` contains lemmas NOT in `context.pendingProvisionalLemmas`, the repair function drops invalid entries. If the list is empty after repair AND a probe is required (soft or hard floor), the repair fills it with the top-3 oldest pending lemmas from the context. This prevents the Director from hallucinating target lemmas and guarantees the probe has something real to measure.
8. **Quest-essential glossing enforcement (Linguistic Deadlock fix):** if `context.activeQuestEssentialLemmas.length > 0` AND the parsed directive has `glossingStrategy: "hover-only"` or `"none"`, the schema-parser **rejects the directive** and the caller falls back to `FallbackDirectorPolicy` (Story 9.4). This is a hard requirement — quest-essential lemmas without parenthetical/inline glossing are player-hostile because the player cannot understand the quest. Log a `quest-essential.director-forced-glossing` telemetry event (defined in Epic 13) with the original and corrected glossingStrategy values.
9. **Quest-essential targetVocab contamination check:** if the parsed directive includes any `activeQuestEssentialLemmas` lemma IDs in `targetVocab.introduce`, `targetVocab.reinforce`, or `targetVocab.avoid`, the repair function strips them. Quest-essential lemmas flow through a separate channel and should not appear in the normal targetVocab — mixing them corrupts the Budgeter's accounting and clutters the Generator's instructions. Log a `quest-essential.director-targetvocab-contamination` telemetry event for audit.

**Tests Required:**

- Fixture test: valid JSON → valid directive
- Fixture test: JSON missing a required field → repair succeeds with prescription defaults
- Fixture test: JSON with `targetVocab.introduce` containing a lemma NOT in `prescription.introduce` → that lemma is dropped (hard "no invention" rule)
- Fixture test: malformed JSON → returns error, does not throw
- Fixture test: JSON with out-of-range `targetLanguageRatio` (e.g. 1.5) → clamped to [0, 1]

**API Documentation Update:**

- `docs/api/director.md`: "Schema parsing and repair" section with the hard "no invention" rule clearly stated

**Acceptance Criteria:**

- All parse/repair tests pass
- The "no invention" rule is enforced in the parser
- Errors are never thrown to the caller — always returned as structured results

### Story 9.3: Implement `claude-director-policy.ts`

**Purpose:** The Claude-backed implementation of `DirectorPolicy`. Invokes Claude with structured output, parses the result, handles failures.

**Tasks:**

1. Implement `ClaudeDirectorPolicy implements DirectorPolicy`
2. Constructor takes an Anthropic API client (reuse the existing SugarAgent API client if possible, otherwise instantiate from environment config)
3. `async invoke(context: DirectorContext): Promise<PedagogicalDirective>`:
   - Build the prompt via `buildDirectorPrompt`
   - Call Claude (model `claude-sonnet-4-6` or configurable) with the prompt, prompt caching enabled, structured-output enabled
   - Parse the result via `parseDirective`
   - If parse succeeds, return the directive
   - If parse fails, attempt repair with `repairDirective(partial, context.prescription)`
   - If repair also fails, throw a `DirectorInvocationError` — the middleware catches this and falls back to `FallbackDirectorPolicy`
4. Instrument every call: log input token count, output token count, latency, cache hit/miss, model id, timestamp. Emit a telemetry event.
5. Configurable model — default to Sonnet, allow override to Haiku for cost-reduction scenarios (Proposal 001 § Cost-reduction levers)

**Tests Required:**

- Unit test with mocked Claude client: valid response → directive
- Unit test with mocked Claude client: malformed response → repair → directive
- Unit test with mocked Claude client: Claude errors → `DirectorInvocationError`
- Integration test (gated, optional): real Claude call with a fixture context; assert directive schema is valid. This test is skipped by default in CI to avoid API costs, enabled via env flag for manual runs.
- Telemetry test: every invocation emits a telemetry event with the expected fields

**API Documentation Update:**

- `docs/api/director.md`: "Claude implementation" section with model configuration, cost instrumentation, and the fallback trigger

**Acceptance Criteria:**

- Claude invocation path is testable with mocks
- Telemetry captures every call
- Fallback trigger is clear

### Story 9.4: Implement `fallback-director-policy.ts`

**Purpose:** The deterministic fallback when Claude fails. Produces a valid `PedagogicalDirective` from sensible defaults derived from the learner state and the budgeter prescription.

**Tasks:**

1. Implement `FallbackDirectorPolicy implements DirectorPolicy`
2. Default logic:
   - `targetVocab.introduce` = first N of `prescription.introduce` capped by `levelCap`
   - `targetVocab.reinforce` = all of `prescription.reinforce`
   - `targetVocab.avoid` = `prescription.avoid`
   - `supportPosture` = `"anchored"` if `learner.cefrConfidence < 0.3`, `"supported"` if `< 0.7`, `"target-dominant"` otherwise
   - `targetLanguageRatio` = 0.3 / 0.65 / 0.85 respectively
   - `interactionStyle` = `"listening_first"` at cold start, `"guided_dialogue"` at low confidence, `"natural_dialogue"` otherwise
   - `glossingStrategy`:
     - If `context.activeQuestEssentialLemmas.length > 0` → `"parenthetical"` (hard requirement from Linguistic Deadlock fix)
     - Else if any introduce lemmas exist → `"inline"`
     - Else → `"hover-only"`
   - `sentenceComplexityCap` = `"single-clause"` at A1, `"two-clause"` at A2–B1, `"free"` at B2+
   - `comprehensionCheck.trigger` — set based on the probe floor state: `true` when `context.probeFloorState.hardFloorReached` is true (the hard floor forces a probe regardless of Director reasoning), OR when `context.probeFloorState.softFloorReached` is true AND confidence is medium or higher (soft floor + confident learner = good moment to probe); otherwise `false`
   - When a probe is triggered in the fallback, select target lemmas as the top-3 oldest from `context.pendingProvisionalLemmas` (ordered by `turnsPending` descending), set `probeStyle: "recognition"` (simplest, least intrusive), and set `triggerReason` to the matching `ProbeTriggerReason` value (`"hard-floor-turns"`, `"hard-floor-lemma-age"`, `"soft-floor"`, or `"director-deferred-override"` if the fallback was triggered because the LLM's directive was rejected by the hard-floor enforcement in Story 9.2)
   - `directiveLifetime = { maxTurns: 3, invalidateOn: ["quest_stage_change", "location_change"] }`
   - `citedSignals = ["fallback:claude-unavailable"]`
   - `rationale = "Deterministic fallback — Director LLM unavailable."`
   - `isFallbackDirective = true`
3. The fallback is fully deterministic — given the same inputs, same output, no stochasticity

**Tests Required:**

- Unit test: fallback directive type-checks
- Unit test: fallback at cold start produces anchored posture with inline glossing
- Unit test: fallback at high confidence produces target-dominant posture
- Unit test: `isFallbackDirective === true` in every fallback output (a downstream check to distinguish fallback from Claude-generated)
- **Hard floor fallback test:** a context with `probeFloorState.hardFloorReached: true` and 5 pending provisional lemmas → fallback directive has `comprehensionCheck.trigger: true`, `targetLemmas` populated from the top-3 oldest pending, `triggerReason: "hard-floor-turns"` (or `"director-deferred-override"` depending on how it was triggered)
- **Soft floor fallback test:** context with `softFloorReached: true` + high confidence → fallback triggers probe with `triggerReason: "soft-floor"`
- **No floor fallback test:** context with no floors reached → fallback has `comprehensionCheck.trigger: false`

**API Documentation Update:**

- `docs/api/director.md`: "Fallback policy" section with the full rule table

**Acceptance Criteria:**

- Fallback always produces a valid directive
- Deterministic
- Flagged as fallback for downstream filtering

### Story 9.5: Implement `directive-cache.ts`

**Purpose:** Cache `PedagogicalDirective` entries on the conversation-scoped blackboard with lifetime-based invalidation.

**Tasks:**

1. Implement `DirectiveCache` class backed by `ACTIVE_DIRECTIVE_FACT` (blackboard, conversation scope, session lifetime)
2. API:
   - `get(conversationId: string): PedagogicalDirective | null` — returns the cached directive if valid, null if expired or absent
   - `set(conversationId: string, directive: PedagogicalDirective, now?: number): void`
   - `invalidate(conversationId: string, reason: InvalidationReason): void`
3. Invalidation logic: a cached directive is valid if:
   - Its `directiveLifetime.maxTurns` has not been exceeded (turn counter is incremented on every turn in that conversation)
   - None of its `directiveLifetime.invalidateOn` triggers have fired
4. `InvalidationReason` is one of: `"max_turns_exceeded" | "quest_stage_change" | "location_change" | "affective_shift" | "player_code_switch" | "manual"`
5. Subscribe to the blackboard events for each invalidation trigger (quest stage change, location change, etc.) and call `invalidate` automatically

**Tests Required:**

- Unit test: set → get within maxTurns → returns directive
- Unit test: set → 4 turns pass → get after maxTurns=3 → returns null
- Unit test: set → blackboard fires quest stage change → get → returns null
- Unit test: manual invalidate clears the entry
- Integration test: invalidation on real blackboard events

**API Documentation Update:**

- `docs/api/director.md`: "Cache and invalidation" section with the full lifecycle

**Acceptance Criteria:**

- Cache hits and invalidations work correctly
- Cross-turn lifetime is respected
- Blackboard event subscriptions work

### Story 9.6: Implement `calibration-mode.ts` (minimal, deprecated for placement)

**Purpose:** **This story is substantially simplified from its earlier form.** Per Proposal 001 § Cold Start Sequence, placement is now a plugin-owned deterministic questionnaire — NOT a Director-driven calibration loop. The old "calibration mode" concept where the Director probed CEFR band boundaries turn-by-turn in a placement conversation is **deprecated and no longer implemented**.

What remains in `calibration-mode.ts` is a tiny utility surface for the handful of edge cases where the Director still benefits from knowing the learner is in a low-confidence cold-start state (e.g. the first 5–10 normal conversations after placement, where `cefrConfidence` is still low-ish despite placement having completed). This is a soft signal for the Director's prompt, not a separate prompt pathway.

**Tasks:**

1. Implement `isInPostPlacementCalibration(learner: LearnerProfile): boolean`:
   - Returns true when `learner.assessment.status === "evaluated"` (placement completed) AND `learner.cefrConfidence < 0.65` AND `learner.currentSession.turns < 10`
   - This is the "placement finished but the learner is still warming up" signal — the Director's normal prompt should lean toward slightly easier content and more glossing during this window
2. Implement `buildPostPlacementCalibrationHint(): string` — a ~50-token addendum added to the Director's standard user prompt when `isInPostPlacementCalibration` is true:
   ```
   NOTE: This learner just completed their placement assessment but has not yet built up session history. Lean slightly toward the cautious side — prefer supported posture over target-dominant, prefer inline glossing on any new word, keep sentences at one or two clauses. This is a brief settling-in window, not a permanent constraint.
   ```
3. In `ClaudeDirectorPolicy.invoke`, if `isInPostPlacementCalibration` is true, append the addendum to the user prompt. This is the only remaining use of "calibration mode" in the Director layer — it's a soft hint, not a separate prompt pathway or schema.
4. **Explicitly NOT implemented** (moved to Epic 11 as part of the questionnaire flow): placement-tagged NPC detection, CEFR band probing, per-turn Bayesian posterior updates driven by Director judgment, `calibrationVerdict` fields in `citedSignals`, `DirectorContext.placementQuestionBank`. All of these concepts belonged to the old Director-driven placement design and are obsolete under the questionnaire model.

**Tests Required:**

- Unit test: `isInPostPlacementCalibration` returns true for a learner with completed placement but low confidence and <10 session turns
- Unit test: returns false for a learner with high confidence
- Unit test: returns false for a learner with many session turns (the window has closed)
- Unit test: returns false for a learner whose placement has not completed yet — placement itself is handled by Epic 11 (questionnaire), not by this module
- Fixture test: the addendum string is exactly the expected string (snapshot test)

**API Documentation Update:**

- `docs/api/director.md`: "Post-placement calibration hint" subsection noting that this is the only remaining `calibration-mode` concept — no separate prompt pathway, just a soft hint
- `docs/api/placement-contract.md`: cross-reference — placement is handled by Epic 11's questionnaire flow, not by the Director

**Acceptance Criteria:**

- The module is small (~50 lines total; a utility, not a subsystem)
- The post-placement calibration window is properly scoped
- The old placement-tagged-NPC-detection logic is demonstrably absent from this file (reviewer should be able to grep for `sugarlangRole` and find no references in `calibration-mode.ts`)

### Story 9.7: Implement `sugar-lang-director.ts` facade

**Purpose:** The single entry point that wires together the cache, the Claude policy, the fallback policy, and the calibration logic.

**Tasks:**

1. Implement `SugarLangDirector` class with:
   - Constructor: `{ claudePolicy, fallbackPolicy, cache, config }`
   - `async invoke(context: DirectorContext): Promise<PedagogicalDirective>`
2. The `invoke` flow:
   - Check the cache (`cache.get(context.conversationId)`); return if hit
   - Check if calibration is active; if so, set the context flag
   - Try `claudePolicy.invoke(context)`; on `DirectorInvocationError`, fall back to `fallbackPolicy.invoke(context)`
   - Cache the result (`cache.set(...)` with the directive's lifetime)
   - Emit a telemetry event (Claude success / fallback / cache hit)
   - Return the directive

**Tests Required:**

- Unit test: cache hit path short-circuits correctly
- Unit test: Claude success → cached → returned
- Unit test: Claude failure → fallback → cached (with fallback's shorter lifetime) → returned
- Unit test: calibration context flows through correctly
- Integration test: end-to-end invocation with mocks for Claude

**API Documentation Update:**

- `docs/api/director.md`: "Director facade" as the canonical entry point other epics use

**Acceptance Criteria:**

- Facade is the only public Director API used by downstream code
- Tests cover cache hit, Claude success, and fallback paths

## Risks and Open Questions

- **Prompt cache hit rate.** Anthropic's prompt caching requires the cacheable portion to be stable across calls. Any dynamic content in the "cacheable" section invalidates the cache. Carefully isolate the dynamic portions in `prompt-builder.ts` and verify with the token-cost telemetry that cache hits are actually happening.
- **Claude API errors during a live conversation.** Transient failures (rate limits, network issues) should fall back smoothly without stalling the conversation. The fallback path MUST be fast (< 10ms) so the user doesn't notice when Claude hiccups.
- **Structured output vs. regular output.** Claude supports structured output / tool-use-style JSON generation. Use it if available for deterministic schema compliance; fall back to asking for JSON in the prompt and parsing carefully. Document the choice.
- **Post-placement calibration hint test coverage.** The `isInPostPlacementCalibration` helper in Story 9.6 is a tiny utility used in edge cases; it should be unit-tested but does not need its own end-to-end scenario. (The old placement-tagged-NPC calibration variant is obsolete under the questionnaire redesign — placement runs through Epic 11, not through the Director.)
- **Cost telemetry.** Every invocation logs token counts. In Epic 14, the E2E tests assert that the amortized cost stays within the Proposal 001 budget.

## Exit Criteria

Epic 9 is complete when:

1. All seven stories are complete
2. All tests pass (unit, integration with mocks; optional live-Claude integration test passes when run manually)
3. Fallback path produces valid directives in every failure mode tested
4. Calibration mode works end-to-end with mocked Claude
5. `docs/api/director.md` is complete
6. `tsc --noEmit` passes
7. This file's `Status:` is updated to `Complete`
