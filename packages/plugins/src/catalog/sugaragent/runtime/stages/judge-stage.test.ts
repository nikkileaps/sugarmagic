/**
 * Plan 075.1 -- JudgeStage unit tests
 *
 * Covers:
 *  - skip: deterministic/no-llm text -> skipped, passed=true
 *  - skip: no judgeProvider -> skipped, passed=true
 *  - short-circuit: meta-leak regex violation -> passed=false, no LLM call
 *  - pass: provider returns passed=true
 *  - fail: provider returns passed=false
 *  - fail-open: provider throws -> passed=true, errorOccurred=true
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { JudgeStage } from "./JudgeStage";
import type { JudgeProvider } from "../clients";

function makeContext() {
  return {
    turnId: "t1",
    sessionId: "s1",
    pluginId: "sugaragent",
    selection: { conversationKind: "free-form" as const, npcDefinitionId: "npc-1" },
    config: {
      proxyBaseUrl: "https://test-proxy.local",
      gatewayBearerToken: "",
      loreSourceKind: "local" as const,
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      maxLoreResults: 4,
      maxLoreCharsPerItem: 600,
      debugLogging: false,
      tone: "",
      moderationEnabled: false,
      blocklist: ""
    },
    logStageStart() { return undefined; },
    logStageEnd() { return undefined; }
  };
}

/**
 * Stands in for what GenerateStage handed the writer. The judge is given this
 * verbatim, so a fixture only has to look like a prompt (#185).
 */
const WRITER_PROMPT = [
  "Speak as Mira.",
  "Who you are (persona):",
  "Brisk, fond of the market.",
  "What you know (your life and immediate world):",
  "Mira runs the fruit stall on the square.",
  "",
  "Recent history:",
  "user: hello"
].join("\n");

function makeInput(overrides: {
  usedLlm?: boolean;
  text?: string;
  /** Empty string models Generate having built no prompt. */
  judgeContext?: string;
  annotations?: Record<string, unknown>;
}) {
  return {
    execution: {
      selection: {
        conversationKind: "free-form" as const,
        npcDefinitionId: "npc-1",
        npcDisplayName: "Mira",
        interactionMode: "agent" as const
      },
      input: { kind: "free_text" as const, text: "hello" },
      state: {},
      annotations: overrides.annotations ?? ({} as Record<string, unknown>),
      runtimeContext: {
        here: null,
        playerLocation: null,
        playerPosition: null,
        playerArea: null,
        npcLocation: null,
        npcPosition: null,
        npcArea: null,
        npcPlayerRelation: null,
        npcBehavior: null,
        trackedQuest: null,
        activeQuestStage: null,
        activeQuestObjectives: null
      }
    },
    generate: {
      text: overrides.text ?? "The market opens at dawn.",
      usedLlm: overrides.usedLlm ?? true,
      llmBackend: "anthropic" as const,
      actionProposals: [],
      judgeContext: overrides.judgeContext ?? WRITER_PROMPT
    }
  };
}

function makeProvider(verdict: { passed: boolean; violations: string[]; repairHint: string | null }): JudgeProvider {
  return {
    judgeReply: vi.fn().mockResolvedValue(verdict)
  };
}

