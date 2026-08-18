/**
 * Bundled art for the framed gameplay panels (the caster spell menu).
 *
 * Vite turns these imports into hashed asset URLs; runtime-core receives only
 * the URLs (it never imports image files). The sheet carries every fixed
 * frame piece; the standalone files are the repeating/stretching pieces,
 * generated from the sheet by docs/prototypes/caster-frame-slices.py -- see
 * the slice table in @sugarmagic/runtime-core's framed-panel geometry.
 */
import type { FramedPanelArt } from "@sugarmagic/runtime-core";
import sheetUrl from "./frame-art/caster-frame-sheet.png";
import railLeftUrl from "./frame-art/rail-left.png";
import railRightUrl from "./frame-art/rail-right.png";
import topStretchUrl from "./frame-art/top-stretch.png";
import bottomStretchUrl from "./frame-art/bottom-stretch.png";
import parchmentUrl from "./frame-art/parchment.png";

export const gameplayFrameArt: FramedPanelArt = {
  sheetUrl,
  railLeftUrl,
  railRightUrl,
  topStretchUrl,
  bottomStretchUrl,
  parchmentUrl
};
