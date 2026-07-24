# Plan 078 -- Retrieval Relevance + Knowledge-Injection Quality

Status: Draft (proposal -- pre epic-review; small epic). Each design decision below is a claim for the epic-review gate to verify against the terminal producing line.
Owner: nikki + claude
Date: 2026-07-24

Related:
- Backlog #400 (this epic's origin).
- Plan 072 (Persona + Knowledge Architecture) -- the deferred note that spawned this: "retrieval has no relevance floor (returns top-K regardless of similarity), which lets weak queries surface loosely-related chunks. Deliberately NOT patched here; promoted to its own backlog epic" (072 Epic wrap, "Followed-on / out of scope").
- Plan 075 (Judge, Regen, Safety) -- the WORLD-GROUNDED judge check reads `loreContextSummary`; cleaner injection is expected to lower its false-fail rate (and therefore regen frequency + latency).
- Strategy 001 -- complete; this is standalone post-strategy quality work, not a child epic.

---

## Why now

The retrieval pipeline injects the top-K lore chunks into every grounded turn regardless of how weakly they match the query. OpenAI's vector search already returns a normalized relevance score per chunk, but the runtime throws it away and injects whatever comes back. On a query where nothing in the wiki is truly relevant, the NPC still receives K loosely-related chunks labelled "Evidence" -- which (a) can push the model to reference world details that do not apply (a WORLD-GROUNDED judge failure -> a regen -> added latency), (b) wastes prompt budget, and (c) dilutes genuinely-strong chunks when a result set mixes one good hit with three weak ones.

This is cheap to fix and compounds with 075: fewer noisy injections -> fewer WORLD-GROUNDED false-fails -> less regen -> lower per-turn latency. Zero new API calls -- the score is already on the wire.

## Non-goals

