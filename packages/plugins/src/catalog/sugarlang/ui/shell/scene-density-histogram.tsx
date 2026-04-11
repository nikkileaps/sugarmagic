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
import { useEffect, useState, type ReactElement } from "react";
import type { CEFRBand } from "../../runtime/types";
import type { CompiledSceneLexicon, SceneLemmaInfo } from "../../runtime/types";
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
  const [computedLexicon, setComputedLexicon] = useState<CompiledSceneLexicon | null>(
    props.lexicon ?? null
  );

  useEffect(() => {
    if (props.lexicon) {
      setComputedLexicon(props.lexicon);
      return;
    }

    let cancelled = false;
    setComputedLexicon(null);
    void compileAuthoringSceneLexicon(
      props.gameProject,
      props.activeRegion,
      props.regions,
      props.targetLanguage
    ).then((nextLexicon) => {
      if (!cancelled) {
        setComputedLexicon(nextLexicon);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    props.activeRegion,
    props.gameProject,
    props.lexicon,
    props.regions,
    props.targetLanguage
  ]);

  const [hoveredBand, setHoveredBand] = useState<CEFRBand | null>(null);

  const lexicon = props.lexicon ?? computedLexicon;
  const density = summarizeSceneDensity(lexicon);
  const maxCount = Math.max(1, ...density.bandCounts.map((entry) => entry.count));

  function lemmasForBand(band: CEFRBand): SceneLemmaInfo[] {
    if (!lexicon) return [];
    return Object.values(lexicon.lemmas)
      .filter((lemma) => lemma.cefrPriorBand === band)
      .sort((a, b) => (a.frequencyRank ?? Infinity) - (b.frequencyRank ?? Infinity));
  }

  if (!props.activeRegion) {
    return (
      <PanelSection title="Sugarlang" icon="📊">
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--sm-color-subtext)" }}>
          Select a region to view density.
        </p>
      </PanelSection>
    );
  }

  if (density.totalLemmas === 0) {
    return (
      <PanelSection title="Sugarlang" icon="📊">
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--sm-color-subtext)" }}>
          No lemmas compiled yet.
        </p>
      </PanelSection>
    );
  }

  return (
    <PanelSection title="Sugarlang" icon="📊">
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between"
          }}
        >
          <div>
            <span
              style={{
                display: "block",
                fontSize: "1.75rem",
                fontWeight: 700,
                lineHeight: 1.1
              }}
            >
              {density.totalLemmas.toLocaleString()}
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--sm-color-overlay0)" }}>
              Compiled lemmas
            </span>
          </div>
          {lexicon?.diagnostics?.length ? (
            <span
              title={lexicon.diagnostics.map((d) => d.message).join("\n")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                fontSize: "0.7rem",
                color: "var(--sm-color-yellow, #f9e2af)",
                cursor: "default",
                marginTop: "0.35rem"
              }}
            >
              {"⚠"} {lexicon.diagnostics.length}
            </span>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: "0.5rem" }}>
          {density.bandCounts.map((entry) => {
            const isHovered = hoveredBand === entry.band;
            const bandLemmas = isHovered ? lemmasForBand(entry.band) : [];
            return (
              <div
                key={entry.band}
                style={{ position: "relative" }}
                onMouseEnter={() => {
                  if (entry.count > 0) setHoveredBand(entry.band);
                }}
                onMouseLeave={() => setHoveredBand(null)}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr auto",
                    gap: "0.4rem",
                    alignItems: "center"
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      color: entry.count > 0
                        ? "var(--sm-color-text, #cdd6f4)"
                        : "var(--sm-color-overlay0, #6c7086)",
                      textAlign: "right"
                    }}
                  >
                    {entry.band}
                  </span>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: "rgba(137, 180, 250, 0.1)",
                      overflow: "hidden"
                    }}
                  >
                    {entry.count > 0 ? (
                      <div
                        style={{
                          width: `${(entry.count / maxCount) * 100}%`,
                          height: "100%",
                          borderRadius: 999,
                          background:
                            "linear-gradient(90deg, rgba(137,180,250,0.8), rgba(249,226,175,0.85))"
                        }}
                      />
                    ) : null}
                  </div>
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: "var(--sm-color-overlay0)",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {entry.count > 0
                      ? `${entry.count} · ${formatPercent(entry.percent)}`
                      : "—"}
                  </span>
                </div>
                {isHovered && bandLemmas.length > 0 ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "100%",
                      zIndex: 10,
                      width: "100%",
                      maxHeight: 200,
                      overflowY: "auto",
                      padding: "0.5rem 0.65rem",
                      background: "var(--sm-color-surface0, #313244)",
                      border: "1px solid var(--sm-color-surface1, #444)",
                      borderRadius: "0.35rem",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.3rem"
                    }}
                  >
                    {bandLemmas.map((lemma) => (
                      <span
                        key={lemma.lemmaId}
                        title={[
                          lemma.partsOfSpeech.length > 0
                            ? lemma.partsOfSpeech.join(", ")
                            : null,
                          lemma.frequencyRank != null
                            ? `freq #${lemma.frequencyRank}`
                            : null,
                          lemma.isQuestCritical ? "quest-critical" : null
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        style={{
                          display: "inline-block",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "0.2rem",
                          fontSize: "0.7rem",
                          background: lemma.isQuestCritical
                            ? "rgba(249, 226, 175, 0.22)"
                            : "rgba(137, 180, 250, 0.14)",
                          border: lemma.isQuestCritical
                            ? "1px solid rgba(249, 226, 175, 0.4)"
                            : "1px solid transparent",
                          color: "var(--sm-color-text, #cdd6f4)"
                        }}
                      >
                        {lemma.lemmaId}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

      </div>
    </PanelSection>
  );
}
