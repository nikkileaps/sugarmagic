/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/scene-density-histogram.test.tsx
 *
 * Purpose: Verifies the Sugarlang scene density histogram helpers and render surface.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/scene-density-histogram and ../../ui/shell/editor-support.
 *   - Guards the Epic 12 authoring-preview density view.
 *
 * Implements: Epic 12 Story 12.2
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
import { SceneDensityHistogram } from "../../ui/shell/scene-density-histogram";
import { summarizeSceneDensity } from "../../ui/shell/editor-support";
import type { CompiledSceneLexicon } from "../../runtime/types";

const FIXTURE_LEXICON: CompiledSceneLexicon = {
  sceneId: "scene-1",
  contentHash: "hash-1",
  pipelineVersion: "1",
  atlasVersion: "atlas-1",
  profile: "authoring-preview",
  lemmas: {
    hola: {
      lemmaId: "hola",
      cefrPriorBand: "A1",
      frequencyRank: 10,
      partsOfSpeech: ["interjection"],
      isQuestCritical: false,
      sceneWeight: 1
    },
    trabajo: {
      lemmaId: "trabajo",
      cefrPriorBand: "A2",
      frequencyRank: 20,
      partsOfSpeech: ["noun"],
      isQuestCritical: false,
      sceneWeight: 1
    },
    aduana: {
      lemmaId: "aduana",
      cefrPriorBand: "B1",
      frequencyRank: 30,
      partsOfSpeech: ["noun"],
      isQuestCritical: true,
      sceneWeight: 1
    }
  },
  properNouns: [],
  anchors: [],
  questEssentialLemmas: [],
  diagnostics: [
    {
      severity: "warning",
      sceneId: "scene-1",
      message: "Scene skews above A2."
    }
  ]
};

describe("SceneDensityHistogram", () => {
  it("summarizes compiled lemmas by CEFR band", () => {
    const summary = summarizeSceneDensity(FIXTURE_LEXICON);

    expect(summary.totalLemmas).toBe(3);
    expect(summary.bandCounts.find((entry) => entry.band === "A1")?.count).toBe(1);
    expect(summary.bandCounts.find((entry) => entry.band === "A2")?.count).toBe(1);
    expect(summary.bandCounts.find((entry) => entry.band === "B1")?.count).toBe(1);
  });

  it("renders diagnostics for an active scene lexicon", () => {
    const markup = renderToStaticMarkup(
      <SceneDensityHistogram
        gameProject={null}
        regions={[]}
        activeRegion={{ identity: { id: "scene-1", schema: "region-document", version: 1 } } as never}
        targetLanguage="es"
        lexicon={FIXTURE_LEXICON}
      />
    );

    expect(markup).toContain("Sugarlang");
    expect(markup).toContain(">3</");
    expect(markup).toContain("lemmas");
    expect(markup).toContain("Scene skews above A2.");
  });
});
