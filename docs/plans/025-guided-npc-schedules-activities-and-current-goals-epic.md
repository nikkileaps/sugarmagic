# Plan 025: NPC Movement, Schedules, Tasks, Activities, and Current Goals Epic

**Status:** Proposed  
**Date:** 2026-04-06

## Epic

### Title

Add a first-pass core gameplay NPC behavior layer to Sugarmagic so story-support NPCs can move through the world, follow authored schedule tasks, maintain a current activity and current goal, and expose that state to conversation systems without requiring full prop simulation or full GOAP planning.

### Goal

Deliver a directionally-correct first pass for quest-aware NPC world behavior that:

- removes the separate `guided` conversation mode from NPC interaction mode authoring
- keeps conversation mode focused on `scripted` vs `agent`
- introduces a first-class NPC Movement System in `runtime-core`
- allows runtime systems to ask:
  - can this NPC go there?
  - how does this NPC get there?
- lets NPCs move through authored schedule/activity tasks across quest progression
- exposes en-route / at-target state for scheduled NPCs
- gives NPCs a resolved `currentGoal` and `currentActivity`
- uses runtime-core blackboard facts as the live source of truth
- keeps the quest graph as the authored source of required progression
- allows SugarAgent to consume `currentGoal` and `currentActivity` without owning gameplay logic
- avoids premature full simulation of carried props, deliveries, crates, animation state machines, or full GOAP action graphs

## Why this epic exists

Sugarmagic now has:

- a quest graph for authored progression
- a runtime blackboard for live world state
- spatial grounding for current area truth

What it does not yet have is a clean core gameplay layer for quest-aware NPC world behavior.

The earlier `guided` mode idea helped expose this missing architecture, but the behavior itself belongs in core gameplay, not as a separate conversation mode.

Current problem:

- important support NPCs such as Rick Roll should feel like they are living in the world
- they should be influenced by quest stage, current area, and live station activity
- they should not be full scripted quest gates
- they should not behave like unconstrained chatbots with no authored situational role

Example:

- at the start of `Find Suitcase`, an airship has arrived
- Rick Roll should go to the dock to collect his cheese delivery
- then pause in the station courtyard to unpack and inventory it
- later return to his shop
- during this time he can still speak to the player, but his responses should reflect what he is doing and what he currently cares about

We do not need full crate simulation to get this value.

We do need:

- an NPC movement foundation
- authored schedule/activity tasks
- blackboard-backed current world facts
- a resolved current goal for NPCs

## Core recommendation

Implement quest-aware NPC world behavior as a core gameplay layer with this build order:

### 1. NPC Movement System

Before richer guided scheduling or goals, Sugarmagic needs a first-class Movement System.

This system answers:

- can the NPC go there?
- how does the NPC get there?
- is the NPC currently en route?
- has the NPC reached the target?

Recommended first-pass responsibilities:

- accept movement directives such as:
  - `move_to_area`
  - `move_to_position`
  - `move_to_entity`
  - `idle_at_area`
- resolve a simple route/steering path toward the target
- update runtime NPC position over time
- publish blackboard-backed movement state such as:
  - target area/position
  - movement status
  - en-route / at-target

This is not full navmesh or crowd simulation in v1.

But it does own both:

- destination intent
- and first-pass pathfinding/locomotion execution

### 2. Quest graph remains the authored spine

The quest graph owns:

- required progression
- stage boundaries
- objective completion rules
- scripted quest beats
- canonical reveals and gates

Examples:

- `Talk to the Station Manager`
- `Search the Platform`
- `Search the Baggage Claim`
- stage completion and next-stage activation

### 3. Blackboard owns live world truth

The blackboard owns facts that are true right now, such as:

- `airship_arrived`
- `delivery_window_active`
- `player.currentArea`
- `rick.currentArea`
- `rick.currentActivity`
- `rick.currentGoal`
- `platform_searched`
- `baggage_claim_searched`
- `rick.heard_suspicious_scuttling`
- `rick.movementStatus = en_route`
- `rick.targetArea = station_courtyard`

