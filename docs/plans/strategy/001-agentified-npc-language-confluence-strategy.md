# Strategy 001 -- Agentified NPCs + the Language Confluence

Status: Draft (strategy tier -- direction, not buildable spec; each child epic gets its own numbered plan doc in docs/plans and passes epic-review individually)
Owner: nikki + claude
Date: 2026-07-18

Related:
- Plans 018/019/022 (sugaragent), 023/024/025 (world context), 013 (dialogue graph), sugarlang plugin (no single epic; grew across 018+)
- Ground-truth audit: 2026-07-18 foundational analysis (6-agent sweep; load-bearing claims verified against producing lines)

Tier note (the poor man's Jira): strategy docs live in docs/plans/strategy/ with their own numbering from 001. Child epics live in docs/plans/ on the existing global numbering and format. Stories live inside epics; tasks are ephemeral (session task tracker). Ladder: strategy > epic > story > task.

---

## North star

An immersive, adaptive language-learning RPG that can teach a language from zero by immersing the player in a story. Two content modes converge:

- Authored narrative (nikki-written), always playable with zero LLM.
- Agentified NPCs: lore-grounded characters the player can freely talk to, who take into account everything the game knows -- in-game time of day, quest state, what is known about the player, the NPC's lore and schedule, events that have happened -- while secretly teaching the target language.

The fine line is keeping NPCs entertaining WITH personality yet constrained to the world and its lore. That line is sugaragent's job. Sugarlang rides on top for the teaching. Sugarlang must always work without sugaragent (authored mode); sugaragent must remain a generic dynamic-NPC plugin installable in ANY sugarmagic game -- the language game leans in via sugarlang, never by specializing sugaragent.

## Where we are (verified 2026-07-18)

- The 6-stage pipeline (Interpret -> Retrieve -> Plan -> Generate -> Audit -> Repair) is real, production-wired, gateway-only (keys server-side), with Supabase-JWT/bearer auth and a 3-strike stall governor. Work stopped 2026-06-24 mid-deployment-hardening (46.15), not mid-feature.
- Lore ingest (Plan 022) IS implemented inside the sugardeploy-generated gateway (frontmatter id -> section chunks -> OpenAI vector store) with a Studio UI. Caveats: the gateway is an untypechecked template string, ingest state is in-memory, GitHub lore source is stubbed.
- Sugarlang's teaching loop is essentially complete and matches the research-validated shape: FSRS learner model, lexical budgeter, teacher policy, CEFR envelope classifier with verify/repair, placement flow, hover/utterance observations. (Research: explicit vocab constraint + verify + retry is the ONLY thing that holds level for A1/A2; prompt-only "speak simply" provably fails.)
- Structural gaps: persona reaching the model is literally "Speak as {npcDisplayName}" + one plugin-wide tone string + at most 3x180 chars of retrieved evidence; zero cross-session (even cross-conversation) memory; no clock/time-of-day concept anywhere in the engine; no player-known-facts; Audit is a regex linter and Repair discards rather than repairs; no moderation layer.
- Known bugs: quest-narrative dialogues + scripted followups bypass ALL sugarlang middlewares (play raw English); agent NPC interactables silently fail when no provider; 8/10 pipeline integration tests deterministically red since the proxy-mandatory refactor; sugaragent imports sugarlang's placement loader (seam violation, in-code TODO); propose-quest-hook / surface-beat-evidence proposals dropped on the floor; vestigial embeddings call every grounded turn.

State of the art (industry + research, mid-2026): our architecture IS the converged pattern (writer-authored persona + engine-state-as-truth + staged generate/judge + two-tier memory + layered hotfixable safety). No turnkey replacement exists -- Inworld pivoted to voice infra, Convai serves sims, Epic's stack is UEFN-only, the graph-to-LLM handoff is bespoke everywhere. Build the brain, buy voice/assessment later.

## Settled architecture

### NPC Knowledge Model (one source of truth, two access paths, three layers)

Everything character-defining lives in the lore wiki, on the NPC's lore page, referenced by NpcDefinition.lorePageId. No persona is authored anywhere else (completes Plan 022's removal of inline fields).

