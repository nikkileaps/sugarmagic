/**
 * Image component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX } from "react";

export function UIImage(props: {
  src: unknown;
  alt: unknown;
  style: CSSProperties;
}): JSX.Element {
  return (
    <img
      src={typeof props.src === "string" ? props.src : ""}
      alt={typeof props.alt === "string" ? props.alt : ""}
      style={{ display: "block", objectFit: "contain", ...props.style }}
    />
  );
}
