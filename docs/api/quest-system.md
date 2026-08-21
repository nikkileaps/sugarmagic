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

A quest is a **linear chain of stages**, each containing a graph of **nodes**.
`nextStageId` is a single nullable pointer, so a stage has exactly one
successor -- branching happens between nodes inside a stage, not between
stages. When every non-optional node in a stage is complete the stage
completes and the runtime advances to `nextStageId`; a null pointer completes
the quest.

### Stage

```
QuestStageDefinition
  stageId: string
  displayName: string           -- shown in journal; injected into NPC prompts
  nextStageId: string | null    -- null = quest completes after this stage
  nodeDefinitions: QuestNodeDefinition[]
  entryNodeIds: string[]        -- nodes activated when stage starts
  timeOfDay: TimeOfDayBand|null -- set on the world clock when the stage
                                   becomes active; null leaves it alone
  groups: NodeGroup[]?          -- editor layout only, never read at runtime;
                                   see domain-model.md
```

A stage may legitimately have no nodes. It is then complete the moment it
starts, and the quest moves straight on to `nextStageId`. A next-stage loop made
only of empty stages would never settle, so the runtime stops advancing on
re-entering a stage and the quest editor reports the loop as a warning.

A stage is usually a scene at a time -- "the dock, late afternoon" -- so the
time rides the stage rather than an action on whichever node happens to run
first. Set in Studio at Design -> Quest -> select a stage -> **Time of Day**;
the dropdown offers Morning / Noon / Afternoon / Evening / Night (Noon stores
`midday`). `dawn` and `dusk` are valid bands but are only reachable through the
`set-time-of-day` action. Re-entering a stage re-asserts its time.

### Node

