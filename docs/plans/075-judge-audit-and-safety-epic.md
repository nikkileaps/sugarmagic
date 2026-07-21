# Plan 075 -- Judge Audit + Safety (child epic E of Strategy 001)

Status: Locked (epic-review passed 2026-07-19, 3 rounds) -- stories execute as written in the stated EXECUTION ORDER; deviations need STOP + amendment + re-gate.
Owner: nikki + claude
Date: 2026-07-19

Related:
- Strategy 001 -- child epic E. Depends on Plan 072 (the judge judges against the persona card; without it there is no character-fidelity ground truth).
- Plan 071 (gateway typecheckable, tests green) transitively required.
- Ground truth: 2026-07-18 audit. AuditStage is a deterministic regex lint (meta-leak word list, stage-direction patterns, spatial-deixis checks, length caps) -- NOT a factuality or character check; its one semantic heuristic is commented out with the note that a hardcoded noun list "was acting like a fake world model" (071.2 deletes the corpse). RepairStage DISCARDS failed text and substitutes a canned fallback -- no regeneration exists. There is NO moderation of player input or NPC output anywhere. Envelope-override turns (sugarlang placement) bypass Audit/Repair entirely.

---

## Why now

Two independent findings from the Strategy 001 sweep converge here. Research: generate-judge-retry with a cheap LLM judge and bounded regeneration is the validated pipeline shape for role-play quality -- and LLM judges are regression tests, not ground truth, so they need rubrics and calibration, which the persona card (072) finally provides. Industry: player-facing NPC chat WILL be jailbroken on day one (Fortnite's Vader: hours), and the survivable posture is layered, hotfixable, server-side. We ship a sandbox to real players after this strategy; zero safety layers is not a posture, and a regex lint cannot notice an NPC cheerfully inventing a nonexistent quest or sliding out of character.

## Non-goals

Age-gating/accounts (sugarprofile's domain; hooks only). Voice moderation (no voice yet). Model fine-tuning for refusals. Sugarlang's language-level verification (its verify middleware already does CEFR enforcement; the judge does not duplicate it). Solving prompt injection (NPCs have no tools; blast radius is bounded by design -- we harden and monitor, not "solve").

## Design decisions (epic-review ratifies)

- D1 -- The judge is a second, cheap LLM call with a structured rubric, judging the GENERATED text against the persona card + evidence + world block: (a) in-character (voice/temperament match the card), (b) world-grounded (no invented institutions/facts beyond evidence + core knowledge), (c) no meta/out-of-world leakage, (d) no secrets-shaped content (defense in depth behind the 072 structural exclusion). Verdict is structured (pass / violations list / one-line repair hint). The existing regex lint SURVIVES as the fast pre-filter (it is nearly free and catches formatting violations the judge should not spend tokens on).
- D2 -- Bounded regeneration replaces discard-Repair: on judge FAILURE VERDICT, ONE regeneration with the violations + repair hint appended to the generation prompt (a new feedback field on the Generate stage input -- no seam exists today); the regenerated text is re-linted (regex only, no second judge -- cost/latency cap); if still failing, TODAY's deterministic fallback (which 071 preserved) is the terminal state. Cost cap counted in STAGE INVOCATIONS: worst case 2 generate invocations + 1 judge invocation (each generate invocation internally retries retryable errors up to 2x with backoff, so the upstream-request ceiling is higher -- the cap the tests assert is invocations). Judge ERROR (route/vendor unavailable) is distinct from judge failure: FAIL-OPEN -- the generated text passes through, loudly logged, with a diagnostics status the stall governor IGNORES (a judge outage must not 3-strike-close every conversation, and no regeneration is burned on it). Known harmless waste: the 3-strike terminal fallback replaces text after the judge ran that turn.
- D3 -- Judge economics: small-fast model, explicit model id (not the dialogue default), skipped entirely on paths that produced NO free-form LLM text (deterministic fallbacks, generic-only canned replies, envelope overrides -- the placement bypass stays, now as a documented decision: sugarlang-authored envelopes are sugarlang's responsibility). Judge latency hides behind the existing typing-indicator UX; the latency budget is measured in-story and recorded.
- D4 -- Moderation is a gateway concern, two checkpoints: player input BEFORE the pipeline (one gateway round trip before Interpret; a flagged input never reaches generation; the NPC responds with an in-character deflection), and final player-visible OUTPUT -- implemented as a finalize-stage conversation middleware ordered AFTER sugarlang's verify middleware (review round 1: verify REWRITES turn text at host finalize via its own LLM repair/simplify, so a pipeline-internal output check is not the last word; the moderation middleware moderates whatever text actually reaches the player, from any provider). Provider chosen in-story; null-cost default identified: OpenAI's moderation endpoint is free, multilingual, and uses the SAME key the gateway already holds for vector search -- zero new secret plumbing. The gateway route wraps it (browser never talks to the vendor; provider swappable; vendor base URL env-overridable so outage behavior is testable). Fail-OPEN on moderation-service errors at BOTH checkpoints -- consciously including input: during an outage unmoderated input reaches generation rather than muting the game -- logged loudly.
- D5 -- The hotfixable layer lives server-side in the gateway: a topic blocklist applied to player input, with an in-character refusal line. Mechanism pinned (review round 1 -- Cloud Run revisions are IMMUTABLE; there is no editable config file on a deployed service): the blocklist is an env-var-carried config riding the existing gatewayRuntimeConfigKeys plumbing, updated via a SUGARDEPLOY-OWNED lightweight action that issues an env-only service update (new revision, NO image rebuild, NO client build -- sugarmagic orchestrates, nothing hand-run). The Vader lesson satisfied: patch path is minutes and never touches the client bundle. Boundary honesty (both D4/D5): these checkpoints are gateway-hosted but client-invoked -- an authed player could curl /generate directly and bypass them; the typed-into-the-UI threat model is what they cover. Cheap true-server-side layer included: the blocklist is ALSO applied inside the /generate handler against the user prompt (defense in depth). Rate limiting stays deferred.
- D6 -- Every safety event (judge fail, regen, moderation flag, blocklist hit) lands in turn diagnostics AND a server-side log line with counts -- the observability that turns day-one jailbreak attempts into a fixable list instead of a surprise.

## Stories (EXECUTION ORDER)

### 075.1 Judge stage + judge route (owns the structured-output contract)

New JudgeStage between Generate and (new) Regenerate, per D1/D3: rubric prompt built from persona card + evidence + world block + generated text; regex lint runs first and short-circuits; skip key is mechanical: `generate.usedLlm === false` covers the no-free-form-text paths (envelope overrides, generic-only, llm-not-configured/unavailable/retry-exhausted) WITH one known edge fixed in this story (review round 2): the empty-normalized-generation catch substitutes deterministic fallback text but never resets `llmBackend`, so `usedLlm` reads true on canned text -- reset it in the catch (or additionally key the skip on a null fallbackReason) so the judge never burns a call on fallback text. The judge route's vendor base URL is env-overridable (mirroring the moderation route) so outage behavior is testable.

The verdict travels through a DEDICATED gateway route `/api/sugaragent/judge` (review round 1: a browser-side verdict via the generic generate route can never land in server logs, which D6 requires; the judge route maps the structured verdict AND logs it via the gateway's logInfo mold -- Cloud-Run-queryable). Wire mechanics verified: Anthropic structured outputs (`output_config` json_schema) are GA on raw /v1/messages -- no SDK, no beta header; small-fast model with an explicit id. THIS STORY OWNS the gateway structured-output contract; 073.2's summarizer converges on it (cross-epic note: 073 must not independently invent one).

Judge-ERROR behavior per amended D2: fail-open, loudly logged, stall-governor-invisible. Exit: unit tests with mock gateway (pass, each rubric dimension failing, judge-error fail-open, every skip path); latency recorded in diagnostics.

### 075.2 Bounded regeneration

RepairStage becomes RegenerateStage per D2. The stall governor (3-strike) semantics from 071 are preserved on top. Exit: unit tests (regen improves and passes; regen fails -> deterministic fallback; cost cap asserted: never more than 2 generates + 1 judge per turn).

### 075.3 Moderation checkpoints

Gateway moderation route (provider per D4; vendor base URL env-overridable, e.g. SUGARMAGIC_MODERATION_BASE_URL, so outage behavior is testable) + the two checkpoints per amended D4: input before Interpret (one added gateway round trip); output as a finalize-stage conversation middleware CONTRIBUTED BY SUGARAGENT (it already holds the gateway proxy config), ordered AFTER sugarlang.verify (moderates the text the player actually sees, from any provider). Accepted consequence, stated: with sugaragent disabled, no output moderation runs for other providers -- fine, since scripted/sugarlang text is authored or constraint-bounded. In-character deflection templates for flagged input (deterministic, per-intent). Fail-open with loud logging at both checkpoints. Exit: gateway unit tests (flag, pass, provider-error fail-open); pipeline integration test for both checkpoints INCLUDING the case where sugarlang's verify rewrote the text after the provider returned; TOTAL added per-turn latency (input round trip + judge + output check) measured and recorded -- the typing indicator must cover the measured worst case.

### 075.4 Hotfixable blocklist

Gateway-side blocklist per amended D5: env-var-carried config riding gatewayRuntimeConfigKeys (sweep the settings schema deliberately; one-directional cross-validator caveat applies), applied to player input pre-moderation (cheapest first) AND inside the /generate handler (defense in depth -- with the tradeoff stated: the handler sees only the COMPOSED prompt, so a blocklisted term appearing legitimately in world evidence can false-positive into a refusal; acceptable for the curl-direct threat it targets, and the route contract may add an optional playerText field if it bites), in-character refusal. Update path: a sugardeploy-owned env-only service update action (new revision, no image rebuild, no client build) -- built in this story, scoped to env updates only. Exit: gateway unit test for both application points; docker smoke proves a blocklist update takes effect without touching the client bundle; the sugardeploy action demonstrated end to end locally.

### 075.5 Safety observability

D6 wiring: diagnostics fields + server-side structured log lines + counters (judge-fail rate, regen rate, moderation flags, blocklist hits) queryable from Cloud Run logs -- judge events log server-side via the 075.1 judge route; moderation/blocklist events log at their gateway handlers. Exit: counts visible in local gateway logs during the red-team story.

### 075.6 Red-team suite

A canned adversarial suite (scripted attempts: jailbreak phrasings, out-of-world extraction, secrets probing per 072's `## Secrets`, meta questions, injection-shaped input) runnable against the mock gateway in CI (deterministic assertions on the pipeline's handling: flagged/refused/deflected paths) and against the real gateway as a manual smoke script (results table, human-read). This is the epic's falsifiable core. Exit: CI suite green; manual run documented in the wrap notes with the found-and-fixed list.

## Verification recipe (nikki)

1. `pnpm test` green (incl. the red-team CI suite).
2. Preview: normal conversations feel unchanged (latency within the measured budget; typing indicator covers the judge).
3. Try to break an NPC yourself: ask about the developer/AI/prompts (meta), assert false world facts and ask them to confirm, probe for a `## Secrets` item, type something the blocklist covers. Each lands as an in-character deflection/refusal, and the diagnostics show which layer caught it.
4. Update the local gateway's blocklist config and see the new rule take effect without rebuilding the client.
5. Force the moderation route to error (point SUGARMAGIC_MODERATION_BASE_URL at a dead port in local config): NPCs still talk (fail-open), the log line screams. Same probe for the judge route: conversations continue, no 3-strike close.

## Epic wrap

docs/api: judge verdict contract, moderation route, blocklist config, safety diagnostics fields. Red-team results table. Backlog sweep.

## Deferred (with revisit triggers)

- Judge calibration against human labels (the research warning: LLM judges misjudge role-play): revisit after real-player transcripts exist to label; the rubric + diagnostics are the seam.
- Rate limiting / per-user abuse quotas: revisit at public-sandbox launch planning (sugarprofile + gateway seam).
- Age-appropriate content tiers: revisit when the audience decision is made (moderation thresholds are the seam).
- Injection-hardening beyond monitoring: revisit if NPCs ever gain tools/actions with real blast radius (the quest-blueprint someday-feature in 071's deferred notes is exactly that trigger).
