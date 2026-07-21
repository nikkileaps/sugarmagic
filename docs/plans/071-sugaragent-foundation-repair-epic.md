# Plan 071 -- SugarAgent Foundation Repair (child epic A of Strategy 001)

Status: Locked (epic-review passed 2026-07-18, 2 rounds) -- stories execute as written in the stated EXECUTION ORDER; deviations need STOP + amendment + re-gate.
Owner: nikki + claude
Date: 2026-07-18

Related:
- Strategy 001 (docs/plans/strategy/001-agentified-npc-language-confluence-strategy.md) -- this is child epic A; epics B-F build on the trust this epic restores
- Plans 019 (turn lifecycle), 022 (lore wiki/gateway), 018 (plugin composition rules)
- Ground truth: 2026-07-18 foundational audit; every story below cites the producing lines it targets (line numbers drift; grep the quoted identifiers)

---

## Why now

We are re-entering sugaragent after ~3 weeks away to build the persona/memory/context epics (Strategy 001 B-F) on top of it. The audit found the foundation is sound but the SIGNAL is broken: the main pipeline integration suite is 8/10 deterministically red (not flaky -- red since the 46.14 proxy-mandatory guard), dead code misrepresents what runs, comments describe infrastructure that does not exist, and two real product bugs sit in the confluence seam (authored lines bypassing sugarlang; agent NPCs silently failing). Building epic B on top of red tests and phantom code paths guarantees we mistake breakage for progress. This epic makes the codebase tell the truth, then stops.

## Non-goals

No new capabilities. Persona cards, memory, world clock, judge audit, moderation, barks: epics B-F. If a story here grows a feature, it has escaped.

## Design principles

