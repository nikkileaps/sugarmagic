/**
 * targets/web/src/ui/PreNewGameStepOverlay.tsx
 *
 * One pre-new-game step on screen: a title, a row of choices, and a confirm
 * button. Rendered by GameUILayer when uiState.preNewGameStepOpen is true,
 * which is between the New Game press and the save being wiped.
 *
 * There is no close button and no backdrop dismiss. A step always resolves
 * with a choice, so nothing downstream has to handle "shown but unanswered".
 */

import { useState } from "react";
import type { CSSProperties } from "react";
import type { PreNewGameStepDefinition } from "@sugarmagic/runtime-core";

export interface PreNewGameStepOverlayProps {
  definition: PreNewGameStepDefinition;
  onConfirm: (optionId: string) => void;
}

const S: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(7, 7, 15, 0.82)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
    zIndex: 50,
    padding: "32px 16px"
  },
  card: {
    background: "var(--sm-game-ui-color-surface, #1a1a2e)",
    border: "1px solid rgba(246, 241, 255, 0.12)",
    borderRadius: 8,
    width: "100%",
    maxWidth: 480,
    padding: "32px 28px",
    color: "var(--sm-game-ui-color-text, #f6f1ff)",
    fontFamily: "var(--sm-game-ui-font-body, sans-serif)",
    textAlign: "center"
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0
  },
  prompt: {
    fontSize: 14,
    opacity: 0.75,
    margin: "8px 0 0"
  },
  options: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    margin: "24px 0"
  },
  confirm: {
    font: "inherit",
    fontSize: 15,
    padding: "10px 32px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    background: "var(--sm-game-ui-color-accent, #f6f1ff)",
    color: "var(--sm-game-ui-color-surface, #1a1a2e)"
  }
};

function optionStyle(selected: boolean): CSSProperties {
  return {
    font: "inherit",
    fontSize: 15,
    padding: "10px 24px",
    borderRadius: 4,
    cursor: "pointer",
    background: "transparent",
    color: "inherit",
    border: selected
      ? "2px solid var(--sm-game-ui-color-accent, #f6f1ff)"
      : "2px solid rgba(246, 241, 255, 0.24)"
  };
}

export function PreNewGameStepOverlay(props: PreNewGameStepOverlayProps) {
  const [selectedOptionId, setSelectedOptionId] = useState(
    props.definition.defaultOptionId
  );

  return (
    <div style={S["backdrop"]} data-pre-new-game-step={props.definition.stepId}>
      <div style={S["card"]}>
        <h2 style={S["title"]}>{props.definition.title}</h2>
        {props.definition.prompt ? (
          <p style={S["prompt"]}>{props.definition.prompt}</p>
        ) : null}
        <div style={S["options"]}>
          {props.definition.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              data-option-id={option.optionId}
              aria-pressed={option.optionId === selectedOptionId}
              style={optionStyle(option.optionId === selectedOptionId)}
              onClick={() => setSelectedOptionId(option.optionId)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-pre-new-game-step-confirm
          style={S["confirm"]}
          onClick={() => props.onConfirm(selectedOptionId)}
        >
          {props.definition.confirmLabel}
        </button>
      </div>
    </div>
  );
}
