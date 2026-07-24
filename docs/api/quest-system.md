# API 010: Quest System

Quest definitions, world flags, NPC behavior schedules, world clock, and
player-known facts. This document covers the authoring surface and runtime
contracts. For how quest state feeds NPC prompts, see API 008.

---

## Quest Definition Shape

**Package:** `@sugarmagic/domain`
**File:** `packages/domain/src/quest-definition/index.ts`

```
QuestDefinition
  definitionId: string
  displayName: string
  description: string
  startStageId: string
  stageDefinitions: QuestStageDefinition[]
  rewardDefinitions: QuestRewardDefinition[]
  repeatable: boolean
```

Quests are a directed graph of **stages**, each containing a graph of
**nodes**. The runtime works through nodes bottom-up; when all non-optional
nodes in a stage are complete the stage completes and the runtime advances to
`nextStageId`.

### Stage

```
QuestStageDefinition
  stageId: string
  displayName: string           -- shown in journal; injected into NPC prompts
  nextStageId: string | null    -- null = quest completes after this stage
  nodeDefinitions: QuestNodeDefinition[]
  entryNodeIds: string[]        -- nodes activated when stage starts
```

### Node

```
QuestNodeDefinition
  nodeId: string
  displayName: string
  description: string
  nodeBehavior: "objective" | "narrative" | "condition" | "branch"
  objectiveSubtype?: "talk" | "location" | "collect" | "trigger" | "castSpell" | "custom"
  narrativeSubtype?: "voiceover" | "dialogue" | "cutscene" | "event"
  targetId?: string             -- NPC id for talk; area id for location; item id for collect
  count?: number                -- collect count
  optional?: boolean
  dialogueDefinitionId?: string -- for talk / dialogue nodes
  completeOn?: "dialogueEnd" | string
  autoStart?: boolean           -- activates without waiting for prerequisiteNodeIds
  prerequisiteNodeIds: string[]
  failTargetNodeIds: string[]
  condition?: QuestConditionDefinition
  onEnterActions: QuestActionDefinition[]
  onCompleteActions: QuestActionDefinition[]
  showInHud: boolean
```

`onEnterActions` fire when the node becomes active. `onCompleteActions` fire
when the node completes (player finished the dialogue, reached the location,
etc.). Both accept any `QuestActionType` list -- this is the primary authoring
surface for all scripted world changes.

---

## Quest Actions

`QuestActionDefinition` has three fields: `type`, optional `targetId`, optional `value`.

| type | targetId | value | what it does |
|---|---|---|---|
| `setFlag` | flag key | flag value (any JSON) | writes a world flag via QuestManager |
| `giveItem` | item definition id | -- | adds item to player inventory |
| `removeItem` | item definition id | -- | removes from inventory |
| `playSound` | audio cue id | -- | plays a sound |
| `spawnVfx` | vfx definition id | -- | spawns a VFX |
| `teleportNpc` | NPC definition id | -- | teleports NPC (stub) |
| `moveNpc` | NPC definition id | -- | moves NPC (stub) |
| `setNpcState` | NPC definition id | -- | NPC state change (stub) |
| `emitEvent` | event name | -- | emits a named event |
| `unlockScene` | scene id | -- | adds scene to campaign progression |
| `advanceToNextScene` | scene id or omit | -- | advances to named scene or next by order |
| `set-time-of-day` | `TimeOfDayBand` value | -- | sets world clock band (persisted) |
| `advance-day` | -- | -- | increments world day counter (persisted) |
| `learn-fact` | fact id (dedup key) | display string | writes a player-known fact (see below) |
| `custom` | any | any | no-op in runtime; use for future or plugin extensions |

**Stubs:** `teleportNpc`, `moveNpc`, `setNpcState` are authored but not yet
implemented in the runtime; they are no-ops. See task #374.

---

## World Flags

World flags are `string -> unknown` pairs managed by `QuestManager`. They
persist across sessions (serialized in the quest save slice).

**How they get set:**

1. `setFlag` quest action on any node's `onEnterActions` or `onCompleteActions`.
2. A scripted dialogue Talk node: when `questManager.notifyDialogueFinished`
   fires, the runtime auto-completes the Talk node and fires its
   `onCompleteActions` -- the `setFlag` action in that list runs.
3. An agentified NPC turn: PlanStage can emit `{ kind: "set-conversation-flag",
   key, value }` -> `handleConversationActionProposal` -> `questManager.setFlag`.
4. A trigger volume: `RegionVolumeTriggerAction.setWorldFlag` fires when the
   player enters the volume (see API 006).
5. Dev console: `__smsetflag("myFlag", true)` (see Dev Handles below).

**How they gate behavior:**

`RegionBehaviorQuestBinding` is the compound AND condition used by behavior
tasks and (in future) NPC presence:

