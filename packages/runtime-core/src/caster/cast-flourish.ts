/**
 * packages/runtime-core/src/caster/cast-flourish.ts
 *
 * Purpose: The "I cast a spell!" feedback that plays when a spell slot is
 *   clicked in the caster menu, before the menu closes.
 *
 * The sequence (times from the click):
 *   Press   0-100ms   the slot squishes to ~92% like a physical button.
 *   Charge  100-300ms purple light races around the slot's border while a
 *                     few purple/gold sparks pull INWARD to its center.
 *   Cast    ~300ms    the slot pops back (slight overshoot) and emits one
 *                     soft purple ring that expands ~1.5x and fades.
 *   Grow    300-600ms a glowing four-point star grows out of the slot's
 *                     center, brightening as it swells past the slot.
 *   Burst   600-1050ms the star explodes: feathered petal rays (magenta and
 *                     cyan), long teal streaks, dotted particle trails,
 *                     twinkling gold stars, and soft violet cloud puffs, all
 *                     scattering outward and fading.
 *
 * The cloud puffs are blurred CSS gradients - a stand-in until a real
 * shader-driven cloud pass replaces them; the rest is intended to ship.
 *
 * playCastFlourish resolves when the burst fades (bounded by a timeout in
 * case animations never run), so the caller can close the menu afterwards.
 *
 * Exports:
 *   - CAST_FLOURISH_TIMINGS, playCastFlourish
 *   - fourPointStarPoints, burstDirections, hash01 (pure, tested)
 *
 * Relationships:
 *   - Driven by ../caster/SpellMenuUI.ts on a successful cast.
 *   - Pure presentation: no game state, no spell knowledge.
 *
 * Status: active
 */

/** Phase lengths in ms. Grow starts when cast pops (press + charge). */
export const CAST_FLOURISH_TIMINGS = {
  press: 100,
  charge: 200,
  cast: 250,
  grow: 300,
  burst: 450,
  /** Hard bound on the whole flourish; the promise resolves by then. */
  total: 1200
} as const;

export interface FlourishPoint {
  x: number;
  y: number;
}

/**
 * Scatter directions for the burst: `count` unit vectors evenly spaced
 * around the circle, rotated by a fixed offset so no star flies straight
 * up (an axis-aligned scatter reads mechanical).
 */