These are runtime facts, not quest progression itself.

### 4. NPC task scheduler resolves where the NPC should be

An NPC task scheduler consumes:

- authored NPC behavior configuration
- current quest stage
- relevant blackboard facts

And resolves:

- the active schedule task
- the target area for that task
- the intended current activity

The movement system then executes toward that target.

The movement system is position-based in v1, not force-based.

This means:

- movement is deterministic and authored-position driven
- the system updates positions directly rather than applying physics forces
- simple push-back / separation handling may exist for player interference
- full rigid-body or force-based locomotion is explicitly out of scope for v1

This means the scheduler decides:

- where the NPC should be now
- what they should generally be doing now

And the movement system decides:

- how they actually get there

### 5. NPC behavior policy resolves current NPC behavior

An NPC behavior policy layer consumes:

- authored NPC behavior configuration
- current quest stage
- relevant blackboard facts
- current spatial truth
- movement state
- active schedule task

And resolves:

- `currentGoal`
- `currentActivity`
- current scheduled area/task
- whether the NPC is `en_route` or `at_target`
- optional conversation guidance stance later

SugarAgent then consumes those resolved facts to shape dialogue.

## Scope

This epic includes:

- Story 0 removal of the separate `guided` conversation mode from NPC interaction mode authoring
- a first-pass `runtime-core` NPC Movement System
- a first-pass authored model for NPC schedule/activity tasks
- runtime-core schedule/task resolution for NPCs
- runtime-core NPC behavior policy resolution
- blackboard fact domains for NPC movement, activity, and goal
- runtime scheduling tied to quest stage and simple authored conditions
- movement status and target state for scheduled NPCs
- SugarAgent consumption of `currentGoal`, `currentActivity`, and movement state when installed/enabled
- UX for authoring behaviors and navigating between quest authoring and behavior authoring
- simple debug output for movement/task/goal changes

## Out Of Scope

This epic does not include:

- full carried-object simulation
- crate prop pickup/dropoff simulation
- animation graphs for inventory handling
- full GOAP action sequence planning
- full utility AI across all NPCs
- production-grade navmesh and crowd avoidance systems
- generalized temporal canon / episode overlay architecture
- complex proactive interruption systems

This epic is the smallest quest-aware NPC world-behavior layer that points in the right architectural direction.

## Interaction mode semantics

### `scripted`

- fully authored dialogue progression
- required for quest progression
- quest graph is the main driver

### `agent`

- free conversation
- grounded by lore and runtime context
- when SugarAgent is installed and enabled, agent conversations may consume core gameplay behavior state such as current goal, activity, area, and movement status

### Explicit rule

- drop the separate `guided` conversation mode from NPC interaction mode authoring
- keep quest-aware world behavior in core gameplay
- let `agent` conversation consume that state when SugarAgent is available

## Source-of-truth split

### Quest graph

Use quest graph state for:

- authored stage progression
- objective activation/completion
- required dialogue beats
- canonical progression gates

### Blackboard

Use blackboard state for:

- live world facts this moment
- NPC current area/activity/goal
- delivery windows and temporary scene conditions
- search progress facts mirrored for system use
- witnessed suspicious events

### Explicit rule

Do not use the blackboard as the primary owner of quest progression.

Do not encode every temporary world behavior as a quest node.

Quest graph defines story progression.

Blackboard defines what is true right now in the simulation.

## First-pass authored model

Recommended first-pass shape:

```ts
type NpcMovementStatus = "idle" | "en_route" | "at_target" | "blocked";

type NpcCurrentGoal =
  | "idle"
  | "travel_to_delivery"
  | "collect_delivery"
  | "unpack_delivery"
  | "return_to_shop"
  | "run_shop"
  | "help_player"
  | "redirect_player";

type NpcCurrentActivity =
  | "idle"
  | "walking"
  | "waiting"
  | "collecting_delivery"
  | "unpacking_inventory"
  | "serving_customers"
  | "chatting";

interface NpcTaskCondition {
  questId?: string | null;
  stageId?: string | null;
  worldFlagEquals?: {
    key: string;
    value: string | boolean | number;
  } | null;
}

interface NpcScheduleTask {
  taskId: string;
  displayName: string;
  description?: string | null;
  targetAreaId: string | null;
  currentActivity: NpcCurrentActivity;
  when: NpcTaskCondition[];
}

interface NpcBehaviorDefinition {
  npcDefinitionId: string;
  tasks: NpcScheduleTask[];
  defaultGoal: NpcCurrentGoal;
}
```

