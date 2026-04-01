/**
 * Sugarmagic shell design tokens.
 *
 * Inherited from the established Sugarengine Catppuccin Mocha shell palette.
 * These are the canonical shared tokens for editor-shell surfaces.
 * Published-game UI must not inherit this palette.
 */

export const shellColors = {
  text: "#cdd6f4",
  subtext: "#bac2de",
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#45475a",
  surface1: "#313244",
  surface0: "#242436",
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#1a1a2e"
} as const;

export const shellAccent = {
  blue: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  mauve: "#cba6f7",
  teal: "#94e2d5",
  peach: "#fab387"
} as const;

export const shellSpawnColors: Record<string, string> = {
  npc: shellAccent.blue,
  pickup: shellAccent.yellow,
  inspectable: shellAccent.mauve,
  resonancePoint: shellAccent.teal,
  vfx: shellAccent.peach,
  trigger: shellAccent.red
};

export const shellIcons = {
  dialogues: "💬",
  quests: "📜",
  npcs: "👤",
  items: "🎒",
  spells: "✨",
  resonance: "🦋",
  vfx: "🔥",
  player: "🧙",
  inspections: "🔍",
  regions: "🗺️",
  pickup: "📦",
  trigger: "⚡",
  design: "✨",
  build: "🗺️",
  render: "🔥"
} as const;

export const shellTypography = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monoFamily: "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace",
  size: {
    xs: "10px",
    sm: "12px",
    md: "13px",
    lg: "14px",
    xl: "16px",
    heading: "18px"
  }
} as const;

export const shellSpacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  xxl: "24px"
} as const;

export const shellRadius = {
  sm: "4px",
  md: "6px",
  lg: "8px"
} as const;

export const shellElevation = {
  panel: `0 1px 3px rgba(0, 0, 0, 0.3)`,
  popup: `0 4px 12px rgba(0, 0, 0, 0.4)`,
  inset: `inset 0 1px 2px rgba(0, 0, 0, 0.2)`
} as const;

export const shellTransition = {
  fast: "120ms ease",
  normal: "200ms ease",
  slow: "300ms ease"
} as const;
