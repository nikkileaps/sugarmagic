/**
 * targets/web/src/bootPayload.ts
 *
 * Purpose: turn whatever `/boot.json` actually contains into a
 * `WebRuntimeStartState`.
 *
 * This is the file seam. `fetch("/boot.json")` returns `unknown`
 * dressed as a type by a cast, and it is the only place a payload
 * older than the running engine can enter, so it is the only place
 * that knows how to read an older one. Everything inland takes the
 * current shape and never asks again.
 *
 * The same rule the project loader uses for `project.sgrmagic`
 * (`normalizeGameProject`): coerce at the boundary, so the shape
 * is settled once rather than re-derived by every reader.
 *
 * Status: active
 */

import {
  normalizeEpisodes,
  wrapEpisodesInDefaultSeason
} from "@sugarmagic/domain";
import type { WebRuntimeStartState } from "./runtimeHost";

/**
 * The campaign shapes a boot payload can carry, newest first.
 * Neither key is trusted: this reads whatever is there.
 */
interface RawBootCampaign {
  seasons?: unknown;
  episodes?: unknown;
}

/**
 * Read the fetched payload into the shape the runtime takes.
 *
 * Campaign precedence matches the project loader's: a non-EMPTY
 * `seasons` wins; else a non-empty pre-Seasons `episodes` list is
 * wrapped in one Season. Testing for non-empty rather than present
 * matters — a payload carrying `seasons: []` beside a real
 * `episodes` list has to fall through, or a half-migrated bundle
 * boots as an empty campaign.
 *
 * A payload carrying NEITHER is left empty rather than given a
 * synthesized Season. Studio has a floor because an author always
 * needs a Scene to work in; the runtime's position is the opposite
 * — `resolveActiveEpisode` returns null when nothing is open, and
 * calls that "a real position on the story timeline". Inventing a
 * campaign here would turn a bundle that shipped wrong into a
 * bundle that looks empty on purpose.
 */
export function normalizeBootPayload(raw: unknown): WebRuntimeStartState {
  const payload = (raw ?? {}) as WebRuntimeStartState & RawBootCampaign;
  const authored = Array.isArray(payload.seasons) ? payload.seasons : [];
  if (authored.length > 0) return payload;

  const legacyEpisodes = normalizeEpisodes(payload.episodes);
  if (legacyEpisodes.length === 0) return payload;
  return { ...payload, seasons: wrapEpisodesInDefaultSeason(legacyEpisodes) };
}
