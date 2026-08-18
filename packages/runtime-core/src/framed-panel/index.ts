/**
 * packages/runtime-core/src/framed-panel/index.ts
 *
 * Purpose: The ornate framed panel used by gameplay overlays (the caster
 *   spell menu on the caster frame, the inventory list on the plain frame).
 *   Assembles a painted frame from sheet cuts per a FrameGeometry, keeps
 *   resource meters live when the geometry has them, and hands the caller a
 *   parchment content area to fill.
 *
 * The frame grows vertically: bands pin to the top and bottom edges, side
 * rails repeat between the corners, gems center on the rails, flourishes pin
 * to their corners. Width is fixed at geometry.frameWidth * scale.
 *
 * Art arrives by injection (FramedPanelArt of image URLs): runtime-core never
 * imports image files, the host target bundles them. With no art the panel
 * degrades to a plain painted-with-CSS box so the player can keep playing.
 *
 * Exports:
 *   - FramedPanelArt, FramedPanelArtSet, FramedPanelOptions, FramedPanel,
 *     createFramedPanel
 *   - everything from ./geometry
 *
 * Relationships:
 *   - Geometry (cut tables, meter rects, band composition) lives in
 *     ./geometry, which is pure and tested.
 *   - The caster spell menu (../caster/SpellMenuUI.ts) and the inventory
 *     list (../inventory) build on this.
 *
 * Status: active
 */

import {
  clampRatio,
  frameHeightForContent,
  REPEATING_SLICE_ART,
  type FrameGeometry,
  type FrameSlice,
  type MeterRect
} from "./geometry";

export * from "./geometry";

/**
 * Image URLs for one frame's art. The sheet carries every fixed piece; the
 * repeating/stretching pieces need standalone files because CSS tiles a
 * whole image, never a sheet sub-region (see REPEATING_SLICE_ART). The
 * parchment file is the parchment cut mirrored into a 2x2 quilt (tile edges
 * always match).
 */
export interface FramedPanelArt {
  sheetUrl: string;
  railLeftUrl: string;
  railRightUrl: string;
  topStretchUrl: string;
  bottomStretchUrl: string;
  parchmentUrl: string;
}

/** The game's frame art, one entry per frame variant. */
export interface FramedPanelArtSet {
  caster: FramedPanelArt;
  plain: FramedPanelArt;
}

export interface FramedPanelOptions {
  /** Null renders the CSS fallback panel (runtime degrades, logs once). */
  art: FramedPanelArt | null;
  /** Which frame to assemble; also decides whether meters exist. */
  geometry: FrameGeometry;
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
  /** Update the meter fills and labels. No-op when the frame has no meters. */
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
      /* Zero basis: when the fixed segments already sum to the panel width
         the stretches collapse; they only take room when the panel is wider
         or the band has few fixed segments. The strip image scales, never
         tiles - tiling a few-pixel strip shreds the wood grain into ribs. */
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

  const geometry = options.geometry;
  const scale = options.scale ?? 0.45;
  const px = (sourcePx: number) => `${sourcePx * scale}px`;

  const element = document.createElement("div");
  element.className = "sm-framed-panel";
  element.style.width = px(geometry.frameWidth);
  element.style.height = px(geometry.naturalHeight);
  element.style.borderRadius = px(66);

