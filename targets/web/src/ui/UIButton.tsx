/**
 * Button component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX, ReactNode } from "react";
import type { UIActionExpression, UIBindingExpression } from "@sugarmagic/domain";
import { useUIRuntimeBridge } from "./UIContextProvider";
import { useResolvedBinding } from "./useResolvedBinding";

export function UIButton(props: {
  text: UIBindingExpression | undefined;
  style: CSSProperties;
  action?: UIActionExpression;
  children?: ReactNode;
}): JSX.Element {
  const { onAction } = useUIRuntimeBridge();
  const text = useResolvedBinding(props.text);
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
        if (props.action) onAction(props.action);
      }}
    >
      {String(text ?? "")}
      {props.children}
    </button>
  );
}
