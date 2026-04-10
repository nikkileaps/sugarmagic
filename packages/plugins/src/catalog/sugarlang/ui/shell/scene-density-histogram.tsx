/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/scene-density-histogram.tsx
 *
 * Purpose: Renders the authoring-time scene-density histogram used to visualize CEFR distribution.
 *
 * Exports:
 *   - SceneDensityHistogram
 *
 * Relationships:
 *   - Depends on the shared scene compiler and authoring-preview diagnostics.
 *   - Is registered by contributions.ts as an Epic 12 design.section contribution.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { GameProject, RegionDocument } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import type { ReactElement } from "react";
import type { CompiledSceneLexicon } from "../../runtime/types";
import {
  compileAuthoringSceneLexicon,
  summarizeSceneDensity
} from "./editor-support";

export interface SceneDensityHistogramProps {
  gameProject: GameProject | null;
  regions: RegionDocument[];
  activeRegion: RegionDocument | null;
  targetLanguage: string;
  lexicon?: CompiledSceneLexicon | null;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SceneDensityHistogram(
  props: SceneDensityHistogramProps
): ReactElement {
  const lexicon =
    props.lexicon ??
    compileAuthoringSceneLexicon(
      props.gameProject,
      props.activeRegion,
      props.regions,
      props.targetLanguage
    );
  const density = summarizeSceneDensity(lexicon);
  const maxCount = Math.max(1, ...density.bandCounts.map((entry) => entry.count));

  return (
    <PanelSection title="Scene Density" icon="📊">
      <div style={{ display: "grid", gap: "1rem" }}>
        {props.activeRegion ? (
          <p style={{ margin: 0, color: "var(--sm-color-subtext)" }}>
            {density.totalLemmas === 0
              ? "No classified lemmas are present in the active region yet."
              : `This scene has ${density.totalLemmas} lemmas across the compiled authoring-preview lexicon.`}
          </p>
        ) : (
          <p style={{ margin: 0, color: "var(--sm-color-subtext)" }}>
            Select a region to inspect its Sugarlang density profile.
          </p>
        )}

        {props.activeRegion && density.totalLemmas > 0 ? (
          <div style={{ display: "grid", gap: "0.65rem" }}>
            {density.bandCounts.map((entry) => (
              <div
                key={entry.band}
                style={{
                  display: "grid",
                  gridTemplateColumns: "52px 1fr 84px",
                  gap: "0.65rem",
                  alignItems: "center"
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    justifyContent: "center",
                    borderRadius: 999,
                    background: "rgba(137, 180, 250, 0.18)",
                    padding: "0.15rem 0.45rem",
                    fontSize: "0.75rem",
                    fontWeight: 600
                  }}
                >
                  {entry.band}
                </span>
                <div
                  style={{
                    height: 12,
                    borderRadius: 999,
                    background: "rgba(137, 180, 250, 0.14)",
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      width: `${(entry.count / maxCount) * 100}%`,
                      height: "100%",
                      background:
                        "linear-gradient(90deg, rgba(137,180,250,0.85), rgba(249,226,175,0.9))"
                    }}
                  />
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
                  {entry.count} · {formatPercent(entry.percent)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {lexicon?.diagnostics?.length ? (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                textTransform: "uppercase",
                color: "var(--sm-color-subtext)"
              }}
            >
              Diagnostics
            </span>
            {lexicon.diagnostics.map((diagnostic, index) => (
              <span
                key={`${diagnostic.message}:${index}`}
                style={{ fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}
              >
                {diagnostic.severity.toUpperCase()}: {diagnostic.message}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </PanelSection>
  );
}