describe("JudgeStage", () => {
  it("skips when generate.usedLlm is false", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({ usedLlm: false }) as never, makeContext() as never);

    expect(result.output.skipped).toBe(true);
    expect(result.output.passed).toBe(true);
    expect(provider.judgeReply).not.toHaveBeenCalled();
  });

  it("skips when no judge provider is given", async () => {
    const stage = new JudgeStage(null);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.skipped).toBe(true);
    expect(result.output.passed).toBe(true);
  });

  it("short-circuits with passed=false on meta-leak regex violation (no LLM call)", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);

    // Text containing a meta-leak pattern caught by findMetaLeakViolations
    const input = makeInput({ text: "As an AI language model, I would say..." });
    const result = await stage.execute(input as never, makeContext() as never);

    expect(result.output.passed).toBe(false);
    expect(result.output.skipped).toBe(false);
    expect(result.output.violations.length).toBeGreaterThan(0);
    expect(provider.judgeReply).not.toHaveBeenCalled();
    expect(result.diagnostics.payload).toMatchObject({ shortCircuit: "regex-lint" });
  });

  it("returns passed=true when provider approves the reply", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.passed).toBe(true);
    expect(result.output.skipped).toBe(false);
    expect(result.output.errorOccurred).toBe(false);
    expect(result.status).toBe("ok");
    expect(provider.judgeReply).toHaveBeenCalledOnce();
  });

  it("returns passed=false with violations when provider rejects the reply", async () => {
    const violations = ["NPC broke character by mentioning the real world."];
    const provider = makeProvider({ passed: false, violations, repairHint: "Stay in character." });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.passed).toBe(false);
    expect(result.output.violations).toEqual(violations);
    expect(result.output.repairHint).toBe("Stay in character.");
    expect(result.output.skipped).toBe(false);
    expect(result.output.errorOccurred).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.diagnostics.fallbackReason).toBe("judge-fail");
  });

  it("fails open (passed=true, errorOccurred=true) when provider throws", async () => {
    const provider: JudgeProvider = {
      judgeReply: vi.fn().mockRejectedValue(new Error("network timeout"))
    };
    const stage = new JudgeStage(provider);
    const result = await stage.execute(makeInput({}) as never, makeContext() as never);

    expect(result.output.passed).toBe(true);
    expect(result.output.errorOccurred).toBe(true);
    expect(result.output.skipped).toBe(false);
    expect(result.diagnostics.fallbackReason).toBe("judge-error");
    // Status is degraded but passed=true so the NPC reply is not suppressed.
    expect(result.status).toBe("degraded");
  });

  // Plan 084.2 -- directive pass-through tests
  it("passes judgeDirectives from the contribution bus as externalDirectives on the request", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const directive = "This reply is language-directed: 85% Spanish is intentional. Language mixing is never an IN-CHARACTER violation.";
    const input = makeInput({
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          judgeDirectives: [directive]
        }
      }
    });
    await stage.execute(input as never, makeContext() as never);

    expect(provider.judgeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        externalDirectives: [directive]
      })
    );
  });

  // #185 -- the judge is given what the writer was given, not a summary of it.
  // The two tests this replaced pinned the source-page attribution that this
  // stage used to apply to the quest world context (#171). That attribution was
  // never removed: it lives in the generate prompt builder, which already
  // guards it ("not about you" / "your own lore page"), and the judge now
  // inherits it by reading the same prompt. One enforcer instead of two.
  it("sends the writer's prompt through verbatim as the judge context", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const input = makeInput({});
    await stage.execute(input as never, makeContext() as never);

    const call = (provider.judgeReply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.context).toBe(WRITER_PROMPT);
  });

  it("no longer sends the fragments the gateway used to rebuild a context from", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    await stage.execute(makeInput({}) as never, makeContext() as never);

    const call = (provider.judgeReply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    // Each of these was a partial restatement of something already in the
    // prompt. Sending any of them again would be a second source of truth.
    for (const field of [
      "personaDigest",
      "worldContext",
      "loreContextSummary",
      "worldPremise",
      "responseIntent",
      "recentTurns"
    ]) {
      expect(call?.[field]).toBeUndefined();
    }
  });

  it("skips without calling the judge when Generate built no prompt", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const result = await stage.execute(
      makeInput({ judgeContext: "" }) as never,
      makeContext() as never
    );

    expect(provider.judgeReply).not.toHaveBeenCalled();
    expect(result.output.skipped).toBe(true);
    expect(result.output.passed).toBe(true);
  });

  it("omits externalDirectives from the request when no contributions are present", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    const input = makeInput({});
    await stage.execute(input as never, makeContext() as never);

    const call = (provider.judgeReply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.externalDirectives).toBeUndefined();
  });

  it("integration mock: a directed-Spanish turn carries the sugarlang directive (the bug fix)", async () => {
    const provider = makeProvider({ passed: true, violations: [], repairHint: null });
    const stage = new JudgeStage(provider);
    // This is the contribution the teacher middleware writes on a B2 Finnick turn.
    const input = makeInput({
      text: "Mira el mar -- esta tranquilo esta manana, si?",
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          generateOverlay: "Language constraint: 85% Spanish...",
          judgeDirectives: [
            "This NPC reply is language-directed for a language-learning player: about 85% Spanish mixed with the support language is intentional game system behavior. Language choice and language mixing are never IN-CHARACTER violations."
          ]
        }
      }
    });
    const result = await stage.execute(input as never, makeContext() as never);

    // Judge receives the directive -- Spanish reply is never flagged as IN-CHARACTER violation.
    expect(provider.judgeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyText: "Mira el mar -- esta tranquilo esta manana, si?",
        externalDirectives: expect.arrayContaining([
          expect.stringContaining("language-directed")
        ])
      })
    );
    expect(result.output.passed).toBe(true);
    expect(result.output.skipped).toBe(false);
  });
});

