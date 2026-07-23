/**
 * packages/testing/src/lore-roundtrip.e2e.test.ts
 *
 * E2E lore roundtrip: verifies that the ingest->search pipeline works
 * end-to-end against the real OpenAI vector store.
 *
 * The gateway (running at localhost:8787) holds the API key and VS id;
 * this test calls its /probe endpoint which:
 *   1. Uploads a synthetic file with a unique probe phrase
 *   2. Attaches it to the configured vector store
 *   3. Polls until OpenAI indexes it (up to 90s)
 *   4. Searches for the probe phrase
 *   5. Asserts it comes back in results
 *   6. Cleans up the probe file
 *
 * Skips automatically when the gateway is not reachable (CI, no local stack).
 *
 * Run while the local gateway is up:
 *   pnpm vitest run --reporter=verbose packages/testing/src/lore-roundtrip.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";

const GATEWAY_URL = (process.env["SUGARMAGIC_GATEWAY_URL"] ?? "http://localhost:8787").replace(/\/+$/, "");
const STATUS_URL = GATEWAY_URL + "/api/sugaragent/lore/status";
const PROBE_URL = GATEWAY_URL + "/api/sugaragent/lore/probe";

let gatewayReachable = false;

beforeAll(async () => {
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(3000) });
    gatewayReachable = res.ok || res.status < 500;
  } catch {
    gatewayReachable = false;
  }
});

describe("lore roundtrip (e2e -- requires running gateway)", () => {
  it("uploads a probe file, indexes it, searches and finds it, cleans up", async () => {
    if (!gatewayReachable) {
      console.log("  skipped: gateway not reachable at " + GATEWAY_URL);
      return;
    }

    const res = await fetch(PROBE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(120_000)
    });

    const payload = await res.json() as {
      ok: boolean;
      failedAt?: string;
      durationMs?: number;
      steps: Record<string, { ok: boolean; error?: string; hits?: number; hitFound?: boolean }>;
    };

    if (!payload.ok) {
      const failStep = payload.failedAt ? payload.steps[payload.failedAt] : null;
      expect.fail(
        `Probe failed at step '${payload.failedAt}': ${failStep?.error ?? "unknown error"}\n` +
        `Full steps: ${JSON.stringify(payload.steps, null, 2)}`
      );
    }

    expect(payload.steps["upload"]?.ok, "upload step").toBe(true);
    expect(payload.steps["attach"]?.ok, "attach step").toBe(true);
    expect(payload.steps["index"]?.ok, "index step").toBe(true);
    expect(payload.steps["search"]?.ok, "search step").toBe(true);
    expect(payload.steps["search"]?.hitFound, "probe phrase found in search results").toBe(true);

    const durationS = payload.durationMs != null ? (payload.durationMs / 1000).toFixed(1) : "?";
    console.log(`  PASS: roundtrip in ${durationS}s`);
  }, 130_000);
});
