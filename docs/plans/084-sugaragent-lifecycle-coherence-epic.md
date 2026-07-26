# Plan 084 -- Sugaragent Lifecycle Coherence (child epic H of Strategy 002)

Status: DRAFT (pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 (docs/plans/strategy/002-sugarlang-adaptive-language-acquisition-strategy.md) -- this is child epic H, ratified 2026-07-26 mid-epic-D when live B2 testing exposed the judge conflict
- Plan 083 (epic D) -- PAUSED after 083.2; its remaining voice stories (083.3+) depend on 084.4 here; 083.5's reminder field moves onto 084.1's generateReminder surface (amendment to 083 when it resumes)
- Plan 018 (plugin composition contract) + sugarlang-internal ADR 010 provider boundaries -- the contribution contract is a new documented surface on the same one-way annotation bus; boundary tests extend to it
- Plan 075 (judge/regenerate provenance), Plan 072.8 (terminal drift-reminder slot precedent)
- Ground truth: all code claims verified against producing lines 2026-07-26; line numbers drift, grep the quoted identifiers

---

## Why now

Live latency bug, observed at B2 on 2026-07-26: every high-ratio agent turn costs FOUR model calls (generate, judge, regenerate, verify-repair) instead of two, because sugaragent's judge is constraint-blind. The judge prompt carries the persona digest -- including the `## Voice` section ("English manor lord") -- and scores the directed Spanish reply as an IN-CHARACTER violation (gateway core.ts:1020-1038, rubric 1). Regenerate then rewrites it, ALSO constraint-blind (RegenerateStage.ts:218-232 -- the regen prompt is persona-only, no overlay), re-emitting English; sugarlang's verify catches the ratio failure and burns a repair call putting the Spanish back. The two plugins fight each turn; verify wins only because it runs last.

The judge is one of SIX surfaces in the sugaragent lifecycle that produce, mutate, or judge NPC text with no way for a co-installed plugin to inform them (all verified):

1. JUDGE: the judge request carries replyText, personaDigest, responseIntent, worldContext, loreContextSummary, worldPremise (clients.ts JudgeRequest) -- no plugin directives. The rubric's IN-CHARACTER dimension scores language choice as character fidelity.
2. REGENERATE: `regenSystemPrompt` = "Speak as X" + personaDigest + "stay in character" (RegenerateStage.ts:218-223). Even a LEGITIMATE judge fail (real character violation) regenerates without the language constraint, so the repaired turn arrives in English and verify must repair it AGAIN. Fixing the judge alone does not close this path.
3. OUTPUT HYGIENE vs THE GESTURE CHANNEL: `normalizeNpcSpeech` strips every `*...*` span from generated text (helpers.ts:146, applied at GenerateStage.ts:486 and on regen output), and STAGE_DIRECTION_PATTERNS flags `*...*` as an audit violation (helpers.ts:15-19; AuditStage.ts:42; regen re-lint RegenerateStage.ts:249-252) -- an audit fail plays a canned fallback. Epic D's two-channel voice design ("*sweeps hat* Bonita vista, no?") is deleted by sugaragent's own hygiene before any verifier sees the text. 083.3's exit criteria are unshippable until this is contribution-aware.
4. INTERPRET: intent/socialMove classification is support-language keyword regexes only (interpretation.ts:13-45 -- greeting, gratitude, farewell, acknowledgement, smalltalk, question stems, all English). "adios" / "gracias" / "hola" route to nothing: the farewell-close flow, social routing, AND sugarlang's learner-evidence stream (strategy: interpret outputs are produced-* evidence) all collapse exactly when the player starts producing the target language -- the success condition breaks the machinery.
5. DETERMINISTIC FALLBACKS: buildFallbackReply / buildGenericOnlyReply / buildTransientUpstreamExitReply / buildTerminalFallbackReply (helpers.ts:172-255) are hardcoded English. Under a constraint they play as-is, and verify then fires a repair LLM call on a canned line -- wasted latency, and when the fallback fired because the gateway is DOWN, the repair call fails too.
6. LINT COLLISIONS: the meta-leak pattern `/\bai\b/i` (helpers.ts:12) matches the Italian preposition "ai"; judge lint short-circuit, audit, and regen re-lint all consume it. (Deferred here -- Italian pack is partial/hidden -- but named.)

The answer is ONE pattern, not six patches: a documented lifecycle contribution contract, generalizing the existing `generatorPromptOverlay` precedent (GenerateStage.ts:199-201, :401 -- one plugin, one stage, hardcoded key) into "any plugin, named surfaces, deterministic merge." A future plugin participates exactly the way sugarlang does, without sugaragent learning its name.

## Non-goals

- No callback/hook system. Contributions are DATA (strings, string lists, flags) read at fixed points sugaragent owns. Stages keep the "immutable service dependencies only" rule; control flow never crosses the bus.
- No judge rubric redesign beyond the directive guard. The three dimensions (IN-CHARACTER / WORLD-GROUNDED / SAFETY) stay; the guard only stops directed behavior from being scored as a violation.
- No localization of deterministic fallback / moderation-deflection lines. They are emergency text sugaragent must own without a lexicon; NAMED as an accepted English floor (see Deferred for the revisit trigger). The verify-side waste is fixed instead (084.6).
- No 083 content: voice-spec authoring, gesture-tag SYNTAX decision (the `*...*` overload named in 083 review round 1), reminder cadence policy -- all stay in epic D, which resumes on top of this epic.
- Nothing new in runtime-core: the annotation bus already carries arbitrary keys; the contract is sugaragent-owned convention + validation, not framework.
- No changes to sugarlang's verify/repair engine (083.2 shipped it; 084.6 only adds a skip).

## Design principles

- Zero contributions = byte-identical behavior. Every surface degrades to today's exact output when no contribution is present; the existing generate goldens prove it.
- One enforcer: contributions are collected and merged in ONE helper (collect + validate + sort by pluginId), never scattered per-stage ad hoc reads. Stages consume merged views.
- Data crosses the bus, never code. Structural typing on both sides (the local-interface pattern GenerateStage already uses for the constraint); unknown fields ignored (forward compat); schemaVersion field from day one.
- Turn budget: this epic ADDS zero model calls and REMOVES two from the common B2 path (regenerate + verify-repair stop firing on directed turns). Judge directives are prompt bytes, not calls.
- The contract is owner-documented: sugaragent's docs/api gets the contract page (it owns the lifecycle); consuming plugins document their contributions on their own pages.
- Consult code, not plans: line refs are anchors, not contracts; re-grep before building.

## Stories (EXECUTION ORDER)

### 084.1 The lifecycle contribution contract + generate-overlay migration

Define the contract and migrate the one existing participation onto it, proving the seam end to end before any new surface consumes it.

1. CONTRACT: contributions are written at prepare, one annotation per contributing plugin. Key shape decide-in-story with a lean to `sugaragent.contrib/<pluginId>` (greppable ownership, no read-modify-write between plugins) over a single shared record key. Shape (all fields optional): `{ schemaVersion: 1, generateOverlay?: string, generateReminder?: string, judgeDirectives?: string[], regenDirectives?: string[], textConventions?: { preserveActionTags?: boolean }, interpretLexicon?: Record<string, string[]> }`. Surfaces beyond generateOverlay are DEFINED here but consumed by later stories; the validator accepts them from day one so contributors do not version-skew.
2. COLLECTOR: one helper in sugaragent runtime (e.g. `runtime/contributions.ts`): scan `execution.annotations` for the prefix, structurally validate (drop malformed with a logged warning, never throw), sort by pluginId, expose merged views (overlay strings joined with blank lines; directive arrays concatenated; booleans OR'd; lexicon lists unioned). Merge order is deterministic and documented.
3. MIGRATE: sugarlang's teacher middleware writes the contribution beside the constraint (sugar-lang-teacher-middleware.ts:200, :402 -- the write point already runs at prepare per turn); GenerateStage consumes the merged overlay view instead of `constraint.generatorPromptOverlay` (GenerateStage.ts:199-201, :401); the constraint field and the read are then DELETED (bias toward deletion) -- verify in-story that no sugarlang-internal reader consumes `generatorPromptOverlay` off the constraint (the scripted middleware's constraint write at sugar-lang-scripted-middleware.ts:121 feeds sugarlang's own scripted path, not sugaragent -- confirm and leave untouched). `minimalGreetingMode` and `prePlacementOpeningLine` STAY on `sugarlang.constraint`: they are pair-specific flow control (routing, not text) and do not generalize; document the distinction on the contract page.
4. BOUNDARY: ADR 010-style tests both sides -- sugarlang emits only the documented shape; sugaragent ignores unknown fields and unknown plugins cleanly; grep-clean: no sugaragent import of sugarlang types, no sugarlang import of sugaragent types (unchanged).

- Exit: with contributions absent, the generate prompt is byte-identical to today (existing prompt-dump/golden pins); with the sugarlang contribution present, the overlay reaches the prompt via the merged view; two synthetic contributors merge in pluginId order (unit); boundary tests green.

### 084.2 Judge directive awareness (THE BUG FIX; gateway change)

The judge learns that directed behavior is never a violation.

1. CLIENT: JudgeStage collects merged `judgeDirectives` and passes them on the request -- `JudgeRequest` gains `externalDirectives: string[]` (clients.ts; JudgeStage.ts:131-138 call site). Absent/empty = today's request.
2. GATEWAY: the judge route (core.ts:1020-1038) splices, when directives are present, a block after the persona summary: "Established directives from game systems (in-world by definition; behavior they direct is NEVER a violation):" + numbered directives; rubric 1 (IN-CHARACTER) gains the guard sentence: "Behavior directed by an established directive above is never an IN-CHARACTER violation." Rebuild the compiled artifact (`pnpm --filter @sugarmagic/plugins build:gateway-source`; the freshness test enforces the commit).
3. SUGARLANG: the teacher middleware contributes one directive when a constraint is active, phrased from the constraint (languageDisplayName, ratio, posture) -- e.g. "This reply is language-directed for a language-learning player: about 85% Spanish mixed with English is intentional. Language choice and language mixing are never character violations." Exact per-posture phrasing decide-in-story.
4. UNCHANGED: the regex meta-leak lint short-circuit (JudgeStage.ts:88-108) precedes the LLM call and is directive-independent; the 3-strike governor resets naturally once the judge passes (provider.ts:433-437).

- Exit: unit -- JudgeStage passes directives through; gateway prompt test pins the block + guard (and pins byte-identical prompt when directives are empty); integration mock -- a directed-Spanish turn's judge request carries the directive. LIVE probe (the point): B2 Finnick turn arrives in Spanish, Judge diagnostics show passed:true, Regenerate passthrough, zero verify.repair events -- turn cost back to generate + judge.

### 084.3 Regenerate keeps the constraint

A legitimate judge fail must not launder the language constraint out of the turn.

1. RegenerateStage splices the merged `generateOverlay` + `regenDirectives` views into the regen prompt (RegenerateStage.ts:216-232) so a character-repair rewrite still honors the language directive. maxTokens (200, :240) revisit in-story -- a mixed-language rewrite of a long turn may need headroom.
2. The regen re-lint (:249-252) stays as-is in this story; 084.4 makes it convention-aware.

- Exit: mock judge-fail with an active constraint -- the regen request contains the overlay text (pin); regen output that honors the ratio passes verify with zero repair calls (integration); with no contributions the regen prompt is byte-identical to today.

### 084.4 textConventions: action tags survive output hygiene (UNBLOCKS 083.3)

The mechanism that lets a plugin declare `*...*` spans as preserved output.

1. `preserveActionTags: true` (merged OR across contributors) exempts asterisk spans in BOTH hygiene layers: `normalizeNpcSpeech` keeps `*...*` spans (helpers.ts:146) and `findStageDirectionViolations` drops the asterisk pattern (helpers.ts:15-19) -- at every consumer: AuditStage (:42), regen re-lint (RegenerateStage.ts:249-252). Bracket and parenthetical patterns stay untouched (only the asterisk channel is claimed; widening is 083.3's syntax decision).
2. Plumbing decide-in-story: thread a conventions argument to the helpers vs collect inside each stage (stages already hold `execution`); one enforcer principle applies -- the merged view must come from the 084.1 collector either way.
3. Fallback paths keep stripping (canned text carries no tags; no behavior change).
4. Sugarlang does NOT set the flag in this epic -- 083.3 sets it from the voice spec when epic D resumes. This story ships the mechanism, tested with a synthetic contribution, keeping H pedagogy-free.

- Exit: with the flag set (synthetic contributor), a generated "*sweeps hat*" survives normalize, passes audit, and survives regen re-lint to the returned envelope (integration); with the flag absent, stripping/flagging behavior is byte-identical to today (pins). A code comment at the asterisk pattern names 083.3 as the consumer.

### 084.5 interpretLexicon: target-language social routing

Interpret learns the surface forms the game is teaching, as data.

1. Contribution shape: `interpretLexicon: Record<category, string[]>` where categories are pinned to interpretation.ts's existing groups -- decide-in-story the exact list, anchored to what the classifiers actually branch on (farewell, greeting, gratitude, acknowledgement at minimum; smalltalk/clarify if the patterns support it cleanly). Unknown categories ignored.
2. Mechanism: merged surface forms compile to word-boundary matchers checked alongside the existing English patterns (same result categories, same downstream routing -- farewell still drives shouldCloseAfterReply). Accent handling decide-in-story ("adios" typed without the accent must match "adiós"-sourced forms; lean to NFD-strip on both sides).
3. Sugarlang contributes a curated Spanish starter set (aligned with the strategy's meta-language item zero: farewells, greetings, gratitude, acknowledgements). Curated list is the floor; atlas-derived generation is a ceiling, decide-in-story whether it earns its complexity now.
4. This ALSO protects the evidence stream: interpret outputs (socialMove etc.) are what sugarlang's observe path reads as produced-* learner evidence; epic F's grading assumes this signal exists for target-language production.

- Exit: with the contribution, "adios" routes to farewell and closes the conversation, "gracias" routes to gratitude (unit + integration through the provider); without contributions, classification is byte-identical to today (pins); a mixed utterance ("gracias, see you later") does not double-fire.

### 084.6 Verify-side coherence: no repair on deterministic turns (sugarlang, small)

Stop burning repair calls on canned text.

1. The verify middleware reads the turn's published `llmBackend` diagnostic (provider.ts:510 puts it on the envelope; deterministic = fallback/canned text). When deterministic: still run the classifier and emit the ratio-verdict telemetry (zero cost, keeps the metric honest), but SKIP repair and autoSimplify; emit a `verify.deterministic-bypass` event naming the reason. No new seam -- this reads sugaragent's published turn metadata, the allowed direction.
2. Fail-open: missing/unknown llmBackend = today's behavior (attempt repair).

- Exit: mock fallback turn (llmBackend deterministic) -- zero verify-stage LLM calls, bypass event emitted, ratio verdict still recorded; LLM-backed turn behavior unchanged (existing 083 pins stay green).

## Verification recipe (nikki)

WHICH LAYER NEEDS RESTARTING (read this first):
- Plugin-only changes (084.1, 084.3-084.6): restart the dev server (`pnpm dev`), hard-refresh Studio. No gateway redeploy.
- Gateway changes (084.2 ONLY): `pnpm --filter @sugarmagic/plugins build:gateway-source` must have been run and committed (the freshness test fails otherwise), THEN redeploy the local gateway: Studio -> Deploy -> select the local env (wordlarky-local) -> Deploy. Then restart dev server + hard refresh.

1. `pnpm test` green, `pnpm lint` clean; the zero-contribution byte-identical pins and both boundary tests exist and pass.
2. Latency probe (the bug): Studio -> preview -> Learner Override -> B2 -> talk to Finnick. Turn inspector: Judge passed:true on a mostly-Spanish reply, Regenerate passthrough, NO verify.repair event. Reply latency visibly down from the 4-call turns. Then force a real character break (e.g. ask Finnick about the developer) and confirm the judge still fails THAT -- the guard must not lobotomize the judge.
3. Regen retention probe: with a judge-fail turn (character break), the regenerated reply still arrives mostly in Spanish (constraint survived the rewrite).
4. Interpret probe: type "adios" -- the NPC says goodbye and the conversation closes; type "gracias" -- acknowledged, conversation stays open.
5. Deterministic-skip probe: kill the local gateway mid-conversation, send a turn; the canned fallback plays immediately with a verify.deterministic-bypass event and no hung repair attempt.
6. (Mechanism-only, synthetic) gesture probe: dev flag/test contribution with preserveActionTags -- a reply containing *waves* reaches the screen with the tag intact. Player-facing gesture rendering arrives with 083.3, not here.

## Epic wrap

docs/api: NEW sugaragent "lifecycle contributions" contract page (key shape, surfaces, merge semantics, the flow-control vs contribution distinction, how a future plugin adopts it); sugarlang middlewares page updated (teacher's contributions); telemetry page (verify.deterministic-bypass). Boundary tests extended. Strategy 002 epic H entry status updated. Plan 083 amendment prepared for resume: 083.3 consumes preserveActionTags; 083.5 reminder rides generateReminder. Backlog sweep of DEFERRED SEAM comments added here.

## Deferred / out of scope (with revisit triggers)

- Meta-leak lint vs target-language tokens (`/\bai\b/i` matches Italian "ai"; helpers.ts:12): revisit when the Italian pack ships or any target language collides with the lint list (code comment at META_LEAK_PATTERNS).
- Localized deterministic fallback / moderation-deflection lines: revisit at the first playtest report that English canned lines break immersion at target-dominant postures (code comment at buildFallbackReply).
- interpretLexicon beyond social moves (target-language question stems, quest patterns, explicit "que?" non-understanding moves): epic F's negotiation detection owns this; the category mechanism here is its seam (code comment at the category table).
- generateReminder consumption (the terminal drift-reminder splice beside the persona digest, prompt/builder.ts:249-252): surface is DEFINED in 084.1 but wired by 083.5 when epic D resumes -- this epic does not touch the builder's terminal slot.
- Plan-stage contributions (target-language reply placeholder text): revisit on playtest friction.
- A second real consuming plugin: the contract's true test; revisit at the next plugin that needs lifecycle participation (no speculative work now).
