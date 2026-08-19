/**
 * packages/workspaces/src/design/DialogueNodeCard.tsx
 *
 * Purpose: draws a dialogue node on the graph. Kept apart from the workspace so
 * the three states it has to show -- start of the conversation, currently being
 * playtested, and selected -- can be exercised on their own.
 *
 * Status: active
 */

import type { GraphEditorNodeRendererProps } from "@sugarmagic/ui/node-editor";
import { choiceColor, type DialogueNodePayload } from "./dialogue-graph";

/**
 * The body of a dialogue node on the graph. A node can be the start of the
 * conversation and the line currently being playtested as well as selected, so
 * the card draws those two itself -- the shared editor only knows about
 * selection, and draws the selection ring around whatever this returns.
 */
export function DialogueNodeCard({ node }: GraphEditorNodeRendererProps) {
  const {
    node: dialogueNode,
    isStart,
    isPlaytestActive
  } = node.payload as DialogueNodePayload;

  const accent = isPlaytestActive
    ? "var(--sm-accent-yellow)"
    : isStart
      ? "var(--sm-accent-green)"
      : "var(--sm-color-surface0)";

  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 300,
        background: "var(--sm-color-mantle)",
        border: `2px solid ${accent}`,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: isPlaytestActive
          ? "0 0 20px color-mix(in srgb, var(--sm-accent-yellow) 27%, transparent)"
          : "none"
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background:
            isPlaytestActive || isStart
              ? `color-mix(in srgb, ${accent} 13%, transparent)`
              : "var(--sm-color-surface0)",
          borderBottom: "1px solid var(--sm-color-surface0)",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        {isStart ? (
          <span style={{ color: "var(--sm-accent-green)", fontSize: 10 }}>
            START
          </span>
        ) : null}
        <span
          style={{
            fontSize: 12,
            color: isStart ? "var(--sm-accent-green)" : "var(--sm-color-text)",
            flex: 1
          }}
        >
          {dialogueNode.displayName || dialogueNode.nodeId}
        </span>
        {dialogueNode.speakerLabel ? (
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              background:
                "color-mix(in srgb, var(--sm-accent-blue) 13%, transparent)",
              color: "var(--sm-accent-blue)",
              borderRadius: 3
            }}
          >
            {dialogueNode.speakerLabel}
          </span>
        ) : null}
      </div>
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: "var(--sm-color-subtext)",
          lineHeight: 1.4
        }}
      >
        {dialogueNode.text.length > 120
          ? `${dialogueNode.text.slice(0, 120)}...`
          : dialogueNode.text}
      </div>
      {dialogueNode.next.length > 1 ? (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--sm-color-surface0)",
            background: "var(--sm-color-base)"
          }}
        >
          {dialogueNode.next.map((choice, index) => {
            const color = choice.condition
              ? "var(--sm-accent-yellow)"
              : choiceColor(index);
            return (
              <div
                key={`${choice.targetNodeId}-${index}`}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  margin: "2px 0",
                  background: `color-mix(in srgb, ${color} 13%, transparent)`,
                  color,
                  borderRadius: 4
                }}
              >
                {choice.condition ? "? " : ""}
                {choice.choiceText || choice.targetNodeId}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
