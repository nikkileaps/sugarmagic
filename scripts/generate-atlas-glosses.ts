/**
 * scripts/generate-atlas-glosses.ts
 *
 * Generates English glosses for all lemmas in the sugarlang cefrlex atlas files.
 * Uses the local SugarDeploy gateway proxy for LLM translation.
 *
 * Usage:
 *   npx tsx scripts/generate-atlas-glosses.ts
 *
 * Requires the gateway to be running at localhost:8787 (or set GATEWAY_URL).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LANGUAGES = ["es", "it"] as const;
const DATA_DIR = resolve(
  import.meta.dirname,
  "../packages/plugins/src/catalog/sugarlang/data/languages"
);
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8787";
const BATCH_SIZE = 150;

interface AtlasEntry {
  lemmaId: string;
  lang: string;
  cefrPriorBand: string;
  frequencyRank: number;
  partsOfSpeech: string[];
  cefrPriorSource: string;
  glosses?: Record<string, string>;
}

interface AtlasFile {
  lang: string;
  atlasVersion: string;
  lemmas: Record<string, AtlasEntry>;
}

async function translateBatch(
  lemmas: { lemmaId: string; pos: string }[],
  lang: string
): Promise<Record<string, string>> {
  const langName = lang === "es" ? "Spanish" : "Italian";
  const lemmaList = lemmas.map((l) => `${l.lemmaId} (${l.pos})`).join("\n");

  const response = await fetch(`${GATEWAY_URL}/api/sugaragent/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 8192,
      systemPrompt:
        "You are a bilingual dictionary. Output ONLY valid JSON. No markdown, no explanation.",
      userPrompt: `Translate each ${langName} word below to English. Output a JSON object mapping the ${langName} word to its English translation(s). Keep translations brief: 1-3 words, max 2 meanings comma-separated. Use lowercase.

Example: {"correr": "run", "casa": "house, home", "hacer": "do, make"}

Words:
${lemmaList}`
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable)");
    throw new Error(`Gateway error: ${response.status} ${text}`);
  }

  const result = (await response.json()) as { text?: string };
  const text = result.text ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from: ${text.slice(0, 300)}`);
  }

  return JSON.parse(jsonMatch[0]) as Record<string, string>;
}

async function processLanguage(lang: "es" | "it"): Promise<void> {
  const filePath = resolve(DATA_DIR, lang, "cefrlex.json");
  const data: AtlasFile = JSON.parse(readFileSync(filePath, "utf-8"));

  // Only process lemmas that don't already have an English gloss
  const needsGloss = Object.values(data.lemmas).filter(
    (entry) => !entry.glosses?.en
  );
  console.log(
    `${lang}: ${needsGloss.length} lemmas need glosses (${Object.keys(data.lemmas).length} total)`
  );

  // Sort by frequency rank so most important get done first
  needsGloss.sort((a, b) => (a.frequencyRank ?? Infinity) - (b.frequencyRank ?? Infinity));

  const batches: { lemmaId: string; pos: string }[][] = [];
  for (let i = 0; i < needsGloss.length; i += BATCH_SIZE) {
    batches.push(
      needsGloss.slice(i, i + BATCH_SIZE).map((entry) => ({
        lemmaId: entry.lemmaId,
        pos: entry.partsOfSpeech[0] ?? "unknown"
      }))
    );
  }

  console.log(`  ${batches.length} batches of up to ${BATCH_SIZE}`);
  let processed = 0;
  let glossed = 0;

  for (const batch of batches) {
    try {
      const translations = await translateBatch(batch, lang);

      for (const entry of batch) {
        const gloss = translations[entry.lemmaId];
        if (gloss && gloss.trim().length > 0) {
          data.lemmas[entry.lemmaId].glosses = { en: gloss.trim() };
          glossed += 1;
        }
      }

      processed += batch.length;
      console.log(
        `  ${processed}/${needsGloss.length} processed (${glossed} glossed)`
      );

      // Save after each batch so we don't lose progress on failure
      writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");

      // Brief pause between batches
      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      console.error(`  Batch failed at ${processed}:`, error);
      // Save what we have and continue
      writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const withGlosses = Object.values(data.lemmas).filter(
    (entry) => entry.glosses?.en
  ).length;
  console.log(
    `  Done: ${withGlosses}/${Object.keys(data.lemmas).length} have English glosses`
  );
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

async function main(): Promise<void> {
  // Verify gateway is reachable
  try {
    const health = await fetch(`${GATEWAY_URL}/api/sugaragent/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        maxTokens: 10,
        systemPrompt: "Reply with: ok",
        userPrompt: "ok"
      })
    });
    if (!health.ok) {
      console.error(`Gateway not responding correctly at ${GATEWAY_URL}`);
      process.exit(1);
    }
    console.log(`Gateway reachable at ${GATEWAY_URL}`);
  } catch {
    console.error(`Cannot reach gateway at ${GATEWAY_URL}`);
    process.exit(1);
  }

  for (const lang of LANGUAGES) {
    await processLanguage(lang);
  }

  console.log("\nAll done!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
