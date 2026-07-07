/**
 * packages/ui/src/components/CurveEditor.tsx
 *
 * Purpose: reusable periodic-curve editing surface (Plan 063
 * §063.6 is the first consumer). Renders a smooth curve through
 * control points on an SVG grid; drag a point to move it,
 * double-click empty space to add one, double-click a point to
 * remove it (minimum 2). The curve is PERIODIC — the right edge
 * wraps to the left — matching loop-phase semantics. Consumer-
 * agnostic: points in (x: 0..1, y: value) space with an explicit
 * y range.
 *
 * Status: active
 */

import { useCallback, useRef, useState } from "react";
import { Box } from "@mantine/core";

export interface CurveEditorPoint {
  x: number;
  y: number;
}

export interface CurveEditorProps {
  points: CurveEditorPoint[];
  /** Value range mapped to the vertical axis. */
  yMin: number;
  yMax: number;
  height?: number;
  /** Fired on drag end / add / remove with the updated points. */
  onChange: (points: CurveEditorPoint[]) => void;
  /** Evaluate the curve for display (periodic). */
  evaluate: (points: CurveEditorPoint[], phase: number) => number;
}

const PAD = 8;

export function CurveEditor(props: CurveEditorProps) {
  const { points, yMin, yMax, height = 140, onChange, evaluate } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<CurveEditorPoint[] | null>(null);
  const draggingRef = useRef<number | null>(null);
  const shown = draft ?? points;

  const toScreen = useCallback(
    (point: CurveEditorPoint, width: number): [number, number] => [
      PAD + point.x * (width - PAD * 2),
      PAD + (1 - (point.y - yMin) / (yMax - yMin)) * (height - PAD * 2)
    ],
    [yMin, yMax, height]
  );
  const fromScreen = useCallback(
    (sx: number, sy: number, width: number): CurveEditorPoint => ({
      x: Math.max(0, Math.min(0.999, (sx - PAD) / (width - PAD * 2))),
      y:
        yMin +
        (1 - Math.max(0, Math.min(1, (sy - PAD) / (height - PAD * 2)))) *
          (yMax - yMin)
    }),
    [yMin, yMax, height]
  );

  const pointerPosition = (event: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };

  function handlePointerDown(event: React.PointerEvent, index: number) {
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    draggingRef.current = index;
    setDraft([...points]);
  }
  function handlePointerMove(event: React.PointerEvent) {
    if (draggingRef.current === null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const [sx, sy] = pointerPosition(event);
    const moved = fromScreen(sx, sy, rect.width);
    setDraft((current) => {
      if (!current) return current;
      const next = [...current];
      next[draggingRef.current!] = moved;
      return next;
    });
  }
  function handlePointerUp() {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    if (draft) {
      onChange([...draft].sort((a, b) => a.x - b.x));
      setDraft(null);
    }
  }
  function handleDoubleClick(event: React.MouseEvent) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const [sx, sy] = pointerPosition(event);
    // On a point: remove (keep at least 2). Else: add.
    const hitIndex = shown.findIndex((point) => {
      const [px, py] = toScreen(point, rect.width);
      return Math.hypot(px - sx, py - sy) < 10;
    });
    if (hitIndex >= 0) {
      if (shown.length > 2) {
        onChange(shown.filter((_, index) => index !== hitIndex));
      }
      return;
    }
    const added = fromScreen(sx, sy, rect.width);
    onChange([...shown, added].sort((a, b) => a.x - b.x));
  }

  // Build the curve path by sampling the periodic evaluator.
  const width = 420; // viewBox width; SVG scales to container
  const samples = 96;
  const path = Array.from({ length: samples + 1 }, (_, i) => {
    const phase = i / samples;
    const value = evaluate(shown, phase);
    const [sx, sy] = toScreen({ x: phase, y: value }, width);
    return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
  }).join(" ");
  const zeroY = toScreen({ x: 0, y: 0 }, width)[1];

  return (
    <Box>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          height,
          background: "var(--sm-color-surface, #1a1b26)",
          borderRadius: 6,
          touchAction: "none",
          cursor: "crosshair"
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* zero line + quarter-phase grid */}
        {yMin < 0 && yMax > 0 ? (
          <line x1={PAD} x2={width - PAD} y1={zeroY} y2={zeroY} stroke="#3a3d55" strokeDasharray="3 3" />
        ) : null}
        {[0.25, 0.5, 0.75].map((phase) => {
          const x = PAD + phase * (width - PAD * 2);
          return (
            <line key={phase} x1={x} x2={x} y1={PAD} y2={height - PAD} stroke="#2a2c40" />
          );
        })}
        <path d={path} fill="none" stroke="#4dd2ff" strokeWidth={1.6} />
        {shown.map((point, index) => {
          const [sx, sy] = toScreen(point, width);
          return (
            <circle
              key={index}
              cx={sx}
              cy={sy}
              r={5.5}
              fill="#4dd2ff"
              stroke="#0d0e16"
              strokeWidth={1.5}
              style={{ cursor: "grab" }}
              onPointerDown={(event) => handlePointerDown(event, index)}
            />
          );
        })}
      </svg>
    </Box>
  );
}
