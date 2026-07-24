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

`## Secrets` is excluded from all three — from the persona card, from core
knowledge, and from the ingest chunks / vector index — so it never enters any
prompt or search. It is the minimum-viable secrets invariant; quest-stage-gated
revelation is a later epic.

## Load path (session start)

`SugarAgentGatewayPersonaProvider.loadPersona` (`runtime/clients.ts`) is called
once from `startSession` before the first turn. It hits the existing gateway
route `POST /api/sugaragent/lore/resolve` (which already strips `## Secrets`),
runs `designateLoreSections` to split persona card vs core knowledge, and stores
a `LoadedPersona` in provider session state. Missing/unfetchable page degrades
(never throws): `loaded: false`, empty layers, `fallbackReason:
"persona-unavailable"` — the conversation still runs on name + game tone.

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

A `loreRelevanceFloor` config field (0..1, default 0) post-filters retrieved
chunks below the given score before they reach the prompt. `pinned` and
`synthetic-location` chunks bypass the floor by structure. See the tuning
recipe in `docs/api/sugaragent-npcs.md` (Tuning the Relevance Floor).