| Layer | Content | How it leaves the wiki | Where it lands |
|---|---|---|---|
| 1. Persona card | Who I am: voice, mannerisms, temperament, relationships (designated sections, e.g. `## Persona`, `## Voice`) | Whole-section fetch by page id, once, at conversation start | System prompt (cached) |
| 2. Core knowledge | What I always know: my work, home, routine, immediate world (rest of my own lore page) | Same fetch, same moment | System prompt (cached) |
| 3. World lore | Everything else in the wiki -- the whole rich world | Vector search, per turn, scored against the conversation | User message, as evidence |

Rules:
- What an NPC must ALWAYS know loads deterministically and completely; what an NPC MIGHT need retrieves probabilistically. Persona is never searched, ranked, or truncated. World lore is never bulk-loaded.
- The vector DB stays. The wiki will outgrow any context window; it is the wiki for a whole world.
- Prompt shape: system prompt (engine rules + layers 1-2) is byte-stable per NPC -> prompt-caches; user message (directives + player text + layer-3 evidence + history) varies per turn, uncached by design. Vector DB and caching never fight -- different halves of the prompt.
- Secrets invariant: anything the NPC must not reveal never enters the prompt at all -- withheld at load/retrieval (later: quest-stage scoped). Prompt-level "don't tell" is reliably jailbroken.
- Authoring cost: one wiki page per character feeds all three layers; ingest already splits pages into sections with slugs.

### Quest + narrative context (director-mediated)

Quest state is world truth, but an NPC must not be a walking quest log. FIREWALL: the player's objective NEVER enters an NPC's prompt -- Finnick must not know a priori that Mim is looking for a suitcase (prompt-level "act like you don't know" is unreliable, the same failure mode as the secrets invariant). Instead a NARRATIVE DIRECTOR reads quest + world + time state and emits a per-turn, in-character NUDGE -- "point them toward baggage claim, once, and again if they return; don't reveal why" -- which the NPC delivers in its own voice. This is the MIRROR of sugarlang's teacher-director: same shared state, one directive each (narrative beat vs teaching plan), the generator obeys both. It stays a generic sugaragent concern (directs any NPC in any game); sugarlang leans in through its own teacher-director, never by specializing this. Built in epic G; the naive "objectives into the prompt" that epic D first sketched is superseded by it.

### Plugin boundary

- sugaragent: generic agentified-NPC conversation for any sugarmagic game. Consumes sugarlang's constraint as an opaque overlay annotation, never imports from it.
- sugarlang: everything language-learning -- constraint, verification, learner model, placement, glossing, hover pronunciation, lexicon audio.
- Both share the one gateway; the /generate route stays a generic model proxy.

### Voice: ease in, barks first

No live TTS on the hot path. First step is the bark pattern: short pre-recorded / batch-pre-generated audio flourishes (a canned line, a laugh, a hmph) played alongside the text box to give personality and emotion. Selector signal already exists free on every turn: Plan's responseIntent (greet/chat/answer/clarify/goodbye) + Interpret's socialMove. Per-NPC bark banks; degrades to silent text with nothing broken. Full character TTS, learner STT, and pronunciation assessment are watchlist items, adopted deliberately later.

Hover pronunciation of target-language words (with highlight and glossing) is sugarlang's concern: batch-generate word audio at scene-lexicon compile time (content-hash cached, 50%-off batch APIs), play local assets on hover.

## Child epics

Numbers assigned from the docs/plans global sequence when each is drafted. Each passes epic-review before build.

### A. Foundation repair (first, small)
Restore trust in the signal before building. Fix the 8 red pipeline integration tests; fix the scripted-followup / quest-narrative sugarlang bypass (raw-English bug); fix silent-fail agent interactables; move placement-questionnaire provisioning to sugarlang (annotation seam, kill the cross-plugin import); delete dead code (ScriptedPromptContext path, topicCoverage/referents, unreachable intents, unused exports, queso probe); remove the vestigial per-turn embeddings call; decide wire-or-delete for propose-quest-hook / surface-beat-evidence; correct stale "vite middleware" comments + debugLogging quirk; extract the gateway template string into a typecheckable module.
Depends on: nothing.

### B. Persona + knowledge architecture (highest leverage)
Implement the NPC Knowledge Model: gateway route serving a page (or designated sections) by page_id; session-start persona/core load; authoring convention for persona sections; prompt restructure with explicit cache breakpoints (shared game prefix + per-NPC block); per-NPC voice/tone replacing the plugin-wide tone string; persona re-injection near context end (drift sets in ~8 turns); raise the evidence budget (kill 3x180); refresh gateway model defaults (small-fast tier workhorse, big-model override per NPC).
Depends on: A.

