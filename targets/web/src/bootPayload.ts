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

import { resolveStorySeasons } from "@sugarmagic/domain";
import type { WebRuntimeStartState } from "./runtimeHost";

/**
 * The story shapes a boot payload can carry, newest first.
 * Neither key is trusted: this reads whatever is there.
 */
interface RawBootStory {
  seasons?: unknown;
  episodes?: unknown;
}

/**
 * Read the fetched payload into the shape the runtime takes.
 *
 * Which of the two stored shapes wins is `resolveStorySeasons`,
 * shared with the project loader so the rule has one home.
 *
 * A payload carrying NEITHER is left empty rather than given a
 * synthesized Season. Studio has a floor because an author always
 * needs a Scene to work in; the runtime's position is the opposite
 * — `resolveActiveEpisode` returns null when nothing is open, and
 * calls that "a real position on the story timeline". Inventing a
 * story here would turn a bundle that shipped wrong into a
 * bundle that looks empty on purpose.
 */
export function normalizeBootPayload(raw: unknown): WebRuntimeStartState {
  // `episodes` is pulled off rather than spread through: it is the
  // superseded key, `resolveStorySeasons` has already read whatever it
  // held, and leaving it on the object would hand every reader below a
  // second story to choose from.
  const stored = (raw ?? {}) as WebRuntimeStartState & RawBootStory;
  const { episodes: _legacyEpisodes, ...payload } = stored;
  return { ...payload, seasons: resolveStorySeasons(stored) };
}
