/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/sugarlang-turn-inspector.test.tsx
 *
 * Purpose: Verifies the Sugarlang turn inspector render contract.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/sugarlang-turn-inspector.
 *   - Guards the Epic 13 Studio debug panel shell without depending on browser effects.
 *
 * Implements: Epic 13 Story 13.5
 *
 * Status: active
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@sugarmagic/ui", () => ({
  PanelSection: ({
    title,
    children
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}));
import { SugarlangTurnInspector } from "../../ui/shell/sugarlang-turn-inspector";

describe("SugarlangTurnInspector", () => {
  it("renders the panel title and empty state", () => {
    const markup = renderToStaticMarkup(<SugarlangTurnInspector />);
    expect(markup).toContain("Sugarlang Turn Inspector");
    expect(markup).toContain("No Sugarlang telemetry has been recorded yet.");
  });
});
