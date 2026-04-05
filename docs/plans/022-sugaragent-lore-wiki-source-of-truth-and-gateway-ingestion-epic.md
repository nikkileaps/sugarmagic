# Plan 022: SugarAgent Lore Wiki Source of Truth and Gateway Ingestion Epic

**Status:** Proposed  
**Date:** 2026-04-05

## Epic

### Title

Make the lore wiki the canonical authored source of SugarAgent world context, remove duplicated inline NPC lore/persona fields, and move lore parsing, chunking, embedding, and vector-store ingestion behind the SugarDeploy gateway.

### Goal

Deliver a SugarAgent lore architecture that:

- uses exactly two world-context sources:
  - runtime/game context
  - lore wiki context
- removes duplicated SugarAgent lore/persona authoring from NPC inline fields
- gives every lore page one canonical stable identifier
- lets NPCs reference exactly one canonical lore page
- performs lore parsing, chunking, embedding, and vector-store writes in the gateway
- exposes gateway endpoints for management-time lore ingest and overwrite/update
- uses OpenAI embeddings and OpenAI vector store for v1
- avoids reintroducing the old tag-heavy identity/linkage pain from Sugarengine
- adheres to the project principles:
  - one source of truth
  - single enforcer
  - one-way dependencies
  - one type per behavior
  - goals must be verifiable

## Scope

This epic includes:

- a source-of-truth split between runtime state and lore wiki state
- a canonical lore page identity rule
- a new NPC-level `lorePageId` reference
- removal of duplicated inline SugarAgent NPC lore/persona fields
- a gateway-owned lore ingest pipeline
- gateway API contracts for lore ingest/status/overwrite behavior
- a management UI flow in the SugarAgent workspace for running lore ingest
- OpenAI embeddings + OpenAI vector store as the initial backend implementation

## Out Of Scope

This epic does not include:

- reintroducing the old tagging/scope maze as the primary identity mechanism
- making tags mandatory for page identity or NPC linkage
- implementing a self-hosted vector database
- implementing final production auth for management endpoints
- solving every future lore retrieval heuristic up front
- replacing runtime/game-state context with wiki-authored state

## Why this epic exists

Right now Sugarmagic is at risk of recreating one of the old Sugarengine pain points:

- some NPC/world context authored inline in the app
- some NPC/world context authored in the wiki
- unclear precedence and unclear retrieval source

That leads directly to:

- duplicated authoring
- drift
- confusion about which source is canonical
- harder debugging when SugarAgent says something wrong

We want to stop that before it becomes permanent.

## Core recommendation

Sugarmagic should enforce this source-of-truth split:

### 1. Runtime/game context

Runtime state should come from the game:

- blackboard
- active quests
- current region/scene
- live NPC state
- current location/activity/goals
- temporary relationship state
- recent events

This is the source of truth for:

- what is true right now in the running game

### 2. Lore wiki context

Authored lore should come from the lore wiki:

- NPC identity
- background
- personality
- authored voice/persona guidance
- factions
- places
- history
- authored world facts

This is the source of truth for:

- who or what something is in the authored world

### Explicit rule

Sugarmagic should not allow the same class of authored fact to live in both places.

In particular:

- NPC background/persona/voice/lore scopes should not be duplicated inline on the NPC definition if the lore wiki is canonical

## Canonical lore page identity

Every lore page must have exactly one canonical page ID.

Recommended frontmatter shape:

```yaml
id: root.characters.station_manager
title: Station Manager
```

Rules:

- `id` is required
- `id` is globally unique within the lore wiki
- `id` is the only canonical page identifier
- path, filename, title, and tags are not the canonical identifier

This means:

- page identity is explicit
- page references are stable
- the system does not need tags to determine which page is “the real one”

## NPC reference model

NPC definitions should store exactly one authored lore reference:

```ts
interface NpcDefinition {
  // existing core NPC fields...
  lorePageId?: string | null;
}
```

Meaning:

- `lorePageId` points to the canonical lore page for that NPC
- this is the page the retrieval/ingest system treats as the NPC’s authored source

Recommended examples:

- `root.characters.station_manager`
- `root.characters.captain_vale`
- `root.locations.earendale`

### Explicit recommendation

Remove duplicated inline SugarAgent NPC fields such as:

- inline persona
- inline tone
- inline voice constraints
- inline lore scopes
- inline self scopes
- inline related scopes
- inline motivations/secrets if those are intended as authored lore rather than runtime state

If a piece of data is authored canon, it should live on the wiki page.

If a piece of data is live runtime state, it should live in runtime/game state.

## Chunk identity model

The old Sugarengine chunk identity model was the right part to keep.

Recommended rule:

- `pageId = frontmatter.id`
- `chunkId = ${pageId}#${sectionSlug}`

Example:

