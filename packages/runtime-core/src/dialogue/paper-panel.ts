/**
 * packages/runtime-core/src/dialogue/paper-panel.ts
 *
 * Purpose: The torn-paper background for the scripted dialogue box. Produces an
 *   SVG layer that sits behind the panel's content and redraws to fit it.
 *
 * WHY A VECTOR PATH AND NOT AN SVG FILTER
 *   The obvious way to get a deckled edge is `feTurbulence` +
 *   `feDisplacementMap` on a rounded rect. It looks right in a mock and is
 *   wrong in practice: `feDisplacementMap` does not displace GEOMETRY, it
 *   displaces a RASTERISED buffer sampled on the filter's pixel grid, so the
 *   edge is quantised before anything else happens and stair-steps visibly.
 *   Blurring it and re-sharpening the alpha only trades stepping for mush.
 *
 *   So the outline is a real `<path>`. Vector geometry is antialiased by the
 *   rasteriser at full device resolution, at any size and any DPR. Turbulence
 *   still supplies the parchment FILL, where there is no silhouette to
 *   stair-step.
 *
 * WHY THE NOISE IS PERIODIC
 *   The edge offset is fBm over ARC LENGTH built from INTEGER harmonics of the
 *   perimeter. Integer harmonics are what make it close exactly -- sample any
 *   other way and there is a visible seam where the walk started.
 *
 * ROUGHNESS IS FREQUENCY, NOT AMPLITUDE
 *   2.4px of displacement spread over long waves reads "tidy"; the same 2.4px
 *   broken into fibre-scale octaves reads "hand-worn". If this ever looks too
 *   smooth, add octaves before reaching for `amp` -- and note `step` caps what
 *   is representable at all (Nyquist), so raising frequency without lowering
 *   `step` does nothing.
 *
 * Exports:
 *   - createPaperPanel
 *
 * Relationships:
 *   - Pure presentation. No conversation, plugin or language knowledge.
 *   - Values settled in docs/prototypes/paper-dialogue-box-FINAL.html.
 *
 * Status: active
 */

/** Settled in the prototype sheet. See that file before changing any of these. */
const PAPER = {
  amp: 2.4,
  rad: 30,
  step: 2.5,
  rim: 0.16,
  mottle: 0.12,
  harmonics: [
    [2, 1],
    [5, 0.55],
    [11, 0.3],
    [23, 0.16],
    [47, 0.09]
  ] as ReadonlyArray<readonly [number, number]>
};

const SVG_NS = "http://www.w3.org/2000/svg";

function makeEdgeNoise(seed: number): (t: number) => number {
  const phases = PAPER.harmonics.map(
    (_, i) => (Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % (Math.PI * 2)
  );
  return (t) => {
    let value = 0;
    let norm = 0;
    PAPER.harmonics.forEach(([harmonic, amplitude], i) => {
      value += amplitude * Math.sin(2 * Math.PI * harmonic * t + phases[i]!);
      norm += amplitude;
    });
    return value / norm;
  };
}

/**
 * Walks the rounded-rect perimeter, offsetting each sample along the outward
 * normal.
 *
 * The corner ARCS are walked, not skipped. Skipping them lets `Z` join the
 * straight edges with diagonals, which chops the corners off -- it looks like
 * torn cardboard and is the first thing to check if the shape goes wrong.
 */
function deckledPath(width: number, height: number, seed: number): string {
  const samples: Array<[number, number, number, number]> = [];

  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!len) return;
    const count = Math.max(2, Math.round(len / PAPER.step));
    const nx = (y1 - y0) / len;
    const ny = -(x1 - x0) / len;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      samples.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny]);
    }
  };

  const arc = (cx: number, cy: number, a0: number, a1: number): void => {
    const count = Math.max(4, Math.round((Math.abs(a1 - a0) * PAPER.rad) / PAPER.step));
    for (let i = 0; i < count; i++) {
      const a = a0 + (a1 - a0) * (i / count);
      samples.push([
        cx + Math.cos(a) * PAPER.rad,
        cy + Math.sin(a) * PAPER.rad,
        Math.cos(a),
        Math.sin(a)
      ]);
    }
  };

  const r = PAPER.rad;
  const PI = Math.PI;
  line(r, 0, width - r, 0);
  arc(width - r, r, -PI / 2, 0);
  line(width, r, width, height - r);
  arc(width - r, height - r, 0, PI / 2);
  line(width - r, height, r, height);
  arc(r, height - r, PI / 2, PI);
  line(0, height - r, 0, r);
  arc(r, r, PI, 1.5 * PI);

  const noise = makeEdgeNoise(seed);
  const points = samples.map(([x, y, nx, ny], i) => {
    const d = noise(i / samples.length);
    return [x + nx * d * PAPER.amp, y + ny * d * PAPER.amp] as const;
  });

  // Quadratic smoothing through midpoints. Enough to avoid a sawtooth, not so
  // much that it erases the fibre octaves the noise just produced.
  let d = `M ${points[0]![0].toFixed(2)} ${points[0]![1].toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    d += ` Q ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`;
  }
  return `${d} Z`;
}

export interface PaperPanel {
  /** Insert as the FIRST child of the panel so it sits behind the content. */
  element: SVGSVGElement;
  /** Recompute the outline for the panel's current size. */
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

let paperInstanceCount = 0;

/**
 * Builds the paper layer. The caller owns when `resize` is called -- typically
 * from a ResizeObserver on the panel, since the box changes size on every line.
 */
export function createPaperPanel(): PaperPanel {
  // Filter and clip ids must be unique per instance or a second box reuses the
  // first one's turbulence and the two papers become visibly identical.
  const uid = `sm-paper-${++paperInstanceCount}`;
  const seed = paperInstanceCount * 7 + 3;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("sm-dialogue-box-paper");

  svg.innerHTML = `
    <defs>
      <linearGradient id="${uid}-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f9eeda"/>
        <stop offset="0.55" stop-color="#f0dcb6"/>
        <stop offset="1" stop-color="#e6cda0"/>
      </linearGradient>
      <filter id="${uid}-mottle" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.010 0.026" numOctaves="5" seed="${seed}"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="${PAPER.mottle}"/></feComponentTransfer>
      </filter>
      <clipPath id="${uid}-clip"><path d=""/></clipPath>
    </defs>
    <path class="sm-paper-fill" d="" fill="url(#${uid}-fill)"/>
    <g clip-path="url(#${uid}-clip)">
      <rect width="100%" height="100%" filter="url(#${uid}-mottle)" style="mix-blend-mode:multiply"/>
    </g>
    <path class="sm-paper-rim" d="" fill="none" stroke="#a8814a"
          stroke-opacity="${PAPER.rim}" stroke-width="1.5"/>`;

  const fill = svg.querySelector<SVGPathElement>("path.sm-paper-fill")!;
  const rim = svg.querySelector<SVGPathElement>("path.sm-paper-rim")!;
  const clip = svg.querySelector<SVGPathElement>("clipPath path")!;

  let lastW = -1;
  let lastH = -1;

  return {
    element: svg,
    resize(width, height) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      // The box resizes on every line; regenerating an identical path would be
      // wasted string building on the turn the player is waiting for.
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      const d = deckledPath(w, h, seed);
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      fill.setAttribute("d", d);
      rim.setAttribute("d", d);
      clip.setAttribute("d", d);
    },
    dispose() {
      svg.remove();
    }
  };
}