```typescript
interface RegionBehaviorQuestBinding {
  questDefinitionId: string | null
  questStageId: string | null
  worldFlagEquals: { key: string | null; valueType: "boolean"|"number"|"string"; value: string | null } | null
}
```

All three fields are ANDed together. Any field left null is not checked.
Examples:
- Quest active on stage X only: set `questDefinitionId` + `questStageId`, leave flag null.
- Flag set regardless of quest: set `worldFlagEquals`, leave quest fields null.
- Compound (quest stage AND flag): set all three.

---

## NPC Behavior Tasks

**Domain:** `RegionNPCBehaviorTask` in `packages/domain/src/region-authoring/index.ts`
**Runtime:** `packages/runtime-core/src/behavior/system.ts`
**Studio:** Behavior inspector, Tasks section

Each NPC entity in a region can have a list of tasks. Each frame the runtime
resolves the first task whose `activation` AND `timeWindow` both match the
current world state.

```typescript
interface RegionNPCBehaviorTask {
  taskId: string
  displayName: string
  description: string | null
  targetAreaId: string | null   -- area the NPC should be near
  currentActivity: string       -- e.g. "tending the stall", "idle"
  currentGoal: string           -- e.g. "serve customers before noon"
  activation: RegionBehaviorQuestBinding
  timeWindow?: { bands: TimeOfDayBand[] } | null
}
```

**Activation:** Tasks are ordered; the first matching task wins. If no task
matches, the NPC gets `taskId: null` and `currentActivity: "idle"`.

**Default task:** A task with all activation fields null always matches
(provided its `timeWindow` also matches) and serves as the NPC's
unconditional baseline.

**Time window:** When `timeWindow` is set with a non-empty `bands` array, the
task is skipped if the current `world.time-of-day` band is not in the array.
Null or empty `bands` = any time.

**NPC prompt injection:** The resolved task's `displayName`, `description`,
`currentActivity`, and `currentGoal` all flow into the agentified NPC's
uncached user prompt block (see API 008 for the full prompt seam).

**Studio:** Author tasks in the Behavior inspector. "Active Time Window" is a
multi-select of the 7 bands. Leave blank for any time.

---

## World Clock

**Domain:** `TimeOfDayBand` in `packages/domain/src/quest-definition/index.ts`
**Runtime store:** `packages/runtime-core/src/world/time-store.ts`
**Save participant:** `packages/runtime-core/src/world/worldTimeSaveParticipant.ts`

```typescript
type TimeOfDayBand =
  | "dawn" | "morning" | "midday" | "afternoon"
  | "dusk" | "evening" | "night"
```

The world clock has two values: a `TimeOfDayBand` and an integer day counter
(1-indexed). Both persist across sessions.

**Setting the clock via quest actions:**

```json
{ "type": "set-time-of-day", "targetId": "morning" }
{ "type": "advance-day" }
```

`set-time-of-day` sets the band. `advance-day` increments the day counter by
1 (band is unchanged). Both actions dispatch through the existing quest action
chain; no special wiring needed. To advance the day and set a specific band,
author them as two sequential actions (see Pattern D).

**Runtime blackboard facts:**

- `world.time-of-day` (`WorldTimeOfDayFact`) -- the current band; session
  lifecycle (updated on band change, not each tick).
- `world.day` (`WorldDayFact`) -- the current day counter; session lifecycle.

**NPC prompt injection:** Each NPC turn reads `world.time-of-day` from the
blackboard and injects `"Time of day: morning."` into the uncached user block.

**Behavior task gating:** `taskMatchesActivation` in `behavior/system.ts`
checks `timeWindow.bands.includes(currentTimeBand)` before resolving a task.

**No wall-clock timestamps.** The clock is purely authored/event-driven --
`set-time-of-day` on a quest action, not `Date.now()`. The save participant
stores the band and day as strings/integers, never epoch milliseconds.

---

## Player Known Facts

**Store:** `packages/runtime-core/src/world/playerKnownFactsStore.ts`
**Save participant:** `packages/runtime-core/src/world/playerKnownFactsSaveParticipant.ts`
**Blackboard fact:** `player.known-facts` (key `PLAYER_KNOWN_FACTS_FACT`)

Facts are things the player has explicitly discovered and that NPCs should
be aware they already know. They persist across sessions.

**Authoring: `learn-fact` quest action**

```json
{ "type": "learn-fact", "targetId": "luggage:went-to-claim", "value": "The harbourmaster confirmed unclaimed baggage goes to the claim office after 24 hours." }
```

- `targetId` is the dedup key. Learning the same id again replaces the old
  text and moves it to the end of the list (most-recently-learned order).
- `value` is the display string injected into NPC prompts.
- Cap: 20 facts (oldest dropped first).

**NPC prompt injection** (uncached user block):

