/**
 * Fireflies pattern-emergence puzzle UI.
 *
 * A self-contained DOM + Canvas-2D overlay. Runtime-core only provides the
 * mount root and input lock; the plugin owns all animation and teardown.
 */

import type { FirefliesDifficulty } from "./config";

export const COHERENCE_PERIOD = 18_000;
export const SWEEP_DURATION = 3_500;
export const AFTERGLOW_DURATION = 2_000;
export const FIREFLIES_PER_PATH = 24;
export const DISTRACTION_FIREFLIES = 35;
export const MAX_ATTEMPTS = 3;

export type FirefliesPuzzleResult = "success" | "fail";

export interface FirefliesPuzzleOptions {
  mountRoot: HTMLElement;
  title: string;
  difficulty: FirefliesDifficulty;
  claimInput: (lockId: string) => void;
  releaseInput: (lockId: string) => void;
  onComplete: (result: FirefliesPuzzleResult) => void;
}

export type FirefliesPuzzleRunner = (
  options: FirefliesPuzzleOptions
) => { dispose: () => void };

type PathKind = "line" | "curve" | "loop" | "figure8" | "spiral" | "zigzag";

interface Point {
  x: number;
  y: number;
}

interface Mote {
  pathIndex: number;
  t: number;
  jitter: Point;
  phase: number;
}

const LOCK_ID = "fireflies-puzzle";
const OPTION_SIZE = 90;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const palette = {
  panel: "rgba(20, 18, 35, 0.96)",
  border: "#7b68ee",
  text: "#f3efff",
  subtext: "#b8aee4",
  firefly: "#ffeb3b",
  fireflyHot: "#ffffcc",
  success: "#4caf50",
  fail: "#e91e63"
};

const difficultyPaths: Record<FirefliesDifficulty, PathKind[]> = {
  easy: ["line", "curve"],
  medium: ["curve", "loop", "zigzag"],
  hard: ["loop", "figure8", "spiral", "zigzag"]
};

const difficultyDecoys: Record<FirefliesDifficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3
};

const difficultySpeed: Record<FirefliesDifficulty, number> = {
  easy: 0.8,
  medium: 1,
  hard: 1.3
};

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pathPoint(kind: PathKind, t: number): Point {
  const u = easeInOut(clamp01(t));
  if (kind === "line") {
    return { x: -0.34 + u * 0.68, y: -0.18 + u * 0.36 };
  }
  if (kind === "curve") {
    const angle = Math.PI * (0.15 + u * 0.7);
    return { x: Math.cos(angle) * 0.34, y: Math.sin(angle) * 0.28 - 0.1 };
  }
  if (kind === "loop") {
    const angle = u * Math.PI * 2;
    return { x: Math.cos(angle) * 0.28, y: Math.sin(angle) * 0.22 };
  }
  if (kind === "figure8") {
    const angle = u * Math.PI * 2;
    return { x: Math.sin(angle) * 0.32, y: Math.sin(angle * 2) * 0.18 };
  }
  if (kind === "spiral") {
    const angle = u * Math.PI * 3.2;
    const radius = 0.06 + u * 0.28;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  const segment = Math.floor(u * 5);
  const local = u * 5 - segment;
  const x = -0.34 + u * 0.68;
  const y = (segment % 2 === 0 ? -0.2 + local * 0.4 : 0.2 - local * 0.4);
  return { x, y };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function createMotes(pathIndex: number, count: number, seed: number): Mote[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, index) => ({
    pathIndex,
    t: (index + random() * 0.45) / count,
    jitter: {
      x: (random() - 0.5) * 0.035,
      y: (random() - 0.5) * 0.035
    },
    phase: random() * Math.PI * 2
  }));
}

function pickPaths(difficulty: FirefliesDifficulty, seed: number): PathKind[] {
  const random = seededRandom(seed);
  const pool = [...difficultyPaths[difficulty]];
  while (pool.length < 4) pool.push(...difficultyPaths[difficulty]);
  return Array.from({ length: 4 }, () => {
    const index = Math.floor(random() * pool.length) % pool.length;
    return pool.splice(index, 1)[0]!;
  });
}

function quadrantOffsets(seed: number): Point[] {
  const random = seededRandom(seed);
  return [
    { x: -0.22, y: -0.16 },
    { x: 0.22, y: -0.16 },
    { x: -0.22, y: 0.16 },
    { x: 0.22, y: 0.16 }
  ]
    .map((point) => ({
      x: point.x + (random() - 0.5) * 0.02,
      y: point.y + (random() - 0.5) * 0.02
    }))
    .sort(() => random() - 0.5);
}