export function burstDirections(count: number): FlourishPoint[] {
  const offset = Math.PI / count + 0.35;
  return Array.from({ length: count }, (_, index) => {
    const angle = offset + (index * 2 * Math.PI) / count;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
}

/**
 * Deterministic pseudo-random in [0, 1) from an integer seed. Same recipe
 * as the dialogue paper panel: every cast renders the same burst, which
 * keeps a 450ms effect debuggable.
 */
export function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * SVG polygon points for a four-point sparkle star centered on (cx, cy):
 * long spikes on the axes (outer), short shoulders on the diagonals
 * (inner). Eight vertices.
 */
export function fourPointStarPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number
): string {
  const d = inner * Math.SQRT1_2;
  const points: Array<[number, number]> = [
    [cx, cy - outer],
    [cx + d, cy - d],
    [cx + outer, cy],
    [cx + d, cy + d],
    [cx, cy + outer],
    [cx - d, cy + d],
    [cx - outer, cy],
    [cx - d, cy - d]
  ];
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PURPLE = "#a44ce8";
const PURPLE_SOFT = "rgba(164, 76, 232, 0.75)";
const GOLD = "#e8b93f";
/* Burst palette, matched to the reference clip: hot magenta star, violet
   glow, cyan/teal streaks, gold twinkles. */
const MAGENTA = "#ff5fd7";
const MAGENTA_SOFT = "rgba(255, 95, 215, 0.75)";
const VIOLET = "#7b3ff2";
const CYAN = "#4de3ff";
const TEAL = "#35e0d6";
const GOLD_BRIGHT = "#ffd86b";

function starSvg(size: number, core: string, glowColor = PURPLE_SOFT): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", `${size}`);
  svg.setAttribute("height", `${size}`);
  svg.style.overflow = "visible";
  const glow = document.createElementNS(SVG_NS, "polygon");
  glow.setAttribute("points", fourPointStarPoints(12, 12, 11, 3.4));
  glow.setAttribute("fill", glowColor);
  glow.style.filter = "blur(2.5px)";
  const body = document.createElementNS(SVG_NS, "polygon");
  body.setAttribute("points", fourPointStarPoints(12, 12, 9, 2.8));
  body.setAttribute("fill", core);
  svg.append(glow, body);
  return svg;
}

export interface CastFlourishInput {
  /** The clicked spell slot. Squish/pop run on it directly. */
  slot: HTMLElement;
  /**
   * The overlay the flourish draws in; spawned elements live in a
   * disposable child of this layer, positioned relative to it.
   */
  layer: HTMLElement;
}

/** Plays the whole sequence; resolves when it is over (bounded). */
export function playCastFlourish(input: CastFlourishInput): Promise<void> {
  const T = CAST_FLOURISH_TIMINGS;
  const layerRect = input.layer.getBoundingClientRect();
  const slotRect = input.slot.getBoundingClientRect();
  const slotCenter: FlourishPoint = {
    x: slotRect.left - layerRect.left + slotRect.width / 2,
    y: slotRect.top - layerRect.top + slotRect.height / 2
  };

  // Everything spawned lives here and dies together.
  const stage = document.createElement("div");
  Object.assign(stage.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "10"
  });
  input.layer.appendChild(stage);

  // Press, then pop with a slight overshoot at cast time.
  input.slot.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(0.92)", offset: (T.press + T.charge) / (T.press + T.charge + 180) },
      { transform: "scale(1.06)" },
      { transform: "scale(1)" }
    ],
    { duration: T.press + T.charge + 180, easing: "ease-out" }
  );

  // Charge: light races around the slot border.
  const race = document.createElementNS(SVG_NS, "svg");
  Object.assign(race.style, {
    position: "absolute",
    left: `${slotCenter.x - slotRect.width / 2}px`,
    top: `${slotCenter.y - slotRect.height / 2}px`,
    overflow: "visible"
  });
  race.setAttribute("width", `${slotRect.width}`);
  race.setAttribute("height", `${slotRect.height}`);
  const border = document.createElementNS(SVG_NS, "rect");
  border.setAttribute("x", "1.5");
  border.setAttribute("y", "1.5");
  border.setAttribute("width", `${slotRect.width - 3}`);
  border.setAttribute("height", `${slotRect.height - 3}`);
  border.setAttribute("rx", "12");
  border.setAttribute("fill", "none");
  border.setAttribute("stroke", PURPLE);
  border.setAttribute("stroke-width", "3");
  border.setAttribute("pathLength", "100");
  border.setAttribute("stroke-dasharray", "32 68");
  border.style.filter = `drop-shadow(0 0 4px ${PURPLE_SOFT})`;
  race.appendChild(border);
  stage.appendChild(race);
  border.animate(
    [
      { strokeDashoffset: "0", opacity: "0" },
      { opacity: "1", offset: 0.2 },
      { strokeDashoffset: "-200", opacity: "1", offset: 0.9 },
      { strokeDashoffset: "-220", opacity: "0" }
    ],
    { delay: T.press, duration: T.charge + 120, easing: "ease-in", fill: "both" }
  );

  // Charge: sparks pull inward toward the slot center.
  const sparkAngles = [30, 105, 195, 260, 330];
  sparkAngles.forEach((angle, index) => {
    const radians = (angle * Math.PI) / 180;
    const radius = slotRect.width * 0.75;
    const spark = document.createElement("div");
    Object.assign(spark.style, {
      position: "absolute",
      left: `${slotCenter.x + Math.cos(radians) * radius}px`,
      top: `${slotCenter.y + Math.sin(radians) * radius}px`,
      width: "4px",
      height: "4px",
      borderRadius: "999px",
      background: index % 2 === 0 ? PURPLE : GOLD,
      boxShadow: `0 0 6px ${index % 2 === 0 ? PURPLE_SOFT : "rgba(232, 185, 63, 0.7)"}`,
      opacity: "0"
    });
    stage.appendChild(spark);
    spark.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: "0" },
        { opacity: "1", offset: 0.25 },
        {
          transform: `translate(${(slotCenter.x - parseFloat(spark.style.left)).toFixed(1)}px, ${(slotCenter.y - parseFloat(spark.style.top)).toFixed(1)}px) scale(0.4)`,
          opacity: "0"
        }
      ],
      {
        delay: T.press + index * 25,
        duration: T.charge,
        easing: "cubic-bezier(0.5, 0, 0.9, 0.6)",
        fill: "both"
      }
    );
  });

  // Cast: one soft ring expands ~1.5x beyond the slot and fades.
  const castAt = T.press + T.charge;
  const ringSize = slotRect.width;
  const ring = document.createElement("div");
  Object.assign(ring.style, {
    position: "absolute",
    left: `${slotCenter.x - ringSize / 2}px`,
    top: `${slotCenter.y - ringSize / 2}px`,
    width: `${ringSize}px`,
    height: `${ringSize}px`,
    borderRadius: "999px",
    border: `2.5px solid ${PURPLE_SOFT}`,
    boxShadow: `0 0 14px ${PURPLE_SOFT}, inset 0 0 10px rgba(164, 76, 232, 0.35)`,
    opacity: "0"
  });
  stage.appendChild(ring);
  ring.animate(
    [
      { transform: "scale(0.9)", opacity: "0" },
      { opacity: "0.9", offset: 0.2 },
      { transform: "scale(1.55)", opacity: "0" }
    ],
    { delay: castAt, duration: T.cast, easing: "ease-out", fill: "both" }
  );

  // Grow: the star swells out of the slot's center, brightening, with a
  // whisper of rotation so it reads as magic rather than a zoom. A soft
  // violet halo breathes behind it (the reference star sits on a blue-violet
  // bloom).
  const haloSize = 60;
  const halo = document.createElement("div");
  Object.assign(halo.style, {
    position: "absolute",
    left: `${slotCenter.x - haloSize / 2}px`,
    top: `${slotCenter.y - haloSize / 2}px`,
    width: `${haloSize}px`,
    height: `${haloSize}px`,
    borderRadius: "999px",
    background: `radial-gradient(circle, ${MAGENTA_SOFT} 0%, rgba(123, 63, 242, 0.55) 40%, rgba(123, 63, 242, 0) 72%)`,
    filter: "blur(3px)",
    opacity: "0"
  });
  stage.appendChild(halo);
  halo.animate(
    [
      { transform: "scale(0.3)", opacity: "0" },
      { transform: "scale(1.15)", opacity: "0.9", offset: 0.55 },
      { transform: "scale(1.7)", opacity: "0" }
    ],
    { delay: castAt, duration: T.grow + 100, easing: "ease-out", fill: "both" }
  );

  const growSize = 28;
  const star = starSvg(growSize, "#ffffff", MAGENTA_SOFT);
  Object.assign(star.style, {
    position: "absolute",
    left: `${slotCenter.x - growSize / 2}px`,
    top: `${slotCenter.y - growSize / 2}px`,
    opacity: "0"
  });
  stage.appendChild(star);
  star.animate(
    [
      { transform: "scale(0.15) rotate(0deg)", opacity: "0" },
      { opacity: "1", offset: 0.25 },
      { transform: "scale(3.1) rotate(24deg)", opacity: "1" },
      // A last quick swell-and-vanish so the burst reads as the star
      // popping, not the star being swapped out.
      { transform: "scale(3.6) rotate(28deg)", opacity: "0" }
    ],
    {
      delay: castAt,
      duration: T.grow + 80,
      easing: "cubic-bezier(0.3, 0, 0.7, 1)",
      fill: "both"
    }
  );

  // Burst. Layered to chase the reference clip: cloud puffs behind,
  // feathered petal rays, teal streaks, dotted particle trails, gold
  // twinkles, and a white flash at the pop. Every element sits at the slot
  // center and animates outward with transform-origin at its base.
  const burstAt = castAt + T.grow;
  const R = slotRect.width; // burst length unit; the whole thing spans ~3R
  let lastBurstAnimation: Animation | null = null;

  /** A div pinned so its BOTTOM CENTER sits on the slot center, rotated
   *  outward; growing scaleY makes it shoot from the middle. */
  const spoke = (
    angleDeg: number,
    width: number,
    length: number,
    css: Partial<CSSStyleDeclaration>
  ): HTMLElement => {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "absolute",
      left: `${slotCenter.x - width / 2}px`,
      top: `${slotCenter.y - length}px`,
      width: `${width}px`,
      height: `${length}px`,
      transformOrigin: "50% 100%",
      opacity: "0",
      ...css
    });
    el.style.rotate = `${angleDeg}deg`;
    stage.appendChild(el);
    return el;
  };

  // Cloud puffs: blurred violet/blue gradients drifting outward. Stand-in
  // until the shader cloud pass.
  const puffDirections = burstDirections(6);
  puffDirections.forEach((direction, index) => {
    const size = R * (0.7 + hash01(index + 1) * 0.6);
    const drift = R * (0.5 + hash01(index + 11) * 0.5);
    const puff = document.createElement("div");
    const color = index % 2 === 0 ? "91, 59, 214" : "123, 63, 242";
    Object.assign(puff.style, {
      position: "absolute",
      left: `${slotCenter.x - size / 2}px`,
      top: `${slotCenter.y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "999px",
      background: `radial-gradient(circle, rgba(${color}, 0.55) 0%, rgba(${color}, 0) 70%)`,
      filter: "blur(10px)",
      opacity: "0"
    });
    stage.appendChild(puff);
    puff.animate(
      [
        { transform: "translate(0, 0) scale(0.3)", opacity: "0" },
        { opacity: "0.75", offset: 0.25 },
        {
          transform: `translate(${(direction.x * drift).toFixed(1)}px, ${(direction.y * drift).toFixed(1)}px) scale(1.35)`,
          opacity: "0"
        }
      ],
      { delay: burstAt, duration: T.burst, easing: "ease-out", fill: "both" }
    );
  });

  // Feathered petal rays: soft tapered blades, magenta and cyan alternating,
  // varied length, slightly blurred so they read painted rather than drawn.
  const petalCount = 12;
  for (let index = 0; index < petalCount; index++) {
    const angle = (index * 360) / petalCount + hash01(index + 21) * 18;
    const long = index % 2 === 0;
    const length = R * (long ? 1.3 : 0.8) * (0.85 + hash01(index + 31) * 0.4);
    const width = long ? 10 : 16;
    const color = index % 3 === 0 ? MAGENTA : index % 3 === 1 ? CYAN : VIOLET;
    const petal = spoke(angle, width, length, {
      background: `linear-gradient(to top, transparent 0%, ${color} 45%, #ffffff 92%)`,
      borderRadius: "50% 50% 50% 50% / 70% 70% 30% 30%",
      filter: "blur(1.5px)"
    });
    lastBurstAnimation = petal.animate(
      [
        { transform: "scaleY(0.1) scaleX(0.6)", opacity: "0" },
        { transform: "scaleY(1) scaleX(1)", opacity: "0.95", offset: 0.3 },
        { transform: "scaleY(1.25) scaleX(0.7)", opacity: "0" }
      ],
      {
        delay: burstAt + hash01(index + 41) * 40,
        duration: T.burst,
        easing: "cubic-bezier(0.15, 0.7, 0.4, 1)",
        fill: "both"
      }
    );
  }

  // Teal streaks: long thin shooting lines, a beat behind the petals.
  const streakCount = 8;
  for (let index = 0; index < streakCount; index++) {
    const angle = (index * 360) / streakCount + 12 + hash01(index + 51) * 24;
    const length = R * (1.5 + hash01(index + 61) * 0.9);
    const streak = spoke(angle, 3, length, {
      background: `linear-gradient(to top, transparent 0%, ${index % 2 === 0 ? TEAL : CYAN} 55%, #eafffc 95%)`,
      borderRadius: "999px",
      boxShadow: `0 0 6px rgba(53, 224, 214, 0.6)`
    });
    streak.animate(
      [
        { transform: "scaleY(0.05)", opacity: "0" },
        { transform: "scaleY(0.9)", opacity: "1", offset: 0.45 },
        { transform: "scaleY(1.15)", opacity: "0" }
      ],
      {
        delay: burstAt + 60 + hash01(index + 71) * 60,
        duration: T.burst - 60,
        easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
        fill: "both"
      }
    );
  }

  // Dotted particle trails: short strings of dots walking outward, each dot
  // a little later and a little farther than the last.
  const trailDirections = burstDirections(5);
  trailDirections.forEach((direction, trailIndex) => {
    const tilt = hash01(trailIndex + 81) * 0.5 - 0.25;
    const dx = direction.x + tilt * -direction.y;
    const dy = direction.y + tilt * direction.x;
    const dots = 5;
    for (let dot = 0; dot < dots; dot++) {
      const distance = R * (0.5 + (dot / dots) * 1.6);
      const size = 3.5 - dot * 0.4;
      const particle = document.createElement("div");
      Object.assign(particle.style, {
        position: "absolute",
        left: `${slotCenter.x + dx * distance - size / 2}px`,
        top: `${slotCenter.y + dy * distance - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "999px",
        background: "#ffffff",
        boxShadow: `0 0 5px ${MAGENTA_SOFT}`,
        opacity: "0"
      });
      stage.appendChild(particle);
      particle.animate(
        [
          { opacity: "0", transform: "scale(0.5)" },
          { opacity: "0.95", offset: 0.3 },
          { opacity: "0", transform: "scale(0.3)" }
        ],
        {
          delay: burstAt + 90 + dot * 45,
          duration: 240,
          easing: "ease-out",
          fill: "both"
        }
      );
    }
  });

  // Gold and white twinkle stars scattered through the burst.
  const twinkleCount = 9;
  for (let index = 0; index < twinkleCount; index++) {
    const angle = hash01(index + 91) * Math.PI * 2;
    const distance = R * (0.4 + hash01(index + 101) * 1.3);
    const size = 8 + hash01(index + 111) * 10;
    const twinkle = starSvg(
      size,
      index % 3 === 0 ? "#ffffff" : GOLD_BRIGHT,
      "rgba(255, 216, 107, 0.7)"
    );
    Object.assign(twinkle.style, {
      position: "absolute",
      left: `${slotCenter.x + Math.cos(angle) * distance - size / 2}px`,
      top: `${slotCenter.y + Math.sin(angle) * distance - size / 2}px`,
      opacity: "0"
    });
    stage.appendChild(twinkle);
    twinkle.animate(
      [
        { transform: "scale(0.2) rotate(0deg)", opacity: "0" },
        { transform: "scale(1.1) rotate(18deg)", opacity: "1", offset: 0.4 },
        { transform: "scale(0.5) rotate(30deg)", opacity: "0" }
      ],
      {
        delay: burstAt + 40 + hash01(index + 121) * 160,
        duration: 280,
        easing: "ease-out",
        fill: "both"
      }
    );
  }

  // A white-hot flash right at the pop.
  const flash = document.createElement("div");
  const flashSize = R * 1.1;
  Object.assign(flash.style, {
    position: "absolute",
    left: `${slotCenter.x - flashSize / 2}px`,
    top: `${slotCenter.y - flashSize / 2}px`,
    width: `${flashSize}px`,
    height: `${flashSize}px`,
    borderRadius: "999px",
    background:
      "radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(255, 95, 215, 0.5) 40%, rgba(123, 63, 242, 0) 72%)",
    opacity: "0"
  });
  stage.appendChild(flash);
  flash.animate(
    [
      { transform: "scale(0.4)", opacity: "0" },
      { opacity: "0.9", offset: 0.25 },
      { transform: "scale(1.6)", opacity: "0" }
    ],
    { delay: burstAt, duration: 220, easing: "ease-out", fill: "both" }
  );

  // Resolve when the burst ends; bound the wait in case animations never
  // run (hidden tab, display:none ancestor).
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      stage.remove();
      resolve();
    };
    lastBurstAnimation?.finished.then(finish, finish);
    window.setTimeout(finish, T.total);
  });
}
