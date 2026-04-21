/**
 * Compatibility re-export.
 *
 * The canonical splatmap implementation now lives in @sugarmagic/domain
 * because shell draft editing and render/runtime consumers all share the same
 * pure paint-payload semantics.
 */

export {
  LandscapeSplatmap,
  type LandscapePaintSample
} from "@sugarmagic/domain";
