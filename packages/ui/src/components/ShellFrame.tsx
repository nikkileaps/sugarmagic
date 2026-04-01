import { AppShell } from "@mantine/core";
import type { ReactNode } from "react";

export interface ShellFrameProps {
  navbar: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

export function ShellFrame({ navbar, header, footer, children }: ShellFrameProps) {
  return (
    <AppShell
      header={{ height: 44 }}
      navbar={{ width: 240, breakpoint: 0 }}
      footer={{ height: 28 }}
      padding={0}
      styles={{
        root: {
          background: "var(--sm-shell-bg)",
          color: "var(--sm-color-text)",
          height: "100vh"
        },
        main: {
          background: "var(--sm-viewport-bg)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "calc(100vh - 44px - 28px)",
          overflow: "hidden"
        }
      }}
    >
      <AppShell.Header
        styles={{
          header: {
            background: "var(--sm-modebar-bg)",
            borderBottom: "1px solid var(--sm-panel-border)",
            display: "flex",
            flexDirection: "column"
          }
        }}
      >
        {header}
      </AppShell.Header>

      <AppShell.Navbar
        styles={{
          navbar: {
            background: "var(--sm-panel-bg)",
            borderRight: "1px solid var(--sm-panel-border)"
          }
        }}
      >
        {navbar}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>

      <AppShell.Footer
        styles={{
          footer: {
            background: "var(--sm-status-bg)",
            borderTop: "1px solid var(--sm-panel-border)"
          }
        }}
      >
        {footer}
      </AppShell.Footer>
    </AppShell>
  );
}