```
QuestNodeDefinition
  nodeId: string
  displayName: string
  description: string
  nodeBehavior: "objective" | "narrative" | "condition" | "branch"
  objectiveSubtype?: "talk" | "location" | "collect" | "castSpell" | "assessment" | "custom"
  narrativeSubtype?: "voiceover" | "dialogue" | "cutscene"
  targetId?: string             -- NPC id for talk; item id for collect; spell id for castSpell
  targetAreaId?: string         -- the area a location objective completes on
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

### Objective subtypes

| subtype | completes when | needs |
|---|---|---|
| `talk` | the player finishes that NPC's dialogue | `targetId` (NPC), `dialogueDefinitionId` |
| `location` | the player enters the target area, or any area nested inside it | `targetAreaId` |
| `collect` | the player holds `count` of the item | `targetId` (item), `count` |
| `castSpell` | the player casts that spell | `targetId` (spell) |
| `assessment` | the player completes the assessment form | plugin-supplied |
| `awaitEvent` | a matching `emitEvent` action fires the node's `eventName` | `eventName` |

`awaitEvent` is the subtype with no built-in completion path: it waits for a
named quest event, set on the node as `eventName` and fired by any node's
`emitEvent` action. Plugins use the same channel -- sugarlang stamps
`SUGARLANG_PLACEMENT_COMPLETED_EVENT` onto an assessment objective and fires it
when placement finishes.

### Narrative subtypes

| subtype | what happens |
|---|---|
| `dialogue` | the dialogue starts on its own the moment the node activates, then the node completes when it ends |
| `voiceover` | **nothing yet.** Activates and completes in the same tick |
| `cutscene` | **nothing yet.** Activates and completes in the same tick |

A `dialogue` narrative differs from a `talk` objective in who starts it: a talk
objective waits for the player to walk up to an NPC and interact, while a
dialogue narrative opens the conversation with nobody nearby and no press.

---

## Actions or behavior tasks: which one

Two systems can make the world change when a quest moves, and picking the wrong
one is the most common way to author something that half works. The difference
is **momentary versus continuous**.

**An action fires once, at a moment.** `executeActions` runs a node's list when
the node activates or completes, and that is the whole life of it. Nothing
remembers it happened.

**A behavior task is re-decided every frame.** `resolveBehaviorTask` walks an
NPC's task list every sync and picks the first whose activation matches. It is
not an instruction that was issued; it is the answer to "what is this NPC doing
right now", asked again continuously.

So the test is: **does this need to still be true in ten minutes?**

| | |
|---|---|
| A sound plays, an item is given, the day advances, a one-shot animation runs | Moments. **Actions.** |
| An NPC stands at the well, walks to the dock, keeps a post | Ongoing. **Behavior tasks.** |
| An NPC is in the scene at all | Ongoing. **Presence conditions** on the placement. |

This is why there is no `moveNpc` action. As an action it would fire once and be
forgotten: the NPC would start walking with nothing holding the intent, and a
reload would lose it. The task selector already answers "where should this NPC
be" every frame, and it survives saving, blocking and leaving the region,
because it re-derives the answer rather than remembering an instruction.

**How the two halves meet.** Node completion is a moment, but behavior tasks
need continuous truths. So the moment is recorded permanently -- see
`completedNodeIds` under Save and Persistence -- and the continuous system reads
it as a standing fact. That is what lets a task bound to "after quest X node Z"
keep holding after the quest has finished.

---

## Quest Actions

`QuestActionDefinition` is a discriminated union on `type`. Each action declares
its own named fields -- there is no shared `targetId` or `value` carrying a
different meaning per type.

**Every action in this table does something.** An action that cannot be routed
to a real system is not offered.

| type | fields | what it does |
|---|---|---|
| `setFlag` | `key`, `value?` | writes a world flag via QuestManager |
| `emitEvent` | `eventName` | fires a named event; completes any active node waiting on it |
| `giveItem` | `itemDefinitionId`, `count` | adds items to the player inventory |
| `removeItem` | `itemDefinitionId`, `count` | removes items from the inventory |
| `unlockScene` | `sceneId` | adds the Scene to campaign progression |
| `advanceToNextScene` | `sceneId` (null = next by order) | completes the Scene and moves the player |
| `set-time-of-day` | `band` | sets the world clock band (persisted) |
| `advance-day` | -- | increments the world day counter (persisted) |
| `learn-fact` | `factId`, `displayText` | writes a player-known fact (see below) |
| `playCue` | `cueDefinitionId` | plays a sound cue, keyed per node |
| `playAnimation` | `npcDefinitionId`, `slot`, `repeatCount` | plays one of the NPC's bound animation slots, on every presence of that NPC, then returns it to locomotion |

An unknown cue is reported once per cue id with the quest and node that named
it. A missing reference on any action is skipped rather than guessed at.

### Actions this list deliberately does not have

- **Playing a world-space effect.** There is no effect system to route one to.
- **Moving or teleporting an NPC.** Staging is the behavior system's: give the
  NPC a task with a target area and an activation. To put an NPC somewhere with
  no journey, place it twice and condition each placement.
- **Flipping an NPC between scripted and agentified.** #207 gives that a
  purpose-named action.
- **A `custom` escape hatch.** No plugin contribution kind is a quest action
  handler, so there is nothing to escape to; `emitEvent` covers firing a named
  thing for something else to react to.

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
   player enters the volume (see API 006). Being replaced by volume enter/exit
   action lists -- #216.
5. Dev console: `__smsetflag("myFlag", true)` (see Dev Handles below).

**How they gate behavior:**

`RegionBehaviorQuestBinding` is the compound AND condition, and it is the one
grammar shared by everything that gates on quest state: behavior tasks
(`activation`), NPC placements (`condition`), and containment volumes
(`condition`). One evaluator serves all of them --
`evaluateRegionQuestBinding` in `runtime-core/src/region-conditions`.

```typescript
interface RegionBehaviorQuestBinding {
  questDefinitionId: string | null
  questStageId: string | null
  worldFlagEquals: { key: string | null; valueType: "boolean"|"number"|"string"; value: string | null } | null
  nodeCompleted?: { questDefinitionId: string; nodeId: string } | null
}
```

All populated clauses are ANDed. Any field left null is not checked.
- Quest active on stage X only: set `questDefinitionId` + `questStageId`, leave the rest null.
- Flag set regardless of quest: set `worldFlagEquals`, leave quest fields null.
- After a story beat: set `nodeCompleted`. It stays satisfied once that node has
  completed, including after its quest finishes and across save and load.

**Two things worth knowing.** The quest and stage clauses are checked against
the SAME quest -- one active quest supplying the id and a different one
supplying the stage does not satisfy a binding neither satisfies. And bindings
evaluate against EVERY quest in progress, not the one the player has selected in
their journal; which NPCs stand where is not a display choice.

An unanswerable clause fails closed. A populated clause whose predicate is
absent evaluates false rather than being skipped.

---

## NPC Behavior Tasks

### Staging an NPC after a story beat

NPC staging is authored as a quest-bound behavior task, not as a quest action.
Two grains:

- **Stage grain** -- set `questDefinitionId` and `questStageId` on the task's
  activation. The NPC takes that task while the quest sits on that stage.
- **Node grain** -- set `nodeCompleted`. The NPC takes that task once that
  specific node completes, and keeps it afterwards, including once the quest
  has finished.

To place an NPC somewhere with no journey at all, place it twice in the region
and condition each placement instead. That is presence rather than movement:
the placement whose condition fails is not spawned.

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
{ "type": "set-time-of-day", "band": "morning" }
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
{ "type": "learn-fact", "factId": "luggage:went-to-claim", "displayText": "The harbourmaster confirmed unclaimed baggage goes to the claim office after 24 hours." }
```

- `factId` is the dedup key. Learning the same id again replaces the old
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
2. On that node's `onCompleteActions`: `{ type: "setFlag", key: "talkedToNpcA", value: true }`.
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
   found, etc.): `{ type: "learn-fact", factId: "clue:dock-manifest", displayText: "The dock manifest shows a trunk shipped to warehouse 4." }`.
2. Every subsequent NPC conversation gets the player-known-facts block.
3. NPCs can reference the clue, ask about it, confirm it -- without you
   scripting each response. The NPC knows the player already has this
   information.

### Pattern D: Inject world clock context into a quest beat

```json
[
  { "type": "advance-day" },
  { "type": "set-time-of-day", "band": "morning" }
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
| Quest manager state (flags, active quests, completed quests, completed nodes) | `quest.manager` | yes |
| World clock (band + day) | `world.time` | yes |
| Player known facts | `player.known-facts` | yes |
| Recent world events | -- | no (session-only) |

All save participants restore before `startInitialQuests()` is called.

### completedNodeIds

Node progress lives inside `activeQuests`, which is deleted the moment a quest
finishes. So "node Z was completed" is recorded separately, per quest, at the
moment it completes -- outside the state that gets torn down. That is what makes
a `nodeCompleted` activation still true after its quest is over.

It is never cleared. Nothing restarts a quest: `startQuest` refuses any quest
already in `completedQuestIds`. On restore it replaces rather than merges, which
is safe because deserialize runs before `startInitialQuests`, so nothing has
recorded a completion yet. A save written before the field existed restores as
empty.

It holds ids only, no timestamps -- there is nothing in it that looks stale
after a reload.

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
