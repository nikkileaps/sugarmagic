# Sugarmagic Domain Model

Status: active
Last verified against code: 2026-08-18

How the core sugarmagic entities fit together. This covers the core product
only -- the sugarlang plugin has its own model at
`packages/plugins/src/catalog/sugarlang/docs/api/domain-model.md`, and the
same separation applies to every plugin: core declares interfaces, plugins
supply implementations.

Deliberately not a module diagram. If this document and the code disagree,
the code is right and this is stale. Depth is uneven on purpose: the
gameplay and runtime clusters are documented to the field level because they
were verified line-by-line; the content and region clusters are documented
to the entity level.

---

## What sugarmagic is

One application where the authored region is the runtime region. Studio (the
authoring front end) and the shipped game are two front ends over the same
core packages: `domain` is the pure data model, `runtime-core` is the game,
`render-web` draws it. Everything the author creates is a **definition**;
everything the player changes is **runtime state**; the two never share a
store.

---

## The whole model

```mermaid
erDiagram
    GAME_PROJECT ||--|| CONTENT_LIBRARY : owns
    GAME_PROJECT ||--o{ REGION : registers
    GAME_PROJECT ||--o{ SCENE : "sequences (campaign)"

    CONTENT_LIBRARY ||--o{ ASSET_DEFINITION : catalogues
    CONTENT_LIBRARY ||--o{ MATERIAL_DEFINITION : catalogues
    CONTENT_LIBRARY ||--o{ SOUND_CUE : catalogues
    CONTENT_LIBRARY ||--o{ NPC_DEFINITION : catalogues
    CONTENT_LIBRARY ||--o{ DIALOGUE_DEFINITION : catalogues
    CONTENT_LIBRARY ||--o{ QUEST_DEFINITION : catalogues
    CONTENT_LIBRARY ||--o{ ITEM_DEFINITION : catalogues
    CONTENT_LIBRARY ||--o{ SPELL_DEFINITION : catalogues

    REGION ||--o{ PLACED_ASSET_INSTANCE : places
    REGION ||--o{ NPC_PRESENCE : places
    REGION ||--o{ REGION_VOLUME : places
    PLACED_ASSET_INSTANCE }o--|| ASSET_DEFINITION : references
    NPC_PRESENCE }o--|| NPC_DEFINITION : references
    SCENE }o--|| REGION : overlays

    QUEST_DEFINITION ||--o{ QUEST_STAGE : "chains linearly"
    QUEST_STAGE ||--o{ QUEST_NODE : contains
    QUEST_NODE }o--o| QUEST_CONDITION : "gated by"
    QUEST_NODE ||--o{ QUEST_ACTION : "fires on enter/complete"
    QUEST_NODE }o--o| DIALOGUE_DEFINITION : "may bind"
    QUEST_NODE }o--o| NPC_DEFINITION : "targets (talk)"

    DIALOGUE_DEFINITION ||--o{ DIALOGUE_NODE : contains
    DIALOGUE_NODE ||--o{ DIALOGUE_EDGE : branches
    DIALOGUE_EDGE }o--o| DIALOGUE_CONDITION : "gated by"
    DIALOGUE_DEFINITION }o--o| NPC_DEFINITION : "default-binds to"

    GAMEPLAY_SESSION ||--|| QUEST_MANAGER : runs
    GAMEPLAY_SESSION ||--|| DIALOGUE_MANAGER : runs
    GAMEPLAY_SESSION ||--|| INVENTORY_MANAGER : runs
    GAMEPLAY_SESSION ||--|| RUNTIME_BLACKBOARD : runs
    QUEST_MANAGER ||--o{ ACTIVE_QUEST : tracks
    QUEST_MANAGER ||--o{ WORLD_FLAG : "holds (free-string)"
    RUNTIME_BLACKBOARD ||--o{ BLACKBOARD_FACT : "holds (typed, owned)"
    QUEST_MANAGER ||--o{ BLACKBOARD_FACT : "projects quest facts into"
    SAVE_PARTICIPANT }o--|| GAMEPLAY_SESSION : "captures slices of"
```

Read the labels as sentences: *a Region places NPC Presences*, *the Quest
Manager projects quest facts into the Runtime Blackboard*.

---

## Authored side

### Game Project and Content Library