Notes:

- this is task-based, not action-graph-based
- task resolution should be deterministic and easy to debug
- movement directives should remain separate from task resolution
- later systems can grow from this into richer directed GOAP if needed

## Runtime-core implementation shape

Recommended first-pass subsystems:

- `createNpcMovementSystem(...)`
- `createNpcScheduleSystem(...)`
- `createNpcBehaviorSystem(...)`

### `createNpcMovementSystem(...)`

Responsibilities:

- receive movement directives for NPCs
- resolve simple movement toward target area, target position, or target entity
- publish movement facts:
  - target
  - movement status
  - reached target or not
- update runtime positions
- expose enough state for schedule systems and dialogue grounding

Directive observer rule:

- the movement system must treat directives as stateful desired-target input, not as fire-and-forget impulses
- if the scheduler keeps publishing the same directive every update tick, the movement system must not restart locomotion
- locomotion should only start, retarget, or replan when the effective directive meaningfully changes

At minimum, directive change detection should compare:

- target kind
- target area id
- target entity id
- target position, with a small positional tolerance

If the effective target is unchanged:

- keep the current locomotion task running
- do not reset path progress
- do not restart walk animations or movement timers

Blocked-state rule:

- if an NPC remains `en_route` but fails to make meaningful positional progress for a configured duration, the movement system must publish `movementStatus = blocked`
- blocked movement should also publish a failure reason such as `stuck` or `unreachable`
- higher-level systems may then choose a recovery policy such as retry, idle in place, or explicit teleport fallback if allowed
- the movement system itself should not silently teleport by default

### `createNpcScheduleSystem(...)`

Responsibilities:

- read active quest/stage
- read relevant blackboard facts
- evaluate schedule tasks for NPCs
- publish resolved schedule state:
  - active task
  - target area
  - intended current activity
- issue movement directives to the movement system

### `createNpcBehaviorSystem(...)`

Responsibilities:

- read active quest/stage
- read relevant blackboard facts
- read schedule state
- read movement state
- publish resolved facts:
  - `entity.current-goal`
  - `entity.current-activity`
  - `entity.scheduled-area`
  - `entity.movement-status`
- emit debug logs when goal/activity changes

This system belongs in `runtime-core`.

SugarAgent consumes its outputs.

SugarAgent does not own movement, scheduling, or NPC goal resolution.

## Blackboard facts

Recommended first pass:

```ts
interface EntityMovementStateFact {
  entityId: string;
  movementStatus: "idle" | "en_route" | "at_target" | "blocked";
  targetAreaId: string | null;
  failureReason: "stuck" | "unreachable" | null;
}

interface EntityCurrentGoalFact {
  entityId: string;
  goal:
    | "idle"
    | "travel_to_delivery"
    | "collect_delivery"
    | "unpack_delivery"
    | "return_to_shop"
    | "run_shop"
    | "help_player"
    | "redirect_player";
}

interface EntityCurrentActivityFact {
  entityId: string;
  activity:
    | "idle"
    | "walking"
    | "waiting"
    | "collecting_delivery"
    | "unpacking_inventory"
    | "serving_customers"
    | "chatting";
}

interface SceneEventFact {
  key: string;
  value: boolean | string | number;
}
```

Examples:

- `scene.airship-arrived = true`
- `scene.delivery-window = true`
- `entity.movement-state(rick) = { movementStatus: "en_route", targetAreaId: "dock" }`
- `entity.current-goal(rick) = unpack_delivery`
- `entity.current-activity(rick) = unpacking_inventory`

## First-pass runtime behavior model

Do not simulate crates yet.

Instead, simulate believable world participation through:

