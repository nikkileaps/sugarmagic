# Plan 056 — Remaining runtime persistables

Status: proposed
Owner: nikki + claude
Date: 2026-07-02

Related: Plan 055 (SaveParticipant model — the mechanism this epic uses). Plan 058 (Season/Episode content model draft — some of these participants intersect with episode gating in obvious ways). ADR 020 (per-plugin per-user state boundary — participants here are runtime-core system state, not plugin data).

## Problem

Epic 55 shipped the SaveParticipant model with four participants: `host.player` (spawn position + region), `quest.manager` (quest progress + flags + completed history), `inventory.player` (items + counts), and `world.presence` (per-region collected item presences). Player picks up a run right where they left off for those systems.

But we found more systems with visible runtime-mutable state that DON'T yet persist. Each one is a "returning player notices something is wrong" moment on reload:

1. **Caster stats** (battery, resonance, any authored stats). The `RuntimeStatCarrier` (`packages/runtime-core/src/mechanics/runtime/StatCarrier.ts`) holds a `Map<statId, number>` per-caster. Casting a spell mutates it via `castable.cost`; `tick(deltaSeconds)` recharges/decays. On reload the caster's stats initialize from `mechanics.stats[].default` — full battery cheese.

2. **NPC behavior state** (position + movement task). Behavior system at `packages/runtime-core/src/behavior/system.ts` selects a task based on active quest + world flags (both persisted via `quest.manager`), then walks the NPC toward the task's target area. `stepToward` writes directly into the `Position` component each tick (lines 463-464, 470-471). On reload NPCs teleport back to their `presence.transform.position` spawn point and re-walk to the task's target — visible on every reload.

3. **NOT PERSISTABLE — confirmed by code**:
   - **Inspectables**: Interaction handler at `gameplay-session.ts:1738-1753` shows the document reader and DOES NOT mutate any state or set an "inspected" flag. Player can inspect infinite times. Nothing to persist.
   - **Spell learning / unlocks**: `CasterManager.isSpellAllowed` (`CasterManager.ts:288`) filters spells by `caster.allowedSpellTags` / `blockedSpellTags`. Those are seeded from `playerDefinition.casterProfile` at spawn (`player/index.ts:182`); grep confirms NOTHING mutates them at runtime. Spell "availability" is authored, not learned. If wordlark's design later adds runtime spell learning, that adds fields to the caster participant's slice — additive.
   - **Stat modifiers** (`StatModifierRegistry`): "V1 ships with no built-in buffs/debuffs" per its file comment. Registry is a seam, empty in practice. Nothing to persist yet.

## Goal

After this epic, every mutable runtime system whose state is visible to a returning player persists across sessions via a `SaveParticipant`. Reload -> spawn -> deserialize -> game looks exactly like the moment the player left, including caster stats and NPC positions/behaviors.

## What's NOT in scope

- **Anything that's authored, not runtime-mutable.** (Spell definitions, mechanics rules, item catalog, region layouts — all authored and re-read from `boot.json` on every boot.)
- **UI ephemeral state** (menu open / cursor position / camera angles). Not a returning-player concern.
- **Season/Episode progression** — Plan 058's `campaign.progression` participant. Separate epic; different design surface.
- **New system implementations.** This epic ONLY adds save participants for existing systems. If a system doesn't exist yet (e.g. runtime spell learning, achievement counters), that's separate.
- **`campaign.progression` doubling as a mode for participant "reset when episode changes."** Cross-participant reset semantics are Plan 058's problem.

## Pattern

Same Memento + Registry pattern Plan 055 established. Each system:
1. Adds `serializeSaveSlice()` / `deserializeSaveSlice(slice)` methods to its manager class (or equivalent).
2. Exports a `create<Name>SaveParticipant({ get<Manager> })` factory in a co-located file.
3. Host registers the participant during `runtimeHost.start()` at the appropriate phase (host-owned before spawn; default after `gameplayAssembly` is constructed).

