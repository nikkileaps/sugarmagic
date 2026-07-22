/**
 * packages/runtime-core/src/save/playthroughIdentitySaveParticipant.ts
 *
 * Purpose: the `playthrough.identity` SaveParticipant + its
 * module-level registry getter. Owns a single `playthroughId`
 * (uuid) that names ONE continuous playthrough — the id every
 * plugin store that must reset on New Game keys itself on
 * (SugarAgent's NPC memory, Plan 073).
 *
 * ## Why this participant mints on deserialize(null)
 *
 * New Game deletes the save row and reloads the page (see
 * `SerializedSaveStore.resetForNewGame`). The store is FROZEN
 * before the reload, so nothing minted at button-click time can
 * ever be persisted. The only moment a fresh id can be both
 * minted AND written to the next save is BOOT — i.e. when this
 * participant's `deserialize` runs with no stored slice. So:
 *
 *   - New Game        -> save row gone -> slice absent -> MINT (new id)
 *   - first-ever boot -> no save       -> slice absent -> MINT
 *   - pre-073 save    -> participant added later -> slice absent -> MINT
 *   - Continue        -> slice present -> ADOPT the stored id
 *
 * One `deserialize(null) => mint` path uniformly covers every
 * "start fresh" case; `hostStartNewGame` needs zero new code.
 * "New Game happened" for ANY downstream plugin store then
 * reduces to "the playthroughId I last saw changed" — the
 * architectural precedent this participant sets (Plan 073 §D1).
 *
 * ## Why a module-level getter (the access-token-registry mold)
 *
 * Plugin runtimes (SugarAgent) are constructed BEFORE the save
 * participants deserialize, and plugin code has no reference to
 * the host. A module-level holder that defers the read to
 * operation time is the same shape `access-token-registry` uses
 * for the bearer token, and for the same structural reason. The
 * host owns the write (via this participant's deserialize); plugin
 * runtime reads via `getActivePlaythroughId`.
 *
 * Implements: Plan 073 §073.1 (D1)
 *
 * Status: active
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "./participant";

export const PLAYTHROUGH_IDENTITY_PARTICIPANT_ID = "playthrough.identity";
export const PLAYTHROUGH_IDENTITY_SLICE_SCHEMA_VERSION = 1;

export interface PlaythroughIdentitySlice {
  /** Stable uuid naming this continuous playthrough. Changes only
   *  on New Game (a fresh mint), never mid-playthrough. */
  playthroughId: string;
}

/**
 * The single live playthroughId for this runtime session. `null`
 * until this participant's `deserialize` has run (boot). Plugin
 * stores read it via `getActivePlaythroughId` and MUST treat
 * `null` as "identity not ready" rather than key state under it.
 */
let activePlaythroughId: string | null = null;

/**
 * Read the current playthroughId. Returns `null` before boot's
 * deserialize has settled it. See the file header for the
 * late-binding rationale (mirrors `getActiveAccessToken`).
 */
export function getActivePlaythroughId(): string | null {
  return activePlaythroughId;
}

/**
 * Test-only reset of the module holder. Production never clears
 * the id mid-session (a page reload constructs a fresh module).
 */
export function resetActivePlaythroughIdForTests(): void {
  activePlaythroughId = null;
}

export interface PlaythroughIdentityParticipantOptions {
  /** UUIDv4 factory. Defaults to `crypto.randomUUID()`. Tests
   *  inject a deterministic factory. */
  randomUuid?: () => string;
}

function defaultRandomUuid(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  throw new Error(
    "[runtime-core] crypto.randomUUID is not available. Inject a randomUuid " +
      "factory via createPlaythroughIdentitySaveParticipant options, or run " +
      "in an environment that ships crypto.randomUUID (modern browser / Node 19+)."
  );
}

/** A stored playthroughId is only adopted if it's a non-empty
 *  string; anything else is treated as absent and re-minted. */
function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * `playthrough.identity` participant. `host-owned` tier: this is
 * boot identity in the same class as `host.player`, and settling
 * it early keeps the invariant that `getActivePlaythroughId` is
 * non-null for the whole post-boot lifetime simple to reason about.
 */
export function createPlaythroughIdentitySaveParticipant(
  options: PlaythroughIdentityParticipantOptions = {}
): SaveParticipant<PlaythroughIdentitySlice> {
  const randomUuid = options.randomUuid ?? defaultRandomUuid;

  return {
    participantId: PLAYTHROUGH_IDENTITY_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: PLAYTHROUGH_IDENTITY_SLICE_SCHEMA_VERSION,
    serialize(): PlaythroughIdentitySlice {
      // Defensive: deserialize always settles a non-null id before
      // any autosave tick, but if serialize somehow runs first,
      // mint rather than persist an empty id.
      if (!isUsableId(activePlaythroughId)) {
        activePlaythroughId = randomUuid();
      }
      return { playthroughId: activePlaythroughId };
    },
    deserialize(slice: SaveSlice<PlaythroughIdentitySlice> | null): void {
      const stored = slice?.data?.playthroughId;
      activePlaythroughId = isUsableId(stored) ? stored : randomUuid();
    }
  };
}