- movement directives and movement state
- schedule task
- target area
- current activity
- current goal

Example for Rick Roll in Quest Stage 1:

### Task A

- target area: `dock`
- activity: `collecting_delivery`
- condition: `airship_arrived = true`
- movement system moves Rick to `dock`
- behavior system resolves:
  - `currentGoal = collect_delivery`
  - `movementStatus = en_route` until arrival

### Task B

- target area: `station_courtyard`
- activity: `unpacking_inventory`
- condition: `delivery_collected = true`
- movement system moves Rick to `station_courtyard`
- behavior system resolves:
  - `currentGoal = unpack_delivery`
  - `movementStatus = at_target` once there

### Task C

- target area: `cheese_shop`
- activity: `serving_customers`
- condition: `quest.find_suitcase.stage = stage_2`
- movement system moves Rick to `cheese_shop`
- behavior system resolves:
  - `currentGoal = run_shop`

This gives us the feeling of a living schedule without full object logistics.

## SugarAgent integration

SugarAgent should consume the blackboard outputs of the NPC behavior system when the plugin is installed and enabled.

First-pass usage:

- `currentGoal`
- `currentActivity`
- current area / parent area
- tracked quest/stage
- movement status
- target area

These should inform:

### Plan

- what kind of answer the NPC should prefer
- whether to help, redirect, or stay on task
- whether to keep the answer short because the NPC is busy
- whether to mention being on the way somewhere or already there

### Generate

- phrase the response consistently with the NPC's current goal and activity

Examples:

- `currentGoal = unpack_delivery`
- `currentActivity = unpacking_inventory`
- `movementStatus = at_target`

Rick can say:

- `I'm sorting through my cheese delivery right now.`
- `My shop's just inside the station, but I'm unpacking stock out here at the moment.`
- `I'm on my way back inside with the rest of the stock.` when `movementStatus = en_route`

### Explicit rule

SugarAgent may use guided facts to shape dialogue.

SugarAgent must not become the system that decides the NPC's schedule or current goal.

## UX and Authoring Flow

The designer-facing workflow should be:

### 1. Build > Spatial

Author semantic areas such as:

- Dock
- Station Courtyard
- Station
- Cheese Shop
- Platform
- Baggage Claim

These areas become the valid movement and schedule targets.

### 2. Design > NPC

Author the NPC's identity and conversation mode.

UX rules:

- `Scripted` is always available
- `Agent` appears when SugarAgent is installed/enabled
- `Guided` should not appear as a separate conversation mode
- quest-aware world behavior is not authored here as a conversation toggle

### 3. Build > Behavior

Author world behavior for NPCs in a dedicated behavior workspace.

Recommended layout:

- left panel: NPC behavior list for the current region
- center panel: ordered task list/behavior track for the selected NPC
- right panel: inspector for the selected task

For each task, the inspector should expose:

- task name
- task description for richer conversational/debug context
- target area
- current activity
- activation conditions

Activation conditions should prefer structured controls such as:

- quest
- stage
- objective completion
- previous task complete
- world flag

### 4. Quest Graph Interlinking

Quest authoring and behavior authoring should link to one another.

In quest authoring:

- if a quest stage or objective is referenced by one or more behavior tasks, show a small linked-behaviors affordance
- a popover or inspector section may list those linked behavior tasks as clickable links

In behavior authoring:

- if a task is driven by a quest/stage/objective, show a clickable link back to that quest location
- the quest/stage dependency should be visible in the inspector, not hidden in opaque condition text

### 5. Preview / Debug

When previewing or inspecting an NPC, the system should make it easy to understand:

- current task
- current goal
- current activity
- movement status
- target area
- which quest/stage is driving the current task

This is important so the designer can understand why the NPC is where they are and why they are speaking the way they are.

## Debugging

First-pass debugging is required.

Recommended logs:

- `[runtime-core] npc-movement-target-changed`
- `[runtime-core] npc-movement-status-changed`
- `[runtime-core] npc-movement-directive-ignored` for duplicate unchanged directives in debug mode
- `[runtime-core] npc-movement-blocked`
- `[runtime-core] npc-task-changed`
- `[runtime-core] npc-goal-changed`
- `[runtime-core] npc-activity-changed`