Nothing new to invent — this epic is applying the Plan 055 template to two more systems.

## Stories

### 058.1 — `caster.stats` participant

Persists per-caster stat values (a `Record<statId, number>` per caster entity). Slice shape:

```ts
interface CasterStatsSlice {
  // Keyed by entity identifier (right now only "player"; if
  // wordlark grows to persistable NPC casters later, add entries
  // per NPC presenceId).
  casters: Record<string, { stats: Record<string, number> }>;
}
```

Semantic: on deserialize, `caster.stats.set(statId, value)` for each restored value, letting the `StatCarrier`'s existing clamp-to-definition logic handle out-of-range legacy values (a mechanics definition change between save and load might tighten min/max).

Wire in gameplay-session: the `CasterManager` exposes serialize/deserialize; the participant factory reads `casterManager` via the same nullable-getter pattern as `quest.manager` and `inventory.player`. Phase 2 (default tier) in host.start.

Tests: round-trip stat values, tolerate missing stat IDs (mechanics definition removed a stat between saves), tolerate unknown stat IDs (mechanics definition renamed).

### 058.2 — `npc.behavior` participant

Persists per-NPC position + high-level movement state (target task + status). Slice shape:

```ts
interface NpcBehaviorSlice {
  // Keyed by presenceId (matches RegionNPCPresence).
  npcs: Record<
    string,
    {
      position: { x: number; y: number; z: number };
      target: { areaId: string | null; taskId: string | null } | null;
      status: "idle" | "en_route" | "at_target" | "blocked";
    }
  >;
}
```

Explicitly OMITTED (v1): `lastProgressAtMs` / `blockedAtMs` timestamps and `targetX/Z` waypoint samples. Timestamps captured via `Date.now()` would be stale on reload (elapsed real time would look like "stuck for hours"); rehydrating them requires clock offsetting we don't want to invent yet. Waypoint samples get re-selected inside the target area on next tick; no visual difference. Persisted status carries the "am I currently moving toward a target?" semantic that matters for continuity.

Wire: `NpcBehaviorSystem` gains `serializeSlice()` / `deserializeSlice(slice)` methods that read and write its private `movementStateByNpcId` map + query/update the ECS `Position` component for each NPC entity. Participant factory reads it via getter. Tier: `region-aware` — must restore before the assembly's initial behavior tick so the NPC's first frame after restore shows them at the persisted position, not their spawn point.

Tests: position round-trip; task-in-flight round-trip; NPCs whose presenceId isn't in the slice (added since save) start fresh at spawn; NPCs whose presenceId IS in the slice but the definition is gone (renamed) drop with a warn (matches `quest.manager` tolerance pattern).

### 058.3 — Verify in prod + memory rule refresh

- End-to-end verify: cast a spell (drain battery); walk to make an NPC start moving toward a task target; hard-refresh; Continue -> caster stats restored, NPC positioned mid-walk exactly where they were.
- Update the `save-participant-for-new-state` memory rule if any anti-pattern surfaces (e.g. "don't persist wall-clock timestamps in a slice" is a real generalization from 058.2's omission).

## Open questions

- **Do NPCs persist across region transitions?** Current design has one region per session. When mid-session region transitions land (Story 47.10 follow-up), each region's NPCs are a fresh spawn — should `npc.behavior` persist state per-region (like `world.presence`) to survive coming back? Probably yes; bump 058.2's schemaVersion when we get there.
- **Multi-caster projects.** `caster.stats` is keyed by an entity id string. Player only for now (`"player"`); NPCs with Caster components would need a keying convention. Not a blocker for v1 — add entries when a real NPC caster ships.

## Defers

- **`campaign.progression`** — Plan 058's job.
- **Spell learning / unlock tracking** — not a runtime concept yet; add as a story only if wordlark's design adds it.
- **Persistable stat modifiers** — no runtime modifiers exist in v1; the seam is empty.
- **Cross-region NPC behavior state** — see Open Questions.
