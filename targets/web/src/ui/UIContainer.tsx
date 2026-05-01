/**
 * Container component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX, ReactNode } from "react";

export function UIContainer(props: {
  style: CSSProperties;
  children: ReactNode;
}): JSX.Element {
  return <div style={props.style}>{props.children}</div>;
}
