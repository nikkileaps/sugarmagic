/**
 * ShellFrame — the top-level layout container for the Sugarmagic shell.
 *
 * Defines five layout panels:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │              HeaderPanel                     │
 *   ├───────────┬─────────────────────┬───────────┤
 *   │           │                     │           │
 *   │ LeftPanel │    CenterPanel      │ RightPanel│
 *   │           │                     │ (future)  │
 *   │           │                     │           │
 *   ├───────────┴─────────────────────┴───────────┤
 *   │              BottomPanel                     │
 *   └─────────────────────────────────────────────┘
 *
 * These are pure layout regions. What goes inside each panel
 * (mode bar, inspector, viewport, status) is the consumer's concern.
 */

import { AppShell } from "@mantine/core";
import type { ReactNode } from "react";

export interface ShellFrameProps {
  headerPanel: ReactNode;
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  bottomPanel: ReactNode;
}

export function ShellFrame({
  headerPanel,
  leftPanel,
  centerPanel,
  bottomPanel
}: ShellFrameProps) {
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
        {headerPanel}
      </AppShell.Header>

      <AppShell.Navbar
        styles={{
          navbar: {
            background: "var(--sm-panel-bg)",
            borderRight: "1px solid var(--sm-panel-border)"
          }
        }}
      >
        {leftPanel}
      </AppShell.Navbar>

      <AppShell.Main>{centerPanel}</AppShell.Main>

      <AppShell.Footer
        styles={{
          footer: {
            background: "var(--sm-status-bg)",
            borderTop: "1px solid var(--sm-panel-border)"
          }
        }}
      >
        {bottomPanel}
      </AppShell.Footer>
    </AppShell>
  );
}
