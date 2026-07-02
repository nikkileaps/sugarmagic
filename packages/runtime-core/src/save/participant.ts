/**
 * packages/runtime-core/src/save/participant.ts
 *
 * Purpose: Per-system save participation contract + registry.
 * Composes GoF Memento (each system owns its opaque state
 * envelope) with Registry + Mediator (a central orchestrator
 * dispatches save/load across all participants without knowing
 * any slice shape). See Plan 055 §Pattern.
 *
 * Boundary: this contract holds runtime-core system state that
 * contributes to the SHARED GameSave. Per-plugin per-user data
 * still lives in plugin-owned stores per ADR 020. A participant
 * is NOT a hatch for plugin domain data to ride in GameSave.
 *
 * Implements: Plan 055 §055.1
 *
 * Status: active
 */

// Plan 055 §055.2 — the SaveSlice envelope moved to @sugarmagic/domain
// so `GameSavePayload.slices` can reference it without domain having a
// dep on runtime-core. Re-exported here for existing consumers.
import type { SaveSlice } from "@sugarmagic/domain";
export type { SaveSlice };

/**
 * Runtime priority tiers used by the registry when dispatching
 * `deserialize`. Lower tiers run first; a participant that
 * provides context another participant needs during restore
 * declares the earlier tier.
 *
 *   - `host-owned`: host-provided slices that inform ECS spawn
 *     (player position, current region). Nothing that queries the
 *     spawned world can run before these settle.
 *   - `region-aware`: participants whose deserialize needs
 *     `host-owned` slices to have landed. World-presence tracker
 *     lives here — the region has to be picked before it knows
 *     which presence IDs to consider.
 *   - `default`: everything else. Order within a tier follows
 *     registration order.
 */
export type SaveParticipantTier = "host-owned" | "region-aware" | "default";

export interface SaveParticipant<TSlice = unknown> {
  /** Stable namespace. Convention: `"<system>.<purpose>"` e.g.
   *  `"quest.manager"`, `"inventory.player"`, `"world.presence"`.
   *  Used as the slice key in the persisted payload; renaming this
   *  after a save has been written strands the old slice.
   */
  participantId: string;

  /**
   * Priority tier for deserialize dispatch. Optional; defaults to
   * `"default"`. See `SaveParticipantTier` for tier semantics.
   */
  tier?: SaveParticipantTier;

  /**
   * Current slice schema version. Bumped when the slice shape
   * changes incompatibly. `deserialize` receives whatever version
   * was persisted and is responsible for upgrading (or ignoring
   * the slice and resetting to defaults).
   */
  schemaVersion: number;

  /** Read live state, return the slice payload to persist. Sync,
   *  cheap; called every autosave tick. Throwing from serialize
   *  drops THIS slice from the written payload but does not affect
   *  the rest — the registry catches. */
  serialize(): TSlice;

  /** Restore live state from a slice loaded from the store.
   *
   *  Receives `null` when no slice was stored (fresh player OR
   *  this participant was added after the loaded save was
   *  written); restore defaults in that case.
   *
   *  Receives `{ schemaVersion, data }` otherwise. `schemaVersion`
   *  may be lower than `this.schemaVersion` if a slice migration
   *  is needed. The participant owns the upgrade path — the
   *  registry does not translate between versions. Throwing from
   *  deserialize logs and leaves this participant in whatever
   *  partial state it reached; other participants still deserialize.
   */
  deserialize(slice: SaveSlice<TSlice> | null): void;
}

/**
 * Registry the runtime host uses to track save participants and
 * orchestrate collect-on-save / dispatch-on-load. Constructed once
 * at host factory time; lives as long as the host does.
 *
 * The registry has no opinion about payload shape or where slices
 * live in the persisted record — it only knows the participant
 * map. The host is responsible for reading `slices` out of the
 * loaded payload and handing it to `deserializeAll`, and for
 * writing `serializeAll()`'s return back into whatever payload
 * envelope it uses.
 */
export class SaveParticipantRegistry {
  private readonly participants = new Map<string, SaveParticipant<unknown>>();
  private readonly registrationOrder: string[] = [];

