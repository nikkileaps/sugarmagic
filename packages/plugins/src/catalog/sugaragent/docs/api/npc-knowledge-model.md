# SugarAgent — NPC Knowledge Model

How an agentified NPC gets its identity, knowledge, and voice into the model,
and how the runtime keeps that grounded and cheap. This is the reference for the
persona/knowledge architecture; the writer-facing authoring convention is in
`docs/authoring/npc-lore-page.md`.

## One source of truth, three layers

Everything character-defining lives on the NPC's lore wiki page, referenced by
`NPCDefinition.lorePageId`. That one page feeds three layers, split by reserved
section headings (see `deployment/gateway/lore-designation.ts`):

| Layer | Source | Access path | Lands in |
|---|---|---|---|
| 1. Persona card | `## Persona`, `## Voice` | whole-section fetch at session start | system prompt (stable) |
| 2. Core knowledge | every other section | same fetch | system prompt (stable) |
| 3. World lore | the rest of the wiki | per-turn vector search | user message (evidence) |

All three come from the vector store. The running game never reads lore off a
filesystem: `lore/resolve` rebuilds a page from the chunks indexed against its
`page_id`, which is a lookup rather than a search -- no query is embedded, no
relevance floor applies. The markdown on disk is an input to ingest, and a
deployed gateway has none of it.

Two consequences worth knowing. Sections arrive in the store's order, not the
author's, because nothing reads them positionally -- the persona card and the
drift digest both pick by slug. And a `canon_level: soft` page indexes only its
identity, so it resolves with no sections at all; `loadPersona` treats that as
degraded rather than reporting an empty character as loaded.

One heading is withheld from all three layers — kept out of the persona card,
out of core knowledge, and out of the ingest chunks / vector index:

- `## Secrets` never leaves the gateway. The minimum-viable secrets invariant;
  quest-stage-gated revelation is a later epic.

`isSecretSection` (`deployment/gateway/lore-designation.ts`) is that test, and
it drives the ingest skip. Resolve needs no filter of its own: a secret is
never chunked, so the store has nothing to hand back.

## Recovery strategies are not on the page

What a character does when it cannot understand the player is authored on the
NPC in Studio (Design > NPCs > Recovery) and saved in the project file, as
`NPCDefinition.recoveryStrategies`. It is an instruction to the conversation
pipeline rather than knowledge about the world, so the lore wiki is the wrong
home for it, and it never reaches ingest or retrieval at all.

The list travels to the provider on `ConversationSelectionContext`, the way the
NPC's name and lore page id do. `PlanStage` reads the strategy names to choose
one; the prompt builder renders the same entries — name plus the writer's note
— as the recovery brief in the system half. One authored list, two readings.

## Load path (session start)

`SugarAgentGatewayPersonaProvider.loadPersona` (`runtime/clients.ts`) is called
once from `startSession` before the first turn. It hits the existing gateway
route `POST /api/sugaragent/lore/resolve`, runs `designateLoreSections` over
`sections` to split persona card vs core knowledge, and stores a
`LoadedPersona` in provider session state. Missing/unfetchable page degrades (never throws):
`loaded: false`, empty layers, `fallbackReason: "persona-unavailable"` — the
conversation still runs on name + game tone. `degradedPersona` in
`runtime/clients.ts` is the one builder for that state; the provider's
session-start loader calls it rather than assembling its own.

## Prompt structure (cache boundary)

`runtime/stages/generate/prompt/builder.ts` draws the two halves along the
prompt-cache boundary:

- **System prompt (byte-stable per session)**: identity/output rules → grounding
  rules → persona card → core knowledge → voice directive. The voice directive
  prefers an authored `## Voice` section; the plugin-wide `tone` config is the
  game-level fallback.
- **User message (per turn, uncached)**: world-state block, the sugarlang overlay,
  the minimal-greeting instruction, plan directives, evidence, history, and — as
  the last block — a compact **persona drift digest** re-injected each turn to
  fight ~8-turn character drift.

Keeping the system prompt byte-stable is what lets prompt caching work.

## Gateway generate route

`POST /api/sugaragent/generate` accepts either:

- `systemPrompt` (string) — legacy; sugarlang's teacher/verify/scripted/chunk
  calls use this and stay uncached; or
- `systemBlocks: [{ text, cache? }]` — sugaragent sends its whole system prompt
  as one cacheable block. The gateway maps it to Anthropic `system` content
  blocks and stamps `cache_control: { type: "ephemeral" }` on `cache: true`
  blocks (prompt caching is GA; no beta header).

The response passes through `usage` (`inputTokens`, `outputTokens`,
`cacheReadInputTokens`, `cacheCreationInputTokens`) and the resolved `model`.
Turn diagnostics surface `modelUsed` + the cache fields.

## Model selection

- Gateway default: `claude-haiku-4-5` (small-fast workhorse). Override with the
  `SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL` env var.
- Per-NPC override: `NPCDefinition.agentModelOverride` (authoring: the NPC
  inspector's Lore Binding stack). Empty = gateway default. GenerateStage passes
  it through the request `model` field.

### Cache-minimum caveat (measured)

Prompt caching only fires when the cacheable prefix clears a MODEL-DEPENDENT
minimum: ~1024 tokens (Sonnet 4.5), ~2048 (Sonnet 4.6), ~4096 (Haiku 4.5).
Measured against a representative persona (Finnick Thorn: `## Persona` + `##
Voice` + one core section) the full system prompt is **~646 input tokens** — well
under every minimum, so `cacheCreationInputTokens` is 0 and nothing caches. The
mechanism is correct and free to leave on; it only starts paying off for large
personas (or a lower-minimum model with a persona that clears it). At Haiku
prices a typical uncached turn is on the order of $0.003, so the non-caching of
small personas is not a cost problem — it is simply a fact to know when reading
cache diagnostics.

## Evidence retrieval

`RetrieveStage` forwards up to `maxEvidenceResults` evidence items, each capped
at `maxEvidenceCharsPerItem` (config; default 600). When the persona card loaded,
the NPC's own page is already in the system prompt, so a non-location-anchored
turn EXCLUDES the own page from evidence (client-side post-filter on `page_id`)
and surfaces other world lore; when degraded it keeps the legacy
own-page-preferred targeting. Ingest header lines (`Page ID:`/`Title:`/`Section:`)
are stripped from evidence text before it reaches the prompt.

A `loreRelevanceFloor` config field (0..1, default 0.3) is the minimum
similarity score a chunk must reach. It rides on the vector store provider and
goes out with every search as `scoreThreshold`, so the vector store applies it
and a chunk below it is never returned. Nothing in the game filters by score.
`synthetic-location` entries are assembled from the blackboard rather than
searched, so the threshold does not reach them. See
`docs/api/sugaragent-npcs.md` (The Relevance Threshold).
