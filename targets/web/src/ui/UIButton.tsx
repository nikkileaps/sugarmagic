/**
 * Button component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX, ReactNode } from "react";
import type { UIActionExpression } from "@sugarmagic/domain";

export function UIButton(props: {
  text: unknown;
  style: CSSProperties;
  action?: UIActionExpression;
  onAction: (action: UIActionExpression) => void;
  children?: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      style={{
        appearance: "none",
        border: 0,
        cursor: props.action ? "pointer" : "default",
        pointerEvents: props.action ? "auto" : "none",
        ...props.style
      }}
      onClick={() => {
        if (props.action) props.onAction(props.action);
      }}
    >
      {String(props.text ?? "")}
      {props.children}
    </button>
  );
}
