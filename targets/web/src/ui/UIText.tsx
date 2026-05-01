/**
 * Text component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX } from "react";

export function UIText(props: {
  text: unknown;
  style: CSSProperties;
}): JSX.Element {
  return <div style={props.style}>{String(props.text ?? "")}</div>;
}
