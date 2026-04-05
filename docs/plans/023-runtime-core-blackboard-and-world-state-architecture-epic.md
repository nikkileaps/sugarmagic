# Plan 023: Runtime-Core Blackboard and World State Architecture Epic

**Status:** Proposed  
**Date:** 2026-04-05

## Epic

### Title

Add a first-class runtime-core blackboard and world-state architecture to Sugarmagic so live game state has one authoritative home, remains useful without plugins, and can be consumed consistently by systems such as SugarAgent, Sugarlang, NPC behavior, routing, animation, and quest execution.

### Goal

Deliver a runtime-core world-state architecture that:

- introduces a real blackboard/state system in `runtime-core`
- keeps runtime/game state independent from any specific plugin
- gives live game facts one authoritative home
- allows non-plugin runtime systems to use the same state facility
- allows plugins such as SugarAgent and Sugarlang to consume world state without owning it
- cleanly separates:
  - authored lore/canon
  - live runtime state
- supports first-pass grounding fields such as:
  - where the player is
  - where an NPC is
  - what region/scene is active
  - what quest/stage/objective is active
  - what an NPC is doing right now
  - what live scene/world facts are true right now
- preserves the project principles:
  - one source of truth
  - single enforcer
  - one-way dependencies
  - one type per behavior
  - goals must be verifiable

## Scope

This epic includes:

- a core `runtime-core` blackboard/state facility
- a clear separation between authored lore state and runtime/live state
- typed world-state domains for a first pass of gameplay grounding
- a model for publishing and consuming world-state facts
- a model for state scopes such as global, region, entity, and quest
- a plugin-facing consumption contract so SugarAgent and later Sugarlang can read world state
- a plan for integrating location, quest, and live NPC state into turn execution later

## Out Of Scope

This epic does not include:

- finishing the SugarAgent port on the current branch before the user is ready
- reintroducing duplicate authored lore/persona fields on NPCs
- replacing the lore wiki as the authored source of canon
- implementing every future AI or quest system in this epic
- building an untyped stringly-typed bag of arbitrary keys with no ownership rules
- solving every future replication/networking concern
- implementing full GOAP or full behavior trees in this epic

This epic is about the runtime-core state architecture first.

## Why this epic exists

Sugarmagic now has a cleaner architecture for authored lore:

- authored canon belongs in the lore wiki
- NPCs reference lore canon through `lorePageId`
- SugarAgent can retrieve that lore through the gateway

But there is still a missing architecture piece for live game truth.

We need a first-class home for facts such as:

- where the player is
- where an NPC is
- whether they are in the same region or scene
- what quest stage is active
- what an NPC is doing right now
- whether an NPC is busy, suspicious, friendly, stressed, distracted, or engaged
- what temporary world facts are true in the running game

These facts should not be invented inside SugarAgent or any other plugin.

They should also not exist only as a conversation-specific context object.

They are part of the actual running game.

That means the correct home is:

- `runtime-core`

not:

- a plugin-local state model
- a conversation-only projection that pretends to be architecture

## Core recommendation

Sugarmagic should introduce a real runtime blackboard/state system in `runtime-core`.

That blackboard should:

- exist whether plugins are enabled or not
- be useful to core runtime/gameplay systems
- allow core gameplay logic to publish authoritative live state
- allow downstream systems to consume that state
- become the canonical home for live runtime world truth

### Explicit ownership rule

Runtime state belongs to runtime systems.

Examples:

- player position
- NPC position
- scene membership
- active quest stage
- temporary hostility
- current goal
- current mood/affect
- current attention target
- last-triggered event flags

Plugins may consume this state.

Plugins should not become the primary owners of it.

## Source-of-truth split

Sugarmagic should maintain exactly two world-context sources:

### 1. Lore wiki context

The lore wiki owns authored canon such as:

- identity
- background
- baseline personality
- relationships
- factions
- places
- history
- authored world facts

This answers:

- who or what something is in the authored world

### 2. Runtime blackboard context

The runtime blackboard owns live game state such as:

- where entities are
- what region/scene is active
- what quest state is active
- what the NPC is currently doing
- temporary emotional/behavioral modulation
- current local world facts
- temporary relationship state
- recent events and derived runtime facts

This answers:

- what is true right now in the running game

### Explicit rule

Do not duplicate the same class of fact in both places.

In particular:

- authored NPC personality baseline belongs in lore
- current NPC affect/tone/urgency belongs in runtime state
- authored world facts belong in lore
- live simulation facts belong in runtime state

## Proposed blackboard architecture

### 1. Runtime-core blackboard facility

Recommended conceptual shape:

```ts
type BlackboardScopeKind = "global" | "region" | "entity" | "quest" | "conversation";

interface BlackboardScopeRef {
  kind: BlackboardScopeKind;
  id: string;
}

interface BlackboardFactEnvelope<TValue> {
  key: string;
  scope: BlackboardScopeRef;
  value: TValue;
  updatedAtMs: number;
  sourceSystem: string;
}

interface RuntimeBlackboard {
  setFact<TValue>(fact: BlackboardFactEnvelope<TValue>): void;
  getFact<TValue>(scope: BlackboardScopeRef, key: string): TValue | null;
  listFacts(scope: BlackboardScopeRef): BlackboardFactEnvelope<unknown>[];
  clearFacts(scope: BlackboardScopeRef): void;
}
```

