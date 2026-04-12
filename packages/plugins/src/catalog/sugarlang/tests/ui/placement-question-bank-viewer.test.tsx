/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/placement-question-bank-viewer.test.tsx
 *
 * Purpose: Verifies the read-only placement question bank viewer.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/placement-question-bank-viewer and ../../ui/shell/editor-support.
 *   - Guards the Epic 12 placement bank viewer affordance.
 *
 * Implements: Epic 12 Story 12.4
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
import { loadPlacementQuestionBank } from "../../ui/shell/editor-support";
import { PlacementQuestionBankViewer } from "../../ui/shell/placement-question-bank-viewer";

describe("PlacementQuestionBankViewer", () => {
  it("loads the shipped Spanish placement questionnaire", () => {
    const questionnaire = loadPlacementQuestionBank("es");

    expect(questionnaire).not.toBeNull();
    expect(questionnaire?.lang).toBe("es");
    expect(questionnaire?.questions.length).toBeGreaterThan(0);
  });

  it("renders a missing-language fallback message gracefully", () => {
    const markup = renderToStaticMarkup(
      <PlacementQuestionBankViewer
        targetLanguage="xx"
        questionnaire={null}
      />
    );

    expect(markup).toContain('No shipped placement questionnaire is available for target language &quot;xx&quot;.');
  });
});