### C. NPC memory
Two-tier memory: durable per-NPC relationship memory in a plugin-owned store keyed on userId (the slot the save contract reserves), written by post-conversation summarization; in-playthrough continuity so a second conversation the same session is not blank. "Have we met?" (the session_recall intent that already exists) gets an honest answer. Memory summaries feed the cached prefix. No raw wall-clock in persisted state.
Depends on: B.

### D. World clock + context completion
Beat-driven time-of-day (amended 2026-07-22 -- NOT an ambient clock: a blackboard fact the narrative SETS at story beats, so schedules become felt in dialogue without a time-management sim); player-known-facts store; a PUBLIC world-events feed; wire-or-delete ENTITY_AFFECT. (The "activeQuestObjectives into the prompt" idea moved to G once we saw it would make NPCs omniscient about the player's private quest.)
Depends on: independent of B/C; feeds both, and shares its quest/world/time seam with G.

### E. Judge audit + safety
Replace regex-lint Audit + discard-Repair with a cheap LLM judge (character fidelity / world consistency / quality rubric) and ONE bounded regeneration, latency-masked by the typing indicator; moderation on player input and NPC output (free multilingual moderation API); hotfixable server-side blocklist in the gateway (day-one jailbreak is guaranteed -- see Fortnite Vader); enforce the secrets invariant.
Depends on: B (judges against the persona card).

### F. Expressive presentation + lexicon audio
Bark system: per-NPC banks selected by responseIntent/socialMove, generic sugaragent/game feature, silent fallback. Sugarlang: hover pronunciation via batch audio generation at lexicon compile.
Depends on: B for bark tags; sugarlang half independent.

### G. Narrative Director (added 2026-07-22)
The layer that makes NPCs serve the story WITHOUT breaking immersion -- the heart of "an NPC feels like it's actually part of this world and this quest." Realizes the director-mediated quest-context principle above. Three pillars: (1) the narrative-director contract + per-turn in-character NUDGE (never the raw objective -- the firewall); (2) per-NPC, per-quest-stage awareness AUTHORING -- what each NPC knows and hints, in its own voice, gated on stage, repeated on return, retired at the checkpoint (all NPCs converge on the same goal, each in character); (3) quest-gated world events -- progression flips flags that spawn NPCs / enable dialogue / change presence (the sentient sock-eating suitcase; the passenger upset about missing socks who appears only AFTER arrival AND after the player has talked to NPC-1), composing existing gates (quest stages, region-conditions, presence, D's public recent-events) plus richer trigger authoring (stage X AND conversation Y). It is also what SETS beat-driven time (D's set-time action is one of its beats). Generic sugaragent concern; sugarlang rides on top via its teacher-director.
Depends on: B (the persona prompt the beat composes with), D (shared quest/world/time seam; co-designed), the quest system (exists). Composes with C (memory-aware beats -- "you mentioned baggage claim last time") and E (the judge can score whether the NPC delivered the beat in character).

## Sequencing

A -> B -> {C, E} with D in parallel any time; F last (or its sugarlang half whenever). B is the hinge: C, E, F, G all lean on the persona card and prompt structure. G (Narrative Director) follows D and is best co-designed with it -- they share the quest/world/time seam and G absorbs D's quest-objectives scope. Status 2026-07-22: A, B, C shipped; D amended to beat-driven time (re-gate pending); G is the next major design. Practically, D + G are one design conversation now: settle G's director contract first, then re-gate D against it so the seam is gated once.

## Deferred / watchlist (not in any child epic)

- GitHub-backed lore source (gateway stub stays; local checkout is fine solo)
- Ingest state durability + concurrency lock (matters when ingests run from CI or two Studios)
- Streaming responses (UX polish; revisit with voice)
- Full character TTS, learner STT, pronunciation assessment (two-lane: robust STT for comprehension, scripted-moment-only scoring)
- Realtime speech-to-speech ("live conversation lesson" premium mode someday)
- On-device / in-browser SLMs (not good enough for multilingual character dialogue; competes with our renderer for GPU)
- Memory-as-a-service, managed RAG vendors (Postgres + summarization wins at our scale)
- Sugarlang telemetry production sink (BigQuery TODO stands)
