/**
 * packages/runtime-core/src/framed-panel/index.ts
 *
 * Purpose: The ornate framed panel used by gameplay overlays (today the
 *   caster spell menu). Assembles the painted frame from sheet cuts, keeps
 *   the two resource meters live, and hands the caller a parchment content
 *   area to fill.
 *
 * The frame grows vertically: bands pin to the top and bottom edges, side
 * rails repeat between the corners, gems center on the rails, flourishes pin
 * to their corners. Width is fixed at FRAME_WIDTH * scale.
 *
 * Art arrives by injection (FramedPanelArt of image URLs): runtime-core never
 * imports image files, the host target bundles them. With no art the panel
 * degrades to a plain painted-with-CSS box so the player can keep playing.
 *
 * Exports:
 *   - FramedPanelArt, FramedPanelOptions, FramedPanel, createFramedPanel
 *   - everything from ./geometry
 *
 * Relationships:
 *   - Geometry (cut table, meter rects, band composition) lives in
 *     ./geometry, which is pure and tested.
 *   - The caster spell menu (../caster/SpellMenuUI.ts) and the item view
 *     build on this.
 *
 * Status: active
 */

import {
  BOTTOM_BAND_HEIGHT,
  CONTENT_INSETS,
  CORNER_HEIGHT,
  FRAME_ORIGIN,
  FRAME_SHEET,
  FRAME_SLICES,
  FRAME_WIDTH,
  FRAME_NATURAL_HEIGHT,
  MEDALLION_CIRCLE,
  METER_RECTS,
  TOP_BAND_HEIGHT,
  bottomBandSegments,
  clampRatio,
  frameHeightForContent,
  sliceHeight,
  sliceWidth,
  topBandSegments,
  type FrameSliceName
} from "./geometry";

export * from "./geometry";

/**
 * Image URLs for the frame art. The sheet carries every fixed piece; the
 * repeating/stretching pieces need standalone files because CSS tiles a
 * whole image, never a sheet sub-region. The parchment file is the
 * parchment cut mirrored into a 2x2 quilt (tile edges always match).
 */
export interface FramedPanelArt {
  sheetUrl: string;
  railLeftUrl: string;
  railRightUrl: string;
  topStretchUrl: string;
  bottomStretchUrl: string;
  parchmentUrl: string;
}

export interface FramedPanelOptions {
  /** Null renders the CSS fallback panel (runtime degrades, logs once). */
  art: FramedPanelArt | null;
  /** Show the battery/resonance hardware and live fills. Default false. */
  showMeters?: boolean;
  /**
   * SVG markup drawn on a disc covering the medallion's baked star glyph.
   * Null keeps the star (the caster panel). A future framed panel (e.g. a
   * re-skinned inventory list) passes its own glyph here.
   */
  medallionCoverSvg?: string | null;
  /** Display pixels per source pixel. Default 0.45. */
  scale?: number;
}

export interface FramedPanelMeters {
  /** 0..1; values outside clamp. */
  batteryRatio: number;
  /** 0..1; values outside clamp. */
  resonanceRatio: number;
  /** Text inside the pills, e.g. "80%". Empty string hides the label. */
  batteryLabel: string;
  resonanceLabel: string;
}

export interface FramedPanel {
  /** The framed panel. The caller owns placement (position, margins). */
  element: HTMLElement;
  /** Parchment content area between the pinstripes. The caller fills it. */
  content: HTMLElement;
  /** Update the meter fills and labels. No-op when showMeters is false. */
  setMeters: (meters: FramedPanelMeters) => void;
  /**
   * Size the panel so the content area gets `contentDisplayHeight` display
   * pixels, floored at the frame's natural proportions and capped at
   * `maxDisplayHeight` (content then scrolls).
   */
  setContentHeight: (
    contentDisplayHeight: number,
    maxDisplayHeight: number
  ) => void;
  dispose: () => void;
}