```
The player already knows:
- The harbourmaster confirmed unclaimed baggage goes to the claim office after 24 hours.
- ...
```

The block is omitted when no facts exist. NPCs reading this block can skip
re-explaining what the player already established, and can build on it.

**Persistence:** `PLAYER_KNOWN_FACTS_PARTICIPANT_ID = "player.known-facts"`,
schema version 1. Restored by the save system before `startInitialQuests()`.

---

## Recent World Events

**Collector:** `packages/runtime-core/src/world/recentEventCollector.ts`

Session-only (not persisted). Captures notable things that happened since the
last load/restore:

| source | format |
|---|---|
| Quest stage advances | `Quest 'Display Name' stage 'Stage Name' reached.` |
| Quest completions | `Quest 'Display Name' completed.` |
| Day advances | `Day advanced to 3.` |

Cap: 10 events (oldest dropped). Empty at the start of each session.

`quest-start` and `objective-complete` events are NOT captured -- those are
player-private quest progress, not public world facts.

**NPC prompt injection** (uncached user block):

```
Recent world events:
- Quest 'The Lost Luggage' stage 'Check baggage claim' reached.
- Day advanced to 2.
```

Omitted when empty. NPCs can react to things that just happened in the world
without requiring the author to script specific dialogue responses.

---

## Authoring Patterns

### Pattern A: NPC B reacts only after player talked to NPC A

1. NPC A has a scripted Talk node bound to a quest Talk objective.
2. On that node's `onCompleteActions`: `{ type: "setFlag", targetId: "talkedToNpcA", value: true }`.
3. NPC B (agentified). In their task list, add a task with:
   - `activation.worldFlagEquals = { key: "talkedToNpcA", valueType: "boolean", value: "true" }`
4. When the compound holds, NPC B's task drives their behavior; otherwise they
   are behaviorally neutral (default task or idle).

### Pattern B: NPC only available in the morning

1. Add a task for the NPC with `timeWindow: { bands: ["dawn", "morning", "midday"] }`.
2. Add a second task (the baseline) with no `timeWindow` and a description
   like "off duty" or "resting".
3. The runtime resolves the morning task during those hours; the baseline
   applies at all other times.

### Pattern C: Player learns a clue, future NPCs build on it

1. On the quest node where the player gets the clue (dialogue complete, item
   found, etc.): `{ type: "learn-fact", targetId: "clue:dock-manifest", value: "The dock manifest shows a trunk shipped to warehouse 4." }`.
2. Every subsequent NPC conversation gets the player-known-facts block.
3. NPCs can reference the clue, ask about it, confirm it -- without you
   scripting each response. The NPC knows the player already has this
   information.

### Pattern D: Inject world clock context into a quest beat

```json
[
  { "type": "advance-day" },
  { "type": "set-time-of-day", "targetId": "morning" }
]
```

Fire these on a stage-entry or scene-advance to advance the narrative clock.
All NPCs in the next scene will be in their morning schedules and their
prompts will say `"Time of day: morning."`. A new `"Day advanced to N."` event
appears in the recent-events block for that session.

---

## Dev Inspection Handles

Available in the preview console when a game session is active.

```javascript
// Print current quest flags, active/completed quests
__smquestDebug()

// Also show a specific NPC's resolved behavior task
__smquestDebug("npc:definition-id")
// Returns: { runtimeFlags, activeQuests, completedQuestIds, npcTask }

// Force-set a world flag (bypasses dialogue, for testing behavior gating)
__smsetflag("talkedToDockWorker", true)
__smsetflag("talkedToDockWorker")  // omit value -> defaults to true

// Quest-context NPC prompt inspection (API 008)
__sugaragentQuestContext.dump()
__sugaragentQuestContext.dump("npc:definition-id")
```

**File:** `targets/web/src/runtimeHost.ts` (`smQuestDebug`, `smSetFlag`).

---

## Save and Persistence

| what | participant id | persists |
|---|---|---|
| Quest manager state (flags, active quests, completed) | `quest.manager` | yes |
| World clock (band + day) | `world.time` | yes |
| Player known facts | `player.known-facts` | yes |
| Recent world events | -- | no (session-only) |

All save participants restore before `startInitialQuests()` is called.

---

## Cross-References

- **API 008** -- how quest state (tracked quest, world context, goal-surfaced
  count) reaches agentified NPC prompts via the quest-context middleware.
- **API 006** (Collision & Navigation) -- trigger volume `setWorldFlag` action,
  which writes world flags on player entry.
- **`packages/runtime-core/src/quest/QuestManager.ts`** -- the runtime
  coordinator; manages active quests, flags, stage transitions, and events.
- **`packages/runtime-core/src/behavior/system.ts`** -- `resolveBehaviorTask`,
  `taskMatchesActivation`, time-window + activation evaluation.
