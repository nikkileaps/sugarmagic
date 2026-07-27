/**
 * Plan 084.6 -- moderation middleware tests
 *
 * Pins:
 *  - Moderation deflected stamp (MODERATION_DEFLECTED_DIAG_KEY) is present on replaced turns.
 *  - Non-flagged turns have no stamp.
 *  - Stage ordering: moderation is policy, sugarlang.verify is analysis -- policy sorts before
 *    analysis in finalizeTurn (critical for 084.6 deterministic-skip to work correctly).
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createModerationMiddleware, MODERATION_DEFLECTED_DIAG_KEY } from "./moderation-middleware";

function makeTurn(text: string) {
  return {
    turnId: "t1",
    providerId: "sugaragent",
    conversationKind: "free-form" as const,
    text,
    choices: [],
    diagnostics: {},
    annotations: {}
  };
}

function makeContext(annotations: Record<string, unknown> = {}) {
  return {
    selection: { conversationKind: "free-form" as const, npcDefinitionId: "npc-1", interactionMode: "agent" as const },
    input: { kind: "free_text" as const, text: "hello" },
    state: {},
    annotations
  };
}

describe("createModerationMiddleware -- deflection stamp (084.6)", () => {
  it("stamps MODERATION_DEFLECTED_DIAG_KEY when input was flagged", async () => {
    const moderationProvider = {
      moderate: vi.fn().mockResolvedValue({ flagged: true, blocklisted: false, categories: [] })
    };
    const middleware = createModerationMiddleware({ moderationProvider, enabled: true });
    const context = makeContext({ "sugaragent.moderationInputFlagged": { flagged: true } });
    const turn = makeTurn("Some NPC reply.");

    const result = await middleware.finalize!(context as never, turn as never);

    expect(result?.diagnostics?.[MODERATION_DEFLECTED_DIAG_KEY]).toBe(true);
    expect(result?.text).not.toBe("Some NPC reply.");
  });

  it("stamps MODERATION_DEFLECTED_DIAG_KEY when output is flagged", async () => {
    const moderationProvider = {
      moderate: vi.fn().mockResolvedValue({ flagged: true, blocklisted: false, categories: [] })
    };
    const middleware = createModerationMiddleware({ moderationProvider, enabled: true });
    const turn = makeTurn("Harmful output text.");

    const result = await middleware.finalize!(makeContext() as never, turn as never);

    expect(result?.diagnostics?.[MODERATION_DEFLECTED_DIAG_KEY]).toBe(true);
    expect(result?.text).not.toBe("Harmful output text.");
  });

  it("does NOT stamp when output passes moderation", async () => {
    const moderationProvider = {
      moderate: vi.fn().mockResolvedValue({ flagged: false, blocklisted: false, categories: [] })
    };
    const middleware = createModerationMiddleware({ moderationProvider, enabled: true });
    const turn = makeTurn("Perfectly fine reply.");

    const result = await middleware.finalize!(makeContext() as never, turn as never);

    expect(result?.diagnostics?.[MODERATION_DEFLECTED_DIAG_KEY]).toBeUndefined();
    expect(result?.text).toBe("Perfectly fine reply.");
  });
});

// Stage-ordering pin: moderation is 'policy', sugarlang.verify is 'analysis'.
// policy sorts before analysis in MIDDLEWARE_STAGE_ORDER, so moderation finalizes
// BEFORE verify -- the 084.6 deterministic-skip stamp is visible when verify runs.
describe("moderation middleware stage", () => {
  it("is registered as policy stage", () => {
    const middleware = createModerationMiddleware({ moderationProvider: null, enabled: false });
    expect(middleware.stage).toBe("policy");
  });
});
