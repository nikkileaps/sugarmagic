/**
 * packages/plugins/src/deployment/gateway/lore-designation.test.ts
 *
 * Purpose: Unit tests for the lore-section designation helper (Plan 072.1)
 * and the ingest path's `## Secrets` exclusion.
 *
 * Relationships:
 *   - Pure-helper tests exercise `designateLoreSections` / predicates directly.
 *   - The ingest test drives the REAL `readLorePages` against a temp lore dir
 *     to prove `## Secrets` content never reaches a chunk (the vector index).
 *
 * Status: active
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  designateLoreSections,
  isPersonaCardSection,
  isSecretSection,
  type DesignatableLoreSection
} from "./lore-designation";
import { readLorePages } from "./core";

function section(
  slug: string,
  content = "content of " + slug,
  heading = slug
): DesignatableLoreSection {
  return { heading, slug, content };
}

describe("designateLoreSections", () => {
  it("routes ## Persona and ## Voice to the persona card, in document order", () => {
    const result = designateLoreSections([
      section("persona"),
      section("voice")
    ]);
    expect(result.personaCard.map((s) => s.slug)).toEqual(["persona", "voice"]);
    expect(result.coreKnowledge).toEqual([]);
    expect(result.secrets).toEqual([]);
  });

  it("routes ## Secrets to the excluded bucket, out of card and core", () => {
    const result = designateLoreSections([
      section("persona"),
      section("secrets", "the villain is the mayor"),
      section("routine")
    ]);
    expect(result.secrets.map((s) => s.slug)).toEqual(["secrets"]);
    expect(result.personaCard.map((s) => s.slug)).toEqual(["persona"]);
    expect(result.coreKnowledge.map((s) => s.slug)).toEqual(["routine"]);
    expect(result.coreKnowledge.some((s) => s.slug === "secrets")).toBe(false);
    expect(result.personaCard.some((s) => s.slug === "secrets")).toBe(false);
  });

  it("routes every non-reserved section (incl. implicit Overview) to core knowledge", () => {
    const result = designateLoreSections([
      section("overview"),
      section("work"),
      section("home")
    ]);
    expect(result.coreKnowledge.map((s) => s.slug)).toEqual([
      "overview",
      "work",
      "home"
    ]);
    expect(result.personaCard).toEqual([]);
    expect(result.secrets).toEqual([]);
  });

  it("treats a missing persona card as legal (empty card, core still loads)", () => {
    const result = designateLoreSections([section("overview"), section("work")]);
    expect(result.personaCard).toEqual([]);
    expect(result.coreKnowledge).toHaveLength(2);
  });

  it("matches reserved slugs regardless of heading casing (parser lowercases the slug)", () => {
    // splitLoreSections slugifies headings to lowercase, so `## PERSONA`,
    // `## Persona`, `# voice` all arrive here as slug "persona"/"voice".
    expect(isPersonaCardSection(section("persona", "x", "PERSONA"))).toBe(true);
    expect(isPersonaCardSection(section("voice", "x", "Voice"))).toBe(true);
    expect(isSecretSection(section("secrets", "x", "Secrets"))).toBe(true);
  });

  it("does NOT designate near-miss headings (exact reserved slug only)", () => {
    expect(isPersonaCardSection(section("persona-and-backstory"))).toBe(false);
    expect(isSecretSection(section("secret"))).toBe(false); // singular
    const result = designateLoreSections([
      section("persona-and-backstory"),
      section("secret")
    ]);
    expect(result.coreKnowledge).toHaveLength(2);
    expect(result.personaCard).toEqual([]);
    expect(result.secrets).toEqual([]);
  });

  it("returns three empty buckets for an empty page", () => {
    expect(designateLoreSections([])).toEqual({
      personaCard: [],
      coreKnowledge: [],
      secrets: []
    });
  });
});

describe("ingest excludes ## Secrets from the vector index", () => {
  let loreDir: string | null = null;
  const savedPath = process.env["SUGARMAGIC_LORE_SOURCE_PATH"];
  const savedKind = process.env["SUGARMAGIC_LORE_SOURCE_KIND"];

  afterEach(() => {
    if (loreDir) rmSync(loreDir, { recursive: true, force: true });
    loreDir = null;
    if (savedPath === undefined) delete process.env["SUGARMAGIC_LORE_SOURCE_PATH"];
    else process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = savedPath;
    if (savedKind === undefined) delete process.env["SUGARMAGIC_LORE_SOURCE_KIND"];
    else process.env["SUGARMAGIC_LORE_SOURCE_KIND"] = savedKind;
  });

  it("chunks persona/voice/core sections but never the secret section", () => {
    loreDir = mkdtempSync(join(tmpdir(), "sm-lore-"));
    mkdirSync(join(loreDir, "entities"), { recursive: true });
    writeFileSync(
      join(loreDir, "entities", "maren.md"),
      [
        "---",
        "id: lore.npc.maren",
        "title: Maren",
        "---",
        "## Persona",
        "Warm, brisk, proud of her sourdough.",
        "",
        "## Voice",
        "Short sentences. Calls everyone 'love'.",
        "",
        "## Work",
        "Runs the bakery on the square.",
        "",
        "## Secrets",
        "SECRETWORD_SPARROW: she is the lost heir.",
        ""
      ].join("\n"),
      "utf8"
    );
    process.env["SUGARMAGIC_LORE_SOURCE_KIND"] = "local";
    process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = loreDir;

    const { pages, chunks } = readLorePages();

    // The page still carries all four sections (072.2 strips resolve, not this).
    const page = pages.find((p) => p.pageId === "lore.npc.maren");
    expect(page?.sections.map((s) => s.slug).sort()).toEqual([
      "persona",
      "secrets",
      "voice",
      "work"
    ]);

    // Chunks cover persona/voice/work but NOT secrets.
    const pageChunks = chunks.filter((c) => c.pageId === "lore.npc.maren");
    expect(pageChunks.map((c) => c.sectionSlug).sort()).toEqual([
      "persona",
      "voice",
      "work"
    ]);
    expect(pageChunks.some((c) => c.sectionSlug === "secrets")).toBe(false);
    // The secret content string appears in no chunk's embedding text.
    expect(
      pageChunks.some((c) => c.embeddingText.includes("SECRETWORD_SPARROW"))
    ).toBe(false);
  });
});
