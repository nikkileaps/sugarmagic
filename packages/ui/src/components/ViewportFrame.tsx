import { Box } from "@mantine/core";
import type { ReactNode } from "react";

export interface ViewportFrameProps {
  children?: ReactNode;
}

export function ViewportFrame({ children }: ViewportFrameProps) {
  return (
    <Box
      style={{
        flex: 1,
        minHeight: 0,
        height: "100%",
        background: "var(--sm-viewport-bg)",
        position: "relative",
        overflow: "hidden"
      }}
    >
      {children}
    </Box>
  );
}
