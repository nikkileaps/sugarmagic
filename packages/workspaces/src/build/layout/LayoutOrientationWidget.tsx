import { Box } from "@mantine/core";
import * as THREE from "three";

const WIDGET_SIZE = 96;
const CENTER = WIDGET_SIZE / 2;
const AXIS_RADIUS = 28;
const NEGATIVE_RADIUS = AXIS_RADIUS * 0.78;

type AxisId = "x" | "y" | "z";

interface AxisVisual {
  id: AxisId;
  color: string;
  vector: THREE.Vector3;
}

const AXES: AxisVisual[] = [
  { id: "x", color: "#f38ba8", vector: new THREE.Vector3(1, 0, 0) },
  { id: "y", color: "#a6e3a1", vector: new THREE.Vector3(0, 1, 0) },
  { id: "z", color: "#89b4fa", vector: new THREE.Vector3(0, 0, 1) }
];

export interface LayoutOrientationWidgetProps {
  quaternion: [number, number, number, number];
}

interface ProjectedAxis {
  id: AxisId;
  color: string;
  positive: { x: number; y: number; z: number };
  negative: { x: number; y: number; z: number };
}

function projectAxis(
  axis: AxisVisual,
  inverseCameraRotation: THREE.Quaternion
): ProjectedAxis {
  const positiveDirection = axis.vector.clone().applyQuaternion(inverseCameraRotation);
  const negativeDirection = positiveDirection.clone().multiplyScalar(-1);

  return {
    id: axis.id,
    color: axis.color,
    positive: {
      x: CENTER + positiveDirection.x * AXIS_RADIUS,
      y: CENTER - positiveDirection.y * AXIS_RADIUS,
      z: positiveDirection.z
    },
    negative: {
      x: CENTER + negativeDirection.x * NEGATIVE_RADIUS,
      y: CENTER - negativeDirection.y * NEGATIVE_RADIUS,
      z: negativeDirection.z
    }
  };
}

export function LayoutOrientationWidget({
  quaternion
}: LayoutOrientationWidgetProps) {
  const inverseCameraRotation = new THREE.Quaternion(
    quaternion[0],
    quaternion[1],
    quaternion[2],
    quaternion[3]
  ).invert();

  const projectedAxes = AXES.map((axis) =>
    projectAxis(axis, inverseCameraRotation)
  );

  const negatives = [...projectedAxes].sort((a, b) => a.negative.z - b.negative.z);
  const positives = [...projectedAxes].sort((a, b) => a.positive.z - b.positive.z);

  return (
    <Box
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 10,
        width: WIDGET_SIZE,
        height: WIDGET_SIZE,
        borderRadius: "50%",
        background: "color-mix(in srgb, var(--sm-viewport-bg) 88%, black 12%)",
        border: "1px solid var(--sm-panel-border)",
        boxShadow: "var(--sm-shadow-sm)",
        pointerEvents: "none"
      }}
    >
      <svg
        width={WIDGET_SIZE}
        height={WIDGET_SIZE}
        viewBox={`0 0 ${WIDGET_SIZE} ${WIDGET_SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={CENTER - 6}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="1"
        />

        {negatives.map((axis) => (
          <circle
            key={`${axis.id}-neg`}
            cx={axis.negative.x}
            cy={axis.negative.y}
            r={5}
            fill="rgba(24, 24, 37, 0.92)"
            stroke={axis.color}
            strokeWidth="2"
            opacity={0.9}
          />
        ))}

        {positives.map((axis) => (
          <line
            key={`${axis.id}-line`}
            x1={CENTER}
            y1={CENTER}
            x2={axis.positive.x}
            y2={axis.positive.y}
            stroke={axis.color}
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}

        <circle
          cx={CENTER}
          cy={CENTER}
          r={7}
          fill="#a6e3a1"
          stroke="rgba(30,30,46,0.85)"
          strokeWidth="2"
        />

        {positives.map((axis) => (
          <g key={`${axis.id}-pos`}>
            <circle
              cx={axis.positive.x}
              cy={axis.positive.y}
              r={8}
              fill={axis.color}
            />
            <text
              x={axis.positive.x}
              y={axis.positive.y + 0.5}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fontWeight="700"
              fill="#1e1e2e"
              style={{ textTransform: "uppercase" }}
            >
              {axis.id}
            </text>
          </g>
        ))}
      </svg>
    </Box>
  );
}
