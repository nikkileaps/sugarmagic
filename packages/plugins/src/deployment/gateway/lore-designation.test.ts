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
  composeLoreBody,
  designateLoreSections,
  findRelationshipEntry,
  isPersonaCardSection,
  isRecoverySection,
  isSecretSection,
  isWithheldSection,
  parseRecoveryStrategies,
  parseRelationshipEntries,
  type DesignatableLoreSection
} from "./lore-designation";
import { readLorePages, splitLoreSections } from "./core";

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

  it("returns empty buckets for an empty page", () => {
    expect(designateLoreSections([])).toEqual({
      personaCard: [],
      coreKnowledge: [],
      secrets: [],
      recovery: []
    });
  });
});

describe("designateLoreSections -- ## Recovery", () => {
  it("routes ## Recovery to its own bucket, not the card and not core knowledge", () => {
    const result = designateLoreSections([
      section("persona"),
      section("recovery"),
      section("work")
    ]);
    expect(result.recovery.map((s) => s.slug)).toEqual(["recovery"]);
    expect(result.coreKnowledge.map((s) => s.slug)).toEqual(["work"]);
    expect(result.personaCard.map((s) => s.slug)).toEqual(["persona"]);
  });

  it("does not designate a near-miss heading", () => {
    expect(isRecoverySection(section("recovering"))).toBe(false);
    expect(designateLoreSections([section("recovering")]).recovery).toEqual([]);
  });

  it("counts both Secrets and Recovery as withheld", () => {
    expect(isWithheldSection(section("secrets"))).toBe(true);
    expect(isWithheldSection(section("recovery"))).toBe(true);
    expect(isWithheldSection(section("persona"))).toBe(false);
  });
});

describe("parseRecoveryStrategies", () => {
  it("reads the move from each list item and ignores the prose after it", () => {
    const result = parseRecoveryStrategies(
      [
        "- change-subject -- She assumes you have not yet learned how things",
        "  ought to be done, and tells you.",
        "- playful-probe",
        "* joke: delivered with a straight face."
      ].join("\n")
    );
    expect(result.strategies).toEqual([
      "change-subject",
      "playful-probe",
      "joke"
    ]);
    expect(result.unrecognized).toEqual([]);
  });

  it("reports a name that is not a move instead of dropping it silently", () => {
    const result = parseRecoveryStrategies(
      ["- curt-exit", "- storms-off-in-a-huff -- she leaves"].join("\n")
    );
    expect(result.strategies).toEqual(["curt-exit"]);
    expect(result.unrecognized).toEqual(["storms-off-in-a-huff"]);
  });

  it("matches names case-insensitively", () => {
    expect(parseRecoveryStrategies("- Self-Disclosure").strategies).toEqual([
      "self-disclosure"
    ]);
  });

  it("returns nothing for a section with no list items", () => {
    expect(parseRecoveryStrategies("She simply carries on.")).toEqual({
      strategies: [],
      unrecognized: []
    });
  });
});

