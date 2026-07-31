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

import type { GameProject, RegionDocument, Scene } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from "react";
import type { CEFRBand } from "../../runtime/types";
import type { SceneVocabularyModel } from "../../runtime/types";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import {
  compileAuthoringSceneLexicon,
  summarizeSceneDensity
} from "./editor-support";

export interface SceneDensityHistogramProps {
  gameProject: GameProject | null;
  regions: RegionDocument[];
  activeRegion: RegionDocument | null;
  /** Ambient Scene whose overlay composes onto the region -- without it the
   *  compiled density has zero NPC-sourced lemmas. */
  activeScene?: Scene | null;
  targetLanguage: string;
  lexicon?: SceneVocabularyModel | null;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SceneDensityHistogram(
  props: SceneDensityHistogramProps
): ReactElement {
  const [computedLexicon, setComputedLexicon] = useState<SceneVocabularyModel | null>(
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
      props.targetLanguage,
      props.activeScene ?? null
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
    props.activeScene,
    props.gameProject,
    props.lexicon,
    props.regions,
    props.targetLanguage
  ]);

  const [hoveredBand, setHoveredBand] = useState<CEFRBand | null>(null);

  const lexicon = props.lexicon ?? computedLexicon;
  // 090.2c: band and frequency come from the atlas by lemmaId. The provider
  // caches its own data per language, so constructing it here is a map lookup
  // rather than a load.
  const atlas = useMemo(() => new CefrLexAtlasProvider(), []);
  const atlasEntryFor = useCallback(
    (lemmaId: string) => atlas.getLemma(lemmaId, props.targetLanguage),
    [atlas, props.targetLanguage]
  );
  const getBand = useCallback(
    (lemmaId: string) => atlas.getBand(lemmaId, props.targetLanguage),
    [atlas, props.targetLanguage]
  );
  const density = summarizeSceneDensity(lexicon, getBand);
  const maxCount = Math.max(1, ...density.bandCounts.map((entry) => entry.count));

  // 090.2d: the artifact stores lemma IDS now, so this is a string list. Band
  // and frequency were already atlas lookups (090.2c); nothing was lost.
  function lemmasForBand(band: CEFRBand): string[] {
    if (!lexicon) return [];
    return lexicon.lemmaIds
      .filter((lemmaId) => getBand(lemmaId) === band)
      .sort(
        (a, b) =>
          (atlas.getFrequencyRank(a, props.targetLanguage) ?? Infinity) -
          (atlas.getFrequencyRank(b, props.targetLanguage) ?? Infinity)
      );
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
                    {bandLemmas.map((lemmaId) => (
                      <span
                        key={lemmaId}
                        title={[
                          atlasEntryFor(lemmaId)?.partsOfSpeech.join(", ") || null,
                          atlasEntryFor(lemmaId)?.frequencyRank != null
                            ? `freq #${atlasEntryFor(lemmaId)?.frequencyRank}`
                            : null
                          // 090.2d: `isQuestCritical` was shown here and is gone
                          // -- the compiler set it and nothing read it. Quest
                          // essentials reach consumers via questEssentialLemmas.
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        style={{
                          display: "inline-block",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "0.2rem",
                          fontSize: "0.7rem",
                          // 090.2d: the quest-critical highlight went with
                          // `isQuestCritical`, which nothing set meaningfully.
                          background: "rgba(137, 180, 250, 0.14)",
                          border: "1px solid transparent",
                          color: "var(--sm-color-text, #cdd6f4)"
                        }}
                      >
                        {lemmaId}
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
