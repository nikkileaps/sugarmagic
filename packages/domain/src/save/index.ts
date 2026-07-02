/**
 * packages/domain/src/save/index.ts
 *
 * Purpose: Cross-plugin game-save payload shape. Lives in domain
 * because `GameProject` references it via the
 * `defaultGameSavePayload` field (Plan 047 §47.10.5) — the project-
 * authored starting state a brand-new player gets when no save
 * exists yet. Runtime-core re-exports the type from here so every
 * downstream consumer (target-web, testing) keeps importing from
 * `@sugarmagic/runtime-core` unchanged.
 *
 * Implements: Plan 047 §Story 47.1 (type), §Story 47.10.5
 * (defaultGameSavePayload field)
 *
 * Status: active
 */

/**
 * Plan 055 §055.1 — envelope wrapping one runtime system's
 * persisted slice inside `GameSavePayload.slices`. Lives in
 * domain so the save-payload schema is self-contained; the
 * `SaveParticipant` runtime contract that produces/consumes
 * these envelopes lives in `@sugarmagic/runtime-core` and
 * imports this type back.
 *
 * `schemaVersion` is the participant-owned slice schema token
 * (bumped when the slice shape changes incompatibly); `data`
 * is the participant's opaque payload.
 */
export interface SaveSlice<TData = unknown> {
  schemaVersion: number;
  data: TData;
}

/**
 * The cross-plugin player record. Owned by domain because both
 * project authoring (`defaultGameSavePayload`) and runtime save
 * stores read/write this shape. Plugin-domain per-user state
 * never lives here; see ADR 020 for the boundary rationale.
 *
 * Post Plan 055.7 shape:
 *   - `slices` is the ONLY canonical carrier — one per registered
 *     SaveParticipant, keyed by participantId. Post-055.7 writes
 *     emit `slices` exclusively. Reading a slice is uniform:
 *     pre-055 legacy 3-field payloads flow through
 *     `upgradeLegacyPayload` on load which synthesizes the
 *     `host.player` + `quest.manager` slices from the legacy
 *     fields, so downstream code never needs a legacy branch.
 *   - Legacy `currentRegionId` / `currentQuestId` / `playerPosition`
 *     are DEPRECATED (see `@deprecated` on each field). They stay
 *     optional and readable so pre-055 saves still load. A
 *     follow-up story (Plan 055.8 draft) deletes them entirely
 *     once no live save references them.
 *
 * Every field is nullable on purpose: a brand-new save (player
 * has not yet entered any region, accepted any quest, or moved
 * from their spawn) carries `null` / `{}` everywhere and the
 * runtime hydrates defaults from `boot.json` or
 * `GameProject.defaultGameSavePayload`. A non-null value here
 * always supersedes the authored default.
 */
export interface GameSavePayload {
  /** Plan 055 §055.2 — per-participant persisted slices, keyed
   *  by SaveParticipant.participantId. Empty `{}` for fresh
   *  saves and for legacy pre-055 saves before upgrade. */
  slices: Record<string, SaveSlice>;
  /**
   * @deprecated Plan 055.7 — the current region moved into the
   * `host.player` slice's `data.currentRegionId`. Legacy pre-055
   * saves still carry this field on the wire; `upgradeLegacyPayload`
   * migrates it into the slice on load. Post-055.7 writes DO NOT
   * populate this field. Optional so writers may omit it. Plan
   * 055.8 draft deletes the field entirely.
   */
  currentRegionId?: string | null;
  /**
   * @deprecated Plan 055.7 — the tracked quest moved into the
   * `quest.manager` slice's `data.trackedQuestDefinitionId`. See
   * `currentRegionId` above for the migration rationale. Legacy
   * saves carry this; post-055.7 writes do not.
   */
  currentQuestId?: string | null;
  /**
   * @deprecated Plan 055.7 — the player position moved into the
   * `host.player` slice's `data.playerPosition`. See
   * `currentRegionId` above for the migration rationale. Legacy
   * saves carry this; post-055.7 writes do not.
   */
  playerPosition?: { x: number; y: number; z: number } | null;
}

/**
 * Story 47.10.5 — pick the live spawn payload from the available
 * sources. The save's payload wins when present (a returning
 * player resumes); otherwise the project's authored default
 * (`GameProject.defaultGameSavePayload`) wins; otherwise the
 * implicit boot.json / playerPresence defaults win.
 *
 * Returned `null` means "no save and no authored default" — the
 * caller falls through to the implicit composition.
 *
 * Pure helper so tests can pin the resolution order without
 * standing up a runtime host.
 */
export function pickGameSavePayload(
  savePayload: GameSavePayload | null,
  defaultPayload: GameSavePayload | null
): GameSavePayload | null {
  return savePayload ?? defaultPayload ?? null;
}

/**
 * Plan 055 §055.2 — read-time normalizer that upgrades legacy
 * (pre-055) payloads into the slice-carrying shape.
 *
 * Pre-055 saves were written with `currentRegionId` /
 * `currentQuestId` / `playerPosition` and no `slices` field
 * (the wire JSON simply lacks the key). Post-055 writers
 * populate `slices` and continue to write the legacy fields
 * for back-compat through 055.6.
 *
 * When the input already has non-empty `slices`, the payload is
 * returned unchanged — it's already new-shape.
 *
 * When `slices` is absent or empty, this helper synthesizes:
 *   - a `"host.player"` slice from `{ currentRegionId,
 *     playerPosition }` so the host-owned participant (055.3)
 *     restores the saved location
 *   - a `"quest.manager"` slice from `{ currentQuestId }` so the
 *     quest.manager participant (055.4) re-tracks the previously
 *     tracked quest (no historical stage/objective data — that
 *     never existed in legacy saves)
 *
 * The participantId string literals here MUST match what the
 * `host.player` and `quest.manager` participant impls register
 * as. If either is renamed, this helper strands legacy saves —
 * that's the point of picking stable participant ids up front.
 */
const HOST_PLAYER_PARTICIPANT_ID = "host.player";
const QUEST_MANAGER_PARTICIPANT_ID = "quest.manager";

export function upgradeLegacyPayload(
  input: Omit<GameSavePayload, "slices"> & {
    slices?: Record<string, SaveSlice>;
  }
): GameSavePayload {
  const slices: Record<string, SaveSlice> = { ...(input.slices ?? {}) };
  const needsUpgrade = Object.keys(slices).length === 0;
  if (needsUpgrade) {
    slices[HOST_PLAYER_PARTICIPANT_ID] = {
      schemaVersion: 1,
      data: {
        currentRegionId: input.currentRegionId,
        playerPosition: input.playerPosition
      }
    };
    slices[QUEST_MANAGER_PARTICIPANT_ID] = {
      schemaVersion: 1,
      data: {
        trackedQuestDefinitionId: input.currentQuestId
      }
    };
  }
  return {
    slices,
    currentRegionId: input.currentRegionId,
    currentQuestId: input.currentQuestId,
    playerPosition: input.playerPosition
  };
}