- Bias toward deletion (AGENTS.md): dead paths are removed, not commented, not flagged off. Git is the archive.
- One enforcer: the gateway becomes typecheckable source, not a string literal, so future gateway work (epic B's page-fetch route) is written under the compiler.
- Plugin contract boundary: sugaragent and sugarlang communicate ONLY via runtime-core contracts (annotations, contributions). The one existing cross-import dies here.
- Tests first: the suite goes green in story 1 so every subsequent deletion and behavior fix lands with a working alarm.
- No flakey tests: anything that cannot be made deterministic is deleted, not tolerated.

## Stories (EXECUTION ORDER)

### 071.1 Revive the pipeline integration suite

`packages/testing/src/sugaragent-runtime.test.ts`: 8/10 tests fail at boot with "SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL is not set" because TEST_ENVIRONMENT still carries pre-46.14 direct-API env vars. The Anthropic-529-retry test is additionally stale on its own terms: it mocks the old direct-API routes (`/v1/messages`, `/v1/embeddings`, vector-store search URLs) the client layer no longer calls (everything goes through gateway routes `/api/sugaragent/generate|retrieve/embed|retrieve/search`).
- Point TEST_ENVIRONMENT at a mock gateway (proxy base URL + route handlers), not at vendor APIs. House pattern: vi.stubGlobal fetch with throw-on-unknown-URL, as the two passing tests already do.
- Rework the retry test against the gateway route; keep the 529/retry-exhaustion semantics (GenerateStage backoff [700, 1400]ms, terminal fallback + request-close).
- Churn note: build the mock gateway's `/retrieve/embed` route clearly marked as scheduled for deletion -- 071.3 removes that route and re-touches these mocks; that second edit is expected, not scope creep.
- Exit: 10/10 green, deterministic, and the suite fails if a direct vendor URL is reintroduced on any code path the tests exercise (the throw-on-unknown-URL mock cannot see un-executed branches).

### 071.2 Dead-code sweep (sugaragent + contract fields)

Pure deletions, guarded by 071.1 and typecheck:
- `ScriptedPromptContext` + `buildScriptedPrompt` (prompt/context.ts, prompt/builder.ts): no caller ever constructs mode "scripted"; sugarlang's scripted middleware owns authored-line adaptation with its own prompt.
- Provider-state fields `topicCoverage`, `referents` (runtime/types.ts, provider.ts): initialized, never read or written.
- Unreachable intents: `mixed_knowledge` TurnIntent (never produced by interpretation.ts; unreachable branch in planning.ts) and the unreachable `mixed_query` QueryType path.
- Unused exports/members: `findRawEvidenceFormatViolations` (stages/helpers.ts), `logFallback` (unused interface method + implementation, runtime/logger.ts).
- `ConversationSelectionContext.learnerBandOverride` (runtime-core conversation contract): zero readers/writers.
- Sugarlang debug leftover: the hardcoded `queso` lemma probe in the context middleware's per-turn logging (fires only under sugarlang debugLogging, still a corpse).
- The commented-out "unsupported-specific-detail" noun-list audit heuristic (helpers.ts) -- delete the corpse; its in-code rationale ("acting like a fake world model") moves to the commit message. Real claim-vs-evidence auditing arrives with epic E's judge.
- Stale pre-46.14 browser env surface in the APP (review round 1 finding, same corpse family as the test file): `apps/studio/src/runtimeEnv.ts` still forwards `VITE_SUGARMAGIC_ANTHROPIC_API_KEY` / `VITE_SUGARMAGIC_OPENAI_API_KEY` / `VITE_SUGARMAGIC_OPENAI_VECTOR_STORE_ID` into the browser plugin environment -- an invitation to bake raw API keys into the client bundle. Delete surgically: `SUGARMAGIC_ANTHROPIC_MODEL` is still LIVE (sugarlang runtime-services reads it as its model default) and the two proxy/target-language vars stay. Also fix the Studio sugaragent workspace status line that renders "LLM configured/missing" off the browser-visible Anthropic key -- post-46.14 nothing browser-side terminates on vendor keys, so the line lies; key it off proxy configuration instead.

### 071.3 Remove the vestigial embeddings chain

RetrieveStage calls `embeddingsProvider.embedQuery` on every grounded turn; the resulting `semanticQueryFingerprint` never influences retrieval (the OpenAI vector-store `/search` endpoint embeds server-side from the raw text query -- verified against the official OpenAPI spec: `VectorStoreSearchRequest` accepts `query: string|string[]` only, `additionalProperties: false`, no embedding parameter). One paid API call per grounded turn, consumed by nothing. Delete the whole chain: the RetrieveStage call + fingerprint plumbing, `SugarAgentGatewayEmbeddingsClient`/`Provider`, the gateway `/api/sugaragent/retrieve/embed` handler, and the `openAiEmbeddingModel` config/settings/env surface (verified unconsumed elsewhere: the ingest path embeds via vector-store FILE UPLOAD, never `/v1/embeddings`). Caution: the settings-schema/gatewayRuntimeConfigKeys cross-validator is ONE-directional (runtime key without schema field errors; orphaned schema field is legal) -- it alarms only if the runtime key is deleted last, so do not lean on it: sweep all surfaces deliberately. Includes the second touch of the 071.1 mock-gateway embed route (planned churn, see 071.1). DEFERRED SEAM comment at the RetrieveStage site: revisit if we ever add client-side re-ranking or local embeddings (a Plan 019 extension point).

### 071.4 Placement provisioning moves behind the annotation seam

GenerateStage imports `loadPlacementQuestionnaire` from `../../../../sugarlang/...` (in-code TODO says exactly this). Invert: sugarlang's context middleware (which already runs the placement phase machine BEFORE the provider -- middleware prepare ordering verified in createConversationHost -- and already loads the questionnaire and computes `minAnswersForValid` in its questionnaire phase) provides the questionnaire PAYLOAD via an execution annotation, the same seam as `sugarlang.constraint`; sugaragent keeps minting the envelope itself (turnId, speaker fields stay stage-owned -- the annotation carries data, not a finished envelope). Also kill GenerateStage's structurally-duplicated `LanguageLearningConstraint` type: the annotation payload shape gets documented as an opaque, versioned payload -- a code comment at the runtime-core conversation contract's annotations field, plus the docs/api plugin page at epic wrap -- and sugaragent validates presence/shape minimally, never imports sugarlang types. Exit: zero import edges between plugin catalogs, enforced by a new `tooling/check-plugin-catalog-boundary.mjs` wired into `pnpm lint` (house pattern: same shape as check-mechanics-boundary.mjs; the existing package-level boundary check cannot see intra-`packages/plugins` catalog edges).

### 071.5 Fix the sugarlang bypass for non-interactive authored dialogue (PRODUCT BUG; fix shape RATIFIED review round 1)

Authored dialogues entered via `DialogueManager.start()` play in RAW ENGLISH: the selection carries no `interactionMode`, and sugarlang's `shouldRunSugarlangForExecution` gates on interactionMode ("agent" | "scripted"). There are THREE bypass call sites, not two: scripted followup after an agent conversation, quest-narrative nodes, and spell-cast dialogue effects (gameplay-session ~L1618/L1652/L1904) -- plus any future caller, which is why threading interactionMode through individual sites was rejected.

RATIFIED fix: sugarlang gates on what the turn IS, not how it was entered -- `conversationKind === "scripted-dialogue"` takes the scripted-adaptation path; `free-form` + npcDefinitionId takes the agent path (which exactly mirrors sugaragent's own `isAgentSelection`); interactionMode stops being a gate ANYWHERE. Adversarial probing confirmed the edge cases hold: non-NPC narration is protected by the non-adaptable-speaker skip in the scripted middleware; selections lacking targetLanguage fall back to plugin config; missing sceneId exits gracefully leaving no constraint (scripted middleware then no-ops); placement gating keys off `metadata.sugarlangRole`, not interactionMode.

Reader sweep (the bug reappears one layer down if any survive): `isScriptedMode` in sugarlang shared.ts (used by teacher/verify/observe/scripted middlewares) and sugaragent PlanStage's `interactionMode === "agent"` gate on start-scripted-followup all move to the conversationKind/npcDefinitionId basis. Decide whether `ConversationInteractionMode` itself survives on the selection (authoring still uses it to pick scripted-vs-agent NPCs; it just stops gating middleware).

Decide-in-story (review round 2): the non-adaptable-speaker skip covers narrator/VO/excerpt speakers but NOT authored player-spoken lines (plain player speaker), which therefore get LLM-adapted under "Speak as {speaker}". This is pre-existing behavior for interact-entered scripted dialogues, but quest narratives are likelier to carry player lines -- the integration test must pin the intended behavior (adapt player lines too, or skip them) either way.

Exit: (1) integration test -- a quest-narrative line and a scripted followup both render language-adapted for a mid-placement learner; (2) the same test asserts the authored-text fallback path when the adaptation LLM call fails (narrative beats become LLM-latency-visible for the first time; the fallback must keep them playable); (3) grep-clean -- no middleware or stage gates on `selection.interactionMode`.

### 071.6 Agent interactables stop lying

`interactable.available` is set true unconditionally for non-scripted NPCs, so with sugaragent ABSENT (plugin disabled/not installed) the player gets an interact prompt and the conversation silently fails to open (host resolves no provider, panel never shows).

Two failure modes, deliberately kept distinct (review round 1): MISCONFIGURATION (plugin enabled, proxy env var unset) already fails loudly at boot -- `createRuntimePlugin` throws, the app shows the failed-boot screen -- and STAYS that way; loud-fail serves this epic's "codebase tells the truth" goal, and 071.8 makes the error text honest. ABSENCE (plugin disabled) is the state this story fixes: gate availability on an actual capability check.

Mechanism (pinned): the provider set is fixed at session assembly and cannot change mid-session; `canHandle` may be async by contract but the refresh path is sync -- so compute agent-provider availability ONCE at assembly (restricting to sync canHandle or resolving at assembly time), and let the existing refresh cadence (quest-state change + boot) consume the precomputed answer. No awaiting inside the sync refresh.

Exit: plugin disabled -> no interact prompt on agent NPCs; plugin enabled -> unchanged behavior; misconfigured -> unchanged loud boot failure.

### 071.7 Action proposals: delete the two dead kinds (DECIDED 2026-07-18)

`surface-beat-evidence` is produced (PlanStage) and then dropped with a console.debug in gameplay-session. `propose-quest-hook` is deader still: it has ZERO producers -- it exists only in the ConversationActionProposal union and the defensive switch case at the drop site (corrected review round 1; the original claim that PlanStage produces both was wrong). Dynamic quest generation was an explicit Plan 019 non-goal, and beat contracts (019 story 9) never shipped authoring. Delete both proposal kinds from the union, the PlanStage producers, and the drop sites; keep the four live kinds (set-conversation-flag, notify-quest-event, request-close, start-scripted-followup). DEFERRED SEAM comment at the ConversationActionProposal union pointing at the Deferred entry below -- the someday-feature is specific and good, and whichever epic builds it re-adds a proposal kind end-to-end, consumer included.

### 071.8 Comments and logging tell the truth

- Kill every "Studio's vite middleware" reference -- eight lying sites across types.ts, provider.ts, index.ts (config comments AND boot error text), RetrieveStage.ts, GenerateStage.ts: there is no sugaragent vite middleware; dev routing is repo-root .env `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL` pointing at the sugardeploy-generated local gateway (docker compose).
- Second lie in the same boot error (review round 1): it claims `VITE_SUGARMAGIC_GATEWAY_URL` suffices in Studio, and a config comment claims proxyBaseUrl "auto-defaults to SUGARMAGIC_GATEWAY_URL" -- that fallback exists ONLY in published-web (targets/web buildConfig); Studio's runtimeEnv maps only the proxy var. Fix the text to the real remediation (this story does NOT add the Studio fallback -- that would be a feature; if we ever want it, it is a one-line runtimeEnv change to consider at epic B).
- Third comment family, same genre (review round 2): types.ts, clients.ts, and provider.ts all claim Studio bakes `VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN` into the bundle -- runtimeEnv maps no such var, so in Studio the static-token branch is always empty and silently falls through to the Supabase access-token getter. Correct the comments to describe the real token sources per context.
- `debugLogging` becomes real: the logger is currently constructed with `config.debugLogging || config.proxyBaseUrl.trim().length > 0`, and proxyBaseUrl is mandatory -- stage logging is always-on and the setting is a no-op. Gate stage logging AND the full system/user prompts currently embedded in every turn's diagnostics payload behind `debugLogging`.

### 071.9 Gateway leaves the template string

The entire production gateway (~1250 generated lines inside `deployment/index.ts`'s `buildGatewayServerFile`, its own TODO) becomes typecheckable source. Two constraints the design must respect (review round 1): (1) `planGameDeployment` runs in the BROWSER (Studio sugardeploy workspace) as well as node-side middleware, so the emission mechanism must be a Studio-build-time one (e.g. vite `?raw` import of the typecheckable source), not a deploy-time node build step; (2) the template has per-plan interpolations and a conditional auth-mode fork (supabase-jwt verifier emission, auth gate, targetId/containerPort splices), so the generator assembles the emitted file from typecheckable source FRAGMENTS rather than one monolithic module. Exit is BEHAVIOR-compatible, not byte-compatible: proven by the new handler unit tests -- auth modes (none/bearer/supabase-jwt), CORS matching, generate/search happy paths + error wrapping, lore ingest chunking (frontmatter id -> section slugs) -- plus recipe step 4's docker-compose smoke. NOT in scope: changing behavior, ingest-state durability, GitHub lore source (Strategy 001 watchlist). This story is last because it is the largest and everything before it shrinks the surface being extracted (071.3 deletes a route). It is also the prerequisite that lets epic B write its page-fetch route under the compiler.

## Verification recipe (nikki)

1. `pnpm test` -- everything green, including 10/10 in sugaragent-runtime.test.ts. `pnpm lint` -- catalog-boundary check passes.
2. Studio -> preview -> New Game: talk to an agent NPC (normal flow unchanged); trigger a quest-narrative dialogue and a post-agent scripted followup mid-placement -- both lines arrive language-adapted, not raw English.
3. Two separate failure-mode probes (they are different states -- review round 1):
   a. Temporarily unset `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL` (plugin still enabled): boot fails LOUDLY with error text naming the real remediation (the proxy env var; no vite-middleware or gateway-URL-fallback lies).
   b. Disable the sugaragent plugin (env var restored): game boots, agent NPCs show NO interact prompt, scripted NPCs unaffected.
4. Local gateway still serves generate + search after 071.9 (behavior-compatible artifact; docker compose up + one conversation + one lore ingest).

## Epic wrap

docs/api touch per house norm: the sugardeploy deployment page's gateway-emission description (071.9 changes it) and the plugin-contract page documenting the placement annotation payload (071.4). Backlog sweep of DEFERRED SEAM comments added by 071.3/071.7.

## Deferred (with revisit triggers)

- Client-side re-ranking / local embeddings: revisit if retrieval quality work in epic B wants a re-rank stage (code comment at the 071.3 deletion site).
- Dynamic quest hooks (deleted in 071.7; the someday-feature is specific): agentified/langified NPCs generate small SUB-QUESTS that exercise the vocab and concepts the player is currently learning -- the generator would be fed by sugarlang's lexical prescription (the budgeter's introduce/reinforce lists), so the errand naturally drills what is due. Shape note (2026-07-18): the NPC never invents quest STRUCTURE -- it fills slots in a small set of authored quest blueprints ("fetch item", "deliver a message / tell somebody something", "show me you can say X", etc.). The blueprint fixes the mechanical skeleton (objective kind, completion check, reward bounds, allowed target entities); the LLM only chooses which blueprint and fills the slots (which item, which NPC, which words) from grounded world state + the lexical prescription. Slot-fill validates against the domain (real item ids, real NPC ids, reachable areas) before the quest instantiates -- structured output into an authored template, so NPCs cannot do anything wackadoo. Revisit trigger: a design epic for NPC-initiated quests, most plausibly after Strategy 001 epics B (persona) + C (memory) exist, since a quest offer should flow from who the NPC is and what they remember. Code comment at the ConversationActionProposal union points here.
- Gateway ingest durability + GitHub lore source: Strategy 001 watchlist; revisit when ingest runs from CI or a second machine.
