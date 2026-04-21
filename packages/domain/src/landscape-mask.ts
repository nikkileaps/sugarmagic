/**
 * Pure landscape mask helpers.
 *
 * These helpers read authored `RegionLandscapeState` data and render/export
 * paint payload information without depending on viewport or renderer state.
 */

import type {
  RegionLandscapePaintPayload,
  RegionLandscapeState
} from "./region-authoring/index";
import { LandscapeSplatmap } from "./landscape-splatmap";

function resolvePaintResolution(landscape: RegionLandscapeState): number {
  return landscape.paintPayload?.resolution ?? 256;
}

export function renderLandscapeMaskToCanvas(
  landscape: RegionLandscapeState,
  channelIndex: number,
  canvas: HTMLCanvasElement
): void {
  const splatmap = new LandscapeSplatmap(resolvePaintResolution(landscape));
  splatmap.load(landscape.paintPayload, landscape.channels.length);
  splatmap.renderChannelMask(channelIndex, canvas);
  splatmap.dispose();
}

export function serializeLandscapePaintPayload(
  landscape: RegionLandscapeState
): RegionLandscapePaintPayload | null {
  const splatmap = new LandscapeSplatmap(resolvePaintResolution(landscape));
  splatmap.load(landscape.paintPayload, landscape.channels.length);
  const payload = splatmap.serialize();
  splatmap.dispose();
  return payload;
}
