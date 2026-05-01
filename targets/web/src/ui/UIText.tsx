/**
 * Text component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX } from "react";
import type { UIBindingExpression } from "@sugarmagic/domain";
import { useResolvedBinding } from "./useResolvedBinding";

export function UIText(props: {
  text: UIBindingExpression | undefined;
  style: CSSProperties;
}): JSX.Element {
  const text = useResolvedBinding(props.text);
  return <div style={props.style}>{String(text ?? "")}</div>;
}