Recommended payload:

- `entityId`
- `phaseId`
- `movementStatus`
- `currentGoal`
- `currentActivity`
- `targetAreaId`
- `questId`
- `stageId`

A later visual debug surface is desirable but not required for v1.

## Acceptance criteria

This epic is complete when:

- NPCs can receive and execute first-pass movement directives
- duplicate unchanged movement directives do not restart locomotion every frame
- blocked movement produces an observable failure state instead of hanging forever
- runtime-core exposes whether an NPC is en route, at target, or blocked
- NPCs have an authored task-based behavior definition
- runtime-core resolves an NPC's active task from quest + blackboard facts
- runtime-core writes current goal and current activity into the blackboard
- NPC positions/areas shift through movement system execution rather than instant teleport-only behavior
- if SugarAgent is enabled, agent conversations can read and use `currentGoal`, `currentActivity`, and movement status
- the game still runs correctly without SugarAgent enabled
- scripted NPC behavior remains quest-authoritative and unchanged
- `guided` no longer appears as a separate NPC conversation mode in authoring UI
- logs make it easy to verify movement, task, goal, activity, and blocked transitions

## Verification scenarios

### Rick Roll delivery flow

- airship arrival is active
- Rick receives a movement target for the dock
- Rick moves toward and reaches the dock
- later receives a movement target for the courtyard
- later resolves to `unpack_delivery` in the courtyard
- later receives a movement target for the cheese shop
- later resolves to `run_shop` in the cheese shop

### Conversation grounding

While Rick is in the courtyard unpacking:

- he can still identify his shop correctly as nearby/inside the station
- he can mention that he is currently unpacking stock
- he does not claim he is currently inside the shop if blackboard says otherwise

### Quest separation

- Station Manager remains scripted and drives the required quest beat
- Rick remains a core-gameplay scheduled NPC and can still use `agent` conversation when SugarAgent is available without becoming a required scripted gate

## Follow-up work

Likely future epics:

- richer pathfinding and navigation polish
- temporal canon / episode overlays for authored time-scoped truth
- richer guided disclosure/hint policies
- proactive guided NPC initiation
- visual debug overlays for guided schedules
- optional prop/animation simulation layered on top of the same task model

## Story order

Recommended implementation order:

### Story 0. Drop `guided` Conversation Mode

Remove `guided` as a distinct NPC interaction mode from authoring and runtime conversation selection.

UX expectations:

- in the NPC workspace, interaction mode should present only `Scripted` and, when SugarAgent is installed/enabled, `Agent`
- any existing `guided` NPC records should migrate cleanly to `agent` conversation mode while preserving authored behavior data
- core gameplay NPC behavior systems must remain available regardless of SugarAgent installation

### Story 1. NPC Movement System

Build the first-pass `runtime-core` Movement System.

### Story 2. NPC Schedule System

Build deterministic task scheduling on top of quest graph + blackboard facts.

UX expectations:

- add a dedicated `Build > Behavior` workspace for authoring scheduled NPC behavior
- left panel shows NPC behaviors in the current region
- center panel shows an ordered task list/track for the selected NPC
- right inspector edits the selected task
- selected task should support a richer `Task Description` field for SugarAgent/debug context
- task conditions should use structured quest/stage controls first, not raw blackboard key entry as the default UX

### Story 3. NPC Goal / Activity Resolution

Resolve `currentGoal` and `currentActivity` from schedule state and live facts.

UX expectations:

- behavior inspector should show current goal/activity fields in human terms
- current task should clearly surface its quest/stage driver when applicable
- task description should be authored as freeform descriptive text, but it should not become a deterministic blackboard key/value used for gameplay comparisons

### Story 4. SugarAgent Agent Consumption

Teach SugarAgent `agent` conversations to use:

- `currentGoal`
- `currentActivity`
- `movementStatus`
- `targetArea`

for NPC turns when the plugin is installed and enabled.