describe("composeLoreBody", () => {
  it("re-emits sections as ## headings joined by blank lines", () => {
    expect(
      composeLoreBody([section("persona", "Warm."), section("work", "Bakes.")])
    ).toBe("## persona\n\nWarm.\n\n## work\n\nBakes.");
  });

  it("yields an empty string for no visible sections (all-secrets page)", () => {
    expect(composeLoreBody([])).toBe("");
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

describe("ingest excludes ## Recovery, and names an unknown move", () => {
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

  function seed(recoveryBody: string[]): ReturnType<typeof readLorePages> {
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
        "## Recovery",
        ...recoveryBody,
        ""
      ].join("\n"),
      "utf8"
    );
    process.env["SUGARMAGIC_LORE_SOURCE_KIND"] = "local";
    process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = loreDir;
    return readLorePages();
  }

  it("keeps the section on the page but never chunks it", () => {
    const { pages, chunks } = seed([
      "- change-subject -- RECOVERYWORD_WREN, she talks about the oven."
    ]);

    const page = pages.find((p) => p.pageId === "lore.npc.maren");
    expect(page?.sections.map((s) => s.slug).sort()).toEqual([
      "persona",
      "recovery"
    ]);

    const pageChunks = chunks.filter((c) => c.pageId === "lore.npc.maren");
    expect(pageChunks.map((c) => c.sectionSlug)).toEqual(["persona"]);
    expect(
      pageChunks.some((c) => c.embeddingText.includes("RECOVERYWORD_WREN"))
    ).toBe(false);
  });

  it("warns with the page id when a move is not one it knows", () => {
    const { warnings } = seed(["- curt-exit", "- storms-off-in-a-huff"]);

    const warning = warnings.find((w) => w.includes("storms-off-in-a-huff"));
    expect(warning).toBeDefined();
    expect(warning).toContain("lore.npc.maren");
    expect(warning).toContain("curt-exit");
  });

  it("says nothing when every move is one it knows", () => {
    const { warnings } = seed(["- curt-exit", "- joke"]);
    expect(warnings.filter((w) => w.includes("recovery strategy"))).toEqual([]);
  });
});

describe("readLorePages canon_level", () => {
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

  function writeLore(files: { name: string; lines: string[] }[]) {
    loreDir = mkdtempSync(join(tmpdir(), "sm-lore-canon-"));
    mkdirSync(join(loreDir, "pages"), { recursive: true });
    for (const file of files) {
      writeFileSync(join(loreDir, "pages", file.name), file.lines.join("\n"), "utf8");
    }
    process.env["SUGARMAGIC_LORE_SOURCE_KIND"] = "local";
    process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = loreDir;
  }

  const softPodcast = {
    name: "podcast.md",
    lines: [
      "---",
      "id: lore.media.podcast.ep1",
      "title: Archivado -- Episode 1",
      "canon_level: soft",
      "---",
      "## Scene 4",
      "In my apartment I packed a SUITCASE_MARKER and left for the station.",
      ""
    ]
  };

  it("indexes a soft page as one identity chunk, with none of its contents", () => {
    writeLore([softPodcast]);

    const { pages, chunks } = readLorePages();

    const pageChunks = chunks.filter((c) => c.pageId === "lore.media.podcast.ep1");
    expect(pageChunks).toHaveLength(1);
    expect(pageChunks[0]!.canonLevel).toBe("soft");
    expect(pageChunks[0]!.embeddingText).toContain("Archivado -- Episode 1");
    expect(pageChunks[0]!.embeddingText).not.toContain("SUITCASE_MARKER");
    expect(pageChunks[0]!.embeddingText).not.toContain("Scene 4");

    // The full text is untouched, so lore/resolve can still reach it.
    const page = pages.find((p) => p.pageId === "lore.media.podcast.ep1");
    expect(page?.sections.some((s) => s.content.includes("SUITCASE_MARKER"))).toBe(true);
  });

  it("gives a soft page an address that cannot collide with a real section", () => {
    writeLore([softPodcast]);

    const chunk = readLorePages().chunks.find(
      (c) => c.pageId === "lore.media.podcast.ep1"
    );

    // slugify() emits [a-z0-9-] only, so an underscore is unreachable.
    expect(chunk?.sectionSlug).toBe("_page");
    expect(chunk?.chunkId).toBe("lore.media.podcast.ep1#_page");
  });

  it("indexes every section when canon_level is absent", () => {
    writeLore([
      {
        name: "station.md",
        lines: [
          "---",
          "id: lore.locations.station",
          "title: Air Station",
          "---",
          "## Overview",
          "Travellers arrive here.",
          "",
          "## Baggage",
          "Lost luggage goes to the claim desk.",
          ""
        ]
      }
    ]);

    const chunks = readLorePages().chunks.filter(
      (c) => c.pageId === "lore.locations.station"
    );
    expect(chunks.map((c) => c.sectionSlug).sort()).toEqual(["baggage", "overview"]);
    expect(chunks.every((c) => c.canonLevel === "hard")).toBe(true);
  });

  it("warns and indexes fully when canon_level is not a value it knows", () => {
    writeLore([
      {
        name: "odd.md",
        lines: [
          "---",
          "id: lore.odd",
          "title: Odd",
          "canon_level: medium-ish",
          "---",
          "## Overview",
          "Some content.",
          ""
        ]
      }
    ]);

    const { chunks, warnings } = readLorePages();

    expect(chunks.filter((c) => c.pageId === "lore.odd")).toHaveLength(1);
    expect(chunks.find((c) => c.pageId === "lore.odd")!.canonLevel).toBe("hard");
    expect(warnings.some((w) => w.includes("medium-ish"))).toBe(true);
  });
});

// #171 -- another character's page is not world context. What one character
// knows about another is what their own page says under `## Relationships`.
describe("relationships sections", () => {
  // The wiki writes these as plain linked lines, with no list marker.
  it("reads a linked name, its page, and what is said about them", () => {
    const entries = parseRelationshipEntries(
      [
        "[Reginald Beauregard McCrick III](lore.entities.npcs.reginald_mccrick) -- Her late husband.",
        "",
        "[Finnick Thorn](lore.entities.npcs.finnick_thorn) -- An unbearable cheese bore."
      ].join("\n")
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toEqual({
      name: "Finnick Thorn",
      pageId: "lore.entities.npcs.finnick_thorn",
      description: "An unbearable cheese bore."
    });
  });

  it("allows a list marker in front of the link", () => {
    const entries = parseRelationshipEntries(
      "- [Finnick Thorn](lore.entities.npcs.finnick_thorn) -- An unbearable cheese bore."
    );
    expect(entries[0]?.name).toBe("Finnick Thorn");
    expect(entries[0]?.pageId).toBe("lore.entities.npcs.finnick_thorn");
  });

  it("ignores a line with no link", () => {
    const entries = parseRelationshipEntries("Finnick Thorn -- An unbearable cheese bore.");
    expect(entries).toHaveLength(0);
  });

  it("continues a description that wraps onto the next line", () => {
    const entries = parseRelationshipEntries(
      [
        "[Horace Pennyfeather](lore.entities.npcs.horace_pennyfeather) -- She finds him",
        "tediously literal.",
        "[Finnick Thorn](lore.entities.npcs.finnick_thorn) -- Smells of rind."
      ].join("\n")
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]?.description).toBe("She finds him tediously literal.");
    expect(entries[1]?.description).toBe("Smells of rind.");
  });

  it("matches an entry by page id, and by name when the link target is wrong", () => {
    const entries = parseRelationshipEntries(
      [
        "[Horace Pennyfeather](lore.entities.npcs.horace_pennyfeather) -- Tediously literal.",
        // A real typo from the wiki: "ncps" instead of "npcs". The page id will
        // never match, so the name is what saves it.
        "[Reginald Beauregard McCrick III](lore.entities.ncps.reginald_mccrick) -- Her late husband."
      ].join("\n")
    );
    expect(
      findRelationshipEntry(entries, {
        pageId: "lore.entities.npcs.horace_pennyfeather",
        title: null
      })?.description
    ).toBe("Tediously literal.");
    expect(
      findRelationshipEntry(entries, {
        pageId: "lore.entities.npcs.reginald_mccrick",
        title: "Reginald Beauregard McCrick III"
      })?.description
    ).toBe("Her late husband.");
    expect(
      findRelationshipEntry(entries, { pageId: "lore.entities.npcs.mim", title: "Mim" })
    ).toBeNull();
  });
});

describe("splitLoreSections drops the rule between sections", () => {
  it("strips a trailing --- so it does not ride into the prompt", () => {
    const [summary] = splitLoreSections(
      ["## Summary", "", "Mim is a history mage.", "", "---", "", "## Voice", "", "Dry."].join("\n")
    );
    expect(summary?.content).toBe("Mim is a history mage.");
  });

  it("leaves a rule the author put mid-section alone", () => {
    const [only] = splitLoreSections(
      ["## Notes", "", "Before.", "", "---", "", "After."].join("\n")
    );
    expect(only?.content).toContain("---");
    expect(only?.content).toContain("After.");
  });
});