- page: `root.characters.station_manager`
- chunk: `root.characters.station_manager#overview`

This is simple, stable, and does not depend on tags.

## Lore source configuration

The lore wiki is conceptually a separate repository or source root.

The gateway should own how that source is resolved.

Recommended source config:

```ts
type LoreSourceKind = "local" | "github";

interface LoreSourceConfig {
  kind: LoreSourceKind;
  localPath?: string;
  repoUrl?: string;
  ref?: string;
}
```

Meaning:

- local development may point at a checked-out local lore repo
- later hosted flows may fetch/clone from GitHub or another remote source

The browser/UI should not implement clone/parse/ingest logic itself.

## Gateway-owned ingest pipeline

Lore ingest should live in the gateway.

The gateway owns:

- resolving the lore source
- reading markdown pages
- parsing frontmatter
- validating canonical `id`
- splitting pages into chunks
- generating OpenAI embeddings
- writing/updating the OpenAI vector store
- returning ingest status/errors to the management UI

### Why gateway-owned

Because this is:

- secret-bearing
- operational/backend behavior
- potentially slow
- not browser-safe
- shared between local and hosted deployment targets

This belongs behind SugarDeploy, not in Studio browser code.

## Gateway API contract

Recommended first-pass API surface:

### `GET /api/sugaragent/lore/status`

Returns:

- configured source kind
- source path/repo/ref summary
- last ingest time
- last ingest result
- current vector store id
- chunk/page counts if known
- current ingest state

### `POST /api/sugaragent/lore/ingest`

Starts or runs lore ingest.

Recommended request shape:

```ts
interface SugarAgentLoreIngestRequest {
  source?: LoreSourceConfig;
  mode: "overwrite";
}
```

Recommended initial rule:

- `overwrite` is the only supported mode in v1

Reason:

- avoids stale chunk drift
- keeps behavior simple and verifiable
- easier to debug than fuzzy append/update semantics

### `GET /api/sugaragent/lore/pages`

Optional but useful management endpoint.

Returns:

- discovered pages
- page IDs
- titles
- source files

This helps the workspace let authors pick a canonical `lorePageId` without re-implementing wiki parsing in the UI.

## Initial ingest behavior

The first implementation should be conservative and explicit:

1. resolve lore source
2. collect markdown pages
3. require frontmatter `id`
4. build chunks by section
5. derive:
   - `pageId`
   - `chunkId`
6. build embedding text
7. upload/replace vector-store content
8. report counts/issues

### Important recommendation

Do not make tags mandatory for any of:

- page identity
- NPC-page linkage
- chunk identity
- successful ingest

Tags can remain optional metadata later.

They should not be required to make the basic system function.

## SugarAgent workspace responsibility

The SugarAgent workspace should become a management/control surface, not the place where ingest logic lives.

It should be able to:

- show lore source status
- trigger overwrite ingest
- surface validation errors
- browse/select discovered lore pages
- set `lorePageId` on NPCs

It should not:

- parse the wiki itself
- compute embeddings
- write to the vector store directly

## Verification goals

This epic is successful when:

1. NPC inline SugarAgent lore/persona duplication is removed
2. NPCs can reference a canonical `lorePageId`
3. lore pages have one canonical required `id`
4. the gateway can ingest a lore wiki from a configured source
5. ingest produces stable `pageId` and `chunkId` values
6. the first implementation works without tags being required
7. the SugarAgent workspace can trigger an overwrite ingest and inspect status
8. runtime/game state and lore wiki state are clearly separated in code and UI

## Suggested stories

1. Remove duplicated inline SugarAgent NPC lore/persona fields and add `lorePageId`
2. Define the lore page frontmatter schema with required canonical `id`
3. Add a lore-source configuration model for local/GitHub-backed lore repos
4. Add gateway lore-ingest endpoints for status and overwrite ingest
5. Implement markdown parsing, chunking, and OpenAI embedding/vector-store upload in the gateway
6. Add SugarAgent workspace controls for lore ingest and status
7. Add NPC lore-page selection/binding UI based on discovered page IDs

## References

- [Sugarengine lore ingest pipeline](/Users/nikki/projects/sugarengine/packages/sugaragent-runtime-core/src/lore/lore-lib.ts)
- [Sugarengine lore plugin copy](/Users/nikki/projects/sugarengine/src/plugins/sugaragent/lore/lore-lib.ts)
- [Plan 019: SugarAgent Conversation Provider and Turn Lifecycle Epic](/Users/nikki/projects/sugarmagic/docs/plans/019-sugaragent-conversation-provider-and-turn-lifecycle-epic.md)
- [Plan 021: Deployment Plugin and Publish Deploy Target Architecture Epic](/Users/nikki/projects/sugarmagic/docs/plans/021-deployment-plugin-and-publish-deploy-target-architecture-epic.md)
