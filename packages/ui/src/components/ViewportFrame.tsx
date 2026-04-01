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
        background: "var(--sm-viewport-bg)",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {children}
    </Box>
  );
}