  register<TSlice>(participant: SaveParticipant<TSlice>): void {
    if (this.participants.has(participant.participantId)) {
      console.warn(
        `[save/participant] participant "${participant.participantId}" ` +
          `is already registered; replacing existing.`
      );
      const existingIndex = this.registrationOrder.indexOf(
        participant.participantId
      );
      if (existingIndex !== -1) {
        this.registrationOrder.splice(existingIndex, 1);
      }
    }
    this.participants.set(
      participant.participantId,
      participant as SaveParticipant<unknown>
    );
    this.registrationOrder.push(participant.participantId);
  }

  unregister(participantId: string): void {
    if (!this.participants.delete(participantId)) return;
    const index = this.registrationOrder.indexOf(participantId);
    if (index !== -1) {
      this.registrationOrder.splice(index, 1);
    }
  }

  /** Snapshot of registered participants in registration order. */
  list(): ReadonlyArray<SaveParticipant<unknown>> {
    return this.registrationOrder.map(
      (id) => this.participants.get(id) as SaveParticipant<unknown>
    );
  }

  /**
   * Dispatch `deserialize(slice)` on registered participants, in
   * tier order: `host-owned` -> `region-aware` -> `default`.
   * Within a tier, registration order.
   *
   * `slices` is a keyed map from participantId to persisted slice;
   * a participant whose id is missing from the map receives `null`.
   * Errors from any individual `deserialize` are caught, logged,
   * and swallowed — a broken participant doesn't take out the rest.
   *
   * `tierFilter` optionally restricts dispatch to specific tiers.
   * Motivation: some subsystems (QuestManager, InventoryManager,
   * world-presence tracker) don't exist at host.start until after
   * `gameplayAssembly` is created — but `host.player` needs to
   * deserialize BEFORE ECS spawn. The host runs two phases: first
   * `["host-owned"]` before spawn, then `["region-aware",
   * "default"]` after those subsystems are constructed and their
   * participants have registered.
   *
   * Omitting `tierFilter` runs every tier (single-pass mode,
   * matches how tests call it).
   */
  deserializeAll(
    slices: Record<string, SaveSlice<unknown>>,
    tierFilter?: readonly SaveParticipantTier[]
  ): void {
    const filterSet = tierFilter ? new Set(tierFilter) : null;
    for (const participant of this.orderedForDeserialize()) {
      const participantTier = participant.tier ?? "default";
      if (filterSet && !filterSet.has(participantTier)) continue;
      const slice = slices[participant.participantId] ?? null;
      try {
        participant.deserialize(slice);
      } catch (error) {
        console.error(
          `[save/participant] "${participant.participantId}" ` +
            `deserialize threw; participant left in partial state.`,
          error
        );
      }
    }
  }

  /**
   * Collect the current slice from every registered participant.
   * Wraps each return in the `{ schemaVersion, data }` envelope.
   * Errors from any individual `serialize` are caught, logged, and
   * the failing participant is DROPPED from the returned map —
   * better to write a partial save than to lose every other
   * system's progress because one threw.
   */
  serializeAll(): Record<string, SaveSlice<unknown>> {
    const slices: Record<string, SaveSlice<unknown>> = {};
    for (const participantId of this.registrationOrder) {
      const participant = this.participants.get(participantId);
      if (!participant) continue;
      try {
        const data = participant.serialize();
        slices[participantId] = {
          schemaVersion: participant.schemaVersion,
          data
        };
      } catch (error) {
        console.error(
          `[save/participant] "${participantId}" serialize threw; ` +
            `slice dropped from this write.`,
          error
        );
      }
    }
    return slices;
  }

  private orderedForDeserialize(): SaveParticipant<unknown>[] {
    const byTier: Record<SaveParticipantTier, SaveParticipant<unknown>[]> = {
      "host-owned": [],
      "region-aware": [],
      default: []
    };
    for (const id of this.registrationOrder) {
      const participant = this.participants.get(id);
      if (!participant) continue;
      const tier = participant.tier ?? "default";
      byTier[tier].push(participant);
    }
    return [
      ...byTier["host-owned"],
      ...byTier["region-aware"],
      ...byTier.default
    ];
  }
}