  const content = document.createElement("div");
  content.className = "sm-framed-panel-content";
  content.style.top = px(geometry.contentInsets.top);
  content.style.right = px(geometry.contentInsets.right);
  content.style.bottom = px(geometry.contentInsets.bottom);
  content.style.left = px(geometry.contentInsets.left);

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
    if (geometry.meters) buildMeters(geometry.meters, true);
  }
  element.appendChild(content);
  parent.appendChild(element);

  function cut(name: string): FrameSlice {
    const found = geometry.slices[name];
    if (!found) {
      throw new Error(`[framed-panel] geometry has no slice named "${name}"`);
    }
    return found;
  }

  function repeatingUrl(name: string): string | null {
    const field = REPEATING_SLICE_ART[name as keyof typeof REPEATING_SLICE_ART];
    return field ? art![field] : null;
  }

  function piece(name: string): HTMLElement {
    const s = cut(name);
    const el = document.createElement("div");
    el.className = "sm-framed-panel-piece";
    el.style.width = px(s.x1 - s.x0);
    el.style.height = px(s.y1 - s.y0);
    const fileUrl = repeatingUrl(name);
    if (fileUrl) {
      el.style.backgroundImage = `url("${fileUrl}")`;
      el.style.backgroundSize = `${px(s.x1 - s.x0)} ${px(s.y1 - s.y0)}`;
    } else {
      el.style.backgroundImage = `url("${art!.sheetUrl}")`;
      el.style.backgroundSize = `${px(geometry.sheet.width)} ${px(geometry.sheet.height)}`;
      el.style.backgroundPosition = `${px(-s.x0)} ${px(-s.y0)}`;
    }
    return el;
  }

  function place(
    el: HTMLElement,
    styles: Partial<CSSStyleDeclaration>
  ): HTMLElement {
    Object.assign(el.style, styles);
    return el;
  }

  function buildBand(
    segments: ReadonlyArray<{ slice: string; stretch: boolean }>,
    styles: Partial<CSSStyleDeclaration>
  ): HTMLElement {
    const band = document.createElement("div");
    band.className = "sm-framed-panel-band";
    Object.assign(band.style, styles);
    for (const segment of segments) {
      const el = piece(segment.slice);
      if (segment.stretch) el.classList.add("sm-framed-panel-stretch");
      band.appendChild(el);
    }
    return band;
  }

  function buildFrame(): void {
    const frameArt = art!;
    const slices = geometry.slices;
    const originX = geometry.origin.x;
    const originY = geometry.origin.y;

    // Parchment fill behind everything. The quilt file is 2x the cut.
    const parchmentCut = cut("parchment");
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
      backgroundSize: `${px((parchmentCut.x1 - parchmentCut.x0) * 2)} ${px((parchmentCut.y1 - parchmentCut.y0) * 2)}`
    });
    element.appendChild(parchment);

    // Corner flourishes: top pair pins to the top, bottom pair to the
    // bottom. Their band-height rows duplicate pixels the band pieces draw
    // on top, source-aligned, so no seams appear.
    const bottomOffset = (name: string) =>
      px(geometry.naturalHeight - (slices[name]!.y1 - originY));
    element.appendChild(
      place(piece("flourishTL"), {
        left: px(slices["flourishTL"]!.x0 - originX),
        top: px(slices["flourishTL"]!.y0 - originY)
      })
    );
    element.appendChild(
      place(piece("flourishTR"), {
        right: px(geometry.frameWidth - (slices["flourishTR"]!.x1 - originX)),
        top: px(slices["flourishTR"]!.y0 - originY)
      })
    );
    element.appendChild(
      place(piece("flourishBL"), {
        left: px(slices["flourishBL"]!.x0 - originX),
        bottom: bottomOffset("flourishBL")
      })
    );
    element.appendChild(
      place(piece("flourishBR"), {
        right: px(geometry.frameWidth - (slices["flourishBR"]!.x1 - originX)),
        bottom: bottomOffset("flourishBR")
      })
    );

    // Side rails repeat between the corners at any panel height.
    element.appendChild(
      place(piece("railLeft"), {
        left: "0",
        top: px(geometry.cornerHeight),
        bottom: px(geometry.cornerHeight),
        height: "auto",
        backgroundRepeat: "repeat-y"
      })
    );
    element.appendChild(
      place(piece("railRight"), {
        right: "0",
        top: px(geometry.cornerHeight),
        bottom: px(geometry.cornerHeight),
        height: "auto",
        backgroundRepeat: "repeat-y"
      })
    );

    // Side gems stay centered on the rails.
    element.appendChild(
      place(piece("gemLeft"), {
        left: "0",
        top: "50%",
        transform: "translateY(-50%)"
      })
    );
    element.appendChild(
      place(piece("gemRight"), {
        right: "0",
        top: "50%",
        transform: "translateY(-50%)"
      })
    );

    element.appendChild(
      buildBand(geometry.topBand, {
        top: "0",
        height: px(geometry.topBandHeight),
        // Strip pieces may be shorter than the band (wood only); pin them
        // to the band's top edge instead of letting flex stretch distort.
        alignItems: "flex-start"
      })
    );
    element.appendChild(
      buildBand(geometry.bottomBand, {
        bottom: "0",
        height: px(geometry.bottomBandHeight),
        alignItems: "flex-end"
      })
    );

    if (geometry.meters) buildMeters(geometry.meters, false);
  }

  function buildMeters(
    rects: { battery: MeterRect; resonance: MeterRect },
    fallbackLayout: boolean
  ): void {
    const build = (rect: MeterRect) => {
      const meter = document.createElement("div");
      meter.className = "sm-framed-panel-meter";
      Object.assign(meter.style, {
        left: px(rect.x),
        // Fallback panels have no painted top band; park the meters at the top.
        top: px(fallbackLayout ? 24 : rect.y),
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
      const desiredSource = frameHeightForContent(
        geometry,
        contentDisplayHeight / scale
      );
      const display = Math.min(desiredSource * scale, maxDisplayHeight);
      element.style.height = `${display}px`;
    },
    dispose() {
      element.remove();
    }
  };
}
