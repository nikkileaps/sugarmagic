/**
 * Compatibility re-export for pure landscape mask helpers.
 *
 * The canonical implementation now lives in @sugarmagic/domain so shell and
 * workspace consumers can share the same pure payload logic without crossing
 * into render-web.
 */

export {
  renderLandscapeMaskToCanvas,
  serializeLandscapePaintPayload
} from "@sugarmagic/domain";
