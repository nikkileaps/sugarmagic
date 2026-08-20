/**
 * packages/workspaces/src/render/ShaderNodeCard.tsx
 *
 * Purpose: draws a shader node on the graph.
 *
 * The port dots are drawn by the shared editor down each edge of the node, at
 * (index + 1) / (count + 1) of the node's height. The port names here are placed
 * at the same fractions, so each name sits beside its own dot -- otherwise a node
 * with several inputs shows names in one place and dots in another, and there is
 * no way to tell which dot is which.
 *
 * Status: active
 */

import type { GraphEditorNodeRendererProps } from "@sugarmagic/ui/node-editor";
import {
  SHADER_NODE_HEADER_HEIGHT,
  SHADER_NODE_PORT_ROW_HEIGHT,
  shaderPortYPercent,
  type ShaderNodePayload
} from "./shader-graph-mapping";

function portRowStyle(index: number, rowCount: number): React.CSSProperties {
  return {
    position: "absolute",
    top: `${shaderPortYPercent(index, rowCount) * 100}%`,
    transform: "translateY(-50%)",
    fontSize: 11,
    color: "var(--sm-color-subtext)",
    whiteSpace: "nowrap"
  };
}

export function ShaderNodeCard({ node }: GraphEditorNodeRendererProps) {
  const { displayName, category, inputPortNames, outputPortNames } =
    node.payload as ShaderNodePayload;

  const rows = Math.max(inputPortNames.length, outputPortNames.length, 1);
  const bodyHeight = rows * SHADER_NODE_PORT_ROW_HEIGHT;

  return (
    <div
      style={{
        position: "relative",
        minWidth: 200,
        maxWidth: 280,
        minHeight: SHADER_NODE_HEADER_HEIGHT + bodyHeight,
        background: "var(--sm-color-mantle)",
        border: "2px solid var(--sm-color-surface0)",
        borderRadius: 8,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          height: SHADER_NODE_HEADER_HEIGHT,
          padding: "0 12px",
          background: "var(--sm-color-surface0)",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--sm-color-text)",
            flex: 1
          }}
        >
          {displayName}
        </span>
        {category ? (
          <span style={{ fontSize: 10, color: "var(--sm-color-subtext)" }}>
            {category}
          </span>
        ) : null}
      </div>

      {inputPortNames.map((name, index) => (
        <div
          key={`in-${name}`}
          style={{
            ...portRowStyle(index, rows),
            left: 10,
            textAlign: "left"
          }}
        >
          {name}
        </div>
      ))}

      {outputPortNames.map((name, index) => (
        <div
          key={`out-${name}`}
          style={{
            ...portRowStyle(index, rows),
            right: 10,
            textAlign: "right"
          }}
        >
          {name}
        </div>
      ))}
    </div>
  );
}
