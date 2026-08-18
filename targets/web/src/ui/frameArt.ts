/**
 * Bundled art for the framed gameplay panels: the caster frame (spell menu,
 * with meter and medallion hardware) and the plain frame (inventory list).
 *
 * Vite turns these imports into hashed asset URLs; runtime-core receives only
 * the URLs (it never imports image files). Each sheet carries its fixed frame
 * pieces; the standalone files are the repeating/stretching pieces, generated
 * from the sheets by docs/prototypes/caster-frame-slices.py -- see the frame
 * geometry tables in @sugarmagic/runtime-core's framed-panel module.
 */
import type { FramedPanelArtSet } from "@sugarmagic/runtime-core";
import casterSheetUrl from "./frame-art/caster-frame-sheet.png";
import casterRailLeftUrl from "./frame-art/rail-left.png";
import casterRailRightUrl from "./frame-art/rail-right.png";
import casterTopStretchUrl from "./frame-art/top-stretch.png";
import casterBottomStretchUrl from "./frame-art/bottom-stretch.png";
import casterParchmentUrl from "./frame-art/parchment.png";
import plainSheetUrl from "./frame-art/plain-frame-sheet.png";
import plainRailLeftUrl from "./frame-art/plain-rail-left.png";
import plainRailRightUrl from "./frame-art/plain-rail-right.png";
import plainTopStretchUrl from "./frame-art/plain-top-stretch.png";
import plainBottomStretchUrl from "./frame-art/plain-bottom-stretch.png";
import plainParchmentUrl from "./frame-art/plain-parchment.png";

export const gameplayFrameArt: FramedPanelArtSet = {
  caster: {
    sheetUrl: casterSheetUrl,
    railLeftUrl: casterRailLeftUrl,
    railRightUrl: casterRailRightUrl,
    topStretchUrl: casterTopStretchUrl,
    bottomStretchUrl: casterBottomStretchUrl,
    parchmentUrl: casterParchmentUrl
  },
  plain: {
    sheetUrl: plainSheetUrl,
    railLeftUrl: plainRailLeftUrl,
    railRightUrl: plainRailRightUrl,
    topStretchUrl: plainTopStretchUrl,
    bottomStretchUrl: plainBottomStretchUrl,
    parchmentUrl: plainParchmentUrl
  }
};
