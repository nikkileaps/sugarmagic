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
import type { CEFRBand, CompiledSceneLexicon } from "../../runtime/types";

const FIXTURE_LEXICON: CompiledSceneLexicon = {
  sceneId: "scene-1",
  contentHash: "hash-1",
  pipelineVersion: "1",
  atlasVersion: "atlas-1",
  profile: "authoring-preview",
  lemmas: {
    hola: {
      lemmaId: "hola",
      isQuestCritical: false,
      sceneWeight: 1,
      npcSourceIds: []
    },
    trabajo: {
      lemmaId: "trabajo",
      isQuestCritical: false,
      sceneWeight: 1,
      npcSourceIds: []
    },
    aduana: {
      lemmaId: "aduana",
      isQuestCritical: true,
      sceneWeight: 1,
      npcSourceIds: []
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

/**
 * 090.2c: bands come from the atlas, so the caller supplies the lookup. These
 * are the bands the fixture entries used to carry inline.
 */
const FIXTURE_BANDS: Record<string, CEFRBand> = {
  hola: "A1",
  trabajo: "A2",
  aduana: "B1"
};

describe("SceneDensityHistogram", () => {
  it("summarizes compiled lemmas by CEFR band", () => {
    const summary = summarizeSceneDensity(
      FIXTURE_LEXICON,
      (lemmaId) => FIXTURE_BANDS[lemmaId]
    );

    expect(summary.totalLemmas).toBe(3);
    expect(summary.bandCounts.find((entry) => entry.band === "A1")?.count).toBe(1);
    expect(summary.bandCounts.find((entry) => entry.band === "A2")?.count).toBe(1);
    expect(summary.bandCounts.find((entry) => entry.band === "B1")?.count).toBe(1);
  });

  it("counts nothing when no band lookup is available", () => {
    // Pin: with no atlas the histogram must report zeros rather than collapsing
    // every lemma into one band, which is what an `undefined === undefined`
    // comparison would have done.
    const summary = summarizeSceneDensity(FIXTURE_LEXICON);

    expect(summary.totalLemmas).toBe(3);
    expect(summary.bandCounts.every((entry) => entry.count === 0)).toBe(true);
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
