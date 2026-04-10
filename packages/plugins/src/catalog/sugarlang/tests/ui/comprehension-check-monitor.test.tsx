/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/comprehension-check-monitor.test.tsx
 *
 * Purpose: Verifies the comprehension-check monitor render contract.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/comprehension-check-monitor.
 *   - Guards the Epic 13 monitor shell without depending on browser effects.
 *
 * Implements: Epic 13 Story 13.5b
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
import { ComprehensionCheckMonitor } from "../../ui/shell/comprehension-check-monitor";

describe("ComprehensionCheckMonitor", () => {
  it("renders the panel title and empty state", () => {
    const markup = renderToStaticMarkup(<ComprehensionCheckMonitor />);
    expect(markup).toContain("Comprehension Check Monitor");
    expect(markup).toContain("No comprehension probes have fired yet.");
  });
});
