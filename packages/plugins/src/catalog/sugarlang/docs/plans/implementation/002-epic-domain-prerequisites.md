# Epic 2: Domain Prerequisites

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Placement Interaction Contract](../../proposals/001-adaptive-language-learning-architecture.md#placement-interaction-contract)
**Depends on:** Epic 1 (skeleton + QA sign-off)
**Blocks:** Epic 10 (Middleware Pipeline), Epic 11 (Placement Capability)

## Context

Sugarlang's placement capability requires that authors can tag an NPC with metadata identifying it as the placement NPC, and that the metadata is propagated from the NPC definition through to the conversation pipeline where sugarlang's middleware can read it. Today, `NPCDefinition` does not have a `metadata` field — it has `definitionId`, `displayName`, `description`, `interactionMode`, `lorePageId`, `presentation` and nothing else (confirmed at `packages/domain/src/npc-definition/index.ts:18-25`).

This epic adds the one small domain-model change sugarlang needs: an optional `metadata: Record<string, unknown>` field on `NPCDefinition`, with correct normalization, serialization, and propagation into `ConversationSelectionContext.metadata` when a conversation is opened with that NPC. `ConversationSelectionContext` already has a `metadata?: Record<string, unknown>` field (confirmed at `packages/runtime-core/src/conversation/index.ts:50`), so the plumbing on the receiving side already exists. The work is: (1) add the field to the domain type, (2) wire it through normalization and serialization, (3) have the conversation host copy it into the selection context.

This change lives in `packages/domain/` and `packages/runtime-core/`, outside the sugarlang plugin. It ships as a separate PR from the sugarlang-internal work, with its own reviewers (the domain and runtime-core maintainers).

## Why This Epic Exists Before Any Sugarlang Code

Sugarlang's placement middleware must not hardcode NPC IDs (`AGENTS.md`: "Do not allow multiple persisted models to overlap in meaning" — the placement NPC is authored content, not plugin configuration). The tag mechanism is how authors identify any NPC as the placement NPC without the plugin knowing its name. Without this field, there is no clean way for an author to tag an agent-mode NPC. Adding it now removes the blocker from Epic 10 and Epic 11.

Generic plugin metadata on a domain entity is also the kind of small, reusable affordance that's likely to be needed by *other* future plugins (e.g. a plugin that wants to tag certain NPCs as "merchants" or "quest-givers" for its own purposes). Making this extension generic-shape once, cleanly, saves us from adding it repeatedly in uglier ways later.

## Prerequisites

- Epic 1 complete (skeleton with QA sign-off)
- No sugarlang runtime code needs to be ready — this epic is purely domain/runtime-core work

## Success Criteria

- `NPCDefinition.metadata?: Record<string, unknown>` exists with correct normalization
- `ConversationSelectionContext.metadata` is populated from `NPCDefinition.metadata` when the conversation host opens a conversation with an NPC
- Unit tests cover the normalization and the propagation
- API documentation is updated to describe the metadata contract for plugin authors
- The change is reviewed and merged by the domain/runtime-core maintainers before Epic 10 begins

## Stories

### Story 2.1: Add `metadata` field to `NPCDefinition`

**Purpose:** Extend the domain type with the new field, update normalization, update the default factory, update serialization.

**Tasks:**

1. Edit `packages/domain/src/npc-definition/index.ts`:
   - Add `metadata?: Record<string, unknown>` to the `NPCDefinition` interface
   - Update `createDefaultNPCDefinition` to omit the field by default (undefined — not an empty object, to keep serialized output clean)
   - Update `normalizeNPCDefinition` to pass through the metadata field as-is if it's a non-null object, otherwise strip it
   - Update `normalizeNPCDefinitionForWrite` to do the same
2. If there is a serialization layer for NPCs in `packages/domain/src/` or `packages/io/`, verify that JSON round-tripping preserves the metadata field. Add passthrough if needed.
3. If there is a JSON schema for NPC definitions, add the metadata field to it with `"additionalProperties": true` so plugins can use arbitrary keys under their own namespace.

**Tests Required:**

- Unit test: `createDefaultNPCDefinition()` has no `metadata` field
- Unit test: `normalizeNPCDefinition({ metadata: { sugarlangRole: "placement" } })` preserves the field
- Unit test: `normalizeNPCDefinition({ metadata: null })` strips the field
- Unit test: `normalizeNPCDefinition({ metadata: "not-an-object" })` strips the field
- Unit test: JSON round-trip of an NPC with metadata preserves the metadata
- Unit test: An NPC authored without metadata serializes to JSON that does not include a `metadata: null` key (keeps serialized output clean)

**API Documentation Update:**

- Update `docs/api/placement-contract.md` in the sugarlang plugin to describe the metadata-tag mechanism, citing the new `NPCDefinition.metadata` field and showing an example: `npc.metadata = { sugarlangRole: "placement" }`
- Update any general domain documentation (if any exists in `packages/domain/README.md` or similar) to mention the new field and the "plugins should use their own namespace under metadata" convention

**Acceptance Criteria:**

- `NPCDefinition.metadata?: Record<string, unknown>` compiles and serializes correctly
- All unit tests pass
- `tsc --noEmit` passes across the domain package

### Story 2.2: Propagate `NPCDefinition.metadata` into `ConversationSelectionContext.metadata`

**Purpose:** When the conversation host opens a conversation with an NPC, the NPC's metadata should flow into the `selection.metadata` field so downstream middlewares can read it.

**Tasks:**

1. Locate the conversation host / conversation lifecycle code in `packages/runtime-core/src/conversation/` that constructs a `ConversationSelectionContext` from an NPC + dialogue. Likely in a `ConversationHost` class or a `createConversationSelection` function.
2. When the source NPC has a `metadata` field, copy it into `ConversationSelectionContext.metadata` using object-spread so future fields on selection metadata are preserved. The copy is a shallow clone — plugins should never mutate the source NPC.
3. If `ConversationSelectionContext.metadata` is already populated from another source (e.g. a dialogue-level metadata), merge them with NPC metadata taking precedence for sugarlang keys or with a documented precedence rule.
4. Document the precedence rule in `docs/api/placement-contract.md`.

**Tests Required:**

- Unit test: constructing a selection context from an NPC with `metadata: { sugarlangRole: "placement" }` yields `selection.metadata.sugarlangRole === "placement"`
- Unit test: constructing a selection context from an NPC with no metadata yields `selection.metadata === undefined` (not an empty object)
- Unit test: mutation of `selection.metadata` does not mutate `npc.metadata` (shallow-copy isolation)
- Integration test: an NPC with `metadata: { sugarlangRole: "placement" }` can be read from `ConversationExecutionContext.selection.metadata` inside a middleware's `prepare()` hook

**API Documentation Update:**

- `docs/api/placement-contract.md`: document the propagation path (NPC → selection context → middleware), including the precedence rule if there is one
- `docs/api/middlewares.md`: in the "How sugarlang middlewares read authoring metadata" section, show a code example of reading `selection.metadata?.sugarlangRole`

**Acceptance Criteria:**

- NPC metadata reliably reaches middlewares via `execution.selection.metadata`
- No existing conversation-host test breaks
- `tsc --noEmit` passes across runtime-core

### Story 2.3: Reserve the `sugarlang.*` metadata namespace convention

**Purpose:** Document the convention that plugin-specific metadata on domain entities lives under a plugin-name prefix, so different plugins can coexist without key collisions. This is documentation-only but has teeth as a review discipline.

**Tasks:**

1. Write a short section in `packages/domain/README.md` (or create one if it doesn't exist) titled "Plugin Metadata Convention" that:
   - States: "Plugins that attach metadata to domain entities must use their plugin id as a namespace prefix. For example, the sugarlang plugin uses keys under `sugarlangRole`, `sugarlangPlacementQuestionOverrideId`, etc."
   - Lists the existing reserved prefixes (just `sugarlang` at this stage)
   - Says: future plugins that want to reserve a prefix should update this list in a PR
2. Add the same statement to `docs/api/placement-contract.md` in the sugarlang plugin
3. Add a comment in `packages/domain/src/npc-definition/index.ts` near the `metadata` field declaration pointing to the convention doc

**Tests Required:** none (documentation only)

**API Documentation Update:**

- `docs/api/placement-contract.md`: "Metadata namespace reservation" subsection
- `packages/domain/README.md` (domain package): "Plugin Metadata Convention" section

**Acceptance Criteria:**

- The convention is documented in both locations
- The `NPCDefinition` source file comments point to the convention

## Risks and Open Questions

- **Does another plugin or system already use a metadata pattern on NPCs?** If so, this epic should reconcile with that pattern rather than introduce a competing one. Check during implementation by searching `NPCDefinition`-adjacent code for any existing `metadata`, `tags`, or `flags` field usage.
- **Does the studio NPC editor need to be aware of the metadata field?** For Epic 2 specifically: no. The editor doesn't need a UI affordance until Epic 12. A developer can set the metadata field by editing the saved NPC JSON directly, which is fine for testing purposes during Epics 3–11.
- **Is there a migration concern for existing saved NPCs?** The field is optional. Existing NPCs saved before this change will load with `metadata === undefined`, which is the correct value. No migration needed.
- **Should there be a `metadata` field on `DialogueDefinition` too, for the parallel case where an author wants to tag a scripted dialogue?** Sugarlang v1 does not need this — placement is always agent-mode. If a later plugin needs it, it can be added as its own small domain change. Flag this as out-of-scope for Epic 2.

## Exit Criteria

Epic 2 is complete when:

1. All three stories are complete
2. Unit tests in the domain and runtime-core packages pass
3. API documentation updates are merged
4. The change has been reviewed and merged by the domain/runtime-core maintainers
5. A smoke test confirms that an NPC authored with `metadata: { sugarlangRole: "placement" }` produces a `ConversationSelectionContext.metadata.sugarlangRole === "placement"` when a conversation is started with that NPC
6. This file's `Status:` is updated to `Complete`
