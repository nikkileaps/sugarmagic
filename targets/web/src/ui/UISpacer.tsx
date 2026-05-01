/**
 * Spacer component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX } from "react";

export function UISpacer(props: { style: CSSProperties }): JSX.Element {
  return <div style={props.style} />;
}
