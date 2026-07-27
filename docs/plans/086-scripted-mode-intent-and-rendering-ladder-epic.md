# Plan 086 -- Scripted-Mode Rework: Intent Model + Rendering Ladder (child epic C of Strategy 002)

Status: DRAFT (pre-drafted 2026-07-26 ahead of pickup; pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 -- child epic C ("Lines are intent; rendering is adaptive")
- Plan 083 (epic D) -- soft dep: this epic ADOPTS D's verifiers and prompt shapes where they exist (envelope + ratio shipped in 083.1; voice retention arrives with 083.4); the strategy pins that C's bake-time triple verification composes them
- Plan 087 (epic E) -- the directed-live-render TRIGGER arrives with E's outer loop; until then the baked floor plays
- Plan 084 (epic H) -- mostly N/A by design: the scripted path never enters sugaragent's provider (free-form only, provider.ts isAgentSelection); the one sugaragent touchpoint on scripted turns is the moderation finalize middleware (replaces flagged text, does not mutate otherwise) -- verified 2026-07-26
- Plan 018 install modes -- this epic is what makes "sugarlang alone, zero runtime LLM" TRUE instead of aspirational
- Ground truth: the runtime scripted LLM call verified live 2026-07-26 (sugar-lang-scripted-middleware.ts:151, header comment "Calls the LLM via the gateway to adapt the line"); everything else re-audit at pickup -- this doc was written ahead of time

---

## Why now

Scripted mode is not actually zero-LLM: every authored line is adapted per learner at RUNTIME via a gateway call (sugar-lang-scripted-middleware.ts:151). That means per-player cost and latency on every scripted line, output nobody can review before players see it, and a broken promise -- the Plan 018 contract says authored narrative is PLAYABLE with zero runtime LLM. Market evidence says trust in generated target-language accuracy is the number-one review killer for LLM-era titles; a finite, bake-time-verified, natively-auditable corpus is the direct answer, and pure runtime generation can never provide it.

The strategy's model: a scripted line's ground truth is its INTENT (must-convey facts, dramatic beat, voice), with the authored English as the canonical expression and fidelity anchor. One rendering principle, two intent sources (authored line / plan-stage goal); the TEACHER decides, the model RENDERS, the verifiers CHECK.

## Non-goals

- No general-purpose MT API: the job is level-constrained voice-preserving rendering, not faithful translation; everything routes through the existing gateway.
- No changes to agent-mode rendering (epic D territory) beyond adopting shared verifier functions.
- No live-render TRIGGER logic: "is this line the moment" is epic E's call; this epic ships the callable path with the trigger stubbed to off.
- No new authoring UI beyond the exception-review report: intent authoring rides the existing line format with added fields; a form editor is deferred.
- No bark system.

## Design principles

- The rendering ladder, floors first: deterministic weave (zero LLM) -> baked variants (bake-time LLM, triple-verified, shipped as assets) -> directed live render (runtime LLM, same verification, baked fallback). Each rung is independently shippable and the lower rung is always the fallback.
- Authored English is the fidelity anchor: every rendering verifies against it (must-convey facts present, meaning preserved); the exception-review report is readable WITHOUT speaking the target language (back-glosses, flags).
- Bias toward deletion: the unconditional runtime scripted call DIES in this epic; nothing keeps it alive behind a flag.
- Verifiers are pure functions on the classifier facade (the 083 contract: callable outside the middleware), composed at bake and at runtime identically.
- Turn budget: scripted common path = ZERO runtime model calls (weave or baked); directed live render is opportunity-priced, cached by (line, band, posture, teachables).

## Stories (EXECUTION ORDER)

### 086.1 Line-intent model + compile artifact

The intent contract per authored line: must-convey facts (including questEssentialLemmas-linked info), beat, voice note, with the authored English text as anchor. Compile pass derives a first-cut intent artifact from existing authored content (LLM-assisted at bake where fields are not authored, flagged for review -- the extractor precedent); hand-authored fields win. Content-hash cached.

- Exit: intent artifacts compile for a fixture region; authored-field override pins; cache round-trip + invalidation tests; docs/api page for the intent format.

### 086.2 Deterministic weave (anchored/supported postures; the zero-LLM floor)

Authored English verbatim as the frame; runtime substitution of the live prescription (introduce/reinforce lemmas AND chunks, correct surface forms from atlas morphology, glossing per strategy). Full per-learner adaptivity with zero LLM and zero translation risk. This replaces the runtime LLM call for anchored/supported postures immediately.

- Exit: weave unit tests (morphology-correct substitution, chunk insertion, glossing strategy respected, envelope-safe by construction pinned by classifier check); integration: an anchored-posture scripted line plays woven with zero gateway calls (fetch guard).

### 086.3 Bake-time variant generation + triple verification + exception report

Per-line variants for deep-end bands (target-dominant/target-only) generated at Studio bake, content-hash cached, shipped as assets. Triple verification at bake: envelope + ratio (083.1's pure functions), must-convey fidelity (against the intent artifact), voice retention (083.4's scorer when it lands; a fidelity-only gate until then -- pin the upgrade seam with a comment). Studio surfaces the exception-review report: flagged lines, English back-glosses, fidelity scores -- reviewable by a non-speaker, auditable by a native speaker later.

- Exit: bake produces variants for a fixture region with verification verdicts persisted; a deliberately-broken variant lands in the report, not in the shipped assets; cache-hit second bake generates nothing; report visible in Studio.

### 086.4 Runtime selection + the zero-LLM floor end to end

The scripted middleware selects: weave (anchored/supported) or baked variant (deep-end) by posture/band; missing variant degrades DOWN the ladder (weave, then authored English), never to a runtime LLM call. DELETE the unconditional runtime adaptation call (sugar-lang-scripted-middleware.ts:151 and its plumbing) -- the published-runtime path never generates.

- Exit: the runtime scripted path makes zero LLM calls in every posture (fetch-guard integration across bands); missing-variant degradation pinned; the deleted path is GONE (grep-clean), not flagged off; full authored quest playable offline in a fixture.

### 086.5 Directed live render path (the ceiling, callable but dormant)

The opportunity-triggered re-render: intent + teachable + scene through the SAME triple verification at runtime; on any verify failure the baked variant plays; cached by (line, band, posture, teachables). The trigger input is a stub (off) until epic E wires it -- this story proves the path with a forced trigger in tests only.

- Exit: forced-trigger integration renders live, verifies, caches (second call = cache hit), and falls back to baked on injected verify failure; with the trigger off, behavior is byte-identical to 086.4.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Zero-LLM probe: kill the local gateway entirely; play a scripted quest at A1 and at B2 -- every line plays (woven at A1, baked at B2), no hangs, no fallback English at B2 unless the variant is missing (then weave).
3. Trust probe: Studio bake on a fixture region -> open the exception report -- flagged lines readable with back-glosses; nothing flagged shipped.
4. Cost probe: second bake of an unchanged region generates nothing (bake log/telemetry).
5. Latency: scripted lines now display instantly (no per-line gateway round-trip).

## Epic wrap

docs/api: scripted-rendering page (ladder, intent format, verification, degradation order); Studio docs for the exception report. Strategy 002 epic C status. The 083-adoption seam comments (voice verifier) swept. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Voice-retention gate at bake: upgrades from fidelity-only when 083.4 ships (code comment at the bake verifier composition).
- Live-render trigger policy: epic E (code comment at the stub).
- Intent authoring form editor in Studio: revisit at first authoring-friction complaint; floor is fields on the line format.
- Native-speaker review workflow (assignment, sign-off states): revisit when a native reviewer actually exists; floor is the readable report.
- Baked-variant regeneration on lexicon/prescription drift (variants are keyed to bands, not per-learner): revisit if telemetry shows band-level variants failing fresh envelope checks after lexicon updates.