`GameProject` (`packages/domain/src/game-project`) is the authored root: on
disk it is `project.sgrmagic` + `content-library.sgrmagic` +
`regions/*.json` + assets. It owns project settings, sound-event and music
bindings, credits, and the campaign (the `Episode` list -- see Ordered and
gated below).

`ContentLibrary` (`packages/domain/src/content-library`) owns every reusable
definition: assets (with colliders), materials and textures, character
models and animation libraries, audio clips and sound cues, environment
lighting presets -- plus the gameplay definitions below. A definition owns
what a thing IS; it never owns where the thing is placed.

### Ordered and gated

Two words for the two independent things a narrative structure does. Every
doc, code comment and UI label uses them with exactly this meaning:

- **Episodes are ordered and gated.** Order says which chapter comes after
  which. The unlock rule says whether the player may go there yet.
- **Scenes are ordered but not gated.** Order says which Scene comes after
  which inside the chapter. Nothing holds the player back -- finishing one
  moves them to the next.

So **ordered** is about sequence and **gated** is about permission. They are
separate: a thing can be ordered without being gated, which is exactly what a
Scene is. "Locked", "unlocked", "available" and "sequenced" are not loose
synonyms for either.

**Order is list position.** `GameProject.episodes` is ordered, and each
`Episode.scenes` is ordered. Neither carries an order number: a stored
ordinal beside an ordered list is the same fact written twice, and the two
drift the moment a delete leaves a hole. Player-facing numbering ("Scene 3 of
5") derives from position, so it is always contiguous from 1. A Scene that
needs a fixed name like "Chapter 7" puts it in `displayName`, which is a
title, not an order. Because there is no sort key to recover from, the load
path never reorders -- `normalizeEpisodes` and `normalizeScenes` preserve
input order, and a round-trip test pins it.

### Episode, Region and Scene

`Episode` (`packages/domain/src/episodes`) holds an ordered run of Scenes plus
the gate that decides when the player may enter it (`always`, `manual`,
`questComplete`, `wallClock`). An Episode HOLDS its Scenes rather than naming
them by id, so a Scene belongs to exactly one Episode by construction. Code
that needs a Scene without caring which Episode owns it uses `getAllScenes` /
`findSceneById` / `mapScenes`.

`Region` (`packages/domain/src/region-authoring`) is the authored place:
placed asset instances, landscape, environment, and the region-local
gameplay placements -- `RegionNPCPresence` (which NPC exists here, optionally
conditioned by a quest binding: quest active / stage / world-flag equals) and
region volumes whose trigger actions can set world flags and play audio on
entry.

`Scene` (`packages/domain/src/scenes`) is one place with the overlays that
dress it for this part of the story: content additions/overrides, environment
and audio overrides, a title card. It carries no order number and no gate of
its own. Quest actions drive progression -- `advanceToNextScene` moves within
an Episode (and running off the end is the Episode boundary, where credits
roll), `unlockEpisode` opens a gate. Viewport and runtime always resolve
region + active scene overlay composed, never the base region alone.

`GameProject.episodeEndRouting` decides where the player goes when an Episode
ends: `episodes-screen` (the default) hands them the Episodes screen to
choose; `next-episode` continues into the next Episode when its gate is open,
falling back to the same screen when it is shut, so a gated Episode is never
a dead end.

### NPC, Dialogue, Item, Spell

`NPCDefinition` (`packages/domain/src/npc-definition`) carries display,
presentation profile, animation bindings, lore page reference, and
`interactionMode: "scripted" | "agent"`. The mode is a static property of
the definition: `scripted` NPCs only converse through a bound
`DialogueDefinition`; `agent` NPCs converse through the sugaragent pipeline.

`DialogueDefinition` (`packages/domain/src/dialogue-definition`) is a node
graph: nodes hold speaker + line (+ optional line intent), edges branch and
may carry a `DialogueCondition` (flag / item / spell / quest state). An
`interactionBinding` names the NPC this dialogue default-binds to.

`startNodeId` is the node a conversation opens from, and is `string | null`: a
dialogue may be emptied completely, which is a legitimate way to start over, and
then there is nowhere to start. Deleting the start node repoints it at whatever
remains, so it never names a node that is gone.

`ItemDefinition` and `SpellDefinition` are catalog entries consumed by the
runtime inventory and caster.

### Quest

`QuestDefinition` (`packages/domain/src/quest-definition`) is:

- **Stages chain linearly.** `startStageId` + per-stage `nextStageId`.
  A stage is "a scene at a time": it may pin `timeOfDay`, applied to the
  world clock when the stage becomes active.
- **Nodes form a DAG inside a stage.** Edges are `prerequisiteNodeIds` on
  the node (plus stage `entryNodeIds` and branch `failTargetNodeIds`);
  there is no separate edge entity.
- **Node behaviors:** `objective` (subtypes talk / location / collect /
  castSpell / assessment / awaitEvent), `narrative` (subtypes voiceover /
  dialogue / cutscene, of which only dialogue does anything yet),
  `condition` (completes when its `QuestConditionDefinition` becomes true),
  `branch` (evaluates its condition immediately; fail activates
  `failTargetNodeIds`).
- **Conditions:** hasFlag / hasSpell / canCastSpell / questActive /
  questCompleted / questStage / not. No and/or combinators.
- **A flag condition always names a value, and the comparison is `===`.**
  There is no "is this flag set at all" form: an unset flag fails every
  comparison, so presence needs no separate rule. A blank value is refused in
  the quest editor, which flags the field and lists the node in the Validation
  panel; `isBlankFlagValue` is the shared check.
- **Authored flag values are coerced on both sides.** `coerceAuthoredFlagValue`
  runs on the `setFlag` action's value and on the `hasFlag` condition's value,
  so `"true"` becomes `true` and `"5"` becomes `5` at both ends and equality
  holds. Without it the action stores boolean `true` while the condition stores
  the string `"true"`, and the condition never matches. Region flag conditions
  (`RegionBehaviorWorldFlagCondition`) carry a declared `valueType` and reach
  the same guarantee through `coerceWorldFlagValue`, which is now the single
  read-and-write coercion.
- **Actions:** `onEnterActions` / `onCompleteActions` lists of
  `QuestActionDefinition`, a discriminated union on `type` where each
  variant declares its own named fields: setFlag, emitEvent, giveItem,
  removeItem, unlockEpisode, advanceToNextScene, set-time-of-day,
  advance-day, learn-fact, playCue, playAnimation. Every one is consumed
  at runtime.
- Nodes carry `graphPosition` for the quest graph editor, `showInHud`,
  `optional`, `eventName` (named completion event), and for talk/dialogue
  nodes a `dialogueDefinitionId` + `completeOn`.

### Graph layout

The three documents edited as node graphs -- `QuestStageDefinition`,
`DialogueDefinition` and `ShaderGraphDocument` -- each carry an optional
`groups: NodeGroup[]` (`packages/domain/src/graph-layout`). A `NodeGroup` is a
labelled box drawn around a set of nodes: `groupId`, `label`, `memberNodeIds`,
`position` and its own `size`.

Groups are layout, not meaning. The runtime never reads them, and grouping nodes
changes nothing about how a quest, dialogue or shader behaves.

Membership lives only on the group, in `memberNodeIds`; a node does not name its
group. Node positions stay absolute in the document -- the editor converts to and
from box-relative coordinates, because the graph library positions a member
relative to the box it sits in.

The field is optional so a document written before groups existed loads without
migration; the normalizers default it to an empty list and drop members whose
nodes no longer exist.

### Authoring change path

All authored mutation flows through semantic commands
(`packages/domain/src/commands`, dispatched from Studio as
`SemanticCommand`s like `UpdateQuestDefinition`), with transactions and
history alongside. UI never mutates definitions directly.

---

## Runtime side

`gameplay-session.ts` (`packages/runtime-core/src/coordination`) is the
wiring hub: it constructs the managers, connects their handler seams, and
owns every cross-system bridge described below.

### Quest runtime

`QuestManager` (`packages/runtime-core/src/quest`) holds active quests as
per-stage, per-node progress (`inactive | active | completed` +
`branchResult`). Every loaded quest auto-starts at session start; there is
no quest-giver or accept step. A fixed-point refresh loop activates nodes
whose prerequisites completed, completes condition/collect/branch nodes,
and advances the stage when every non-optional node is completed or
unreachable. External completions arrive by notification: dialogue finished
(talk/dialogue nodes, honoring `completeOn`), spell cast, and named events
(`notifyEvent` matches `node.eventName`). A stage with no `nextStageId`
completes the quest.

Quest-dialogue coordination: an active talk objective with a
`dialogueDefinitionId` overrides the NPC's dialogue for a `scripted` NPC,
and rides into a free-form conversation as
`scriptedFollowupDialogueDefinitionId` for an `agent` NPC. NPCs that are
talk targets of some quest have no default dialogue until a quest offers
one.

### World state: two stores

`RuntimeBlackboard` (`packages/runtime-core/src/state/blackboard.ts`) is
the typed fact store: every fact is a registered
`BlackboardFactDefinition` with an owner system, allowed scopes (global /
region / entity / quest / conversation), and a lifecycle (session / frame /
ephemeral). Writes by a non-owner throw. Producers: spatial, movement,
behavior, world-time, player-facts, narrative systems, and the quest-fact
projection (tracked quest, active stage, active objectives). Consumers:
`buildConversationRuntimeContext` snapshots facts into the runtime context
handed to plugins -- plugins never hold a blackboard handle; they request
writes through the conversation action proposal channel. Plugins may
contribute their own fact definitions.

**World flags** are the author-facing store, owned by `WorldFlagManager`
(`runtime-core/src/world-flags/`) and persisted in their own save slice.
Written by quest `setFlag` actions, volume triggers, spell `world-flag`
effects and conversation proposals; read by quest conditions, dialogue
conditions, NPC presence gating, NPC behavior activation and containment
volume gates.

Authored content names a flag by `definitionId`, resolved against
`GameProject.worldFlagDefinitions` -- the registry that makes the set of flags
a closed, validated one rather than free strings that silently never match.
The runtime store is keyed by the flag's `name`, because the paths that can
only name a flag in a string (a conversation proposal, the dev console) cannot
produce an id.

Flags are also projected onto the blackboard as `world.flag` facts, one per
flag, scoped by name, so a narrative system can read them without holding the
store. `WorldFlagManager` stays the write and persistence home; the blackboard
copy is a projection, per [ADR 031](../adr/031-blackboard-is-a-projection-surface.md).
Only registered flags are projected.

### Events

There is no general event bus. `QuestRuntimeEvent` (quest-start /
stage-advance / quest-complete / objective-complete) fans out from one
handler to notifications, the recent-event ring buffer (last 10, feeds NPC
conversation context), and audio. Named quest node events are a matching
pass, not a subscription: `notifyEvent(name)` completes active nodes whose
`eventName` matches.

### Persistence

Per-player runtime state persists as `SaveParticipant` slices (Plan 055
memento pattern). **This table is the canonical list; other docs link here
rather than restating it.**

| participant id | what it holds | owner |
|---|---|---|
| `quest.manager` | active + completed quests, completed nodes, tracked quest | runtime-core |
| `world.flags` | the world flag store | runtime-core |
| `world.time` | clock band + day | runtime-core |
| `world.presence` | which item presences the player has collected, keyed region -> scene | runtime-core |
| `player.known-facts` | facts the player has learned | runtime-core |
| `inventory.player` | the player's inventory | runtime-core |
| `npc.behavior` | per-NPC behavior state | runtime-core |
| `caster.stats` | caster stats | runtime-core |
| `playthrough.identity` | which playthrough this save is | runtime-core |
| `host.player` | current region + player position | web host |
| `campaign.progression` | current Episode and Scene, manually unlocked Episodes, completed Scenes and Episodes | web host |

Plugins contribute their own participants on top (sugarlang's target
language, for example).

Each slice carries a `schemaVersion`. Two patterns exist and the choice is
per-slice: **upgrade in place** when the old shape still means something
(`world.presence` v1 -> v2 wraps pre-Scenes collections under the default
Scene), or **discard** when it does not (`campaign.progression` v1 was
Scene-gated, and Scenes stopped being gated, so there is nothing to convert
-- a v1 save keeps every other slice and restarts the campaign).

The blackboard itself is never persisted; participant stores re-project
their facts into it on restore. Quest restore drops quests whose
definition no longer exists and re-fires state-change (not events) so
derived consumers resync without re-toasting.
