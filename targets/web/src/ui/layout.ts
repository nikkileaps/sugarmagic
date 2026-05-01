/**
 * Layout helpers for authored screen-space UI nodes in the web target.
 */

import type { CSSProperties } from "react";
import type { UIAnchor, UILayoutProps } from "@sugarmagic/domain";

function sizeToCss(value: UILayoutProps["width"]): CSSProperties["width"] {
  if (value === "fill") return "100%";
  if (value === "auto") return "auto";
  return `${value}px`;
}

function justifyToCss(value: UILayoutProps["justify"]): CSSProperties["justifyContent"] {
  if (value === "between") return "space-between";
  if (value === "around") return "space-around";
  return value === "start" ? "flex-start" : value === "end" ? "flex-end" : "center";
}

function alignToCss(value: UILayoutProps["align"]): CSSProperties["alignItems"] {
  if (value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  return value;
}

function anchorToCss(anchor: UIAnchor | null): CSSProperties {
  if (!anchor) return {};
  const style: CSSProperties = { position: "absolute" };
  if (anchor.startsWith("top")) style.top = 20;
  if (anchor.startsWith("center")) {
    style.top = "50%";
    style.transform = "translateY(-50%)";
  }
  if (anchor.startsWith("bottom")) style.bottom = 20;
  if (anchor.endsWith("left")) style.left = 20;
  if (anchor.endsWith("center")) {
    style.left = "50%";
    style.transform = `${style.transform ?? ""} translateX(-50%)`.trim();
  }
  if (anchor.endsWith("right")) style.right = 20;
  return style;
}

export function compileLayout(layout: UILayoutProps, anchor: UIAnchor | null): CSSProperties {
  return {
    display: "flex",
    flexDirection: layout.direction,
    gap: layout.gap,
    padding: layout.padding,
    alignItems: alignToCss(layout.align),
    justifyContent: justifyToCss(layout.justify),
    width: sizeToCss(layout.width),
    height: sizeToCss(layout.height),
    boxSizing: "border-box",
    ...anchorToCss(anchor)
  };
}
