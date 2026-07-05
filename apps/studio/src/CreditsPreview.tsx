/**
 * apps/studio/src/CreditsPreview.tsx
 *
 * Purpose: Plan 059 §059.6 — the live credits roll preview shown
 * in the Game UI workspace's center panel while editing credits.
 * Renders the NORMALIZED content (what the runtime will actually
 * show — blanks dropped) with the same typography, colors, and
 * pacing as the runtime roll: style constants + the duration
 * formula are imported from target-web so preview and runtime
 * cannot drift. Loops with a short pause between cycles and
 * restarts when the content changes.
 *
 * Implements: Plan 059 §059.6
 *
 * Status: active
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CreditsDefinition } from "@sugarmagic/domain";
import { normalizeCreditsDefinition } from "@sugarmagic/domain";
import {
  computeCreditsRollDurationMs,
  SCENE_CARD_FONT_FAMILY
} from "@sugarmagic/target-web";

const CYCLE_PAUSE_MS = 1200;

export function CreditsPreview(props: { credits: CreditsDefinition }) {
  const normalized = useMemo(
    () => normalizeCreditsDefinition(props.credits),
    [props.credits]
  );
  const contentKey = useMemo(() => JSON.stringify(normalized), [normalized]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;
    if (normalized.sections.length === 0) return;

    const viewport = Math.max(1, container.clientHeight);
    const travel = viewport + scroller.scrollHeight;
    const durationMs = computeCreditsRollDurationMs(travel, viewport);

    // Reset to the start without animating, force a reflow, then
    // kick the linear scroll — same mechanics as the runtime roll.
    scroller.style.transition = "none";
    scroller.style.transform = "translateY(0)";
    void scroller.offsetHeight;
    scroller.style.transition = `transform ${durationMs}ms linear`;
    scroller.style.transform = `translateY(-${travel}px)`;

    const timer = window.setTimeout(
      () => setCycle((current) => current + 1),
      durationMs + CYCLE_PAUSE_MS
    );
    return () => window.clearTimeout(timer);
  }, [contentKey, cycle, normalized.sections.length]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000000",
        fontFamily: SCENE_CARD_FONT_FAMILY,
        textAlign: "center",
        userSelect: "none"
      }}
    >
      {normalized.sections.length === 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8a8378",
            fontSize: 13,
            letterSpacing: "0.2em",
            textTransform: "uppercase"
          }}
        >
          No credits to preview
        </div>
      ) : (
        <div
          key={contentKey}
          ref={scrollerRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 28,
            padding: "0 24px"
          }}
        >
          {normalized.sections.map((section, index) => (
            <div key={index}>
              {section.heading && (
                <div
                  style={{
                    color: "#8a8378",
                    fontSize: 13,
                    letterSpacing: "0.3em",
                    textTransform: "uppercase",
                    marginBottom: 8
                  }}
                >
                  {section.heading}
                </div>
              )}
              {section.lines.map((line, lineIndex) => (
                <div
                  key={lineIndex}
                  style={{
                    color: "#f5f0e8",
                    fontSize: 22,
                    letterSpacing: "0.06em",
                    lineHeight: 1.7
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
