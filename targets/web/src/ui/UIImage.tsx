/**
 * Image component for authored target-web UI nodes.
 */

import type { CSSProperties, JSX } from "react";
import type { UIBindingExpression } from "@sugarmagic/domain";
import { useResolvedBinding } from "./useResolvedBinding";

export function UIImage(props: {
  src: UIBindingExpression | undefined;
  alt: UIBindingExpression | undefined;
  style: CSSProperties;
}): JSX.Element {
  const src = useResolvedBinding(props.src);
  const alt = useResolvedBinding(props.alt);
  return (
    <img
      src={typeof src === "string" ? src : ""}
      alt={typeof alt === "string" ? alt : ""}
      style={{ display: "block", objectFit: "contain", ...props.style }}
    />
  );
}
