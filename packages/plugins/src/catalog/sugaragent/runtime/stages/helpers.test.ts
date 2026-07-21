/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/helpers.test.ts
 *
 * Purpose: Guards evidence-text normalization — the ingest header lines
 * (Page ID:/Title:/Section:) must be stripped from retrieved evidence so they
 * never leak into the NPC's prompt (Plan 072.7 fix for the blank-line bug).
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { normalizeRetrievedEvidenceText } from "./helpers";

describe("normalizeRetrievedEvidenceText", () => {
  it("strips ALL leading ingest headers even when separated by blank lines", () => {
    // Mirrors how ingest builds embedding text: headers joined with \n\n.
    const embedding = [
      "Page ID: lore.media.podcasts.archivado.episode_01",
      "Title: Archivado — Episodio 1",
      "Section: SCENE 1",
      "Real grounded content here."
    ].join("\n\n");
    expect(normalizeRetrievedEvidenceText(embedding)).toBe(
      "Real grounded content here."
    );
  });

  it("leaves content that has no headers untouched", () => {
    expect(normalizeRetrievedEvidenceText("The hero guards the bridge.")).toBe(
      "The hero guards the bridge."
    );
  });

  it("keeps multi-line body content after the headers", () => {
    const embedding = [
      "Page ID: x",
      "Title: y",
      "Section: z",
      "Line one.\nLine two."
    ].join("\n\n");
    expect(normalizeRetrievedEvidenceText(embedding)).toBe("Line one.\nLine two.");
  });

  it("falls back to the original when there is nothing but headers", () => {
    const headersOnly = ["Page ID: x", "Title: y"].join("\n\n");
    expect(normalizeRetrievedEvidenceText(headersOnly)).toBe(headersOnly);
  });
});