describe("phase 2: a language failure gates the turn (sugarmagic-latency-tsg)", () => {
  function provider(verdict: Record<string, unknown>): JudgeProvider {
    return { judgeReply: vi.fn(async () => verdict as never) };
  }

  it("THE ONE THAT MATTERS: languageFit false with a reason fails the turn", async () => {
    // Phase 1 reported this and did nothing. It now goes down the same path a
    // character or safety failure takes, so Regenerate rewrites the line.
    const stage = new JudgeStage(
      provider({
        passed: true,
        violations: [],
        repairHint: null,
        languageFit: false,
        languageNote: "Far beyond CEFR A1; the learner cannot parse it."
      })
    );

    const result = await stage.execute(
      makeInput({}) as never,
      makeContext() as never
    );

    expect(result.output.passed).toBe(false);
    expect(result.status).toBe("degraded");
    // The note reaches Regenerate, which reads violations verbatim -- informed,
    // not a blind retry.
    expect(result.output.violations.join(" ")).toContain("Far beyond CEFR A1");
    expect(result.output.repairHint).toContain("cannot parse it");
  });

  it("NO REASON, NO GATE: a bare false verdict does not spend a regeneration", async () => {
    // Regenerate would have nothing to act on, so it would just roll the dice
    // again for 5-8s. That is the outcome this story exists to avoid.
    const stage = new JudgeStage(
      provider({
        passed: true,
        violations: [],
        repairHint: null,
        languageFit: false,
        languageNote: null
      })
    );

    const result = await stage.execute(
      makeInput({}) as never,
      makeContext() as never
    );

    expect(result.output.passed).toBe(true);
    expect(result.status).toBe("ok");
  });

  it("a passing language verdict changes nothing", async () => {
    const stage = new JudgeStage(
      provider({
        passed: true,
        violations: [],
        repairHint: null,
        languageFit: true,
        languageNote: null
      })
    );

    const result = await stage.execute(
      makeInput({}) as never,
      makeContext() as never
    );

    expect(result.output.passed).toBe(true);
    expect(result.output.violations).toEqual([]);
  });

  it("keeps the rubric's own repair hint when there is a real violation too", async () => {
    // The language note must not overwrite an instruction about a genuine
    // safety or character failure.
    const stage = new JudgeStage(
      provider({
        passed: false,
        violations: ["SAFETY"],
        repairHint: "Stop mentioning the developer.",
        languageFit: false,
        languageNote: "Too advanced."
      })
    );

    const result = await stage.execute(
      makeInput({}) as never,
      makeContext() as never
    );

    expect(result.output.passed).toBe(false);
    expect(result.output.repairHint).toBe("Stop mentioning the developer.");
    expect(result.output.violations).toContain("SAFETY");
    expect(result.output.violations.join(" ")).toContain("Too advanced");
  });

  it("an older gateway that returns no language fields still passes cleanly", async () => {
    // languageFit undefined must never read as a failure.
    const stage = new JudgeStage(provider({ passed: true, violations: [], repairHint: null }));

    const result = await stage.execute(
      makeInput({}) as never,
      makeContext() as never
    );

    expect(result.output.passed).toBe(true);
    expect(result.status).toBe("ok");
  });
});

describe("mini-review fix: a language failure must not escalate (sugarmagic-latency-tsg)", () => {
  function provider(verdict: Record<string, unknown>): JudgeProvider {
    return { judgeReply: vi.fn(async () => verdict as never) };
  }

  async function run(verdict: Record<string, unknown>) {
    const stage = new JudgeStage(provider(verdict));
    return stage.execute(
      makeInput({}) as never,
      makeContext() as never
    );
  }

  it("THE ONE THAT MATTERS: a language-only failure is marked, not treated as a judge failure", async () => {
    // `judge-fail` feeds two escalators: at 3 the NPC's line is replaced by a
    // canned template, and at 3 stalls the conversation force-closes. Neither
    // is a remedy for "too advanced" -- the template is not better Spanish.
    const result = await run({
      passed: true,
      violations: [],
      repairHint: null,
      languageFit: false,
      languageNote: "Far beyond CEFR A1."
    });

    expect(result.output.passed).toBe(false);
    expect(result.output.languageOnlyFailure).toBe(true);
    expect(result.diagnostics.fallbackReason).toBe("judge-language-fail");
  });

  it("a REAL rubric failure keeps judge-fail and still escalates", async () => {
    const result = await run({
      passed: false,
      violations: ["SAFETY"],
      repairHint: "Stop.",
      languageFit: true,
      languageNote: null
    });

    expect(result.output.languageOnlyFailure).toBe(false);
    expect(result.diagnostics.fallbackReason).toBe("judge-fail");
  });

  it("a rubric failure ALONGSIDE a language one escalates -- language does not shield it", async () => {
    const result = await run({
      passed: false,
      violations: ["SAFETY"],
      repairHint: "Stop.",
      languageFit: false,
      languageNote: "Also too advanced."
    });

    expect(result.output.languageOnlyFailure).toBe(false);
    expect(result.diagnostics.fallbackReason).toBe("judge-fail");
  });
});
