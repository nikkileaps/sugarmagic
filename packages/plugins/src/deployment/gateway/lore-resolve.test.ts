/**
 * packages/plugins/src/deployment/gateway/lore-resolve.test.ts
 *
 * Purpose: Verifies the lore/resolve route excludes `## Secrets` from BOTH the
 * `sections` array AND the `body` field (Plan 072.2), keeps the
 * missingPageIds-in-200 convention, leaves secret-free pages byte-identical,
 * and still emits the shape sugarlang's isResolvedLorePage guard requires.
 *
 * Status: active
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleSugarAgentLoreResolve } from "./core";

function makeReq(bodyJson: unknown): IncomingMessage {
  const body = JSON.stringify(bodyJson);
  return {
    method: "POST",
    url: "/api/sugaragent/lore/resolve",
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(body, "utf8");
    }
  } as unknown as IncomingMessage;
}

type MockRes = ServerResponse & {
  __sugarmagicCors?: Record<string, string>;
  statusCode: number;
  body: string;
};

function makeRes(): MockRes {
  let body = "";
  const res = {
    __sugarmagicCors: {},
    statusCode: 0,
    body: "",
    writeHead(code: number) {
      res.statusCode = code;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
      res.body = body;
    }
  } as unknown as MockRes;
  return res;
}

interface ResolvedPage {
  pageId: string;
  title: string;
  relativePath: string;
  sectionCount: number;
  body: string;
  sections: Array<{ heading: string; slug: string; content: string }>;
}
interface ResolveResponse {
  ok: boolean;
  pages: ResolvedPage[];
  missingPageIds: string[];
}

// Mirror of sugarlang's isResolvedLorePage (lore-resolution.ts) required shape,
// so a drift that breaks the consumer fails here.
function validatesAgainstSugarlangGuard(page: unknown): boolean {
  if (typeof page !== "object" || page === null) return false;
  const p = page as Record<string, unknown>;
  return (
    typeof p["pageId"] === "string" &&
    typeof p["title"] === "string" &&
    typeof p["relativePath"] === "string" &&
    typeof p["body"] === "string" &&
    Array.isArray(p["sections"]) &&
    p["sections"].every(
      (s) =>
        typeof (s as Record<string, unknown>)?.["heading"] === "string" &&
        typeof (s as Record<string, unknown>)?.["slug"] === "string" &&
        typeof (s as Record<string, unknown>)?.["content"] === "string"
    )
  );
}

describe("lore/resolve excludes ## Secrets (Plan 072.2)", () => {
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

  function seedLore(): void {
    loreDir = mkdtempSync(join(tmpdir(), "sm-lore-resolve-"));
    mkdirSync(join(loreDir, "npc"), { recursive: true });
    // Page WITH a secret section.
    writeFileSync(
      join(loreDir, "npc", "maren.md"),
      [
        "---",
        "id: lore.npc.maren",
        "title: Maren",
        "---",
        "## Persona",
        "Warm and brisk.",
        "",
        "## Work",
        "Runs the bakery.",
        "",
        "## Secrets",
        "SECRETWORD_SPARROW: the lost heir.",
        ""
      ].join("\n"),
      "utf8"
    );
    // Page WITHOUT any secret section (must pass through byte-identical).
    writeFileSync(
      join(loreDir, "npc", "tomas.md"),
      [
        "---",
        "id: lore.npc.tomas",
        "title: Tomas",
        "---",
        "## Persona",
        "Gruff miller.",
        "",
        "## Work",
        "Grinds the flour.",
        ""
      ].join("\n"),
      "utf8"
    );
    process.env["SUGARMAGIC_LORE_SOURCE_KIND"] = "local";
    process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = loreDir;
  }

  async function resolve(pageIds: string[]): Promise<ResolveResponse> {
    const res = makeRes();
    await handleSugarAgentLoreResolve(makeReq({ pageIds }), res);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ResolveResponse;
  }

  it("strips ## Secrets from both sections and body", async () => {
    seedLore();
    const out = await resolve(["lore.npc.maren"]);
    const page = out.pages.find((p) => p.pageId === "lore.npc.maren")!;
    expect(page.sections.map((s) => s.slug).sort()).toEqual(["persona", "work"]);
    expect(page.sections.some((s) => s.slug === "secrets")).toBe(false);
    expect(page.body).not.toContain("SECRETWORD_SPARROW");
    expect(page.body).not.toContain("Secrets");
    // body is still a non-empty string carrying the visible content.
    expect(page.body).toContain("Runs the bakery.");
    expect(page.sectionCount).toBe(2);
  });

  it("leaves a secret-free page's body byte-identical", async () => {
    seedLore();
    const out = await resolve(["lore.npc.tomas"]);
    const page = out.pages.find((p) => p.pageId === "lore.npc.tomas")!;
    // Original raw body (post-frontmatter), untouched.
    expect(page.body).toBe(
      ["## Persona", "Gruff miller.", "", "## Work", "Grinds the flour.", ""].join(
        "\n"
      )
    );
    expect(page.sectionCount).toBe(2);
  });

  it("keeps the missingPageIds convention (200, no 404)", async () => {
    seedLore();
    const out = await resolve(["lore.npc.maren", "lore.npc.nobody"]);
    expect(out.missingPageIds).toEqual(["lore.npc.nobody"]);
    expect(out.pages.map((p) => p.pageId)).toEqual(["lore.npc.maren"]);
  });

  it("still validates against sugarlang's isResolvedLorePage shape", async () => {
    seedLore();
    const out = await resolve(["lore.npc.maren", "lore.npc.tomas"]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages.every(validatesAgainstSugarlangGuard)).toBe(true);
  });
});