function injectStyles(): void {
  if (document.getElementById("sm-framed-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "sm-framed-panel-styles";
  style.textContent = `
    .sm-framed-panel {
      position: relative;
      overflow: hidden;
      flex: none;
    }
    .sm-framed-panel-piece {
      position: absolute;
      background-repeat: no-repeat;
      pointer-events: none;
    }
    .sm-framed-panel-band {
      position: absolute;
      left: 0;
      right: 0;
      display: flex;
      pointer-events: none;
    }
    .sm-framed-panel-band .sm-framed-panel-piece {
      position: relative;
      flex: none;
    }
    .sm-framed-panel-band .sm-framed-panel-stretch {
      /* Zero basis: at natural width the fixed segments already sum to the
         panel width; stretches only take room when segments are omitted or
         the panel is wider. The strip image scales, never tiles. */
      flex: 1 1 0;
      min-width: 0;
      background-size: 100% 100% !important;
    }
    .sm-framed-panel-meter {
      position: absolute;
      overflow: hidden;
      background: linear-gradient(180deg, #170b26 0%, #241238 45%, #2e1847 100%);
      box-shadow: inset 0 3px 6px rgba(0, 0, 0, 0.6);
    }
    .sm-framed-panel-meter-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      background: linear-gradient(180deg, #d9a8ff 0%, #a44ce8 22%, #7c22d6 55%, #5c0fb0 100%);
      box-shadow: inset 0 -4px 8px rgba(0, 0, 0, 0.25), inset 0 2px 3px rgba(255, 255, 255, 0.55);
      transition: width 200ms ease;
    }
    .sm-framed-panel-meter-label {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 700;
      font-family: "Avenir Next", Nunito, system-ui, sans-serif;
      text-shadow: 0 2px 3px rgba(0, 0, 0, 0.55);
      pointer-events: none;
    }
    .sm-framed-panel-medallion-cover {
      position: absolute;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 38%, #46256b 0%, #331a52 55%, #22103a 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .sm-framed-panel-medallion-cover svg {
      width: 58%;
      height: 58%;
    }
    .sm-framed-panel-content {
      position: absolute;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
    }
    /* Fallback when no art is injected: a plain warm panel. */
    .sm-framed-panel-fallback {
      border-radius: 18px;
      border: 3px solid #7a5a2e;
      background: linear-gradient(180deg, #f0dcb6, #e6cda0);
      box-shadow: 0 24px 72px rgba(0, 0, 0, 0.45);
    }
  `;
  document.head.appendChild(style);
}

let warnedMissingArt = false;

export function createFramedPanel(
  parent: HTMLElement,
  options: FramedPanelOptions
): FramedPanel {
  injectStyles();

  const scale = options.scale ?? 0.45;
  const showMeters = options.showMeters ?? false;
  const px = (sourcePx: number) => `${sourcePx * scale}px`;

  const element = document.createElement("div");
  element.className = "sm-framed-panel";
  element.style.width = px(FRAME_WIDTH);
  element.style.height = px(FRAME_NATURAL_HEIGHT);
  element.style.borderRadius = px(66);

  const content = document.createElement("div");
  content.className = "sm-framed-panel-content";
  content.style.top = px(CONTENT_INSETS.top);
  content.style.right = px(CONTENT_INSETS.right);
  content.style.bottom = px(CONTENT_INSETS.bottom);
  content.style.left = px(CONTENT_INSETS.left);

  const art = options.art;
  if (!art && !warnedMissingArt) {
    warnedMissingArt = true;
    console.warn(
      "[framed-panel] no frame art injected; rendering the plain fallback panel"
    );
  }

  let meterFills: {
    battery: HTMLElement;
    resonance: HTMLElement;
    batteryLabel: HTMLElement;
    resonanceLabel: HTMLElement;
  } | null = null;

  if (art) {
    buildFrame();
  } else {
    element.classList.add("sm-framed-panel-fallback");
    if (showMeters) buildFallbackMeters();
  }
  element.appendChild(content);
  parent.appendChild(element);

  function sheetPiece(name: FrameSliceName): HTMLElement {
    const cut = FRAME_SLICES[name];
    const piece = document.createElement("div");
    piece.className = "sm-framed-panel-piece";
    piece.style.width = px(cut.x1 - cut.x0);
    piece.style.height = px(cut.y1 - cut.y0);
    piece.style.backgroundImage = `url("${art!.sheetUrl}")`;
    piece.style.backgroundSize = `${px(FRAME_SHEET.width)} ${px(FRAME_SHEET.height)}`;
    piece.style.backgroundPosition = `${px(-cut.x0)} ${px(-cut.y0)}`;
    return piece;
  }

  function filePiece(name: FrameSliceName, url: string): HTMLElement {
    const piece = document.createElement("div");
    piece.className = "sm-framed-panel-piece";
    piece.style.width = px(sliceWidth(name));
    piece.style.height = px(sliceHeight(name));
    piece.style.backgroundImage = `url("${url}")`;
    piece.style.backgroundSize = `${px(sliceWidth(name))} ${px(sliceHeight(name))}`;
    return piece;
  }

  function place(
    piece: HTMLElement,
    styles: Partial<CSSStyleDeclaration>
  ): HTMLElement {
    Object.assign(piece.style, styles);
    return piece;
  }

  function buildFrame(): void {
    const frameArt = art!;

    // Parchment fill behind everything. The quilt file is 2x the cut.
    const parchment = document.createElement("div");
    parchment.className = "sm-framed-panel-piece";
    Object.assign(parchment.style, {
      left: px(24),
      top: px(40),
      right: px(24),
      bottom: px(40),
      borderRadius: px(60),
      backgroundImage: `url("${frameArt.parchmentUrl}")`,
      backgroundRepeat: "repeat",
      backgroundSize: `${px(sliceWidth("parchment") * 2)} ${px(sliceHeight("parchment") * 2)}`
    });
    element.appendChild(parchment);

    // Corner flourishes: top pair pins to the top, bottom pair to the
    // bottom. With the meters hidden the top pair uses the trimmed cuts
    // (see the slice table) so no meter-hardware pixels ghost through.
    const flourishTL: FrameSliceName = showMeters
      ? "flourishTL"
      : "flourishTLNoMeters";
    const flourishTR: FrameSliceName = showMeters
      ? "flourishTR"
      : "flourishTRNoMeters";
    const flourishes: Array<[FrameSliceName, Partial<CSSStyleDeclaration>]> = [
      [flourishTL, { left: px(FRAME_SLICES[flourishTL].x0 - FRAME_ORIGIN.x), top: px(FRAME_SLICES[flourishTL].y0 - FRAME_ORIGIN.y) }],
      [flourishTR, { right: px(FRAME_WIDTH - (FRAME_SLICES[flourishTR].x1 - FRAME_ORIGIN.x)), top: px(FRAME_SLICES[flourishTR].y0 - FRAME_ORIGIN.y) }],
      ["flourishBL", { left: px(FRAME_SLICES.flourishBL.x0 - FRAME_ORIGIN.x), bottom: px(FRAME_NATURAL_HEIGHT - (FRAME_SLICES.flourishBL.y1 - FRAME_ORIGIN.y)) }],
      ["flourishBR", { right: px(FRAME_WIDTH - (FRAME_SLICES.flourishBR.x1 - FRAME_ORIGIN.x)), bottom: px(FRAME_NATURAL_HEIGHT - (FRAME_SLICES.flourishBR.y1 - FRAME_ORIGIN.y)) }]
    ];
    for (const [name, styles] of flourishes) {
      element.appendChild(place(sheetPiece(name), styles));
    }

    // Side rails repeat between the corners at any panel height.
    element.appendChild(
      place(filePiece("railLeft", frameArt.railLeftUrl), {
        left: "0",
        top: px(CORNER_HEIGHT),
        bottom: px(CORNER_HEIGHT),
        height: "auto",
        backgroundRepeat: "repeat-y"
      })
    );
    element.appendChild(
      place(filePiece("railRight", frameArt.railRightUrl), {
        right: "0",
        top: px(CORNER_HEIGHT),
        bottom: px(CORNER_HEIGHT),
        height: "auto",
        backgroundRepeat: "repeat-y"
      })
    );

    // Side gems stay centered on the rails.
    element.appendChild(
      place(sheetPiece("gemLeft"), {
        left: "0",
        top: "50%",
        transform: "translateY(-50%)"
      })
    );
    element.appendChild(
      place(sheetPiece("gemRight"), {
        right: "0",
        top: "50%",
        transform: "translateY(-50%)"
      })
    );

    // Without the meter hardware the stretch strips are wood-only and the
    // baked top pinstripe only survives inside the corner flourishes and
    // the medallion cut; this line fills the spans between them.
    if (!showMeters) {
      const pinstripe = document.createElement("div");
      pinstripe.className = "sm-framed-panel-piece";
      Object.assign(pinstripe.style, {
        left: px(300),
        right: px(300),
        top: px(145),
        height: `${Math.max(1, 1.5 * scale)}px`,
        background: "rgba(150, 100, 160, 0.35)"
      });
      element.appendChild(pinstripe);
    }

    // Top and bottom bands.
    const topBand = document.createElement("div");
    topBand.className = "sm-framed-panel-band";
    topBand.style.top = "0";
    topBand.style.height = px(TOP_BAND_HEIGHT);
    // Strip pieces are shorter than the band (wood only); pin them to the
    // band's top edge instead of letting flex stretch distort them.
    topBand.style.alignItems = "flex-start";
    for (const segment of topBandSegments(showMeters)) {
      const piece = segment.stretch
        ? filePiece(segment.slice, frameArt.topStretchUrl)
        : sheetPiece(segment.slice);
      if (segment.stretch) piece.classList.add("sm-framed-panel-stretch");
      topBand.appendChild(piece);
    }
    element.appendChild(topBand);

    const bottomBand = document.createElement("div");
    bottomBand.className = "sm-framed-panel-band";
    bottomBand.style.bottom = "0";
    bottomBand.style.height = px(BOTTOM_BAND_HEIGHT);
    bottomBand.style.alignItems = "flex-end";
    for (const segment of bottomBandSegments()) {
      const piece = segment.stretch
        ? filePiece(segment.slice, frameArt.bottomStretchUrl)
        : sheetPiece(segment.slice);
      if (segment.stretch) piece.classList.add("sm-framed-panel-stretch");
      bottomBand.appendChild(piece);
    }
    element.appendChild(bottomBand);

    if (showMeters) buildMeters();

    if (options.medallionCoverSvg) {
      const cover = document.createElement("div");
      cover.className = "sm-framed-panel-medallion-cover";
      Object.assign(cover.style, {
        left: px(MEDALLION_CIRCLE.cx - MEDALLION_CIRCLE.r),
        top: px(MEDALLION_CIRCLE.cy - MEDALLION_CIRCLE.r),
        width: px(MEDALLION_CIRCLE.r * 2),
        height: px(MEDALLION_CIRCLE.r * 2)
      });
      cover.innerHTML = options.medallionCoverSvg;
      element.appendChild(cover);
    }
  }

  interface MeterRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  function buildMeterPair(rects: {
    battery: MeterRect;
    resonance: MeterRect;
  }): void {
    const build = (rect: MeterRect) => {
      const meter = document.createElement("div");
      meter.className = "sm-framed-panel-meter";
      Object.assign(meter.style, {
        left: px(rect.x),
        top: px(rect.y),
        width: px(rect.width),
        height: px(rect.height),
        borderRadius: px(rect.height / 2)
      });
      const fill = document.createElement("div");
      fill.className = "sm-framed-panel-meter-fill";
      fill.style.borderRadius = px(rect.height / 2);
      fill.style.width = "0%";
      const label = document.createElement("div");
      label.className = "sm-framed-panel-meter-label";
      label.style.fontSize = px(30);
      meter.appendChild(fill);
      meter.appendChild(label);
      element.appendChild(meter);
      return { fill, label };
    };
    const battery = build(rects.battery);
    const resonance = build(rects.resonance);
    meterFills = {
      battery: battery.fill,
      batteryLabel: battery.label,
      resonance: resonance.fill,
      resonanceLabel: resonance.label
    };
  }

  function buildMeters(): void {
    buildMeterPair(METER_RECTS);
  }

  /** Fallback meters sit at the top of the plain panel. */
  function buildFallbackMeters(): void {
    buildMeterPair({
      battery: { x: METER_RECTS.battery.x, y: 24, width: METER_RECTS.battery.width, height: METER_RECTS.battery.height },
      resonance: { x: METER_RECTS.resonance.x, y: 24, width: METER_RECTS.resonance.width, height: METER_RECTS.resonance.height }
    });
  }

  return {
    element,
    content,
    setMeters(meters) {
      if (!meterFills) return;
      meterFills.battery.style.width = `${clampRatio(meters.batteryRatio) * 100}%`;
      meterFills.resonance.style.width = `${clampRatio(meters.resonanceRatio) * 100}%`;
      meterFills.batteryLabel.textContent = meters.batteryLabel;
      meterFills.resonanceLabel.textContent = meters.resonanceLabel;
    },
    setContentHeight(contentDisplayHeight, maxDisplayHeight) {
      const desiredSource = frameHeightForContent(contentDisplayHeight / scale);
      const display = Math.min(desiredSource * scale, maxDisplayHeight);
      element.style.height = `${display}px`;
    },
    dispose() {
      element.remove();
    }
  };
}
