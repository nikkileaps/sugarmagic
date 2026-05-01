/**
 * Progress-bar component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX } from "react";

function numeric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function UIProgressBar(props: {
  value: unknown;
  min: unknown;
  max: unknown;
  style: CSSProperties;
}): JSX.Element {
  const min = numeric(props.min, 0);
  const max = numeric(props.max, 1);
  const value = numeric(props.value, min);
  const ratio = max <= min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <div
      role="progressbar"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{
        width: 180,
        height: 12,
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(255,255,255,0.2)",
        ...props.style
      }}
    >
      <div
        style={{
          width: `${ratio * 100}%`,
          height: "100%",
          borderRadius: "inherit",
          background: "var(--sm-game-ui-color-primary, #ff4aa2)"
        }}
      />
    </div>
  );
}
