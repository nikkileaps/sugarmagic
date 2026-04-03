/**
 * ShellFrame — the top-level layout container for the Sugarmagic shell.
 *
 * Defines five layout panels:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │              HeaderPanel                     │
 *   │              SubHeaderPanel (optional)       │
 *   ├───────────┬─────────────────────┬───────────┤
 *   │           │                     │           │
 *   │ LeftPanel │    CenterPanel      │ RightPanel│
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
  subHeaderPanel?: ReactNode;
  leftPanel?: ReactNode;
  centerPanel: ReactNode;
  rightPanel?: ReactNode;
  bottomPanel: ReactNode;
}

export function ShellFrame({
  headerPanel,
  subHeaderPanel,
  leftPanel,
  centerPanel,
  rightPanel,
  bottomPanel
}: ShellFrameProps) {
  const headerHeight = subHeaderPanel ? 76 : 44;

  return (
    <AppShell
      header={{ height: headerHeight }}
      navbar={leftPanel ? { width: 240, breakpoint: 0 } : undefined}
      aside={rightPanel ? { width: 280, breakpoint: 0 } : undefined}
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
          height: `calc(100vh - ${headerHeight}px - 28px)`,
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
        {subHeaderPanel}
      </AppShell.Header>

      {leftPanel && (
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
      )}

      <AppShell.Main>{centerPanel}</AppShell.Main>

      {rightPanel && (
        <AppShell.Aside
          styles={{
            aside: {
              background: "var(--sm-panel-bg)",
              borderLeft: "1px solid var(--sm-panel-border)"
            }
          }}
        >
          {rightPanel}
        </AppShell.Aside>
      )}

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