This is intentionally simple.

The important part is not the exact method names.

The important part is:

- real runtime ownership
- explicit scope
- explicit key
- explicit source system
- one shared state facility

### 2. Typed fact domains

The blackboard should not devolve into an ungoverned bag of random strings.

The first pass should define typed fact families for the most important runtime grounding domains.

Recommended first-pass domains:

- `entity.position`
- `entity.region`
- `entity.scene`
- `entity.currentGoal`
- `entity.currentActivity`
- `entity.affect`
- `entity.isBusy`
- `entity.attentionTarget`
- `quest.activeStage`
- `quest.objectives`
- `region.activeScene`
- `scene.liveFacts`
- `conversation.lastTopic`

Examples:

```ts
interface EntityPositionFact {
  entityId: string;
  regionId: string | null;
  sceneId: string | null;
  x: number;
  y: number;
  z: number;
}

interface EntityAffectFact {
  entityId: string;
  mood: string | null;
  urgency: string | null;
  stance: string | null;
}

interface QuestActiveStageFact {
  questId: string;
  stageId: string;
  objectiveIds: string[];
}
```

The exact set can evolve, but the system should begin with typed high-value facts, not free-form sprawl.

## Scope model

The blackboard should support a small set of scopes from day one.

Recommended v1 scopes:

### Global

Use for:

- whole-game facts
- clock/time if needed later
- high-level global flags

### Region

Use for:

- region-local conditions
- weather
- alert state
- region-specific runtime facts

### Entity

Use for:

- player state
- NPC state
- item/object state later if needed
- position
- activity
- mood/affect
- attention target

### Quest

Use for:

- active stage
- active objectives
- quest-local state

### Conversation

Use sparingly for:

- short-lived per-conversation state
- recent topic/expectation markers

This should not become the primary home for world truth.

## Ownership and dependency direction

### Core rule

The dependency direction should be:

- gameplay/runtime systems publish authoritative state into the blackboard
- other runtime systems and plugins consume it

Not:

- plugins own the state model
- plugins push ad hoc state contracts back into runtime-core

### Recommended publishers

Examples of likely publishers:

- gameplay session coordinator
- movement/placement system
- quest runtime
- NPC behavior/GOAP layer
- region/scene orchestration layer
- dialogue/conversation coordinator for conversation-scoped facts only

### Recommended consumers

Examples of likely consumers:

- SugarAgent
- Sugarlang
- NPC routing/behavior
- animation selection
- trigger systems
- quest logic
- debugging/inspection tools

## Plugin integration recommendation

Plugins should consume blackboard state through the runtime execution contract.

Meaning:

- the blackboard itself belongs to `runtime-core`
- plugin execution contexts can carry read access or a structured view of blackboard facts
- plugins should read runtime truth from the blackboard rather than inventing parallel state models

This keeps the dependency one-way:

- `runtime-core` owns world state
- plugins consume world state

## SugarAgent implications

This epic is intentionally deferred until after the current SugarAgent port work, but the intended follow-through is clear.

Later SugarAgent turn execution should be able to include runtime facts such as:

- player region/scene
- NPC region/scene
- player/NPC proximity
- active quest stage
- current objectives
- NPC current activity
- NPC current affect/urgency/busyness
- local live scene facts

These facts should inform:

- evidence claiming
- retrieval biasing
- planning
- generation constraints
- voice modulation based on runtime state

### Important tone/persona rule

The lore wiki should carry:

- baseline characterization

The runtime blackboard should carry:

- current state modulation

Examples:

- rushed
- guarded
- tired
- distracted
- suspicious
- relieved

This prevents the system from hard-coding all tone into authored lore.

## Sugarlang and non-plugin implications

This epic exists partly because the same runtime state will matter beyond SugarAgent.

Examples:

- Sugarlang may need the same runtime facts for language/context work
- NPC behavior may need location and state facts without any plugin involvement
- animation/routing choices may depend on the same blackboard values
- future systems should not need to reinvent parallel world-state stores

This is why the blackboard belongs in `runtime-core` and must be useful without plugins.

## Verifiable first-pass outcomes

This epic should be considered successful when Sugarmagic can demonstrate:

1. a real blackboard facility exists in `runtime-core`
2. core gameplay systems can publish typed live-state facts into it
3. non-plugin runtime systems can consume those facts
4. plugins can consume those facts through the runtime execution boundary
5. player/NPC location and active quest state can be surfaced as blackboard facts
6. authored lore and runtime state no longer compete for ownership of the same fact class

## Recommended implementation order

### Story 1

Add a minimal runtime-core blackboard facility with explicit scopes and typed fact envelopes.

### Story 2

Publish first-pass gameplay facts into the blackboard:

- player position/region/scene
- NPC position/region/scene
- active quest/stage/objectives
- NPC current activity/affect/busy state

### Story 3

Add debug/inspection surfaces so the runtime blackboard can be observed and trusted.

### Story 4

Expose blackboard-backed runtime context to plugin execution contracts.

### Story 5

Teach SugarAgent to consume blackboard facts for turn grounding and runtime tone modulation.

## Deferral note

This epic should be parked until the current SugarAgent port work on the active branch is in a better stopping place.

The point of writing it now is to:

- lock in the architecture
- avoid accidental drift toward plugin-owned runtime state
- make the eventual runtime-core work easier to resume cleanly later
