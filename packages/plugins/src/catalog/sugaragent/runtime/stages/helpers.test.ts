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
import { findStageDirectionViolations, normalizeNpcSpeech, normalizeRetrievedEvidenceText } from "./helpers";

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

// Plan 084.4 -- preserveActionTags gate
describe("normalizeNpcSpeech", () => {
  it("strips asterisk spans by default (byte-identical to today)", () => {
    expect(normalizeNpcSpeech("*sweeps hat* Hello.")).not.toContain("*sweeps hat*");
  });

  it("preserves asterisk spans when preserveActionTags=true", () => {
    expect(normalizeNpcSpeech("*sweeps hat* Hello.", true)).toContain("*sweeps hat*");
  });

  it("still strips bracket spans even when preserveActionTags=true", () => {
    const result = normalizeNpcSpeech("*waves* [stage dir] Hi.", true);
    expect(result).toContain("*waves*");
    expect(result).not.toContain("[stage dir]");
  });
});

describe("findStageDirectionViolations", () => {
  it("flags asterisk spans by default (byte-identical to today)", () => {
    expect(findStageDirectionViolations("*waves*")).toContain("contains-asterisk-stage-direction");
  });

  it("does not flag asterisk spans when preserveActionTags=true", () => {
    expect(findStageDirectionViolations("*waves*", true)).not.toContain("contains-asterisk-stage-direction");
  });

  it("still flags bracket spans even when preserveActionTags=true", () => {
    expect(findStageDirectionViolations("[stage direction]", true)).toContain("contains-bracket-stage-direction");
  });

  it("flags narration written around quoted speech", () => {
    // Reached a player verbatim, 2026-08-13, Bo Greyfoot. No asterisks, no
    // brackets, no leading parenthetical -- so every existing pattern missed it.
    const line =
      'I look up from checking the rope on my pack. "Hola." I nod once, ' +
      'watching you for a moment. "Me llamo Bo. Bo Greyfoot." I settle the ' +
      'strap across my shoulder. "Como estas?"';
    expect(findStageDirectionViolations(line)).toContain("contains-narration-around-speech");
    // Still caught when action tags are being preserved -- this is not an
    // action tag, it is prose.
    expect(findStageDirectionViolations(line, true)).toContain("contains-narration-around-speech");
  });

  it("leaves ordinary speech that happens to quote something alone", () => {
    // One quoted span: a character repeating what someone said is normal speech.
    expect(
      findStageDirectionViolations('Bo told me "go north past the dock" and then he left without me.')
    ).not.toContain("contains-narration-around-speech");

    // Two quoted spans, but the line is mostly the quotes -- glossing a word is
    // the core job of a language-teaching NPC and must never be flagged.
    expect(
      findStageDirectionViolations('In Spanish "hello" is "hola".')
    ).not.toContain("contains-narration-around-speech");

    // Plain speech with no quotes at all.
    expect(
      findStageDirectionViolations("Hola. Me llamo Bo. Como estas?")
    ).not.toContain("contains-narration-around-speech");
  });
});