function drawPathPreview(
  canvas: HTMLCanvasElement,
  path: PathKind,
  selected: "none" | "success" | "fail"
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, OPTION_SIZE, OPTION_SIZE);
  context.fillStyle = "rgba(12, 10, 25, 0.9)";
  context.fillRect(0, 0, OPTION_SIZE, OPTION_SIZE);
  context.strokeStyle =
    selected === "success"
      ? palette.success
      : selected === "fail"
        ? palette.fail
        : "rgba(255, 235, 59, 0.78)";
  context.lineWidth = 3;
  context.beginPath();
  for (let i = 0; i <= 80; i += 1) {
    const point = pathPoint(path, i / 80);
    const x = OPTION_SIZE * (0.5 + point.x);
    const y = OPTION_SIZE * (0.5 + point.y);
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function appendStyles(root: HTMLElement): HTMLStyleElement {
  const style = root.ownerDocument.createElement("style");
  style.textContent = `
    .sm-fireflies-overlay {
      position: absolute;
      inset: 0;
      z-index: 6800;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at center, rgba(30,25,50,0.88), rgba(10,8,18,0.92));
      color: ${palette.text};
      font-family: ui-rounded, "Avenir Next", system-ui, sans-serif;
    }
    .sm-fireflies-panel {
      width: 480px;
      max-width: calc(100vw - 32px);
      border: 1px solid ${palette.border};
      border-radius: 18px;
      padding: 18px;
      background: ${palette.panel};
      box-shadow: 0 24px 80px rgba(0,0,0,0.42), 0 0 32px rgba(123,104,238,0.18);
    }
    .sm-fireflies-title { margin: 0 0 12px; font-size: 20px; letter-spacing: 0.04em; }
    .sm-fireflies-main { width: 400px; max-width: 100%; height: 300px; display: block; margin: 0 auto; border-radius: 12px; background: rgb(20,18,35); }
    .sm-fireflies-options { display: grid; grid-template-columns: repeat(4, 90px); gap: 10px; justify-content: center; margin-top: 14px; }
    .sm-fireflies-option { border: 1px solid rgba(123,104,238,0.55); border-radius: 10px; overflow: hidden; padding: 0; background: transparent; cursor: pointer; }
    .sm-fireflies-option:focus { outline: 2px solid ${palette.fireflyHot}; outline-offset: 2px; }
    .sm-fireflies-status { min-height: 22px; margin-top: 12px; color: ${palette.subtext}; text-align: center; }
    .sm-fireflies-attempts { display: flex; justify-content: center; gap: 8px; margin-top: 10px; }
    .sm-fireflies-dot { width: 8px; height: 8px; border-radius: 999px; background: ${palette.firefly}; box-shadow: 0 0 10px rgba(255,235,59,0.8); opacity: 0.9; }
    .sm-fireflies-dot.spent { background: ${palette.fail}; opacity: 0.35; }
    .sm-fireflies-footer { margin-top: 12px; text-align: center; color: ${palette.subtext}; font-size: 12px; }
  `;
  root.appendChild(style);
  return style;
}

function drawFirefly(
  context: CanvasRenderingContext2D,
  point: Point,
  alpha: number,
  radius: number
) {
  context.save();
  context.globalAlpha = alpha;
  const gradient = context.createRadialGradient(
    point.x,
    point.y,
    0,
    point.x,
    point.y,
    radius * 4
  );
  gradient.addColorStop(0, palette.fireflyHot);
  gradient.addColorStop(0.35, palette.firefly);
  gradient.addColorStop(1, "rgba(255,235,59,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(point.x, point.y, radius * 4, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = Math.min(1, alpha + 0.2);
  context.fillStyle = palette.fireflyHot;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export const runFirefliesPuzzle: FirefliesPuzzleRunner = (options) => {
  const { mountRoot, title, difficulty, onComplete } = options;
  const document = mountRoot.ownerDocument;
  const style = appendStyles(mountRoot);
  const overlay = document.createElement("div");
  overlay.className = "sm-fireflies-overlay";
  const panel = document.createElement("div");
  panel.className = "sm-fireflies-panel";
  const heading = document.createElement("h2");
  heading.className = "sm-fireflies-title";
  heading.textContent = title;
  const canvas = document.createElement("canvas");
  canvas.className = "sm-fireflies-main";
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const optionsRow = document.createElement("div");
  optionsRow.className = "sm-fireflies-options";
  const attemptsRow = document.createElement("div");
  attemptsRow.className = "sm-fireflies-attempts";
  const status = document.createElement("div");
  status.className = "sm-fireflies-status";
  status.textContent = "Watch for the coherent path.";
  const footer = document.createElement("div");
  footer.className = "sm-fireflies-footer";
  footer.textContent = "1-4 or click to select | Esc to abandon.";

  panel.append(heading, canvas, optionsRow, attemptsRow, status, footer);
  overlay.appendChild(panel);
  mountRoot.appendChild(overlay);
  options.claimInput(LOCK_ID);

  const seed = Math.floor(performance.now()) || 44;
  const paths = pickPaths(difficulty, seed);
  const answerIndex = seed % 4;
  const offsets = quadrantOffsets(seed + 1);
  const mainMotes = createMotes(answerIndex, FIREFLIES_PER_PATH, seed + 2);
  const decoyCount = difficultyDecoys[difficulty];
  const decoyMotes = Array.from({ length: decoyCount }, (_, index) =>
    createMotes((answerIndex + index + 1) % 4, FIREFLIES_PER_PATH, seed + 10 + index)
  ).flat();
  const noiseRandom = seededRandom(seed + 90);
  const noise = Array.from({ length: DISTRACTION_FIREFLIES }, () => ({
    x: noiseRandom() * CANVAS_WIDTH,
    y: noiseRandom() * CANVAS_HEIGHT,
    phase: noiseRandom() * Math.PI * 2
  }));
  const optionCanvases = paths.map((path, index) => {
    const button = document.createElement("button");
    button.className = "sm-fireflies-option";
    button.type = "button";
    button.setAttribute("aria-label", `Option ${index + 1}`);
    const optionCanvas = document.createElement("canvas");
    optionCanvas.width = OPTION_SIZE;
    optionCanvas.height = OPTION_SIZE;
    button.appendChild(optionCanvas);
    button.addEventListener("click", () => select(index));
    optionsRow.appendChild(button);
    drawPathPreview(optionCanvas, path, "none");
    return optionCanvas;
  });
  const attemptDots = Array.from({ length: MAX_ATTEMPTS }, () => {
    const dot = document.createElement("span");
    dot.className = "sm-fireflies-dot";
    attemptsRow.appendChild(dot);
    return dot;
  });

  let attempts = 0;
  let completed = false;
  let frame = 0;
  const context = canvas.getContext("2d");

  function dispose() {
    completed = true;
    cancelAnimationFrame(frame);
    document.defaultView?.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    style.remove();
    options.releaseInput(LOCK_ID);
  }

  function finish(result: FirefliesPuzzleResult) {
    if (completed) return;
    completed = true;
    setTimeout(() => {
      dispose();
      onComplete(result);
    }, 1500);
  }

  function select(index: number) {
    if (completed) return;
    if (index === answerIndex) {
      drawPathPreview(optionCanvases[index]!, paths[index]!, "success");
      status.textContent = "Attunement successful!";
      finish("success");
      return;
    }
    attempts += 1;
    drawPathPreview(optionCanvases[index]!, paths[index]!, "fail");
    attemptDots[attempts - 1]?.classList.add("spent");
    const remaining = MAX_ATTEMPTS - attempts;
    status.textContent =
      remaining > 0
        ? `Incorrect. ${remaining} attempts remaining.`
        : "Attunement failed...";
    if (attempts >= MAX_ATTEMPTS) {
      finish("fail");
      return;
    }
    setTimeout(() => {
      if (!completed) drawPathPreview(optionCanvases[index]!, paths[index]!, "none");
    }, 500);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      status.textContent = "Attunement abandoned.";
      finish("fail");
      return;
    }
    const optionIndex = Number(event.key) - 1;
    if (optionIndex >= 0 && optionIndex < 4) {
      select(optionIndex);
    }
  }

  function toCanvasPoint(mote: Mote): Point {
    const path = paths[mote.pathIndex]!;
    const offset = offsets[mote.pathIndex]!;
    const point = pathPoint(path, mote.t);
    return {
      x: CANVAS_WIDTH * (0.5 + offset.x + point.x + mote.jitter.x),
      y: CANVAS_HEIGHT * (0.5 + offset.y + point.y + mote.jitter.y)
    };
  }

  function render(now: number) {
    if (!context || completed) return;
    const speed = difficultySpeed[difficulty];
    const cycle = (now * speed) % COHERENCE_PERIOD;
    const sweepProgress = clamp01(cycle / SWEEP_DURATION);
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const background = context.createRadialGradient(
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      12,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      CANVAS_WIDTH / 1.4
    );
    background.addColorStop(0, "rgb(30,25,50)");
    background.addColorStop(1, "rgb(20,18,35)");
    context.fillStyle = background;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const mote of noise) {
      const alpha = 0.12 + Math.max(0, Math.sin(now * 0.0018 + mote.phase)) * 0.2;
      drawFirefly(context, mote, alpha, 1.2);
    }
    for (const mote of decoyMotes) {
      const alpha =
        0.08 + Math.max(0, Math.sin(now * 0.0015 + mote.phase)) * 0.22;
      drawFirefly(context, toCanvasPoint(mote), alpha, 1.4);
    }
    for (const mote of mainMotes) {
      const distanceToSweep = Math.abs(mote.t - sweepProgress);
      const sweepAlpha = Math.max(0, 1 - distanceToSweep * 8);
      const afterglow =
        cycle > SWEEP_DURATION
          ? Math.max(0, 1 - (cycle - SWEEP_DURATION) / AFTERGLOW_DURATION) * 0.24
          : 0;
      const twinkle = 0.85 + Math.sin(now * 0.003 + mote.phase) * 0.15;
      const alpha = Math.max(0.1, (sweepAlpha * sweepAlpha + afterglow) * twinkle);
      drawFirefly(context, toCanvasPoint(mote), alpha, 1.7 + sweepAlpha * 1.2);
    }
    frame = requestAnimationFrame(render);
  }

  document.defaultView?.addEventListener("keydown", onKeyDown);
  frame = requestAnimationFrame(render);

  return { dispose };
};