- No new retrieval API calls, no re-ranking model, no local embeddings (the 071.3 deferred `EmbeddingsProvider` seam stays deferred).
- No change to ingest, chunking, or the vector index contents (that is backlog #419, incremental lore ingest -- separate).
- No dynamic per-turn K sizing beyond the existing `maxLoreResults` cap; the floor removes noise, the cap bounds volume, and they compose.
- No change to the persona-card load path (072.3) -- this epic touches only probabilistic retrieval (layer 3), never the deterministic persona load (layers 1-2).

## Current behavior (ground truth, verify at the gate)

- `RetrieveStage.execute` (`packages/plugins/src/catalog/sugaragent/runtime/stages/RetrieveStage.ts`) calls `vectorStoreProvider.searchLore({ maxResults: config.maxLoreResults, filters })`. It targets/broadens/pins purely by `page_id` (`retrievalFilters`, `broadenedBeyondLorePage`, `shouldPinNpcLore`). It NEVER reads `item.score` on real results -- the only place a score is set is the synthetic runtime-location evidence (`score: 1`, `RetrieveStage.ts:99`).
- The gateway forwards OpenAI's real per-chunk score: `score: typeof result?.["score"] === "number" ? result["score"] : 0` (`packages/plugins/src/deployment/gateway/core.ts:1256`). The search body is built at `core.ts:1240-1246` (`query`, `max_num_results`, opaque `filters`) -- no `ranking_options` today.
- `RetrievedEvidenceItem.score: number` exists on the type (`packages/plugins/src/catalog/sugaragent/runtime/types.ts:309`).
- `loreContext` is consumed at three sites: `GenerateStage.ts:246` (-> `summarizeEvidence` -> the "Evidence:" prompt block at `generate/prompt/builder.ts:239-240`), `PlanStage.ts:71` (`hasEvidence = loreContext.length > 0`) and `PlanStage.ts:138` (`claims`). The generate path's `loreContextSummary` is also handed to the Judge (`JudgeRequest.loreContextSummary`, `clients.ts:283`).
- Config: `maxLoreResults` default 4 (clamped 1..8, `index.ts:490` / `clients.ts:140-143`), `maxLoreCharsPerItem` default 600. Both are Studio-settable plugin config today; the floor should join them.
- OpenAI docs (verified 2026-07-24, developers.openai.com/api/docs/guides/retrieval): vector-store search `score` is normalized `0.0-1.0`; a server-side `ranking_options.score_threshold` (0.0-1.0) is also supported. Hybrid ranking (semantic + keyword via RRF); exact default-ranker math undisclosed. The absolute score scale is therefore corpus/ranker-dependent -- the floor value is an EMPIRICAL knob, not a universal constant.

## Design decisions (epic-review ratifies)

- D1 -- The floor is a CLIENT-SIDE post-filter in `RetrieveStage`, on the score already returned, NOT the server-side `ranking_options.score_threshold`. Rationale: observability + testability. Client-side, we see every chunk's score and can log exactly what the floor removed (house norm: no silent caps -- log what was dropped); we can unit-test it with a stubbed provider and no live endpoint; and it needs no PROBE-FIRST verification of an unverified request param. The server-side threshold is a deferred payload optimization (see Deferred), not the v1 mechanism.

- D2 -- Observability ships BEFORE the floor (story order). You cannot tune a floor you cannot see, and the correct floor value is empirical (D-current-behavior: absolute scores are corpus-dependent). 078.1 surfaces per-chunk scores in `RetrieveStage` diagnostics + the existing dev handle FIRST; 078.2 adds the filter. This also makes 078.1 independently valuable (visibility into retrieval quality) even if the floor is never enabled.

- D3 -- The floor default is DISABLED (`0`), preserving today's behavior on deploy. It is a Studio-settable plugin-config knob (`loreRelevanceFloor`, 0..1) tuned live against the 078.1 diagnostics. Shipping enabled with a guessed constant would be tuning-blind against an unknown score scale; shipping the knob + the visibility to set it is the honest unit of work. (Revisit trigger for a non-zero default is in Deferred.)

- D4 -- The floor composes with the existing page_id paths without breaking them, precisely:
  - The synthetic runtime-location evidence (`score: 1`) is authoritative context, not retrieval roulette -- it always passes (a floor <= 1 never removes it; it is also prepended AFTER filtering at `RetrieveStage.ts:347`, so it is structurally exempt).
  - The pinned own-page chunk (`shouldPinNpcLore`, 072.6) is a deliberate identity anchor, not a relevance match -- it BYPASSES the floor, but its score is logged so a chronically-weak pin is visible.
  - Broaden-on-zero-results (`RetrieveStage.ts:304-307`) runs first; the floor applies to whatever the broadened search returns. If the floor then empties the set, that is a legitimate "no relevant lore this turn" outcome, NOT an error: `loreSearchPerformed` stays true, `status` stays `ok`, `loreContext` is simply empty, and downstream `hasEvidence` correctly reads false. This is the "inject-only-relevant" behavior -- an empty evidence block beats a misleading one.
  - The persona-exclusion path (072.6 `excludeOwnPage`) already drops own-page results client-side then slices to `maxLoreResults`; the floor applies to the OTHER-lore remainder, before the slice.

- D5 -- "Inject-only-relevant" is not a separate feature; the floor IS it. A chunk that clears the floor is relevant enough to inject; one that does not is dropped. No per-site injection logic changes -- the three consumers (Generate/Plan/Judge summary) all read the already-filtered `loreContext`, so filtering once in `RetrieveStage` fixes all three at the source (one source of truth).

## Stories (EXECUTION ORDER)

### 078.1 Retrieval score observability (D2)

Surface the real per-chunk similarity scores so the floor can be tuned. `RetrieveStage` diagnostics gain: `loreScores` (score per returned chunk, aligned to `loreContextSummary`), and the pin/synthetic scores distinguished from retrieved ones. Extend the existing dev inspection handle (the 073.5 / `__sugaragentQuestContext` family -- confirm the exact handle in code, do not trust this reference) so scores are readable live in preview without opening the HUD. No behavior change to retrieval. Exit: unit test asserts scores flow into diagnostics for retrieved, pinned, and synthetic-location items; preview smoke -- talk to a lore-backed NPC and read per-chunk scores off the handle.

### 078.2 Relevance floor post-filter (D1, D3, D4, D5)

Add `loreRelevanceFloor` to the plugin config (schema + normalizer + defaultConfig + `SugarAgentPluginConfig` type + gateway-runtime-config parity if surfaced there; default `0` = disabled), Studio-settable beside `maxLoreResults`. In `RetrieveStage`, after `searchLore` returns and before `loreContext` is populated, drop retrieved chunks whose `score < floor`; pin + synthetic-location bypass per D4; broaden-then-floor + empty-is-ok per D4. Log the dropped count + dropped scores in diagnostics (no silent cap). Exit: unit tests -- (a) `floor=0` reproduces today's output exactly (byte-for-byte on a fixed stub), (b) a floor between two stubbed scores drops the weak chunk and keeps the strong one, (c) a pinned own-page chunk below the floor survives, (d) a floor above all scores yields empty `loreContext` with `status:ok` + `loreSearchPerformed:true` + a logged dropped-count, (e) the synthetic runtime-location evidence survives any floor <= 1.

### 078.3 Wrap: docs + tuning note (D2, D3)

Update `docs/api` (the sugaragent knowledge-model doc -- `packages/plugins/src/catalog/sugaragent/docs/api/npc-knowledge-model.md`, per the 072 wrap) with: the floor config field, the score-observability handle, and a short tuning recipe (read scores in preview across a range of on- and off-topic questions, set the floor just under the on-topic cluster). Note the measured before/after on WORLD-GROUNDED judge-fail rate for one authored NPC if measurable. Backlog: file the server-side `score_threshold` payload optimization (Deferred below) as a task with its probe-first trigger.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Preview a lore-backed NPC. Ask three ON-topic questions and three OFF-topic ones; read the per-chunk scores off the dev handle. Confirm off-topic turns show markedly lower scores than on-topic ones (this validates the score is real and discriminating BEFORE any floor is set).
3. Set `loreRelevanceFloor` in Studio just under the on-topic score cluster; Save + Deploy Local Gateway. Re-ask: on-topic turns still inject evidence; off-topic turns now inject an empty evidence block (NPC falls back to persona/voice rather than reciting loosely-related lore). Nothing crashes; `status` stays ok.
4. Set the floor to `0`: behavior is exactly as before this epic (regression guard).
5. Set the floor absurdly high (e.g. `0.99`): every turn injects no evidence, NPC still answers from persona, no errors, diagnostics show a dropped-count each turn.

## Epic wrap

docs/api updated (floor field, score handle, tuning recipe). Before/after WORLD-GROUNDED fail-rate noted if measured. Backlog sweep incl. the server-side `score_threshold` follow-on.

## Deferred (with revisit triggers)

- Server-side `ranking_options.score_threshold` forward: once the client-side floor is calibrated (078 shipped + a floor value chosen), forward that value into the gateway search body (`core.ts:1240`) to stop OpenAI returning sub-floor chunks at all (payload trim). Revisit trigger: when retrieval response size or count of dropped chunks becomes a felt cost. PROBE-FIRST when picked up: `ranking_options.score_threshold` must be verified accepted (not 400'd) against the live OpenAI `/search` endpoint before relying on it -- same discipline as 072.6's `ne`-filter probe. Keep the client-side floor as the observable source of truth even if the server threshold is added (defense in depth + diagnostics).
- Non-zero default floor: revisit once a floor value proves stable across multiple authored worlds (not just wordlark) -- only then is a shipped default defensible. Until then the knob defaults off.
- Query-conditioned dynamic K / re-ranking: if noise persists ABOVE the floor (strong-but-wrong chunks), revisit the deferred 071.3 re-rank seam. Out of scope here; the floor addresses weak matches, not confidently-wrong ones.
