# Plan 083 -- Two-Channel Voice + Verified Level Control (child epic D of Strategy 002)

Status: DRAFT (pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 (docs/plans/strategy/002-sugarlang-adaptive-language-acquisition-strategy.md) -- this is child epic D; scope from "Voice survives the envelope (two-channel speech)", "What the science says" item 7, and the turn-budget discipline in "Lines are intent"
- Plan 081 (sugarlang foundation completion, epic A) -- dependency: this epic assumes 081's telemetry production path (ratio/voice verdict events ride it), the 081.7 debug band levers (verification recipe), and the 081.5 golden harness (new goldens extend it)
- Plan 018 (plugin composition contract) + ADR 010 provider boundaries (packages/plugins/src/catalog/sugarlang/docs/api/providers.md) -- everything here stays inside the `sugarlang.constraint` annotation seam; boundary tests extend to every new surface
- Ground truth: all code claims below verified against producing lines 2026-07-26; line numbers drift, grep the quoted identifiers

---

## Why now

Strategy 002's level-control position is that level is a VERIFICATION problem, not a prompting problem (prompt-only CEFR targeting matches ~5%; drift grows with conversation length). The verify loop that exists today is far below that bar, and one hole is a live product bug that blocks all playtesting above the anchored postures:

- RATIFIED ADDITION (nikki, 2026-07-26), highest urgency: there is no check that the output is even IN the target language. Live test at B2: the constraint overlay asked "Reply mostly in es ... Aim for about 85% es" and "Target-language ratio: 0.85" (generator-prompt-overlay.ts:31, :50), sugaragent's generate produced 100% English, and the turn played untouched. Mechanism, verified: English tokens fail target-language lemmatization or atlas lookup and land in `unknownTokens` (coverage.ts:134-137, :144-148), so `coverageRatio` collapses and the envelope verdict correctly FAILS (envelope-rule.ts:124-127) -- but the verify middleware builds repair instructions solely from per-lemma `verdict.violations` (sugar-lang-verify-middleware.ts:225-229) and the entire repair/auto-simplify block sits behind `if (instructions.length > 0)` (:230). An all-English turn produces a failing verdict with ZERO lemma violations, so verify silently returns it unchanged. No dimension of the verdict measures target-language share against `constraint.targetLanguageRatio`; the field is written by the teacher (sugar-lang-teacher-middleware.ts:305) and spliced into the prompt, then never checked again.
- Worse, found while verifying: verify is OFF BY DEFAULT. `verifyEnabled` resolves true only when the plugin config explicitly sets it or the `SUGARMAGIC_SUGARLANG_VERIFY_ENABLED` env var is set (config.ts:137-139); the middleware fully bypasses on false (sugar-lang-verify-middleware.ts:118-128). The config comment calls the flag a "temporary debugging escape hatch" (config.ts:50-53), but the DEFAULT is the escape hatch. Strategy 002's "the envelope classifier runs per-turn forever, in both modes" is aspirational today.
- Repair, when it does run, is word-swapping: one LLM call instructed `Remove or simplify "<lemmaId>"` per violation (sugar-lang-verify-middleware.ts:64-75, :225-229), with a deterministic autoSimplify fallback. No best-of-N (proven ~2x control-error reduction at no quality cost -- Malik et al., ACL Findings 2024), no say-it-simpler framing, no voice protection: nothing stops repair from flattening "Why good day to you, my fine sir" into "Hello."
- There is no voice channel anywhere. The only voice artifact in the codebase is an ad-hoc `npc.metadata?.voice` string read for the comprehension-probe reminder (middlewares/shared.ts:264-274). Signature interjections are classified like any other token, so an A1 NPC's "Caramba!" counts against the envelope; gesture tags like `*sweeps hat*` are tokenized as ordinary words (tokenize.ts has no action-tag handling) and drag down both coverage and, once 083.1 lands, the measured ratio.
- Constraint re-injection: the overlay IS re-injected per turn in the uncached user half of the generate prompt (sugaragent prompt/builder.ts:237), but it sits buried mid-prompt while the persona digest gets the terminal drift-reminder slot (builder.ts:249-252, Plan 072.8). Nothing measures whether the constraint actually holds across a long conversation, so drift (arXiv 2505.08351) is invisible.

Division of labor stays fixed: the teacher decides, the model renders, the verifiers check. This epic builds the CHECK half out to the strategy's spec -- envelope + language ratio + voice retention as verified dimensions -- and makes repair preserve the character while it simplifies the words.

## Non-goals

- Scripted-path verification: verify skips scripted dialogue today (sugar-lang-verify-middleware.ts:101-104) and keeps doing so; the rendering ladder and its bake-time triple verification are epic C (C adopts this epic's verifiers and prompt shapes when both exist).
- No changes to sugaragent's judge rubric or stages. The judge keeps character/world fidelity; sugarlang keeps envelope + ratio + voice retention on its own verify path. Best-of-N lives in sugarlang's repair, not in sugaragent's RegenerateStage.
- No chunks/functions (epic B), no teacher outer loop (epic E), no negotiation moves (epic F), no barks.
- No self-hosted constrained decoding (watchlist; see Deferred).
- Nothing new crosses the plugin boundary: additions ride inside the existing `sugarlang.constraint` annotation as opaque fields, following the `generatorPromptOverlay` / `minimalGreetingMode` precedent (GenerateStage.ts:199-201, :401).

## Design principles

- Turn budget discipline (Strategy 002): the common-path agent turn gets ZERO sugarlang model calls (all three verdict dimensions are deterministic); the verify-fail path gets exactly ONE (the multi-candidate repair call that REPLACES today's single repair call). More than three model calls end-to-end in a turn is a design smell.
- Fail-soft, never block: every new check degrades to pass-through with telemetry, like the existing repair path; the typing indicator masks repair latency.
- One enforcer: verdict scoring lives in one place (the classifier facade + one candidate scorer), not scattered across middleware branches.
- Floors before ceilings: deterministic similarity scoring before any LLM voice judge; single-call multi-candidate sampling before parallel sampling.
- Consult code, not plans: line refs above are anchors, not contracts; re-grep before building.

## Stories (EXECUTION ORDER)

083.1 sequences FIRST and deliberately does not depend on the voice-channel authoring stories: it is the playtest unblocker.

### 083.1 Language-ratio conformance in the verify verdict (PRODUCT BUG; unblocks playtesting)

Add target-language share as a verified dimension beside the envelope verdict, and make verify act on every failing dimension.

1. MEASURE (deterministic, zero model calls): a target-language token-share measure over the turn -- fraction of word tokens that resolve through target-language lemmatization + atlas (the resolution machinery already exists in coverage.ts; the measure is a new counter, not a new pipeline). Excluded from the denominator: numbers, known entities/proper nouns, and (once 083.3 lands) whitelisted voice interjections and gesture-tag spans. Known ambiguity, accepted: an OOV target-language word counts as non-target (same bucket as `unknownTokens` today); the check is for GROSS violations, so the noise floor is fine. Decide-in-story: whether to subtract a small support-language collision list (es/en overlaps like "no", "me", "a") for cleaner numbers.
2. VERDICT: the classifier's verdict (or a sibling `languageRatioVerdict` beside `EnvelopeVerdict` -- decide-in-story which surface) carries measuredRatio, directedRatio (`constraint.targetLanguageRatio`), posture, and a conformance flag. Fail when grossly under: posture-aware thresholds (e.g. target-only/target-dominant fail well below directed; anchored is effectively unconstrained downward -- exact bands decide-in-story, pinned by tests). Over-ratio (too MUCH target language for an anchored beginner) is also a level-control failure; decide-in-story whether it repairs or only logs in this story.
3. ACT: verify triggers repair on ratio failure even with zero lemma violations (kills the `instructions.length > 0` pass-through, sugar-lang-verify-middleware.ts:230), with an explicit rewrite instruction carrying the target: "Rewrite this reply so about N% of it is in <targetLanguage>; keep the meaning." Coverage-only failures (in-language but low coverage) get a "say it simpler using words the learner knows" instruction the same way -- a failing verdict must never fall through silently again. Until 083.2 lands this drives the existing single-repair call; 083.2 swaps the engine underneath.
4. DEFAULT ON: `verifyEnabled` becomes default-true (config.ts:137-139 currently requires explicit opt-in); the escape hatch inverts to an explicit disable (config flag and/or env var shape decide-in-story). Playtesting above anchored postures is meaningless with verify off.
5. TELEMETRY: ratio verdict + repair outcome events ride the 081.2 event path (schema-versioned; no player free text per the 081.2 PII posture). This is the "envelope hold rate per turn" metric from Strategy 002's "How we know it is teaching", now with a language-mix axis.

- Exit: unit tests pin the measure on mixed-language fixtures (100% en -> ~0; 50/50 -> ~0.5; es with OOV noise stays above the fail band). Integration test pins the bug: B2 learner, directed ratio 0.85, mock generation returns all-English -> verify FAILS, repair is invoked with the rewrite-in-target-language instruction, and a mock-repaired mostly-es turn passes. A fresh dev boot with no env vars runs verify (default-on proven by test). Ratio verdict events visible in telemetry for every agent turn.

### 083.2 Best-of-N say-it-simpler repair (replaces the single repair call)

The verify-fail path upgrades from retry-on-fail to sample-and-select, and the repair prompt shifts from word-swapping to simplification of expression.

1. ONE structured repair call returns N candidates (N=3-4, decide-in-story; single multi-candidate call is the floor -- it replaces today's `attemptRepair` call at sugar-lang-verify-middleware.ts:231, so the fail path still costs exactly one model call. Parallel sampling via the gateway is a ceiling, only if candidate quality demands it and latency stays inside the typing indicator).
2. Deterministic scoring, free: every candidate is scored by the classifier -- envelope verdict + ratio conformance (083.1) + voice retention (083.4 plugs in here). Selection: best candidate that passes all dimensions; else best-scoring candidate if it beats the original; else the existing deterministic autoSimplify fallback (kept as the last rung).
3. The repair prompt is rewritten as SAY IT SIMPLER (replacing the "Remove or simplify <lemmaId>" instruction set, sugar-lang-verify-middleware.ts:64-75): preserve the message and any quest-essential content, cap syntax per `sentenceComplexityCap`, hit the directed language ratio, and -- once 083.3 exists -- keep the voice channel exempt (interjections, tics, gesture tags survive verbatim). Simplify the expression of the concept, never substitute the concept.
4. Telemetry: per-candidate scores + selected index, so the ~2x control-error claim (Malik et al. 2024) is checkable against our own numbers.

- Exit: mock-gateway test -- verify fail produces one repair call returning N candidates; scorer picks the passing one; a run where no candidate passes falls through to autoSimplify. Turn-budget guard test: verify-pass path makes zero sugarlang LLM calls; verify-fail path makes exactly one. Repaired turns preserve quest-essential lemmas (test pins it).

### 083.3 Per-NPC voice-channel spec (authoring source per install mode)

NPC speech decomposes into a constrained lexical channel and a level-free voice channel. This story builds the spec and its two authoring sources; it does not require 083.1/083.2 and can run in parallel.

1. `VoiceChannelSpec` type: signature interjections/exclamations (whitelisted free vocabulary), punctuation/tempo habits (prose note), gesture-tag conventions, and 2-4 exemplar lines (the similarity anchors for 083.4 and the level-description exemplars the control literature says halve control error).
2. Source per install mode, per the strategy: with sugaragent present, a `## Voice` section on the NPC's lore page, parsed at compile -- the sugarlang compile pipeline already traverses NPC lore pages (lore-resolution.ts:151, scene-traversal.ts:92), so this is a section extractor plus artifact plumbing, keyed by npcDefinitionId with the usual content-hash invalidation. Sugarlang-alone: typed voice fields on the NPC definition, formalizing the ad-hoc `metadata.voice` string that `extractCharacterVoiceReminder` reads today (middlewares/shared.ts:264-274; that helper starts reading the spec). Lore page wins when both exist (decide-in-story: warn on conflict).
3. Classifier integration: whitelisted interjections get a new exemption kind (envelope-rule.ts `resolveExemption`, :49-87) so "Caramba!" never counts against an A1 envelope; gesture-tag spans (`*...*`) are stripped before tokenization (tokenize.ts has no handling today) and excluded from coverage, the 083.1 ratio measure, and observe-side encounter counting.
4. Prompt integration: voice-channel lines join `buildGeneratorPromptOverlay` and the scripted overlay (generator-prompt-overlay.ts) -- interjections, tics, gesture-tag permission -- so the character stays loud while the words simplify. The overlay stays one opaque string; nothing new crosses the boundary.

- Exit: an NPC with a `## Voice` lore section speaks at A1 with its interjections and gesture tags intact and zero envelope violations from them (integration test); the same NPC definition-fields path works with sugaragent absent (sugarlang-alone fixture); gesture-tag text provably absent from coverage and ratio denominators (unit test); compile round-trip cached and invalidated on lore edit.

### 083.4 Voice-retention verdict beside the envelope verdict

Repair must not flatten the character; the literature has no joint CEFR+persona benchmark, so we ship our own check.

1. Deterministic voice score (floor, zero model calls): marker-feature similarity against the NPC's `VoiceChannelSpec` -- presence of signature interjections/tics, punctuation/tempo habit match, gesture-tag retention, plus cheap lexical similarity against the exemplar lines. Scored on the original turn AND on every 083.2 candidate.
2. Wiring: the score joins the 083.2 candidate scorer, so best-of-N selection prefers candidates that keep the voice; a repair that strips all voice markers loses to one that keeps them. On the common path the score is telemetry-only (a low-voice ORIGINAL turn does not fail verification by itself in this story -- character fidelity of first-pass generation is the judge's domain; decide-in-story whether a hard floor on repair OUTPUT rejects candidates outright).
3. One rubric line rides the 083.2 repair prompt (the strategy's "one rubric line where the judge already runs" lands here rather than in sugaragent's judge -- see Non-goals): "Keep <NPC>'s voice: <interjections/tics summary>. These are exempt from simplification."
4. NPCs with no voice spec: score is neutral, everything degrades to 083.2 behavior.

- Exit: unit tests -- candidate keeping "Ah! ... *sweeps hat*" outscores the flattened candidate on the same text; neutral score without a spec. Integration: forced repair on a voiced NPC returns a selected candidate retaining at least the interjection markers; voice-score telemetry emitted per repair.

### 083.5 Constraint re-injection cadence + drift measurement

Agent-mode drift is real and grows with conversation length; today we neither counter it deliberately nor measure it.

1. MEASURE FIRST (this is the story's spine): per-turn drift telemetry -- measured ratio (083.1), envelope hold, voice score (083.4), keyed by turn index within the conversation -- riding 081.2. This makes drift visible before and after any countermeasure, per the probe-first rule.
2. Terminal reminder: a new optional opaque field on the constraint (e.g. `generatorPromptReminder`, one short line: language ratio + posture restated) that the generate prompt splices as a LAST block beside the persona drift reminder (prompt/builder.ts:249-252, the proven Plan 072.8 shape) -- the overlay today is re-injected per turn but buried mid-prompt (builder.ts:237). Same annotation seam, opaque string, absent-safe; sugaragent reads one more field exactly as it reads `minimalGreetingMode`. Boundary test extends to the new field.
3. Cadence policy: always-on short reminder is the floor; decide-in-story whether the reminder escalates (fuller restatement) when the drift telemetry shows ratio hold degrading across the session's recent turns. Directive-cache lifetimes (directive-cache.ts:77-81 maxTurns consumption, plus quest/location invalidation) stay untouched -- the teacher's directive cadence is epic E's concern; this story is about the RENDERER holding the already-issued constraint.

- Exit: a 12+ turn mock-gateway conversation golden shows per-turn ratio/envelope hold events with turn index; with the reminder on, the golden's held-ratio trajectory is pinned (deterministic mock, no-flake rule); boundary test proves the new constraint field is optional and opaque; grep-clean: no sugaragent import of sugarlang types beyond the existing local `LanguageLearningConstraint` shape.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean; the turn-budget guard and the all-English pass-through pin both exist and pass.
2. Ratio fix probe (083.1): Studio -> preview -> Learner Override (081.7) -> set B2 -> talk to an agent NPC. Turn inspector / telemetry shows a measured ratio per turn; replies arrive mostly in the target language. If a turn comes back mostly English, it gets repaired before display (verify.repair events in telemetry), not played raw.
3. Default-on probe: fresh checkout config, no env vars -- verify runs (visible verdict events with debugLogging on).
4. Voice probe (083.3/083.4): give one NPC a `## Voice` lore section (interjection + a gesture tag + 2 exemplar lines), set band A1, converse: the NPC keeps its interjections and gestures while speaking simply; force a repair (violating mock or a hard band) and the repaired line still sounds like the character.
5. Drift probe (083.5): one long conversation (12+ turns) at B1; telemetry shows ratio hold per turn index staying flat rather than sliding toward English.

## Epic wrap

docs/api touch per house norm: middlewares page (verify contract: three verdict dimensions, best-of-N selection, turn budget), new voice-channel page (spec fields, `## Voice` section format, NPC definition fields, exemption semantics), telemetry page (new event kinds). Boundary tests extended (new constraint fields). Update Strategy 002's epic D entry status. Backlog sweep of DEFERRED SEAM comments added here.

## Deferred / out of scope (with revisit triggers)

- Self-hosted small model for token-masked constrained decoding: watchlist per Strategy 002; revisit only if best-of-N + say-it-simpler cannot hold A1 in telemetry (code comment at the 083.2 candidate scorer).
- Real language-identification library for the ratio measure: the morphology-resolution share is deliberately cheap; revisit if telemetry shows ratio false-fails on legitimate target-language turns rich in OOV words (code comment at the measure).
- Parallel-sampled best-of-N via the gateway (true independent samples): revisit if single-call multi-candidate quality plateaus below the ~2x control-error improvement the literature promises.
- Voice line in sugaragent's judge rubric: would need a seam for an opaque sugarlang rubric contribution; revisit only if deterministic voice scoring provably misses flattening that players notice.
- Barks and the wider bark system: strategy names them "later"; not in any story here.
- Scripted-path and bake-time use of these verifiers: epic C composes them into its triple verification; this epic only guarantees they are callable outside the middleware (pure functions on the classifier facade).
- Studio authoring UI polish for voice specs (form editor, live preview): floor here is lore-page text + NPC definition fields; revisit at first playtest complaint about authoring friction.
